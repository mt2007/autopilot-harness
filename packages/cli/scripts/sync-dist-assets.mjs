#!/usr/bin/env node
/**
 * Copy packages/cli/assets → dist/assets (publish layout under files:["dist"]).
 * Used by `build` and root `pnpm test` so pack/runtime paths stay aligned.
 *
 * Optional argv[2]: package root (defaults to packages/cli). Tests use a temp root.
 *
 * Staging/old trees live under the package root (not dist/) so a crash cannot
 * leave temp dirs inside the published `files: ["dist"]` tree.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultCliRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const cliRoot = process.argv[2]
  ? path.resolve(process.argv[2])
  : defaultCliRoot;
const distDir = path.join(cliRoot, "dist");
const src = path.join(cliRoot, "assets");
const dest = path.join(distDir, "assets");
// Keep outside dist/ — otherwise npm pack (files:["dist"]) can ship leftovers.
const staging = path.join(cliRoot, `.assets-staging-${process.pid}`);
const doomed = path.join(cliRoot, `.assets-old-${process.pid}`);

/** Must be present and non-empty after sync — otherwise publish tarball is broken. */
const REQUIRED_RELATIVE = [
  "templates/.autopilotignore",
  "templates/skills/autopilot-on/SKILL.md.tpl",
  "templates/skills/autopilot-run/SKILL.md.tpl",
  "templates/skills/autopilot-off/SKILL.md.tpl",
  "templates/skills/autopilot-resume/SKILL.md.tpl",
  "templates/skills/autopilot-replan/SKILL.md.tpl",
  "templates/workflows/autopilot-planning.md",
  "templates/workflows/autopilot-executing.md",
  "autopilot-harness-hook.mjs",
  "vendor/runtime.mjs",
  // Keep in sync with packages/core/migrations/*.sql
  "vendor/migrations/001_initial.sql",
  "vendor/migrations/002_pending_followup.sql",
  "vendor/migrations/003_reviewing_item.sql",
];

/** Cleared after successful rename; fail() removes a live staging tree. */
let stagingLive = null;

