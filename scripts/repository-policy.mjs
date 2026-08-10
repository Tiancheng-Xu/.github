#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const NULL_SHA = "0".repeat(40);

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
const ATTRIBUTION_LINE = /^(?:co-authored-by|signed-off-by|authored-by|committed-by|generated-by|assisted-by):/im;

function git(root, args, options = {}) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: options.encoding ?? "utf8",
    input: options.input,
    maxBuffer: 32 * 1024 * 1024,
  });
}

function normalized(value) {
  return String(value ?? "").trim().toLowerCase();
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

function isText(buffer) {
  if (buffer.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

function findBlockedTerms(buffer, blockedTerms) {
  if (!isText(buffer)) return [];
  const content = buffer.toString("utf8");
  const lower = content.toLowerCase();
  return blockedTerms
    .map((term, index) => ({ term, index }))
    .filter(({ term }) => lower.includes(String(term).toLowerCase()))
    .map(({ index }) => `policy-term-${index + 1}`);
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
  return readFileSync(resolve(root, path));
}

function walkFiles(root, directory) {
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
    for (const policyTerm of findBlockedTerms(buffer, options.blockedTerms)) {
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
      scope: "tracked-tree",
    },
  );

  for (const outputPath of options.buildOutputPaths ?? []) {
    const files = walkFiles(repositoryRoot, outputPath);
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
  const forbidden = [...AUTOMATION_IDENTITIES, DEFAULT_BLOCKED_TERMS[2]];
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
  const workflowPaths = trackedPaths(repositoryRoot, revision).filter((path) =>
    /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(path),
  );
  const callerReferences = [
    "Tiancheng-Xu/.github/.github/workflows/verify-repository-policy.yml@main",
    "Tiancheng-Xu/.github/.github/actions/verify-repository-policy@main",
  ];
  for (const path of workflowPaths) {
    let content;
    try {
      content = trackedBuffer(repositoryRoot, path, revision).toString("utf8");
    } catch {
      continue;
    }
    if (callerReferences.some((reference) => content.includes(reference))) {
      return [];
    }
  }
  return [{ code: "missing-policy-caller", path: ".github/workflows" }];
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

function inspectCommits(commits, owner) {
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
    const attribution = commit.body
      .split("\n")
      .filter((line) => ATTRIBUTION_LINE.test(line))
      .join("\n");
    if (containsAutomationIdentity(attribution)) {
      violations.push({ code: "automation-attribution", sha: commit.sha });
    }
  }
  return violations;
}

export function inspectCommitRange(root, range, owner) {
  const format = "%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B%x1e";
  const output = git(root, ["log", `--format=${format}`, range]);
  return inspectCommits(parseCommitLog(output), owner);
}

function inspectCommitList(root, revisions, owner) {
  if (revisions.length === 0) return [];
  const format = "%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B%x1e";
  const output = git(root, ["show", "-s", `--format=${format}`, ...revisions]);
  return inspectCommits(parseCommitLog(output), owner);
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

function pendingCommits(root, localSha, remoteSha) {
  if (remoteSha && remoteSha !== NULL_SHA) {
    return git(root, ["rev-list", `${remoteSha}..${localSha}`])
      .split("\n")
      .filter(Boolean);
  }
  return git(root, ["rev-list", localSha, "--not", "--remotes"])
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
    for (const [localRef, localSha, , remoteSha] of readPushTuples()) {
      if (localSha === NULL_SHA) continue;
      violations.push(...validateRefName(localRef));
      violations.push(
        ...inspectCommitList(root, pendingCommits(root, localSha, remoteSha), owner),
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
