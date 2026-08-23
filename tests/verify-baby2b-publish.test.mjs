import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const actionPath = resolve(
  ".github/actions/verify-baby2b-publish/index.js",
);

const projectManifest = `schema-version: 1
slug: personal-ai-agent
site-kind: project
production-branch: main
build-command: pnpm portfolio:build
output-directory: apps/portfolio/dist
pages-project: personal-ai-agent-site
production-url: https://personal-ai-agent.baby2b.online/
evidence-url: https://personal-ai-agent.baby2b.online/evidence/
backup-url: ""
`;

function runAction(manifest) {
  const fixture = mkdtempSync(join(tmpdir(), "baby2b-publish-"));
  const configPath = join(fixture, "publish.yml");
  const outputPath = join(fixture, "github-output.txt");
  writeFileSync(configPath, manifest);
  writeFileSync(outputPath, "");

  const result = spawnSync(process.execPath, [actionPath], {
    cwd: fixture,
    encoding: "utf8",
    env: {
      ...process.env,
      "INPUT_CONFIG-PATH": configPath,
      GITHUB_OUTPUT: outputPath,
    },
  });

  return {
    ...result,
    output: readFileSync(outputPath, "utf8"),
  };
}

test("accepts a complete project publishing manifest", () => {
  const result = runAction(projectManifest);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.output, /^slug=personal-ai-agent$/m);
  assert.match(result.output, /^site-kind=project$/m);
});

test("accepts fullstack-showcase as the portfolio home at the site root", () => {
  const result = runAction(
    projectManifest
      .replaceAll("personal-ai-agent", "fullstack-showcase")
      .replace(
        "https://fullstack-showcase.baby2b.online/",
        "https://baby2b.online/",
      )
      .replace(
        "https://fullstack-showcase.baby2b.online/evidence/",
        "https://baby2b.online/evidence/fullstack-showcase",
      ),
  );
  assert.equal(result.status, 0, result.stderr);
});

test("accepts Dashboard-owned Evidence for an internal project", () => {
  const result = runAction(
    projectManifest.replace(
      "https://personal-ai-agent.baby2b.online/evidence/",
      "https://baby2b.online/evidence/personal-ai-agent",
    ),
  );
  assert.equal(result.status, 0, result.stderr);
});

test("accepts an Evidence Hub manifest whose URLs share the hub root", () => {
  const result = runAction(`schema-version: 1
slug: evidence
site-kind: evidence-hub
production-branch: main
build-command: npm run evidence:build
output-directory: site
pages-project: baby2b-evidence
production-url: https://evidence.baby2b.online/
evidence-url: https://evidence.baby2b.online/
backup-url: ""
`);
  assert.equal(result.status, 0, result.stderr);
});

