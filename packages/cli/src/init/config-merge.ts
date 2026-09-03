import { parseDocument, stringify as stringifyYaml } from "yaml";
import {
  parsePlatformBindingsFromConfig,
  primaryBinding,
  type PlatformBinding,
} from "./platforms.js";

/** Cap YAML aliases on toJS (yaml@2.9+: not a parse-time option). */
const YAML_TO_JS_OPTS = { maxAliasCount: 64 } as const;

function parseYamlSafe(text: string): unknown {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    throw doc.errors[0]!;
  }
  return doc.toJS(YAML_TO_JS_OPTS);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

/** Keys that must never be copied from YAML into merged objects. */
function isUnsafeKey(key: string): boolean {
  return key === "__proto__" || key === "prototype" || key === "constructor";
}

/**
 * Deep-merge defaults into existing config: only fill missing keys.
 * Never overwrites user scalars/arrays/objects that already exist.
 */
export function mergeMissingKeys(
  existing: Record<string, unknown>,
  defaults: Record<string, unknown>,
  basePath = "",
  stack: object[] = [],
): { merged: Record<string, unknown>; addedPaths: string[] } {
  if (stack.includes(existing) || stack.includes(defaults)) {
    throw new Error(
      `circular reference in config at ${basePath || "(root)"}`,
    );
  }
  const nextStack = [...stack, existing, defaults];

  const merged: Record<string, unknown> = { ...existing };
  for (const unsafe of ["__proto__", "prototype", "constructor"] as const) {
    if (Object.prototype.hasOwnProperty.call(merged, unsafe)) {
      Reflect.deleteProperty(merged, unsafe);
    }
  }
  const addedPaths: string[] = [];

  for (const [key, defVal] of Object.entries(defaults)) {
    if (isUnsafeKey(key)) continue;
    const path = basePath ? `${basePath}.${key}` : key;
    const own = Object.prototype.hasOwnProperty.call(merged, key);
    if (!own || merged[key] === undefined || merged[key] === null) {
      merged[key] = cloneValue(defVal);
      addedPaths.push(path);
      continue;
    }
    const cur = merged[key];
    if (isPlainObject(cur) && isPlainObject(defVal)) {
      const nested = mergeMissingKeys(cur, defVal, path, nextStack);
      merged[key] = nested.merged;
      addedPaths.push(...nested.addedPaths);
    }
  }

  return { merged, addedPaths };
}

export function mergeConfigYamlMissingKeys(
  existingYaml: string,
  defaultsYaml: string,
): { yaml: string; addedPaths: string[] } {
  const existingRaw: unknown = parseYamlSafe(existingYaml) ?? {};
  const defaultsRaw: unknown = parseYamlSafe(defaultsYaml) ?? {};
  if (!isPlainObject(existingRaw)) {
    throw new Error("config.yml root must be a mapping");
  }
  if (!isPlainObject(defaultsRaw)) {
    throw new Error("default config root must be a mapping");
  }
  const { merged, addedPaths } = mergeMissingKeys(existingRaw, defaultsRaw);
  return {
    yaml: stringifyYaml(merged, { lineWidth: 0 }),
    addedPaths,
  };
}

/** Best-effort read of platforms / legacy platform+surface / locale. */
export function readConfigInstallHints(configYaml: string): {
  platform: string;
  surface: string;
  locale: string;
  platforms: PlatformBinding[];
} {
  const fallback = {
    platform: "cursor",
    surface: "ide",
    locale: "en",
    platforms: [{ id: "cursor", surface: "ide" }] as PlatformBinding[],
  };
  try {
    const parsed: unknown = parseYamlSafe(configYaml);
    if (!isPlainObject(parsed)) {
      return fallback;
    }
    const platforms = parsePlatformBindingsFromConfig(parsed);
    const primary = primaryBinding(platforms);
    return {
      platform: primary.id,
      surface: primary.surface,
      locale: typeof parsed.locale === "string" ? parsed.locale : "en",
      platforms,
    };
  } catch {
    return fallback;
  }
}

/**
 * Fail-closed platforms parse for merge/commit paths.
 * Unlike {@link readConfigInstallHints}, never invents a `[cursor]` baseline that
 * could overwrite a real `platforms` list when YAML is only partially readable.
 */
export function readConfigPlatformsOrThrow(
  configYaml: string,
): PlatformBinding[] {
  const parsed: unknown = parseYamlSafe(configYaml);
  if (!isPlainObject(parsed)) {
    throw new Error("config.yml root must be a mapping");
  }
  // Fail closed on over-cap lists so merge/idempotent rewrite cannot truncate
  // unique hosts that best-effort readers would otherwise silently drop.
  return parsePlatformBindingsFromConfig(parsed, { failOnOverflow: true });
}
