import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultConfigYaml } from "./default-config.js";
import { mergeHooksJson, validateHooksShape } from "./hooks-merge.js";
import type {
  HooksFile,
  InitLocale,
  InitResult,
  InitYesOptions,
} from "./types.js";
import { PACKAGE_VERSION } from "./types.js";
import {
  applyPlansGitignore,
  applyAutopilotRuntimeGitignore,
  assertNotSymlink,
  assertParentDirInProject,
  assertRealpathInside,
  assertPairInsideOrUnlinkAll,
  assertWrittenInsideProject,
  isRealDirectory,
  isRealRegularFile,
  mkdirRealDirSync,
  normalizePlansDir,
  writeQuickstart,
  assertPresentRealFile,
} from "./wizard-helpers.js";
import { skillDescriptions } from "@autopilot-harness/i18n";
import { readConfigInstallHints } from "./config-merge.js";
import {
  MAX_UNTRUSTED_TEXT_BYTES,
  readUntrustedUtf8File,
  copyFileReplaceSync,
  copyFileNoFollowExclSync,
  writeFileReplaceSync,
  renameReplaceSync,
} from "../read-untrusted-file.js";

export {
  mergeHooksJson,
  countAutopilotDuplicates,
  validateHooksShape,
  hasCompleteAutopilotHooks,
  summarizeAutopilotHooks,
  autopilotStopHasUnlimitedLoop,
  autopilotHookCommand,
} from "./hooks-merge.js";
export type { InitYesOptions, InitResult, HooksFile } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SKILL_NAMES = [
  "autopilot-on",
  "autopilot-run",
  "autopilot-off",
  "autopilot-resume",
  "autopilot-replan",
] as const;

const WORKFLOW_FILES = [
  "autopilot-planning.md",
  "autopilot-executing.md",
] as const;

function resolvePackageRoots(): { cliRoot: string; templatesRoot: string } {
  // src/init → ../../ = packages/cli; dist/init → ../../ = packages/cli
  const cliRoot = path.resolve(__dirname, "../..");
  const candidates = [
    path.resolve(cliRoot, "../templates"),
    path.resolve(cliRoot, "node_modules/@autopilot-harness/templates"),
  ];
  const templatesRoot =
    candidates.find((p) => isRealDirectory(path.join(p, "skills"))) ??
    candidates[0]!;
  return { cliRoot, templatesRoot };
}

function resolveHookAsset(cliRoot: string): string | null {
  const candidates = [
    path.join(cliRoot, "assets", "autopilot-harness-hook.mjs"),
    path.join(cliRoot, "dist", "assets", "autopilot-harness-hook.mjs"),
  ];
  return candidates.find((p) => isRealRegularFile(p)) ?? null;
}

function resolveVendorRoot(cliRoot: string): string | null {
  const candidates = [
    path.join(cliRoot, "assets", "vendor"),
    path.join(cliRoot, "dist", "assets", "vendor"),
  ];
  // Both files must come from the same vendor root (no assets/dist mix).
  for (const dir of candidates) {
    const runtime = path.join(dir, "runtime.mjs");
    const mig = path.join(dir, "migrations", "001_initial.sql");
    if (!isRealRegularFile(runtime) || !isRealRegularFile(mig)) continue;
    if (!isRealDirectory(dir) || !isRealDirectory(path.join(dir, "migrations"))) {
      continue;
    }
    try {
      assertNotSymlink(dir, "vendor/");
      assertNotSymlink(runtime, "vendor/runtime.mjs");
      assertNotSymlink(path.join(dir, "migrations"), "vendor/migrations/");
      assertNotSymlink(mig, "vendor/migrations/001_initial.sql");
    } catch {
      continue;
    }
    return dir;
  }
  return null;
}

