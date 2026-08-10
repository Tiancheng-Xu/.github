import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { REPOSITORY_POLICY_CALLER } from "../scripts/repository-policy.mjs";

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
const callerWorkflow = readFileSync(
  ".github/workflows/repository-policy.yml",
  "utf8",
);

test("central repository installs the byte-for-byte canonical caller", () => {
  assert.equal(callerWorkflow, REPOSITORY_POLICY_CALLER);
});

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

test("reusable workflow fixes the repository owner identity centrally", () => {
  assert.doesNotMatch(workflow, /^\s{6}owner-name:\s*$/m);
  assert.doesNotMatch(workflow, /^\s{6}owner-emails:\s*$/m);
  assert.match(workflow, /owner-name:\s*tiancheng-Xu/);
  assert.doesNotMatch(workflow, /@qq\.com/);
  assert.doesNotMatch(sharedProjectWorkflow, /@qq\.com/);
});

test("reusable workflow computes a commit range and invokes the shared action", () => {
  assert.match(workflow, /id:\s*commit-range/);
  assert.match(workflow, /github\.event\.pull_request\.base\.sha/);
  assert.match(workflow, /github\.event\.before/);
  assert.match(workflow, /github\.event\.repository\.default_branch/);
  assert.match(workflow, /git merge-base/);
  assert.match(workflow, /echo "range=\$HEAD_SHA"/);
  assert.match(
    workflow,
    /uses:\s*Tiancheng-Xu\/\.github\/\.github\/actions\/verify-repository-policy@main/,
  );
  assert.match(workflow, /commit-range:\s*\$\{\{ steps\.commit-range\.outputs\.range \}\}/);
  assert.doesNotMatch(workflow, /^\s{6}build-output-paths:\s*$/m);
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
