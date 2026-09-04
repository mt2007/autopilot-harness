import { describe, expect, it } from "vitest";
import {
  applyPlatformsToConfigYaml,
  assertInstallablePlatforms,
  configWantsInstallableHost,
  defaultSurfaceFor,
  formatBindingOptionLabel,
  formatPlatformsDisplay,
  MAX_PLATFORM_BINDINGS,
  mergePlatformBindings,
  mergedIncludesAllRequested,
  normalizeBinding,
  parsePlatformBindingsFromConfig,
  parsePlatformsCliList,
  readConfigInstallHints,
} from "../src/index.js";
import { readConfigPlatformsOrThrow } from "../src/init/config-merge.js";

describe("platforms helpers", () => {
  it("normalizeBinding applies default surfaces", () => {
    expect(normalizeBinding("cursor")).toEqual({
      id: "cursor",
      surface: "ide",
    });
    expect(defaultSurfaceFor("claude-code")).toBe("cli");
    expect(defaultSurfaceFor("runner")).toBe("runner");
  });

  it("configWantsInstallableHost defaults empty installable list to Cursor", () => {
    expect(configWantsInstallableHost([], "cursor")).toBe(true);
    expect(configWantsInstallableHost([], "claude-code")).toBe(false);
    expect(
      configWantsInstallableHost(
        [{ id: "kimi-code", surface: "cli" }],
        "cursor",
      ),
    ).toBe(true);
    expect(
      configWantsInstallableHost(
        [{ id: "claude-code", surface: "cli" }],
        "cursor",
      ),
    ).toBe(false);
    expect(
      configWantsInstallableHost(
        [{ id: "claude-code", surface: "cli" }],
        "claude-code",
      ),
    ).toBe(true);
  });

  it("parsePlatformBindingsFromConfig prefers platforms[] over legacy", () => {
    expect(
      parsePlatformBindingsFromConfig({
        platforms: ["cursor", { id: "cursor", surface: "ide" }],
        platform: "ignored",
        surface: "cli",
      }),
    ).toEqual([{ id: "cursor", surface: "ide" }]);

    expect(
      parsePlatformBindingsFromConfig({
        platform: "cursor",
        surface: "ide",
      }),
    ).toEqual([{ id: "cursor", surface: "ide" }]);
  });

  it("parsePlatformsCliList + merge + display", () => {
    const list = parsePlatformsCliList("cursor");
    expect(list).toEqual([{ id: "cursor", surface: "ide" }]);
    expect(mergePlatformBindings(list, list)).toEqual(list);
    expect(formatPlatformsDisplay(list)).toBe("cursor(ide)");
    expect(assertInstallablePlatforms(list)).toBeNull();
    expect(
      assertInstallablePlatforms([{ id: "claude-code", surface: "cli" }]),
    ).toBeNull();
    expect(
      assertInstallablePlatforms([{ id: "claude-code", surface: "ide" }]),
    ).toMatch(/Unsupported platform/);
    expect(formatBindingOptionLabel({ id: "claude-code", surface: "cli" })).toMatch(
      /hooks shared: terminal \+ IDE/,
    );
  });

  it("caps platforms list length and does not drop existing for new adds", () => {
    const many = Array.from({ length: MAX_PLATFORM_BINDINGS }, (_, i) => ({
      id: `host${i}`,
      surface: "ide",
    }));
    expect(mergePlatformBindings([], many)).toHaveLength(MAX_PLATFORM_BINDINGS);
    expect(
      parsePlatformBindingsFromConfig({
        platforms: many.map((b) => b.id),
      }),
    ).toHaveLength(MAX_PLATFORM_BINDINGS);

    const requested = [{ id: "cursor", surface: "ide" }];
    const withAdd = mergePlatformBindings(many, requested);
    expect(withAdd).toHaveLength(MAX_PLATFORM_BINDINGS);
    // Full existing list is preserved; new id is omitted (fail closed upstream).
    expect(withAdd.map((b) => b.id)).toEqual(many.map((b) => b.id));
    expect(mergedIncludesAllRequested(withAdd, requested)).toBe(false);

    // Idempotent add of an already-present binding still succeeds.
    const already = [{ id: "host0", surface: "ide" }];
    expect(mergedIncludesAllRequested(withAdd, already)).toBe(true);
  });

  it("readConfigInstallHints returns platforms", () => {
    const hints = readConfigInstallHints(
      "platforms:\n  - id: cursor\n    surface: ide\nlocale: en\n",
    );
    expect(hints.platforms).toEqual([{ id: "cursor", surface: "ide" }]);
    expect(hints.platform).toBe("cursor");
    expect(hints.surface).toBe("ide");
  });

  it("parsePlatformsCliList returns empty for junk-only input", () => {
    expect(parsePlatformsCliList("!!!")).toEqual([]);
    expect(parsePlatformsCliList(",,,")).toEqual([]);
  });

  it("parsePlatformsCliList refuses over-cap unique ids", () => {
    const many = Array.from(
      { length: MAX_PLATFORM_BINDINGS + 1 },
      (_, i) => `host${i}`,
    ).join(",");
    expect(() => parsePlatformsCliList(many)).toThrow(/exceeds cap/i);
  });

  it("readConfigInstallHints prefers first installable primary", () => {
    const hints = readConfigInstallHints(
      `platforms:
  - id: claude-code
    surface: cli
  - id: cursor
    surface: ide
locale: en
`,
    );
    expect(hints.platforms).toHaveLength(2);
    expect(hints.platform).toBe("claude-code");
    expect(hints.surface).toBe("cli");
  });

  it("readConfigPlatformsOrThrow fails closed on bad YAML", () => {
    expect(() => readConfigPlatformsOrThrow("platform: [unterminated")).toThrow();
    expect(
      readConfigPlatformsOrThrow(
        "platforms:\n  - id: cursor\n    surface: ide\n",
      ),
    ).toEqual([{ id: "cursor", surface: "ide" }]);
  });

  it("readConfigPlatformsOrThrow fails closed when unique platforms exceed cap", () => {
    const many = Array.from({ length: MAX_PLATFORM_BINDINGS + 1 }, (_, i) => ({
      id: `host${i}`,
      surface: "ide",
    }));
    // Best-effort parse still returns a capped list for status/hints.
    expect(
      parsePlatformBindingsFromConfig({ platforms: many.map((b) => b.id) }),
    ).toHaveLength(MAX_PLATFORM_BINDINGS);
    const yaml = [
      "platforms:",
      ...many.flatMap((b) => [`  - id: ${b.id}`, `    surface: ${b.surface}`]),
      "locale: en",
      "",
    ].join("\n");
    expect(() => readConfigPlatformsOrThrow(yaml)).toThrow(/exceeds cap/i);
  });

  it("applyPlatformsToConfigYaml keeps keys and prefers first installable primary", () => {
    const next = applyPlatformsToConfigYaml(
      "platform: cursor\nsurface: ide\nlocale: zh-CN\n# keep\n",
      [
        { id: "claude-code", surface: "cli" },
        { id: "cursor", surface: "ide" },
      ],
    );
    expect(next).toMatch(/platforms:/);
    expect(next).toMatch(/claude-code/);
    expect(next).toMatch(/id:\s*cursor/);
    expect(next).toMatch(/locale:\s*zh-CN/);
    // First installable binding becomes legacy primary scalars.
    expect(next).toMatch(/platform:\s*claude-code/);
    expect(next).toMatch(/surface:\s*cli/);
  });

  it("applyPlatformsToConfigYaml refuses over-cap input without truncating", () => {
    const many = Array.from({ length: MAX_PLATFORM_BINDINGS + 1 }, (_, i) => ({
      id: `host${i}`,
      surface: "ide",
    }));
    expect(() =>
      applyPlatformsToConfigYaml("locale: en\n", many),
    ).toThrow(/exceeds cap/i);
  });
});
