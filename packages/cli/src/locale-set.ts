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
import { applyFactorySkillFrontmatter, applyDevinSkillFrontmatter } from "./init/install.js";
import { readConfigPlatformsOrThrow } from "./init/config-merge.js";
import { platformsWantAgentsSkills, platformsWantInstallableHost, type HostSkillsParent } from "./init/platforms.js";
import { resolveHermesHome } from "./init/hermes-hooks-merge.js";

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
 * Older init defaults. Treat as stock so locale set still migrates triggers
 * written before stockTriggers() grew phrases / went bilingual (config-wire).
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

/** Locale-narrowed stocks immediately before bilingual DEFAULT alignment. */
const PRE_BILINGUAL_STOCK: Record<LocaleCode, Record<TriggerKey, string[]>> = {
  en: {
    on: ["Autopilot ON", "Enable autopilot"],
    run: ["Autopilot RUN", "Start execution"],
    off: ["Autopilot OFF", "Disable autopilot"],
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

function skillHostsFromConfigYaml(yaml: string): {
  project: HostSkillsParent[];
  hermes: boolean;
} {
  const platforms = readConfigPlatformsOrThrow(yaml);
  const project: HostSkillsParent[] = [];
  // platformsWantInstallableHost (not configWantsInstallableHost): no Cursor
  // fallback when installable list is empty / wrong-surface only.
  if (platformsWantInstallableHost(platforms, "cursor")) project.push(".cursor");
  if (platformsWantInstallableHost(platforms, "claude-code")) {
    project.push(".claude");
  }
  if (platformsWantInstallableHost(platforms, "copilot-cli")) {
    project.push(".github");
  }
  if (platformsWantInstallableHost(platforms, "grok-build")) {
    project.push(".grok");
  }
  if (platformsWantInstallableHost(platforms, "gemini-cli")) {
    project.push(".gemini");
  }
  if (platformsWantInstallableHost(platforms, "factory-droid")) {
    project.push(".factory");
  }
  if (platformsWantInstallableHost(platforms, "devin")) {
    project.push(".devin");
  }
  if (platformsWantAgentsSkills(platforms)) {
    project.push(".agents");
  }
  return {
    project,
    hermes: platformsWantInstallableHost(platforms, "hermes-agent"),
  };
}

function rewriteProjectSkills(
  projectRoot: string,
  locale: LocaleCode,
  hostSkillsParent: HostSkillsParent,
): string[] {
  const written: string[] = [];
  const templatesRoot = resolveTemplatesRoot();
  const descriptions = skillDescriptions(locale);
  const skillsRoot = path.join(projectRoot, hostSkillsParent, "skills");
  const skillsLabel = `${hostSkillsParent}/skills/`;
  assertNotSymlink(skillsRoot, skillsLabel);
  mkdirRealDirSync(skillsRoot, skillsLabel, projectRoot);
  if (!isRealDirectory(skillsRoot)) {
    throw new Error(`${skillsLabel} exists and is not a directory`);
  }

  for (const name of SKILL_NAMES) {
    const tplPath = path.join(templatesRoot, "skills", name, "SKILL.md.tpl");
    assertPresentRealFile(tplPath, `skill template ${name}`);
    const destDir = path.join(skillsRoot, name);
    mkdirRealDirSync(destDir, `${skillsLabel}${name}/`, projectRoot);
    assertRealpathInside(projectRoot, destDir, `${skillsLabel}${name}/`);
    const dest = path.join(destDir, "SKILL.md");
    assertNotSymlink(dest, `${skillsLabel}${name}/SKILL.md`);
    let body = renderSkill(
      readUntrustedUtf8File(
        tplPath,
        MAX_UNTRUSTED_TEXT_BYTES,
        `skill template ${name}`,
      ),
      descriptions[name] ?? name,
    );
    if (hostSkillsParent === ".factory") {
      body = applyFactorySkillFrontmatter(body);
    }
    if (hostSkillsParent === ".devin") {
      body = applyDevinSkillFrontmatter(body);
    }
    writeFileAtomic(dest, body, projectRoot, `${skillsLabel}${name}/`);
    written.push(path.relative(projectRoot, dest));
  }
  return written;
}

function rewriteHermesSkills(locale: LocaleCode): string[] {
  const written: string[] = [];
  const templatesRoot = resolveTemplatesRoot();
  const descriptions = skillDescriptions(locale);
  const hermesHome = resolveHermesHome();
  assertNotSymlink(hermesHome, "Hermes home/");
  try {
    const homeSt = fs.lstatSync(hermesHome);
    if (!homeSt.isDirectory()) {
      throw new Error("Hermes home/ exists and is not a directory");
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") throw err;
  }
  const skillsRoot = path.join(hermesHome, "skills");
  assertNotSymlink(skillsRoot, "$HERMES_HOME/skills/");
  mkdirRealDirSync(skillsRoot, "$HERMES_HOME/skills/", hermesHome);
  assertNotSymlink(hermesHome, "Hermes home/");
  if (!isRealDirectory(hermesHome)) {
    throw new Error("Hermes home/ is not a real directory");
  }
  for (const name of SKILL_NAMES) {
    const tplPath = path.join(templatesRoot, "skills", name, "SKILL.md.tpl");
    assertPresentRealFile(tplPath, `skill template ${name}`);
    const destDir = path.join(skillsRoot, name);
    mkdirRealDirSync(destDir, `$HERMES_HOME/skills/${name}/`, hermesHome);
    assertRealpathInside(hermesHome, destDir, `$HERMES_HOME/skills/${name}/`);
    const dest = path.join(destDir, "SKILL.md");
    assertNotSymlink(dest, `$HERMES_HOME/skills/${name}/SKILL.md`);
    const body = renderSkill(
      readUntrustedUtf8File(
        tplPath,
        MAX_UNTRUSTED_TEXT_BYTES,
        `skill template ${name}`,
      ),
      descriptions[name] ?? name,
    );
    writeFileReplaceSync(dest, body);
    assertRealpathInside(
      hermesHome,
      dest,
      `$HERMES_HOME/skills/${name}/SKILL.md`,
    );
    written.push(dest);
  }
  return written;
}

function rewriteEnabledSkills(
  projectRoot: string,
  locale: LocaleCode,
  hosts: { project: HostSkillsParent[]; hermes: boolean },
): string[] {
  const written: string[] = [];
  for (const host of hosts.project) {
    written.push(...rewriteProjectSkills(projectRoot, locale, host));
  }
  if (hosts.hermes) {
    written.push(...rewriteHermesSkills(locale));
  }
  return written;
}

function isStockTriggerList(current: unknown, key: TriggerKey): boolean {
  // Match stock/legacy for *any* known locale so a wrong/missing config.locale
  // cannot freeze the other language's stock phrases as "custom".
  for (const loc of ["en", "zh-CN"] as const) {
    if (sameStringList(current, stockTriggers(loc)[key])) return true;
    if (sameStringList(current, LEGACY_STOCK[loc][key])) return true;
    if (sameStringList(current, PRE_BILINGUAL_STOCK[loc][key])) return true;
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

  let skillHosts: { project: HostSkillsParent[]; hermes: boolean };
  try {
    skillHosts = skillHostsFromConfigYaml(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Cannot read platforms in config.yml: ${msg}` };
  }

  try {
    for (const host of skillHosts.project) {
      const hostDir = path.join(projectRoot, host);
      assertNotSymlink(hostDir, `${host}/`);
      try {
        const st = fs.lstatSync(hostDir);
        if (!st.isDirectory()) {
          throw new Error(`${host}/ exists and is not a directory`);
        }
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code !== "ENOENT") throw err;
      }
    }
    if (skillHosts.hermes) {
      const hermesHome = resolveHermesHome();
      assertNotSymlink(hermesHome, "Hermes home/");
      try {
        const st = fs.lstatSync(hermesHome);
        if (!st.isDirectory()) {
          throw new Error("Hermes home/ exists and is not a directory");
        }
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code !== "ENOENT") throw err;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
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
    if (skillHosts.project.length > 0 || skillHosts.hermes) {
      assertTemplatesReady();
      // Ensure skills trees are creatable *before* rewriting config.yml.
      for (const host of skillHosts.project) {
        const skillsRoot = path.join(projectRoot, host, "skills");
        mkdirRealDirSync(skillsRoot, `${host}/skills/`, projectRoot);
        assertRealpathInside(projectRoot, skillsRoot, `${host}/skills/`);
      }
      if (skillHosts.hermes) {
        const hermesHome = resolveHermesHome();
        const skillsRoot = path.join(hermesHome, "skills");
        mkdirRealDirSync(skillsRoot, "$HERMES_HOME/skills/", hermesHome);
        assertRealpathInside(hermesHome, skillsRoot, "$HERMES_HOME/skills/");
      }
    }
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
    written.push(...rewriteEnabledSkills(projectRoot, nextLocale, skillHosts));
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
