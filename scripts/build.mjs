// Build: compile TypeScript to dist/app, copy the shell and the vendored encoder, stamp the worker.
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

// 4. Vendored dependencies: the compiled app imports ../vendor/metaqr/... and ../vendor/qrcodegen/...
cpSync(join(root, "vendor"), join(dist, "vendor"), { recursive: true });

// 5. Build stamp: a content hash, so the service worker cache name changes only when code changes.
const hash = createHash("sha256");
for (const file of walk(dist).sort()) hash.update(relative(dist, file)).update(readFileSync(file));
const build = hash.digest("hex").slice(0, 12);

cpSync(join(root, "sw.js"), join(dist, "sw.js"));
writeFileSync(join(dist, "sw.js"), readFileSync(join(dist, "sw.js"), "utf8").replace("__BUILD__", build));

// 6. No `_headers` file: the Worker owns the response headers, so the policy can allow the
//    sign-out form (`form-action 'self'`) and the admin session cookie flow.

if (!existsSync(join(dist, "app/main.js"))) throw new Error("build did not produce dist/app/main.js");

// 7. Worker bundle. It lives outside dist/ so the Worker source is never served as an asset.
//    The plugin lets Worker imports use the same ".js" specifiers as the browser code.
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

await esbuild.build({
  entryPoints: [join(root, "worker/index.ts")],
  outfile: join(root, "server/worker.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  loader: { ".json": "json" },
  plugins: [jsToTs],
  logLevel: "warning",
});

console.log(`built dist/ (build ${build}) and server/worker.js`);
