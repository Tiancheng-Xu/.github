import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

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

function createArchitectureSources(caseDir) {
  const architectureDir = join(caseDir, "architecture");
  mkdirSync(architectureDir, { recursive: true });
  for (const name of ["runtime", "github-actions", "preview", "sequence"]) {
    writeFileSync(
      join(architectureDir, `${name}.mmd`),
      `flowchart LR\n  start[${name}] --> finish[verified]\n`,
    );
  }
}

function completeArchitectureManifest() {
  return {
    runtime: {
      status: "implemented",
      source: "architecture/runtime.mmd",
      description: "Runtime request, data, trust, observability, and failure paths.",
    },
    githubActions: {
      status: "implemented",
      source: "architecture/github-actions.mmd",
      description: "GitHub Actions build, verification, deployment, and permissions.",
    },
    preview: {
      status: "implemented",
      source: "architecture/preview.mmd",
      description: "Preview creation, isolation, verification, and cleanup lifecycle.",
    },
    sequence: {
      status: "implemented",
      source: "architecture/sequence.mmd",
      description: "Critical interaction sequence with success and failure outcomes.",
    },
    canary: {
      status: "not_applicable",
      note: "This static project has no independently deployable runtime revision.",
    },
  };
}

function completeMeaningfulSteps() {
  return [
    {
      title: "Deploy the verified release",
      purpose: "Make the tested application reachable from its public entry point.",
      designReason: "Use the existing shared foundation to reduce cost and duplicated infrastructure.",
      scope: ".github/workflows/deploy.yml; Cloudflare Pages; AWS deployment role",
      expected: "The release URL serves the verified commit without changing protected shared resources.",
      risks: "A wrong environment or overly broad permission could publish the wrong revision.",
      observed: "The deployment completed and the public health check returned the expected revision.",
      proof: "E01 deployment run and sanitized health-check record.",
    },
  ];
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

function createVerifiedForkPushFixture({ extraBlockedOccurrence = false } = {}) {
  const { cwd, remote } = createPushFixture();
  mkdirSync(join(cwd, "ui", "dist", "assets"), { recursive: true });
  writeFileSync(join(cwd, "ui", "dist", "assets", "index-old.js"), "export const baseline = 1;\n");
  git(cwd, "add", "-f", "ui/dist/assets/index-old.js");
  git(cwd, "commit", "-qm", "fork base asset");
  const forkBase = git(cwd, "rev-parse", "HEAD");
  git(cwd, "push", "-q", "origin", `${forkBase}:refs/heads/main`);
  git(cwd, "switch", "-qc", "upstream-main", forkBase);
  mkdirSync(join(cwd, "ui", "messages"), { recursive: true });
  mkdirSync(join(cwd, "ui", "dist", "assets"), { recursive: true });
  mkdirSync(join(cwd, "ui", "dist", "pdfjs", "6.3.289", "cmaps"), { recursive: true });
  writeFileSync(
    join(cwd, "ui", "messages", "zh-CN.json"),
    JSON.stringify({ labels: [productOnlyPhrase, productOnlyPhrase] }),
  );
  writeFileSync(
    join(cwd, "ui", "dist", "assets", "index-old.js"),
    `${"export const stable = 1;\n".repeat(20)}export const labels = [${JSON.stringify(productOnlyPhrase)}, ${JSON.stringify(productOnlyPhrase)}];\n`,
  );
  writeFileSync(
    join(cwd, "ui", "dist", "pdfjs", "6.3.289", "cmaps", "CNS2-V.bcmap"),
    Buffer.from([0x2f, 0x2f, 0xff, 0xfe, 0xfd]),
  );
  git(cwd, "add", "-f", "ui");
  execFileSync("git", ["-c", "user.name=Upstream Maintainer", "-c", "user.email=maintainer@example.invalid", "commit", "-qm", "upstream content\n\nCo-authored-by: Dependabot <bot@example.invalid>"], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Upstream Maintainer",
      GIT_AUTHOR_EMAIL: "maintainer@example.invalid",
      GIT_COMMITTER_NAME: "Upstream Maintainer",
      GIT_COMMITTER_EMAIL: "maintainer@example.invalid",
    },
  });
  const upstreamBase = git(cwd, "rev-parse", "HEAD");

  git(cwd, "switch", "-qc", "feature", forkBase);
  writeFileSync(join(cwd, "README.md"), "owner feature\n");
  git(cwd, "add", "README.md");
  git(cwd, "commit", "-qm", "owner feature");
  git(cwd, "rm", "-q", "ui/dist/assets/index-old.js");
  mkdirSync(join(cwd, "ui", "dist", "assets"), { recursive: true });
  writeFileSync(
    join(cwd, "ui", "dist", "assets", "index-new.js"),
    `${"export const stable = 1;\n".repeat(20)}export const labels = [${JSON.stringify(productOnlyPhrase)}, ${JSON.stringify(productOnlyPhrase)}]; export const duration = 3;\n`,
  );
  git(cwd, "add", "-f", "ui/dist/assets/index-new.js");
  git(cwd, "commit", "-qm", "rebuild changed public asset");

  const merge = spawnSync("git", ["merge", "--no-ff", "upstream-main", "-m", "Merge upstream main"], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(merge.status, 1, merge.stderr);
  assert.match(merge.stdout + merge.stderr, /CONFLICT/);
  git(cwd, "rm", "-q", "-f", "ui/dist/assets/index-old.js");
  git(cwd, "add", "-A");
  git(cwd, "commit", "-qm", "Merge upstream main");

  if (extraBlockedOccurrence) {
    writeFileSync(
      join(cwd, "ui", "dist", "assets", "index-new.js"),
      `export const labels = [${JSON.stringify(productOnlyPhrase)}, ${JSON.stringify(productOnlyPhrase)}, ${JSON.stringify(productOnlyPhrase)}]; export const duration = 3;\n`,
    );
    git(cwd, "add", "-f", "ui/dist/assets/index-new.js");
    git(cwd, "commit", "-qm", "add new blocked occurrence");
  }

  return { cwd, remote, forkBase, upstreamBase, tip: git(cwd, "rev-parse", "HEAD") };
}

