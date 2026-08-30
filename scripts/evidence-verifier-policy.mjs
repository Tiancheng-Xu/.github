#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const TOP_LEVEL_KEYS = new Set(["schemaVersion", "projects"]);
const PROJECT_KEYS = new Set([
  "projectId", "repository", "headSha", "deliveryStatus", "productionUrl",
  "evidenceUrl", "checks", "expectedMarkers",
]);
const CHECKS = new Set(["repository-commit", "production-page", "evidence-page"]);
const DELIVERY_STATUSES = new Set(["completed", "in-progress"]);
const SENSITIVE_KEY = /(?:authorization|cookie|token|secret|private.?key|password|prompt|model.?weight)/iu;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function scanSensitiveKeys(value, path, violations) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanSensitiveKeys(entry, `${path}[${index}]`, violations));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    const fieldPath = `${path}.${key}`;
    if (SENSITIVE_KEY.test(key)) violations.push({ code: "sensitive-field-forbidden", path: fieldPath });
    scanSensitiveKeys(entry, fieldPath, violations);
  }
}

function allowedUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const allowedHost = hostname === "baby2b.online" || hostname.endsWith(".baby2b.online") || hostname === "github.com";
    return url.protocol === "https:"
      && allowedHost
      && isIP(hostname) === 0
      && (url.port === "" || url.port === "443")
      && url.username === ""
      && url.password === ""
      && url.search === ""
      && url.hash === "";
  } catch {
    return false;
  }
}

function validateMarkers(markers, path, required, violations) {
  if (!Array.isArray(markers) || markers.some((marker) => typeof marker !== "string" || marker.trim() === "" || marker.length > 120)) {
    violations.push({ code: "invalid-markers", path });
    return;
  }
  if (required && markers.length === 0) violations.push({ code: `${path.endsWith("evidence") ? "evidence" : "production"}-marker-required`, path });
}

function validateProject(project, index, violations) {
  const path = `manifest.projects[${index}]`;
  if (!isObject(project)) {
    violations.push({ code: "invalid-project", path });
    return;
  }
  for (const key of Object.keys(project)) {
    if (!PROJECT_KEYS.has(key)) violations.push({ code: "unknown-project-key", path: `${path}.${key}` });
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(project.projectId ?? "")) violations.push({ code: "invalid-project-id", path: `${path}.projectId` });
  if (!/^Tiancheng-Xu\/[A-Za-z0-9._-]+$/u.test(project.repository ?? "")) violations.push({ code: "invalid-repository", path: `${path}.repository` });
  if (!/^[a-f0-9]{40}$/u.test(project.headSha ?? "")) violations.push({ code: "invalid-head-sha", path: `${path}.headSha` });
  if (!DELIVERY_STATUSES.has(project.deliveryStatus)) violations.push({ code: "invalid-delivery-status", path: `${path}.deliveryStatus` });
  if (project.productionUrl !== null && !allowedUrl(project.productionUrl)) violations.push({ code: "url-not-allowed", path: `${path}.productionUrl` });
  if (!allowedUrl(project.evidenceUrl)) violations.push({ code: "url-not-allowed", path: `${path}.evidenceUrl` });
  if (!Array.isArray(project.checks) || project.checks.some((check) => !CHECKS.has(check)) || new Set(project.checks).size !== project.checks.length) {
    violations.push({ code: "invalid-checks", path: `${path}.checks` });
  } else {
    if (!project.checks.includes("repository-commit") || !project.checks.includes("evidence-page")) violations.push({ code: "required-check-missing", path: `${path}.checks` });
    const hasProductionCheck = project.checks.includes("production-page");
    if ((project.productionUrl === null && hasProductionCheck) || (project.productionUrl !== null && !hasProductionCheck)) {
      violations.push({ code: "production-check-mismatch", path: `${path}.checks` });
    }
  }
  if (!isObject(project.expectedMarkers) || Object.keys(project.expectedMarkers).some((key) => !["production", "evidence"].includes(key))) {
    violations.push({ code: "invalid-marker-map", path: `${path}.expectedMarkers` });
  } else {
    validateMarkers(project.expectedMarkers.production, `${path}.expectedMarkers.production`, project.productionUrl !== null, violations);
    validateMarkers(project.expectedMarkers.evidence, `${path}.expectedMarkers.evidence`, true, violations);
    if (project.productionUrl === null && project.expectedMarkers.production?.length !== 0) {
      violations.push({ code: "production-marker-without-url", path: `${path}.expectedMarkers.production` });
    }
  }
}

function readManifest(root, manifest, violations) {
  const absoluteRoot = resolve(root);
  const absoluteManifest = resolve(absoluteRoot, manifest);
  if (absoluteManifest !== absoluteRoot && !absoluteManifest.startsWith(`${absoluteRoot}${sep}`)) {
    violations.push({ code: "manifest-path-outside-root" });
    return null;
  }
  try {
    return JSON.parse(readFileSync(absoluteManifest, "utf8"));
  } catch {
    violations.push({ code: "manifest-missing-or-invalid" });
    return null;
  }
}

export function verifyEvidenceVerifierManifest({ root = process.cwd(), manifest }) {
  const violations = [];
  const value = readManifest(root, manifest, violations);
  if (!isObject(value)) return { ok: false, violations, projects: [] };
  scanSensitiveKeys(value, "manifest", violations);
  for (const key of Object.keys(value)) {
    if (!TOP_LEVEL_KEYS.has(key)) violations.push({ code: "unknown-top-level-key", path: `manifest.${key}` });
  }
  if (value.schemaVersion !== "portfolio-aws-verifier/v1") violations.push({ code: "unsupported-schema-version" });
  if (!Array.isArray(value.projects) || value.projects.length !== 6) {
    violations.push({ code: "six-project-manifest-required" });
  } else {
    value.projects.forEach((project, index) => validateProject(project, index, violations));
    const ids = value.projects.map(({ projectId }) => projectId);
    ids.forEach((id, index) => {
      if (ids.indexOf(id) !== index) violations.push({ code: "duplicate-project-id", path: `manifest.projects[${index}].projectId` });
    });
  }
  return { ok: violations.length === 0, violations, projects: Array.isArray(value.projects) ? value.projects : [] };
}

function parseArgs(argv) {
  const options = { root: process.cwd(), manifest: "" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--root") options.root = argv[++index] ?? "";
    else if (argv[index] === "--manifest") options.manifest = argv[++index] ?? "";
  }
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const options = parseArgs(process.argv.slice(2));
  const result = options.manifest
    ? verifyEvidenceVerifierManifest(options)
    : { ok: false, violations: [{ code: "manifest-argument-required" }], projects: [] };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}
