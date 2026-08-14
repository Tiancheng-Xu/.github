import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyStaticFirst } from "../scripts/static-first-policy.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "static-first-policy-"));
  const output = join(root, "dist");
  mkdirSync(join(output, "dashboard"), { recursive: true });
  writeFileSync(
    join(output, "dashboard/index.html"),
    '<!doctype html><html><head><meta name="static-first" content="ssg-hydrate-csr"><script type="module" src="/app.js"></script></head><body><div id="app" data-render-mode="ssg"><main><h1>Readable Dashboard</h1><p>This route contains meaningful static content before client JavaScript runs and remains available during recovery.</p></main></div></body></html>',
  );
  writeFileSync(join(output, "static-first-manifest.json"), JSON.stringify({ routes: ["/dashboard"] }));
  return root;
}

test("accepts a readable route-specific SSG artifact", () => {
  const result = verifyStaticFirst({ root: fixture(), output: "dist", routes: ["/dashboard"] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
});

test("blocks an empty SPA shell and a missing deep route", () => {
  const root = fixture();
  writeFileSync(join(root, "dist/dashboard/index.html"), '<div id="app"></div><script src="/app.js"></script>');
  const result = verifyStaticFirst({ root, output: "dist", routes: ["/dashboard", "/evidence"] });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((item) => item.code === "readable-first-screen-missing"));
  assert.ok(result.violations.some((item) => item.code === "route-html-missing"));
});

test("accepts an Edge SSR artifact with route, privacy, fallback, and root-relative assets", () => {
  const root = mkdtempSync(join(tmpdir(), "edge-ssr-policy-"));
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "dist/index.html"), '<div id="root"></div><script type="module" src="/app.js"></script>');
  writeFileSync(join(root, "dist/_worker.js"), "export default { fetch() { return new Response('ssr') } };");
  writeFileSync(join(root, "dist/rendering-manifest.json"), JSON.stringify({
    delivery: "cloudflare-pages-advanced-worker",
    rendering: "edge-ssr-hydration-csr-fallback",
    routes: [{ path: "/" }, { path: "/profile" }],
    fallback: { mode: "pure-csr", maximumClientRemounts: 1 },
    privacy: { serverExcludes: ["cookie", "authorization", "identity"] },
  }));
  const result = verifyStaticFirst({
    root,
    output: "dist",
    routes: ["/", "/profile"],
    mode: "edge-ssr",
    renderingManifest: "dist/rendering-manifest.json",
    serverArtifact: "dist/_worker.js",
  });
  assert.equal(result.ok, true);
});

test("blocks unsafe Edge SSR artifacts and delivery-relative assets", () => {
  const root = mkdtempSync(join(tmpdir(), "edge-ssr-policy-"));
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "dist/index.html"), '<script type="module" src="./app.js"></script>');
  writeFileSync(join(root, "dist/rendering-manifest.json"), JSON.stringify({
    delivery: "cloudflare-pages-advanced-worker",
    rendering: "edge-ssr-hydration-csr-fallback",
    routes: [{ path: "/" }],
    fallback: { mode: "pure-csr", maximumClientRemounts: 2 },
    privacy: { serverExcludes: ["cookie", "authorization"] },
  }));
  const result = verifyStaticFirst({
    root,
    output: "dist",
    mode: "edge-ssr",
    renderingManifest: "dist/rendering-manifest.json",
    serverArtifact: "dist/_worker.js",
  });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((item) => item.code === "server-artifact-missing-or-empty"));
  assert.ok(result.violations.some((item) => item.code === "one-shot-csr-fallback-missing"));
  assert.ok(result.violations.some((item) => item.code === "edge-ssr-relative-base-forbidden"));
});

test("shared verification exposes the static-first remote gate", () => {
  const workflow = readFileSync(new URL("../.github/workflows/verify-project.yml", import.meta.url), "utf8");
  assert.match(workflow, /static-first-output:/);
  assert.match(workflow, /static-first-routes:/);
  assert.match(workflow, /static-first-mode:/);
  assert.match(workflow, /static-first-runtime-command:/);
  assert.match(workflow, /static-first-policy\.mjs/);
});
