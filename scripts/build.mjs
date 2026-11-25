// Build: compile the PWA and bundle the Node.js API, copy static assets and stamp the service worker.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve as resolvePath } from "node:path";
import * as esbuild from "esbuild";

const root = process.cwd();
const dist = join(root, "dist");

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// 1. TypeScript. `tsc` is taken from node_modules; version pinned in package.json.
execFileSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", join(root, "tsconfig.json")], {
  stdio: "inherit",
});

// 2. Shell files.
for (const file of ["index.html", "admin.html", "styles.css", "manifest.json", "icon.svg"]) {
  cpSync(join(root, file), join(dist, file));
}

// 3. Signed bundles only: `source.bundle.json` is unsigned input and must never be served.
mkdirSync(join(dist, "bundles"), { recursive: true });
for (const file of ["default.bundle.json", "latest.bundle.json"]) {
  const from = join(root, "bundles", file);
  if (existsSync(from)) cpSync(from, join(dist, "bundles", file));
}

// 4. Vendored dependencies are copied before frontend bundling so the browser build can inline them.
cpSync(join(root, "vendor"), join(dist, "vendor"), { recursive: true });

// 5. Bundle the browser entry points. A single JS request per app is faster on first visits
//    (especially in private browsing, where no prior HTTP or service-worker cache exists).
for (const entry of ["main", "admin"]) {
  const input = join(dist, "app", `${entry}.js`);
  const bundled = join(dist, "app", `${entry}.bundle.js`);
  await esbuild.build({
    entryPoints: [input],
    outfile: bundled,
    bundle: true,
    minify: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    logLevel: "warning",
  });
  writeFileSync(input, readFileSync(bundled));
  rmSync(bundled);
}

// 6. Build stamp: a content hash, so the service worker cache name changes only when code changes.
const hash = createHash("sha256");
for (const file of walk(dist).sort()) hash.update(relative(dist, file)).update(readFileSync(file));
const build = hash.digest("hex").slice(0, 12);

cpSync(join(root, "sw.js"), join(dist, "sw.js"));
writeFileSync(join(dist, "sw.js"), readFileSync(join(dist, "sw.js"), "utf8").replace("__BUILD__", build));

// 7. Response security headers are attached by the Node.js application server.

if (!existsSync(join(dist, "app/main.js"))) throw new Error("build did not produce dist/app/main.js");

// 8. Node.js API bundle. It lives outside dist/ so backend source is never served as an asset.
//    The resolver lets backend imports use the same ".js" specifiers as the browser code.
const jsToTs = {
  name: "js-to-ts",
  setup(build) {
    build.onResolve({ filter: /\.js$/ }, (args) => {
      if (!args.path.startsWith(".")) return null;
      const candidate = resolvePath(args.resolveDir, args.path);
      if (existsSync(candidate)) return null;
      const ts = candidate.replace(/\.js$/, ".ts");
      return existsSync(ts) ? { path: ts } : null;
    });
  },
};

mkdirSync(join(root, "server"), { recursive: true });

await esbuild.build({
  entryPoints: [join(root, "backend/index.ts")],
  outfile: join(root, "server/app.js"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2022",
  loader: { ".json": "json" },
  plugins: [jsToTs],
  logLevel: "warning",
});

console.log(`built dist/ (build ${build}) and server/app.js`);
