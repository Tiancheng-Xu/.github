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

Screenshots prove that work happened; diagrams explain how it works. Missing
proof must be labeled missing or pending and must never be fabricated,
duplicated, or replaced with a generic placeholder.

## Repository boundary

- Product code stays in its product repository.
- Only an allowlisted, sanitized evidence bundle is copied to the central
  Evidence repository.
- Evidence publishing rejects credentials, local absolute paths, private data,
  model/data artifacts, and unapproved source material.

