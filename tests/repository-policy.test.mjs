import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  inspectCommitRange,
  scanCandidateTree,
  validateRefName,
} from "../scripts/repository-policy.mjs";

const owner = {
  name: "tiancheng-Xu",
  emails: ["271251549@qq.com"],
};

const productOnlyPhrase = String.fromCodePoint(0x4f5c, 0x4e1a);
const retiredAlias = String.fromCodePoint(0x79, 0x69, 0x64, 0x65, 0x6e, 0x67);
const policyHooksPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "git-hooks",
);
const policyScript = join(policyHooksPath, "..", "repository-policy.mjs");

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function createRepository() {
  const cwd = mkdtempSync(join(tmpdir(), "repository-policy-"));
  git(cwd, "init", "-q");
  git(cwd, "config", "user.name", owner.name);
  git(cwd, "config", "user.email", owner.emails[0]);
  writeFileSync(join(cwd, "README.md"), "safe public content\n");
  git(cwd, "add", "README.md");
  git(cwd, "commit", "-qm", "initial owner commit");
  return cwd;
}

function createPushFixture() {
  const root = mkdtempSync(join(tmpdir(), "repository-policy-push-"));
  const remote = join(root, "remote.git");
  const cwd = join(root, "project");
  git(root, "init", "--bare", "-q", remote);
  git(root, "init", "-q", cwd);
  git(cwd, "config", "user.name", owner.name);
  git(cwd, "config", "user.email", owner.emails[0]);
  git(cwd, "config", "workflow.ownerName", owner.name);
  git(cwd, "config", "workflow.ownerEmail", owner.emails[0]);
  git(cwd, "config", "core.hooksPath", policyHooksPath);
  git(cwd, "remote", "add", "origin", remote);
  writeFileSync(join(cwd, "README.md"), "safe public content\n");
  git(cwd, "add", "README.md");
  git(cwd, "commit", "-qm", "initial owner commit");
  return { cwd, remote };
}

test("accepts a commit authored and committed by the configured owner", () => {
  const cwd = createRepository();
  writeFileSync(join(cwd, "README.md"), "safe update\n");
  git(cwd, "add", "README.md");
  git(cwd, "commit", "-qm", "owner update");

  assert.deepEqual(inspectCommitRange(cwd, "HEAD~1..HEAD", owner), []);
});

test("rejects automation identities in author or committer metadata", () => {
  const cwd = createRepository();
  writeFileSync(join(cwd, "README.md"), "automation update\n");
  git(cwd, "add", "README.md");
  git(
    cwd,
    "-c",
    "user.name=OpenAI Automation",
    "-c",
    "user.email=automation@example.invalid",
    "commit",
    "-qm",
    "automation update",
    "--author=Codex Worker <automation@example.invalid>",
  );

  const violations = inspectCommitRange(cwd, "HEAD~1..HEAD", owner);
  assert.ok(violations.some((item) => item.code === "author-owner-mismatch"));
  assert.ok(violations.some((item) => item.code === "committer-owner-mismatch"));
  assert.ok(violations.some((item) => item.code === "automation-identity"));
});

test("rejects automation attribution trailers even with an owner commit", () => {
  const cwd = createRepository();
  writeFileSync(join(cwd, "README.md"), "unsafe trailer\n");
  git(cwd, "add", "README.md");
  git(
    cwd,
    "commit",
    "-qm",
    "unsafe trailer\n\nCo-authored-by: Codex Worker <automation@example.invalid>",
  );

  const violations = inspectCommitRange(cwd, "HEAD~1..HEAD", owner);
  assert.ok(violations.some((item) => item.code === "automation-attribution"));
});

test("accepts a product branch and rejects automation or retired aliases", () => {
  assert.deepEqual(validateRefName("refs/heads/personal-ai-agent"), []);
  assert.ok(validateRefName("refs/heads/codex/agent-ui").length > 0);
  assert.ok(validateRefName(`refs/heads/${retiredAlias}-agent`).length > 0);
});

