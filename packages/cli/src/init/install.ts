import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultConfigYaml, SKILL_DESCRIPTIONS } from "./default-config.js";
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

function renderSkill(template: string, description: string): string {
  return template.replaceAll("{{description}}", description);
}

function copyHookAsset(cliRoot: string, destBin: string): void {
  const src = resolveHookAsset(cliRoot);
  if (!src) {
    throw new Error("Missing autopilot-harness-hook.mjs asset in CLI package");
  }
  fs.mkdirSync(destBin, { recursive: true });
  fs.copyFileSync(src, path.join(destBin, "autopilot-harness-hook.mjs"));
}

function installSkills(templatesRoot: string, projectRoot: string): string[] {
  const written: string[] = [];
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
      SKILL_DESCRIPTIONS[name] ?? name,
    );
    const dest = path.join(destDir, "SKILL.md");
    assertNotSymlink(dest, `.cursor/skills/${name}/SKILL.md`);
    fs.writeFileSync(dest, body, "utf8");
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
    copyHookAsset(cliRoot, binDir);
    written.push(
      path.relative(
        projectRoot,
        path.join(binDir, "autopilot-harness-hook.mjs"),
      ),
    );

    written.push(...installSkills(templatesRoot, projectRoot));
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