function copyVendorDir(
  cliRoot: string,
  destBin: string,
  projectRoot: string,
): void {
  const vendorRoot = resolveVendorRoot(cliRoot);
  if (!vendorRoot) {
    throw new Error(
      "Missing assets/vendor/runtime.mjs or migrations — run pnpm bundle-vendor (or pnpm build)",
    );
  }
  const runtimeSrc = path.join(vendorRoot, "runtime.mjs");
  const migSrcDir = path.join(vendorRoot, "migrations");
  const migFiles = fs
    .readdirSync(migSrcDir)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort();
  if (!migFiles.includes("001_initial.sql")) {
    throw new Error("Missing vendor/migrations/001_initial.sql");
  }

  const destVendor = path.join(destBin, "vendor");
  mkdirRealDirSync(destVendor, ".autopilot/bin/vendor/", projectRoot);
  const runtimeDest = path.join(destVendor, "runtime.mjs");
  assertNotSymlink(runtimeDest, ".autopilot/bin/vendor/runtime.mjs");

  const migDestDir = path.join(destVendor, "migrations");
  mkdirRealDirSync(
    migDestDir,
    ".autopilot/bin/vendor/migrations/",
    projectRoot,
  );

  // Stage temps first so a mid-stage failure does not wipe a good prior pair.
  // Commit migrations before runtime: a torn upgrade then keeps old runtime + new
  // SQL (still loadable); the reverse (new runtime + old SQL) is worse for migrate.
  assertParentDirInProject(
    projectRoot,
    runtimeDest,
    ".autopilot/bin/vendor/",
  );
  assertParentDirInProject(
    projectRoot,
    path.join(migDestDir, "001_initial.sql"),
    ".autopilot/bin/vendor/migrations/",
  );

  const token = `${process.pid}.${randomBytes(8).toString("hex")}`;
  const runtimeTmp = `${runtimeDest}.${token}.tmp`;
  const migTmps: { tmp: string; dest: string; label: string }[] = [];
  for (const f of migFiles) {
    const dest = path.join(migDestDir, f);
    assertNotSymlink(dest, `.autopilot/bin/vendor/migrations/${f}`);
    migTmps.push({
      tmp: `${dest}.${token}.tmp`,
      dest,
      label: `vendor/migrations/${f}`,
    });
  }

  try {
    copyFileNoFollowExclSync(runtimeSrc, runtimeTmp, "vendor/runtime.mjs");
    for (const m of migTmps) {
      copyFileNoFollowExclSync(
        path.join(migSrcDir, path.basename(m.dest)),
        m.tmp,
        m.label,
      );
    }
    for (const m of migTmps) {
      renameReplaceSync(m.tmp, m.dest);
    }
    renameReplaceSync(runtimeTmp, runtimeDest);
  } catch (err) {
    try {
      fs.unlinkSync(runtimeTmp);
    } catch {
      /* ignore */
    }
    for (const m of migTmps) {
      try {
        fs.unlinkSync(m.tmp);
      } catch {
        /* ignore */
      }
    }
    throw err;
  }
  // Post-write: parent symlink race may have landed files outside the project.
  assertPairInsideOrUnlinkAll(projectRoot, [
    ...migTmps.map(
      (m) =>
        [m.dest, `.autopilot/bin/vendor/migrations/${path.basename(m.dest)}`] as [
          string,
          string,
        ],
    ),
    [runtimeDest, ".autopilot/bin/vendor/runtime.mjs"],
  ]);
}

function copyHookAsset(
  cliRoot: string,
  destBin: string,
  projectRoot: string,
): void {
  const src = resolveHookAsset(cliRoot);
  if (!src) {
    throw new Error("Missing autopilot-harness-hook.mjs asset in CLI package");
  }
  mkdirRealDirSync(destBin, ".autopilot/bin/", projectRoot);
  // Vendor first: if this fails, leave the previous hook intact.
  copyVendorDir(cliRoot, destBin, projectRoot);
  const hookDest = path.join(destBin, "autopilot-harness-hook.mjs");
  assertNotSymlink(hookDest, ".autopilot/bin/autopilot-harness-hook.mjs");
  assertParentDirInProject(
    projectRoot,
    hookDest,
    ".autopilot/bin/",
  );
  copyFileReplaceSync(src, hookDest);
  assertWrittenInsideProject(
    projectRoot,
    hookDest,
    ".autopilot/bin/autopilot-harness-hook.mjs",
  );
}

type HooksRead =
  | { ok: true; value: HooksFile | null }
  | { ok: false; error: string };