test("scans the full tracked tree and reports configured public wording", () => {
  const cwd = createRepository();
  writeFileSync(join(cwd, "legacy.md"), `public ${productOnlyPhrase}\n`);
  git(cwd, "add", "legacy.md");

  const violations = scanCandidateTree(cwd, {
    blockedTerms: [productOnlyPhrase, retiredAlias],
  });

  assert.deepEqual(
    violations.map((item) => item.path),
    ["legacy.md"],
  );
  assert.equal(violations[0].code, "blocked-public-content");
});

test("scans configured build output even when it is not tracked", () => {
  const cwd = createRepository();
  mkdirSync(join(cwd, "dist"));
  writeFileSync(join(cwd, "dist", "index.html"), `public ${retiredAlias}\n`);

  const violations = scanCandidateTree(cwd, {
    blockedTerms: [productOnlyPhrase, retiredAlias],
    buildOutputPaths: ["dist"],
  });

  assert.ok(
    violations.some(
      (item) => item.path === "dist/index.html" && item.scope === "build-output",
    ),
  );
});

test("does not scan dependencies, vendor files, licenses, or binary data", () => {
  const cwd = createRepository();
  mkdirSync(join(cwd, "node_modules"));
  mkdirSync(join(cwd, "vendor"));
  writeFileSync(join(cwd, "node_modules", "dependency.js"), productOnlyPhrase);
  writeFileSync(join(cwd, "vendor", "library.txt"), retiredAlias);
  writeFileSync(join(cwd, "LICENSE"), productOnlyPhrase);
  writeFileSync(join(cwd, "image.bin"), Buffer.from([0, 1, 2, 3, 0, 255]));
  git(cwd, "add", "-f", "node_modules", "vendor", "LICENSE", "image.bin");

  assert.deepEqual(
    scanCandidateTree(cwd, { blockedTerms: [productOnlyPhrase, retiredAlias] }),
    [],
  );
});

test("pre-push hook allows a compliant owner tree", () => {
  const { cwd } = createPushFixture();
  const result = spawnSync("git", ["push", "-u", "origin", "HEAD"], {
    cwd,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout + result.stderr, /Repository policy passed/);
});

test("pre-push hook blocks configured public wording", () => {
  const { cwd } = createPushFixture();
  git(cwd, "push", "-u", "origin", "HEAD");
  writeFileSync(join(cwd, "README.md"), `unsafe ${productOnlyPhrase}\n`);
  git(cwd, "add", "README.md");
  git(cwd, "commit", "-qm", "unsafe content");

  const result = spawnSync("git", ["push", "origin", "HEAD"], {
    cwd,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /blocked-public-content/);
  assert.doesNotMatch(result.stderr, new RegExp(productOnlyPhrase));
});

test("audit mode checks the uncommitted tree and requires a remote caller", () => {
  const cwd = createRepository();
  const missingCaller = spawnSync(
    "node",
    [
      policyScript,
      "--mode",
      "audit",
      "--root",
      cwd,
      "--owner-name",
      owner.name,
      "--owner-email",
      owner.emails[0],
      "--require-caller",
    ],
    { cwd, encoding: "utf8" },
  );
  assert.notEqual(missingCaller.status, 0);
  assert.match(missingCaller.stderr, /missing-policy-caller/);

  mkdirSync(join(cwd, ".github", "workflows"), { recursive: true });
  writeFileSync(
    join(cwd, ".github", "workflows", "repository-policy.yml"),
    "jobs:\n  policy:\n    uses: Tiancheng-Xu/.github/.github/workflows/verify-repository-policy.yml@main\n",
  );
  writeFileSync(join(cwd, "untracked.md"), `unsafe ${productOnlyPhrase}\n`);

  const unsafeTree = spawnSync(
    "node",
    [
      policyScript,
      "--mode",
      "audit",
      "--root",
      cwd,
      "--owner-name",
      owner.name,
      "--owner-email",
      owner.emails[0],
      "--require-caller",
    ],
    { cwd, encoding: "utf8" },
  );
  assert.notEqual(unsafeTree.status, 0);
  assert.match(unsafeTree.stderr, /blocked-public-content/);
  assert.doesNotMatch(unsafeTree.stderr, new RegExp(productOnlyPhrase));
});
