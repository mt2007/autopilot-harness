import { isAlias, isMap, parseDocument } from "yaml";

/** One enabled host + how Autopilot plugs into it. */
export interface PlatformBinding {
  id: string;
  surface: string;
}

/** Surfaces Autopilot understands (install support varies by host). */
export type PlatformSurface = "ide" | "cli" | "runner";

/**
 * Bindings this CLI build can install.
 * Additional hosts appear here when their port ships — not before.
 */
export const INSTALLABLE_BINDINGS: readonly PlatformBinding[] = Object.freeze([
  { id: "cursor", surface: "ide" },
  { id: "claude-code", surface: "cli" },
  { id: "codex", surface: "cli" },
  { id: "kimi-code", surface: "cli" },
  { id: "copilot-cli", surface: "cli" },
  { id: "grok-build", surface: "cli" },
  { id: "gemini-cli", surface: "cli" },
  { id: "factory-droid", surface: "cli" },
  { id: "hermes-agent", surface: "cli" },
  { id: "antigravity", surface: "cli" },
  { id: "pi", surface: "cli" },
  { id: "runner", surface: "runner" },
]);

/** Hard cap so hostile/hand-edited config cannot inflate status/merge work. */
export const MAX_PLATFORM_BINDINGS = 32;

const DEFAULT_SURFACE_BY_ID: Readonly<Record<string, string>> = Object.freeze({
  cursor: "ide",
  "claude-code": "cli",
  codex: "cli",
  "kimi-code": "cli",
  "copilot-cli": "cli",
  "grok-build": "cli",
  "gemini-cli": "cli",
  "factory-droid": "cli",
  "hermes-agent": "cli",
  antigravity: "cli",
  pi: "cli",
  runner: "runner",
});

/** Strip controls / junk; lowercase; cap length (hostile config / CLI). */
export function sanitizePlatformId(raw: string): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .replace(/[^A-Za-z0-9._+-]/g, "")
    .toLowerCase()
    .slice(0, 64);
}

export function sanitizeSurfaceId(raw: string): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .replace(/[^A-Za-z0-9._+-]/g, "")
    .toLowerCase()
    .slice(0, 32);
}

/** Default surface for a host id when the user only names the platform. */
export function defaultSurfaceFor(platformId: string): string {
  const id = sanitizePlatformId(platformId);
  return DEFAULT_SURFACE_BY_ID[id] ?? "ide";
}

export function bindingKey(b: PlatformBinding): string {
  return `${sanitizePlatformId(b.id)}:${sanitizeSurfaceId(b.surface)}`;
}

export function normalizeBinding(
  idRaw: string,
  surfaceRaw?: string,
): PlatformBinding | null {
  const id = sanitizePlatformId(idRaw);
  if (!id) return null;
  const surface = sanitizeSurfaceId(
    surfaceRaw && surfaceRaw.trim() !== ""
      ? surfaceRaw
      : defaultSurfaceFor(id),
  );
  if (!surface) return null;
  return { id, surface };
}

export function isInstallableBinding(b: PlatformBinding): boolean {
  const key = bindingKey(b);
  return INSTALLABLE_BINDINGS.some((x) => bindingKey(x) === key);
}

/**
 * Whether doctor/upgrade should require wiring for `hostId`.
 * Empty / legacy platforms lists (no installable bindings) default to Cursor-only.
 */
export function configWantsInstallableHost(
  platforms: readonly PlatformBinding[],
  hostId: string,
): boolean {
  const want = sanitizePlatformId(hostId);
  const installable = platforms.filter((b) => isInstallableBinding(b));
  if (installable.length === 0) {
    return want === "cursor";
  }
  return installable.some((b) => sanitizePlatformId(b.id) === want);
}

/**
 * Whether init/locale-set should wire skills/hooks for `hostId`.
 * Unlike {@link configWantsInstallableHost}, does **not** fall back to Cursor
 * when the installable list is empty — wrong-surface / empty lists stay false.
 */
export function platformsWantInstallableHost(
  platforms: readonly PlatformBinding[],
  hostId: string,
): boolean {
  const want = sanitizePlatformId(hostId);
  return platforms.some(
    (b) => sanitizePlatformId(b.id) === want && isInstallableBinding(b),
  );
}

/**
 * Effective primary host: first installable binding in list order, else first
 * entry, else Cursor IDE. Used for status/upgrade hints — not written back as
 * top-level `platform`/`surface` scalars.
 */
export function primaryBinding(
  platforms: readonly PlatformBinding[],
): PlatformBinding {
  const installable = platforms.find((b) => isInstallableBinding(b));
  if (installable) return installable;
  if (platforms[0]) return platforms[0];
  return { id: "cursor", surface: "ide" };
}

