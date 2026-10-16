import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { AI_ENGINEERING_REVIEW_PATH, scanCandidateTree } from "../scripts/repository-policy.mjs";
import { aiEngineeringReviewViolations } from "../scripts/ai-engineering-policy.mjs";

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

const toolingReferences = [
  ["agent-capabilities.json", JSON.stringify({ runtime: "no-new-runtime", automaticExecution: false, tools: [] })],
  ["docs/agent-interface.md", "# Existing CLI and Action verification contracts\n"],
];

for (const [path, content] of toolingReferences) {
  test(`does not mistake a tooling reference for AI product code: ${path}`, () => {
    const root = repository();
    write(root, path, content);
    assert.deepEqual(scanCandidateTree(root).filter((item) => item.code.startsWith("ai-engineering-")), []);
  });

  test(`still scans a tooling reference for blocked public content: ${path}`, () => {
    const root = repository();
    write(root, path, String.fromCodePoint(0x4f5c, 0x4e1a));
    assert.ok(scanCandidateTree(root).some((item) => item.path === path && !item.code.startsWith("ai-engineering-")));
  });

  for (const aiContent of [
    '{"dependencies":{"@langchain/core":"1.0.0"}}',
    'import { RunnableLambda } from "@langchain/core/runnables";\n',
  ]) {
    test(`requires a contract for AI dependency or import content in ${path}: ${aiContent.trim()}`, () => {
      const root = repository();
      write(root, path, aiContent);
      assert.ok(scanCandidateTree(root).some((item) => item.code === "ai-engineering-review-contract-missing"));
    });
  }
}

for (const [path, content] of [
  ...["agent-capabilities.js", "agent-capabilities.py", "docs/agent-interface.js", "docs/agent-interface.py",
    "agent-capabilities.json.ts", "nested/agent-capabilities.json", "src/agent.ts", "agents/config.json", "rag/config.yaml"]
    .map((path) => [path, "Product runtime or configuration\n"]),
  ["package.json", '{"dependencies":{"@langchain/core":"1.0.0"}}'],
  ["src/main.ts", 'import { RunnableLambda } from "@langchain/core/runnables";\n'],
  ["src/main.js", 'const runtime = require("mastra");\n'],
  ["src/main.mjs", 'const runtime = import("ollama");\n'],
]) {
  test(`tooling references do not exempt product paths, dependencies or imports: ${path}`, () => {
    const root = repository();
    for (const [referencePath, referenceContent] of toolingReferences) write(root, referencePath, referenceContent);
    write(root, path, content);
    assert.ok(scanCandidateTree(root).some((item) => item.code === "ai-engineering-review-contract-missing"));
  });
}

test("tooling references do not suppress validation of an existing contract", () => {
  const root = repository();
  for (const [path, content] of toolingReferences) write(root, path, content);
  write(root, AI_ENGINEERING_REVIEW_PATH, "{}");
  assert.ok(scanCandidateTree(root).some((item) => item.code === "ai-engineering-review-schema-invalid"));
});

test("unreadable tooling references still require a contract", () => {
  for (const [path] of toolingReferences) {
    assert.deepEqual(aiEngineeringReviewViolations({
      paths: [path],
      read: () => { throw new Error("unreadable reference"); },
      isExcluded: () => false,
      isNonProduct: () => false,
    }), [{ code: "ai-engineering-review-contract-missing", path: AI_ENGINEERING_REVIEW_PATH }]);
  }
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
