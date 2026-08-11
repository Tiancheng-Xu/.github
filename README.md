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
non-product material only when they use the fixed `docs/architecture/`,
`docs/delivery/`, `docs/evidence/`, `docs/homework/`, `docs/qa/`, or
`docs/superpowers/` locations, a conventional test filename, or a
`scripts/validate-*` / `scripts/verify-*` filename. This classification never
exempts a configured public build output, product source, or `README.md`, and
repositories cannot extend it with custom wildcard allowlists.

Each adopting repository must keep the byte-for-byte canonical caller at
`.github/workflows/repository-policy.yml`; the central workflow remains
read-only and runs on pull requests.

Git branch refs also reject centrally configured retired academic aliases at
exact token boundaries. The full ref-only contract and its non-content scope
are documented in [branch naming policy](docs/delivery/branch-naming-policy.md).

## Contracts

- [Project delivery](standards/project-delivery.md)
- [Portfolio and Evidence](standards/evidence-contract.md)
