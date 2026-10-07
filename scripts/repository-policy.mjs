#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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

import {
  AI_ENGINEERING_REVIEW_PATH,
  aiEngineeringReviewViolations,
  validateAiEngineeringReviewContract,
} from "./ai-engineering-policy.mjs";

export { AI_ENGINEERING_REVIEW_PATH, validateAiEngineeringReviewContract };

const MAX_IN_MEMORY_BLOB = 32 * 1024 * 1024;
const EVIDENCE_ARCHITECTURE_SECTIONS = Object.freeze([
  "runtime",
  "githubActions",
  "preview",
  "sequence",
  "canary",
]);
const EVIDENCE_ARCHITECTURE_STATUSES = new Set([
  "implemented",
  "planned",
  "unavailable",
  "not_applicable",
  "unverified",
]);
const EVIDENCE_MEANINGFUL_STEP_FIELDS = Object.freeze([
  "title",
  "purpose",
  "designReason",
  "scope",
  "expected",
  "risks",
  "observed",
  "proof",
]);

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

export const DEFAULT_PUBLIC_OUTPUT_ONLY_TERMS = Object.freeze([
  String.fromCodePoint(0x9762, 0x8bd5),
]);

export const RETIRED_REF_TOKENS = Object.freeze([
  String.fromCodePoint(0x68, 0x6f, 0x6d, 0x65, 0x77, 0x6f, 0x72, 0x6b),
  String.fromCodePoint(0x79, 0x69, 0x64, 0x65, 0x6e, 0x67),
  String.fromCodePoint(0x79, 0x64),
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
const NON_PRODUCT_DOCUMENTATION_PREFIXES = Object.freeze([
  "archive/",
  "docs/architecture/",
  "docs/delivery/",
  "docs/evidence/",
  "docs/homework/",
  "docs/qa/",
  "docs/superpowers/plans/",
  "docs/superpowers/specs/",
]);
const TEST_FILE = /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/i;
const VERIFICATION_SCRIPT =
  /^scripts\/(?:validate|verify)-[a-z0-9-]+(?:\.(?:test|spec))?\.[cm]?[jt]s$/i;

function git(root, args, options = {}) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: options.encoding ?? "utf8",
    env: options.env,
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

function isNonProductProjectMaterial(path) {
  const projectPath = path.replaceAll("\\", "/");
  return (
    NON_PRODUCT_DOCUMENTATION_PREFIXES.some((prefix) =>
      projectPath.startsWith(prefix),
    ) ||
    TEST_FILE.test(projectPath) ||
    VERIFICATION_SCRIPT.test(projectPath)
  );
}

function inspectBuffer(buffer, blockedTerms, allowInvalidEncoding = false) {
  if (buffer.includes(0)) return { binary: true, policyTerms: [] };
  try {
    const content = new TextDecoder("utf-8", { fatal: !allowInvalidEncoding }).decode(buffer);
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
    ? ["ls-tree", "-r", "-z", revision]
    : ["ls-files", "--stage", "-z", "--cached"];
  // Gitlinks store a submodule commit, not readable superproject content.
  // Keep the mode metadata so only those entries are excluded, not filenames.
  const indexedPaths = git(root, args).split("\0")
    .filter((entry) => entry && !entry.startsWith("160000 "))
    .map((entry) => entry.slice(entry.indexOf("\t") + 1));
  if (revision) return indexedPaths;
  const untrackedPaths = git(root, ["ls-files", "-z", "--others", "--exclude-standard"])
    .split("\0").filter(Boolean);
  return [...new Set([...indexedPaths, ...untrackedPaths])];
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
    const inherited = options.inheritedPublicContent?.(path, buffer);
    if (inherited?.exact) continue;
    let inspection = inspectBuffer(buffer, options.blockedTerms);
    if (inspection.binary) continue;
    if (inspection.decodingFailed) {
      if (!options.inheritedEncodingFixture?.(path)) {
        violations.push({
          code: "content-decoding-failed",
          path,
          scope: options.scope,
        });
        continue;
      }
      // Keep scanning readable wording in inherited malformed test data.
      inspection = inspectBuffer(buffer, options.blockedTerms, true);
    }
    const policyTerms = inherited?.baselineSpecifications?.length
      ? inspection.policyTerms.filter((policyTerm) => {
        const termIndex = Number(policyTerm.slice("policy-term-".length)) - 1;
        const term = options.blockedTerms[termIndex];
        if (typeof term !== "string" || !term) return true;
        const candidateCount = countTextOccurrences(buffer, term);
        const baselineCounts = inherited.baselineSpecifications.map((specification) => {
          try {
            return countTextOccurrences(
              git(root, ["cat-file", "blob", specification], { encoding: "buffer" }),
              term,
            );
          } catch {
            return 0;
          }
        });
        return candidateCount > Math.min(...baselineCounts);
      })
      : inspection.policyTerms;
    for (const policyTerm of policyTerms) {
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

function countTextOccurrences(buffer, term) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer).toLowerCase();
  const needle = String(term).toLowerCase();
  let count = 0;
  let position = 0;
  while ((position = text.indexOf(needle, position)) !== -1) {
    count += 1;
    position += Math.max(needle.length, 1);
  }
  return count;
}

function evidenceManifestViolations(root, paths, revision) {
  const violations = [];
  const pathSet = new Set(paths);
  const manifests = paths.filter((path) =>
    /^public\/cases\/[^/]+\/evidence\.json$/.test(path),
  );
  for (const manifestPath of manifests) {
    let manifest;
    try {
      manifest = JSON.parse(trackedBuffer(root, manifestPath, revision).toString("utf8"));
    } catch {
      violations.push({ code: "evidence-manifest-invalid", path: manifestPath });
      continue;
    }
    if (manifest.schemaVersion !== 2 || !Array.isArray(manifest.proof) || !Array.isArray(manifest.assets)) {
      violations.push({ code: "evidence-manifest-schema-invalid", path: manifestPath });
      continue;
    }
    const assetByFile = new Map(manifest.assets.map((asset) => [asset.file, asset]));
    const caseRoot = manifestPath.slice(0, -"evidence.json".length);
    const architecture = manifest.architecture;
    if (!architecture || typeof architecture !== "object" || Array.isArray(architecture)) {
      violations.push({ code: "evidence-architecture-missing", path: manifestPath });
    } else {
      for (const section of EVIDENCE_ARCHITECTURE_SECTIONS) {
        const entry = architecture[section];
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          violations.push({
            code: "evidence-architecture-section-missing",
            path: manifestPath,
            section,
          });
          continue;
        }
        if (!EVIDENCE_ARCHITECTURE_STATUSES.has(entry.status)) {
          violations.push({
            code: "evidence-architecture-status-invalid",
            path: manifestPath,
            section,
          });
          continue;
        }
        if (section === "runtime" && entry.status !== "implemented") {
          violations.push({
            code: "evidence-runtime-architecture-required",
            path: manifestPath,
            section,
          });
        }
        if (entry.status === "implemented") {
          if (typeof entry.description !== "string" || !entry.description.trim()) {
            violations.push({
              code: "evidence-architecture-description-missing",
              path: manifestPath,
              section,
            });
          }
          const source = typeof entry.source === "string" ? entry.source.trim() : "";
          const unsafeSource =
            !source ||
            source.startsWith("/") ||
            source.includes("\\") ||
            source.split("/").some((segment) => !segment || segment === "." || segment === "..");
          if (unsafeSource) {
            violations.push({
              code: "evidence-architecture-source-unsafe",
              path: manifestPath,
              section,
            });
          } else {
            const sourcePath = `${caseRoot}${source}`;
            if (!pathSet.has(sourcePath)) {
              violations.push({
                code: "evidence-architecture-source-untracked",
                path: sourcePath,
                section,
              });
            }
          }
        } else if (typeof entry.note !== "string" || !entry.note.trim()) {
          violations.push({
            code: "evidence-architecture-note-missing",
            path: manifestPath,
            section,
          });
        }
      }
    }
    if (!Array.isArray(manifest.meaningfulSteps) || manifest.meaningfulSteps.length === 0) {
      violations.push({ code: "evidence-meaningful-steps-missing", path: manifestPath });
    } else {
      manifest.meaningfulSteps.forEach((step, index) => {
        if (!step || typeof step !== "object" || Array.isArray(step)) {
          violations.push({
            code: "evidence-meaningful-step-invalid",
            path: manifestPath,
            index,
          });
          return;
        }
        for (const field of EVIDENCE_MEANINGFUL_STEP_FIELDS) {
          if (typeof step[field] !== "string" || !step[field].trim()) {
            violations.push({
              code: "evidence-meaningful-step-field-missing",
              path: manifestPath,
              index,
              field,
            });
          }
        }
      });
    }
    for (const proof of manifest.proof) {
      if (typeof proof.asset !== "string" || !proof.asset.trim()) {
        violations.push({ code: "evidence-proof-asset-missing", path: manifestPath });
        continue;
      }
      if (!proof.lookFor || !proof.proves) {
        violations.push({ code: "evidence-proof-guide-missing", path: manifestPath });
      }
      const metadata = assetByFile.get(proof.asset);
      const assetPath = `${caseRoot}assets/${proof.asset}`;
      if (!metadata || !pathSet.has(assetPath)) {
        violations.push({ code: "evidence-proof-asset-untracked", path: assetPath });
        continue;
      }
      const content = trackedBuffer(root, assetPath, revision);
      const hash = createHash("sha256").update(content).digest("hex");
      if (metadata.bytes !== content.length || metadata.sha256 !== hash) {
        violations.push({ code: "evidence-proof-integrity-mismatch", path: assetPath });
      }
    }
  }
  return violations;
}

export function scanCandidateTree(root, options = {}) {
  const repositoryRoot = resolve(root);
  const blockedTerms = options.blockedTerms ?? DEFAULT_BLOCKED_TERMS;
  const revision = options.revision;
  const publicOutputOnlyTerms =
    options.publicOutputOnlyTerms ?? DEFAULT_PUBLIC_OUTPUT_ONLY_TERMS;
  const candidatePaths = trackedPaths(repositoryRoot, revision);
  const violations = contentViolations(
    repositoryRoot,
    candidatePaths.filter(
      (path) => !isNonProductProjectMaterial(path),
    ),
    {
      blockedTerms,
      read: (path) => trackedBuffer(repositoryRoot, path, revision),
      isBinary: (path) => trackedBlobIsBinary(repositoryRoot, path, revision),
      inheritedPublicContent: inheritedPublicContentChecker(
        repositoryRoot,
        revision,
        options.publicContentBaselines ?? [],
      ),
      inheritedEncodingFixture: inheritedEncodingFixtureChecker(
        repositoryRoot, revision, options.encodingBaselines ?? [],
      ),
      scope: "tracked-tree",
    },
  );
  violations.push(...evidenceManifestViolations(repositoryRoot, candidatePaths, revision));
  violations.push(
    ...aiEngineeringReviewViolations({
      paths: candidatePaths,
      read: (path) => trackedBuffer(repositoryRoot, path, revision),
      isExcluded: isExcludedPath,
      isNonProduct: isNonProductProjectMaterial,
    }),
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
          blockedTerms: [...blockedTerms, ...publicOutputOnlyTerms],
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
  const forbidden = [
    ...AUTOMATION_IDENTITIES,
    ...DEFAULT_BLOCKED_TERMS,
    ...RETIRED_REF_TOKENS,
  ];
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
      const [
        sha,
        parents,
        authorName,
        authorEmail,
        committerName,
        committerEmail,
        ...body
      ] = record.split("\u001f");
      return {
        sha,
        parents: parents.trim() ? parents.trim().split(/\s+/) : [],
        authorName,
        authorEmail,
        committerName,
        committerEmail,
        body: body.join("\u001f"),
      };
    });
}

function inspectCommits(root, commits, owner, context = process.env) {
  const violations = [];
  const ownerName = normalized(owner?.name);
  const ownerEmails = new Set((owner?.emails ?? []).map(normalized));
  if (!ownerName) {
    return [{ code: "owner-identity-missing" }];
  }

  for (const commit of commits) {
    const parentCount = commit.parents.length;
    const githubNoreplyMatch = commit.authorEmail.match(
      /^\d+\+([^@]+)@users\.noreply\.github\.com$/i,
    );
    const trustedGitHubMerge =
      parentCount === 2 &&
      normalized(commit.committerName) === "github" &&
      normalized(commit.committerEmail) === "noreply@github.com" &&
      githubNoreplyMatch !== null &&
      normalized(githubNoreplyMatch[1]) === ownerName;
    const trustedGitHubSquash =
      parentCount === 1 &&
      normalized(commit.committerName) === "github" &&
      normalized(commit.committerEmail) === "noreply@github.com" &&
      githubNoreplyMatch !== null &&
      normalized(githubNoreplyMatch[1]) === ownerName &&
      normalized(context.GITHUB_ACTOR) === ownerName &&
      context.GITHUB_EVENT_NAME === "push" &&
      context.GITHUB_SHA === commit.sha &&
      context.GITHUB_REF ===
        `refs/heads/${context.REPOSITORY_POLICY_DEFAULT_BRANCH}` &&
      /\(#\d+\)\s*$/.test(commit.body.split("\n", 1)[0]);
    const trustedGitHubPlatformCommit =
      trustedGitHubMerge || trustedGitHubSquash;
    const authorMatches =
      normalized(commit.authorName) === ownerName &&
      (ownerEmails.size === 0 || ownerEmails.has(normalized(commit.authorEmail)));
    const committerMatches =
      normalized(commit.committerName) === ownerName &&
      (ownerEmails.size === 0 || ownerEmails.has(normalized(commit.committerEmail)));

    if (!authorMatches && !trustedGitHubPlatformCommit) {
      violations.push({ code: "author-owner-mismatch", sha: commit.sha });
    }
    if (!committerMatches && !trustedGitHubPlatformCommit) {
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

export function inspectCommitRange(root, range, owner, context = process.env) {
  const format = "%H%x1f%P%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B%x1e";
  const output = git(root, ["log", `--format=${format}`, range]);
  return inspectCommits(root, parseCommitLog(output), owner, context);
}

function inspectCommitList(root, revisions, owner) {
  if (revisions.length === 0) return [];
  const format = "%H%x1f%P%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B%x1e";
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
    git(root, ["cat-file", "-e", revision], {
      env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
    });
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
  const tips = [];
  for (const [oid] of rows) {
    // Only exclude commits proven present on the destination remote. Missing
    // unrelated tips stay out of the exclusion set: that audits more commits,
    // never fewer, and avoids fetching every old tag in a partial clone.
    if (!hasObject(root, oid)) continue;
    try {
      tips.push(git(root, ["rev-parse", "--verify", `${oid}^{commit}`], {
        env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
      }).trim());
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

function parseGitHubRemote(remoteLocation) {
  const value = String(remoteLocation ?? "").trim();
  let match = value.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  if (!match) match = value.match(/^git@github\.com:([^/]+)\/([^/]+)$/i);
  if (!match) return undefined;
  const owner = match[1];
  const repository = match[2].replace(/\.git$/i, "");
  if (
    !/^[A-Za-z0-9_.-]+$/.test(owner) ||
    !/^[A-Za-z0-9_.-]+$/.test(repository) ||
    owner === "." || owner === ".." || repository === "." || repository === ".."
  ) return undefined;
  return { owner, repository, slug: `${owner}/${repository}` };
}

function githubApiJson(endpoint) {
  const result = spawnSync("gh", ["api", "--hostname", "github.com", endpoint], {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
  });
  if (result.error || result.status !== 0) return undefined;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return undefined;
  }
}

function verifiedForkMetadata(remoteLocation, owner) {
  const remote = parseGitHubRemote(remoteLocation);
  if (!remote || !normalized(owner?.name)) return undefined;
  const repository = githubApiJson(`repos/${remote.slug}`);
  if (
    !repository ||
    repository.fork !== true ||
    normalized(repository.owner?.login) !== normalized(owner.name) ||
    normalized(repository.full_name) !== normalized(remote.slug) ||
    !repository.parent ||
    repository.parent.private !== false ||
    repository.parent.visibility !== "public" ||
    typeof repository.parent.full_name !== "string" ||
    typeof repository.parent.default_branch !== "string" ||
    !repository.parent.default_branch
  ) return undefined;
  const parentMatch = repository.parent.full_name.match(/^([^/]+)\/([^/]+)$/);
  if (!parentMatch || !/^[A-Za-z0-9_.-]+$/.test(parentMatch[1]) || !/^[A-Za-z0-9_.-]+$/.test(parentMatch[2])) {
    return undefined;
  }
  return {
    slug: repository.parent.full_name,
    defaultBranch: repository.parent.default_branch,
  };
}

function verifiesUpstreamAncestor(parent, commit) {
  const endpoint = `repos/${parent.slug}/compare/${encodeURIComponent(commit)}...${encodeURIComponent(parent.defaultBranch)}`;
  const comparison = githubApiJson(endpoint);
  const status = comparison?.status;
  return (
    (status === "ahead" || status === "identical") &&
    normalized(comparison.base_commit?.sha) === normalized(commit) &&
    normalized(comparison.merge_base_commit?.sha) === normalized(commit)
  );
}

function verifiedForkMergeParents(root, localSha, remoteLocation, owner) {
  const mergeCommits = git(root, ["rev-list", "--merges", "--max-count=5", localSha])
    .split("\n")
    .filter(Boolean)
    .filter((commit) =>
      git(root, ["show", "-s", "--format=%P", commit]).trim().split(/\s+/).filter(Boolean).length === 2,
    );
  if (mergeCommits.length === 0) return [];
  const parent = verifiedForkMetadata(remoteLocation, owner);
  if (!parent) return [];
  const verified = [];
  for (const mergeCommit of mergeCommits) {
    const parents = git(root, ["show", "-s", "--format=%P", mergeCommit]).trim().split(/\s+/);
    const upstreamSide = parents[1];
    if (/^[0-9a-f]{40,64}$/i.test(upstreamSide) && verifiesUpstreamAncestor(parent, upstreamSide)) {
      verified.push(upstreamSide);
    }
  }
  return [...new Set(verified)];
}

function pendingPush(root, localSha, remoteSha, remoteRef, remoteLocation, owner) {
  let commits;
  let encodingBaselines;
  if (remoteSha && !isNullOid(remoteSha)) {
    ensureRemoteCommit(root, remoteLocation, remoteRef, remoteSha);
    commits = git(root, ["rev-list", `${remoteSha}..${localSha}`]).split("\n").filter(Boolean);
    encodingBaselines = [remoteSha];
  } else {
    const remoteTips = remoteCommitTips(root, remoteLocation);
    const args = ["rev-list", localSha];
    if (remoteTips.length > 0) args.push("--not", ...remoteTips);
    commits = git(root, args).split("\n").filter(Boolean);
    encodingBaselines = remoteTips;
  }

  const publicContentBaselines = verifiedForkMergeParents(
    root,
    localSha,
    remoteLocation,
    owner,
  );
  const upstreamHistory = new Set();
  for (const baseline of publicContentBaselines) {
    for (const sha of git(root, ["rev-list", baseline]).split("\n").filter(Boolean)) {
      upstreamHistory.add(sha);
    }
  }
  return {
    commits: commits.filter((commit) => !upstreamHistory.has(commit)),
    encodingBaselines,
    publicContentBaselines,
  };
}

function trackedTreeEntries(root, revision) {
  const entries = new Map();
  for (const record of git(root, ["ls-tree", "-r", "-z", revision]).split("\0")) {
    if (!record) continue;
    const separator = record.indexOf("\t");
    if (separator === -1) continue;
    const [mode, type, oid] = record.slice(0, separator).split(" ");
    if (type !== "blob" || !/^100(?:644|755)$/.test(mode ?? "") || !/^[0-9a-f]{40,64}$/i.test(oid ?? "")) continue;
    entries.set(record.slice(separator + 1), { mode, oid });
  }
  return entries;
}

function inheritedPublicContentChecker(root, revision, baselines) {
  const matches = new Map();
  if (!revision || baselines.length === 0) return () => undefined;
  const uniqueBaselines = [...new Set(baselines)];
  const latestBaselines = uniqueBaselines.filter((baseline) =>
    !uniqueBaselines.some((other) => {
      if (baseline === other) return false;
      return spawnSync("git", ["merge-base", "--is-ancestor", baseline, other], {
        cwd: root,
        env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
        stdio: "ignore",
      }).status === 0;
    }),
  );
  const candidateEntries = trackedTreeEntries(root, revision);

  function record(candidatePath, baselineEntry, candidateEntry) {
    if (!baselineEntry || !candidateEntry || baselineEntry.mode !== candidateEntry.mode) return;
    const match = matches.get(candidatePath) ?? { exact: false, baselineOids: new Set() };
    if (baselineEntry.oid === candidateEntry.oid) match.exact = true;
    else match.baselineOids.add(baselineEntry.oid);
    matches.set(candidatePath, match);
  }

  for (const baseline of latestBaselines) {
    const baselineEntries = trackedTreeEntries(root, baseline);
    for (const [path, candidateEntry] of candidateEntries) {
      record(path, baselineEntries.get(path), candidateEntry);
    }

    const diff = git(root, [
      "diff",
      "--find-renames",
      "--name-status",
      "-z",
      baseline,
      revision,
      "--",
    ]).split("\0").filter(Boolean);
    for (let index = 0; index < diff.length;) {
      const status = diff[index++];
      if (!/^R\d{1,3}$/.test(status)) {
        index += 1;
        continue;
      }
      const oldPath = diff[index++];
      const newPath = diff[index++];
      record(newPath, baselineEntries.get(oldPath), candidateEntries.get(newPath));
    }
  }

  return (path) => {
    const match = matches.get(path);
    if (!match) return undefined;
    if (match.exact) return { exact: true };
    const baselineSpecifications = [...match.baselineOids];
    return baselineSpecifications.length > 0 ? { baselineSpecifications } : undefined;
  };
}

function inheritedEncodingFixtureChecker(root, revision, baselines) {
  const ancestors = new Map();
  const localOnly = { env: { ...process.env, GIT_NO_LAZY_FETCH: "1" } };
  function regularFileEntry(at, path) {
    const entries = git(root, ["ls-tree", "-z", at, "--", path], localOnly).split("\0");
    return entries.find((entry) =>
      /^100(?:644|755) blob /.test(entry) && entry.slice(entry.indexOf("\t") + 1) === path,
    );
  }
  return (path) => {
    if (!revision || baselines.length === 0 ||
      !/(?:^|\/)(?:tests?|fixtures?)\//.test(path) ||
      /(?:^|\/)(?:docs?|documentation)\//i.test(path) ||
      /(?:^|\/)(?:readme|changelog|contributing|code_of_conduct)(?:\.|$)/i.test(path) ||
      /\.(?:md|mdx|markdown|mdown|mkd|rst|rest|adoc|asciidoc|org|rtf|textile|tex)$/i.test(path)) return false;
    try {
      const candidate = regularFileEntry(revision, path);
      if (!candidate) return false;
      for (const baseline of baselines) {
        if (!ancestors.has(baseline)) {
          ancestors.set(baseline, spawnSync("git", ["merge-base", "--is-ancestor", baseline, revision], {
            cwd: root, env: localOnly.env, stdio: "ignore",
          }).status === 0);
        }
        if (ancestors.get(baseline) && regularFileEntry(baseline, path) === candidate) return true;
      }
    } catch {
      // Missing objects or failed comparisons never authorize an exception.
    }
    return false;
  };
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
      const pending = pendingPush(
        root,
        localSha,
        remoteSha,
        remoteRef,
        options.remoteLocation,
        owner,
      );
      violations.push(
        ...inspectCommitList(
          root,
          pending.commits,
          owner,
        ),
      );
      violations.push(
        ...scanCandidateTree(root, {
          revision: localSha,
          encodingBaselines: pending.encodingBaselines,
          publicContentBaselines: pending.publicContentBaselines,
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
            parents: [],
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