/** Read hooks.json; refuse to clobber an existing unreadable file. */
function readHooksFile(filePath: string): HooksRead {
  let raw: string;
  try {
    // Do not use existsSync first: dangling symlinks look "missing" there,
    // but O_NOFOLLOW open fails with ELOOP — fail closed before mutate.
    raw = readUntrustedUtf8File(
      filePath,
      MAX_UNTRUSTED_TEXT_BYTES,
      ".cursor/hooks.json",
    );
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { ok: true, value: null };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Cannot read ${filePath}: ${msg}` };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        error: `${filePath} is not a JSON object; fix or remove it before init.`,
      };
    }
    const obj = parsed as HooksFile;
    if (obj.hooks != null && typeof obj.hooks !== "object") {
      return {
        ok: false,
        error: `${filePath} has invalid "hooks" field; fix or remove it before init.`,
      };
    }
    if (!obj.hooks) {
      return { ok: true, value: { version: obj.version ?? 1, hooks: {} } };
    }
    if (Array.isArray(obj.hooks)) {
      return {
        ok: false,
        error: `${filePath}: "hooks" must be an object, not an array.`,
      };
    }
    const shapeError = validateHooksShape(obj);
    if (shapeError) {
      return { ok: false, error: `${filePath}: ${shapeError}` };
    }
    return { ok: true, value: obj };
  } catch {
    return {
      ok: false,
      error: `${filePath} is not valid JSON; fix or remove it before init.`,
    };
  }
}

function writeFileAtomic(
  filePath: string,
  contents: string,
  projectRoot: string,
  parentLabel: string,
): void {
  assertParentDirInProject(projectRoot, filePath, parentLabel);
  writeFileReplaceSync(filePath, contents);
  assertWrittenInsideProject(projectRoot, filePath, path.basename(filePath));
}

function renderSkill(template: string, description: string): string {
  const escaped = description
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
  return template.replaceAll("{{description}}", escaped);
}

function assertSupported(
  platform: string,
  surface: string,
  locale: string,
): string | null {
  if (platform !== "cursor") {
    return `Unsupported platform "${platform}" (supported: cursor).`;
  }
  if (surface !== "ide") {
    return `Unsupported surface "${surface}" (supported: ide).`;
  }
  if (locale !== "en" && locale !== "zh-CN") {
    return `Unsupported locale "${locale}" (en | zh-CN).`;
  }
  return null;
}

/** On --force refresh, skills must follow config.yml locale (not CLI flag default). */
function resolveInstallLocale(
  optsLocale: string,
  configExists: boolean,
  force: boolean,
  configPath: string,
): InitLocale {
  if (configExists && force) {
    try {
      const yaml = readUntrustedUtf8File(
        configPath,
        MAX_UNTRUSTED_TEXT_BYTES,
        ".autopilot/config.yml",
      );
      const hints = readConfigInstallHints(yaml);
      return hints.locale === "zh-CN" ? "zh-CN" : "en";
    } catch {
      // Fall through to opts / default.
    }
  }
  return optsLocale === "zh-CN" ? "zh-CN" : "en";
}

function installSkills(
  templatesRoot: string,
  projectRoot: string,
  locale: InitLocale,
): string[] {
  const written: string[] = [];
  const descriptions = skillDescriptions(locale);
  const skillsRoot = path.join(projectRoot, ".cursor", "skills");
  assertNotSymlink(skillsRoot, ".cursor/skills/");
  for (const name of SKILL_NAMES) {
    const tplPath = path.join(templatesRoot, "skills", name, "SKILL.md.tpl");
    assertPresentRealFile(tplPath, `skill template ${name}`);
    const destDir = path.join(skillsRoot, name);
    mkdirRealDirSync(destDir, `.cursor/skills/${name}/`, projectRoot);
    assertRealpathInside(projectRoot, destDir, `.cursor/skills/${name}/`);
    const body = renderSkill(
      readUntrustedUtf8File(
        tplPath,
        MAX_UNTRUSTED_TEXT_BYTES,
        `skill template ${name}`,
      ),
      descriptions[name] ?? name,
    );
    const dest = path.join(destDir, "SKILL.md");
    assertNotSymlink(dest, `.cursor/skills/${name}/SKILL.md`);
    writeFileAtomic(
      dest,
      body,
      projectRoot,
      `.cursor/skills/${name}/`,
    );
    written.push(path.relative(projectRoot, dest));
  }
  return written;
}

function installWorkflows(templatesRoot: string, projectRoot: string): string[] {
  const written: string[] = [];
  const docsDir = path.join(projectRoot, "docs");
  const autopilotDocs = path.join(docsDir, "autopilot");
  const destDir = path.join(autopilotDocs, "workflows");
  assertNotSymlink(docsDir, "docs/");
  assertNotSymlink(autopilotDocs, "docs/autopilot/");
  assertNotSymlink(destDir, "docs/autopilot/workflows/");
  mkdirRealDirSync(destDir, "docs/autopilot/workflows/", projectRoot);
  assertRealpathInside(projectRoot, destDir, "docs/autopilot/workflows/");
  for (const name of WORKFLOW_FILES) {
    const src = path.join(templatesRoot, "workflows", name);
    assertPresentRealFile(src, `workflow template ${name}`);
    const dest = path.join(destDir, name);
    assertNotSymlink(dest, `docs/autopilot/workflows/${name}`);
    assertParentDirInProject(
      projectRoot,
      dest,
      "docs/autopilot/workflows/",
    );
    copyFileReplaceSync(src, dest);
    assertWrittenInsideProject(
      projectRoot,
      dest,
      `docs/autopilot/workflows/${name}`,
    );
    written.push(path.relative(projectRoot, dest));
  }
  return written;
}

function ensurePlansReadme(
  projectRoot: string,
  plansDir = "plans",
): string | null {
  if (typeof projectRoot !== "string" || projectRoot.trim() === "") {
    throw new Error("projectRoot must be a non-empty string");
  }
  const normalized = normalizePlansDir(plansDir);
  if (!normalized.ok) {
    throw new Error(normalized.error);
  }
  const safePlansDir = normalized.value;
  const resolvedRoot = path.resolve(projectRoot.trim());
  const plansRoot = path.join(resolvedRoot, safePlansDir);
  const resolvedPlans = path.resolve(plansRoot);
  if (
    resolvedPlans !== resolvedRoot &&
    !resolvedPlans.startsWith(resolvedRoot + path.sep)
  ) {
    throw new Error("plansDir resolves outside the project root");
  }

  // Refuse symlink/file occupying plansDir (existsSync lies on dangling).
  mkdirRealDirSync(plansRoot, "plansDir", resolvedRoot);
  assertRealpathInside(resolvedRoot, plansRoot, "plansDir");

  const readme = path.join(plansRoot, "README.md");
  try {
    const st = fs.lstatSync(readme);
    if (st.isSymbolicLink()) {
      throw new Error("plans README is a symlink; refusing to open");
    }
    if (st.isFile()) return null;
    throw new Error("plans README exists and is not a regular file");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") throw err;
  }

  writeFileAtomic(
    readme,
    `# Plans

Per-track Autopilot artifacts live here:

\`\`\`text
${safePlansDir}/<slug>/brief.md
${safePlansDir}/<slug>/plan.md
${safePlansDir}/<slug>/checklist.md
\`\`\`

Start with \`/autopilot-on\`, then \`/autopilot-run\` when the checklist is ready.
`,
    resolvedRoot,
    "plansDir",
  );
  return path.relative(resolvedRoot, readme);
}

