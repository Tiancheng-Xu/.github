import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_METRICS = [
  "LCP",
  "CLS",
  "INP",
  "FCP",
  "TTFB",
  "navigation.dns",
  "navigation.tcp",
  "navigation.tls",
  "navigation.request_wait",
  "navigation.download",
  "navigation.dom_ready",
  "navigation.window_load",
  "route.duration",
  "resource.duration",
];
const INVENTORY_KEYS = [
  "ecr",
  "ecsClusters",
  "ecsTasks",
  "taskDefinitions",
  "sqsAndDlq",
  "apiGateway",
  "lambda",
  "cloudWatchLogGroups",
  "secrets",
  "securityGroups",
  "securityGroupIngress",
  "iamRoles",
];
const PROTECTED_FOUNDATION = ["vpc", "nat", "rds", "oidc", "artifact", "foundation"];
const FORBIDDEN_SAMPLE_ACTIONS = [
  "chain-transaction",
  "wallet-signature",
  "synthetic-layout-shift",
  "synthetic-error",
];
const SENSITIVE_KEY = /(?:authorization|cookie|token|secret|private.?key|password|prompt|model.?weight)/iu;
const SAFE_SENSITIVE_COUNT_PATHS = new Set(["evidence.cleanup.inventory.secrets"]);

function parseArgs(argv) {
  const options = { root: process.cwd(), manifest: "", evidence: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--root") options.root = value, index += 1;
    else if (argument === "--manifest") options.manifest = value, index += 1;
    else if (argument === "--evidence") options.evidence = value, index += 1;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.manifest) throw new Error("--manifest is required");
  return options;
}

function inside(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function readJson(root, relativePath, violations, code) {
  const absolutePath = resolve(root, relativePath);
  if (!inside(root, absolutePath)) {
    violations.push({ code: "unsafe-path", path: relativePath });
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(absolutePath, "utf8"));
  } catch {
    violations.push({ code, path: relativePath });
    return undefined;
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function normalizedRoute(value) {
  const route = String(value ?? "").trim();
  if (!route.startsWith("/") || route.includes("..") || route.includes("?") || route.includes("#")) return "";
  return route === "/" ? "/" : `/${route.split("/").filter(Boolean).join("/")}`;
}

function scanSensitiveKeys(value, path, violations) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanSensitiveKeys(entry, `${path}[${index}]`, violations));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    const fieldPath = `${path}.${key}`;
    if (SENSITIVE_KEY.test(key) && !SAFE_SENSITIVE_COUNT_PATHS.has(fieldPath)) {
      violations.push({ code: "sensitive-field-forbidden", path: fieldPath });
    }
    scanSensitiveKeys(entry, fieldPath, violations);
  }
}

