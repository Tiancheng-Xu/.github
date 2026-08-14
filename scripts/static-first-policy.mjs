import { readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    output: "",
    routes: [],
    mode: "ssg",
    renderingManifest: "",
    serverArtifact: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--root") options.root = value, index += 1;
    else if (argument === "--output") options.output = value, index += 1;
    else if (argument === "--route") options.routes.push(value), index += 1;
    else if (argument === "--routes") options.routes.push(...value.split(",")), index += 1;
    else if (argument === "--mode") options.mode = value, index += 1;
    else if (argument === "--rendering-manifest") options.renderingManifest = value, index += 1;
    else if (argument === "--server-artifact") options.serverArtifact = value, index += 1;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.output) throw new Error("--output is required");
  if (!new Set(["ssg", "edge-ssr"]).has(options.mode)) throw new Error(`Unsupported mode: ${options.mode}`);
  options.routes = options.routes.map(normalizeRoute).filter(Boolean);
  if (options.routes.length === 0) options.routes = ["/"];
  return options;
}

function normalizeRoute(route) {
  const value = String(route ?? "").trim();
  if (!value) return "";
  if (value.includes("..") || value.includes("\\")) throw new Error(`Unsafe route: ${value}`);
  const withSlash = value.startsWith("/") ? value : `/${value}`;
  return withSlash === "/" ? "/" : `/${withSlash.split("/").filter(Boolean).join("/")}/`;
}

function inside(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function routeFile(output, route) {
  return route === "/" ? resolve(output, "index.html") : resolve(output, route.slice(1), "index.html");
}

function visibleText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function declaredRoutes(manifest) {
  if (!Array.isArray(manifest?.routes)) return [];
  return manifest.routes
    .map((route) => typeof route === "string" ? route : route?.path)
    .map(normalizeRoute)
    .filter(Boolean);
}

function readJson(path, violations, code) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    violations.push({ code, path });
    return undefined;
  }
}

export function verifyStaticFirst({
  root = process.cwd(),
  output,
  routes = ["/"],
  mode = "ssg",
  renderingManifest = "",
  serverArtifact = "",
}) {
  const absoluteRoot = resolve(root);
  const absoluteOutput = resolve(absoluteRoot, output);
  const violations = [];
  const checkedRoutes = routes.map(normalizeRoute);

  if (!inside(absoluteRoot, absoluteOutput)) {
    return { ok: false, routes: [], violations: [{ code: "unsafe-output", path: output }] };
  }

  if (mode === "edge-ssr") {
    const manifestPath = renderingManifest ? resolve(absoluteRoot, renderingManifest) : "";
    if (!manifestPath || !inside(absoluteRoot, manifestPath)) {
      violations.push({ code: "rendering-manifest-required", path: renderingManifest });
    }
    const manifest = manifestPath && inside(absoluteRoot, manifestPath)
      ? readJson(manifestPath, violations, "rendering-manifest-missing-or-invalid")
      : undefined;
    const rendering = String(manifest?.rendering ?? "");
    if (!rendering.includes("ssr") || !rendering.includes("hydration") || !rendering.includes("csr-fallback")) {
      violations.push({ code: "edge-rendering-contract-invalid", path: manifestPath });
    }
    const manifestRoutes = declaredRoutes(manifest);
    for (const route of checkedRoutes) {
      if (!manifestRoutes.includes(route)) {
        violations.push({ code: "manifest-route-missing", route, path: manifestPath });
      }
    }
    if (manifest?.fallback?.mode !== "pure-csr" || manifest?.fallback?.maximumClientRemounts !== 1) {
      violations.push({ code: "one-shot-csr-fallback-missing", path: manifestPath });
    }
    const excludes = new Set(manifest?.privacy?.serverExcludes ?? []);
    if (!excludes.has("cookie") || !excludes.has("authorization")) {
      violations.push({ code: "server-privacy-boundary-missing", path: manifestPath });
    }

    const artifactPath = serverArtifact ? resolve(absoluteRoot, serverArtifact) : "";
    if (!artifactPath || !inside(absoluteRoot, artifactPath)) {
      violations.push({ code: "server-artifact-required", path: serverArtifact });
    } else {
      try {
        const artifact = statSync(artifactPath);
        if (!artifact.isFile() || artifact.size === 0) throw new Error("empty");
      } catch {
        violations.push({ code: "server-artifact-missing-or-empty", path: artifactPath });
      }
    }

    const fallbackPath = routeFile(absoluteOutput, "/");
    try {
      const html = readFileSync(fallbackPath, "utf8");
      if (!/<script\b[^>]+(?:type=["']module["'][^>]+)?src=["'][^"']+["']/i.test(html)) {
        violations.push({ code: "client-entry-missing", route: "/", path: fallbackPath });
      }
      if (
        manifest?.delivery === "cloudflare-pages-advanced-worker" &&
        /<(?:script|link)\b[^>]+(?:src|href)=["']\.\//i.test(html)
      ) {
        violations.push({ code: "edge-ssr-relative-base-forbidden", route: "/", path: fallbackPath });
      }
    } catch {
      violations.push({ code: "csr-fallback-document-missing", route: "/", path: fallbackPath });
    }

    return { ok: violations.length === 0, mode, routes: checkedRoutes, violations };
  }

  const manifestPath = resolve(absoluteOutput, "static-first-manifest.json");
  const manifest = readJson(manifestPath, violations, "manifest-missing-or-invalid");

  for (const route of checkedRoutes) {
    const file = routeFile(absoluteOutput, route);
    if (!inside(absoluteOutput, file)) {
      violations.push({ code: "unsafe-route", route, path: file });
      continue;
    }
    try {
      if (!statSync(file).isFile()) throw new Error("not a file");
    } catch {
      violations.push({ code: "route-html-missing", route, path: file });
      continue;
    }
    const html = readFileSync(file, "utf8");
    if (!/<meta\s+name=["']static-first["'][^>]+content=["'][^"']+["']/i.test(html)) {
      violations.push({ code: "static-first-meta-missing", route, path: file });
    }
    if (!/data-render-mode=["']ssg["']/i.test(html)) {
      violations.push({ code: "ssg-root-missing", route, path: file });
    }
    if (!/<h1\b[^>]*>[\s\S]*?<\/h1>/i.test(html) || visibleText(html).length < 80) {
      violations.push({ code: "readable-first-screen-missing", route, path: file });
    }
    if (!/<script\b[^>]+(?:type=["']module["'][^>]+)?src=["'][^"']+["']/i.test(html)) {
      violations.push({ code: "client-entry-missing", route, path: file });
    }
    if (!declaredRoutes(manifest).includes(route)) {
      violations.push({ code: "manifest-route-missing", route, path: manifestPath });
    }
  }

  return { ok: violations.length === 0, mode, routes: checkedRoutes, violations };
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = verifyStaticFirst(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
