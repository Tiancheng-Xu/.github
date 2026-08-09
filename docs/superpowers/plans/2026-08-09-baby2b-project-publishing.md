# Baby2B Project Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and pilot a reusable publishing standard that gives every deployable `Tiancheng-Xu` web repository a verified `*.baby2b.online` production URL and a reciprocal Evidence URL without copying Cloudflare API tokens into each repository.

**Architecture:** A shared GitHub action validates a flat publishing manifest and the existing reusable workflow runs project quality gates. Cloudflare Pages Git Integration independently watches the same repository and production branch; proxied CNAME records attach `baby2b.online` production domains. A global Codex skill performs repository discovery, external configuration, TLS/navigation verification, and evidence capture.

**Tech Stack:** GitHub Actions, Node.js 22 built-ins, flat YAML contract, Cloudflare Pages Git Integration, Cloudflare DNS/TLS, Codex Skills, shell endpoint verification.

## Global Constraints

- Production delivery is complete only at `https://<project>.baby2b.online`; `*.pages.dev` is diagnostic and rollback infrastructure.
- Evidence lives at `https://evidence.baby2b.online/<project>/` and links reciprocally with the project page.
- GitHub Actions verifies; Cloudflare Git Integration deploys. Do not add `CLOUDFLARE_API_TOKEN` to each repository.
- Cloudflare GitHub App uses “Only select repositories”. Confirm at action time before expanding repository access.
- Preserve Direct Upload projects until Git-integrated replacements, DNS, TLS, content, and navigation all pass.
- Never commit credentials, Cloudflare identifiers, OAuth codes, private paths, private datasets, model weights, or unapproved evidence.
- Run the global authorship gate before every remote publication.
- Apply the standard to the Personal AI Agent pair first; audit remaining repositories read-only, then migrate them one at a time.

---

## File Map

### Shared standards repository: `/Users/shier/Desktop/.github`

- Create `.github/actions/verify-baby2b-publish/action.yml` — JavaScript action interface.
- Create `.github/actions/verify-baby2b-publish/index.js` — dependency-free flat YAML validator.
- Create `tests/verify-baby2b-publish.test.mjs` — validator behavior tests.
- Create `tests/verify-project-workflow.test.mjs` — reusable workflow contract tests.
- Modify `.github/workflows/verify-project.yml` — optional publishing manifest validation.
- Create `standards/baby2b-publishing.md` — durable human-readable standard.
- Modify `standards/project-delivery.md` — reference the publishing standard.

### Global skill: `/Users/shier/.codex/skills/publish-baby2b-project`

- Create `SKILL.md` — concise decision and execution workflow.
- Create `agents/openai.yaml` — skill UI metadata.
- Create `scripts/inspect-repository.sh` — read-only repository/build/workflow inventory.
- Create `scripts/verify-endpoints.sh` — public DNS, HTTPS, title, and reciprocal-link verification.
- Create `references/cloudflare-git-integration.md` — Pages Git Integration and safe migration reference.

### Product repository: `/Users/shier/Desktop/personal-ai-agent/.worktrees/portfolio-ui-cloudflare`

- Create `.github/baby2b-publish.yml` — product publishing facts.
- Modify `.github/workflows/deploy-portfolio.yml` — verify only; remove token-based Direct Upload.
- Modify `tests/deploy-portfolio-workflow.test.ts` — enforce Git Integration boundary.
- Create `tests/baby2b-publish-config.test.ts` — lock manifest values.

### Evidence repository: `/Users/shier/Desktop/course-homework/.tc-worktrees/personal-agent-evidence-site-20260809`

- Create `.github/baby2b-publish.yml` — Evidence publishing facts.
- Modify `.github/workflows/deploy-evidence.yml` — verify only; remove token-based Direct Upload.
- Modify `tests/deploy-evidence-workflow.test.mjs` — enforce Git Integration boundary.
- Create `tests/baby2b-publish-config.test.mjs` — lock manifest values.
- Modify `docs/verification/personal-ai-agent-cloudflare-release.md` — record final Git Integration migration and validation.
- Modify `public/cases/personal-ai-agent/evidence.json` — publish only sanitized final status.

