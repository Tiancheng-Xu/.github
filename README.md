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

## Contracts

- [Project delivery](standards/project-delivery.md)
- [Portfolio and Evidence](standards/evidence-contract.md)

