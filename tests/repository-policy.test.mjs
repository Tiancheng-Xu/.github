import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  inspectCommitRange,
  REPOSITORY_POLICY_CALLER,
  scanCandidateTree,
  validateRefName,
  validatePolicyCaller,
} from "../scripts/repository-policy.mjs";

const owner = {
  name: "tiancheng-Xu",
  emails: ["owner@example.invalid"],
};

const productOnlyPhrase = String.fromCodePoint(0x4f5c, 0x4e1a);
const retiredAlias = String.fromCodePoint(0x79, 0x69, 0x64, 0x65, 0x6e, 0x67);
const projectFramingPhrase = String.fromCodePoint(0x9762, 0x8bd5);
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

test("rejects arbitrary attribution trailers carrying automation identities", () => {
  const cwd = createRepository();
  writeFileSync(join(cwd, "README.md"), "unsafe review trailer\n");
  git(cwd, "add", "README.md");
  git(
    cwd,
    "commit",
    "-qm",
    "unsafe review trailer\n\nReviewed-by: Codex Worker <automation@example.invalid>",
  );

  const violations = inspectCommitRange(cwd, "HEAD~1..HEAD", owner);
  assert.ok(violations.some((item) => item.code === "automation-attribution"));
});

test("rejects normalized or continued automation trailers", () => {
  for (const message of [
    "normalized trailer\n\nAssisted-by : Codex Worker",
    "continued trailer\n\nCo-authored-by:\n Codex Worker <automation@example.invalid>",
    "custom trailer\n\nAI: Codex Worker",
  ]) {
    const cwd = createRepository();
    writeFileSync(join(cwd, "README.md"), `${message.split("\n")[0]}\n`);
    git(cwd, "add", "README.md");
    git(cwd, "commit", "-qm", message);
    const violations = inspectCommitRange(cwd, "HEAD~1..HEAD", owner);
    assert.ok(
      violations.some((item) => item.code === "automation-attribution"),
      message,
    );
  }
});

test("accepts a product branch and rejects automation or retired aliases", () => {
  assert.deepEqual(validateRefName("refs/heads/personal-ai-agent"), []);
  assert.ok(validateRefName("refs/heads/codex/agent-ui").length > 0);
  assert.ok(validateRefName(`refs/heads/${retiredAlias}-agent`).length > 0);
  assert.ok(validateRefName(`refs/heads/${productOnlyPhrase}`).length > 0);
});

test("rejects retired branch tokens at exact ref boundaries", () => {
  for (const refName of [
    "refs/heads/feature/homework",
    "refs/heads/feature.yideng",
    "refs/heads/feature_yd",
    "refs/heads/yd-feature",
    "refs/heads/Feature/YD",
  ]) {
    assert.ok(
      validateRefName(refName).some((item) => item.code === "unsafe-ref-name"),
      refName,
    );
  }
});

test("allows refs that only contain yd as part of a larger token", () => {
  for (const refName of [
    "refs/heads/feature/mydata",
    "refs/heads/feature/typed-api",
    "refs/heads/feature/hydration",
  ]) {
    assert.deepEqual(validateRefName(refName), [], refName);
  }
});

test("keeps the yd branch token out of tracked content scanning", () => {
  const cwd = createRepository();
  writeFileSync(join(cwd, "README.md"), "yd is a protocol label\n");
  git(cwd, "add", "README.md");

  assert.deepEqual(scanCandidateTree(cwd), []);
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

test("allows required Evidence, architecture, and verification material in the tracked tree", () => {
  const cwd = createRepository();
  const allowedFiles = [
    "docs/architecture/system.mmd",
    "docs/delivery/implementation-map.md",
    "docs/evidence/deployment/proof.md",
    "docs/homework/implementation-map.md",
    "docs/qa/network.md",
    "docs/superpowers/plans/delivery.md",
    "scripts/validate-homework-evidence.mjs",
    "scripts/validate-homework-evidence.test.mjs",
    "web/src/App.test.tsx",
  ];
  for (const path of allowedFiles) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), `required evidence ${productOnlyPhrase}\n`);
  }
  git(cwd, "add", ...allowedFiles);

  assert.deepEqual(
    scanCandidateTree(cwd, {
      blockedTerms: [productOnlyPhrase, retiredAlias],
    }),
    [],
  );
});

