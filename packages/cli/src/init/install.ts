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
  assertRealpathInside,
  normalizePlansDir,
  writeQuickstart,
} from "./wizard-helpers.js";
import { skillDescriptions } from "@autopilot-harness/i18n";

export {
  mergeHooksJson,
  countAutopilotDuplicates,
  validateHooksShape,
  hasCompleteAutopilotHooks,
  summarizeAutopilotHooks,
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
    candidates.find((p) => fs.existsSync(path.join(p, "skills"))) ??
    candidates[0]!;
  return { cliRoot, templatesRoot };
}

function resolveHookAsset(cliRoot: string): string | null {
  const candidates = [
    path.join(cliRoot, "assets", "autopilot-harness-hook.mjs"),
    path.join(cliRoot, "dist", "assets", "autopilot-harness-hook.mjs"),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
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
    if (!fs.existsSync(runtime) || !fs.existsSync(mig)) continue;
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

/** Rename staged tmp into place (keeps prior dest until rename succeeds). */
function renameIntoPlace(tmp: string, dest: string): void {
  try {
    fs.renameSync(tmp, dest);
    return;
  } catch (first) {
    const code =
      first && typeof first === "object" && "code" in first
        ? String((first as { code: unknown }).code)
        : "";
    // Cross-device: same-dir temps should not hit this, but copy is safe.
    if (code === "EXDEV") {
      fs.copyFileSync(tmp, dest);
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* dest is good; tmp leak is OK */
      }
      return;
    }
    // Windows may refuse rename-over-existing (EPERM/EEXIST).
    // Park dest aside so a failed/partial replace can restore (no hole/corrupt).
    const replaceOver = code === "EPERM" || code === "EEXIST";
    if (!replaceOver || !fs.existsSync(tmp) || !fs.existsSync(dest)) {
      throw first;
    }
    const bak = `${dest}.${process.pid}.${Date.now()}.bak`;
    fs.renameSync(dest, bak);
    try {
      try {
        fs.renameSync(tmp, dest);
      } catch {
        fs.copyFileSync(tmp, dest);
        try {
          fs.unlinkSync(tmp);
        } catch {
          /* dest is good; tmp leak is OK */
        }
      }
    } catch (err) {
      // Drop any partial dest, then put the prior file back.
      try {
        fs.unlinkSync(dest);
      } catch {
        /* may not exist */
      }
      try {
        fs.renameSync(bak, dest);
      } catch {
        /* leave bak for manual recovery */
      }
      throw err;
    }
    try {
      fs.unlinkSync(bak);
    } catch {
      /* best-effort cleanup */
    }
  }
}

function copyVendorDir(cliRoot: string, destBin: string): void {
  const vendorRoot = resolveVendorRoot(cliRoot);
  if (!vendorRoot) {
    throw new Error(
      "Missing assets/vendor/runtime.mjs or migrations — run pnpm bundle-vendor (or pnpm build)",
    );
  }
  const runtimeSrc = path.join(vendorRoot, "runtime.mjs");
  const migSrc = path.join(vendorRoot, "migrations", "001_initial.sql");

  const destVendor = path.join(destBin, "vendor");
  assertNotSymlink(destVendor, ".autopilot/bin/vendor/");
  fs.mkdirSync(destVendor, { recursive: true });
  const runtimeDest = path.join(destVendor, "runtime.mjs");
  assertNotSymlink(runtimeDest, ".autopilot/bin/vendor/runtime.mjs");

  const migDestDir = path.join(destVendor, "migrations");
  assertNotSymlink(migDestDir, ".autopilot/bin/vendor/migrations/");
  fs.mkdirSync(migDestDir, { recursive: true });
  const migDest = path.join(migDestDir, "001_initial.sql");
  assertNotSymlink(migDest, ".autopilot/bin/vendor/migrations/001_initial.sql");

  // Stage both temps first so a mid-stage failure does not wipe a good prior pair.
  // Commit migration before runtime: a torn upgrade then keeps old runtime + new
  // SQL (still loadable); the reverse (new runtime + old SQL) is worse for migrate.
  const runtimeTmp = path.join(
    destVendor,
    `.runtime.mjs.${process.pid}.${Date.now()}.tmp`,
  );
  const migTmp = path.join(
    migDestDir,
    `.001_initial.sql.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    fs.copyFileSync(runtimeSrc, runtimeTmp);
    fs.copyFileSync(migSrc, migTmp);
    renameIntoPlace(migTmp, migDest);
    renameIntoPlace(runtimeTmp, runtimeDest);
  } catch (err) {
    try {
      fs.unlinkSync(runtimeTmp);
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(migTmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

function copyHookAsset(cliRoot: string, destBin: string): void {
  const src = resolveHookAsset(cliRoot);
  if (!src) {
    throw new Error("Missing autopilot-harness-hook.mjs asset in CLI package");
  }
  fs.mkdirSync(destBin, { recursive: true });
  // Vendor first: if this fails, leave the previous hook intact.
  copyVendorDir(cliRoot, destBin);
  const hookDest = path.join(destBin, "autopilot-harness-hook.mjs");
  assertNotSymlink(hookDest, ".autopilot/bin/autopilot-harness-hook.mjs");
  fs.copyFileSync(src, hookDest);
}

type HooksRead =
  | { ok: true; value: HooksFile | null }
  | { ok: false; error: string };

/** Read hooks.json; refuse to clobber an existing unreadable file. */
function readHooksFile(filePath: string): HooksRead {
  if (!fs.existsSync(filePath)) return { ok: true, value: null };
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
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

function writeFileAtomic(filePath: string, contents: string): void {
  const dir = path.dirname(filePath);
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    fs.writeFileSync(tmp, contents, "utf8");
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore cleanup */
    }
    throw err;
  }
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
    return `Unsupported platform "${platform}" in v0.1 (only cursor).`;
  }
  if (surface !== "ide") {
    return `Unsupported surface "${surface}" in v0.1 (only ide).`;
  }
  if (locale !== "en" && locale !== "zh-CN") {
    return `Unsupported locale "${locale}" (en | zh-CN).`;
  }
  return null;
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
    if (!fs.existsSync(tplPath)) {
      throw new Error(`Missing skill template: ${tplPath}`);
    }
    const destDir = path.join(skillsRoot, name);
    assertNotSymlink(destDir, `.cursor/skills/${name}/`);
    fs.mkdirSync(destDir, { recursive: true });
    assertRealpathInside(projectRoot, destDir, `.cursor/skills/${name}/`);
    const body = renderSkill(
      fs.readFileSync(tplPath, "utf8"),
      descriptions[name] ?? name,
    );
    const dest = path.join(destDir, "SKILL.md");
    assertNotSymlink(dest, `.cursor/skills/${name}/SKILL.md`);
    writeFileAtomic(dest, body);
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
  fs.mkdirSync(destDir, { recursive: true });
  assertRealpathInside(projectRoot, destDir, "docs/autopilot/workflows/");
  for (const name of WORKFLOW_FILES) {
    const src = path.join(templatesRoot, "workflows", name);
    if (!fs.existsSync(src)) {
      throw new Error(`Missing workflow template: ${src}`);
    }
    const dest = path.join(destDir, name);
    assertNotSymlink(dest, `docs/autopilot/workflows/${name}`);
    fs.copyFileSync(src, dest);
    written.push(path.relative(projectRoot, dest));
  }
  return written;
}

function ensurePlansReadme(
  projectRoot: string,
  plansDir = "plans",
): string | null {
  const normalized = normalizePlansDir(plansDir);
  if (!normalized.ok) {
    throw new Error(normalized.error);
  }
  const safePlansDir = normalized.value;
  const plansRoot = path.join(projectRoot, safePlansDir);
  const resolvedRoot = path.resolve(projectRoot);
  const resolvedPlans = path.resolve(plansRoot);
  if (
    resolvedPlans !== resolvedRoot &&
    !resolvedPlans.startsWith(resolvedRoot + path.sep)
  ) {
    throw new Error("plansDir resolves outside the project root");
  }

  // Refuse symlink escapes (path.resolve does not follow links; write would).
  if (fs.existsSync(plansRoot)) {
    assertNotSymlink(plansRoot, "plansDir");
  }

  const readme = path.join(plansRoot, "README.md");
  if (fs.existsSync(readme)) {
    assertNotSymlink(readme, "plans README");
    return null;
  }
  fs.mkdirSync(plansRoot, { recursive: true });
  assertRealpathInside(projectRoot, plansRoot, "plansDir");

  fs.writeFileSync(
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
    "utf8",
  );
  return path.relative(projectRoot, readme);
}

export type PreflightResult = { ok: true } | { ok: false; error: string };

/**
 * Read-only checks before force-refresh / upgrade mutates the project.
 * Ensures templates, hook asset, and hooks.json are merge-safe (fail closed).
 */
export function preflightForceRefresh(projectRoot: string): PreflightResult {
  const root = path.resolve(projectRoot);
  const { cliRoot, templatesRoot } = resolvePackageRoots();
  if (!fs.existsSync(path.join(templatesRoot, "skills"))) {
    return {
      ok: false,
      error: `Templates package not found at ${templatesRoot}`,
    };
  }
  for (const name of SKILL_NAMES) {
    const tplPath = path.join(templatesRoot, "skills", name, "SKILL.md.tpl");
    if (!fs.existsSync(tplPath)) {
      return { ok: false, error: `Missing skill template: ${tplPath}` };
    }
  }
  for (const name of WORKFLOW_FILES) {
    const src = path.join(templatesRoot, "workflows", name);
    if (!fs.existsSync(src)) {
      return { ok: false, error: `Missing workflow template: ${src}` };
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
  const unsupported = assertSupported(opts.platform, opts.surface, opts.locale);
  if (unsupported) {
    return { ok: false, error: unsupported };
  }

  const projectRoot = path.resolve(opts.projectRoot);
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

  const configExists = fs.existsSync(configPath);

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
  const writeQs = opts.writeQuickstart !== false;

  let createdConfig = false;
  try {
    const written: string[] = [];
    fs.mkdirSync(autopilotDir, { recursive: true });

    // Only write config on first init — never clobber user config on --force.
    // wx: fail closed if another process created config.yml between check and write.
    if (!configExists) {
      const locale = opts.locale as InitLocale;
      try {
        fs.writeFileSync(
          configPath,
          defaultConfigYaml({
            platform: opts.platform,
            surface: opts.surface,
            locale,
            plansDir,
            verifyEnabled,
          }),
          { encoding: "utf8", flag: "wx" },
        );
      } catch (err) {
        const code =
          err && typeof err === "object" && "code" in err
            ? String((err as { code: unknown }).code)
            : "";
        if (code === "EEXIST") {
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
    fs.writeFileSync(
      pinPath,
      JSON.stringify({ "autopilot-harness": version }, null, 2) + "\n",
      "utf8",
    );
    written.push(path.relative(projectRoot, pinPath));

    const binDir = path.join(autopilotDir, "bin");
    assertNotSymlink(binDir, ".autopilot/bin/");
    fs.mkdirSync(binDir, { recursive: true });
    assertRealpathInside(projectRoot, binDir, ".autopilot/bin/");
    copyHookAsset(cliRoot, binDir);
    written.push(
      path.relative(
        projectRoot,
        path.join(binDir, "autopilot-harness-hook.mjs"),
      ),
    );

    written.push(...installSkills(templatesRoot, projectRoot, opts.locale as InitLocale));
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
        opts.locale as InitLocale,
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
    fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
    assertRealpathInside(projectRoot, path.dirname(hooksPath), ".cursor/");
    const merged = mergeHooksJson(hooksFresh.value);
    fs.writeFileSync(hooksPath, JSON.stringify(merged, null, 2) + "\n", "utf8");
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
