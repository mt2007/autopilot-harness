import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StateStore } from "@autopilot-harness/core";
import { installInitYes } from "../src/init/install.js";
import {
  formatStatus,
  hasGlobalSelfReviewHooks,
  readPinVersion,
  readStaleAfterHours,
  runDoctor,
  shortSessionId,
} from "../src/index.js";

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-cli-sd-"));
}

describe("formatStatus", () => {
  let root: string;
  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports not initialized", () => {
    root = tmpProject();
    expect(formatStatus(root)).toMatch(/not initialized/i);
  });

  it("rejects empty projectRoot (does not resolve to cwd)", () => {
    expect(formatStatus("")).toMatch(/projectRoot must be a non-empty string/);
    expect(readStaleAfterHours("   ")).toBe(0);
    expect(readPinVersion("")).toBeNull();
  });

  it("shows preferred_name, config, and active session from state.db", () => {
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

    const id = "sta-aaaa-bbbb-cccc-ddddeeee0001";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: id,
      project_root: root,
      code_root: root,
      track_id: "auth-fix",
      track_title: "Auth fix",
      session_title: "Cursor chat",
      phase: "executing",
      paused: 1,
      paused_reason: "human_gate",
      armed: 0,
      checklist_path: path.join(root, "plans", "auth-fix", "checklist.md"),
    });
    store.close();

    const text = formatStatus(root);
    expect(text).toMatch(/^Autopilot status/m);
    expect(text).toMatch(/platforms:\s*cursor\(ide\)/);
    expect(text).toMatch(/locale:\s*en/);
    expect(text).toMatch(/plans:\s*plans/);
    expect(text).toMatch(/sessions:\s*1/);
    expect(text).toMatch(/Auth fix/);
    expect(text).toMatch(/executing \(paused\)/);
    expect(text).toMatch(new RegExp(shortSessionId(id)));
  });
});