---

### Task 1: Build the Shared Publishing Manifest Validator

**Files:**
- Create: `.github/actions/verify-baby2b-publish/action.yml`
- Create: `.github/actions/verify-baby2b-publish/index.js`
- Create: `tests/verify-baby2b-publish.test.mjs`

**Interfaces:**
- Consumes: `config-path` action input pointing to a flat YAML file in the caller repository.
- Produces: validated fields `slug`, `site-kind`, `production-branch`, `build-command`, `output-directory`, `pages-project`, `production-url`, `evidence-url`, and `backup-url`.

- [ ] **Step 1: Write the failing validator tests**

Create table-driven Node tests that execute `index.js` with a temporary config and `INPUT_CONFIG-PATH`:

```js
test("accepts a complete baby2b publishing manifest", () => {
  const result = runAction(`schema-version: 1
slug: personal-ai-agent
site-kind: project
production-branch: main
build-command: pnpm portfolio:build
output-directory: apps/portfolio/dist
pages-project: personal-ai-agent-site
production-url: https://personal-ai-agent.baby2b.online/
evidence-url: https://evidence.baby2b.online/personal-ai-agent/
backup-url: ""
`);
  assert.equal(result.status, 0);
});

test("rejects pages.dev as a production URL", () => {
  const result = runAction(validManifest.replace(
    "https://personal-ai-agent.baby2b.online/",
    "https://personal-ai-agent-site.pages.dev/",
  ));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /production-url.*baby2b\.online/i);
});
```

Also reject missing keys, duplicate keys, unknown keys, unsafe branch names, absolute output paths, non-HTTPS URLs, and project Evidence paths whose final slug differs.

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/verify-baby2b-publish.test.mjs`  
Expected: FAIL because the action implementation does not exist.

- [ ] **Step 3: Implement the dependency-free action**

Parse only the approved flat `key: value` grammar. Strip matching single or double quotes, reject indentation and duplicate/unknown keys, then validate:

```js
const requiredKeys = [
  "schema-version",
  "slug",
  "site-kind",
  "production-branch",
  "build-command",
  "output-directory",
  "pages-project",
  "production-url",
  "evidence-url",
  "backup-url",
];

assert(config["schema-version"] === "1", "schema-version must be 1");
assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(config.slug), "slug must be kebab-case");
assert(["project", "evidence-hub"].includes(config["site-kind"]), "site-kind is invalid");
assert(!path.isAbsolute(config["output-directory"]), "output-directory must be relative");
assert(new URL(config["production-url"]).protocol === "https:", "production-url must use HTTPS");
assert(new URL(config["production-url"]).hostname.endsWith(".baby2b.online"), "production-url must use baby2b.online");
if (config["site-kind"] === "project") {
  assert(new URL(config["evidence-url"]).pathname === `/${config.slug}/`, "evidence-url path must match slug");
} else {
  assert(config["production-url"] === config["evidence-url"], "evidence-hub URLs must match");
}
```

Write non-secret validated values to `GITHUB_OUTPUT`; never print environment variables or GitHub contexts.

- [ ] **Step 4: Run validator tests and verify GREEN**

Run: `node --test tests/verify-baby2b-publish.test.mjs`  
Expected: all manifest cases pass with no warnings.

- [ ] **Step 5: Commit**

```bash
git add .github/actions/verify-baby2b-publish tests/verify-baby2b-publish.test.mjs
git commit -m "feat: validate baby2b publishing manifests"
```

### Task 2: Integrate the Contract Into Shared Verification

**Files:**
- Create: `tests/verify-project-workflow.test.mjs`
- Modify: `.github/workflows/verify-project.yml`
- Create: `standards/baby2b-publishing.md`
- Modify: `standards/project-delivery.md`

**Interfaces:**
- Consumes: optional reusable-workflow input `publish-config-path`.
- Produces: a verified publishing contract without performing a deployment.

- [ ] **Step 1: Write the failing workflow test**

Assert the shared workflow declares an empty optional `publish-config-path`, invokes `Tiancheng-Xu/.github/.github/actions/verify-baby2b-publish@main` only when non-empty, and contains no `wrangler`, `CLOUDFLARE_API_TOKEN`, DNS mutation, or cross-repository write.

- [ ] **Step 2: Run the workflow test and verify RED**

Run: `node --test tests/verify-project-workflow.test.mjs`  
Expected: FAIL because `publish-config-path` is absent.

- [ ] **Step 3: Add the optional input and validation step**

Add:

```yaml
publish-config-path:
  required: false
  default: ""
  type: string
