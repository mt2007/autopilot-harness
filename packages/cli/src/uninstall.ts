import fs from "node:fs";
import path from "node:path";
import {
  stripAutopilotHooks,
  validateHooksShape,
  isAutopilotCommand,
} from "./init/hooks-merge.js";
import {
  AUTOPILOT_SKILL_NAMES,
  AUTOPILOT_WORKFLOW_FILES,
} from "./init/install.js";
import type { HooksFile } from "./init/types.js";
import {
  assertNotSymlink,
  assertParentDirInProject,
  assertRealpathInside,
  assertWrittenInsideProject,
  isRealRegularFile,
  resolveProjectRootOrThrow,
} from "./project-fs.js";
import {
  MAX_UNTRUSTED_TEXT_BYTES,
  readUntrustedUtf8File,
  writeFileReplaceSync,
} from "./read-untrusted-file.js";

export interface UninstallOptions {
  projectRoot: string;
  dryRun?: boolean;
  /**
   * Remove the entire `.autopilot/` directory (config + state + bin + pin).
   * Never touches `plans/`.
   */
  purgeAll?: boolean;
}

export interface UninstallOk {
  ok: true;
  dryRun: boolean;
  actions: string[];
  removed: string[];
  kept: string[];
}

export interface UninstallFail {
  ok: false;
  error: string;
}

export type UninstallResult = UninstallOk | UninstallFail;

function writeJsonAtomic(
  filePath: string,
  contents: string,
  projectRoot: string,
  label: string,
): void {
  assertParentDirInProject(projectRoot, filePath, label);
  writeFileReplaceSync(filePath, contents);
  assertWrittenInsideProject(projectRoot, filePath, label);
}