describe("runDoctor", () => {
  let root: string;
  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects empty projectRoot (does not resolve to cwd)", () => {
    const { ok, lines } = runDoctor("  ");
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/projectRoot must be a non-empty string/);
  });

  it("passes after init with schema and plans checks", () => {
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
    // Touch state.db via store open so schema check can run.
    new StateStore(root).close();
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(/OK\s+config\.yml/);
    expect(joined).toMatch(/OK\s+\.autopilotignore/);
    expect(joined).toMatch(/OK\s+hook vendor runtime/);
    expect(joined).toMatch(/OK\s+state\.db/);
    expect(joined).toMatch(/schema_version/);
    expect(joined).toMatch(/OK\s+plans/);
  });

  it("WARNs when Autopilot stop omits loop_limit null", () => {
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
    new StateStore(root).close();

    const hooksPath = path.join(root, ".cursor", "hooks.json");
    fs.writeFileSync(
      hooksPath,
      JSON.stringify({
        version: 1,
        hooks: {
          beforeSubmitPrompt: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --event beforeSubmitPrompt",
            },
          ],
          afterFileEdit: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --event afterFileEdit",
            },
          ],
          stop: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --event stop",
            },
          ],
        },
      }),
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(/loop_limit:null/i);
    expect(joined).not.toMatch(/OK\s+hooks\.json Autopilot entries/);
  });

  it("WARNs loop_limit even when another Autopilot event is missing", () => {
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
    new StateStore(root).close();

    fs.writeFileSync(
      path.join(root, ".cursor", "hooks.json"),
      JSON.stringify({
        version: 1,
        hooks: {
          beforeSubmitPrompt: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --event beforeSubmitPrompt",
            },
          ],
          // afterFileEdit intentionally missing
          stop: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --event stop",
            },
          ],
        },
      }),
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    const joined = lines.join("\n");
    expect(joined).toMatch(/missing Autopilot.*afterFileEdit/i);
    expect(joined).toMatch(/loop_limit:null/i);
  });

  it("WARNs when ~/.cursor still has global self-review hooks", () => {
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
    new StateStore(root).close();

    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-home-"));
    try {
      const cursorDir = path.join(fakeHome, ".cursor");
      fs.mkdirSync(cursorDir, { recursive: true });
      fs.writeFileSync(
        path.join(cursorDir, "hooks.json"),
        JSON.stringify({
          version: 1,
          hooks: {
            stop: [
              {
                command: "python3 ./hooks/run-global-self-review.py stop",
              },
            ],
          },
        }),
      );
      const { ok, lines } = runDoctor(root, { homeDir: fakeHome });
      expect(ok).toBe(true);
      expect(lines.join("\n")).toMatch(/global self-review/i);
    } finally {
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it("ignores symlinked ~/.cursor/hooks.json (no follow)", () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-home-sym-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-outside-"));
    try {
      const target = path.join(outside, "secret-hooks.json");
      fs.writeFileSync(
        target,
        JSON.stringify({
          hooks: { stop: [{ command: "run-global-self-review.py" }] },
        }),
      );
      const cursorDir = path.join(fakeHome, ".cursor");
      fs.mkdirSync(cursorDir, { recursive: true });
      fs.symlinkSync(target, path.join(cursorDir, "hooks.json"));
      expect(hasGlobalSelfReviewHooks(fakeHome)).toBe(false);
    } finally {
      fs.rmSync(fakeHome, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects non-absolute homeDir for global hooks check", () => {
    expect(hasGlobalSelfReviewHooks("")).toBe(false);
    expect(hasGlobalSelfReviewHooks(".cursor")).toBe(false);
    expect(hasGlobalSelfReviewHooks("relative/home")).toBe(false);
  });

  it("WARNs on stale sessions and can prune them", () => {
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

    const id = "stl-aaaa-bbbb-cccc-ddddeeee0001";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: id,
      project_root: root,
      code_root: root,
      track_id: "old",
      checklist_path: "plans/old/checklist.md",
      armed: 0,
      phase: "planning",
    });
    // Force last_active_at far in the past.
    store.db
      .prepare(
        `UPDATE sessions SET last_active_at = ? WHERE conversation_id = ?`,
      )
      .run("2020-01-01T00:00:00.000Z", id);
    store.close();

    const warned = runDoctor(root, { nowMs: Date.parse("2026-08-28T00:00:00Z") });
    expect(warned.ok).toBe(true);
    expect(warned.lines.join("\n")).toMatch(/stale session/i);

    const pruned = runDoctor(root, {
      pruneStale: true,
      nowMs: Date.parse("2026-08-28T00:00:00Z"),
    });
    expect(pruned.ok).toBe(true);
    expect(pruned.pruned).toBe(1);
    expect(pruned.lines.join("\n")).toMatch(/pruned 1 stale/i);

    const store2 = new StateStore(root);
    expect(store2.getSession(id)).toBeNull();
    store2.close();
  });

  it("FAILs on unknown phase (orphan state)", () => {
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
    const id = "orp-aaaa-bbbb-cccc-ddddeeee0001";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: id,
      project_root: root,
      code_root: root,
      track_id: "x",
      checklist_path: "plans/x/checklist.md",
      armed: 0,
      phase: "planning",
    });
    store.db
      .prepare(`UPDATE sessions SET phase = ? WHERE conversation_id = ?`)
      .run("weird_phase", id);
    store.close();

    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/unknown phase/i);
  });

  it("WARNs when pin lags package version", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
        packageVersion: "0.1.0",
      }).ok,
    ).toBe(true);
    const { ok, lines } = runDoctor(root, { packageVersion: "0.2.0" });
    expect(ok).toBe(true);
    expect(lines.join("\n")).toMatch(/upgrade/i);
  });

  it("FAILs on invalid config.yml YAML", () => {
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
      "platform: [unterminated\n",
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/invalid YAML/i);
  });

  it("refuses --prune-stale when schema_version mismatches", () => {
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

    const id = "sch-aaaa-bbbb-cccc-ddddeeee0001";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: id,
      project_root: root,
      code_root: root,
      track_id: "old",
      checklist_path: "plans/old/checklist.md",
      armed: 0,
      phase: "planning",
    });
    store.db
      .prepare(
        `UPDATE sessions SET last_active_at = ? WHERE conversation_id = ?`,
      )
      .run("2020-01-01T00:00:00.000Z", id);
    // Ahead of package latest so reopen migrate() will not rewrite it down.
    store.db
      .prepare(
        `INSERT OR REPLACE INTO _schema_meta (key, value) VALUES ('schema_version', ?)`,
      )
      .run("999");
    store.close();

    const result = runDoctor(root, {
      pruneStale: true,
      nowMs: Date.parse("2026-08-28T00:00:00Z"),
    });
    expect(result.ok).toBe(false);
    expect(result.pruned).toBeUndefined();
    expect(result.lines.join("\n")).toMatch(/refusing --prune-stale/i);

    const store2 = new StateStore(root);
    expect(store2.getSession(id)).not.toBeNull();
    store2.close();
  });

  it("skips armed executing sessions during --prune-stale", () => {
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

    const liveId = "liv-aaaa-bbbb-cccc-ddddeeee0001";
    const pausedArmedId = "paz-aaaa-bbbb-cccc-ddddeeee0001";
    const deadId = "ded-aaaa-bbbb-cccc-ddddeeee0001";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: liveId,
      project_root: root,
      code_root: root,
      track_id: "live",
      checklist_path: "plans/live/checklist.md",
      armed: 1,
      phase: "executing",
      paused: 0,
    });
    store.upsertSession({
      conversation_id: pausedArmedId,
      project_root: root,
      code_root: root,
      track_id: "paused",
      checklist_path: "plans/paused/checklist.md",
      armed: 1,
      phase: "executing",
      paused: 1,
      paused_reason: "human_gate",
    });
    store.upsertSession({
      conversation_id: deadId,
      project_root: root,
      code_root: root,
      track_id: "dead",
      checklist_path: "plans/dead/checklist.md",
      armed: 0,
      phase: "planning",
    });
    store.db
      .prepare(`UPDATE sessions SET last_active_at = ?`)
      .run("2020-01-01T00:00:00.000Z");
    store.close();

    const result = runDoctor(root, {
      pruneStale: true,
      nowMs: Date.parse("2026-08-28T00:00:00Z"),
    });
    expect(result.ok).toBe(true);
    expect(result.pruned).toBe(1);
    expect(result.lines.join("\n")).toMatch(/skipped 2 in-flight/i);

    const store2 = new StateStore(root);
    expect(store2.getSession(liveId)).not.toBeNull();
    expect(store2.getSession(pausedArmedId)).not.toBeNull();
    expect(store2.getSession(deadId)).toBeNull();
    store2.close();
  });

  it("skips pending_action and armed non-executing during --prune-stale", () => {
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

    const pendingId = "pen-aaaa-bbbb-cccc-ddddeeee0001";
    const armedPlanId = "apl-aaaa-bbbb-cccc-ddddeeee0001";
    const deadId = "dd2-aaaa-bbbb-cccc-ddddeeee0001";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: pendingId,
      project_root: root,
      code_root: root,
      track_id: "_pending",
      checklist_path: "",
      armed: 0,
      phase: "planning",
      pending_action: "run",
    });
    store.upsertSession({
      conversation_id: armedPlanId,
      project_root: root,
      code_root: root,
      track_id: "x",
      checklist_path: "plans/x/checklist.md",
      armed: 1,
      phase: "planning",
    });
    store.upsertSession({
      conversation_id: deadId,
      project_root: root,
      code_root: root,
      track_id: "dead",
      checklist_path: "plans/dead/checklist.md",
      armed: 0,
      phase: "idle",
    });
    store.db
      .prepare(`UPDATE sessions SET last_active_at = ?`)
      .run("2020-01-01T00:00:00.000Z");
    store.close();

    const result = runDoctor(root, {
      pruneStale: true,
      nowMs: Date.parse("2026-08-28T00:00:00Z"),
    });
    expect(result.ok).toBe(true);
    expect(result.pruned).toBe(1);
    expect(result.lines.join("\n")).toMatch(/skipped 2 in-flight/i);

    const store2 = new StateStore(root);
    expect(store2.getSession(pendingId)).not.toBeNull();
    expect(store2.getSession(armedPlanId)).not.toBeNull();
    expect(store2.getSession(deadId)).toBeNull();
    store2.close();
  });

  it("skips paused human_gate sessions during --prune-stale", () => {
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

    const gateId = "gat-aaaa-bbbb-cccc-ddddeeee0001";
    const deadId = "gd2-aaaa-bbbb-cccc-ddddeeee0001";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: gateId,
      project_root: root,
      code_root: root,
      track_id: "gate",
      checklist_path: "plans/gate/checklist.md",
      armed: 0,
      phase: "executing",
      paused: 1,
      paused_reason: "human_gate",
    });
    store.upsertSession({
      conversation_id: deadId,
      project_root: root,
      code_root: root,
      track_id: "dead",
      checklist_path: "plans/dead/checklist.md",
      armed: 0,
      phase: "idle",
      paused: 0,
    });
    store.db
      .prepare(`UPDATE sessions SET last_active_at = ?`)
      .run("2020-01-01T00:00:00.000Z");
    store.close();

    const result = runDoctor(root, {
      pruneStale: true,
      nowMs: Date.parse("2026-08-28T00:00:00Z"),
    });
    expect(result.ok).toBe(true);
    expect(result.pruned).toBe(1);
    expect(result.lines.join("\n")).toMatch(/skipped 1 in-flight/i);

    const store2 = new StateStore(root);
    expect(store2.getSession(gateId)).not.toBeNull();
    expect(store2.getSession(deadId)).toBeNull();
    store2.close();
  });

  it("refuses --prune-stale when orphan phase rows exist", () => {
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
    const orphanId = "orf-aaaa-bbbb-cccc-ddddeeee0001";
    const otherId = "oth-aaaa-bbbb-cccc-ddddeeee0001";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: orphanId,
      project_root: root,
      code_root: root,
      track_id: "x",
      checklist_path: "plans/x/checklist.md",
      armed: 0,
      phase: "planning",
    });
    store.upsertSession({
      conversation_id: otherId,
      project_root: root,
      code_root: root,
      track_id: "y",
      checklist_path: "plans/y/checklist.md",
      armed: 0,
      phase: "idle",
    });
    store.db
      .prepare(`UPDATE sessions SET phase = ? WHERE conversation_id = ?`)
      .run("weird_phase", orphanId);
    store.db
      .prepare(`UPDATE sessions SET last_active_at = ?`)
      .run("2020-01-01T00:00:00.000Z");
    store.close();

    const result = runDoctor(root, {
      pruneStale: true,
      nowMs: Date.parse("2026-08-28T00:00:00Z"),
    });
    expect(result.ok).toBe(false);
    expect(result.pruned).toBeUndefined();
    expect(result.lines.join("\n")).toMatch(/refusing --prune-stale.*orphan/i);
    const store2 = new StateStore(root);
    expect(store2.getSession(orphanId)).not.toBeNull();
    expect(store2.getSession(otherId)).not.toBeNull();
    store2.close();
  });

  it("stale_after_hours 0 disables stale detection", () => {
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
    const yaml = fs.readFileSync(configPath, "utf8");
    fs.writeFileSync(
      configPath,
      yaml.replace(/stale_after_hours:\s*72/, "stale_after_hours: 0"),
    );
    expect(readStaleAfterHours(root)).toBe(0);

    const id = "zro-aaaa-bbbb-cccc-ddddeeee0001";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: id,
      project_root: root,
      code_root: root,
      track_id: "old",
      checklist_path: "plans/old/checklist.md",
      armed: 0,
      phase: "idle",
    });
    store.db
      .prepare(
        `UPDATE sessions SET last_active_at = ? WHERE conversation_id = ?`,
      )
      .run("2020-01-01T00:00:00.000Z", id);
    store.close();

    const result = runDoctor(root, {
      pruneStale: true,
      nowMs: Date.parse("2026-08-28T00:00:00Z"),
    });
    expect(result.ok).toBe(true);
    expect(result.pruned).toBeUndefined();
    expect(result.lines.join("\n")).not.toMatch(/stale session/i);
    const store2 = new StateStore(root);
    expect(store2.getSession(id)).not.toBeNull();
    store2.close();
  });

  it("refuses --prune-stale when config.yml is invalid", () => {
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
    const id = "cfg-aaaa-bbbb-cccc-ddddeeee0001";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: id,
      project_root: root,
      code_root: root,
      track_id: "old",
      checklist_path: "plans/old/checklist.md",
      armed: 0,
      phase: "idle",
    });
    store.db
      .prepare(
        `UPDATE sessions SET last_active_at = ? WHERE conversation_id = ?`,
      )
      .run("2020-01-01T00:00:00.000Z", id);
    store.close();
    fs.writeFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "platform: [unterminated\n",
    );

    const result = runDoctor(root, {
      pruneStale: true,
      nowMs: Date.parse("2026-08-28T00:00:00Z"),
    });
    expect(result.ok).toBe(false);
    expect(result.pruned).toBeUndefined();
    expect(result.lines.join("\n")).toMatch(/invalid YAML/i);
    expect(result.lines.join("\n")).not.toMatch(/pruned \d+ stale/i);
    expect(result.lines.join("\n")).not.toMatch(/stale session/i);
    expect(readStaleAfterHours(root)).toBe(0);

    const store2 = new StateStore(root);
    expect(store2.getSession(id)).not.toBeNull();
    store2.close();
  });

  it("FAILs when artifacts.plans_dir is invalid (no silent fallback OK)", () => {
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
    const yaml = fs.readFileSync(configPath, "utf8");
    fs.writeFileSync(
      configPath,
      yaml.replace(/plans_dir:\s*plans/, "plans_dir: ../escape"),
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/plans_dir invalid/i);
    expect(formatStatus(root)).toMatch(/plans:\s*invalid/i);
  });

  it("readStaleAfterHours respects config (number or numeric string)", () => {
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
    expect(readStaleAfterHours(root)).toBe(72);
    const configPath = path.join(root, ".autopilot", "config.yml");
    let yaml = fs.readFileSync(configPath, "utf8");
    yaml = yaml.replace(/stale_after_hours:\s*72/, "stale_after_hours: 24");
    fs.writeFileSync(configPath, yaml);
    expect(readStaleAfterHours(root)).toBe(24);
    yaml = yaml.replace(/stale_after_hours:\s*24/, 'stale_after_hours: "48"');
    fs.writeFileSync(configPath, yaml);
    expect(readStaleAfterHours(root)).toBe(48);
    yaml = yaml.replace(/stale_after_hours:\s*"48"/, 'stale_after_hours: "0.0"');
    fs.writeFileSync(configPath, yaml);
    expect(readStaleAfterHours(root)).toBe(0);
  });

  it("FAILs on invalid stale_after_hours and does not prune with fallback", () => {
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
    const yaml = fs.readFileSync(configPath, "utf8");
    fs.writeFileSync(
      configPath,
      yaml.replace(/stale_after_hours:\s*72/, "stale_after_hours: -5"),
    );
    const id = "bad-aaaa-bbbb-cccc-ddddeeee0001";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: id,
      project_root: root,
      code_root: root,
      track_id: "old",
      checklist_path: "plans/old/checklist.md",
      armed: 0,
      phase: "idle",
    });
    store.db
      .prepare(
        `UPDATE sessions SET last_active_at = ? WHERE conversation_id = ?`,
      )
      .run("2020-01-01T00:00:00.000Z", id);
    store.close();

    const result = runDoctor(root, {
      pruneStale: true,
      nowMs: Date.parse("2026-08-28T00:00:00Z"),
    });
    expect(result.ok).toBe(false);
    expect(result.pruned).toBeUndefined();
    expect(result.lines.join("\n")).toMatch(/stale_after_hours invalid/i);
    expect(result.lines.join("\n")).not.toMatch(/pruned \d+ stale/i);
    expect(result.lines.join("\n")).not.toMatch(/stale session/i);
    expect(readStaleAfterHours(root)).toBe(0);
    const store2 = new StateStore(root);
    expect(store2.getSession(id)).not.toBeNull();
    store2.close();
  });

  it("FAILs when artifacts.plans_dir is not a string", () => {
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
    const yaml = fs.readFileSync(configPath, "utf8");
    fs.writeFileSync(
      configPath,
      yaml.replace(/plans_dir:\s*plans/, "plans_dir: 12"),
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/plans_dir must be a string/i);
  });

  it("strips control chars from pin display (status + doctor)", () => {
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
      path.join(root, ".autopilot", "pin.json"),
      JSON.stringify({ "autopilot-harness": "0.1.0\u001b[31mevil" }),
    );
    const status = formatStatus(root);
    expect(status).not.toMatch(/\u001b/);
    expect(status).toMatch(/autopilot-harness@0\.1\.0 \[31mevil/);
    const doctorOut = runDoctor(root).lines.join("\n");
    expect(doctorOut).not.toMatch(/\u001b/);
    expect(doctorOut).toMatch(/pin\.json → 0\.1\.0 \[31mevil/);
  });

  it("FAILs when config.yml exceeds size cap", () => {
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
    fs.writeFileSync(configPath, `# ${"x".repeat(1_000_100)}\nplatform: cursor\n`);
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/too large/i);
    expect(readStaleAfterHours(root)).toBe(0);
  });

  it("FAILs when config.yml is a symlink", () => {
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
    fs.renameSync(configPath, outside);
    fs.symlinkSync(outside, configPath);
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/symlink/i);
    expect(formatStatus(root)).toMatch(/cannot read config|symlink/i);
    expect(readStaleAfterHours(root)).toBe(0);
  });

  it("FAILs when config.yml is a dangling symlink (not treated as missing)", () => {
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
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/symlink|unreadable/i);
    expect(lines.join("\n")).not.toMatch(/missing — run init/i);
    expect(formatStatus(root)).toMatch(/cannot read config|symlink/i);
    expect(formatStatus(root)).not.toMatch(/not initialized/i);
    expect(readStaleAfterHours(root)).toBe(0);
  });

  it("treats oversized pin.json as missing/invalid", () => {
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
      path.join(root, ".autopilot", "pin.json"),
      JSON.stringify({ "autopilot-harness": "0.1.0", pad: "x".repeat(70_000) }),
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/pin\.json missing or invalid/i);
    expect(formatStatus(root)).toMatch(/autopilot-harness@unknown/);
  });

  it("treats symlinked pin.json as missing/invalid (no follow)", () => {
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
    const pinPath = path.join(root, ".autopilot", "pin.json");
    const outside = path.join(root, "outside-pin.json");
    fs.renameSync(pinPath, outside);
    fs.symlinkSync(outside, pinPath);
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/pin\.json missing or invalid/i);
  });

  it("FAILs when project .cursor/hooks.json is a symlink", () => {
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
    const outside = path.join(root, "outside-hooks.json");
    fs.renameSync(hooksPath, outside);
    fs.symlinkSync(outside, hooksPath);
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/hooks\.json unreadable|symlink/i);
  });

  it("FAILs when project hooks.json is a dangling symlink (not treated as missing)", () => {
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
    fs.rmSync(hooksPath, { force: true });
    fs.symlinkSync(path.join(root, "missing-hooks.json"), hooksPath);
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/hooks\.json unreadable|symlink/i);
    expect(lines.join("\n")).not.toMatch(/hooks\.json missing/i);
  });

  it("FAILs when plans dir is a dangling symlink (not treated as missing)", () => {
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
    const plansDir = path.join(root, "plans");
    fs.rmSync(plansDir, { recursive: true, force: true });
    fs.symlinkSync(path.join(root, "missing-plans"), plansDir);
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/plans path is a symlink/i);
    expect(lines.join("\n")).not.toMatch(/plans dir missing/i);
  });

  it("WARNs when a skill path is a dangling symlink (not counted as present)", () => {
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
    const skillPath = path.join(
      root,
      ".cursor",
      "skills",
      "autopilot-on",
      "SKILL.md",
    );
    fs.rmSync(skillPath, { force: true });
    fs.symlinkSync(path.join(root, "missing-skill.md"), skillPath);
    const { lines } = runDoctor(root);
    expect(lines.join("\n")).toMatch(/skill\(s\) missing/i);
  });

  it("WARNs when skill directory is a symlink escape (realpath outside project)", () => {
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
    const skillDir = path.join(root, ".cursor", "skills", "autopilot-on");
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "ah-skill-esc-"));
    try {
      fs.writeFileSync(path.join(outsideDir, "SKILL.md"), "# outside\n", "utf8");
      fs.rmSync(skillDir, { recursive: true, force: true });
      fs.symlinkSync(outsideDir, skillDir);
      const { lines } = runDoctor(root);
      expect(lines.join("\n")).toMatch(/skill\(s\) missing/i);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("FAILs when project .cursor/hooks.json is too large", () => {
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
    fs.writeFileSync(hooksPath, `{"pad":"${"x".repeat(1_000_100)}"}`);
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/hooks\.json unreadable|too large/i);
  });

  it("FAILs hooks shape without echoing control chars in keys", () => {
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
    const badKey = "before\u001b[2JSubmit";
    fs.writeFileSync(
      hooksPath,
      JSON.stringify({
        version: 1,
        hooks: { [badKey]: "not-an-array" },
      }),
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    const text = lines.join("\n");
    expect(text).not.toMatch(/\u001b/);
    expect(text).toMatch(/hooks\.before \[2JSubmit/);
  });

  it("WARNs when Claude BLOCK_CAP missing or not 0", () => {
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
    new StateStore(root).close();

    const settingsPath = path.join(root, ".claude", "settings.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
      env?: Record<string, string>;
    };
    settings.env = { ...(settings.env ?? {}), CLAUDE_CODE_STOP_HOOK_BLOCK_CAP: "8" };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");

    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(/CLAUDE_CODE_STOP_HOOK_BLOCK_CAP/i);
    expect(joined).not.toMatch(/OK\s+\.claude\/settings\.json Autopilot entries/);
    expect(joined).not.toMatch(/FAIL\s+\.cursor\/hooks\.json missing/);
  });

  it("OKs Claude-only doctor without requiring Cursor hooks", () => {
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
    new StateStore(root).close();
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(/OK\s+\.claude\/settings\.json Autopilot entries/);
    expect(joined).toMatch(/OK\s+skills \(5\)/);
    expect(joined).not.toMatch(/hooks\.json Autopilot entries/);
  });
});
