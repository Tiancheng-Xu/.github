import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const action = readFileSync(
  ".github/actions/verify-repository-policy/action.yml",
  "utf8",
);
const workflow = readFileSync(
  ".github/workflows/verify-repository-policy.yml",
  "utf8",
);
const sharedProjectWorkflow = readFileSync(
  ".github/workflows/verify-project.yml",
  "utf8",
);

test("composite action invokes the central policy engine against the caller workspace", () => {
  assert.match(action, /using:\s*composite/);
  assert.match(action, /scripts\/repository-policy\.mjs/);
  assert.match(action, /--mode ci/);
  assert.match(action, /--root "\$GITHUB_WORKSPACE"/);
  assert.match(action, /owner-name:/);
  assert.match(action, /build-output-paths:/);
});

test("reusable workflow checks out full history with read-only permissions", () => {
  assert.match(workflow, /workflow_call:/);
  assert.match(workflow, /contents:\s*read/);
  assert.doesNotMatch(workflow, /contents:\s*write/);
  assert.match(workflow, /uses:\s*actions\/checkout@v4/);
  assert.match(workflow, /fetch-depth:\s*0/);
});

test("reusable workflow computes a commit range and invokes the shared action", () => {
  assert.match(workflow, /id:\s*commit-range/);
  assert.match(workflow, /github\.event\.pull_request\.base\.sha/);
  assert.match(workflow, /github\.event\.before/);
  assert.match(
    workflow,
    /uses:\s*Tiancheng-Xu\/\.github\/\.github\/actions\/verify-repository-policy@main/,
  );
  assert.match(workflow, /commit-range:\s*\$\{\{ steps\.commit-range\.outputs\.range \}\}/);
  assert.match(workflow, /build-output-paths:\s*\$\{\{ inputs\.build-output-paths \}\}/);
});

test("shared project verification runs the same policy after its production build", () => {
  const buildIndex = sharedProjectWorkflow.indexOf("name: Production build");
  const policyIndex = sharedProjectWorkflow.indexOf("name: Repository policy");
  assert.ok(buildIndex >= 0);
  assert.ok(policyIndex > buildIndex);
  assert.match(sharedProjectWorkflow, /fetch-depth:\s*0/);
  assert.match(sharedProjectWorkflow, /policy-build-output-paths:/);
  assert.match(
    sharedProjectWorkflow,
    /uses:\s*Tiancheng-Xu\/\.github\/\.github\/actions\/verify-repository-policy@main/,
  );
});

test("policy workflows never deploy or receive write permission", () => {
  for (const source of [action, workflow, sharedProjectWorkflow]) {
    assert.doesNotMatch(source, /wrangler|cloudflare|pages deploy/i);
    assert.doesNotMatch(source, /contents:\s*write/);
  }
});

