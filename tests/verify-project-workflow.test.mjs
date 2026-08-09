import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/verify-project.yml", "utf8");

test("accepts an optional Baby2B publishing manifest path", () => {
  assert.match(workflow, /^\s{6}publish-config-path:\s*$/m);
  assert.match(workflow, /^\s{8}required: false\s*$/m);
  assert.match(workflow, /^\s{8}default: ""\s*$/m);
  assert.match(workflow, /^\s{8}type: string\s*$/m);
});

test("validates the manifest through the shared local action", () => {
  assert.match(workflow, /name: Validate Baby2B publishing contract/);
  assert.match(
    workflow,
    /uses: Tiancheng-Xu\/\.github\/\.github\/actions\/verify-baby2b-publish@main/,
  );
  assert.match(workflow, /config-path: \$\{\{ inputs\['publish-config-path'\] \}\}/);
});

test("skips publishing validation when a repository has no manifest", () => {
  assert.match(
    workflow,
    /if: inputs\['publish-config-path'\] != ''/,
  );
});

test("shared verification never deploys or writes across repositories", () => {
  assert.doesNotMatch(workflow, /wrangler|cloudflare|pages deploy/i);
  assert.doesNotMatch(workflow, /CLOUDFLARE_[A-Z_]+/);
  assert.doesNotMatch(workflow, /contents:\s*write/);
  assert.doesNotMatch(workflow, /repository-dispatch|workflow-dispatch/i);
});