```

Then add after checkout:

```yaml
- name: Validate Baby2B publishing contract
  if: inputs['publish-config-path'] != ''
  uses: Tiancheng-Xu/.github/.github/actions/verify-baby2b-publish@main
  with:
    config-path: ${{ inputs['publish-config-path'] }}
```

- [ ] **Step 4: Write the durable standard**

Document the BabySteps baseline, parallel GitHub/Cloudflare paths, production-domain gate, Direct Upload migration rule, Evidence reciprocity, repository classification, and credential boundary. Link it from `project-delivery.md`.

- [ ] **Step 5: Run all shared tests and verify GREEN**

Run: `node --test tests/*.test.mjs && git diff --check`  
Expected: all tests pass.

- [ ] **Step 6: Commit, run the authorship gate, push, and merge**

```bash
git add .github standards tests
git commit -m "ci: standardize baby2b project publishing"
```

The shared action must reach `main` before caller repositories reference `@main`.

### Task 3: Create and Forward-Test the Global Publishing Skill

**Files:**
- Create: `/Users/shier/.codex/skills/publish-baby2b-project/SKILL.md`
- Create: `/Users/shier/.codex/skills/publish-baby2b-project/agents/openai.yaml`
- Create: `/Users/shier/.codex/skills/publish-baby2b-project/scripts/inspect-repository.sh`
- Create: `/Users/shier/.codex/skills/publish-baby2b-project/scripts/verify-endpoints.sh`
- Create: `/Users/shier/.codex/skills/publish-baby2b-project/references/cloudflare-git-integration.md`

**Interfaces:**
- Consumes: a local Git repository plus an optional `.github/baby2b-publish.yml`.
- Produces: a read-only audit, a gated deployment checklist, and public endpoint verification.

- [ ] **Step 1: Run the RED baseline without the skill**

Use a fresh subagent with a pressure scenario: a private Vite repository, an existing Direct Upload Pages project, a user demanding speed, a `pages.dev` URL that works, and no DNS-write token. Record whether it incorrectly declares completion, creates another token, deletes the old project, or skips reciprocal Evidence validation.

- [ ] **Step 2: Initialize the skill using the official generator**

```bash
python3 /Users/shier/.codex/skills/.system/skill-creator/scripts/init_skill.py \
  publish-baby2b-project \
  --path /Users/shier/.codex/skills \
  --resources scripts,references \
  --interface 'display_name=Publish Baby2B Project' \
  --interface 'short_description=Publish GitHub web projects safely on baby2b.online' \
  --interface 'default_prompt=Use $publish-baby2b-project to audit and publish this repository on baby2b.online.'
```

- [ ] **Step 3: Implement the minimum GREEN workflow**

The `SKILL.md` must require this sequence:

1. read-only repository and Cloudflare discovery;
2. classify Web versus non-Web;
3. verify shared workflow and manifest;
4. confirm before GitHub App permission expansion, DNS replacement, or deletion;
5. create a parallel Git-integrated Pages project when the old project is Direct Upload;
6. verify `pages.dev`, then CNAME, domain status, TLS, content, responsive UI, and reciprocal Evidence;
7. preserve rollback until a `main` push automatically deploys;
8. record sanitized problems and evidence;
9. never call `pages.dev` the final product URL.

`inspect-repository.sh` prints only repository name, branch, package manager, detected commands, workflow/config presence, and dirty status. `verify-endpoints.sh` accepts `--production-url` and `--evidence-url`, uses `dig` and `curl --fail --location`, and fails unless both pages link to each other.

- [ ] **Step 4: Validate scripts and skill metadata**

```bash
bash -n /Users/shier/.codex/skills/publish-baby2b-project/scripts/*.sh
python3 /Users/shier/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  /Users/shier/.codex/skills/publish-baby2b-project
```

Use a local fixture server to prove endpoint verification fails on a missing reciprocal link and passes when both links exist.

- [ ] **Step 5: Run the same pressure scenario WITH the skill**

Expected: the fresh subagent refuses false completion, chooses Git Integration over per-repo tokens, preserves the old project, requests action-time confirmation for permission/DNS changes, and lists all active-domain gates.

- [ ] **Step 6: Refactor only observed gaps and re-run validation**

Keep `SKILL.md` under 500 lines, maintain imperative wording, and move Cloudflare UI/API specifics to the reference file.

### Task 4: Convert the Product Repository to the Shared Contract

**Files:**
- Create: `.github/baby2b-publish.yml`
- Create: `tests/baby2b-publish-config.test.ts`
- Modify: `tests/deploy-portfolio-workflow.test.ts`
- Modify: `.github/workflows/deploy-portfolio.yml`

**Interfaces:**
- Consumes: `verify-project.yml@main` with `publish-config-path`.
- Produces: CI-only workflow and product Git Integration configuration facts.

- [ ] **Step 1: Write failing configuration and workflow tests**

Parse `.github/baby2b-publish.yml` with the existing `yaml` package and assert:

```ts
expect(config).toEqual({
  "schema-version": 1,
  slug: "personal-ai-agent",
  "site-kind": "project",
  "production-branch": "main",
  "build-command": "pnpm portfolio:build",
  "output-directory": "apps/portfolio/dist",
  "pages-project": "personal-ai-agent-site",
  "production-url": "https://personal-ai-agent.baby2b.online/",
  "evidence-url": "https://evidence.baby2b.online/personal-ai-agent/",
  "backup-url": "",
});
```

Update the workflow test to require `publish-config-path: .github/baby2b-publish.yml` and reject `wrangler`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and any `deploy` job.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm vitest run tests/baby2b-publish-config.test.ts tests/deploy-portfolio-workflow.test.ts`  
Expected: FAIL because the manifest is missing and token deployment still exists.

- [ ] **Step 3: Add the manifest and make the workflow verify-only**

Keep the `pull_request`, `push main`, and manual triggers. Pass the new input to the shared workflow and delete the token-based `deploy` job entirely.

- [ ] **Step 4: Run the full product gate and verify GREEN**

```bash
pnpm portfolio:test
pnpm check
pnpm test
pnpm portfolio:typecheck
pnpm portfolio:build
pnpm evidence:export
pnpm evidence:verify
git diff --check
```

- [ ] **Step 5: Commit**

```bash
git add .github tests
git commit -m "ci: adopt baby2b git-integrated publishing"
```

### Task 5: Convert the Evidence Repository to the Shared Contract

**Files:**
- Create: `.github/baby2b-publish.yml`
- Create: `tests/baby2b-publish-config.test.mjs`
- Modify: `tests/deploy-evidence-workflow.test.mjs`
- Modify: `.github/workflows/deploy-evidence.yml`

**Interfaces:**
- Consumes: shared manifest validator and existing public-content/navigation checks.
- Produces: CI-only Evidence workflow and Git Integration configuration facts.

- [ ] **Step 1: Write failing tests**

Assert the flat manifest contains:

```yaml
schema-version: 1
slug: evidence
site-kind: evidence-hub
production-branch: main
build-command: npm run evidence:build
output-directory: site
pages-project: baby2b-evidence
production-url: https://evidence.baby2b.online/
evidence-url: https://evidence.baby2b.online/
backup-url: ""
```

Require the workflow input and reject Wrangler/token deployment exactly as in Task 4.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/baby2b-publish-config.test.mjs tests/deploy-evidence-workflow.test.mjs`  
Expected: FAIL for missing manifest and existing token deployment.

- [ ] **Step 3: Add the manifest and verify-only workflow**

Keep all current public scanning and navigation commands inside the shared verification inputs.

- [ ] **Step 4: Run the full Evidence gate and verify GREEN**

```bash
npm test
npm run evidence:test
npm run evidence:typecheck
npm run evidence:build
npm run verify:public
npm run verify:navigation
git diff --check
```

- [ ] **Step 5: Commit**

```bash
git add .github tests
git commit -m "ci: adopt baby2b git-integrated publishing"
```

### Task 6: Create Parallel Git-Integrated Cloudflare Pages Projects

**Files:**
- Modify external Cloudflare configuration only after confirmation.
- Preserve existing Direct Upload projects `personal-ai-agent` and `baby2b-online-deployment-evidence`.

**Interfaces:**
- Consumes: GitHub repositories, `main` branches, and verified build commands/directories from Tasks 4–5.
- Produces: `personal-ai-agent-site.pages.dev` and `baby2b-evidence.pages.dev` Git-integrated deployments.

- [ ] **Step 1: Read-only preflight**

Verify both repositories are private, both PR branches contain the required manifests/workflows, Cloudflare GitHub App is installed, and existing Pages projects remain Direct Upload.

- [ ] **Step 2: Request action-time confirmation**

State exactly that Cloudflare GitHub App repository access will expand to the two named private repositories. Do not request access to all repositories.

- [ ] **Step 3: Create the product Git-integrated project**

Configure:

- repository: `Tiancheng-Xu/personal-ai-agent`;
- project: `personal-ai-agent-site`;
- production branch: `main`;
- build command: `pnpm portfolio:build`;
- output directory: `apps/portfolio/dist`;
- root directory: repository root.

- [ ] **Step 4: Create the Evidence Git-integrated project**

Configure:

- repository: `Tiancheng-Xu/baby2b-online-deployment-evidence`;
- project: `baby2b-evidence`;
- production branch: `main`;
- build command: `npm run evidence:build`;
- output directory: `site`;
- root directory: repository root.

- [ ] **Step 5: Verify default deployment URLs**

Require HTTP 2xx, expected titles, correct assets, and reciprocal links where applicable. If either build fails, capture the failure, fix source/config through TDD, and leave old projects untouched.

### Task 7: Publish, Merge, and Switch the Baby2B Domains

**Files:**
- Push the shared, product, and Evidence branches.
- Merge only after required checks pass.
- Modify Cloudflare Pages custom-domain and DNS configuration after confirmation.

**Interfaces:**
- Consumes: green PRs and working Git-integrated default domains.
- Produces: active production URLs on `baby2b.online`.

- [ ] **Step 1: Run authorship gates and publish all branches**

Confirm the pending commits are attributed to the configured human owner. Push `.github` first, wait for `main`, then update/rebase caller branches if necessary.

- [ ] **Step 2: Wait for PR checks and merge product/Evidence PRs**

Do not merge while shared action references are unavailable or any check is pending/failing.

- [ ] **Step 3: Prove automatic Git Integration deployment**

After `main` advances, verify Cloudflare created a new production deployment for each Git-integrated project without a GitHub repository API Token.

- [ ] **Step 4: Request action-time DNS confirmation**

State the exact two hostname changes and rollback targets:

- `personal-ai-agent.baby2b.online` → the new product Pages subdomain;
- `evidence.baby2b.online` → the new Evidence Pages subdomain.

- [ ] **Step 5: Move custom domains and create proxied CNAME records**

Detach pending bindings from the old Direct Upload projects only when required, attach them to the new projects, and create `proxied: true`, `ttl: auto` CNAME records.

- [ ] **Step 6: Poll authoritative gates**

Require Cloudflare domain `status`, `validation_data.status`, and `verification_data.status` to be `active`, then verify public DNS and HTTPS. Keep status `dns-pending` or `tls-pending` until every gate passes.

- [ ] **Step 7: Verify the complete public experience**

Run the skill endpoint verifier and browser checks at Desktop 1440 px and H5 390 px. Confirm titles, no critical overflow, project → Evidence, Evidence → project, and portfolio links.

### Task 8: Publish Final Evidence and Close the Migration

**Files:**
- Modify: product `apps/portfolio/src/content/project.ts`
- Modify: product content/export tests as required by the status change.
- Modify: Evidence `public/cases/personal-ai-agent/evidence.json`
- Modify: Evidence `docs/verification/personal-ai-agent-cloudflare-release.md`
- Test: existing product/Evidence content and public-scan suites.

**Interfaces:**
- Consumes: active Cloudflare/API and public-browser observations from Task 7.
- Produces: truthful final architecture, incidents, deployment proof, and limitations.

- [ ] **Step 1: Write failing status assertions**

Require the release diagram custom-domain node to be `done`, replace Direct Upload wording with Git Integration, and assert the final incident recheck says DNS/TLS/navigation are active.

- [ ] **Step 2: Run focused tests and verify RED**

Expected: FAIL while the manifest still reports pending Direct Upload migration.

- [ ] **Step 3: Update sanitized product source and regenerate Evidence**

Record the actual Pages project names, production URLs, build trigger, DNS/TLS result, and observed problems. Do not add account IDs, token material, login screenshots, private repository URLs beyond the approved public links, or raw Cloudflare logs.

- [ ] **Step 4: Run both complete verification suites**

Use the exact full commands from Tasks 4 and 5, compare the generated manifest to the Evidence repository JSON, and run public endpoint verification.

- [ ] **Step 5: Commit, push, wait for automatic deploys, and recheck production**

Capture final GitHub Actions and Cloudflare build results. Old Direct Upload projects remain available until the user separately authorizes deletion.

### Task 9: Audit Remaining GitHub Repositories

**Files:**
- No public repository inventory containing private repository names.
- Store any temporary audit under a secure local temporary directory and delete it after summarizing.

**Interfaces:**
- Consumes: GitHub repository metadata and the global skill inspection script.
- Produces: a user-facing classification of Web, library/CLI, documentation, archived, and already-published repositories.

- [ ] **Step 1: List repositories read-only**

Collect name, visibility, archived status, default branch, detected web build, current Pages settings, and existing `baby2b.online` hostname without reading secrets.

- [ ] **Step 2: Classify and prioritize**

Recommend domains only for deployable Web projects. For non-Web repositories, recommend shared quality gates and an Evidence/portfolio entry without creating an empty site.

- [ ] **Step 3: Present the migration queue**

Order by existing production use, portfolio value, and migration risk. Each remaining repository receives its own small branch/PR and domain verification cycle; do not batch DNS changes.

- [ ] **Step 4: Verify no private inventory was committed**

Run `git status --short` in every touched repository and scan public changes for private repository names, local paths, credentials, and Cloudflare identifiers.

---

## Final Verification Matrix

| Gate | Command or source | Required result |
|---|---|---|
| Shared contract | `node --test tests/*.test.mjs` in `.github` | PASS |
| Skill metadata | `quick_validate.py` | PASS |
| Skill scripts | `bash -n` plus local fixtures | PASS |
| Product | full Task 4 command set | PASS |
| Evidence | full Task 5 command set | PASS |
| PRs | GitHub required checks | PASS |
| Git deployment | Cloudflare project source | GitHub + `main` |
| DNS | authoritative CNAME lookup | proxied target configured |
| TLS | Cloudflare domain statuses + HTTPS | all active + 2xx |
| Navigation | endpoint script + browser | reciprocal links pass |
| Privacy | public scanners and diff review | no secret/private artifact |
| Rollback | old Direct Upload projects | preserved until separate approval |