for (const [name, manifest, expected] of [
  [
    "rejects the site root for a non-portfolio project",
    projectManifest.replace(
      "https://personal-ai-agent.baby2b.online/",
      "https://baby2b.online/",
    ),
    /production-url.*fullstack-showcase/i,
  ],
  [
    "rejects pages.dev as a production URL",
    projectManifest.replace(
      "https://personal-ai-agent.baby2b.online/",
      "https://personal-ai-agent-site.pages.dev/",
    ),
    /production-url.*baby2b\.online/i,
  ],
  [
    "rejects an absolute output directory",
    projectManifest.replace("apps/portfolio/dist", "/tmp/dist"),
    /output-directory.*relative/i,
  ],
  [
    "rejects a project Evidence path that is not the project evidence root",
    projectManifest.replace("/evidence/", "/wrong-project/"),
    /evidence-url.*project production host/i,
  ],
  [
    "rejects the retired Evidence Hub as a project Evidence URL",
    projectManifest.replace(
      "https://personal-ai-agent.baby2b.online/evidence/",
      "https://evidence.baby2b.online/personal-ai-agent/",
    ),
    /evidence-url.*project production host/i,
  ],
  [
    "rejects a project that disguises the retired Evidence Hub as its production host",
    projectManifest
      .replaceAll("personal-ai-agent", "legacy-project")
      .replaceAll(
        "https://legacy-project.baby2b.online/",
        "https://evidence.baby2b.online/",
      ),
		/project production-url.*retired Evidence host/i,
	],
	[
		"rejects the retired Evidence Hub as production with Dashboard-owned Evidence",
		projectManifest
			.replace(
				"https://personal-ai-agent.baby2b.online/",
				"https://evidence.baby2b.online/",
			)
			.replace(
				"https://personal-ai-agent.baby2b.online/evidence/",
				"https://baby2b.online/evidence/personal-ai-agent",
			),
		/project production-url.*retired Evidence host/i,
  ],
  [
    "rejects a project-owned Evidence URL without the canonical trailing slash",
    projectManifest.replace("/evidence/", "/evidence"),
    /evidence-url.*project production host/i,
  ],
  [
    "rejects a Dashboard-owned Evidence path whose slug differs",
    projectManifest.replace(
      "https://personal-ai-agent.baby2b.online/evidence/",
      "https://baby2b.online/evidence/wrong-project",
    ),
    /evidence-url.*project production host/i,
  ],
  [
    "rejects a Dashboard-owned Evidence URL with a trailing slash",
    projectManifest.replace(
      "https://personal-ai-agent.baby2b.online/evidence/",
      "https://baby2b.online/evidence/personal-ai-agent/",
    ),
    /evidence-url.*project production host/i,
  ],
  [
    "rejects a Dashboard-owned Evidence URL with a custom port",
    projectManifest.replace(
      "https://personal-ai-agent.baby2b.online/evidence/",
      "https://baby2b.online:8443/evidence/personal-ai-agent",
    ),
    /evidence-url.*project production host/i,
  ],
  [
    "rejects the portfolio root with a custom port",
    projectManifest
      .replaceAll("personal-ai-agent", "fullstack-showcase")
      .replace(
        "https://fullstack-showcase.baby2b.online/",
        "https://baby2b.online:8443/",
      )
      .replace(
        "https://fullstack-showcase.baby2b.online/evidence/",
        "https://baby2b.online/evidence/fullstack-showcase",
      ),
    /production-url.*fullstack-showcase/i,
  ],
  [
    "rejects duplicate keys",
    `${projectManifest}slug: duplicate\n`,
    /duplicate key.*slug/i,
  ],
  [
    "rejects unknown keys",
    `${projectManifest}token: secret\n`,
    /unknown key.*token/i,
  ],
  [
    "rejects unsafe production branch names",
    projectManifest.replace("production-branch: main", "production-branch: ../main"),
    /production-branch.*invalid/i,
  ],
]) {
  test(name, () => {
    const result = runAction(manifest);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, expected);
  });
}

test("rejects missing required keys", () => {
  const result = runAction(
    projectManifest.replace("pages-project: personal-ai-agent-site\n", ""),
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing required key.*pages-project/i);
});

for (const [name, manifest] of [
  [
    "rejects evidence-hub compatibility for a different slug",
    `schema-version: 1
slug: another-evidence
site-kind: evidence-hub
production-branch: main
build-command: npm run evidence:build
output-directory: site
pages-project: baby2b-evidence
production-url: https://evidence.baby2b.online/
evidence-url: https://evidence.baby2b.online/
backup-url: ""
`,
  ],
  [
    "rejects evidence-hub compatibility outside the legacy root",
    `schema-version: 1
slug: evidence
site-kind: evidence-hub
production-branch: main
build-command: npm run evidence:build
output-directory: site
pages-project: baby2b-evidence
production-url: https://evidence.baby2b.online/anything
evidence-url: https://evidence.baby2b.online/anything
backup-url: ""
`,
  ],
  [
    "rejects evidence-hub compatibility for a different Pages project",
    `schema-version: 1
slug: evidence
site-kind: evidence-hub
production-branch: main
build-command: npm run evidence:build
output-directory: site
pages-project: unrelated-project
production-url: https://evidence.baby2b.online/
evidence-url: https://evidence.baby2b.online/
backup-url: ""
`,
  ],
]) {
  test(name, () => {
    const result = runAction(manifest);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /evidence-hub compatibility/i);
  });
}