function validateManifest(manifest, violations) {
  if (!isObject(manifest)) return;
  if (manifest.schemaVersion !== "performance-sampling/v1") violations.push({ code: "manifest-schema-invalid" });
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/u.test(String(manifest.applicationId ?? ""))) {
    violations.push({ code: "application-id-invalid" });
  }
  if (!["contract-only", "verified-run"].includes(manifest.verificationMode)) {
    violations.push({ code: "verification-mode-invalid" });
  }

  if (!Array.isArray(manifest.allowedLocalOrigins) || manifest.allowedLocalOrigins.length === 0) {
    violations.push({ code: "local-origin-required" });
  } else {
    for (const origin of manifest.allowedLocalOrigins) {
      try {
        const url = new URL(origin);
        if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("not loopback");
        if (!["http:", "https:"].includes(url.protocol)) throw new Error("unsupported protocol");
      } catch {
        violations.push({ code: "non-local-origin-forbidden", origin });
      }
    }
  }

  const requiredCoverage = new Set(manifest.metrics?.requiredCoverage ?? []);
  for (const metric of REQUIRED_METRICS) {
    if (!requiredCoverage.has(metric)) violations.push({ code: "required-metric-missing", metric });
  }
  const allowedUnavailable = new Set(manifest.metrics?.allowedUnavailable ?? []);
  if (allowedUnavailable.has("CLS") || allowedUnavailable.has("INP")) {
    violations.push({ code: "interaction-or-stability-metric-cannot-be-optional" });
  }

  const budget = manifest.eventBudget;
  if (!isObject(budget)) {
    violations.push({ code: "event-budget-required" });
  } else {
    for (const key of ["maxEventsPerRoute", "maxTotalEvents", "maxTotalBatches", "maxAttemptsPerEvent"]) {
      if (!positiveInteger(budget[key])) violations.push({ code: "event-budget-invalid", field: key });
    }
    if (!positiveInteger(budget.attemptTimeoutMs) || budget.attemptTimeoutMs > 10_000) {
      violations.push({ code: "attempt-timeout-invalid" });
    }
    if (!positiveInteger(budget.lifecycleDrainMs) || budget.lifecycleDrainMs > 60_000) {
      violations.push({ code: "lifecycle-drain-invalid" });
    }
    if (positiveInteger(budget.maxEventsPerRoute) && positiveInteger(budget.maxTotalEvents) && budget.maxEventsPerRoute > budget.maxTotalEvents) {
      violations.push({ code: "per-route-budget-exceeds-total" });
    }
  }

  if (
    manifest.delivery?.identityKey !== "eventId" ||
    manifest.delivery?.requireAllUniqueEventsAccepted !== true ||
    manifest.delivery?.dashboardCaptureMode !== "intercept-202"
  ) {
    violations.push({ code: "reliable-delivery-contract-invalid" });
  }
  const forbidden = new Set(manifest.safety?.forbiddenSampleActions ?? []);
  for (const action of FORBIDDEN_SAMPLE_ACTIONS) {
    if (!forbidden.has(action)) violations.push({ code: "forbidden-action-guard-missing", action });
  }

  if (!Array.isArray(manifest.routes) || manifest.routes.length === 0) {
    violations.push({ code: "route-manifest-required" });
    return;
  }
  const routePaths = new Set();
  const coveredMetrics = new Set();
  let inpInteractionCount = 0;
  for (const route of manifest.routes) {
    const path = normalizedRoute(route?.path);
    if (!path) violations.push({ code: "route-path-invalid", route: route?.path });
    else if (routePaths.has(path)) violations.push({ code: "route-path-duplicate", route: path });
    else routePaths.add(path);
    if (!String(route?.readiness?.selector ?? "").trim() && !String(route?.readiness?.text ?? "").trim()) {
      violations.push({ code: "route-readiness-missing", route: path });
    }
    if (!positiveInteger(route?.eventBudget) || (positiveInteger(budget?.maxEventsPerRoute) && route.eventBudget > budget.maxEventsPerRoute)) {
      violations.push({ code: "route-event-budget-invalid", route: path });
    }
    if (!Array.isArray(route?.allowedMetrics) || route.allowedMetrics.length === 0) {
      violations.push({ code: "route-metrics-required", route: path });
    } else {
      route.allowedMetrics.forEach((metric) => coveredMetrics.add(metric));
    }
    for (const interaction of route?.interactions ?? []) {
      if (!/^[a-z0-9][a-z0-9-]{1,62}$/u.test(String(interaction?.id ?? ""))) {
        violations.push({ code: "interaction-id-invalid", route: path });
      }
      if (!["click", "key", "submit", "toggle"].includes(interaction?.kind)) {
        violations.push({ code: "interaction-kind-unsafe", route: path });
      }
      if (interaction?.sideEffect !== "none" || !String(interaction?.selector ?? "").trim()) {
        violations.push({ code: "interaction-side-effect-or-selector-invalid", route: path });
      }
      if ((interaction?.expectedMetrics ?? []).includes("INP")) inpInteractionCount += 1;
    }
  }
  for (const metric of requiredCoverage) {
    if (!coveredMetrics.has(metric)) violations.push({ code: "metric-not-covered-by-route", metric });
  }
  if (inpInteractionCount === 0) violations.push({ code: "representative-inp-interaction-required" });
}

