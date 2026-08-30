import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const templatePath = new URL("../aws/evidence-verifier-template.yaml", import.meta.url);
const template = readFileSync(templatePath, "utf8");

function occurrences(pattern) {
  return template.match(pattern)?.length ?? 0;
}

test("creates only the approved shared verifier resource classes", () => {
  assert.equal(occurrences(/Type: AWS::Serverless::Function/g), 1);
  assert.equal(occurrences(/Type: AWS::Logs::LogGroup/g), 1);
  assert.equal(occurrences(/Type: AWS::IAM::Role/g), 2);
  for (const forbidden of [
    "AWS::IAM::OIDCProvider", "AWS::EC2::VPC", "AWS::EC2::NatGateway", "AWS::RDS::",
    "AWS::ECS::", "AWS::ElasticLoadBalancingV2::", "AWS::ApiGateway", "AWS::S3::Bucket",
  ]) {
    assert.ok(!template.includes(forbidden), forbidden);
  }
});

test("pins the Lambda runtime, capacity, timeout, log group, and non-VPC boundary", () => {
  for (const expected of [
    "Runtime: python3.13",
    "MemorySize: 128",
    "Timeout: 10",
    "ReservedConcurrentExecutions: 1",
    "CodeUri: evidence-verifier/runtime/",
    "Role: !GetAtt VerifierExecutionRole.Arn",
    "DependsOn: VerifierLogGroup",
    "RetentionInDays: 7",
    "DeletionPolicy: Delete",
    "UpdateReplacePolicy: Delete",
  ]) {
    assert.ok(template.includes(expected), expected);
  }
  assert.ok(!template.includes("VpcConfig:"));
  assert.ok(!template.includes("FunctionUrlConfig:"));
});

test("trusts only the existing GitHub provider and central main branch", () => {
  for (const expected of [
    "OidcProviderArn:",
    "Federated: !Ref OidcProviderArn",
    "token.actions.githubusercontent.com:aud",
    "sts.amazonaws.com",
    "token.actions.githubusercontent.com:sub",
    "repo:Tiancheng-Xu/.github:ref:refs/heads/main",
  ]) {
    assert.ok(template.includes(expected), expected);
  }
});

test("limits invocation, budget read, and runtime logging to exact resources", () => {
  for (const expected of [
    "lambda:InvokeFunction",
    "Resource: !GetAtt VerifierFunction.Arn",
    "budgets:ViewBudget",
    "arn:${AWS::Partition}:budgets::${AWS::AccountId}:budget/${BudgetName}",
    "logs:CreateLogStream",
    "logs:PutLogEvents",
    "${VerifierLogGroup.Arn}:*",
  ]) {
    assert.ok(template.includes(expected), expected);
  }
  assert.ok(!/Action:\s*["']?\*/u.test(template));
  assert.ok(!/Resource:\s*["']?\*/u.test(template));
  assert.ok(!template.includes("AdministratorAccess"));
  assert.ok(!template.includes("AWSLambdaBasicExecutionRole"));
});

test("exports the exact function and invoke role for repository variables", () => {
  assert.ok(template.includes("VerifierFunctionName:"));
  assert.ok(template.includes("VerifierInvokeRoleArn:"));
  assert.ok(template.includes("Value: !Ref VerifierFunction"));
  assert.ok(template.includes("Value: !GetAtt VerifierInvokeRole.Arn"));
});
