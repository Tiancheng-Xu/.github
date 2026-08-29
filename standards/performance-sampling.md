# Controlled performance sampling standard

## Scope

This standard generalizes only capabilities implemented and verified by a real
project run. An application supplies a secret-free Journey Manifest. Shared
infrastructure validates the contract, runs a bounded controlled-browser journey,
reconciles unique events, reads exact metric distributions, and proves cleanup.
Project routes, selectors, business interactions, vendor resource names, and
product-specific metrics remain in the application repository.

## Journey Manifest

The `performance-sampling/v1` manifest must declare:

1. A stable application ID and allowlisted loopback origins used by the local
   controlled-browser runner. Production origins are not accepted as local test
   servers.
2. Representative routes with a deterministic readiness selector or visible
   text assertion. A delayed RPC or optional business card cannot define whether
   the page shell is ready.
3. Explicit, no-side-effect interactions that can produce real INP samples.
   Wallet signatures, chain transactions, synthetic layout shifts, and injected
   errors are forbidden sampling actions. A truthful `CLS=0` sample is valid.
4. Required coverage for LCP, CLS, INP, FCP, TTFB, full navigation phases,
   route duration, and resource duration. Custom metrics may be added but cannot
   replace the required groups.
5. Per-route and total event/batch budgets, bounded retry attempts, a single
   attempt timeout, and a lifecycle drain deadline. Retrying the same `eventId`
   is allowed; manufacturing new IDs to fill a quota is not.
6. `eventId` final reconciliation, all-unique-events-accepted semantics, and
   Dashboard-only capture using local telemetry interception with HTTP 202.

`contract-only` means only the manifest is validated. `verified-run` requires a
matching `performance-sampling-evidence/v1` document and must fail closed when it
is absent.

## Verified Evidence

Each required metric carries its name, unit, source, route, environment,
build/version, window, sample count, p50/p75/p95, capture time, and freshness.
Unavailable is permitted only when the manifest explicitly allows the metric and
the Evidence records a reason. CLS and INP require real samples. INP with fewer
than five samples is labeled low confidence.

Evidence also proves:

- every unique event was eventually accepted; permanent rejection, exhausted
  retry, or unreceived events are zero;
- accepted batches stay inside the declared budget;
- SQS and DLQ visible, in-flight, and delayed counts are all zero;
- Dashboard screenshot/readback did not add telemetry to the measured dataset;
- project Schema and exact Stack are absent;
- ECR, ECS cluster/task/task definition, SQS/DLQ, API Gateway, Lambda, logs,
  secrets, security groups/ingress, and IAM roles total zero;
- shared VPC, NAT, RDS, OIDC, artifact storage, and Foundation remain protected.

Mock data proves only UI state. A headless or controlled-browser run is not field
RUM. Historical snapshots, incomplete queue drains, and sparse samples keep their
limitations even when the UI renders successfully.

## Feedback loop

Reusable capability moves through:

`project evidence -> generalized contract -> detector -> TC Flow N6 -> GitHub remote Gate -> old-project regression -> shared Evidence`

The shared Gate never dispatches AWS, writes another repository, updates a visual
baseline, or approves a production release. It only validates committed,
redacted contracts and Evidence. Runtime execution and cleanup stay in the
application's approved workflow.
