# Shared Evidence Verifier - Local Verification

Date: 2026-08-29

## Status

- Implementation: `verified-local`
- GitHub Actions: `pending`
- AWS deployment: `pending`
- Project verification runs: `pending`

This record proves the local contracts and build only. It does not prove that the verifier is deployed or that any project has completed an AWS-backed verification run.

## Scope

The verifier is a shared, non-VPC AWS Lambda invoked through GitHub OIDC. It checks a fixed repository-owned manifest and emits a small, redacted JSON result for each project. It does not run project business workloads and must not be labeled as `aws-runtime: verified-production`.

The fixed matrix contains:

- Personal AI Agent
- Showcase Dashboard
- GitHub Profile Studio
- Portfolio Sync
- Performance Observability Control
- TC Flow 2.1

Agent Market and BabySteps are excluded because their AWS evidence is owned and verified by their respective project workflows.

## Safety contract

- No Root identity is permitted for deployment.
- No long-lived AWS access key is used.
- GitHub OIDC trust is restricted to the central repository's `main` branch.
- The Lambda has no VPC, NAT, RDS, ECS, load balancer, API Gateway, or new S3 bucket.
- The account's Lambda concurrency quota is `10`, so AWS rejects function-level reserved concurrency that would reduce unreserved concurrency below its required minimum. Delivery remains serialized through no public function endpoint, exact GitHub OIDC `main` trust, and workflow `max-parallel: 1`.
- CloudWatch retention is `7` days.
- The verifier accepts only fixed HTTPS hosts, blocks redirects, IP literals, credentials, query strings, fragments, and non-standard ports, and limits response bodies to 1 MiB.
- Artifacts contain allowlisted metadata and hashes, never response bodies, cookies, tokens, private paths, prompts, datasets, or model weights.
- Deployment and invocation must stop when the monthly actual cost reaches USD 34 or forecast reaches USD 40. An unavailable forecast is disclosed and never interpreted as zero.
- The AWS Free account plan must not be upgraded, converted, cancelled, or closed.

## Budget snapshot before deployment

- Monthly budget limit: USD 40
- Actual cost: USD 27.345
- Forecast: unavailable
- AWS state after the failed initial Change Set: exact verifier Stack absent; attempted resources rolled back and deleted

An initial CloudFormation Change Set execution failed because `ReservedConcurrentExecutions: 1` conflicts with the account-level concurrency quota. CloudFormation rolled back all attempted resources, and the exact rollback Stack was deleted and verified absent. No verifier invocation occurred. The failure is now covered by a deterministic regression contract.

The corrected Stack later reached `CREATE_COMPLETE`, but the first fixed-matrix GitHub Actions run (`33289666213`) could not assume the OIDC role and was cancelled before any Lambda invocation. No project result artifact was produced. A sanitized OIDC Claim Gate was added to expose and validate only `sub`, `aud`, `ref`, repository identifiers, and workflow reference while keeping the JWT itself out of logs and artifacts. Cloud verification remains pending until a new run passes.

This snapshot is time-bound and must be read again immediately before any Change Set or verifier invocation.

## Production binding contract

Each result records one of these levels:

- `embedded-sha`: the production response contains the exact repository commit.
- `repository-and-url`: repository commit and production URL are verified separately, without claiming an embedded deployment SHA.
- `not-deployed`: no independent production URL is claimed.

Missing production deployments remain explicit. GitHub Profile Studio and TC Flow 2.1 are not promoted to independently deployed applications. Performance Observability Control is not promoted while its intended production route is unavailable.

## Local verification

- Repository Node test suite: PASS
- Lambda unit tests: 6/6 PASS
- SAM template lint: PASS
- SAM build: PASS
- AWS budget/shared-resource guard: PASS
- Fixed manifest policy: PASS
- Git diff check: PASS
- Credential/private-key scan: PASS
- IAM policy simulation for the exact budget read action: allowed

`actionlint` was not available locally. GitHub Actions syntax and runtime behavior remain cloud-pending and must pass the repository policy and Actions checks before deployment.

## Planned cloud sequence

1. Push the isolated branch and open a pull request.
2. Require repository policy and verification checks to pass.
3. Merge to `main` only after review.
4. Re-read AWS identity and budget.
5. Create an AWS CloudFormation Change Set with the approved resource allowlist.
6. Inspect the Change Set and stop on any extra or replacement resource.
7. Execute the approved Change Set using the MFA administrator identity, never Root.
8. Configure only the two repository variables emitted by the stack.
9. Run the fixed GitHub Actions matrix once.
10. Publish redacted per-project results and verify no plan or shared-foundation boundary changed.

## Limitations

- Local success does not prove GitHub OIDC trust, Lambda invocation, network reachability, production semantics, or artifact upload.
- The shared verifier proves a minimal AWS-backed evidence check, not a project's complete AWS runtime.
- A `200` response alone is insufficient; project-specific markers and commit contracts must also pass.
- Any failure is fail-closed and must remain visible as `pending` or `failed` rather than being converted into completion.
