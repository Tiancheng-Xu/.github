# Portfolio and Evidence contract

## Navigation

Every project page and corresponding Evidence page provides this order:

1. `作品集首页`
2. `项目主页`
3. `工作证明`

The current page uses `aria-current="page"`. The project footer links to
`查看完整工作证明`; the Evidence footer links to `返回项目主页`; both link to
`返回作品集`. Position and meaning stay consistent while each project may use a
different visual theme.

## Minimum Evidence case

1. Thirty-second outcome summary and honest status.
2. Implementation diagram.
3. Architecture and data-flow diagram.
4. Delivery flow from requirement through verification.
5. Three to five incidents with symptom, root cause, fix, and recheck.
6. Quantified baseline/result comparison.
7. Proof matrix covering screenshots, logs, hashes, tests, and deployments.
8. Privacy, security, known limitations, and pending work.
9. Reproduction, source, project, Evidence, and portfolio links when available.

## Required architecture package

Every `public/cases/<slug>/evidence.json` declares these five architecture
views. They are enforced by both the account-wide CI check and local pre-push
gate:

1. `runtime`: the complete runtime request and data flow. This view is always
   `implemented` and points to a tracked, legible source file inside the case.
   It covers responsibilities, storage, external dependencies, network and
   trust boundaries, permissions, observability, failure paths, and cleanup
   ownership where applicable.
2. `githubActions`: build, test, identity/OIDC, deployment, environment
   protection, Evidence capture, and rollback or failure handling.
3. `preview`: PR preview creation, isolation key, routing, verification,
   expiration, and project-scoped cleanup without deleting shared resources.
4. `sequence`: the critical interaction in time order, including the success
   response and important retry, rejection, or failure outcome.
5. `canary`: revision split, health signal, promotion, alarm, and rollback when
   gray release exists.

An implemented view requires `status: "implemented"`, a case-relative tracked
`source`, and a plain-language `description`. A capability that is not yet
real must use one of `planned`, `unavailable`, `not_applicable`, or `unverified`
and include a concrete `note`. Planned or unavailable services must never be
drawn as deployed resources.

The machine-readable shape is documented in
[`evidence-manifest.example.json`](./evidence-manifest.example.json). The
diagram may be Mermaid, SVG, PNG/WebP, HTML, or Markdown, but the Evidence page
must render it legibly and keep it consistent with the implementation.

Each meaningful setup step underneath the diagrams explains:

- its purpose and why the design was chosen;
- the relevant file, service, resource, permission, or command;
- the expected result and the main risk;
- the observed result and a real proof reference.

Remote-login troubleshooting, Evidence-generator internals, and unrelated
debug noise are excluded unless they materially explain a product decision or
verified incident.

Screenshots prove that work happened; diagrams explain how it works. Missing
proof must be labeled missing or pending and must never be fabricated,
duplicated, or replaced with a generic placeholder.

For a completed visual proof matrix, every card must reference a real sanitized
asset. The manifest entry, tracked file, byte count, and SHA-256 must agree.
Text-only records remain valid elsewhere in the case study, but they do not fill
an image slot. Generated summaries must identify their machine-readable source
and must not imitate a console screenshot.

For a trained-model case, include at least one real representative dialogue
when a usable result exists. The displayed answer must be unchanged, reviewed
for accuracy and friendly wording, and labeled with the exact model, version,
or baseline. Failed, evasive, or unreasonable answers belong in private
evaluation or an explicitly labeled limitation; they are not success proof.

## Beginner-readable layer

Preserve technical detail, then add a scanning layer that explains:

1. The goal in one plain-language paragraph.
2. Why training is only one part of the product.
3. What each headline metric means.
4. The runtime request flow in numbered steps.
5. Each incident in one sentence before symptom, cause, fix, and recheck.
6. Where to look in every proof image and what it proves.

This layer is a Feature QA requirement, not a brittle repository-wide keyword
gate. Review it at 375, 390, 430, and 1440 px.

Project and Evidence pages describe real products and engineering outcomes.
They must not frame the implementation as recruiting collateral, an interview
demo, or an interview replay.

## Repository boundary

- Product code stays in its product repository.
- Only an allowlisted, sanitized evidence bundle is copied to the central
  Evidence repository.
- Evidence publishing rejects credentials, local absolute paths, private data,
  model/data artifacts, and unapproved source material.
