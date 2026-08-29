#!/usr/bin/env node
/**
 * Bundle core + port-cursor into assets/vendor/runtime.mjs for project hooks.
 * Also copies migration SQL beside the bundle (migrate.ts resolves relative paths).
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
const migrationSrc = path.join(
  repoRoot,
  "packages",
  "core",
  "migrations",
  "001_initial.sql",
);

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
if (!fs.existsSync(migrationSrc)) {
  throw new Error(`Missing migration: ${migrationSrc}`);
}
fs.copyFileSync(migrationSrc, path.join(migDir, "001_initial.sql"));

console.log("vendor: wrote assets/vendor/runtime.mjs + migrations/");
