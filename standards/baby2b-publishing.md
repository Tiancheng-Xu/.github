# Baby2B publishing standard

## Source of truth

Every deployable web repository stores a flat YAML manifest at
`.github/baby2b-publish.yml`. The shared verification workflow validates that
manifest before a change can be accepted.

Required fields:

```yaml
schema-version: 1
slug: example-project
site-kind: project
production-branch: main
build-command: pnpm build
output-directory: dist
pages-project: example-project-site
production-url: https://example-project.baby2b.online/
evidence-url: https://example-project.baby2b.online/evidence/
backup-url: ""
```

Deployed applications own `https://<slug>.baby2b.online/evidence/`. Skills,
internal services, and projects without an independent Evidence page use
`https://baby2b.online/evidence/<slug>` and are rendered by the Dashboard.
Project manifests must not use the retired `evidence.baby2b.online` host.

`site-kind: evidence-hub` remains accepted only while legacy redirects are
migrated. Its production and Evidence URLs must both be the legacy host root;
new repositories must not select this kind.

## Deployment ownership

- GitHub Actions owns install, static checks, tests, type checking, production
  builds, Evidence checks, and manifest validation.
- Cloudflare Pages Git Integration owns production deployment from the
  manifest's production branch.
- A custom `*.baby2b.online` hostname is the production URL. A `pages.dev` URL
  is only a diagnostic or rollback address.
- The canonical portfolio repository `fullstack-showcase` is the sole exception:
  its production URL is the site root `https://baby2b.online/`.
- Repositories do not store Cloudflare deployment tokens. Shared verification
  is read-only and never deploys or writes into another repository.
- GitHub Pages may remain as an explicitly labeled backup, but it is not the
  Baby2B production deployment.

## Release gate

A project is not published until all of the following are true:

1. Repository verification and production build pass.
2. Cloudflare Pages Git Integration reports a successful production build.
3. The declared `baby2b.online` custom domain is active with valid TLS.
4. Project-owned or Dashboard-owned Evidence pages link to the portfolio and
   project, use a canonical non-legacy URL, and return successful HTTP responses.
5. The Evidence case records the deployed commit, checks, architecture,
   incidents, and proof without exposing secrets or private artifacts.

When replacing a Direct Upload Pages project, keep the old project intact until
the new Git-integrated project, DNS, TLS, and navigation all pass this gate.
