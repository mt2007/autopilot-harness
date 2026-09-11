import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  DEFAULT_AUTOPILOT_IGNORE_PATTERNS,
  isAutopilotIgnoredPath,
  loadAutopilotIgnorePatterns,
  toProjectRelativePath,
} from "./autopilot-ignore.js";
import { normalizeProjectRoot } from "./project-path.js";

export interface ProductCodeEditOptions {
  /** Project root — loads `.autopilotignore` and runs `git check-ignore`. */
  projectRoot?: string;
}

/**
 * Option A: untracked + gitignored → not product.
 * Tracked files are not reported by `git check-ignore` without `--no-index`,
 * so they still count (unless `.autopilotignore` excludes them).
 */
function isUntrackedGitIgnored(
  projectRoot: string,
  relativePath: string,
): boolean {
  // Untrusted path fragment — never pass through a shell; reject NUL.
  if (!relativePath || relativePath.includes("\0")) return false;
  try {
    const r = spawnSync(
      "git",
      ["check-ignore", "-q", "--", relativePath],
      {
        cwd: projectRoot,
        encoding: "utf8",
        timeout: 5_000,
        windowsHide: true,
        shell: false,
      },
    );
    return r.status === 0;
  } catch {
    return false;
  }
}

/**
 * Returns true if the edited path counts as product code (triggers fix review).
 * No extension allowlist — exclusions live in `.autopilotignore` (+ gitignore A).
 */
export function isProductCodeEdit(
  filePath: string,
  opts?: ProductCodeEditOptions,
): boolean {
  const relative = toProjectRelativePath(filePath, opts?.projectRoot);
  if (!relative) return false;

  const patterns = opts?.projectRoot?.trim()
    ? loadAutopilotIgnorePatterns(opts.projectRoot)
    : DEFAULT_AUTOPILOT_IGNORE_PATTERNS;

  if (isAutopilotIgnoredPath(relative, patterns)) return false;

  const root = opts?.projectRoot?.trim();
  if (root && isUntrackedGitIgnored(root, relative)) return false;

  return true;
}

/** Cap how many git path lines we collect (stop-hook budget). */
const MAX_DIRTY_PATHS_COLLECT = 2000;
/** Cap how many non-ignored paths we fully classify. */
const MAX_DIRTY_PATHS_CLASSIFY = 200;

/**
 * List paths changed vs HEAD plus untracked (non-ignored) files under `cwd`.
 * Uses `-z` so spaces / odd names are not shell-quoted. Fail-closed: empty on
 * non-git, spawn error, or timeout.
 */
function gitDirtyRelativePaths(projectRoot: string): string[] {
  if (!projectRoot || projectRoot.includes("\0")) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const pushZ = (stdout: string) => {
    for (const raw of stdout.split("\0")) {
      const p = raw.replace(/\r$/, "");
      if (!p) continue;
      if (seen.has(p)) continue;
      seen.add(p);
      out.push(p);
      if (out.length >= MAX_DIRTY_PATHS_COLLECT) return;
    }
  };
  try {
    const tracked = spawnSync(
      "git",
      ["diff", "--name-only", "-z", "HEAD", "--"],
      {
        cwd: projectRoot,
        encoding: "utf8",
        timeout: 5_000,
        windowsHide: true,
        shell: false,
      },
    );
    // status null (signal) or non-zero (not a repo) → fail closed.
    if (tracked.error || tracked.status !== 0) {
      return [];
    }
    if (tracked.stdout) pushZ(tracked.stdout);
    if (out.length >= MAX_DIRTY_PATHS_COLLECT) return out;

    const untracked = spawnSync(
      "git",
      ["ls-files", "-o", "--exclude-standard", "-z", "--"],
      {
        cwd: projectRoot,
        encoding: "utf8",
        timeout: 5_000,
        windowsHide: true,
        shell: false,
      },
    );
    if (!untracked.error && untracked.status === 0 && untracked.stdout) {
      pushZ(untracked.stdout);
    }
  } catch {
    return [];
  }
  return out;
}

/**
 * True when the working tree has at least one **product** path dirty vs HEAD
 * (or untracked product file). Used on stop when afterFileEdit never fired
 * (e.g. Shell wrote bundled assets) so the engine can still arm `code_edited`.
 *
 * Fail-closed on git errors. Respects `.autopilotignore` + untracked gitignore
 * via {@link isProductCodeEdit}. Autopilot-ignored paths do not consume the
 * classify budget so a long ignored prefix cannot hide a later product dirty.
 */
export function hasDirtyProductCode(projectRoot: string): boolean {
  const root = normalizeProjectRoot(projectRoot);
  if (!root) return false;

  const relatives = gitDirtyRelativePaths(root);
  const patterns = loadAutopilotIgnorePatterns(root);
  let classified = 0;
  for (const rel of relatives) {
    // Reject traversal / absolute fragments before joining.
    if (
      !rel ||
      rel.includes("\0") ||
      path.isAbsolute(rel) ||
      rel.split(/[/\\]/).includes("..")
    ) {
      continue;
    }
    const abs = path.join(root, rel);
    const relative = toProjectRelativePath(abs, root);
    if (!relative) continue;
    // Skip ignore without burning classify budget.
    if (isAutopilotIgnoredPath(relative, patterns)) continue;

    classified += 1;
    if (classified > MAX_DIRTY_PATHS_CLASSIFY) {
      return false;
    }
    if (isProductCodeEdit(abs, { projectRoot: root })) {
      return true;
    }
  }
  return false;
}
