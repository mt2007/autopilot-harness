import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { installInitYes } from "../src/init/install.js";
import {
  mergeConfigYamlMissingKeys,
  mergeMissingKeys,
} from "../src/init/config-merge.js";
import { upgradeProject } from "../src/upgrade.js";
import { StateStore, getLatestSchemaVersion } from "@autopilot-harness/core";

const require = createRequire(import.meta.url);

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-upgrade-"));
}

describe("config missing-key merge", () => {
  it("adds only absent keys and keeps user values", () => {
    const { merged, addedPaths } = mergeMissingKeys(
      {
        platform: "cursor",
        review: { confirm_rounds: 3 },
      },
      {
        platform: "cursor",
        locale: "en",
        review: { confirm_rounds: 5, verify: { enabled: false } },
      },
    );
    expect(merged.platform).toBe("cursor");
    expect((merged.review as { confirm_rounds: number }).confirm_rounds).toBe(
      3,
    );
    expect(
      (merged.review as { verify: { enabled: boolean } }).verify.enabled,
    ).toBe(false);
    expect(merged.locale).toBe("en");
    expect(addedPaths).toContain("locale");
    expect(addedPaths).toContain("review.verify");
    expect(addedPaths).not.toContain("review.confirm_rounds");
  });

  it("appends session.stale_after_hours when missing from older configs", () => {
    const { yaml, addedPaths } = mergeConfigYamlMissingKeys(
      "platform: cursor\nlocale: en\n",
      "platform: cursor\nlocale: en\nsession:\n  stale_after_hours: 72\n",
    );
    expect(addedPaths).toContain("session");
    expect(yaml).toMatch(/stale_after_hours:\s*72/);
  });

  it("round-trips yaml text", () => {
    const { yaml, addedPaths } = mergeConfigYamlMissingKeys(
      "platform: cursor\nlocale: zh-CN\n",
      "platform: cursor\nlocale: en\nreview:\n  confirm_rounds: 5\n",
    );
    expect(addedPaths).toContain("review");
    expect(yaml).toMatch(/locale:\s*zh-CN/);
    expect(yaml).toMatch(/confirm_rounds:\s*5/);
  });

  it("rejects non-mapping config root", () => {
    expect(() =>
      mergeConfigYamlMissingKeys("- just\n- a list\n", "platform: cursor\n"),
    ).toThrow(/mapping/i);
  });

  it("rejects circular YAML aliases instead of hanging", () => {
    // Cycle under a key that defaults also deep-merge into.
    const cyclic = `
locale: en
review: &r
  confirm_rounds: 3
  verify: *r
`;
    expect(() =>
      mergeConfigYamlMissingKeys(
        cyclic,
        "platform: cursor\nlocale: en\nreview:\n  confirm_rounds: 5\n  verify:\n    enabled: false\n",
      ),
    ).toThrow(/circular/i);
  });

  it("allows shared (non-cyclic) YAML anchors", () => {
    const shared = `
locale: en
review:
  stuck: &s
    max_idle_stops: 5
  also: *s
`;
    const { yaml, addedPaths } = mergeConfigYamlMissingKeys(
      shared,
      "platform: cursor\nlocale: en\nreview:\n  confirm_rounds: 5\n  stuck:\n    max_idle_stops: 5\n  also:\n    max_idle_stops: 5\n",
    );
    expect(addedPaths).toContain("platform");
    expect(addedPaths).toContain("review.confirm_rounds");
    expect(yaml).toMatch(/max_idle_stops:\s*5/);
  });

  it("treats null as missing and fills default", () => {
    const { merged, addedPaths } = mergeMissingKeys(
      { locale: null, review: { confirm_rounds: null } },
      { locale: "en", review: { confirm_rounds: 5, verify: { enabled: false } } },
    );
    expect(merged.locale).toBe("en");
    expect(
      (merged.review as { confirm_rounds: number }).confirm_rounds,
    ).toBe(5);
    expect(addedPaths).toContain("locale");
    expect(addedPaths).toContain("review.confirm_rounds");
    expect(addedPaths).toContain("review.verify");
  });

  it("ignores prototype-pollution keys from existing/defaults", () => {
    // JSON/YAML-style own properties (not object-literal __proto__ setter)
    const existing = JSON.parse(
      '{"platform":"cursor","__proto__":{"polluted":true}}',
    ) as Record<string, unknown>;
    const defaults = JSON.parse(
      '{"locale":"en","constructor":{"evil":true}}',
    ) as Record<string, unknown>;
    const { merged, addedPaths } = mergeMissingKeys(existing, defaults);
    expect(merged.platform).toBe("cursor");
    expect(merged.locale).toBe("en");
    expect(Object.prototype.hasOwnProperty.call(merged, "__proto__")).toBe(
      false,
    );
    expect(Object.prototype.hasOwnProperty.call(merged, "constructor")).toBe(
      false,
    );
    expect(addedPaths).toEqual(["locale"]);
    expect(
      Object.prototype.hasOwnProperty.call(Object.prototype, "polluted"),
    ).toBe(false);
  });
});

