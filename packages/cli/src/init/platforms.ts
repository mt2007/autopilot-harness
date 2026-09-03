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
]);

/** Hard cap so hostile/hand-edited config cannot inflate status/merge work. */
export const MAX_PLATFORM_BINDINGS = 32;

const DEFAULT_SURFACE_BY_ID: Readonly<Record<string, string>> = Object.freeze({
  cursor: "ide",
  "claude-code": "cli",
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
 * Legacy `platform`/`surface` primary: prefer an installable binding so older
 * readers are not pointed at a declared-but-unwired future host.
 */
export function primaryBinding(
  platforms: readonly PlatformBinding[],
): PlatformBinding {
  const installable = platforms.find((b) => isInstallableBinding(b));
  if (installable) return installable;
  if (platforms[0]) return platforms[0];
  return { id: "cursor", surface: "ide" };
}

/** Human label for init multiselect (English; init UX language). */
export function formatBindingOptionLabel(b: PlatformBinding): string {
  const id = sanitizePlatformId(b.id);
  const surface = sanitizeSurfaceId(b.surface);
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
 * Rewrite `platforms` (+ legacy `platform`/`surface` primary) in config.yml
 * via the YAML AST so unrelated keys/comments are preserved when possible.
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

  // Legacy scalars should point at an installable host when one exists, so
  // older readers do not treat a declared-but-unwired future host as primary.
  const primary = primaryBinding(list);
  const platformsNode = list.map((b) => ({ id: b.id, surface: b.surface }));
  doc.set("platforms", platformsNode);
  doc.set("platform", primary.id);
  doc.set("surface", primary.surface);

  return String(doc);
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
