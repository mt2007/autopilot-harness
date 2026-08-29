import en from "../locales/en.json" with { type: "json" };
import zhCN from "../locales/zh-CN.json" with { type: "json" };

export type LocaleCode = "en" | "zh-CN";

const LOCALES: Record<LocaleCode, typeof en> = {
  en,
  "zh-CN": zhCN,
};

export function loadLocale(code: string): typeof en {
  if (code in LOCALES) {
    return LOCALES[code as LocaleCode];
  }
  return LOCALES.en;
}

export function supportedLocales(): LocaleCode[] {
  return ["en", "zh-CN"];
}

export { en, zhCN };