describe("upgradeProject", () => {
  let root: string;
  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects empty projectRoot (does not resolve to cwd)", () => {
    const r = upgradeProject({ projectRoot: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/projectRoot must be a non-empty string/);
  });

  it("fails when project is not initialized", () => {
    root = tmpProject();
    const r = upgradeProject({ projectRoot: root });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not initialized/i);
  });

  it("does not overwrite existing review.scope", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
        reviewScope: "executing_only",
      }).ok,
    ).toBe(true);
    const configPath = path.join(root, ".autopilot", "config.yml");
    expect(fs.readFileSync(configPath, "utf8")).toMatch(/scope:\s*executing_only/);

    const r = upgradeProject({ projectRoot: root, packageVersion: "0.1.0" });
    expect(r.ok).toBe(true);
    const after = fs.readFileSync(configPath, "utf8");
    expect(after).toMatch(/scope:\s*executing_only/);
    expect(after).not.toMatch(/scope:\s*project/);
  });

  it("fill-missing review.scope stays executing_only (runtime default), not project", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const configPath = path.join(root, ".autopilot", "config.yml");
    // Legacy-ish: review present but no scope key (runtime defaulted to executing_only).
    fs.writeFileSync(
      configPath,
      `platforms:
  - id: cursor
    surface: ide
locale: en
review:
  confirm_rounds: 5
`,
      "utf8",
    );
    const r = upgradeProject({ projectRoot: root, packageVersion: "0.1.0" });
    expect(r.ok).toBe(true);
    const after = fs.readFileSync(configPath, "utf8");
    expect(after).toMatch(/scope:\s*executing_only/);
    expect(after).not.toMatch(/scope:\s*project/);
  });

  it("dry-run lists actions without writing pin bump side effects twice", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const pinBefore = fs.readFileSync(
      path.join(root, ".autopilot", "pin.json"),
      "utf8",
    );
    const r = upgradeProject({ projectRoot: root, dryRun: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dryRun).toBe(true);
    expect(r.actions.some((a) => /pin\.json/.test(a))).toBe(true);
    expect(r.written).toEqual([]);
    expect(fs.readFileSync(path.join(root, ".autopilot", "pin.json"), "utf8")).toBe(
      pinBefore,
    );
  });

  it("appends missing config keys, refreshes hook, preserves user locale", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const configPath = path.join(root, ".autopilot", "config.yml");
    // Strip review.verify to simulate older config; keep custom locale
    fs.writeFileSync(
      configPath,
      `platform: cursor
surface: ide
locale: zh-CN
review:
  confirm_rounds: 3
`,
      "utf8",
    );

    const r = upgradeProject({ projectRoot: root, packageVersion: "0.1.0" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dryRun).toBe(false);
    const config = fs.readFileSync(configPath, "utf8");
    expect(config).toMatch(/locale:\s*zh-CN/);
    expect(config).toMatch(/confirm_rounds:\s*3/);
    expect(config).toMatch(/enabled:\s*false/);
    expect(config).toMatch(/platforms:/);
    expect(config).not.toMatch(/^platform:\s*/m);
    expect(config).not.toMatch(/^surface:\s*/m);
    expect(
      r.actions.some((a) => /remove legacy platform\/surface/.test(a)),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(root, ".autopilot", "bin", "autopilot-harness-hook.mjs"),
      ),
    ).toBe(true);
    expect(
      JSON.parse(
        fs.readFileSync(path.join(root, ".autopilot", "pin.json"), "utf8"),
      )["autopilot-harness"],
    ).toBe("0.1.0");
    expect(r.doctorLines.some((l) => l.startsWith("OK"))).toBe(true);
    expect(r.doctorOk).toBe(true);
    expect(r.platform).toBe("cursor");
  });

  it("strips leftover platform/surface when config already has all known keys", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [
          { id: "cursor", surface: "ide" },
          { id: "claude-code", surface: "cli" },
        ],
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const configPath = path.join(root, ".autopilot", "config.yml");
    const modern = fs.readFileSync(configPath, "utf8");
    expect(modern).toMatch(/platforms:/);
    expect(modern).toMatch(/claude-code/);
    expect(modern).not.toMatch(/^platform:\s*/m);
    fs.writeFileSync(
      configPath,
      `platform: cursor\nsurface: ide\n${modern}`,
      "utf8",
    );

    const r = upgradeProject({ projectRoot: root, packageVersion: "0.1.1" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(
      r.actions.some((a) => /config\.yml already has all known keys/.test(a)),
    ).toBe(true);
    expect(
      r.actions.some((a) => /remove legacy platform\/surface/.test(a)),
    ).toBe(true);
    const config = fs.readFileSync(configPath, "utf8");
    expect(config).toMatch(/platforms:/);
    expect(config).toMatch(/id:\s*cursor/);
    expect(config).toMatch(/claude-code/);
    expect(config).toMatch(/locale:\s*en/);
    expect(config).not.toMatch(/^platform:\s*/m);
    expect(config).not.toMatch(/^surface:\s*/m);
  });

  it("backs up and migrates existing state.db", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "planning",
    });
    expect(store.getSchemaVersion()).toBe(getLatestSchemaVersion());
    store.close();

    const r = upgradeProject({ projectRoot: root });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const baks = fs
      .readdirSync(path.join(root, ".autopilot"))
      .filter((f) => f.startsWith("state.db.bak."));
    expect(baks.length).toBe(1);
    // Snapshot must be a self-contained DB; open read-only (do not mutate bak).
    const { DatabaseSync } = require("node:sqlite") as {
      DatabaseSync: new (
        path: string,
        options?: { readOnly?: boolean },
      ) => {
        prepare(sql: string): {
          get(...params: unknown[]): { phase?: string } | undefined;
        };
        close(): void;
      };
    };
    const bakDb = new DatabaseSync(
      path.join(root, ".autopilot", baks[0]!),
      { readOnly: true },
    );
    try {
      const row = bakDb
        .prepare("SELECT phase FROM sessions WHERE conversation_id = ?")
        .get("c1");
      expect(row?.phase).toBe("planning");
    } finally {
      bakDb.close();
    }
    const again = new StateStore(root);
    expect(again.getSession("c1")?.phase).toBe("planning");
    again.close();
  });

  it("fails closed on corrupt config.yml", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    fs.writeFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "platform: [broken\n",
    );
    const r = upgradeProject({ projectRoot: root });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });

  it("fails closed when config.yml is a symlink", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const configPath = path.join(root, ".autopilot", "config.yml");
    const outside = path.join(root, "outside-config.yml");
    const before = fs.readFileSync(configPath, "utf8");
    fs.renameSync(configPath, outside);
    fs.symlinkSync(outside, configPath);
    const r = upgradeProject({ projectRoot: root });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/symlink/i);
    expect(fs.readFileSync(outside, "utf8")).toBe(before);
  });

  it("fails closed when config.yml is a dangling symlink (not treated as missing)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const configPath = path.join(root, ".autopilot", "config.yml");
    fs.rmSync(configPath, { force: true });
    fs.symlinkSync(path.join(root, "missing-config.yml"), configPath);
    const r = upgradeProject({ projectRoot: root });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/symlink/i);
      expect(r.error).not.toMatch(/not initialized/i);
    }
  });

  it("fails closed when state.db is a dangling symlink (not treated as missing)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const dbPath = path.join(root, ".autopilot", "state.db");
    fs.writeFileSync(dbPath, "");
    fs.rmSync(dbPath, { force: true });
    fs.symlinkSync(path.join(root, "missing.db"), dbPath);
    const r = upgradeProject({ projectRoot: root });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/state\.db.*symlink|symlink/i);
      expect(r.error).not.toMatch(/no state\.db yet/i);
    }
    const bak = fs
      .readdirSync(path.join(root, ".autopilot"))
      .filter((n) => n.startsWith("state.db.bak."));
    expect(bak).toEqual([]);
  });

  it("fails closed when state.db is a pointing symlink", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: "c-symlink-db",
      project_root: root,
      code_root: root,
      phase: "planning",
    });
    store.close();
    const dbPath = path.join(root, ".autopilot", "state.db");
    const outside = path.join(root, "outside.db");
    const before = fs.readFileSync(dbPath);
    fs.renameSync(dbPath, outside);
    fs.symlinkSync(outside, dbPath);
    const r = upgradeProject({ projectRoot: root });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/state\.db.*symlink|symlink/i);
    expect(fs.readFileSync(outside)).toEqual(before);
    const bak = fs
      .readdirSync(path.join(root, ".autopilot"))
      .filter((n) => n.startsWith("state.db.bak."));
    expect(bak).toEqual([]);
  });

  it("fails closed before backup when hooks.json is a dangling symlink", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: "c-dang",
      project_root: root,
      code_root: root,
      phase: "planning",
    });
    store.close();

    const hooksPath = path.join(root, ".cursor", "hooks.json");
    fs.rmSync(hooksPath, { force: true });
    fs.symlinkSync(path.join(root, "missing-hooks.json"), hooksPath);

    const beforeDb = fs.readFileSync(
      path.join(root, ".autopilot", "state.db"),
    );
    const r = upgradeProject({ projectRoot: root });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/symlink|Cannot read/i);
    // No state.db.bak.* — preflight must fail before backup/migrate.
    const bak = fs
      .readdirSync(path.join(root, ".autopilot"))
      .filter((n) => n.startsWith("state.db.bak."));
    expect(bak).toEqual([]);
    expect(fs.readFileSync(path.join(root, ".autopilot", "state.db"))).toEqual(
      beforeDb,
    );
  });

  it("does not mutate config/db backup when hooks fail closed", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: "c-preflight",
      project_root: root,
      code_root: root,
      phase: "planning",
    });
    store.close();

    const configPath = path.join(root, ".autopilot", "config.yml");
    const stripped = `platform: cursor
surface: ide
locale: en
review:
  confirm_rounds: 3
`;
    fs.writeFileSync(configPath, stripped, "utf8");
    fs.writeFileSync(
      path.join(root, ".cursor", "hooks.json"),
      "{not-json",
      "utf8",
    );

    const r = upgradeProject({ projectRoot: root });
    expect(r.ok).toBe(false);
    expect(fs.readFileSync(configPath, "utf8")).toBe(stripped);
    const baks = fs
      .readdirSync(path.join(root, ".autopilot"))
      .filter((f) => f.includes(".bak."));
    expect(baks).toEqual([]);
  });

  it("dry-run fails closed when hooks.json is corrupt", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    fs.writeFileSync(
      path.join(root, ".cursor", "hooks.json"),
      "{not-json",
      "utf8",
    );
    const r = upgradeProject({ projectRoot: root, dryRun: true });
    expect(r.ok).toBe(false);
  });

  it("dry-run fails closed when Claude settings.json is corrupt", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "claude-code",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    fs.writeFileSync(
      path.join(root, ".claude", "settings.json"),
      "{not-json",
      "utf8",
    );
    const r = upgradeProject({ projectRoot: root, dryRun: true });
    expect(r.ok).toBe(false);
  });

  it("fails closed before backup when Claude settings.json is a dangling symlink", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "claude-code",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: "c-claude-dang",
      project_root: root,
      code_root: root,
      phase: "planning",
    });
    store.close();

    const settingsPath = path.join(root, ".claude", "settings.json");
    fs.rmSync(settingsPath, { force: true });
    fs.symlinkSync(path.join(root, "missing-settings.json"), settingsPath);

    const beforeDb = fs.readFileSync(
      path.join(root, ".autopilot", "state.db"),
    );
    const r = upgradeProject({ projectRoot: root });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/symlink|Cannot read/i);
    const bak = fs
      .readdirSync(path.join(root, ".autopilot"))
      .filter((n) => n.startsWith("state.db.bak."));
    expect(bak).toEqual([]);
    expect(fs.readFileSync(path.join(root, ".autopilot", "state.db"))).toEqual(
      beforeDb,
    );
  });

  it("preserves user hooks and does not touch plans/<slug>", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const hooksPath = path.join(root, ".cursor", "hooks.json");
    const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      hooks: Record<string, Array<{ command: string }>>;
    };
    hooks.hooks.beforeSubmitPrompt = hooks.hooks.beforeSubmitPrompt ?? [];
    hooks.hooks.beforeSubmitPrompt.unshift({ command: "echo user-hook" });
    fs.writeFileSync(hooksPath, JSON.stringify(hooks, null, 2) + "\n", "utf8");

    const planFile = path.join(root, "plans", "demo", "plan.md");
    fs.mkdirSync(path.dirname(planFile), { recursive: true });
    fs.writeFileSync(planFile, "# keep me\n", "utf8");

    const r = upgradeProject({ projectRoot: root, packageVersion: "0.1.0" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const afterHooks = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      hooks: Record<string, Array<{ command: string }>>;
    };
    expect(
      afterHooks.hooks.beforeSubmitPrompt?.some(
        (h) => h.command === "echo user-hook",
      ),
    ).toBe(true);
    expect(fs.readFileSync(planFile, "utf8")).toBe("# keep me\n");
  });

  it("dry-run lists Claude settings/skills actions when claude-code is enabled", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "claude-code",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const r = upgradeProject({ projectRoot: root, dryRun: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.actions.some((a) => /\.claude\/skills/i.test(a))).toBe(true);
    expect(r.actions.some((a) => /\.claude\/settings\.json/i.test(a))).toBe(
      true,
    );
    expect(r.actions.some((a) => /\.cursor\/hooks\.json/i.test(a))).toBe(false);
  });

  it("upgrade refreshes Claude BLOCK_CAP to 0", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "claude-code",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const settingsPath = path.join(root, ".claude", "settings.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
      env?: Record<string, string>;
    };
    settings.env = {
      ...(settings.env ?? {}),
      CLAUDE_CODE_STOP_HOOK_BLOCK_CAP: "8",
    };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");

    const r = upgradeProject({ projectRoot: root, packageVersion: "0.2.0" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
      env?: Record<string, string>;
    };
    expect(after.env?.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP).toBe("0");
  });

  it("Cursor-only upgrade ignores corrupt leftover .claude/settings.json", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const leftover = path.join(root, ".claude", "settings.json");
    fs.mkdirSync(path.dirname(leftover), { recursive: true });
    const corrupt = "{not-json";
    fs.writeFileSync(leftover, corrupt, "utf8");

    const dry = upgradeProject({ projectRoot: root, dryRun: true });
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;
    expect(dry.actions.some((a) => /\.claude\/settings\.json/i.test(a))).toBe(
      false,
    );

    const r = upgradeProject({ projectRoot: root, packageVersion: "0.2.0" });
    expect(r.ok).toBe(true);
    // Leftover must stay untouched (no merge/write-through on Cursor-only).
    expect(fs.readFileSync(leftover, "utf8")).toBe(corrupt);
  });

  it("dual-host dry-run lists Cursor and Claude host actions", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [
          { id: "cursor", surface: "ide" },
          { id: "claude-code", surface: "cli" },
        ],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const r = upgradeProject({ projectRoot: root, dryRun: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.actions.some((a) => /\.cursor\/hooks\.json/i.test(a))).toBe(true);
    expect(r.actions.some((a) => /\.claude\/settings\.json/i.test(a))).toBe(
      true,
    );
    expect(r.actions.some((a) => /\.claude\/skills/i.test(a))).toBe(true);
  });

  it("dry-run lists Codex hooks action when codex is enabled (no skills)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "codex",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const r = upgradeProject({ projectRoot: root, dryRun: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.actions.some((a) => /\.codex\/hooks\.json/i.test(a))).toBe(true);
    expect(r.actions.some((a) => /\.codex\/skills/i.test(a))).toBe(false);
    expect(r.actions.some((a) => /\.cursor\/hooks\.json/i.test(a))).toBe(false);
  });

  it("upgrade refreshes Codex hooks and restores --platform stamp", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "codex",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const hooksPath = path.join(root, ".codex", "hooks.json");
    const file = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      hooks: Record<string, Array<{ hooks?: Array<{ command?: string; timeout?: number }> }>>;
    };
    for (const groups of Object.values(file.hooks)) {
      for (const g of groups) {
        for (const h of g.hooks ?? []) {
          if (typeof h.command === "string") {
            h.command = h.command.replace(/ --platform codex/, "");
            h.timeout = 30;
          }
        }
      }
    }
    fs.writeFileSync(hooksPath, JSON.stringify(file, null, 2) + "\n");

    const r = upgradeProject({ projectRoot: root, packageVersion: "0.3.0" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = fs.readFileSync(hooksPath, "utf8");
    expect(after).toMatch(/--platform codex/);
    expect(after).not.toMatch(/"timeout"\s*:\s*30/);
  });

  it("Cursor-only upgrade ignores corrupt leftover .codex/hooks.json", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const leftover = path.join(root, ".codex", "hooks.json");
    fs.mkdirSync(path.dirname(leftover), { recursive: true });
    const corrupt = "{not-json";
    fs.writeFileSync(leftover, corrupt, "utf8");

    const dry = upgradeProject({ projectRoot: root, dryRun: true });
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;
    expect(dry.actions.some((a) => /\.codex\/hooks\.json/i.test(a))).toBe(
      false,
    );

    const r = upgradeProject({ projectRoot: root, packageVersion: "0.3.0" });
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(leftover, "utf8")).toBe(corrupt);
  });

  it("Codex-enabled upgrade fails closed on corrupt .codex/hooks.json", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "codex",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    fs.writeFileSync(
      path.join(root, ".codex", "hooks.json"),
      "{not-json",
      "utf8",
    );
    const dry = upgradeProject({ projectRoot: root, dryRun: true });
    expect(dry.ok).toBe(false);
    if (!dry.ok) expect(dry.error).toMatch(/\.codex\/hooks\.json|valid JSON/i);
    const r = upgradeProject({ projectRoot: root, packageVersion: "0.3.0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/\.codex\/hooks\.json|valid JSON/i);
  });

  it("Codex-enabled upgrade fails closed when .codex is a symlink", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "codex",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ah-up-codex-"));
    const hooks = fs.readFileSync(
      path.join(root, ".codex", "hooks.json"),
      "utf8",
    );
    fs.writeFileSync(path.join(outside, "hooks.json"), hooks);
    fs.rmSync(path.join(root, ".codex"), { recursive: true, force: true });
    fs.symlinkSync(outside, path.join(root, ".codex"));

    const dry = upgradeProject({ projectRoot: root, dryRun: true });
    expect(dry.ok).toBe(false);
    if (!dry.ok) expect(dry.error).toMatch(/\.codex/i);
    const r = upgradeProject({ projectRoot: root, packageVersion: "0.3.0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/\.codex/i);
    expect(
      JSON.stringify(
        JSON.parse(fs.readFileSync(path.join(outside, "hooks.json"), "utf8")),
      ),
    ).toMatch(/autopilot-harness-hook\.mjs/);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("dry-run lists Kimi config.toml action when kimi-code is enabled (no skills)", () => {
    root = tmpProject();
    const kimiHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-kimi-up-dry-"));
    const prev = process.env.KIMI_CODE_HOME;
    process.env.KIMI_CODE_HOME = kimiHome;
    try {
      expect(
        installInitYes({
          projectRoot: root,
          platform: "kimi-code",
          surface: "cli",
          locale: "en",
          force: false,
        }).ok,
      ).toBe(true);
      const r = upgradeProject({ projectRoot: root, dryRun: true });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(
        r.actions.some((a) => /KIMI_CODE_HOME\/config\.toml/i.test(a)),
      ).toBe(true);
      expect(r.actions.some((a) => /\.codex\/skills/i.test(a))).toBe(false);
      expect(r.actions.some((a) => /\.cursor\/skills/i.test(a))).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.KIMI_CODE_HOME;
      else process.env.KIMI_CODE_HOME = prev;
      fs.rmSync(kimiHome, { recursive: true, force: true });
    }
  });

  it("upgrade refreshes Kimi hooks and restores timeout ≥120", () => {
    root = tmpProject();
    const kimiHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-kimi-up-fix-"));
    const prev = process.env.KIMI_CODE_HOME;
    process.env.KIMI_CODE_HOME = kimiHome;
    try {
      expect(
        installInitYes({
          projectRoot: root,
          platform: "kimi-code",
          surface: "cli",
          locale: "en",
          force: false,
        }).ok,
      ).toBe(true);
      const tomlPath = path.join(kimiHome, "config.toml");
      let toml = fs.readFileSync(tomlPath, "utf8");
      toml = toml.replace(/timeout = 120/g, "timeout = 30");
      fs.writeFileSync(tomlPath, toml, "utf8");
      const r = upgradeProject({ projectRoot: root, packageVersion: "0.3.0" });
      expect(r.ok).toBe(true);
      const after = fs.readFileSync(tomlPath, "utf8");
      expect(after).toMatch(/timeout = 120/);
      expect(after).toMatch(/--platform kimi-code/);
      expect(after).not.toMatch(/timeout = 30/);
    } finally {
      if (prev === undefined) delete process.env.KIMI_CODE_HOME;
      else process.env.KIMI_CODE_HOME = prev;
      fs.rmSync(kimiHome, { recursive: true, force: true });
    }
  });

  it("dry-run lists Copilot hooks action when copilot-cli is enabled (no skills)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "copilot-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const r = upgradeProject({ projectRoot: root, dryRun: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(
      r.actions.some((a) => /\.github\/hooks\/autopilot-harness\.json/i.test(a)),
    ).toBe(true);
    expect(r.actions.some((a) => /\.cursor\/skills/i.test(a))).toBe(false);
    expect(r.actions.some((a) => /\.claude\/skills/i.test(a))).toBe(false);
  });

  it("Cursor-only upgrade ignores corrupt leftover Copilot hooks", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const leftover = path.join(
      root,
      ".github",
      "hooks",
      "autopilot-harness.json",
    );
    fs.mkdirSync(path.dirname(leftover), { recursive: true });
    const corrupt = "{not-json";
    fs.writeFileSync(leftover, corrupt, "utf8");

    const dry = upgradeProject({ projectRoot: root, dryRun: true });
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;
    expect(
      dry.actions.some((a) => /\.github\/hooks\/autopilot-harness\.json/i.test(a)),
    ).toBe(false);

    const r = upgradeProject({ projectRoot: root, packageVersion: "0.3.0" });
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(leftover, "utf8")).toBe(corrupt);
  });

  it("Copilot-enabled upgrade fails closed on corrupt hooks JSON", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "copilot-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    fs.writeFileSync(
      path.join(root, ".github", "hooks", "autopilot-harness.json"),
      "{not-json",
      "utf8",
    );
    const dry = upgradeProject({ projectRoot: root, dryRun: true });
    expect(dry.ok).toBe(false);
    if (!dry.ok) {
      expect(dry.error).toMatch(/autopilot-harness\.json|valid JSON/i);
    }
    const r = upgradeProject({ projectRoot: root, packageVersion: "0.3.0" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/autopilot-harness\.json|valid JSON/i);
    }
  });

  it("upgrade refreshes Copilot hooks and restores timeoutSec ≥120", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "copilot-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const hooksPath = path.join(
      root,
      ".github",
      "hooks",
      "autopilot-harness.json",
    );
    const file = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      hooks?: Record<string, Array<{ timeoutSec?: number; bash?: string }>>;
    };
    for (const handlers of Object.values(file.hooks ?? {})) {
      for (const h of handlers) {
        if (typeof h.bash === "string" && h.bash.includes("autopilot-harness-hook")) {
          h.timeoutSec = 30;
        }
      }
    }
    fs.writeFileSync(hooksPath, JSON.stringify(file, null, 2) + "\n");
    const r = upgradeProject({ projectRoot: root, packageVersion: "0.3.0" });
    expect(r.ok).toBe(true);
    const after = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      hooks?: Record<string, Array<{ timeoutSec?: number; bash?: string }>>;
    };
    const stop = after.hooks?.agentStop?.[0];
    expect(stop?.timeoutSec).toBe(120);
    expect(stop?.bash).toMatch(/--platform copilot-cli/);
  });

  it("Copilot-enabled upgrade fails closed when .github is a symlink", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "copilot-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ah-up-copilot-"));
    const hooksPath = path.join(
      root,
      ".github",
      "hooks",
      "autopilot-harness.json",
    );
    const hooks = fs.readFileSync(hooksPath, "utf8");
    fs.mkdirSync(path.join(outside, "hooks"), { recursive: true });
    fs.writeFileSync(
      path.join(outside, "hooks", "autopilot-harness.json"),
      hooks,
    );
    fs.rmSync(path.join(root, ".github"), { recursive: true, force: true });
    fs.symlinkSync(outside, path.join(root, ".github"));

    const dry = upgradeProject({ projectRoot: root, dryRun: true });
    expect(dry.ok).toBe(false);
    if (!dry.ok) expect(dry.error).toMatch(/\.github/i);
    const r = upgradeProject({ projectRoot: root, packageVersion: "0.3.0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/\.github/i);
    expect(
      JSON.stringify(
        JSON.parse(
          fs.readFileSync(
            path.join(outside, "hooks", "autopilot-harness.json"),
            "utf8",
          ),
        ),
      ),
    ).toMatch(/autopilot-harness-hook\.mjs/);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("dry-run lists Grok hooks action when grok-build is enabled (no skills)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "grok-build",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const r = upgradeProject({ projectRoot: root, dryRun: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(
      r.actions.some((a) => /\.grok\/hooks\/autopilot-harness\.json/i.test(a)),
    ).toBe(true);
    expect(r.actions.some((a) => /\.cursor\/skills/i.test(a))).toBe(false);
    expect(r.actions.some((a) => /\.claude\/skills/i.test(a))).toBe(false);
  });

  it("Grok-enabled upgrade fails closed on corrupt hooks JSON", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "grok-build",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    fs.writeFileSync(
      path.join(root, ".grok", "hooks", "autopilot-harness.json"),
      "{not-json",
      "utf8",
    );
    const dry = upgradeProject({ projectRoot: root, dryRun: true });
    expect(dry.ok).toBe(false);
    if (!dry.ok) {
      expect(dry.error).toMatch(/autopilot-harness\.json|valid JSON|JSON/i);
    }
    const r = upgradeProject({ projectRoot: root, packageVersion: "0.3.0" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/autopilot-harness\.json|valid JSON|JSON/i);
    }
  });

  it("upgrade refreshes Grok hooks and restores timeout 120", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "grok-build",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const hooksPath = path.join(
      root,
      ".grok",
      "hooks",
      "autopilot-harness.json",
    );
    const file = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      hooks?: Record<
        string,
        Array<{ hooks?: Array<{ timeout?: number; command?: string }> }>
      >;
    };
    for (const groups of Object.values(file.hooks ?? {})) {
      for (const g of groups) {
        for (const h of g.hooks ?? []) {
          if (
            typeof h.command === "string" &&
            h.command.includes("autopilot-harness-hook")
          ) {
            h.timeout = 30;
          }
        }
      }
    }
    // Foreign sibling handler must survive fingerprint-only upgrade merge.
    file.hooks ??= {};
    file.hooks.Stop = [
      ...(file.hooks.Stop ?? []),
      {
        hooks: [{ command: "echo foreign-grok-keep", timeout: 9 }],
      },
    ];
    fs.writeFileSync(hooksPath, JSON.stringify(file, null, 2) + "\n");
    const r = upgradeProject({ projectRoot: root, packageVersion: "0.3.0" });
    expect(r.ok).toBe(true);
    const after = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      hooks?: Record<
        string,
        Array<{ hooks?: Array<{ timeout?: number; command?: string }> }>
      >;
    };
    const stopGroups = after.hooks?.Stop ?? [];
    const autopilotStop = stopGroups
      .flatMap((g) => g.hooks ?? [])
      .find(
        (h) =>
          typeof h.command === "string" &&
          h.command.includes("autopilot-harness-hook"),
      );
    expect(autopilotStop?.timeout).toBe(120);
    expect(autopilotStop?.command).toMatch(/--platform grok-build/);
    expect(JSON.stringify(stopGroups)).toMatch(/foreign-grok-keep/);
  });
});