function validateEvidence(manifest, evidence, violations) {
  if (!isObject(evidence)) return;
  if (evidence.schemaVersion !== "performance-sampling-evidence/v1") violations.push({ code: "evidence-schema-invalid" });
  if (evidence.applicationId !== manifest.applicationId) violations.push({ code: "evidence-application-mismatch" });
  if (evidence.status !== "verified-and-cleaned" || evidence.provenance !== "controlled-browser") {
    violations.push({ code: "evidence-status-or-provenance-invalid" });
  }
  if (!String(evidence.run?.id ?? "").trim() || !String(evidence.run?.artifactId ?? "").trim()) {
    violations.push({ code: "run-and-artifact-required" });
  }
  if (!/^[a-f0-9]{40}$/u.test(String(evidence.run?.headSha ?? ""))) violations.push({ code: "run-head-sha-invalid" });

  const metrics = new Map((evidence.metrics ?? []).map((metric) => [metric?.name, metric]));
  const allowedUnavailable = new Set(manifest.metrics?.allowedUnavailable ?? []);
  for (const name of manifest.metrics?.requiredCoverage ?? []) {
    const metric = metrics.get(name);
    if (!metric) {
      violations.push({ code: "evidence-metric-missing", metric: name });
      continue;
    }
    if (!Number.isInteger(metric.sampleCount) || metric.sampleCount < 0) {
      violations.push({ code: "metric-sample-count-invalid", metric: name });
      continue;
    }
    if (metric.sampleCount === 0) {
      if (!allowedUnavailable.has(name) || !String(metric.unavailableReason ?? "").trim()) {
        violations.push({ code: "metric-unavailable-without-contract", metric: name });
      }
    } else if (![metric.p50, metric.p75, metric.p95].every(finite)) {
      violations.push({ code: "metric-percentiles-missing", metric: name });
    }
    for (const field of ["unit", "route", "environment", "buildVersion", "window", "source", "capturedAt", "freshness"]) {
      if (!String(metric[field] ?? "").trim()) violations.push({ code: "metric-context-missing", metric: name, field });
    }
    if (name === "INP" && metric.sampleCount > 0 && metric.sampleCount < 5 && metric.lowConfidence !== true) {
      violations.push({ code: "sparse-inp-must-be-low-confidence" });
    }
  }
  if ((metrics.get("CLS")?.sampleCount ?? 0) < 1 || (metrics.get("INP")?.sampleCount ?? 0) < 1) {
    violations.push({ code: "cls-and-inp-samples-required" });
  }

  const delivery = evidence.delivery;
  if (
    !positiveInteger(delivery?.uniqueEvents) ||
    delivery.acceptedUniqueEvents !== delivery.uniqueEvents ||
    !positiveInteger(delivery?.batchCount) ||
    delivery.acceptedBatchCount !== delivery.batchCount ||
    delivery.permanentRejects !== 0 ||
    delivery.exhaustedRetries !== 0 ||
    delivery.unreceivedEvents !== 0
  ) {
    violations.push({ code: "event-delivery-not-fully-reconciled" });
  }
  if (delivery?.uniqueEvents > manifest.eventBudget?.maxTotalEvents || delivery?.batchCount > manifest.eventBudget?.maxTotalBatches) {
    violations.push({ code: "evidence-exceeds-event-budget" });
  }
  if (evidence.dashboardCapture?.telemetryInterceptStatus !== 202) violations.push({ code: "dashboard-capture-not-isolated" });
  for (const queue of [evidence.queues?.sqs, evidence.queues?.dlq]) {
    if (!queue || [queue.visible, queue.inFlight, queue.delayed].some((value) => value !== 0)) {
      violations.push({ code: "queue-not-empty" });
      break;
    }
  }
  if (
    evidence.cleanup?.schemaAbsent !== true ||
    evidence.cleanup?.stackAbsent !== true ||
    evidence.cleanup?.remainingProjectResources !== 0
  ) {
    violations.push({ code: "cleanup-not-verified" });
  }
  for (const key of INVENTORY_KEYS) {
    if (evidence.cleanup?.inventory?.[key] !== 0) violations.push({ code: "cleanup-inventory-not-zero", resource: key });
  }
  const protectedSet = new Set(evidence.cleanup?.sharedProtected ?? []);
  for (const resource of PROTECTED_FOUNDATION) {
    if (!protectedSet.has(resource)) violations.push({ code: "shared-foundation-protection-missing", resource });
  }
}

export function verifyPerformanceSampling({ root = process.cwd(), manifest, evidence = "" }) {
  const absoluteRoot = resolve(root);
  const violations = [];
  const manifestValue = readJson(absoluteRoot, manifest, violations, "manifest-missing-or-invalid");
  if (manifestValue) {
    scanSensitiveKeys(manifestValue, "manifest", violations);
    validateManifest(manifestValue, violations);
  }
  let evidenceValue;
  if (evidence) {
    evidenceValue = readJson(absoluteRoot, evidence, violations, "evidence-missing-or-invalid");
    if (evidenceValue) {
      scanSensitiveKeys(evidenceValue, "evidence", violations);
      if (manifestValue) validateEvidence(manifestValue, evidenceValue, violations);
    }
  }
  if (manifestValue?.verificationMode === "verified-run" && !evidence) {
    violations.push({ code: "verified-run-evidence-required" });
  }
  return {
    ok: violations.length === 0,
    applicationId: manifestValue?.applicationId ?? "",
    verificationMode: manifestValue?.verificationMode ?? "unknown",
    evidenceChecked: Boolean(evidenceValue),
    violations,
  };
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) {
  try {
    const result = verifyPerformanceSampling(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
