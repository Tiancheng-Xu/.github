# Performance Evidence contract

Published application repositories declare performance-observability status in
`docs/evidence/performance-observability.json`. The local TC Flow audit, global
Git hook, and remote reusable workflow all run the same validator.

The repositories `Tiancheng-Xu/personal-skills` and
`Tiancheng-Xu/fullstack-showcase` are explicitly exempt. Repositories whose
`.github/baby2b-publish.yml` does not declare `site-kind: project` are outside
this project gate.

## Profiles

- `compact` keeps the minimum trustworthy chain and may omit advanced charts,
  long implementation diaries, data-lake components, and domain-specific
  metrics.
- `full` adds environment, release, route, and time filters; trend, error-rate,
  route-comparison, and slow-request views; retry, DLQ, and idempotency details.

Both completed profiles retain five Web Vitals, p50/p75/p95, sample count,
time-window/route/release dimensions, the browser-to-dashboard pipeline,
privacy boundaries, and real proof. Mock-only data cannot be marked completed.

## Planned contract

```json
{
  "schemaVersion": 1,
  "profile": "compact",
  "status": "planned",
  "summary": "The performance chain is planned and is not presented as live.",
  "evidenceUrl": "https://evidence.baby2b.online/example/",
  "limitations": ["No live event has completed the cloud pipeline yet."],
  "nextStep": "Verify one controlled event batch end to end."
}
```

## Completed compact contract

Completed contracts use `status: implemented` or `status: verified`, set
`dataMode` to `live` or `mixed`, and include:

- `metrics`: LCP, CLS, INP, FCP, TTFB;
- `percentiles`: p50, p75, p95;
- `dimensions`: sample_count, time_window, route, release;
- `pipeline`: browser-sdk, api, sqs-dlq, ecs-cleaner, storage, dashboard;
- `safety`: schema-validation, pii-redaction,
  no-browser-aws-credentials, sdk-failure-isolation;
- `proof`: live-event, queue, ecs-cleaner, aggregate, dashboard, failure-retry.

Every proof entry contains a non-empty `kind`, `location`, and `proves`. The
location points to the sanitized Evidence record; it must not expose credentials,
cookies, request bodies, tokens, or personal data.