/** True when config.yml still has deprecated top-level `platform` / `surface`. */
export function configYamlHasLegacyHostScalars(yaml: string): boolean {
  try {
    const doc = parseDocument(yaml);
    if (doc.errors.length > 0) return false;
    if (doc.contents != null && isAlias(doc.contents)) return false;
    if (doc.contents != null && !isMap(doc.contents)) return false;
    return doc.has("platform") || doc.has("surface");
  } catch {
    return false;
  }
}

/** Human label for init multiselect (English; init UX language). */
export function formatBindingOptionLabel(b: PlatformBinding): string {
  const id = sanitizePlatformId(b.id);
  const surface = sanitizeSurfaceId(b.surface);
  if (id === "claude-code") {
    // surface: cli means official hooks shared across terminal + IDE — not CLI-only.
    return "Claude Code (hooks shared: terminal + IDE)";
  }
  if (id === "codex") {
    return "Codex (CLI hooks.json)";
  }
  if (id === "kimi-code") {
    return "Kimi Code (user-home config.toml hooks)";
  }
  if (id === "copilot-cli") {
    return "GitHub Copilot CLI (.github/hooks)";
  }
  if (id === "grok-build") {
    return "Grok Build CLI (.grok/hooks)";
  }
  if (id === "gemini-cli") {
    return "Gemini CLI (.gemini/settings.json + .gemini/skills)";
  }
  if (id === "factory-droid") {
    return "Factory Droid (.factory/hooks.json + .factory/skills)";
  }
  if (id === "hermes-agent") {
    return "Hermes Agent ($HERMES_HOME/config.yaml + $HERMES_HOME/skills)";
  }
  if (id === "antigravity") {
    return "Antigravity (.agents/hooks.json + .agents/skills)";
  }
  if (id === "pi") {
    return "Pi (.pi/extensions Autopilot; in-process; not shell hooks)";
  }
  if (id === "runner") {
    return "Runner (external loop; no hooks.json)";
  }
  const host =
    id === "cursor"
      ? "Cursor"
      : id
          .split(/[-_]/)
          .filter(Boolean)
          .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
          .join(" ") || "Host";
  if (surface === "ide") return `${host} (IDE hooks)`;
  if (surface === "cli") return `${host} (CLI hooks)`;
  if (surface === "runner") return `${host} (process runner)`;
  return `${host} (${surface})`;
}

/**
 * Dedupe by id+surface; preserve existing order, then append new additions.
 * Never drops an existing binding to make room — callers that must land every
 * addition (e.g. `--add-platform`) should fail closed via
 * {@link mergedIncludesAllRequested} when the list is already at capacity.
 */
export function mergePlatformBindings(
  existing: readonly PlatformBinding[],
  additions: readonly PlatformBinding[],
): PlatformBinding[] {
  const out: PlatformBinding[] = [];
  const seen = new Set<string>();
  for (const raw of existing) {
    if (out.length >= MAX_PLATFORM_BINDINGS) break;
    const b = normalizeBinding(raw.id, raw.surface);
    if (!b) continue;
    const key = bindingKey(b);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
  }
  for (const raw of additions) {
    if (out.length >= MAX_PLATFORM_BINDINGS) break;
    const b = normalizeBinding(raw.id, raw.surface);
    if (!b) continue;
    const key = bindingKey(b);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
  }
  return out;
}

/**
 * Parse `platforms` from a config object, or fall back to legacy
 * `platform` + `surface` scalars.
 *
 * When `failOnOverflow` is set, more than {@link MAX_PLATFORM_BINDINGS} unique
 * entries is an error (merge/write paths). Best-effort readers omit the flag
 * and receive a capped list for display.
 */
export function parsePlatformBindingsFromConfig(
  parsed: Record<string, unknown>,
  opts?: { failOnOverflow?: boolean },
): PlatformBinding[] {
  const { bindings: fromList, overflow } = parsePlatformsField(
    parsed.platforms,
  );
  if (overflow && opts?.failOnOverflow) {
    throw new Error(
      `platforms list exceeds cap of ${MAX_PLATFORM_BINDINGS} unique entries; trim config.yml and retry`,
    );
  }
  if (fromList.length > 0) return fromList;

  const legacyId =
    typeof parsed.platform === "string" ? parsed.platform : "cursor";
  const legacySurface =
    typeof parsed.surface === "string" ? parsed.surface : undefined;
  const b = normalizeBinding(legacyId, legacySurface);
  return b ? [b] : [{ id: "cursor", surface: "ide" }];
}

