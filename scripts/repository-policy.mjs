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
const PERFORMANCE_EVIDENCE_PATH = "docs/evidence/performance-observability.json";
const PERFORMANCE_EVIDENCE_EXEMPT_REPOSITORIES = new Set([
  "tiancheng-xu/personal-skills",
  "tiancheng-xu/fullstack-showcase",
]);
const PERFORMANCE_EVIDENCE_PROFILES = new Set(["compact", "full"]);
const PERFORMANCE_EVIDENCE_STATUSES = new Set([
  "planned",
  "implemented",
  "verified",
]);
const PERFORMANCE_EVIDENCE_METRICS = Object.freeze([
  "LCP",
  "CLS",
  "INP",
  "FCP",
  "TTFB",
]);
const PERFORMANCE_EVIDENCE_PERCENTILES = Object.freeze(["p50", "p75", "p95"]);
const PERFORMANCE_EVIDENCE_DIMENSIONS = Object.freeze([
  "sample_count",
  "time_window",
  "route",
  "release",
]);
const PERFORMANCE_EVIDENCE_PIPELINE = Object.freeze([
  "browser-sdk",
  "api",
  "sqs-dlq",
  "ecs-cleaner",
  "storage",
  "dashboard",
]);
const PERFORMANCE_EVIDENCE_SAFETY = Object.freeze([
  "schema-validation",
  "pii-redaction",
  "no-browser-aws-credentials",
  "sdk-failure-isolation",
]);
const PERFORMANCE_EVIDENCE_PROOF_KINDS = Object.freeze([
  "live-event",
  "queue",
  "ecs-cleaner",
  "aggregate",
  "dashboard",
  "failure-retry",
]);
const FULL_PERFORMANCE_FILTERS = Object.freeze([
  "time_window",
  "environment",
  "release",
  "route",
]);
const FULL_PERFORMANCE_VIEWS = Object.freeze([
  "trend",
  "error_rate",
  "route_comparison",
  "slow_requests",
]);
const FULL_PERFORMANCE_RESILIENCE = Object.freeze([
  "retry",
  "dlq",
  "idempotency",
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
    input: options.input,
    maxBuffer: 512 * 1024 * 1024,
  });
}