function createGitHubApiStub(root, {
  fork = true,
  compareStatus = "ahead",
  ownerLogin = "Tiancheng-Xu",
  parentPrivate = false,
  parentVisibility = "public",
  includeParentVisibility = true,
  apiAvailable = true,
} = {}) {
  const bin = join(root, "fake-gh-bin");
  mkdirSync(bin, { recursive: true });
  const shim = join(bin, "gh");
  writeFileSync(
    shim,
    `#!/usr/bin/env node
const endpoint = process.argv.at(-1);
const fork = ${JSON.stringify(fork)};
const compareStatus = ${JSON.stringify(compareStatus)};
const ownerLogin = ${JSON.stringify(ownerLogin)};
const parentPrivate = ${JSON.stringify(parentPrivate)};
const parentVisibility = ${JSON.stringify(parentVisibility)};
const includeParentVisibility = ${JSON.stringify(includeParentVisibility)};
const apiAvailable = ${JSON.stringify(apiAvailable)};
let response;
if (!apiAvailable) process.exit(1);
if (endpoint === "repos/Tiancheng-Xu/OpenResearch") {
  response = { full_name: "Tiancheng-Xu/OpenResearch", owner: { login: ownerLogin }, fork, parent: fork ? { full_name: "alphaXiv/OpenResearch", default_branch: "main", private: parentPrivate, ...(includeParentVisibility ? { visibility: parentVisibility } : {}) } : null };
} else if (endpoint.startsWith("repos/alphaXiv/OpenResearch/compare/")) {
  const commit = endpoint.split("compare/").at(-1).split("...")[0];
  response = { status: compareStatus, base_commit: { sha: commit }, merge_base_commit: { sha: commit } };
} else {
  process.stderr.write("unexpected API endpoint\\n");
  process.exit(1);
}
process.stdout.write(JSON.stringify(response));
`,
  );
  chmodSync(shim, 0o755);
  return { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` };
}

function runPrePushPolicy(cwd, tip, forkBase, env) {
  return spawnSync(
    process.execPath,
    [
      policyScript,
      "--mode", "pre-push",
      "--root", cwd,
      "--remote-name", "origin",
      "--remote-location", "https://github.com/Tiancheng-Xu/OpenResearch.git",
    ],
    {
      cwd,
      encoding: "utf8",
      env,
      input: `refs/heads/feature ${tip} refs/heads/main ${forkBase}\n`,
    },
  );
}

test("accepts a commit authored and committed by the configured owner", () => {
  const cwd = createRepository();
  writeFileSync(join(cwd, "README.md"), "safe update\n");
  git(cwd, "add", "README.md");
  git(cwd, "commit", "-qm", "owner update");

  assert.deepEqual(inspectCommitRange(cwd, "HEAD~1..HEAD", owner), []);
});

test("accepts a GitHub-generated merge commit for the configured owner", () => {
  const cwd = createRepository();
  const defaultBranch = git(cwd, "branch", "--show-current");
  git(cwd, "checkout", "-qb", "feature");
  writeFileSync(join(cwd, "README.md"), "safe feature update\n");
  git(cwd, "add", "README.md");
  git(cwd, "commit", "-qm", "safe feature update");
  git(cwd, "checkout", "-q", defaultBranch);

  execFileSync(
    "git",
    ["merge", "--no-ff", "feature", "-m", "Merge pull request #7"],
    {
      cwd,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Account display name",
        GIT_AUTHOR_EMAIL: "12345+Tiancheng-Xu@users.noreply.github.com",
        GIT_COMMITTER_NAME: "GitHub",
        GIT_COMMITTER_EMAIL: "noreply@github.com",
      },
      stdio: "ignore",
    },
  );

  assert.deepEqual(inspectCommitRange(cwd, "HEAD^1..HEAD", owner), []);
});

test("accepts an owner squash commit attested by an owner GitHub push", () => {
  const cwd = createRepository();
  writeFileSync(join(cwd, "README.md"), "safe squashed update\n");
  git(cwd, "add", "README.md");
  execFileSync("git", ["commit", "-qm", "safe squashed update (#20)"], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Account display name",
      GIT_AUTHOR_EMAIL: "44307608+Tiancheng-Xu@users.noreply.github.com",
      GIT_COMMITTER_NAME: "GitHub",
      GIT_COMMITTER_EMAIL: "noreply@github.com",
    },
    stdio: "ignore",
  });
  const sha = git(cwd, "rev-parse", "HEAD");

  assert.deepEqual(
    inspectCommitRange(cwd, "HEAD~1..HEAD", owner, {
      GITHUB_ACTOR: "Tiancheng-Xu",
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF: "refs/heads/main",
      GITHUB_SHA: sha,
      REPOSITORY_POLICY_DEFAULT_BRANCH: "main",
    }),
    [],
  );
});

test("rejects a single-parent commit forged with GitHub merge identities", () => {
  const cwd = createRepository();
  writeFileSync(join(cwd, "README.md"), "forged GitHub update\n");
  git(cwd, "add", "README.md");
  execFileSync("git", ["commit", "-qm", "forged GitHub update"], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Account display name",
      GIT_AUTHOR_EMAIL: "12345+Tiancheng-Xu@users.noreply.github.com",
      GIT_COMMITTER_NAME: "GitHub",
      GIT_COMMITTER_EMAIL: "noreply@github.com",
    },
    stdio: "ignore",
  });

  const violations = inspectCommitRange(cwd, "HEAD~1..HEAD", owner);
  assert.ok(violations.some((item) => item.code === "author-owner-mismatch"));
  assert.ok(violations.some((item) => item.code === "committer-owner-mismatch"));
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

test("uses the newest verified upstream baseline when multiple merged baselines are ancestors", () => {
  const cwd = createRepository();
  mkdirSync(join(cwd, "ui"), { recursive: true });
  const labelsPath = join(cwd, "ui", "labels.json");
  writeFileSync(labelsPath, JSON.stringify({ labels: [productOnlyPhrase] }));
  git(cwd, "add", "ui/labels.json");
  git(cwd, "commit", "-qm", "first upstream baseline");
  const firstBaseline = git(cwd, "rev-parse", "HEAD");

  writeFileSync(labelsPath, JSON.stringify({ labels: [productOnlyPhrase, productOnlyPhrase] }));
  git(cwd, "add", "ui/labels.json");
  git(cwd, "commit", "-qm", "newer upstream baseline");
  const newerBaseline = git(cwd, "rev-parse", "HEAD");

  writeFileSync(labelsPath, JSON.stringify({ labels: [productOnlyPhrase, productOnlyPhrase, "safe"] }));
  git(cwd, "add", "ui/labels.json");
  git(cwd, "commit", "-qm", "owner update based on newer upstream");
  const tip = git(cwd, "rev-parse", "HEAD");

  const violations = scanCandidateTree(cwd, {
    revision: tip,
    blockedTerms: [productOnlyPhrase],
    publicContentBaselines: [firstBaseline, newerBaseline],
  });

  assert.deepEqual(violations, []);
});

for (const revision of [undefined, "HEAD"]) {
  test(`does not read gitlinks as blobs in ${revision ?? "index"} scans`, () => {
    const cwd = createRepository();
    // Submodule commits need not be present in the superproject object store.
    git(cwd, "update-index", "--add", "--cacheinfo",
      "160000,1111111111111111111111111111111111111111,compat-tests");
    writeFileSync(join(cwd, "product.txt"), `public ${productOnlyPhrase}\n`);
    git(cwd, "add", "product.txt");
    git(cwd, "commit", "-qm", "track a submodule and product file");
    writeFileSync(join(cwd, "untracked.txt"), `public ${productOnlyPhrase}\n`);

    const violations = scanCandidateTree(cwd, {
      revision,
      blockedTerms: [productOnlyPhrase],
    });

    assert.deepEqual(
      violations.map(({ code, path }) => ({ code, path })),
      (revision ? ["product.txt"] : ["product.txt", "untracked.txt"])
        .map((path) => ({ code: "blocked-public-content", path })),
    );
  });
}

test("allows required Evidence, architecture, and verification material in the tracked tree", () => {
  const cwd = createRepository();
  const allowedFiles = [
    "archive/retired-workflow/README.md",
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

test("allows recruiting terminology in private project source", () => {
  const cwd = createRepository();
  mkdirSync(join(cwd, "web", "src"), { recursive: true });
  writeFileSync(
    join(cwd, "web", "src", "App.tsx"),
    `export const label = ${JSON.stringify(projectFramingPhrase)};\n`,
  );
  git(cwd, "add", "web/src/App.tsx");

  assert.deepEqual(scanCandidateTree(cwd), []);
});

test("blocks recruiting-oriented framing in public build output", () => {
  const cwd = createRepository();
  mkdirSync(join(cwd, "dist"), { recursive: true });
  writeFileSync(join(cwd, "dist", "index.html"), projectFramingPhrase);

  const violations = scanCandidateTree(cwd, { buildOutputPaths: ["dist"] });
  assert.ok(
    violations.some(
      (item) =>
        item.path === "dist/index.html" && item.scope === "build-output",
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
  createArchitectureSources(caseDir);
  writeFileSync(
    join(caseDir, "evidence.json"),
    JSON.stringify({
      schemaVersion: 2,
      slug: "demo",
      proof: [{ id: "E01", title: "release", asset: null, lookFor: "status", proves: "deployed" }],
      assets: [],
      architecture: completeArchitectureManifest(),
      meaningfulSteps: completeMeaningfulSteps(),
    }),
  );
  git(cwd, "add", "public/cases/demo");

  assert.ok(
    scanCandidateTree(cwd).some((item) => item.code === "evidence-proof-asset-missing"),
  );
});

test("accepts Evidence proof cards backed by matching bytes and SHA-256", () => {
  const cwd = createRepository();
  const caseDir = join(cwd, "public", "cases", "demo");
  const asset = Buffer.from("real sanitized evidence\n");
  mkdirSync(join(caseDir, "assets"), { recursive: true });
  createArchitectureSources(caseDir);
  writeFileSync(join(caseDir, "assets", "release.png"), asset);
  writeFileSync(
    join(caseDir, "evidence.json"),
    JSON.stringify({
      schemaVersion: 2,
      slug: "demo",
      proof: [{ id: "E01", title: "release", asset: "release.png", lookFor: "status", proves: "deployed" }],
      assets: [{ id: "E01", file: "release.png", bytes: asset.length, sha256: "ac7dc41e1b2568f5d6186d2bd9ce64ebb093f3c4ad3508c725ad8d7108b3a8f9" }],
      architecture: completeArchitectureManifest(),
      meaningfulSteps: completeMeaningfulSteps(),
    }),
  );
  git(cwd, "add", "public/cases/demo");

  assert.deepEqual(
    scanCandidateTree(cwd).filter((item) => item.code.startsWith("evidence-")),
    [],
  );
});

test("rejects Evidence cases without the required architecture diagram package", () => {
  const cwd = createRepository();
  const caseDir = join(cwd, "public", "cases", "demo");
  mkdirSync(caseDir, { recursive: true });
  writeFileSync(
    join(caseDir, "evidence.json"),
    JSON.stringify({ schemaVersion: 2, slug: "demo", proof: [], assets: [] }),
  );
  git(cwd, "add", "public/cases/demo/evidence.json");

  assert.ok(
    scanCandidateTree(cwd).some((item) => item.code === "evidence-architecture-missing"),
  );
});

test("rejects dishonest or untraceable Evidence architecture entries", () => {
  const cwd = createRepository();
  const caseDir = join(cwd, "public", "cases", "demo");
  mkdirSync(caseDir, { recursive: true });
  writeFileSync(
    join(caseDir, "evidence.json"),
    JSON.stringify({
      schemaVersion: 2,
      slug: "demo",
      proof: [],
      assets: [],
      architecture: {
        runtime: { status: "implemented", source: "../../README.md", description: "unsafe" },
        githubActions: { status: "planned" },
        preview: { status: "unavailable", note: "Account quota blocks preview resources." },
        sequence: { status: "implemented", source: "architecture/missing.mmd", description: "missing" },
        canary: { status: "not_applicable", note: "No versioned backend." },
      },
    }),
  );
  git(cwd, "add", "public/cases/demo/evidence.json");

  const violations = scanCandidateTree(cwd);
  assert.ok(violations.some((item) => item.code === "evidence-architecture-source-unsafe"));
  assert.ok(violations.some((item) => item.code === "evidence-architecture-note-missing"));
  assert.ok(violations.some((item) => item.code === "evidence-architecture-source-untracked"));
});

test("accepts a complete Evidence architecture package with honest statuses", () => {
  const cwd = createRepository();
  const caseDir = join(cwd, "public", "cases", "demo");
  createArchitectureSources(caseDir);
  writeFileSync(
    join(caseDir, "evidence.json"),
    JSON.stringify({
      schemaVersion: 2,
      slug: "demo",
      proof: [],
      assets: [],
      architecture: completeArchitectureManifest(),
      meaningfulSteps: completeMeaningfulSteps(),
    }),
  );
  git(cwd, "add", "public/cases/demo");

  assert.deepEqual(
    scanCandidateTree(cwd).filter((item) => item.code.startsWith("evidence-architecture")),
    [],
  );
});

test("rejects Evidence manifests with an unsupported schema instead of skipping them", () => {
  const cwd = createRepository();
  const caseDir = join(cwd, "public", "cases", "demo");
  mkdirSync(caseDir, { recursive: true });
  writeFileSync(
    join(caseDir, "evidence.json"),
    JSON.stringify({ schemaVersion: 1, slug: "demo", proof: [], assets: [] }),
  );
  git(cwd, "add", "public/cases/demo/evidence.json");

  assert.ok(
    scanCandidateTree(cwd).some((item) => item.code === "evidence-manifest-schema-invalid"),
  );
});

test("rejects Evidence cases without meaningful configuration steps", () => {
  const cwd = createRepository();
  const caseDir = join(cwd, "public", "cases", "demo");
  createArchitectureSources(caseDir);
  writeFileSync(
    join(caseDir, "evidence.json"),
    JSON.stringify({
      schemaVersion: 2,
      slug: "demo",
      proof: [],
      assets: [],
      architecture: completeArchitectureManifest(),
    }),
  );
  git(cwd, "add", "public/cases/demo");

  assert.ok(
    scanCandidateTree(cwd).some((item) => item.code === "evidence-meaningful-steps-missing"),
  );
});

test("rejects incomplete meaningful configuration step explanations", () => {
  const cwd = createRepository();
  const caseDir = join(cwd, "public", "cases", "demo");
  createArchitectureSources(caseDir);
  const [step] = completeMeaningfulSteps();
  writeFileSync(
    join(caseDir, "evidence.json"),
    JSON.stringify({
      schemaVersion: 2,
      slug: "demo",
      proof: [],
      assets: [],
      architecture: completeArchitectureManifest(),
      meaningfulSteps: [{ ...step, risks: "", proof: "" }],
    }),
  );
  git(cwd, "add", "public/cases/demo");

  const violations = scanCandidateTree(cwd);
  assert.ok(violations.some((item) => item.code === "evidence-meaningful-step-field-missing" && item.field === "risks"));
  assert.ok(violations.some((item) => item.code === "evidence-meaningful-step-field-missing" && item.field === "proof"));
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

test("pre-push accepts only inherited history and content verified in a fork parent", () => {
  const { cwd, forkBase, tip } = createVerifiedForkPushFixture();
  const env = createGitHubApiStub(dirname(cwd));
  const result = runPrePushPolicy(cwd, tip, forkBase, env);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Repository policy passed/);
});

test("pre-push retains a verified upstream baseline after its merge is already on the fork", () => {
  const { cwd, forkBase, tip: mergedTip } = createVerifiedForkPushFixture();
  writeFileSync(join(cwd, "README.md"), "owner follow-up\n");
  git(cwd, "add", "README.md");
  git(cwd, "commit", "-qm", "owner follow-up after upstream merge");
  const tip = git(cwd, "rev-parse", "HEAD");
  const env = createGitHubApiStub(dirname(cwd));
  const result = runPrePushPolicy(cwd, tip, mergedTip, env);

  assert.notEqual(mergedTip, forkBase);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Repository policy passed/);
});

test("pre-push still rejects newly added blocked content above the verified fork baseline", () => {
  const { cwd, forkBase, tip } = createVerifiedForkPushFixture({ extraBlockedOccurrence: true });
  const env = createGitHubApiStub(dirname(cwd));
  const result = runPrePushPolicy(cwd, tip, forkBase, env);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /blocked-public-content.*ui\/dist\/assets\/index-new\.js/);
});

test("pre-push does not trust upstream authors or assets without verified fork ancestry", () => {
  const { cwd, forkBase, tip } = createVerifiedForkPushFixture();
  const env = createGitHubApiStub(dirname(cwd), { compareStatus: "diverged" });
  const result = runPrePushPolicy(cwd, tip, forkBase, env);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /author-owner-mismatch/);
  assert.match(result.stderr, /content-decoding-failed.*CNS2-V\.bcmap/);
});

test("pre-push does not infer a trusted parent from a repository that is not a fork", () => {
  const { cwd, forkBase, tip } = createVerifiedForkPushFixture();
  const env = createGitHubApiStub(dirname(cwd), { fork: false });
  const result = runPrePushPolicy(cwd, tip, forkBase, env);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /author-owner-mismatch/);
});

test("pre-push does not trust content or authors from a private fork parent", () => {
  const { cwd, forkBase, tip } = createVerifiedForkPushFixture();
  const env = createGitHubApiStub(dirname(cwd), { parentPrivate: true, parentVisibility: "private" });
  const result = runPrePushPolicy(cwd, tip, forkBase, env);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /author-owner-mismatch/);
  assert.match(result.stderr, /content-decoding-failed.*CNS2-V\.bcmap/);
});

test("pre-push does not trust a fork parent when GitHub visibility is missing", () => {
  const { cwd, forkBase, tip } = createVerifiedForkPushFixture();
  const env = createGitHubApiStub(dirname(cwd), { includeParentVisibility: false });
  const result = runPrePushPolicy(cwd, tip, forkBase, env);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /author-owner-mismatch/);
});

test("pre-push does not trust fork metadata owned by another account", () => {
  const { cwd, forkBase, tip } = createVerifiedForkPushFixture();
  const env = createGitHubApiStub(dirname(cwd), { ownerLogin: "someone-else" });
  const result = runPrePushPolicy(cwd, tip, forkBase, env);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /author-owner-mismatch/);
});

test("pre-push keeps the strict gate when the GitHub API is unavailable", () => {
  const { cwd, forkBase, tip } = createVerifiedForkPushFixture();
  const env = createGitHubApiStub(dirname(cwd), { apiAvailable: false });
  const result = runPrePushPolicy(cwd, tip, forkBase, env);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /author-owner-mismatch/);
});

function createInheritedEncodingFixture(path = "tests/fixtures/invalid.js", content) {
  const { cwd, remote } = createPushFixture();
  mkdirSync(dirname(join(cwd, path)), { recursive: true });
  writeFileSync(join(cwd, path), content ?? Buffer.from([0x2f, 0x2f, 0xff, 0xfe, 0xfd]));
  git(cwd, "add", path);
  git(cwd, "commit", "-qm", "upstream invalid encoding sample");
  // Seed actual remote history, as in a fork made from an upstream repository.
  git(remote, "fetch", "-q", cwd, "HEAD:refs/heads/main");
  git(cwd, "switch", "-c", "encoding-feature");
  writeFileSync(join(cwd, "README.md"), "safe feature\n");
  git(cwd, "add", "README.md");
  git(cwd, "commit", "-qm", "safe feature");
  return { cwd, remote, path };
}

for (const target of ["HEAD", "HEAD:main"]) {
  test(`pre-push preserves an unchanged remote invalid-encoding fixture (${target})`, () => {
    const { cwd, remote } = createInheritedEncodingFixture();
    const result = spawnSync("git", ["push", "origin", target], { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const ref = target === "HEAD" ? "encoding-feature" : "main";
    assert.equal(git(remote, "rev-parse", `refs/heads/${ref}`), git(cwd, "rev-parse", "HEAD"));
  });
}

test("pre-push rejects changes to an inherited invalid-encoding fixture", () => {
  const { cwd, path } = createInheritedEncodingFixture();
  writeFileSync(join(cwd, path), Buffer.from([0x2f, 0x2f, 0xff, 0xfd]));
  git(cwd, "add", path);
  git(cwd, "commit", "-qm", "changed invalid sample");
  const result = spawnSync("git", ["push", "origin", "HEAD"], { cwd, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /content-decoding-failed/);
});

test("pre-push rejects a new path with identical inherited invalid bytes", () => {
  const { cwd } = createInheritedEncodingFixture();
  writeFileSync(join(cwd, "tests/fixtures/new.js"), Buffer.from([0x2f, 0x2f, 0xff, 0xfe, 0xfd]));
  git(cwd, "add", "tests/fixtures/new.js");
  git(cwd, "commit", "-qm", "new invalid sample");
  const result = spawnSync("git", ["push", "origin", "HEAD"], { cwd, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /content-decoding-failed.*tests\/fixtures\/new.js/);
});

test("pre-push rejects unchanged invalid-encoding product source", () => {
  const { cwd } = createInheritedEncodingFixture("src/index.js");
  const result = spawnSync("git", ["push", "origin", "HEAD"], { cwd, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /content-decoding-failed.*src\/index.js/);
});

test("pre-push still scans wording in inherited invalid-encoding fixtures", () => {
  const content = Buffer.concat([Buffer.from(`// ${productOnlyPhrase} ${retiredAlias}`), Buffer.from([0xff])]);
  const { cwd } = createInheritedEncodingFixture("tests/fixtures/invalid.js", content);
  const result = spawnSync("git", ["push", "origin", "HEAD"], { cwd, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /blocked-public-content/);
  assert.doesNotMatch(result.stderr, new RegExp(productOnlyPhrase));
});

test("pre-push does not trust a forged local encoding baseline", () => {
  const { cwd } = createPushFixture();
  mkdirSync(join(cwd, "tests/fixtures"), { recursive: true });
  writeFileSync(join(cwd, "tests/fixtures/invalid.js"), Buffer.from([0x2f, 0x2f, 0xff]));
  git(cwd, "add", "tests/fixtures/invalid.js");
  git(cwd, "commit", "-qm", "new invalid sample");
  git(cwd, "update-ref", "refs/remotes/fake/main", git(cwd, "rev-parse", "HEAD"));
  const result = spawnSync("git", ["push", "origin", "HEAD"], { cwd, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /content-decoding-failed/);
});

test("pre-push rejects a matching invalid fixture from unrelated remote history", () => {
  const { cwd } = createInheritedEncodingFixture();
  git(cwd, "switch", "--orphan", "unrelated-feature");
  mkdirSync(join(cwd, "tests/fixtures"), { recursive: true });
  writeFileSync(join(cwd, "README.md"), "safe unrelated tree\n");
  writeFileSync(join(cwd, "tests/fixtures/invalid.js"), Buffer.from([0x2f, 0x2f, 0xff, 0xfe, 0xfd]));
  git(cwd, "add", "README.md", "tests/fixtures/invalid.js");
  git(cwd, "commit", "-qm", "unrelated owner tree");
  const result = spawnSync("git", ["push", "--force", "origin", "HEAD:main"], { cwd, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /content-decoding-failed/);
});

test("pre-push rejects a mode change to an inherited invalid-encoding fixture", () => {
  const { cwd, path } = createInheritedEncodingFixture();
  git(cwd, "update-index", "--chmod=+x", path);
  git(cwd, "commit", "-qm", "change sample mode");
  const result = spawnSync("git", ["push", "origin", "HEAD"], { cwd, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /content-decoding-failed/);
});

test("pre-push rejects invalid-encoding documentation inside tests", () => {
  const { cwd } = createInheritedEncodingFixture("tests/README.md");
  const result = spawnSync("git", ["push", "origin", "HEAD"], { cwd, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /content-decoding-failed/);
});

test("pre-push keeps configured public output strict for inherited fixtures", () => {
  const { cwd } = createInheritedEncodingFixture();
  const result = spawnSync("git", ["push", "origin", "HEAD"], {
    cwd, encoding: "utf8",
    env: { ...process.env, REPOSITORY_POLICY_BUILD_OUTPUTS: "tests/fixtures" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /content-decoding-failed/);
});

for (const path of ["tests/fixtures/notes.markdown", "tests/fixtures/policy.adoc", "tests/docs/notes.txt", "tests/README"]) {
  test(`pre-push keeps inherited documentation strict (${path})`, () => {
    const { cwd } = createInheritedEncodingFixture(path);
    const result = spawnSync("git", ["push", "origin", "HEAD"], { cwd, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /content-decoding-failed/);
  });
}

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

test("new-branch push does not fetch unrelated promisor tips", () => {
  const { cwd, remote } = createPushFixture();
  git(cwd, "push", "origin", "HEAD:main");
  git(remote, "config", "uploadpack.allowFilter", "true");

  const unrelated = createRepository();
  writeFileSync(join(unrelated, "README.md"), "unrelated remote history\n");
  git(unrelated, "add", "README.md");
  git(unrelated, "commit", "-qm", "unrelated remote tip");
  const unrelatedOid = git(unrelated, "rev-parse", "HEAD");
  git(unrelated, "config", "workflow.ownerName", owner.name);
  git(unrelated, "config", "workflow.ownerEmail", owner.emails[0]);
  git(unrelated, "push", remote, "HEAD:refs/tags/unrelated");

  const partial = join(mkdtempSync(join(tmpdir(), "policy-promisor-")), "project");
  git(cwd, "clone", "--quiet", "--no-tags", "--depth=1", "--filter=blob:none",
    "--branch", "main", pathToFileURL(remote).href, partial);
  for (const [key, value] of [
    ["user.name", owner.name], ["user.email", owner.emails[0]],
    ["workflow.ownerName", owner.name], ["workflow.ownerEmail", owner.emails[0]],
    ["core.hooksPath", policyHooksPath],
  ]) git(partial, "config", key, value);
  git(partial, "switch", "-c", "safe-feature");
  writeFileSync(join(partial, "README.md"), "safe feature\n");
  git(partial, "add", "README.md");
  git(partial, "commit", "-qm", "safe feature");

  const result = spawnSync("git", ["push", "origin", "HEAD"], {
    cwd: partial, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const probe = spawnSync("git", ["cat-file", "-e", unrelatedOid], {
    cwd: partial, env: { ...process.env, GIT_NO_LAZY_FETCH: "1" }, stdio: "ignore",
  });
  assert.notEqual(probe.status, 0, "unrelated tag history must remain unfetched");
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
