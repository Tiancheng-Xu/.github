# Static-first and edge-rendering standard

## Goal

A deployable public page must use an explicitly declared delivery mode. SSG pages
remain readable before client JavaScript runs. Edge SSR pages return a public,
server-safe shell while identity, wallet, payment, and live telemetry stay outside
the server tree. Both modes hydrate the exact initial tree and retain a deliberate,
observable CSR recovery path.

## Required contract

1. The production build declares `ssg`, `edge-ssr`, or `csr`; plain CSR is never
   labeled SSR or hydration.
2. SSG emits route-specific readable HTML, a `meta[name="static-first"]` marker,
   an `ssg` root, a client entry, and `static-first-manifest.json`.
3. Edge SSR emits a non-empty server artifact, a client fallback document, and a
   rendering manifest whose route matrix matches the application's real routes.
4. Edge SSR handles document `GET`/`HEAD`; assets, APIs, JSON, and mutations bypass
   rendering. Both `/api` and `/api/*` bypass SSR. Unknown documents return a
   real 404 instead of the app shell, and trailing-slash normalization matches
   the client router.
5. Server state is an explicit allowlist, safely escaped before HTML injection,
   and excludes credentials, cookies, authorization, identity, wallet, payment,
   and other project-sensitive fields.
6. The browser hydrates the exact server/build snapshot before activating remote
   refreshes or browser-only runtimes. Browser-only dependencies stay out of the
   server bundle.
7. Hydration validates the SSR marker, normalized current pathname, and build
   version before activation. Recoverable mismatches remain observable; fatal
   failure may perform at most one clean CSR remount.
8. SSR timeout/error handling covers render-stream creation and complete stream
   consumption. A late stall or error must still reach pure CSR fallback before
   a successful SSR response is committed.
9. Personalized shells, Authorization/Cookie requests, query-bearing documents,
   CSR fallback, and 404 responses use `private, no-store`; HTML varies on
   `Accept`. Public cacheability must be an explicit route decision.
10. The server bundle excludes browser-only identity, wallet, payment, and
    telemetry runtimes. The runtime Gate imports and executes the built server
    artifact; source inspection or bundle string matching is not sufficient.
11. Deep links, unknown-route 404, asset passthrough, disabled JavaScript,
   response markers, console errors, and widths 375, 390, 430, and 1440 are
   release-gate checks.

## Delivery-aware base path

- `cloudflare-pages-advanced-worker` with Edge SSR and BrowserRouter/History API
  uses Vite `base: "/"`. The gate rejects `base: "./"` because nested deep links
  would resolve assets relative to the current route.
- Only an explicitly declared `static-files` or standalone CSR delivery may use
  `base: "./"`.
- "Standalone" is not a rendering mode. The delivery contract decides the base
  path; no shared rule may globally hardcode `./`.

## Framework mapping

- Request-time SSR must provide a real server artifact and runtime route matrix;
  a source entry or an empty SPA shell is not SSR evidence.
- Static hosting may use SSG or prerendering. Do not label a Vite SPA as SSR when
  it only ships an empty root.
- Pages that cannot support hydration may use SSG plus progressive enhancement,
  but the chosen mode must be explicit in the manifest.
- Client-only islands are optional. A server-safe shell plus delayed browser
  activation is valid when it preserves exact hydration and privacy boundaries.

## Shared-solution feedback loop

When a project discovers an effective capability outside this standard, N6
classifies it as project-specific or reusable. Only implemented and verified
capabilities enter the shared standard. Reusable findings follow this order:

`project evidence -> generalized contract -> detector -> local N6 gate -> remote gate -> old-project regression -> Evidence`

The originating project cannot claim the shared improvement complete until the
standard and applicable gates are updated. Planned features, cloud checks that
have not run, and project-specific vendor details remain explicitly pending.

## Failure policy

The gate blocks when the declared mode and artifacts disagree, a route is absent
from its manifest, SSG relies on a shared empty shell, Edge SSR has no server
artifact, runtime checks omit SSR markers/404/assets, state crosses the server
privacy boundary, fallback can remount repeatedly, or the delivery/base-path pair
is unsafe. Runtime mismatch and console errors block release even when CSR
recovery renders a usable page.