test("still blocks configured wording in product source", () => {
  const cwd = createRepository();
  mkdirSync(join(cwd, "web", "src"), { recursive: true });
  writeFileSync(
    join(cwd, "web", "src", "App.tsx"),
    `export const label = ${JSON.stringify(productOnlyPhrase)};\n`,
  );
  git(cwd, "add", "web/src/App.tsx");

  const violations = scanCandidateTree(cwd, {
    blockedTerms: [productOnlyPhrase, retiredAlias],
  });
  assert.ok(
    violations.some(
      (item) =>
        item.path === "web/src/App.tsx" && item.scope === "tracked-tree",
    ),
  );
});

test("blocks recruiting-oriented framing in project pages by default", () => {
  const cwd = createRepository();
  mkdirSync(join(cwd, "web", "src"), { recursive: true });
  writeFileSync(
    join(cwd, "web", "src", "App.tsx"),
    `export const label = ${JSON.stringify(projectFramingPhrase)};\n`,
  );
  git(cwd, "add", "web/src/App.tsx");

  const violations = scanCandidateTree(cwd);
  assert.ok(
    violations.some(
      (item) =>
        item.path === "web/src/App.tsx" &&
        item.code === "blocked-public-content",
    ),
  );
});

test("never applies the Evidence allowance to public build output", () => {
  const cwd = createRepository();
  mkdirSync(join(cwd, "dist", "docs", "evidence"), { recursive: true });
  writeFileSync(
    join(cwd, "dist", "docs", "evidence", "index.html"),
    `public ${productOnlyPhrase}\n`,
  );

  const violations = scanCandidateTree(cwd, {
    blockedTerms: [productOnlyPhrase, retiredAlias],
    buildOutputPaths: ["dist"],
  });
  assert.ok(
    violations.some(
      (item) =>
        item.path === "dist/docs/evidence/index.html" &&
        item.scope === "build-output",
    ),
  );
});

test("rejects Evidence proof cards without a real hashed asset", () => {
  const cwd = createRepository();
  const caseDir = join(cwd, "public", "cases", "demo");
  mkdirSync(join(caseDir, "assets"), { recursive: true });
  writeFileSync(
    join(caseDir, "evidence.json"),
    JSON.stringify({
      schemaVersion: 2,
      slug: "demo",
      proof: [{ id: "E01", title: "release", asset: null, lookFor: "status", proves: "deployed" }],
      assets: [],
    }),
  );
  git(cwd, "add", "public/cases/demo/evidence.json");

  assert.ok(
    scanCandidateTree(cwd).some((item) => item.code === "evidence-proof-asset-missing"),
  );
});

