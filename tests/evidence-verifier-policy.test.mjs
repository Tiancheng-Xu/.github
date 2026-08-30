import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyEvidenceVerifierManifest } from "../scripts/evidence-verifier-policy.mjs";

const SHA = "a".repeat(40);

function project(index, overrides = {}) {
  return {
    projectId: `project-${index}`,
    repository: `Tiancheng-Xu/project-${index}`,
    headSha: SHA,
    deliveryStatus: "completed",
    productionUrl: `https://project-${index}.baby2b.online/`,
    evidenceUrl: `https://project-${index}.baby2b.online/evidence/`,
    checks: ["repository-commit", "production-page", "evidence-page"],
    expectedMarkers: {
      production: [`Project ${index}`],
      evidence: ["工作证明"],
    },
    ...overrides,
  };
}

function manifest(projects = Array.from({ length: 6 }, (_, index) => project(index + 1))) {
  return { schemaVersion: "portfolio-aws-verifier/v1", projects };
}

function fixture(value) {
  const root = mkdtempSync(join(tmpdir(), "evidence-verifier-policy-"));
  writeFileSync(join(root, "manifest.json"), JSON.stringify(value));
  return root;
}

test("accepts the six-project fixed verifier manifest", () => {
  const root = fixture(manifest());
  const result = verifyEvidenceVerifierManifest({ root, manifest: "manifest.json" });
  assert.equal(result.ok, true, JSON.stringify(result.violations));
  assert.equal(result.projects.length, 6);
});

test("accepts a truthful project without an independent production URL", () => {
  const projects = manifest().projects;
  projects[5] = project(6, {
    productionUrl: null,
    checks: ["repository-commit", "evidence-page"],
    expectedMarkers: { production: [], evidence: ["工作证明"] },
  });
  const result = verifyEvidenceVerifierManifest({ root: fixture(manifest(projects)), manifest: "manifest.json" });
  assert.equal(result.ok, true, JSON.stringify(result.violations));
});

test("rejects unknown fields, duplicate projects, malformed SHAs, and missing evidence markers", () => {
  const projects = manifest().projects;
  projects[1].projectId = projects[0].projectId;
  projects[2].headSha = "short";
  projects[3].unexpected = true;
  projects[4].expectedMarkers.evidence = [];
  const result = verifyEvidenceVerifierManifest({ root: fixture(manifest(projects)), manifest: "manifest.json" });
  assert.equal(result.ok, false);
  for (const code of ["duplicate-project-id", "invalid-head-sha", "unknown-project-key", "evidence-marker-required"]) {
    assert.ok(result.violations.some((violation) => violation.code === code), code);
  }
});

test("rejects arbitrary hosts, IP literals, non-standard ports, and credential-shaped fields", () => {
  const projects = manifest().projects;
  projects[0].productionUrl = "https://example.com/";
  projects[1].evidenceUrl = "https://127.0.0.1/evidence/";
  projects[2].productionUrl = "https://project-3.baby2b.online:8443/";
  projects[3].apiToken = "must-not-enter-the-manifest";
  projects[4].evidenceUrl = "https://baby2b.online/evidence/project-5/?access=dynamic";
  const result = verifyEvidenceVerifierManifest({ root: fixture(manifest(projects)), manifest: "manifest.json" });
  assert.equal(result.ok, false);
  assert.ok(result.violations.filter(({ code }) => code === "url-not-allowed").length >= 4);
  assert.ok(result.violations.some(({ code }) => code === "sensitive-field-forbidden"));
});

test("the tracked portfolio manifest stays valid and fixed at six projects", () => {
  const result = verifyEvidenceVerifierManifest({
    root: process.cwd(),
    manifest: "config/portfolio-aws-verifier.json",
  });
  assert.equal(result.ok, true, JSON.stringify(result.violations));
  assert.equal(result.projects.length, 6);
});
