import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { verifyEvidenceVerifierManifest } from "../scripts/evidence-verifier-policy.mjs";

const manifestPath = "config/portfolio-aws-verifier.json";
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const workflow = readFileSync(".github/workflows/aws-evidence-verifier.yml", "utf8");

test("private repositories degrade honestly instead of claiming commit verification", () => {
  const result = verifyEvidenceVerifierManifest({ manifest: manifestPath });
  assert.equal(result.ok, true);

  const privateProjects = manifest.projects.filter(
    ({ repositoryVisibility }) => repositoryVisibility === "private",
  );
  assert.deepEqual(
    privateProjects.map(({ projectId }) => projectId).sort(),
    ["personal-ai-agent", "tc-workflow"],
  );
  assert.ok(
    privateProjects.every(({ checks }) => !checks.includes("repository-commit")),
  );
  assert.match(workflow, /verified-with-limitations/);
  assert.match(workflow, /headShaVerified == false/);
  assert.match(workflow, /repositoryCommit\.status == "unavailable-private"/);
});