function normalized(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizeRepositoryIdentifier(value) {
  const candidate = String(value ?? "").trim().replace(/\/$/, "");
  const githubMatch = candidate.match(
    /github\.com(?::|\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i,
  );
  if (githubMatch) return normalized(`${githubMatch[1]}/${githubMatch[2]}`);
  const repositoryMatch = candidate.match(/^([^/\s]+)\/([^/\s]+)$/);
  return repositoryMatch
    ? normalized(`${repositoryMatch[1]}/${repositoryMatch[2].replace(/\.git$/i, "")}`)
    : "";
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

function includesAll(values, required) {
  if (!Array.isArray(values)) return false;
  const candidates = new Set(values.map((value) => String(value)));
  return required.every((value) => candidates.has(value));
}

function performanceEvidenceViolations(root, paths, revision, repositoryId) {
  const violations = [];
  const pathSet = new Set(paths);
  const publishPath = ".github/baby2b-publish.yml";
  if (!pathSet.has(publishPath)) return violations;

  const normalizedRepository = normalizeRepositoryIdentifier(repositoryId);
  if (PERFORMANCE_EVIDENCE_EXEMPT_REPOSITORIES.has(normalizedRepository)) {
    return violations;
  }

  let publishManifest;
  try {
    publishManifest = trackedBuffer(root, publishPath, revision).toString("utf8");
  } catch {
    return violations;
  }
  if (!/^site-kind:\s*project\s*$/m.test(publishManifest)) return violations;

  if (!pathSet.has(PERFORMANCE_EVIDENCE_PATH)) {
    return [{ code: "performance-evidence-contract-missing", path: PERFORMANCE_EVIDENCE_PATH }];
  }

  let contract;
  try {
    contract = JSON.parse(
      trackedBuffer(root, PERFORMANCE_EVIDENCE_PATH, revision).toString("utf8"),
    );
  } catch {
    return [{ code: "performance-evidence-contract-invalid", path: PERFORMANCE_EVIDENCE_PATH }];
  }

  if (
    contract.schemaVersion !== 1 ||
    !PERFORMANCE_EVIDENCE_PROFILES.has(contract.profile) ||
    !PERFORMANCE_EVIDENCE_STATUSES.has(contract.status)
  ) {
    violations.push({ code: "performance-evidence-contract-schema-invalid", path: PERFORMANCE_EVIDENCE_PATH });
    return violations;
  }
  if (typeof contract.summary !== "string" || !contract.summary.trim()) {
    violations.push({ code: "performance-evidence-summary-missing", path: PERFORMANCE_EVIDENCE_PATH });
  }
  if (!/^https:\/\//.test(String(contract.evidenceUrl ?? ""))) {
    violations.push({ code: "performance-evidence-url-invalid", path: PERFORMANCE_EVIDENCE_PATH });
  }
  if (!Array.isArray(contract.limitations) || contract.limitations.length === 0) {
    violations.push({ code: "performance-evidence-limitations-missing", path: PERFORMANCE_EVIDENCE_PATH });
  }

  if (contract.status === "planned") {
    if (typeof contract.nextStep !== "string" || !contract.nextStep.trim()) {
      violations.push({ code: "performance-evidence-next-step-missing", path: PERFORMANCE_EVIDENCE_PATH });
    }
    return violations;
  }

  if (!new Set(["live", "mixed"]).has(contract.dataMode)) {
    violations.push({ code: "performance-evidence-live-data-required", path: PERFORMANCE_EVIDENCE_PATH });
  }
  for (const [field, required] of [
    ["metrics", PERFORMANCE_EVIDENCE_METRICS],
    ["percentiles", PERFORMANCE_EVIDENCE_PERCENTILES],
    ["dimensions", PERFORMANCE_EVIDENCE_DIMENSIONS],
    ["pipeline", PERFORMANCE_EVIDENCE_PIPELINE],
    ["safety", PERFORMANCE_EVIDENCE_SAFETY],
  ]) {
    if (!includesAll(contract[field], required)) {
      violations.push({
        code: `performance-evidence-${field.replaceAll("_", "-")}-incomplete`,
        path: PERFORMANCE_EVIDENCE_PATH,
      });
    }
  }

  const proofKinds = Array.isArray(contract.proof)
    ? contract.proof
        .filter(
          (proof) =>
            proof &&
            typeof proof === "object" &&
            typeof proof.kind === "string" &&
            typeof proof.location === "string" &&
            proof.location.trim() &&
            typeof proof.proves === "string" &&
            proof.proves.trim(),
        )
        .map((proof) => proof.kind)
    : [];
  if (!includesAll(proofKinds, PERFORMANCE_EVIDENCE_PROOF_KINDS)) {
    violations.push({ code: "performance-evidence-live-proof-incomplete", path: PERFORMANCE_EVIDENCE_PATH });
  }

  if (contract.profile === "full") {
    for (const [field, required] of [
      ["filters", FULL_PERFORMANCE_FILTERS],
      ["views", FULL_PERFORMANCE_VIEWS],
      ["resilience", FULL_PERFORMANCE_RESILIENCE],
    ]) {
      if (!includesAll(contract[field], required)) {
        violations.push({
          code: `performance-evidence-full-${field}-incomplete`,
          path: PERFORMANCE_EVIDENCE_PATH,
        });
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
      scope: "tracked-tree",
    },
  );
  violations.push(...evidenceManifestViolations(repositoryRoot, candidatePaths, revision));
  violations.push(
    ...performanceEvidenceViolations(
      repositoryRoot,
      candidatePaths,
      revision,
      options.repositoryId,
    ),
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

function resolveRepositoryId(root, options) {
  return normalizeRepositoryIdentifier(
    options.repositoryId ??
      process.env.GITHUB_REPOSITORY ??
      options.remoteLocation ??
      readConfig(root, "remote.origin.url")[0],
  );
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
    else if (argument === "--repository") options.repositoryId = value;
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
  const repositoryId = resolveRepositoryId(root, options);
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
          repositoryId,
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
    violations.push(...scanCandidateTree(root, { revision, buildOutputPaths, repositoryId }));
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
    violations.push(...scanCandidateTree(root, { buildOutputPaths, repositoryId }));
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
