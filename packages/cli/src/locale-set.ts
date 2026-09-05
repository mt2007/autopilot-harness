import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAlias, isMap, isScalar, isSeq, parseDocument } from "yaml";
import {
  isLocaleCode,
  sameStringList,
  skillDescriptions,
  stockTriggers,
  type LocaleCode,
  type SkillFolderName,
  type TriggerKey,
} from "@autopilot-harness/i18n";
import { assertNotSymlink, assertRealpathInside, mkdirRealDirSync, assertParentDirInProject, assertWrittenInsideProject, isRealDirectory, assertPresentRealFile } from "./init/wizard-helpers.js";
import {
  MAX_UNTRUSTED_TEXT_BYTES,
  readUntrustedUtf8File,
  writeFileReplaceSync,
} from "./read-untrusted-file.js";
import { resolveTemplatesRoot as resolveTemplatesRootFromCli } from "./template-paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SKILL_NAMES = [
  "autopilot-on",
  "autopilot-run",
  "autopilot-off",
  "autopilot-resume",
  "autopilot-replan",
] as const satisfies readonly SkillFolderName[];

const TRIGGER_KEYS: TriggerKey[] = [
  "on",
  "run",
  "off",
  "resume",
  "replan",
  "resume_review",
];

/** Refuse absurd configs (DoS / accidental paste). */
const MAX_CONFIG_BYTES = MAX_UNTRUSTED_TEXT_BYTES;

/**
 * Pre-i18n init defaults (en / zh-CN). Treat as stock so locale set still
 * migrates triggers written before stockTriggers() grew extra phrases.
 */
const LEGACY_STOCK: Record<LocaleCode, Record<TriggerKey, string[]>> = {
  en: {
    on: ["Autopilot ON"],
    run: ["Autopilot RUN"],
    off: ["Autopilot OFF"],
    resume: ["Autopilot RESUME"],
    replan: ["Autopilot REPLAN"],
    resume_review: ["Resume review"],
  },
  "zh-CN": {
    on: ["Autopilot ON", "开启自动驾驶"],
    run: ["Autopilot RUN", "开始执行"],
    off: ["Autopilot OFF", "关闭自动驾驶"],
    resume: ["Autopilot RESUME", "继续执行"],
    replan: ["Autopilot REPLAN", "修改方案"],
    resume_review: ["继续自审", "Resume review"],
  },
};

export interface LocaleSetOptions {
  projectRoot: string;
  locale: string;
}

export interface LocaleSetOk {
  ok: true;
  locale: LocaleCode;
  previousLocale: LocaleCode;
  written: string[];
  triggersUpdated: TriggerKey[];
  triggersPreserved: TriggerKey[];
}

export interface LocaleSetFail {
  ok: false;
  error: string;
}

export type LocaleSetResult = LocaleSetOk | LocaleSetFail;

function resolveTemplatesRoot(): string {
  // dist/locale-set.js → .. = packages/cli
  const cliRoot = path.resolve(__dirname, "..");
  return resolveTemplatesRootFromCli(cliRoot);
}

/** Fail closed before mutating the project when templates are unavailable. */
function assertTemplatesReady(): void {
  const templatesRoot = resolveTemplatesRoot();
  if (!isRealDirectory(path.join(templatesRoot, "skills"))) {
    throw new Error(`Templates package not found at ${templatesRoot}`);
  }
  for (const name of SKILL_NAMES) {
    const tplPath = path.join(templatesRoot, "skills", name, "SKILL.md.tpl");
    assertPresentRealFile(tplPath, `skill template ${name}`);
  }
}

