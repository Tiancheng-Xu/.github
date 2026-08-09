const { appendFileSync, readFileSync } = require("node:fs");
const path = require("node:path");

const allowedKeys = [
  "schema-version",
  "slug",
  "site-kind",
  "production-branch",
  "build-command",
  "output-directory",
  "pages-project",
  "production-url",
  "evidence-url",
  "backup-url",
];

function fail(message) {
  process.stderr.write(`[baby2b-publish] ${message}\n`);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function unquote(value, lineNumber) {
  const first = value.at(0);
  const last = value.at(-1);
  if (first === '"' || first === "'") {
    assert(last === first && value.length >= 2, `line ${lineNumber} has unmatched quotes`);
    return value.slice(1, -1);
  }
  assert(last !== '"' && last !== "'", `line ${lineNumber} has unmatched quotes`);
  return value;
}

function parseFlatYaml(source) {
  const result = {};
  for (const [index, rawLine] of source.split(/\r?\n/u).entries()) {
    const lineNumber = index + 1;
    if (rawLine.trim() === "" || rawLine.trimStart().startsWith("#")) continue;
    assert(!/^\s/u.test(rawLine), `line ${lineNumber} must not be indented`);
    const match = /^([a-z0-9-]+):(?:\s*(.*))?$/u.exec(rawLine);
    assert(match, `line ${lineNumber} must use flat key: value syntax`);
    const key = match[1];
    assert(allowedKeys.includes(key), `unknown key: ${key}`);
    assert(!(key in result), `duplicate key: ${key}`);
    result[key] = unquote(match[2] ?? "", lineNumber);
  }
  for (const key of allowedKeys) {
    assert(key in result, `missing required key: ${key}`);
  }
  return result;
}

function parseHttpsUrl(value, key) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${key} must be an absolute URL`);
  }
  assert(parsed.protocol === "https:", `${key} must use HTTPS`);
  assert(parsed.username === "" && parsed.password === "", `${key} must not contain credentials`);
  assert(parsed.search === "" && parsed.hash === "", `${key} must not contain query or fragment data`);
  return parsed;
}

function validate(config) {
  assert(config["schema-version"] === "1", "schema-version must be 1");
  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(config.slug), "slug must be kebab-case");
  assert(
    config["site-kind"] === "project" || config["site-kind"] === "evidence-hub",
    "site-kind must be project or evidence-hub",
  );

  const branch = config["production-branch"];
  assert(
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(branch) &&
      !branch.includes("..") &&
      !branch.includes("//") &&
      !branch.endsWith("/") &&
      !branch.endsWith("."),
    "production-branch is invalid",
  );
  assert(config["build-command"].trim() !== "", "build-command must not be empty");

  const outputDirectory = config["output-directory"];
  assert(
    outputDirectory !== "" &&
      !path.isAbsolute(outputDirectory) &&
      !outputDirectory.split("/").includes(".."),
    "output-directory must be a safe relative path",
  );
  assert(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(config["pages-project"]),
    "pages-project must be kebab-case",
  );

  const production = parseHttpsUrl(config["production-url"], "production-url");
  assert(
    production.hostname.endsWith(".baby2b.online"),
    "production-url must use a baby2b.online subdomain",
  );
  const evidence = parseHttpsUrl(config["evidence-url"], "evidence-url");
  assert(
    evidence.hostname === "evidence.baby2b.online",
    "evidence-url must use evidence.baby2b.online",
  );

  if (config["site-kind"] === "project") {
    assert(evidence.pathname === `/${config.slug}/`, "evidence-url path must match slug");
  } else {
    assert(
      config["production-url"] === config["evidence-url"],
      "evidence-hub production-url and evidence-url must match",
    );
  }

  if (config["backup-url"] !== "") {
    parseHttpsUrl(config["backup-url"], "backup-url");
  }
}

const configPath = process.env["INPUT_CONFIG-PATH"];
assert(configPath, "config-path input is required");
const absoluteConfigPath = path.resolve(process.cwd(), configPath);
let source;
try {
  source = readFileSync(absoluteConfigPath, "utf8");
} catch {
  fail(`cannot read config-path: ${configPath}`);
}

const config = parseFlatYaml(source);
validate(config);

const outputPath = process.env.GITHUB_OUTPUT;
assert(outputPath, "GITHUB_OUTPUT is required");
for (const key of allowedKeys) {
  appendFileSync(outputPath, `${key}=${config[key]}\n`);
}