function parsePlatformsField(raw: unknown): {
  bindings: PlatformBinding[];
  overflow: boolean;
} {
  if (!Array.isArray(raw)) return { bindings: [], overflow: false };
  const out: PlatformBinding[] = [];
  const seen = new Set<string>();
  let overflow = false;
  for (const entry of raw) {
    let b: PlatformBinding | null = null;
    if (typeof entry === "string") {
      b = normalizeBinding(entry);
    } else if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const obj = entry as Record<string, unknown>;
      const id =
        typeof obj.id === "string"
          ? obj.id
          : typeof obj.platform === "string"
            ? obj.platform
            : "";
      const surface =
        typeof obj.surface === "string" ? obj.surface : undefined;
      b = normalizeBinding(id, surface);
    }
    if (!b) continue;
    const key = bindingKey(b);
    if (seen.has(key)) continue;
    if (out.length >= MAX_PLATFORM_BINDINGS) {
      // Another unique binding past the cap — do not silently drop on write.
      overflow = true;
      break;
    }
    seen.add(key);
    out.push(b);
  }
  return { bindings: out, overflow };
}

/** Comma-separated CLI ids → bindings (each gets its default surface). */
export function parsePlatformsCliList(
  raw: string,
  surfaceOverride?: string,
): PlatformBinding[] {
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const out: PlatformBinding[] = [];
  const seen = new Set<string>();
  const single = parts.length === 1;
  for (const part of parts) {
    const b = normalizeBinding(
      part,
      single && surfaceOverride ? surfaceOverride : undefined,
    );
    if (!b) continue;
    const key = bindingKey(b);
    if (seen.has(key)) continue;
    if (out.length >= MAX_PLATFORM_BINDINGS) {
      throw new Error(
        `platforms list exceeds cap of ${MAX_PLATFORM_BINDINGS} unique entries; trim --platforms and retry`,
      );
    }
    seen.add(key);
    out.push(b);
  }
  return out;
}

export function assertInstallablePlatforms(
  platforms: readonly PlatformBinding[],
): string | null {
  if (platforms.length === 0) {
    return "At least one platform is required.";
  }
  for (const b of platforms) {
    if (!isInstallableBinding(b)) {
      const supported = INSTALLABLE_BINDINGS.map(
        (x) => `${x.id}/${x.surface}`,
      ).join(", ");
      return `Unsupported platform "${b.id}" (surface: ${b.surface}). Supported: ${supported}.`;
    }
  }
  return null;
}

/** True when every normalized requested binding appears in `merged`. */
export function mergedIncludesAllRequested(
  merged: readonly PlatformBinding[],
  requested: readonly PlatformBinding[],
): boolean {
  const keys = new Set(merged.map((b) => bindingKey(b)));
  for (const raw of requested) {
    const b = normalizeBinding(raw.id, raw.surface);
    if (!b) continue;
    if (!keys.has(bindingKey(b))) return false;
  }
  return true;
}

/**
 * Rewrite `platforms` in config.yml via the YAML AST so unrelated keys/comments
 * are preserved when possible. Also removes deprecated top-level `platform` /
 * `surface` scalars (primary is list order / first installable).
 */
export function applyPlatformsToConfigYaml(
  existingYaml: string,
  platforms: readonly PlatformBinding[],
): string {
  const list = mergePlatformBindings([], platforms);
  if (list.length === 0) {
    throw new Error("platforms list must not be empty");
  }
  // Refuse silent truncation when the caller passed more unique bindings than
  // the cap (mirrors readConfigPlatformsOrThrow failOnOverflow).
  if (!mergedIncludesAllRequested(list, platforms)) {
    throw new Error(
      `platforms list exceeds cap of ${MAX_PLATFORM_BINDINGS} unique entries; trim the list and retry`,
    );
  }
  const doc = parseDocument(existingYaml);
  if (doc.errors.length > 0) {
    throw doc.errors[0]!;
  }
  if (doc.contents != null && isAlias(doc.contents)) {
    throw new Error("config.yml root must be a mapping");
  }
  if (doc.contents != null && !isMap(doc.contents)) {
    throw new Error("config.yml root must be a mapping");
  }

  const platformsNode = list.map((b) => ({ id: b.id, surface: b.surface }));
  doc.set("platforms", platformsNode);
  doc.delete("platform");
  doc.delete("surface");

  return String(doc);
}

/**
 * Fill missing `runner.max_iterations` (and the `runner:` map) without
 * inventing a fake `command`. Used by add-platform when runner is enabled.
 */
