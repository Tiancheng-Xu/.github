import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyPerformanceSampling } from "../scripts/performance-sampling-policy.mjs";

const requiredMetrics = [
  "LCP", "CLS", "INP", "FCP", "TTFB", "navigation.dns", "navigation.tcp",
  "navigation.tls", "navigation.request_wait", "navigation.download",
  "navigation.dom_ready", "navigation.window_load", "route.duration", "resource.duration",
];

function manifest() {
  return {
    schemaVersion: "performance-sampling/v1",
    applicationId: "sample-app",
    verificationMode: "contract-only",
    allowedLocalOrigins: ["http://127.0.0.1:4173"],
    metrics: { requiredCoverage: requiredMetrics, allowedUnavailable: [] },
    eventBudget: {
      maxEventsPerRoute: 30,
      maxTotalEvents: 100,
      maxTotalBatches: 20,
      maxAttemptsPerEvent: 3,
      attemptTimeoutMs: 3000,
      lifecycleDrainMs: 15000,
    },
    delivery: {
      identityKey: "eventId",
      requireAllUniqueEventsAccepted: true,
      dashboardCaptureMode: "intercept-202",
    },
    safety: { forbiddenSampleActions: ["chain-transaction", "wallet-signature", "synthetic-layout-shift", "synthetic-error"] },
    routes: [{
      path: "/",
      readiness: { selector: "main h1", text: "Sample" },
      eventBudget: 30,
      allowedMetrics: requiredMetrics,
      interactions: [{ id: "toggle-details", kind: "toggle", selector: "[data-sample-toggle]", sideEffect: "none", expectedMetrics: ["INP"] }],
    }],
  };
}

function evidence() {
  const context = {
    unit: "ms", route: "/", environment: "evidence", buildVersion: "abc123",
    window: "controlled-run", source: "controlled-browser", capturedAt: "2026-08-29T00:00:00Z", freshness: "run-bound",
  };
  return {
    schemaVersion: "performance-sampling-evidence/v1",
    applicationId: "sample-app",
    status: "verified-and-cleaned",
    provenance: "controlled-browser",
    run: { id: "123", artifactId: "456", headSha: "a".repeat(40) },
    metrics: requiredMetrics.map((name) => ({
      name,
      ...context,
      unit: name === "CLS" ? "score" : "ms",
      sampleCount: name === "INP" ? 1 : 5,
      p50: name === "CLS" ? 0 : 10,
      p75: name === "CLS" ? 0 : 12,
      p95: name === "CLS" ? 0 : 15,
      ...(name === "INP" ? { lowConfidence: true } : {}),
    })),
    delivery: { uniqueEvents: 85, acceptedUniqueEvents: 85, batchCount: 14, acceptedBatchCount: 14, permanentRejects: 0, exhaustedRetries: 0, unreceivedEvents: 0 },
    dashboardCapture: { telemetryInterceptStatus: 202 },
    queues: { sqs: { visible: 0, inFlight: 0, delayed: 0 }, dlq: { visible: 0, inFlight: 0, delayed: 0 } },
    cleanup: {
      schemaAbsent: true,
      stackAbsent: true,
      remainingProjectResources: 0,
      inventory: Object.fromEntries([
        "ecr", "ecsClusters", "ecsTasks", "taskDefinitions", "sqsAndDlq", "apiGateway",
        "lambda", "cloudWatchLogGroups", "secrets", "securityGroups", "securityGroupIngress", "iamRoles",
      ].map((key) => [key, 0])),
      sharedProtected: ["vpc", "nat", "rds", "oidc", "artifact", "foundation"],
    },
  };
}

function fixture(manifestValue = manifest(), evidenceValue) {
  const root = mkdtempSync(join(tmpdir(), "performance-sampling-policy-"));
  writeFileSync(join(root, "manifest.json"), JSON.stringify(manifestValue));
  if (evidenceValue) writeFileSync(join(root, "evidence.json"), JSON.stringify(evidenceValue));
  return root;
}

test("accepts a bounded contract-only Journey Manifest", () => {
  const root = fixture();
  assert.equal(verifyPerformanceSampling({ root, manifest: "manifest.json" }).ok, true);
});

test("blocks remote origins, missing INP interaction, and unsafe sample actions", () => {
  const value = manifest();
  value.allowedLocalOrigins = ["https://example.com"];
  value.routes[0].interactions = [];
  value.safety.forbiddenSampleActions = [];
  const result = verifyPerformanceSampling({ root: fixture(value), manifest: "manifest.json" });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some(({ code }) => code === "non-local-origin-forbidden"));
  assert.ok(result.violations.some(({ code }) => code === "representative-inp-interaction-required"));
  assert.ok(result.violations.some(({ code }) => code === "forbidden-action-guard-missing"));
});

test("accepts fully reconciled controlled-browser Evidence with truthful zero CLS", () => {
  const manifestValue = manifest();
  manifestValue.verificationMode = "verified-run";
  const root = fixture(manifestValue, evidence());
  const result = verifyPerformanceSampling({ root, manifest: "manifest.json", evidence: "evidence.json" });
  assert.equal(result.ok, true, JSON.stringify(result.violations));
  assert.equal(result.evidenceChecked, true);
});

test("blocks sparse INP without confidence, incomplete delivery, queues, and cleanup", () => {
  const manifestValue = manifest();
  manifestValue.verificationMode = "verified-run";
  const evidenceValue = evidence();
  delete evidenceValue.metrics.find(({ name }) => name === "INP").lowConfidence;
  evidenceValue.delivery.unreceivedEvents = 1;
  evidenceValue.queues.sqs.inFlight = 1;
  evidenceValue.cleanup.inventory.lambda = 1;
  const root = fixture(manifestValue, evidenceValue);
  const result = verifyPerformanceSampling({ root, manifest: "manifest.json", evidence: "evidence.json" });
  assert.equal(result.ok, false);
  for (const code of ["sparse-inp-must-be-low-confidence", "event-delivery-not-fully-reconciled", "queue-not-empty", "cleanup-inventory-not-zero"]) {
    assert.ok(result.violations.some((violation) => violation.code === code));
  }
});

test("allows the Secrets Manager cleanup count but rejects credential-shaped evidence", () => {
  const manifestValue = manifest();
  manifestValue.verificationMode = "verified-run";
  const evidenceValue = evidence();
  evidenceValue.run.apiToken = "must-not-enter-evidence";
  const root = fixture(manifestValue, evidenceValue);
  const result = verifyPerformanceSampling({ root, manifest: "manifest.json", evidence: "evidence.json" });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some(({ code, path }) => code === "sensitive-field-forbidden" && path === "evidence.run.apiToken"));
  assert.ok(!result.violations.some(({ path }) => path === "evidence.cleanup.inventory.secrets"));
});
