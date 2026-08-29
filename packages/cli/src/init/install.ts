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
  const candidates = [
    path.join(cliRoot, "assets", "autopilot-harness-hook.mjs"),
    path.join(cliRoot, "dist", "assets", "autopilot-harness-hook.mjs"),
  ];
  const src = candidates.find((p) => fs.existsSync(p));
  if (!src) {
    throw new Error("Missing autopilot-harness-hook.mjs asset in CLI package");
  }
  fs.mkdirSync(destBin, { recursive: true });
  fs.copyFileSync(src, path.join(destBin, "autopilot-harness-hook.mjs"));
}

function installSkills(templatesRoot: string, projectRoot: string): string[] {
  const written: string[] = [];
  for (const name of SKILL_NAMES) {
    const tplPath = path.join(templatesRoot, "skills", name, "SKILL.md.tpl");
    if (!fs.existsSync(tplPath)) {
      throw new Error(`Missing skill template: ${tplPath}`);
    }
    const destDir = path.join(projectRoot, ".cursor", "skills", name);
    fs.mkdirSync(destDir, { recursive: true });
    const body = renderSkill(
      fs.readFileSync(tplPath, "utf8"),
      SKILL_DESCRIPTIONS[name] ?? name,
    );
    const dest = path.join(destDir, "SKILL.md");
    fs.writeFileSync(dest, body, "utf8");
    written.push(path.relative(projectRoot, dest));
  }
  return written;
}

function installWorkflows(templatesRoot: string, projectRoot: string): string[] {
  const written: string[] = [];
  const destDir = path.join(projectRoot, "docs", "autopilot", "workflows");
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of ["autopilot-planning.md", "autopilot-executing.md"]) {
    const src = path.join(templatesRoot, "workflows", name);
    if (!fs.existsSync(src)) {
      throw new Error(`Missing workflow template: ${src}`);
    }
    const dest = path.join(destDir, name);
    fs.copyFileSync(src, dest);
    written.push(path.relative(projectRoot, dest));
  }
  return written;
}

function ensurePlansReadme(projectRoot: string): string | null {
  const plansDir = path.join(projectRoot, "plans");
  const readme = path.join(plansDir, "README.md");
  if (fs.existsSync(readme)) return null;
  fs.mkdirSync(plansDir, { recursive: true });
  fs.writeFileSync(
    readme,
    `# Plans

Per-track Autopilot artifacts live here:

\`\`\`text
plans/<slug>/brief.md
plans/<slug>/plan.md
plans/<slug>/checklist.md
\`\`\`

Start with \`/autopilot-on\`, then \`/autopilot-run\` when the checklist is ready.
`,
    "utf8",
  );
  return path.relative(projectRoot, readme);
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
  const configExists = fs.existsSync(configPath);

  if (configExists && !opts.force) {
    return {
      ok: false,
      error:
        "Project already initialized (.autopilot/config.yml exists). Re-run with --force to refresh (config.yml kept; hooks merge; plans untouched).",
    };
  }

  const { cliRoot, templatesRoot } = resolvePackageRoots();
  if (!fs.existsSync(path.join(templatesRoot, "skills"))) {
    return {
      ok: false,
      error: `Templates package not found at ${templatesRoot}`,
    };
  }

  const hooksPath = path.join(projectRoot, ".cursor", "hooks.json");
  const hooksRead = readHooksFile(hooksPath);
  if (!hooksRead.ok) {
    return { ok: false, error: hooksRead.error };
  }

  try {
    const written: string[] = [];
    fs.mkdirSync(autopilotDir, { recursive: true });

    // Only write config on first init — never clobber user config on --force
    if (!configExists) {
      const locale = opts.locale as InitLocale;
      fs.writeFileSync(
        configPath,
        defaultConfigYaml({
          platform: opts.platform,
          surface: opts.surface,
          locale,
        }),
        "utf8",
      );
      written.push(path.relative(projectRoot, configPath));
    }

    const version = opts.packageVersion ?? PACKAGE_VERSION;
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

    const plansReadme = ensurePlansReadme(projectRoot);
    if (plansReadme) written.push(plansReadme);

    fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
    const merged = mergeHooksJson(hooksRead.value);
    fs.writeFileSync(hooksPath, JSON.stringify(merged, null, 2) + "\n", "utf8");
    written.push(path.relative(projectRoot, hooksPath));

    return { ok: true, written };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `init failed: ${msg}` };
  }
}
