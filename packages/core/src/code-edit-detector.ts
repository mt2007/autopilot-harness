import { spawnSync } from "node:child_process";
import {
  DEFAULT_AUTOPILOT_IGNORE_PATTERNS,
  isAutopilotIgnoredPath,
  loadAutopilotIgnorePatterns,
  toProjectRelativePath,
} from "./autopilot-ignore.js";

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
