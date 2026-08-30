import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/aws-evidence-verifier.yml", import.meta.url),
  "utf8",
);

test("workflow validates sanitized OIDC claims before assuming the AWS role", () => {
  const claimGate = workflow.indexOf("Verify sanitized OIDC claims");
  const credentialStep = workflow.indexOf("Configure short-lived AWS identity");

  assert.ok(claimGate >= 0);
  assert.ok(credentialStep > claimGate);
  assert.match(
    workflow,
    /EXPECTED_OIDC_SUB: repo:Tiancheng-Xu@44307608\/\.github@1328761732:ref:refs\/heads\/main/,
  );
  assert.match(workflow, /ACTIONS_ID_TOKEN_REQUEST_TOKEN/);
  assert.match(workflow, /os\.environ\["TOKEN"\]\.split\("\."\)\[1\]/);
  assert.doesNotMatch(workflow, /echo\s+"?\$TOKEN/);
});