test("accepts Evidence proof cards backed by matching bytes and SHA-256", () => {
  const cwd = createRepository();
  const caseDir = join(cwd, "public", "cases", "demo");
  const asset = Buffer.from("real sanitized evidence\n");
  mkdirSync(join(caseDir, "assets"), { recursive: true });
  writeFileSync(join(caseDir, "assets", "release.png"), asset);
  writeFileSync(
    join(caseDir, "evidence.json"),
    JSON.stringify({
      schemaVersion: 2,
      slug: "demo",
      proof: [{ id: "E01", title: "release", asset: "release.png", lookFor: "status", proves: "deployed" }],
      assets: [{ id: "E01", file: "release.png", bytes: asset.length, sha256: "ac7dc41e1b2568f5d6186d2bd9ce64ebb093f3c4ad3508c725ad8d7108b3a8f9" }],
    }),
  );
  git(cwd, "add", "public/cases/demo");

  assert.deepEqual(
    scanCandidateTree(cwd).filter((item) => item.code.startsWith("evidence-")),
    [],
  );
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

test("blocks a configured build output path that does not exist", () => {
  const cwd = createRepository();
  const violations = scanCandidateTree(cwd, {
    blockedTerms: [productOnlyPhrase, retiredAlias],
    buildOutputPaths: ["dist"],
  });

  assert.ok(violations.some((item) => item.code === "build-output-missing"));
});

test("never scans a build output path outside the repository", () => {
  const cwd = createRepository();
  const violations = scanCandidateTree(cwd, {
    blockedTerms: [productOnlyPhrase, retiredAlias],
    buildOutputPaths: ["../outside"],
  });

  assert.ok(violations.some((item) => item.code === "unsafe-build-output-path"));
});

test("scans the staged candidate instead of a safer unstaged overwrite", () => {
  const cwd = createRepository();
  writeFileSync(join(cwd, "README.md"), `unsafe ${productOnlyPhrase}\n`);
  git(cwd, "add", "README.md");
  writeFileSync(join(cwd, "README.md"), "safe unstaged overwrite\n");

  const violations = scanCandidateTree(cwd, {
    blockedTerms: [productOnlyPhrase, retiredAlias],
  });
  assert.ok(violations.some((item) => item.code === "blocked-public-content"));
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

test("reports non-UTF-8 tracked text instead of silently skipping it", () => {
  const cwd = createRepository();
  writeFileSync(join(cwd, "legacy.txt"), Buffer.from([0x81, 0x40, 0x41]));
  git(cwd, "add", "legacy.txt");

  const violations = scanCandidateTree(cwd, {
    blockedTerms: [productOnlyPhrase, retiredAlias],
  });
  assert.ok(violations.some((item) => item.code === "content-decoding-failed"));
});

test("skips large tracked binaries with and without an early NUL", () => {
  const cwd = createRepository();
  writeFileSync(join(cwd, "large.bin"), Buffer.alloc(33 * 1024 * 1024));
  const largeNoNul = Buffer.alloc(33 * 1024 * 1024, 0xff);
  largeNoNul.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  writeFileSync(join(cwd, "large-no-nul.bin"), largeNoNul);
  git(cwd, "add", "large.bin", "large-no-nul.bin");

  const violations = scanCandidateTree(cwd, {
    blockedTerms: [productOnlyPhrase, retiredAlias],
  });
  assert.deepEqual(violations, []);
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

test("pre-push hook allows a compliant new branch on a non-empty remote", () => {
  const { cwd } = createPushFixture();
  git(cwd, "push", "-u", "origin", "HEAD");
  git(cwd, "switch", "-c", "safe-feature");
  writeFileSync(join(cwd, "README.md"), "safe feature\n");
  git(cwd, "add", "README.md");
  git(cwd, "commit", "-qm", "safe feature");

  const result = spawnSync("git", ["push", "origin", "HEAD"], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
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

test("pre-push hook validates the actual remote destination ref", () => {
  const { cwd } = createPushFixture();
  const result = spawnSync(
    "git",
    ["push", "origin", "HEAD:refs/heads/codex/unsafe"],
    { cwd, encoding: "utf8" },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unsafe-ref-name/);
});

test("new-branch push cannot hide a non-owner commit behind a local remote ref", () => {
  const { cwd } = createPushFixture();
  writeFileSync(join(cwd, "README.md"), "automation middle commit\n");
  git(cwd, "add", "README.md");
  git(
    cwd,
    "-c",
    "user.name=OpenAI Automation",
    "-c",
    "user.email=automation@example.invalid",
    "commit",
    "-qm",
    "automation middle commit",
    "--author=Codex Worker <automation@example.invalid>",
  );
  const hiddenCommit = git(cwd, "rev-parse", "HEAD");
  git(cwd, "update-ref", "refs/remotes/fake/base", hiddenCommit);
  writeFileSync(join(cwd, "README.md"), "safe owner tip\n");
  git(cwd, "add", "README.md");
  git(cwd, "commit", "-qm", "safe owner tip");

  const result = spawnSync("git", ["push", "origin", "HEAD"], {
    cwd,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /author-owner-mismatch|automation-identity/);
});

test("caller validation requires an active PR reusable-workflow job", () => {
  const cwd = createRepository();
  mkdirSync(join(cwd, ".github", "workflows"), { recursive: true });
  const reference =
    "Tiancheng-Xu/.github/.github/workflows/verify-repository-policy.yml@main";
  writeFileSync(
    join(cwd, ".github", "workflows", "comment-only.yml"),
    `# pull_request:\n#       uses: ${reference}\n`,
  );
  assert.ok(validatePolicyCaller(cwd).length > 0);

  writeFileSync(
    join(cwd, ".github", "workflows", "repository-policy.yml"),
    REPOSITORY_POLICY_CALLER,
  );
  assert.deepEqual(validatePolicyCaller(cwd), []);
});

test("caller validation rejects copied central filenames and disabled jobs", () => {
  const cwd = createRepository();
  mkdirSync(join(cwd, ".github", "workflows"), { recursive: true });
  mkdirSync(join(cwd, "scripts"));
  const reference =
    "Tiancheng-Xu/.github/.github/workflows/verify-repository-policy.yml@main";
  writeFileSync(join(cwd, "scripts", "repository-policy.mjs"), "// imitation\n");
  writeFileSync(
    join(cwd, ".github", "workflows", "verify-repository-policy.yml"),
    `on:\n  pull_request:\njobs:\n  policy:\n    if: false\n    uses: ${reference}\n`,
  );
  assert.ok(validatePolicyCaller(cwd).length > 0);
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
    REPOSITORY_POLICY_CALLER,
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
