import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const template = readFileSync(
  new URL("../aws/evidence-verifier-template.yaml", import.meta.url),
  "utf8",
);
const workflow = readFileSync(
  new URL("../.github/workflows/aws-evidence-verifier.yml", import.meta.url),
  "utf8",
);

test("shared verifier uses delivery-level serialization without reserved concurrency", () => {
  assert.doesNotMatch(template, /ReservedConcurrentExecutions:/);
  assert.match(workflow, /max-parallel:\s*1/);
  assert.doesNotMatch(template, /FunctionUrlConfig:|AWS::ApiGateway|AWS::ApiGatewayV2/);
  assert.match(
    template,
    /repo:Tiancheng-Xu@44307608\/\.github@1328761732:ref:refs\/heads\/main/,
  );
});
