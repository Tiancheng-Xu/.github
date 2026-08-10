#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_IN_MEMORY_BLOB = 32 * 1024 * 1024;

export const REPOSITORY_POLICY_CALLER = `name: Repository policy

on:
  pull_request:

permissions:
  contents: read

jobs:
  policy:
    uses: Tiancheng-Xu/.github/.github/workflows/verify-repository-policy.yml@main
`;

export const DEFAULT_BLOCKED_TERMS = Object.freeze([
  String.fromCodePoint(0x4f5c, 0x4e1a),
  String.fromCodePoint(0x4e00, 0x706f),
  String.fromCodePoint(0x79, 0x69, 0x64, 0x65, 0x6e, 0x67),
]);

const AUTOMATION_IDENTITIES = Object.freeze([
  "codex",
  "openai",
  "chatgpt",
  "claude",
  "anthropic",
  "github-actions",
  "dependabot",
]);

const EXCLUDED_DIRECTORY_NAMES = new Set([
  ".git",
  "node_modules",
  "vendor",
  "third_party",
  "third-party",
]);

const LICENSE_FILE = /^(?:licen[cs]e|copying|notice)(?:\.[a-z0-9_-]+)?$/i;
const ATTRIBUTION_LINE = /^[a-z][a-z0-9-]*-by:\s*.+$/i;

function git(root, args, options = {}) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: options.encoding ?? "utf8",
    input: options.input,
    maxBuffer: 512 * 1024 * 1024,
  });
}

function normalized(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isNullOid(value) {
  return /^0+$/.test(String(value ?? ""));
}

function containsAutomationIdentity(value) {
  const candidate = normalized(value);
  return AUTOMATION_IDENTITIES.some((identity) => candidate.includes(identity));
}

function isExcludedPath(path) {
  const parts = path.split(/[\\/]/);
  if (parts.some((part) => EXCLUDED_DIRECTORY_NAMES.has(part))) return true;
  return LICENSE_FILE.test(parts.at(-1) ?? "");
}

function inspectBuffer(buffer, blockedTerms) {
  if (buffer.includes(0)) return { binary: true, policyTerms: [] };
  try {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    const lower = content.toLowerCase();
    return {
      binary: false,
      decodingFailed: false,
      policyTerms: blockedTerms
        .map((term, index) => ({ term, index }))
        .filter(({ term }) => lower.includes(String(term).toLowerCase()))
        .map(({ index }) => `policy-term-${index + 1}`),
    };
  } catch {
    return { binary: false, decodingFailed: true, policyTerms: [] };
  }
}

function indexHasPath(root, path) {
  return spawnSync("git", ["cat-file", "-e", `:${path}`], {
    cwd: root,
    stdio: "ignore",
  }).status === 0;
}

function filePrefix(path, size = 8192) {
  const descriptor = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(size);
    const length = readSync(descriptor, buffer, 0, size, 0);
    return buffer.subarray(0, length);
  } finally {
    closeSync(descriptor);
  }
}