function readHooksFile(
  hooksPath: string,
): { ok: true; value: HooksFile } | { ok: false; error: string } {
  try {
    assertNotSymlink(hooksPath, ".cursor/hooks.json");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
  try {
    const st = fs.lstatSync(hooksPath);
    if (st.isSymbolicLink()) {
      return {
        ok: false,
        error: ".cursor/hooks.json is a symlink; refusing to open",
      };
    }
    if (!st.isFile()) {
      return {
        ok: false,
        error:
          ".cursor/hooks.json exists and is not a regular file; refusing to uninstall",
      };
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { ok: true, value: { version: 1, hooks: {} } };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Cannot access hooks.json: ${msg}` };
  }
  try {
    const raw = readUntrustedUtf8File(
      hooksPath,
      MAX_UNTRUSTED_TEXT_BYTES,
      ".cursor/hooks.json",
    );
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        error:
          ".cursor/hooks.json is not a JSON object; fix or remove it before uninstall.",
      };
    }
    const hooks = parsed as HooksFile;
    // Match init: missing/null hooks → treat as empty (still allow skill/bin cleanup).
    if (hooks.hooks != null && typeof hooks.hooks !== "object") {
      return {
        ok: false,
        error:
          '.cursor/hooks.json has invalid "hooks" field; fix or remove it before uninstall.',
      };
    }
    if (!hooks.hooks) {
      return { ok: true, value: { version: hooks.version ?? 1, hooks: {} } };
    }
    if (Array.isArray(hooks.hooks)) {
      return {
        ok: false,
        error:
          '.cursor/hooks.json "hooks" must be an object, not an array; fix or remove it before uninstall.',
      };
    }
    const shape = validateHooksShape(hooks);
    if (shape) return { ok: false, error: shape };
    return { ok: true, value: hooks };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Cannot read hooks.json: ${msg}` };
  }
}

function hooksContainAutopilot(hooks: HooksFile): boolean {
  for (const value of Object.values(hooks.hooks ?? {})) {
    if (!Array.isArray(value)) continue;
    if (value.some((h) => isAutopilotCommand(h?.command))) {
      return true;
    }
  }
  return false;
}

function safeRemovePath(
  projectRoot: string,
  targetPath: string,
  label: string,
  removed: string[],
  dryRun: boolean,
  actions: string[],
): void {
  try {
    assertNotSymlink(targetPath, label);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/symlink/i.test(msg)) {
      actions.push(`skip ${label} (symlink)`);
      return;
    }
    throw err;
  }
  let st: fs.Stats;
  try {
    st = fs.lstatSync(targetPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return;
    throw err;
  }
  if (st.isSymbolicLink()) {
    actions.push(`skip ${label} (symlink)`);
    return;
  }
  if (st.isDirectory()) {
    assertRealpathInside(projectRoot, targetPath, label);
    actions.push(`remove ${label}/`);
    if (!dryRun) {
      fs.rmSync(targetPath, { recursive: true, force: false });
      removed.push(path.relative(projectRoot, targetPath) + "/");
    }
    return;
  }
  if (st.isFile()) {
    assertRealpathInside(projectRoot, targetPath, label);
    actions.push(`remove ${label}`);
    if (!dryRun) {
      fs.unlinkSync(targetPath);
      removed.push(path.relative(projectRoot, targetPath));
    }
    return;
  }
  // FIFO/socket/device etc.: do not report success while leaving Autopilot-named paths.
  throw new Error(
    `${label} exists and is not a regular file or directory; refusing to uninstall`,
  );
}

function pathExistsViaLstat(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Before mutating hooks.json: ensure any non-symlink removal target realpaths
 * inside the project (bind mounts / junctions under skills etc.).
 * Leaf symlinks are deferred to safeRemovePath (skip, do not follow).
 */
function assertRemovalTargetSafe(
  projectRoot: string,
  targetPath: string,
  label: string,
): void {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(targetPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return;
    throw err;
  }
  if (st.isSymbolicLink()) return;
  assertRealpathInside(projectRoot, targetPath, label);
}

/**
 * Uninstall Autopilot project wiring.
 *
 * Default: strip Autopilot hooks, remove skills/workflows/bin/pin;
 * keep `.autopilot/config.yml`, `state.db`, and `plans/`.
 * `--purge-all`: also remove the entire `.autopilot/` directory.
 * Never deletes `plans/`. Does not edit shell rc or `.gitignore`.
 */
export function uninstallProject(opts: UninstallOptions): UninstallResult {
  if (typeof opts.projectRoot !== "string" || opts.projectRoot.trim() === "") {
    return { ok: false, error: "projectRoot must be a non-empty string" };
  }

  let projectRoot: string;
  try {
    projectRoot = resolveProjectRootOrThrow(opts.projectRoot);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }

  const dryRun = Boolean(opts.dryRun);
  const purgeAll = Boolean(opts.purgeAll);
  const actions: string[] = [];
  const removed: string[] = [];
  const kept: string[] = [];
  let hooksStripped = false;

  try {
    const autopilotDir = path.join(projectRoot, ".autopilot");
    const configPath = path.join(autopilotDir, "config.yml");
    const pinPath = path.join(autopilotDir, "pin.json");
    const binDir = path.join(autopilotDir, "bin");
    const cursorDir = path.join(projectRoot, ".cursor");
    const hooksPath = path.join(cursorDir, "hooks.json");
    const skillsRoot = path.join(cursorDir, "skills");
    const docsAutopilotDir = path.join(projectRoot, "docs", "autopilot");
    const workflowsDir = path.join(docsAutopilotDir, "workflows");
    const quickstartPath = path.join(docsAutopilotDir, "quickstart.md");

    // Refuse symlink-swapped host dirs before any mutate/rm (escape + partial-strip).
    // isRealDirectory is false for symlinks — probe with lstat so links are caught.
    // Include skills/workflows so a planted link fails closed *before* hooks.json write.
    try {
      for (const [dir, label] of [
        [cursorDir, ".cursor/"],
        [skillsRoot, ".cursor/skills/"],
        [autopilotDir, ".autopilot/"],
        [binDir, ".autopilot/bin/"],
        [docsAutopilotDir, "docs/autopilot/"],
        [workflowsDir, "docs/autopilot/workflows/"],
      ] as const) {
        if (!pathExistsViaLstat(dir)) continue;
        assertNotSymlink(dir, label);
        assertRealpathInside(projectRoot, dir, label);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }

    // Leaf targets: catch bind-mount / junction escape before hooks.json write.
    try {
      for (const name of AUTOPILOT_SKILL_NAMES) {
        assertRemovalTargetSafe(
          projectRoot,
          path.join(skillsRoot, name),
          `.cursor/skills/${name}`,
        );
      }
      for (const name of AUTOPILOT_WORKFLOW_FILES) {
        assertRemovalTargetSafe(
          projectRoot,
          path.join(workflowsDir, name),
          `docs/autopilot/workflows/${name}`,
        );
      }
      assertRemovalTargetSafe(
        projectRoot,
        quickstartPath,
        "docs/autopilot/quickstart.md",
      );
      assertRemovalTargetSafe(
        projectRoot,
        pinPath,
        ".autopilot/pin.json",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }

    let found = false;

    // --- hooks ---
    const hooksPre = readHooksFile(hooksPath);
    if (!hooksPre.ok) {
      return { ok: false, error: hooksPre.error };
    }
    if (hooksContainAutopilot(hooksPre.value)) {
      found = true;
      actions.push("strip Autopilot entries from .cursor/hooks.json");
      if (!dryRun) {
        // Re-read immediately before write (same TOCTOU shrink as init).
        const hooksFresh = readHooksFile(hooksPath);
        if (!hooksFresh.ok) {
          return { ok: false, error: hooksFresh.error };
        }
        if (!hooksContainAutopilot(hooksFresh.value)) {
          actions.push(
            "hooks.json no longer has Autopilot entries (skipped write)",
          );
        } else {
          // Re-assert immediately before write (init parity; shrink symlink race).
          assertNotSymlink(cursorDir, ".cursor/");
          assertNotSymlink(hooksPath, ".cursor/hooks.json");
          const stripped = stripAutopilotHooks(hooksFresh.value);
          writeJsonAtomic(
            hooksPath,
            JSON.stringify(stripped, null, 2) + "\n",
            projectRoot,
            ".cursor/hooks.json",
          );
          hooksStripped = true;
          removed.push(
            path.relative(projectRoot, hooksPath) + " (Autopilot entries)",
          );
        }
      }
    }

    // --- skills (lstat so symlink skills are not silently ignored) ---
    for (const name of AUTOPILOT_SKILL_NAMES) {
      const skillDir = path.join(skillsRoot, name);
      if (!pathExistsViaLstat(skillDir)) continue;
      found = true;
      safeRemovePath(
        projectRoot,
        skillDir,
        `.cursor/skills/${name}`,
        removed,
        dryRun,
        actions,
      );
    }

    // --- workflows ---
    for (const name of AUTOPILOT_WORKFLOW_FILES) {
      const wf = path.join(workflowsDir, name);
      if (!pathExistsViaLstat(wf)) continue;
      found = true;
      safeRemovePath(
        projectRoot,
        wf,
        `docs/autopilot/workflows/${name}`,
        removed,
        dryRun,
        actions,
      );
    }

    // --- quickstart (install artifact; remove on uninstall) ---
    if (pathExistsViaLstat(quickstartPath)) {
      found = true;
      safeRemovePath(
        projectRoot,
        quickstartPath,
        "docs/autopilot/quickstart.md",
        removed,
        dryRun,
        actions,
      );
    }

    if (purgeAll) {
      if (pathExistsViaLstat(autopilotDir)) {
        found = true;
        safeRemovePath(
          projectRoot,
          autopilotDir,
          ".autopilot",
          removed,
          dryRun,
          actions,
        );
      }
    } else {
      if (pathExistsViaLstat(binDir)) {
        found = true;
        safeRemovePath(
          projectRoot,
          binDir,
          ".autopilot/bin",
          removed,
          dryRun,
          actions,
        );
      }
      if (pathExistsViaLstat(pinPath)) {
        found = true;
        safeRemovePath(
          projectRoot,
          pinPath,
          ".autopilot/pin.json",
          removed,
          dryRun,
          actions,
        );
      }
      if (isRealRegularFile(configPath)) {
        kept.push(".autopilot/config.yml (use --purge-all to remove)");
      }
      const stateDb = path.join(autopilotDir, "state.db");
      if (isRealRegularFile(stateDb)) {
        kept.push(".autopilot/state.db (use --purge-all to remove)");
      }
    }

    kept.push("plans/ (never removed by uninstall)");
    kept.push("shell rc alias / .gitignore (not modified)");

    if (!found) {
      actions.push("nothing to uninstall");
    }

    return {
      ok: true,
      dryRun,
      actions,
      removed: dryRun ? [] : removed,
      kept,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const note = hooksStripped
      ? " (Autopilot hooks were already stripped; fix the error and re-run uninstall)"
      : "";
    return { ok: false, error: `${msg}${note}` };
  }
}
