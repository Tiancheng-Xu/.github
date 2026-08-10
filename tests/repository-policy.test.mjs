import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

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