/** Escape for YAML double-quoted scalars inside skill frontmatter. */
function escapeYamlDoubleQuoted(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

function renderSkill(template: string, description: string): string {
  return template.replaceAll(
    "{{description}}",
    escapeYamlDoubleQuoted(description),
  );
}

/**
 * Read a trigger list without Node#toJSON (avoids alias expansion).
 * Returns null when the node is not a plain string sequence.
 */
function plainStringList(node: unknown): string[] | null {
  if (node === undefined || node === null) return null;
  if (!isSeq(node)) return null;
  const out: string[] = [];
  for (const item of node.items) {
    if (isAlias(item) || !isScalar(item) || typeof item.value !== "string") {
      return null;
    }
    out.push(item.value);
  }
  return out;
}

function rewriteSkills(projectRoot: string, locale: LocaleCode): string[] {
  const written: string[] = [];
  const templatesRoot = resolveTemplatesRoot();
  const descriptions = skillDescriptions(locale);
  const skillsRoot = path.join(projectRoot, ".cursor", "skills");
  assertNotSymlink(skillsRoot, ".cursor/skills/");

  for (const name of SKILL_NAMES) {
    const tplPath = path.join(templatesRoot, "skills", name, "SKILL.md.tpl");
    assertPresentRealFile(tplPath, `skill template ${name}`);
    const destDir = path.join(skillsRoot, name);
    mkdirRealDirSync(destDir, `.cursor/skills/${name}/`, projectRoot);
    assertRealpathInside(projectRoot, destDir, `.cursor/skills/${name}/`);
    const dest = path.join(destDir, "SKILL.md");
    assertNotSymlink(dest, `.cursor/skills/${name}/SKILL.md`);
    const body = renderSkill(
      readUntrustedUtf8File(
        tplPath,
        MAX_UNTRUSTED_TEXT_BYTES,
        `skill template ${name}`,
      ),
      descriptions[name],
    );
    writeFileAtomic(dest, body, projectRoot, `.cursor/skills/${name}/`);
    written.push(path.relative(projectRoot, dest));
  }
  return written;
}

function isStockTriggerList(current: unknown, key: TriggerKey): boolean {
  // Match stock/legacy for *any* known locale so a wrong/missing config.locale
  // cannot freeze the other language's stock phrases as "custom".
  for (const loc of ["en", "zh-CN"] as const) {
    if (sameStringList(current, stockTriggers(loc)[key])) return true;
    if (sameStringList(current, LEGACY_STOCK[loc][key])) return true;
  }
  return false;
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

/**
 * Switch project locale: set config.locale, update stock triggers only,
 * rewrite skill descriptions. Never touches plans/.
 */
export function setProjectLocale(opts: LocaleSetOptions): LocaleSetResult {
  if (typeof opts.locale !== "string") {
    return {
      ok: false,
      error: `Unsupported locale (en | zh-CN).`,
    };
  }
  if (typeof opts.projectRoot !== "string" || opts.projectRoot.trim() === "") {
    return { ok: false, error: "projectRoot must be a non-empty string" };
  }
  // Strip BOM + trim so copy-pasted args still match isLocaleCode.
  const localeArg = opts.locale.replace(/^\uFEFF/, "").trim();
  if (!isLocaleCode(localeArg)) {
    return {
      ok: false,
      error: `Unsupported locale "${opts.locale}" (en | zh-CN).`,
    };
  }
  const nextLocale = localeArg;

  const projectRoot = path.resolve(opts.projectRoot.trim());
  const configPath = path.join(projectRoot, ".autopilot", "config.yml");

  try {
    assertNotSymlink(path.join(projectRoot, ".autopilot"), ".autopilot/");
    assertNotSymlink(path.join(projectRoot, ".cursor"), ".cursor/");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }

  let raw: string;
  try {
    // Avoid existsSync: dangling symlinks look missing but must fail closed.
    raw = readUntrustedUtf8File(
      configPath,
      MAX_CONFIG_BYTES,
      ".autopilot/config.yml",
    );
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return {
        ok: false,
        error:
          "Project is not initialized (.autopilot/config.yml missing). Run init first.",
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Cannot read config.yml: ${msg}` };
  }
  let doc: ReturnType<typeof parseDocument>;
  try {
    // yaml@2.9+: maxAliasCount is a toJS option, not a parse option.
    doc = parseDocument(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `config.yml is not valid YAML: ${msg}` };
  }
  if (doc.errors.length > 0) {
    const first = doc.errors[0]!;
    return {
      ok: false,
      error: `config.yml YAML error: ${first.message}`,
    };
  }
  if (!doc.contents || !isMap(doc.contents)) {
    return { ok: false, error: "config.yml root must be a mapping" };
  }

  const previousRaw = doc.get("locale");
  const previousLocale: LocaleCode =
    typeof previousRaw === "string" && isLocaleCode(previousRaw)
      ? previousRaw
      : "en";

  const triggersUpdated: TriggerKey[] = [];
  const triggersPreserved: TriggerKey[] = [];
  const newStock = stockTriggers(nextLocale);

  const triggersNode = doc.get("triggers");
  if (isMap(triggersNode)) {
    for (const key of TRIGGER_KEYS) {
      const currentNode = triggersNode.get(key, true);
      // Missing key → install next-locale stock (incomplete configs).
      if (currentNode === undefined || currentNode === null) {
        triggersNode.set(key, [...newStock[key]]);
        triggersUpdated.push(key);
        continue;
      }
      const current = plainStringList(currentNode);
      if (current !== null && isStockTriggerList(current, key)) {
        const next = [...newStock[key]];
        // Skip no-op rewrites so idempotent locale set does not claim "updated".
        if (!sameStringList(current, next)) {
          triggersNode.set(key, next);
          triggersUpdated.push(key);
        }
      } else {
        triggersPreserved.push(key);
      }
    }
  } else if (triggersNode === undefined || triggersNode === null) {
    // No triggers map → install stock (+ default match) for the target locale.
    const built: Record<string, string | string[]> = {
      match: "line_start",
    };
    for (const key of TRIGGER_KEYS) {
      built[key] = [...newStock[key]];
      triggersUpdated.push(key);
    }
    doc.set("triggers", built);
  } else {
    triggersPreserved.push(...TRIGGER_KEYS);
  }

  doc.set("locale", nextLocale);

  try {
    assertTemplatesReady();
    // Ensure skills tree is creatable *before* rewriting config.yml.
    const skillsRoot = path.join(projectRoot, ".cursor", "skills");
    mkdirRealDirSync(skillsRoot, ".cursor/skills/", projectRoot);
    assertRealpathInside(projectRoot, skillsRoot, ".cursor/skills/");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }

  const written: string[] = [];
  try {
    // Config first so a later skill failure can be fixed by re-running locale set.
    writeFileAtomic(configPath, String(doc), projectRoot, ".autopilot/");
    written.push(path.relative(projectRoot, configPath));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `locale set failed writing config: ${msg}` };
  }

  try {
    written.push(...rewriteSkills(projectRoot, nextLocale));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `locale set updated config.yml to ${nextLocale}, but skill rewrite failed: ${msg}. Re-run locale set ${nextLocale} to retry skills.`,
    };
  }

  return {
    ok: true,
    locale: nextLocale,
    previousLocale,
    written,
    triggersUpdated,
    triggersPreserved,
  };
}
