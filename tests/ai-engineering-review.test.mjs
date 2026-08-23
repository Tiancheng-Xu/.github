import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { AI_ENGINEERING_REVIEW_PATH, scanCandidateTree } from "../scripts/repository-policy.mjs";

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function repository() {
  const root = mkdtempSync(join(tmpdir(), "ai-engineering-policy-"));
  git(root, "init", "-q");
  git(root, "config", "user.name", "Tiancheng-Xu");
  git(root, "config", "user.email", "owner@example.test");
  return root;
}

function write(root, path, content) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
  git(root, "add", path);
}

function completeContract() {
  return {
    schemaVersion: 1,
    aiEngineering: true,
    successCriteria: [
      {
        id: "build",
        metric: "build exit code",
        threshold: 0,
        gateType: "deterministic",
        evidence: "docs/evidence/testing/ai-gates.json",
      },
    ],
    deterministicGates: [
      { id: "build", check: "npm run build", evidence: "docs/evidence/testing/ai-gates.json" },
    ],
    llmJudge: { enabled: false, canOverrideDeterministic: false },
    rag: { enabled: false },
    dag: { enabled: false },
    serviceLevels: {
      qualityThreshold: 0.9,
      ttftMs: 1200,
      p95LatencyMs: 5000,
      costBudget: "USD 0.10 per run",
      reliabilityThreshold: 0.99,
    },
    feedback: {
      clean: true,
      deduplicate: true,
      redact: true,
      frozenEvaluationSet: true,
      releaseRegressionGate: true,
    },
    proof: [
      {
        kind: "test",
        location: "docs/evidence/testing/ai-gates.json",
        proves: "deterministic gates passed",
        status: "verified-local",
      },
    ],
  };
}

test("requires a contract when product dependencies enable AI engineering", () => {
  const root = repository();
  write(root, "package.json", JSON.stringify({ dependencies: { "@langchain/core": "1.0.0" } }));
  assert.ok(
    scanCandidateTree(root).some((item) => item.code === "ai-engineering-review-contract-missing"),
  );
});

test("does not trigger from allowlisted documentation", () => {
  const root = repository();
  write(root, "README.md", "LangGraph overview\n");
  write(root, "docs/architecture/agent.md", "Mastra and RAG architecture\n");
  assert.deepEqual(
    scanCandidateTree(root).filter((item) => item.code.startsWith("ai-engineering-")),
    [],
  );
});

test("accepts a complete AI engineering review contract", () => {
  const root = repository();
  write(root, "package.json", JSON.stringify({ dependencies: { "@langchain/core": "1.0.0" } }));
  write(root, AI_ENGINEERING_REVIEW_PATH, JSON.stringify(completeContract()));
  assert.deepEqual(
    scanCandidateTree(root).filter((item) => item.code.startsWith("ai-engineering-")),
    [],
  );
});

test("fails closed when the AI engineering contract is incomplete", () => {
  const root = repository();
  write(root, "src/agent.ts", 'import { RunnableLambda } from "@langchain/core/runnables";\n');
  write(root, AI_ENGINEERING_REVIEW_PATH, JSON.stringify({ schemaVersion: 1, aiEngineering: true }));
  const codes = scanCandidateTree(root)
    .filter((item) => item.code.startsWith("ai-engineering-"))
    .map((item) => item.code);
  assert.ok(codes.includes("ai-engineering-review-field-missing"));
  assert.ok(codes.includes("ai-engineering-review-field-invalid"));
});
