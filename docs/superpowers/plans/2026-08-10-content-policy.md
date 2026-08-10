# Repository Content Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce human authorship, safe ref names, sanitized public content, and centralized GitHub verification across every current and future project repository.

**Architecture:** A single Node policy engine in `Tiancheng-Xu/.github` serves the Mac global pre-push hook and a reusable GitHub Action. Repository caller workflows invoke the central verifier, while TC Flow treats its result as a blocking N7/N8 delivery gate.

**Tech Stack:** Node.js 22, Git plumbing commands, POSIX shell, Node test runner, GitHub reusable workflows/actions, TC Flow Markdown/templates.

## Global Constraints

- Git Author and Committer must resolve to the configured human repository owner.
- Automation/model attribution is prohibited in commit metadata and trailers.
- Public source and generated output must not contain configured product-only wording or retired aliases.
- The private no-origin learning-notes repository remains read-only and is not modified.
- Existing remote history is not rewritten.
- Production deployment, public visibility changes, and destructive cleanup remain separately authorized actions.

---

### Task 1: Central policy engine

**Files:**
- Create: `scripts/repository-policy.mjs`
- Create: `scripts/git-hooks/pre-push`
- Create: `tests/repository-policy.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `scanCandidateTree(root, options)`, `inspectCommitRange(range, owner)`, `validateRefName(ref)`, and CLI modes `pre-push` and `ci`.
- Consumes: Git pre-push tuples, GitHub event ranges, global owner configuration, and optional build-output paths.

- [ ] Write failing Node tests for human ownership, automation attribution, unsafe refs, full-tree content, generated output, binary/vendor exclusions, and first-push legacy cleanup.
- [ ] Run `node --test tests/repository-policy.test.mjs` and confirm failures are caused by the missing policy module.
- [ ] Implement the smallest policy engine and pre-push adapter that satisfies the contract.
- [ ] Re-run the focused test and the repository's existing test suite.
- [ ] Commit with the configured human owner identity.

### Task 2: Central reusable GitHub verification

**Files:**
- Create: `.github/actions/verify-repository-policy/action.yml`
- Create: `.github/workflows/verify-repository-policy.yml`
- Create: `tests/verify-repository-policy-workflow.test.mjs`
- Modify: `.github/workflows/verify-project.yml`

**Interfaces:**
- Produces: reusable workflow `Tiancheng-Xu/.github/.github/workflows/verify-repository-policy.yml@main`.
- Consumes: caller checkout, event before/after SHAs, and the centrally fixed owner
  policy. Build output is accepted only by the action after the shared project verifier
  has run the real build.

- [ ] Write failing workflow-contract tests requiring checkout, full-history availability, fixed owner identity, policy action invocation, and separation between source-only and post-build verification.
- [ ] Run the focused test and observe the missing workflow/action failure.
- [ ] Add the action and reusable workflow; make `verify-project.yml` call the same action rather than duplicate checks.
- [ ] Run all central repository tests and validate YAML references.
- [ ] Commit with the configured human owner identity.

### Task 3: Mac global hook migration

**Files:**
- Modify global Git config: `core.hooksPath`
- Modify compatibility hook in `baby2b-online-deployment-evidence/scripts/git-hooks/pre-push`
- Test using temporary Git fixtures only.

**Interfaces:**
- Produces: every local repository invokes the central policy before push.
- Consumes: the checked-out central policy repository and optional repository-local pre-push hook.

- [ ] Point a temporary fixture's hook path at the central hook and verify a compliant owner push passes.
- [ ] Verify an unsafe author/ref/content fixture is blocked with a deterministic message.
- [ ] Replace the global hook path only after both fixture outcomes pass.
- [ ] Convert the Evidence hook to a compatibility wrapper or document its retirement without duplicating policy logic.
- [ ] Record the effective global Git config and executable hook hash.

### Task 4: TC Flow integration

**Files:**
- Modify: `/Users/shier/.codex/skills/tc-flow/SKILL.md`
- Modify relevant files under `/Users/shier/.codex/skills/tc-flow/assets/tc-flow-template/commands/tc-flow-nodes/`
- Modify relevant policy under `/Users/shier/.codex/skills/tc-flow/assets/tc-flow-template/policies/`
- Test: TC Flow pressure scenario and skill validator.

**Interfaces:**
- Produces: N7 audit and N8 blocking policy calls before commit/push.
- Consumes: central `repository-policy` CLI, current worktree/ref, build output, and owner config.

- [ ] Capture the baseline pressure-scenario behavior without the new skill guidance.
- [ ] Add concise N7/N8 requirements that call the central policy and reject missing callers.
- [ ] Update the canonical template nodes/policy, not the read-only notes copy.
- [ ] Run the same pressure scenario and verify the delivery is blocked until all policy evidence exists.
- [ ] Run the skill validator and record file hashes.

### Task 5: Remote inventory and audit

**Files:**
- Create: `scripts/audit-owner-repositories.mjs`
- Create: `tests/audit-owner-repositories.test.mjs`
- Create private local audit output outside tracked public content.

**Interfaces:**
- Produces: per-repository status for default branch, existing caller, legacy violations, Actions availability, and deployment risk.
- Consumes: GitHub repository list and read-only clones/fetches.

- [ ] Write a failing test for public/private/empty repository classification and deterministic output.
- [ ] Implement read-only inventory for all 13 current repositories.
- [ ] Audit each default branch and record exact violations without copying private content into logs.
- [ ] Classify repositories that may auto-deploy from the default branch.
- [ ] Review the audit before any remote mutation.

### Task 6: Repository caller rollout

**Files:**
- Create per repository: `.github/workflows/repository-policy.yml`
- Repair first-party public wording only where the audit requires it.

**Interfaces:**
- Produces: one byte-for-byte canonical policy caller PR per non-empty repository and
  an explicit record for empty repositories.
- Consumes: central reusable workflow published on its default branch.

- [ ] Publish and verify the central policy before creating callers.
- [ ] Create isolated branches and caller commits with the human owner identity.
- [ ] Open PRs and require the policy check; do not merge deployment-triggering branches without the production action boundary.
- [ ] Verify every PR check and preserve URLs/commit hashes as evidence.
- [ ] Update the inventory status without claiming unmerged repositories are protected.

### Task 7: Resume Personal AI Agent delivery

**Files:**
- Modify public Personal AI Agent source, README, architecture, acceptance mapping, and generated screenshots.

**Interfaces:**
- Produces: a clean project tree and regenerated Desktop/H5 evidence under the new policy.
- Consumes: the completed local gate and central workflow contract.

- [ ] Add a failing project test that detects configured product-only wording in source and build output.
- [ ] Sanitize public copy and retain private evidence without publishing it.
- [ ] Run project tests, type checks, build, link checks, and the repository policy.
- [ ] Regenerate Desktop/H5 screenshots in the in-app browser.
- [ ] Continue the previously approved Agent architecture work only after the policy gate passes.
