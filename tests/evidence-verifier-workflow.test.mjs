import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/aws-evidence-verifier.yml", import.meta.url), "utf8");

test("exposes only a manual fixed-manifest trigger with bounded concurrency", () => {
  assert.ok(workflow.includes("workflow_dispatch:"));
  assert.ok(!workflow.includes("inputs:"));
  assert.ok(workflow.includes("max-parallel: 1"));
  assert.ok(workflow.includes("fail-fast: false"));
  assert.ok(workflow.includes("group: shared-portfolio-evidence-verifier"));
  assert.ok(workflow.includes("cancel-in-progress: false"));
});

test("validates the manifest before obtaining an AWS identity", () => {
  const policy = workflow.indexOf("scripts/evidence-verifier-policy.mjs");
  const credentials = workflow.indexOf("aws-actions/configure-aws-credentials");
  assert.ok(policy >= 0);
  assert.ok(credentials > policy);
  assert.ok(workflow.includes("config/portfolio-aws-verifier.json"));
  assert.ok(workflow.includes("fromJSON(needs.prepare.outputs.projects)"));
});

test("uses short-lived OIDC and repository variables instead of credentials", () => {
  assert.ok(workflow.includes("contents: read"));
  assert.ok(workflow.includes("id-token: write"));
  assert.ok(workflow.includes("vars.AWS_EVIDENCE_VERIFIER_ROLE_ARN"));
  assert.ok(workflow.includes("vars.AWS_EVIDENCE_VERIFIER_FUNCTION_NAME"));
  assert.ok(!workflow.includes("secrets."));
  assert.ok(!workflow.includes("AWS_ACCESS_KEY_ID"));
  assert.ok(!workflow.includes("AWS_SECRET_ACCESS_KEY"));
});

test("fails before invocation when the exact budget crosses its hard thresholds", () => {
  const budget = workflow.indexOf("aws budgets describe-budget");
  const invoke = workflow.indexOf("aws lambda invoke");
  assert.ok(budget >= 0 && invoke > budget);
  assert.ok(workflow.includes("My Monthly Cost Budget"));
  assert.ok(workflow.includes("actual >= 34"));
  assert.ok(workflow.includes("forecast >= 40"));
  assert.ok(workflow.includes("aws sts get-caller-identity"));
});

test("builds file-based payloads, validates responses, and always retains evidence for seven days", () => {
  assert.ok(workflow.includes("--payload fileb://payload.json"));
  assert.ok(workflow.includes("portfolio-aws-verifier-evidence/v1"));
  assert.ok(workflow.includes("actions/upload-artifact"));
  assert.ok(workflow.includes("if: always()"));
  assert.ok(workflow.includes("retention-days: 7"));
  assert.ok(workflow.includes("aws-verifier-${{ matrix.project.projectId }}-${{ github.run_id }}"));
  assert.ok(!workflow.includes("--payload '${{"));
});