export function ensureRunnerConfigKeys(existingYaml: string): {
  yaml: string;
  addedPaths: string[];
} {
  const doc = parseDocument(existingYaml);
  if (doc.errors.length > 0) {
    throw doc.errors[0]!;
  }
  if (doc.contents != null && isAlias(doc.contents)) {
    throw new Error("config.yml root must be a mapping");
  }
  if (doc.contents != null && !isMap(doc.contents)) {
    throw new Error("config.yml root must be a mapping");
  }
  const addedPaths: string[] = [];
  const raw = doc.toJS({ maxAliasCount: 64 });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("config.yml root must be a mapping");
  }
  const root = raw as Record<string, unknown>;
  const runner = root.runner;
  if (runner == null) {
    doc.set("runner", { max_iterations: 32 });
    addedPaths.push("runner");
    return { yaml: String(doc), addedPaths };
  }
  if (typeof runner !== "object" || Array.isArray(runner)) {
    return { yaml: existingYaml, addedPaths };
  }
  const runnerObj = runner as Record<string, unknown>;
  const hasSnake = Object.prototype.hasOwnProperty.call(
    runnerObj,
    "max_iterations",
  );
  const hasCamel = Object.prototype.hasOwnProperty.call(
    runnerObj,
    "maxIterations",
  );
  const snakeVal = runnerObj.max_iterations;
  const camelVal = runnerObj.maxIterations;
  const snakeMissing = !hasSnake || snakeVal === undefined || snakeVal === null;
  const camelMissing = !hasCamel || camelVal === undefined || camelVal === null;
  // Either key counts as configured — do not invent max_iterations:32 over a
  // camelCase-only value (normalize prefers max_iterations ?? maxIterations).
  if (snakeMissing && camelMissing) {
    const node = doc.get("runner");
    if (isMap(node)) {
      node.set("max_iterations", 32);
      addedPaths.push("runner.max_iterations");
    }
  }
  return { yaml: String(doc), addedPaths };
}

/**
 * Remove `runner:` and drop runner bindings from `platforms` when other hosts
 * remain. Runner-only configs keep the platforms entry so empty-list does not
 * falsely fall back to Cursor via {@link configWantsInstallableHost}.
 */
export function stripRunnerConfigTraces(existingYaml: string): {
  yaml: string;
  removedRunnerKey: boolean;
  removedFromPlatforms: boolean;
} {
  const doc = parseDocument(existingYaml);
  if (doc.errors.length > 0) {
    throw doc.errors[0]!;
  }
  if (doc.contents != null && isAlias(doc.contents)) {
    throw new Error("config.yml root must be a mapping");
  }
  if (doc.contents != null && !isMap(doc.contents)) {
    throw new Error("config.yml root must be a mapping");
  }

  let removedRunnerKey = false;
  if (doc.has("runner")) {
    doc.delete("runner");
    removedRunnerKey = true;
  }

  let removedFromPlatforms = false;
  try {
    // Fail closed on over-cap lists — never rewrite a truncated platforms[] and
    // drop hosts the best-effort reader would silently omit.
    const platforms = parsePlatformBindingsFromConfig(
      (doc.toJS({ maxAliasCount: 64 }) ?? {}) as Record<string, unknown>,
      { failOnOverflow: true },
    );
    const withoutRunner = platforms.filter(
      (b) => sanitizePlatformId(b.id) !== "runner",
    );
    if (withoutRunner.length > 0 && withoutRunner.length < platforms.length) {
      doc.set(
        "platforms",
        withoutRunner.map((b) => ({ id: b.id, surface: b.surface })),
      );
      removedFromPlatforms = true;
    }
  } catch (err) {
    // Only soften over-cap: still ship runner: removal, leave platforms untouched.
    // Other parse/toJS failures must fail closed (do not pretend strip succeeded).
    const msg = err instanceof Error ? err.message : String(err);
    // Match only platforms overflow copy from parsePlatformBindingsFromConfig —
    // do not soften unrelated "exceeds" errors (e.g. YAML alias caps).
    if (
      removedRunnerKey &&
      /platforms list exceeds cap of \d+ unique entries/i.test(msg)
    ) {
      return {
        yaml: String(doc),
        removedRunnerKey: true,
        removedFromPlatforms: false,
      };
    }
    throw err;
  }

  return {
    yaml: String(doc),
    removedRunnerKey,
    removedFromPlatforms,
  };
}

/** True when any installable hook host (ide/cli surface) is enabled. */
export function hasInstallableHookHost(
  platforms: readonly PlatformBinding[],
): boolean {
  return platforms.some(
    (b) =>
      isInstallableBinding(b) && sanitizePlatformId(b.id) !== "runner",
  );
}

/** Stable display token for status/doctor (comma-separated id(surface)). */
export function formatPlatformsDisplay(
  platforms: readonly PlatformBinding[],
): string {
  if (platforms.length === 0) return "?";
  return platforms
    .map((b) => {
      const id = sanitizePlatformId(b.id) || "?";
      const surface = sanitizeSurfaceId(b.surface) || "?";
      return `${id}(${surface})`;
    })
    .join(", ");
}
