import fs from "node:fs";
import path from "node:path";

function isRealDirectory(p: string): boolean {
  try {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) return false;
    return st.isDirectory();
  } catch {
    return false;
  }
}

function isRealNonEmptyFile(p: string): boolean {
  try {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) return false;
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

/** True only when the tree looks like a usable templates package. */
export function isUsableTemplatesRoot(root: string): boolean {
  return (
    isRealDirectory(path.join(root, "skills")) &&
    isRealDirectory(path.join(root, "workflows")) &&
    isRealNonEmptyFile(path.join(root, ".autopilotignore")) &&
    isRealNonEmptyFile(
      path.join(root, "skills", "autopilot-on", "SKILL.md.tpl"),
    ) &&
    isRealNonEmptyFile(path.join(root, "workflows", "autopilot-planning.md"))
  );
}

/** Candidate roots tried for diagnostics / tests (priority order). */
export function templatesRootCandidates(cliRoot: string): string[] {
  return [
    path.resolve(cliRoot, "../templates"),
    path.join(cliRoot, "assets", "templates"),
    path.join(cliRoot, "dist", "assets", "templates"),
    path.join(cliRoot, "node_modules", "@autopilot-harness", "templates"),
  ];
}

/**
 * Resolve skill/workflow templates for init / upgrade / locale-set.
 *
 * Order:
 * 1. Monorepo `packages/templates` (dev / tests — always freshest)
 * 2. Package-root `assets/templates` (dev working tree before/without dist copy)
 * 3. `dist/assets/templates` (published npm layout — `files: ["dist"]`)
 * 4. Optional separate npm package (legacy / unused today)
 *
 * A candidate must contain skills + workflows + `.autopilotignore` and a
 * sentinel skill/workflow file — empty `skills/` dirs must not win over the
 * bundled copy (e.g. stray `node_modules/@autopilot-harness/templates`).
 */
export function resolveTemplatesRoot(cliRoot: string): string {
  const candidates = templatesRootCandidates(cliRoot);
  const found = candidates.find((p) => isUsableTemplatesRoot(p));
  if (found) return found;
  // Error-path hint: published layout has no package-root assets/.
  if (!isRealDirectory(path.join(cliRoot, "assets"))) {
    return candidates[2]!;
  }
  return candidates[1]!;
}