export type PreflightResult = { ok: true } | { ok: false; error: string };

/**
 * Read-only checks before force-refresh / upgrade mutates the project.
 * Ensures templates, hook asset, and hooks.json are merge-safe (fail closed).
 */
export function preflightForceRefresh(projectRoot: string): PreflightResult {
  if (typeof projectRoot !== "string" || projectRoot.trim() === "") {
    return { ok: false, error: "projectRoot must be a non-empty string" };
  }
  const root = path.resolve(projectRoot.trim());
  const { cliRoot, templatesRoot } = resolvePackageRoots();
  if (!isRealDirectory(path.join(templatesRoot, "skills"))) {
    return {
      ok: false,
      error: `Templates package not found at ${templatesRoot}`,
    };
  }
  for (const name of SKILL_NAMES) {
    const tplPath = path.join(templatesRoot, "skills", name, "SKILL.md.tpl");
    try {
      assertPresentRealFile(tplPath, `skill template ${name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }
  for (const name of WORKFLOW_FILES) {
    const src = path.join(templatesRoot, "workflows", name);
    try {
      assertPresentRealFile(src, `workflow template ${name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }
  if (!resolveHookAsset(cliRoot)) {
    return {
      ok: false,
      error: "Missing autopilot-harness-hook.mjs asset in CLI package",
    };
  }
  if (!resolveVendorRoot(cliRoot)) {
    return {
      ok: false,
      error:
        "Missing assets/vendor/runtime.mjs or migrations — run pnpm bundle-vendor (or pnpm build)",
    };
  }
  const hooksPath = path.join(root, ".cursor", "hooks.json");
  const hooksRead = readHooksFile(hooksPath);
  if (!hooksRead.ok) {
    return { ok: false, error: hooksRead.error };
  }
  return { ok: true };
}

/**
 * Non-interactive init (`--yes`). Writes .autopilot + merges .cursor/hooks.json.
 * `--force` refreshes hook/skills/pin/hooks merge but does **not** overwrite
 * an existing config.yml (append-keys / reset-config come later).
 */
export function installInitYes(opts: InitYesOptions): InitResult {
  if (typeof opts.projectRoot !== "string" || opts.projectRoot.trim() === "") {
    return { ok: false, error: "projectRoot must be a non-empty string" };
  }

  const unsupported = assertSupported(opts.platform, opts.surface, opts.locale);
  if (unsupported) {
    return { ok: false, error: unsupported };
  }

  const projectRoot = path.resolve(opts.projectRoot.trim());
  const autopilotDir = path.join(projectRoot, ".autopilot");
  const configPath = path.join(autopilotDir, "config.yml");
  const cursorDir = path.join(projectRoot, ".cursor");
  const hooksPath = path.join(cursorDir, "hooks.json");

  try {
    assertNotSymlink(autopilotDir, ".autopilot/");
    assertNotSymlink(configPath, ".autopilot/config.yml");
    assertNotSymlink(cursorDir, ".cursor/");
    assertNotSymlink(hooksPath, ".cursor/hooks.json");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }

  // Prefer lstat: existsSync is false for dangling symlinks (already refused
  // above) and true for non-files; only a regular file counts as initialized.
  let configExists = false;
  try {
    const st = fs.lstatSync(configPath);
    if (!st.isFile()) {
      return {
        ok: false,
        error: ".autopilot/config.yml exists and is not a regular file",
      };
    }
    configExists = true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Cannot access config.yml: ${msg}` };
    }
    configExists = false;
  }

  if (configExists && !opts.force) {
    return {
      ok: false,
      error:
        "Project already initialized (.autopilot/config.yml exists). Re-run with --force to refresh (config.yml kept; hooks merge; plans untouched).",
    };
  }

  const preflight = preflightForceRefresh(projectRoot);
  if (!preflight.ok) {
    return { ok: false, error: preflight.error };
  }

  const { cliRoot, templatesRoot } = resolvePackageRoots();
  // Fail closed on corrupt hooks before any mutate.
  const hooksPre = readHooksFile(hooksPath);
  if (!hooksPre.ok) {
    return { ok: false, error: hooksPre.error };
  }

  const plansNorm = normalizePlansDir(opts.plansDir);
  if (!plansNorm.ok) {
    return { ok: false, error: plansNorm.error };
  }
  const plansDir = plansNorm.value;
  const verifyEnabled = Boolean(opts.verifyEnabled);
  const maxErrorsBeforePause =
    typeof opts.maxErrorsBeforePause === "number" &&
    Number.isInteger(opts.maxErrorsBeforePause) &&
    opts.maxErrorsBeforePause >= 0
      ? opts.maxErrorsBeforePause
      : 0;
  const writeQs = opts.writeQuickstart !== false;
  const locale = resolveInstallLocale(
    opts.locale,
    configExists,
    Boolean(opts.force),
    configPath,
  );

  let createdConfig = false;
  try {
    const written: string[] = [];
    mkdirRealDirSync(autopilotDir, ".autopilot/", projectRoot);

    // Only write config on first init — never clobber user config on --force.
    // wx: fail closed if another process created config.yml between check and write.
    if (!configExists) {
      try {
        // Re-check immediately before wx: earlier `configExists` / mkdir leave a window
        // where a symlink (or non-file) can appear and make wx fail with EEXIST —
        // that must not be reported as "already initialized".
        assertParentDirInProject(projectRoot, configPath, ".autopilot/");
        assertNotSymlink(configPath, ".autopilot/config.yml");
        fs.writeFileSync(
          configPath,
          defaultConfigYaml({
            platform: opts.platform,
            surface: opts.surface,
            locale,
            plansDir,
            verifyEnabled,
            maxErrorsBeforePause,
          }),
          { encoding: "utf8", flag: "wx" },
        );
        assertWrittenInsideProject(
          projectRoot,
          configPath,
          ".autopilot/config.yml",
        );
      } catch (err) {
        const code =
          err && typeof err === "object" && "code" in err
            ? String((err as { code: unknown }).code)
            : "";
        if (code === "EEXIST") {
          try {
            const raced = fs.lstatSync(configPath);
            if (raced.isSymbolicLink()) {
              return {
                ok: false,
                error: ".autopilot/config.yml is a symlink; refusing to open",
              };
            }
            if (!raced.isFile()) {
              return {
                ok: false,
                error:
                  ".autopilot/config.yml exists and is not a regular file; refusing to open",
              };
            }
          } catch (stErr) {
            if (stErr instanceof Error && /symlink/i.test(stErr.message)) {
              return { ok: false, error: stErr.message };
            }
            // Gone again — treat as contended init rather than success.
          }
          return {
            ok: false,
            error:
              "Project already initialized (.autopilot/config.yml exists). Re-run with --force to refresh (config.yml kept; hooks merge; plans untouched).",
          };
        }
        throw err;
      }
      createdConfig = true;
      written.push(path.relative(projectRoot, configPath));
    }

    const rollbackFreshConfig = (): void => {
      if (!createdConfig) return;
      try {
        fs.unlinkSync(configPath);
        createdConfig = false;
      } catch {
        // Best-effort: leave crumbs rather than mask the root error.
      }
    };

    const version =
      typeof opts.packageVersion === "string" && opts.packageVersion.trim()
        ? opts.packageVersion.trim()
        : PACKAGE_VERSION;
    const pinPath = path.join(autopilotDir, "pin.json");
    assertNotSymlink(pinPath, ".autopilot/pin.json");
    writeFileAtomic(
      pinPath,
      JSON.stringify({ "autopilot-harness": version }, null, 2) + "\n",
      projectRoot,
      ".autopilot/",
    );
    written.push(path.relative(projectRoot, pinPath));

    const binDir = path.join(autopilotDir, "bin");
    mkdirRealDirSync(binDir, ".autopilot/bin/", projectRoot);
    assertRealpathInside(projectRoot, binDir, ".autopilot/bin/");
    copyHookAsset(cliRoot, binDir, projectRoot);
    written.push(
      path.relative(
        projectRoot,
        path.join(binDir, "autopilot-harness-hook.mjs"),
      ),
    );

    written.push(...installSkills(templatesRoot, projectRoot, locale));
    written.push(...installWorkflows(templatesRoot, projectRoot));

    // Fresh init only: plans tree / plans gitignore / quickstart follow wizard.
    // Force refresh must not create a second plans dir or rewrite docs.
    if (!configExists) {
      const plansReadme = ensurePlansReadme(projectRoot, plansDir);
      if (plansReadme) written.push(plansReadme);
    }

    const runtimeGi = applyAutopilotRuntimeGitignore(projectRoot);
    if (runtimeGi && !written.includes(runtimeGi)) written.push(runtimeGi);

    if (!configExists && opts.plansGit === "local-only") {
      const gi = applyPlansGitignore(projectRoot, plansDir);
      if (gi && !written.includes(gi)) written.push(gi);
    }

    if (!configExists && writeQs) {
      const qsRel = writeQuickstart(
        projectRoot,
        locale,
        plansDir,
      );
      if (qsRel && !written.includes(qsRel)) written.push(qsRel);
    }

    // Re-read hooks immediately before write to shrink TOCTOU with other tools.
    const hooksFresh = readHooksFile(hooksPath);
    if (!hooksFresh.ok) {
      rollbackFreshConfig();
      return { ok: false, error: hooksFresh.error };
    }
    try {
      assertNotSymlink(cursorDir, ".cursor/");
      assertNotSymlink(hooksPath, ".cursor/hooks.json");
    } catch (err) {
      rollbackFreshConfig();
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
    mkdirRealDirSync(path.dirname(hooksPath), ".cursor/", projectRoot);
    assertRealpathInside(projectRoot, path.dirname(hooksPath), ".cursor/");
    const merged = mergeHooksJson(hooksFresh.value);
    writeFileAtomic(
      hooksPath,
      JSON.stringify(merged, null, 2) + "\n",
      projectRoot,
      ".cursor/",
    );
    written.push(path.relative(projectRoot, hooksPath));

    return { ok: true, written };
  } catch (err) {
    if (createdConfig) {
      try {
        fs.unlinkSync(configPath);
      } catch {
        // best-effort
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `init failed: ${msg}` };
  }
}
