#!/usr/bin/env node
/**
 * Bundle core + port-cursor + port-claude-code into assets/vendor/runtime.mjs
 * for project hooks. Also copies migration SQL beside the bundle
 * (migrate.ts resolves relative paths).
 */
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(cliRoot, "../..");
const outDir = path.join(cliRoot, "assets", "vendor");
const entry = path.join(cliRoot, "src", "vendor-entry.ts");
const migrationSrcDir = path.join(repoRoot, "packages", "core", "migrations");

fs.mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: path.join(outDir, "runtime.mjs"),
  // Keep Node builtins external; workspace packages are inlined via alias.
  packages: "bundle",
  external: ["node:*"],
  alias: {
    "@autopilot-harness/core": path.join(
      repoRoot,
      "packages",
      "core",
      "src",
      "index.ts",
    ),
    "@autopilot-harness/port-cursor": path.join(
      repoRoot,
      "packages",
      "ports",
      "cursor",
      "src",
      "index.ts",
    ),
    "@autopilot-harness/port-claude-code": path.join(
      repoRoot,
      "packages",
      "ports",
      "claude-code",
      "src",
      "index.ts",
    ),
    "@autopilot-harness/i18n": path.join(
      repoRoot,
      "packages",
      "i18n",
      "src",
      "index.ts",
    ),
  },
  logLevel: "info",
});

const migDir = path.join(outDir, "migrations");
fs.mkdirSync(migDir, { recursive: true });
if (!fs.existsSync(migrationSrcDir)) {
  throw new Error(`Missing migrations dir: ${migrationSrcDir}`);
}
const sqlFiles = fs
  .readdirSync(migrationSrcDir)
  .filter((f) => /^\d{3}_.+\.sql$/.test(f))
  .sort();
if (sqlFiles.length === 0) {
  throw new Error(`No migration SQL in ${migrationSrcDir}`);
}
for (const f of sqlFiles) {
  fs.copyFileSync(path.join(migrationSrcDir, f), path.join(migDir, f));
}

console.log(
  `vendor: wrote assets/vendor/runtime.mjs + migrations/ (${sqlFiles.join(", ")})`,
);