function fail(msg) {
  if (stagingLive) {
    try {
      fs.rmSync(stagingLive, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    stagingLive = null;
  }
  console.error(`[sync-dist-assets] ${msg}`);
  process.exit(1);
}

function assertRealDir(p, label) {
  let st;
  try {
    st = fs.lstatSync(p);
  } catch {
    fail(`missing ${label}: ${p}`);
  }
  if (st.isSymbolicLink()) fail(`refusing symlink ${label}: ${p}`);
  if (!st.isDirectory()) fail(`${label} is not a directory: ${p}`);
}

function assertNonEmptyFile(p, label) {
  let st;
  try {
    st = fs.lstatSync(p);
  } catch {
    fail(`missing ${label}: ${p}`);
  }
  if (st.isSymbolicLink()) fail(`refusing symlink ${label}: ${p}`);
  if (!st.isFile() || st.size === 0) fail(`missing or empty ${label}: ${p}`);
}

/** Copy like bundle-templates: refuse symlinks / odd types during the walk. */
function copyDir(fromRoot, toRoot) {
  fs.mkdirSync(toRoot, { recursive: true });
  for (const ent of fs.readdirSync(fromRoot, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === ".DS_Store") continue;
    const from = path.join(fromRoot, ent.name);
    const to = path.join(toRoot, ent.name);
    if (ent.isSymbolicLink()) fail(`refusing symlink: ${from}`);
    if (ent.isDirectory()) copyDir(from, to);
    else if (ent.isFile()) fs.copyFileSync(from, to);
    else fail(`unsupported file type: ${from}`);
  }
}

function lexists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function isRealDir(p) {
  try {
    const st = fs.lstatSync(p);
    return !st.isSymbolicLink() && st.isDirectory();
  } catch {
    return false;
  }
}

function cleanStale(dir, prefix) {
  if (!lexists(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith(prefix)) continue;
    try {
      fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/** Remove prefix matches that are not real directories (safe even when dest is missing). */
function cleanStaleNonDirs(dir, prefix) {
  if (!lexists(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith(prefix)) continue;
    const p = path.join(dir, name);
    if (isRealDir(p)) continue;
    try {
      fs.rmSync(p, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function clearBlockingDest() {
  if (!lexists(dest) || isRealDir(dest)) return true;
  const blocking = path.join(cliRoot, `.assets-blocking-${process.pid}`);
  try {
    fs.renameSync(dest, blocking);
    fs.rmSync(blocking, { recursive: true, force: true });
    return true;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(
      `[sync-dist-assets] warning: could not clear blocking dist/assets: ${detail}`,
    );
    return false;
  }
}

function looksLikeAssetsTree(root) {
  if (!isRealDir(root)) return false;
  for (const rel of REQUIRED_RELATIVE) {
    try {
      const st = fs.lstatSync(path.join(root, rel));
      if (st.isSymbolicLink() || !st.isFile() || st.size === 0) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Invariant: never discard the last good assets tree.
 * If a previous swap left `.assets-old-*` while dist/assets is missing/unusable,
 * restore a complete tree before continuing (do not delete sibling olds until swap succeeds).
 */
function recoverDoomedIfDestMissing() {
  if (looksLikeAssetsTree(dest) || !lexists(cliRoot)) return;
  const olds = fs
    .readdirSync(cliRoot)
    .filter((name) => name.startsWith(".assets-old-"))
    .map((name) => {
      const p = path.join(cliRoot, name);
      let mtime = 0;
      try {
        mtime = fs.lstatSync(p).mtimeMs;
      } catch {
        /* ignore */
      }
      return { p, mtime };
    })
    .filter(({ p }) => looksLikeAssetsTree(p))
    .sort((a, b) => b.mtime - a.mtime);
  if (olds.length === 0) return;
  const chosen = olds[0].p;
  // Park file / symlink / incomplete dir at dest so a complete stranded tree can land.
  if (lexists(dest) && !looksLikeAssetsTree(dest)) {
    const park = path.join(cliRoot, `.assets-old-parked-${process.pid}`);
    try {
      fs.renameSync(dest, park);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(
        `[sync-dist-assets] warning: could not park unusable dist/assets: ${detail}`,
      );
      return;
    }
  }
  try {
    fs.renameSync(chosen, dest);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(
      `[sync-dist-assets] warning: could not restore ${chosen} → dist/assets: ${detail}`,
    );
  }
}

assertRealDir(src, "source assets/");
try {
  fs.mkdirSync(distDir, { recursive: true });
} catch (err) {
  const detail = err instanceof Error ? err.message : String(err);
  fail(`cannot create dist/: ${detail}`);
}
recoverDoomedIfDestMissing();
// Always drop abandoned staging / blocking temps (never under publish tree).
cleanStale(cliRoot, ".assets-staging-");
cleanStale(cliRoot, ".assets-blocking-");
cleanStale(distDir, ".assets-staging-");
cleanStale(distDir, ".assets-blocking-");
// Non-dir junk matching `.assets-old-*` is always safe to drop. Directory
// stranded olds are kept until a successful swap (below) so an incomplete
// recover candidate cannot cause cleanStale to delete a better sibling tree.
cleanStaleNonDirs(cliRoot, ".assets-old-");
cleanStaleNonDirs(distDir, ".assets-old-");

stagingLive = staging;
copyDir(src, staging);
for (const rel of REQUIRED_RELATIVE) {
  assertNonEmptyFile(path.join(staging, rel), rel);
}

// Move old dest aside, then rename staging → dest. Never delete dest before
// the new tree is in place (rename failure must not wipe both trees).
// Use lstat (lexists) so a broken symlink at dest is moved aside too —
// existsSync(false) would leave it blocking rename.
let doomedLive = null;
try {
  if (lexists(dest)) {
    fs.renameSync(dest, doomed);
    doomedLive = doomed;
  }
  fs.renameSync(staging, dest);
  stagingLive = null;
  if (doomedLive) {
    try {
      fs.rmSync(doomedLive, { recursive: true, force: true });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(
        `[sync-dist-assets] warning: left behind ${doomedLive}: ${detail}`,
      );
    }
    doomedLive = null;
  }
  // Successful publish tree is in place — safe to drop any other stranded olds.
  cleanStale(cliRoot, ".assets-old-");
  cleanStale(distDir, ".assets-old-");
} catch (err) {
  if (doomedLive && !isRealDir(dest)) {
    try {
      if (!clearBlockingDest()) {
        /* keep doomedLive */
      } else if (!lexists(dest)) {
        fs.renameSync(doomedLive, dest);
        doomedLive = null;
      }
    } catch {
      /* keep doomedLive — last good tree must survive cleanStale on retry */
    }
  }
  const detail = err instanceof Error ? err.message : String(err);
  if (doomedLive && lexists(doomedLive) && !isRealDir(dest)) {
    // Staging may still be live; drop it but do not touch doomedLive.
    if (stagingLive) {
      try {
        fs.rmSync(stagingLive, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      stagingLive = null;
    }
    console.error(
      `[sync-dist-assets] failed to replace dist/assets: ${detail}`,
    );
    console.error(
      `[sync-dist-assets] last good tree left at ${doomedLive} (will restore on next run)`,
    );
    process.exit(1);
  }
  fail(`failed to replace dist/assets: ${detail}`);
}
