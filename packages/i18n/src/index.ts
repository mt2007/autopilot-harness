import en from "../locales/en.json" with { type: "json" };
import zhCN from "../locales/zh-CN.json" with { type: "json" };

export type LocaleCode = "en" | "zh-CN";

export type LocaleBundle = typeof en;

const LOCALES: Record<LocaleCode, LocaleBundle> = {
  en,
  "zh-CN": zhCN,
};

export function isLocaleCode(code: string): code is LocaleCode {
  return code === "en" || code === "zh-CN";
}

export function loadLocale(code: string): LocaleBundle {
  if (isLocaleCode(code)) {
    return LOCALES[code];
  }
  return LOCALES.en;
}

export function supportedLocales(): LocaleCode[] {
  return ["en", "zh-CN"];
}

/** Slash skill folder name → i18n skill key. */
export const SKILL_I18N_KEYS = {
  "autopilot-on": "autopilot_on",
  "autopilot-run": "autopilot_run",
  "autopilot-off": "autopilot_off",
  "autopilot-resume": "autopilot_resume",
  "autopilot-replan": "autopilot_replan",
} as const;

export type SkillFolderName = keyof typeof SKILL_I18N_KEYS;

export function skillDescription(
  locale: string,
  skillFolder: SkillFolderName,
): string {
  const bundle = loadLocale(locale);
  const key = SKILL_I18N_KEYS[skillFolder];
  return bundle.skill[key].description;
}

export function skillDescriptions(
  locale: string,
): Record<SkillFolderName, string> {
  return {
    "autopilot-on": skillDescription(locale, "autopilot-on"),
    "autopilot-run": skillDescription(locale, "autopilot-run"),
    "autopilot-off": skillDescription(locale, "autopilot-off"),
    "autopilot-resume": skillDescription(locale, "autopilot-resume"),
    "autopilot-replan": skillDescription(locale, "autopilot-replan"),
  };
}

export type TriggerKey =
  | "on"
  | "run"
  | "off"
  | "resume"
  | "replan"
  | "resume_review";

export function stockTriggers(
  locale: string,
): Record<TriggerKey, string[]> {
  const t = loadLocale(locale).triggers;
  return {
    on: [...t.on],
    run: [...t.run],
    off: [...t.off],
    resume: [...t.resume],
    replan: [...t.replan],
    resume_review: [...t.resume_review],
  };
}

/** True if both are string arrays with the same ordered values. */
export function sameStringList(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return false;
  }
  return a.every((v, i) => v === b[i]);
}

export { en, zhCN };
