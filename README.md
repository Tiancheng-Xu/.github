# Tiancheng-Xu project standards

This repository is the versioned source of truth for shared project delivery
rules, reusable GitHub Actions, and contribution defaults across Tiancheng-Xu
repositories.

## Adoption

Each project keeps its own technology and product decisions. Web projects use
the shared defaults unless their root `AGENTS.md` documents a verified reason
to differ.

Call the reusable verification workflow from a project workflow:

```yaml
jobs:
  standards:
    uses: Tiancheng-Xu/.github/.github/workflows/verify-project.yml@main
    with:
      package-manager: pnpm
      install-command: pnpm install --frozen-lockfile
      check-command: pnpm check
      test-command: pnpm test
      typecheck-command: pnpm typecheck
      build-command: pnpm build
```

The workflow is intentionally explicit: GitHub does not automatically inject a
custom workflow into every existing repository.

## Repository policy boundary

The repository policy scans product source and configured public build outputs
for retired course-only wording. Required project records are classified as
non-product material only when they use the fixed `archive/`, `docs/architecture/`,
`docs/delivery/`, `docs/evidence/`, `docs/homework/`, `docs/qa/`, or
`docs/superpowers/` locations, a conventional test filename, or a
`scripts/validate-*` / `scripts/verify-*` filename. This classification never
exempts a configured public build output, product source, or `README.md`, and
repositories cannot extend it with custom wildcard allowlists.

Files below the fixed `archive/` prefix are historical, non-product material.
That exemption applies only to retired product-copy wording; commit identity,
secret, PII, unsafe path, and configured public build-output checks still run.

Gitlinks (mode `160000`) are submodule commit pointers, not files in the
superproject, and are excluded from content reads. This does not exempt ordinary
tracked or untracked files, including `.gitmodules`, from policy scanning.
Submodule contents require their own repository checks; they are not recursively
scanned by the superproject policy.

New-branch author checks exclude only locally available commit tips whose exact
object IDs are confirmed on the destination remote. Unavailable, unrelated tips
are not fetched implicitly: omitting them can audit extra commits, but cannot
hide an outgoing commit. Local remote-tracking refs alone are never trusted as
proof that a commit already exists at the push destination.

Pre-push checks preserve malformed-encoding test data only when the same regular
file entry (path, blob, and mode) exists in an ancestor confirmed on the actual
push destination. Only test/fixture directories qualify, not documentation or public
build outputs. New or changed samples, product files, unrelated history, and
unverified local refs still fail strict UTF-8 decoding. Readable wording in an
inherited sample is still scanned using replacement decoding. Audit and CI modes
remain strict; this adds no configurable path allowlist or author exemption.

Each adopting repository must keep the byte-for-byte canonical caller at
`.github/workflows/repository-policy.yml`; the central workflow remains
read-only and runs on pull requests.

Git branch refs also reject centrally configured retired academic aliases at
exact token boundaries. The full ref-only contract and its non-content scope
are documented in [branch naming policy](docs/delivery/branch-naming-policy.md).

## Contracts

- [Project delivery](standards/project-delivery.md)
- [Portfolio and Evidence](standards/evidence-contract.md)
- [Evidence manifest example](standards/evidence-manifest.example.json)
- [AI Engineering review](standards/ai-engineering-review.md)

AI product dependencies and imports activate the AI Engineering review contract. Root documentation and the fixed architecture, delivery, Evidence, QA, and Superpowers documentation paths do not activate this contract by themselves; they remain subject to the existing public-content and security boundaries.
