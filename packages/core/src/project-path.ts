import fs from "node:fs";
import path from "node:path";

/**
 * Normalize untrusted projectRoot for join/resolve/containment.
 * Leading/trailing spaces make absolute roots look relative to path.resolve
 * (e.g. "  /tmp/p  " → cwd-relative) — always trim before FS use.
 * Returns null for non-string, empty/blank, or NUL-poisoned roots.
 */
export function normalizeProjectRoot(projectRoot: string): string | null {
  if (typeof projectRoot !== "string" || projectRoot.includes("\0")) {
    return null;
  }
  const root = projectRoot.trim();
  return root || null;
}

/** True when realTarget is realRoot or a descendant (not a sibling escape). */
function isRealpathInsideRoot(realRoot: string, realTarget: string): boolean {
  if (realTarget === realRoot) return true;
  const rel = path.relative(realRoot, realTarget);
  return !(
    rel === ".." ||
    rel.startsWith(`..${path.sep}`) ||
    path.isAbsolute(rel)
  );
}

/**
 * Resolve both paths and require target under project root.
 * Catches intermediate directory symlink escapes that O_NOFOLLOW on the leaf cannot.
 * Relative targetPath is resolved against projectRoot (not process.cwd()).
 * projectRoot is normalized (trim); targetPath is not trimmed (filenames may differ),
 * but blank-only targetPath is refused.
 */
export function isRealpathInsideProject(
  projectRoot: string,
  targetPath: string,
): boolean {
  if (
    typeof targetPath !== "string" ||
    targetPath.includes("\0") ||
    !targetPath.trim()
  ) {
    return false;
  }
  const root = normalizeProjectRoot(projectRoot);
  if (!root) return false;
  try {
    const realRoot = fs.realpathSync(root);
    // path.resolve(root, abs) → abs; path.resolve(root, rel) → root/rel (not cwd).
    const realTarget = fs.realpathSync(path.resolve(root, targetPath));
    return isRealpathInsideRoot(realRoot, realTarget);
  } catch {
    return false;
  }
}

/**
 * Lexical containment (no symlink resolve) — for paths that may not exist yet.
 * Relative targets resolve against normalized projectRoot (targetPath not trimmed).
 */
export function isLexicallyInsideProject(
  projectRoot: string,
  targetPath: string,
): boolean {
  if (
    typeof targetPath !== "string" ||
    targetPath.includes("\0") ||
    !targetPath.trim()
  ) {
    return false;
  }
  const root = normalizeProjectRoot(projectRoot);
  if (!root) return false;
  try {
    const absRoot = path.resolve(root);
    const abs = path.resolve(root, targetPath);
    return isRealpathInsideRoot(absRoot, abs);
  } catch {
    return false;
  }
}

/** Align with CLI normalizePlansDir — relative, no traversal, safe path chars. */
const PLANS_DIR_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

/**
 * Normalize untrusted plansDir under projectRoot.
 * Defaults blank/undefined to "plans". Returns null for absolute/~ / .. / bad chars.
 */
export function normalizeInProjectPlansDir(
  projectRoot: string,
  plansDir?: string | null,
): string | null {
  const root = normalizeProjectRoot(projectRoot);
  if (!root) return null;
  let raw =
    typeof plansDir === "string" && plansDir.trim() ? plansDir.trim() : "plans";
  raw = raw.replace(/\/+$/, "") || "plans";
  if (
    path.isAbsolute(raw) ||
    raw.startsWith("~") ||
    raw.includes("\0") ||
    raw.includes("\n") ||
    raw.includes("\r") ||
    raw.includes("\\")
  ) {
    return null;
  }
  const parts = raw.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return null;
  const rel = parts.join("/");
  if (!PLANS_DIR_RE.test(rel)) return null;
  const abs = path.resolve(root, rel);
  if (!isLexicallyInsideProject(root, abs)) return null;
  return rel;
}
