# Performance sampling shared feedback loop

Status: shared contract implemented; originating production run verified; old-project adoption remains per-project.

## Originating proof

- Project: BabySteps
- AWS workflow Run: `33279132965`
- Artifact: `9722636468`
- Project merge: `424f82e7eaa03e6b0fe7b312f5373167670082ab`
- Project main verification: `33280854201`
- Production deployment: `202545f9-3862-4188-8eb7-6bee66a7a381`
- Scope: five representative routes, 85 unique events, 14/14 batches accepted,
  exact metric readback, queue drain, Schema/Stack absence, 12 resource classes
  at zero, shared Foundation protected.

INP had one real representative-interaction sample and remains low confidence.
CLS used truthful stable-page samples; no bad shift, error, wallet signature, or
chain transaction was manufactured. The AWS runtime was removed after capture.

## Generalization decision

Reusable: secret-free Journey Manifest, deterministic readiness, safe INP
interaction, metric/context contract, bounded event budget, `eventId` final
reconciliation, Dashboard capture isolation, exact queue/readback, cleanup and
shared-resource protection.

Project-specific and excluded: BabySteps route names, selectors, product actions,
AWS resource names, database Schema name, metric values, and release IDs.

## Rollout boundary

This repository provides the standard, detector, and reusable GitHub Gate. TC
Flow consumes the same detector for N6. A different application is not verified
merely because its manifest passes; it must produce its own controlled run,
Evidence, and cleanup proof.