function materializedGitObjectEncoding(root, specification) {
  const directory = mkdtempSync(join(tmpdir(), "repository-policy-blob-"));
  const path = join(directory, "candidate");
  const descriptor = openSync(path, "w");
  try {
    const materialized = spawnSync("git", ["show", specification], {
      cwd: root,
      stdio: ["ignore", descriptor, "pipe"],
      encoding: "utf8",
    });
    if (materialized.status !== 0) {
      throw new Error(materialized.stderr.trim() || `cannot read ${specification}`);
    }
  } finally {
    closeSync(descriptor);
  }
  try {
    const identified = spawnSync("file", ["--brief", "--mime-encoding", path], {
      encoding: "utf8",
    });
    if (identified.status !== 0) {
      throw new Error(identified.stderr.trim() || "file classification failed");
    }
    return identified.stdout.trim().toLowerCase();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function trackedBlobIsBinary(root, path, revision) {
  if (!revision && !indexHasPath(root, path)) {
    if (lstatSync(resolve(root, path)).size > MAX_IN_MEMORY_BLOB) {
      const identified = spawnSync(
        "file",
        ["--brief", "--mime-encoding", resolve(root, path)],
        { encoding: "utf8" },
      );
      if (identified.status !== 0) {
        throw new Error(identified.stderr.trim() || "file classification failed");
      }
      return identified.stdout.trim().toLowerCase() === "binary";
    }
    return filePrefix(resolve(root, path)).includes(0);
  }
  const specification = revision ? `${revision}:${path}` : `:${path}`;
  const size = Number(git(root, ["cat-file", "-s", specification]));
  if (size > MAX_IN_MEMORY_BLOB) {
    return materializedGitObjectEncoding(root, specification) === "binary";
  }
  const prefix = execFileSync(
    "/bin/sh",
    ["-c", 'git show "$1" | head -c 8192', "repository-policy", specification],
    { cwd: root, encoding: "buffer", maxBuffer: 16 * 1024 },
  );
  return prefix.includes(0);
}

function trackedPaths(root, revision) {
  const args = revision
    ? ["ls-tree", "-r", "--name-only", "-z", revision]
    : ["ls-files", "-z", "--cached", "--others", "--exclude-standard"];
  return git(root, args).split("\0").filter(Boolean);
}

function trackedBuffer(root, path, revision) {
  if (revision) {
    return git(root, ["show", `${revision}:${path}`], { encoding: "buffer" });
  }
  const indexed = spawnSync("git", ["show", `:${path}`], {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (indexed.status === 0) return indexed.stdout;
  // Untracked candidate files do not exist in the index yet.
  return readFileSync(resolve(root, path));
}

function walkFiles(root, directory, onSymlink = () => {}) {
  const absolute = resolve(root, directory);
  if (!existsSync(absolute)) return [];
  if (!lstatSync(absolute).isDirectory()) return [absolute];

  const output = [];
  const queue = [absolute];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      const projectPath = relative(root, path).split(sep).join("/");
      if (isExcludedPath(projectPath)) continue;
      if (entry.isDirectory()) queue.push(path);
      else if (entry.isFile()) output.push(path);
      else if (entry.isSymbolicLink()) onSymlink(projectPath);
    }
  }
  return output.sort();
}

function contentViolations(root, paths, options) {
  const violations = [];
  for (const path of paths.sort()) {
    if (isExcludedPath(path)) continue;
    let buffer;
    try {
      if (options.isBinary?.(path)) continue;
      buffer = options.read(path);
    } catch (error) {
      violations.push({
        code: "content-read-failed",
        path,
        scope: options.scope,
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const inspection = inspectBuffer(buffer, options.blockedTerms);
    if (inspection.binary) continue;
    if (inspection.decodingFailed) {
      violations.push({
        code: "content-decoding-failed",
        path,
        scope: options.scope,
      });
      continue;
    }
    for (const policyTerm of inspection.policyTerms) {
      violations.push({
        code: "blocked-public-content",
        path,
        scope: options.scope,
        policyTerm,
      });
    }
  }
  return violations;
}

export function scanCandidateTree(root, options = {}) {
  const repositoryRoot = resolve(root);
  const blockedTerms = options.blockedTerms ?? DEFAULT_BLOCKED_TERMS;
  const revision = options.revision;
  const violations = contentViolations(
    repositoryRoot,
    trackedPaths(repositoryRoot, revision),
    {
      blockedTerms,
      read: (path) => trackedBuffer(repositoryRoot, path, revision),
      isBinary: (path) => trackedBlobIsBinary(repositoryRoot, path, revision),
      scope: "tracked-tree",
    },
  );

  for (const outputPath of options.buildOutputPaths ?? []) {
    const absoluteOutput = resolve(repositoryRoot, outputPath);
    const relativeOutput = relative(repositoryRoot, absoluteOutput);
    if (
      isAbsolute(outputPath) ||
      relativeOutput === ".." ||
      relativeOutput.startsWith(`..${sep}`) ||
      isAbsolute(relativeOutput)
    ) {
      violations.push({
        code: "unsafe-build-output-path",
        path: outputPath,
        scope: "build-output",
      });
      continue;
    }
    if (!existsSync(absoluteOutput)) {
      violations.push({
        code: "build-output-missing",
        path: outputPath,
        scope: "build-output",
      });
      continue;
    }
    if (!lstatSync(absoluteOutput).isDirectory()) {
      violations.push({
        code: "build-output-not-directory",
        path: outputPath,
        scope: "build-output",
      });
      continue;
    }
    const files = walkFiles(repositoryRoot, outputPath, (path) => {
      violations.push({
        code: "build-output-symlink",
        path,
        scope: "build-output",
      });
    });
    violations.push(
      ...contentViolations(
        repositoryRoot,
        files.map((path) => relative(repositoryRoot, path).split(sep).join("/")),
        {
          blockedTerms,
          read: (path) => readFileSync(resolve(repositoryRoot, path)),
          scope: "build-output",
        },
      ),
    );
  }

  return violations;
}

export function validateRefName(refName) {
  const candidate = normalized(refName);
  const forbidden = [...AUTOMATION_IDENTITIES, ...DEFAULT_BLOCKED_TERMS];
  const violations = [];
  for (const identity of forbidden) {
    const escaped = identity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?:^|[\\/._-])${escaped}(?:$|[\\/._-])`, "i");
    if (pattern.test(candidate)) {
      violations.push({ code: "unsafe-ref-name", ref: refName });
      break;
    }
  }
  return violations;
}

export function validatePolicyCaller(root, revision) {
  const repositoryRoot = resolve(root);
  const callerPath = ".github/workflows/repository-policy.yml";
  if (!trackedPaths(repositoryRoot, revision).includes(callerPath)) {
    return [{ code: "missing-policy-caller", path: callerPath }];
  }
  try {
    const content = trackedBuffer(repositoryRoot, callerPath, revision)
      .toString("utf8")
      .replace(/\r\n/g, "\n");
    if (content === REPOSITORY_POLICY_CALLER) return [];
  } catch {
    // Return a deterministic violation without exposing caller contents.
  }
  return [{ code: "invalid-policy-caller", path: callerPath }];
}

function parseCommitLog(output) {
  return output
    .split("\u001e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, authorName, authorEmail, committerName, committerEmail, ...body] =
        record.split("\u001f");
      return {
        sha,
        authorName,
        authorEmail,
        committerName,
        committerEmail,
        body: body.join("\u001f"),
      };
    });
}

function inspectCommits(root, commits, owner) {
  const violations = [];
  const ownerName = normalized(owner?.name);
  const ownerEmails = new Set((owner?.emails ?? []).map(normalized));
  if (!ownerName) {
    return [{ code: "owner-identity-missing" }];
  }

  for (const commit of commits) {
    const authorMatches =
      normalized(commit.authorName) === ownerName &&
      (ownerEmails.size === 0 || ownerEmails.has(normalized(commit.authorEmail)));
    const committerMatches =
      normalized(commit.committerName) === ownerName &&
      (ownerEmails.size === 0 || ownerEmails.has(normalized(commit.committerEmail)));

    if (!authorMatches) {
      violations.push({ code: "author-owner-mismatch", sha: commit.sha });
    }
    if (!committerMatches) {
      violations.push({ code: "committer-owner-mismatch", sha: commit.sha });
    }
    if (
      containsAutomationIdentity(commit.authorName) ||
      containsAutomationIdentity(commit.authorEmail) ||
      containsAutomationIdentity(commit.committerName) ||
      containsAutomationIdentity(commit.committerEmail)
    ) {
      violations.push({ code: "automation-identity", sha: commit.sha });
    }
    let trailers = "";
    try {
      trailers = git(root, ["interpret-trailers", "--parse"], {
        input: commit.body,
      });
    } catch {
      trailers = commit.body
        .split("\n")
        .filter((line) => ATTRIBUTION_LINE.test(line.trim()))
        .join("\n");
    }
    if (containsAutomationIdentity(trailers)) {
      violations.push({ code: "automation-attribution", sha: commit.sha });
    }
  }
  return violations;
}

export function inspectCommitRange(root, range, owner) {
  const format = "%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B%x1e";
  const output = git(root, ["log", `--format=${format}`, range]);
  return inspectCommits(root, parseCommitLog(output), owner);
}

function inspectCommitList(root, revisions, owner) {
  if (revisions.length === 0) return [];
  const format = "%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B%x1e";
  const output = git(root, ["show", "-s", `--format=${format}`, ...revisions]);
  return inspectCommits(root, parseCommitLog(output), owner);
}

function readConfig(root, key) {
  try {
    return git(root, ["config", "--get-all", key])
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function resolveOwner(root, options) {
  const name =
    options.ownerName ??
    process.env.REPOSITORY_POLICY_OWNER_NAME ??
    readConfig(root, "workflow.ownerName")[0];
  const emails = [
    ...(options.ownerEmails ?? []),
    ...(process.env.REPOSITORY_POLICY_OWNER_EMAILS ?? "").split(","),
    ...readConfig(root, "workflow.ownerEmail"),
  ].filter(Boolean);
  return { name, emails: [...new Set(emails)] };
}

function parseArguments(argv) {
  const options = { ownerEmails: [], buildOutputPaths: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--mode") options.mode = value;
    else if (argument === "--root") options.root = value;
    else if (argument === "--range") options.range = value;
    else if (argument === "--revision") options.revision = value;
    else if (argument === "--remote-name") options.remoteName = value;
    else if (argument === "--remote-location") options.remoteLocation = value;
    else if (argument === "--owner-name") options.ownerName = value;
    else if (argument === "--owner-email") options.ownerEmails.push(value);
    else if (argument === "--build-output") options.buildOutputPaths.push(value);
    else if (argument === "--require-caller") {
      options.requireCaller = true;
      continue;
    }
    else continue;
    index += 1;
  }
  return options;
}

function hasObject(root, revision) {
  try {
    git(root, ["cat-file", "-e", revision]);
    return true;
  } catch {
    return false;
  }
}

function fetchRemoteRefs(root, remoteLocation, refs) {
  const uniqueRefs = [...new Set(refs.filter((ref) => !ref.endsWith("^{}")))];
  if (uniqueRefs.length === 0) return;
  git(root, [
    "fetch",
    "--quiet",
    "--no-tags",
    "--no-write-fetch-head",
    remoteLocation,
    ...uniqueRefs,
  ]);
}

function remoteCommitTips(root, remoteLocation) {
  if (!remoteLocation) {
    throw new Error("pre-push remote location is required for a new ref");
  }
  const output = git(root, ["ls-remote", "--heads", "--tags", remoteLocation]);
  if (!output.trim()) return [];
  const rows = output
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/, 2));
  const missingRefs = rows
    .filter(([oid]) => !hasObject(root, oid))
    .map(([, ref]) => ref);
  fetchRemoteRefs(root, remoteLocation, missingRefs);
  const tips = [];
  for (const [oid] of rows) {
    try {
      tips.push(git(root, ["rev-parse", "--verify", `${oid}^{commit}`]).trim());
    } catch {
      // Non-commit tag targets do not provide a commit baseline.
    }
  }
  return [...new Set(tips)];
}

function ensureRemoteCommit(root, remoteLocation, remoteRef, remoteSha) {
  if (hasObject(root, remoteSha)) return;
  if (!remoteLocation || !remoteRef) {
    throw new Error(`remote commit is unavailable: ${remoteSha}`);
  }
  fetchRemoteRefs(root, remoteLocation, [remoteRef]);
  if (!hasObject(root, remoteSha)) {
    throw new Error(`remote commit is unavailable after fetch: ${remoteSha}`);
  }
}

function pendingCommits(root, localSha, remoteSha, remoteRef, remoteLocation) {
  if (remoteSha && !isNullOid(remoteSha)) {
    ensureRemoteCommit(root, remoteLocation, remoteRef, remoteSha);
    return git(root, ["rev-list", `${remoteSha}..${localSha}`])
      .split("\n")
      .filter(Boolean);
  }
  const remoteTips = remoteCommitTips(root, remoteLocation);
  const args = ["rev-list", localSha];
  if (remoteTips.length > 0) args.push("--not", ...remoteTips);
  return git(root, args)
    .split("\n")
    .filter(Boolean);
}

function readPushTuples() {
  return readFileSync(0, "utf8")
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((tuple) => tuple.length === 4);
}

function formatViolation(violation) {
  const location = violation.path ?? violation.ref ?? violation.sha ?? "repository";
  return `[${violation.code}] ${location}`;
}

export function runCli(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const root = resolve(options.root ?? process.cwd());
  const owner = resolveOwner(root, options);
  const buildOutputPaths = [
    ...options.buildOutputPaths,
    ...(process.env.REPOSITORY_POLICY_BUILD_OUTPUTS ?? "")
      .split(",")
      .filter(Boolean),
  ];
  const violations = [];

  if (options.mode === "pre-push") {
    for (const [localRef, localSha, remoteRef, remoteSha] of readPushTuples()) {
      if (isNullOid(localSha)) continue;
      violations.push(...validateRefName(localRef));
      violations.push(...validateRefName(remoteRef));
      violations.push(
        ...inspectCommitList(
          root,
          pendingCommits(
            root,
            localSha,
            remoteSha,
            remoteRef,
            options.remoteLocation,
          ),
          owner,
        ),
      );
      violations.push(
        ...scanCandidateTree(root, {
          revision: localSha,
          buildOutputPaths,
        }),
      );
    }
  } else if (options.mode === "ci") {
    const revision = options.revision ?? "HEAD";
    violations.push(...validateRefName(process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF || ""));
    violations.push(
      ...(options.range
        ? inspectCommitRange(root, options.range, owner)
        : inspectCommitList(root, [revision], owner)),
    );
    violations.push(...scanCandidateTree(root, { revision, buildOutputPaths }));
    if (options.requireCaller) {
      violations.push(...validatePolicyCaller(root, revision));
    }
  } else if (options.mode === "audit") {
    const branch = git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    violations.push(...validateRefName(`refs/heads/${branch}`));
    violations.push(
      ...inspectCommits(
        root,
        [
          {
            sha: "working-config",
            authorName: readConfig(root, "user.name")[0] ?? "",
            authorEmail: readConfig(root, "user.email")[0] ?? "",
            committerName: readConfig(root, "user.name")[0] ?? "",
            committerEmail: readConfig(root, "user.email")[0] ?? "",
            body: "",
          },
        ],
        owner,
      ),
    );
    violations.push(...scanCandidateTree(root, { buildOutputPaths }));
    for (const path of git(root, ["diff", "--name-only", "-z"])
      .split("\0")
      .filter(Boolean)) {
      violations.push({ code: "unstaged-tree-drift", path });
    }
    if (options.requireCaller) {
      violations.push(...validatePolicyCaller(root));
    }
  } else {
    throw new Error("--mode must be audit, pre-push, or ci");
  }

  if (violations.length > 0) {
    process.stderr.write("Repository policy blocked this operation:\n");
    process.stderr.write(`${violations.map(formatViolation).join("\n")}\n`);
    return 1;
  }
  process.stdout.write("Repository policy passed.\n");
  return 0;
}

const isDirectExecution =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    process.stderr.write(
      `Repository policy failed closed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 2;
  }
}
