import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createConfiguredReviewEngine,
  loadProjectReviewConfig,
  normalizeProjectReviewConfig,
  StateStore,
} from "../src/index.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-cfg-"));
}

function writeConfig(root: string, body: string): void {
  fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
  fs.writeFileSync(path.join(root, ".autopilot", "config.yml"), body);
}

describe("loadProjectReviewConfig", () => {
  it("returns defaults when config.yml is missing", () => {
    const root = tmpRoot();
    const cfg = loadProjectReviewConfig(root);
    expect(cfg.confirmRounds).toBe(5);
    expect(cfg.verifyEnabled).toBe(false);
    expect(cfg.verifyCommands).toEqual([]);
    expect(cfg.maxIdleStops).toBe(5);
    expect(cfg.maxErrorsBeforePause).toBe(0);
    expect(cfg.locale).toBe("en");
    expect(cfg.reviewScope).toBe("executing_only");
  });

  it("refuses symlinked config.yml (fail-open defaults)", () => {
    const root = tmpRoot();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-cfg-out-"));
    try {
      const target = path.join(outside, "evil.yml");
      fs.writeFileSync(target, "review:\n  confirm_rounds: 3\n");
      fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
      fs.symlinkSync(target, path.join(root, ".autopilot", "config.yml"));
      const cfg = loadProjectReviewConfig(root);
      expect(cfg.confirmRounds).toBe(5);
      expect(cfg.verifyEnabled).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("refuses when .autopilot dir symlink escapes the project", () => {
    const root = tmpRoot();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-cfg-dir-"));
    try {
      fs.writeFileSync(
        path.join(outside, "config.yml"),
        "review:\n  confirm_rounds: 3\n",
      );
      fs.symlinkSync(outside, path.join(root, ".autopilot"));
      const cfg = loadProjectReviewConfig(root);
      expect(cfg.confirmRounds).toBe(5);
      expect(cfg.verifyEnabled).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("refuses empty or NUL projectRoot (fail-open defaults, no open)", () => {
    expect(loadProjectReviewConfig("").confirmRounds).toBe(5);
    expect(loadProjectReviewConfig("   ").confirmRounds).toBe(5);
    expect(loadProjectReviewConfig("bad\0root").confirmRounds).toBe(5);
  });

  it("trims projectRoot before reading config.yml", () => {
    const root = tmpRoot();
    writeConfig(
      root,
      `
review:
  confirm_rounds: 3
`,
    );
    expect(loadProjectReviewConfig(`  ${root}  `).confirmRounds).toBe(3);
  });

  it("reads confirm_rounds, verify, stuck, errors, locale from config.yml", () => {
    const root = tmpRoot();
    writeConfig(
      root,
      `
locale: zh-CN
review:
  confirm_rounds: 3
  verify:
    enabled: true
    commands:
      - id: test
        run: "cargo test"
        required: true
  stuck:
    max_idle_stops: 7
  errors:
    max_before_pause: 5
`,
    );
    const cfg = loadProjectReviewConfig(root);
    expect(cfg.confirmRounds).toBe(3);
    expect(cfg.verifyEnabled).toBe(true);
    expect(cfg.verifyCommands).toEqual([
      { id: "test", run: "cargo test", required: true },
    ]);
    expect(cfg.maxIdleStops).toBe(7);
    expect(cfg.maxErrorsBeforePause).toBe(5);
    expect(cfg.locale).toBe("zh-CN");
  });

  it("reads review.scope project from config.yml", () => {
    const root = tmpRoot();
    writeConfig(root, "review:\n  scope: project\n");
    expect(loadProjectReviewConfig(root).reviewScope).toBe("project");
    writeConfig(root, "review:\n  scope: executing_only\n");
    expect(loadProjectReviewConfig(root).reviewScope).toBe("executing_only");
  });

  it("clamps invalid confirm_rounds / max_idle_stops / max_before_pause to defaults", () => {
    const root = tmpRoot();
    writeConfig(
      root,
      `
review:
  confirm_rounds: 99
  stuck:
    max_idle_stops: 0
  errors:
    max_before_pause: -3
`,
    );
    const cfg = loadProjectReviewConfig(root);
    expect(cfg.confirmRounds).toBe(5);
    expect(cfg.maxIdleStops).toBe(5);
    expect(cfg.maxErrorsBeforePause).toBe(0);
  });

  it("clamps max_before_pause / max_idle_stops above max (not fail-open to default)", () => {
    const root = tmpRoot();
    writeConfig(
      root,
      `
review:
  stuck:
    max_idle_stops: 999
  errors:
    max_before_pause: 1001
`,
    );
    const cfg = loadProjectReviewConfig(root);
    expect(cfg.maxIdleStops).toBe(100);
    expect(cfg.maxErrorsBeforePause).toBe(1000);
  });

  it("fail-opens on corrupt YAML", () => {
    const root = tmpRoot();
    writeConfig(root, "review: [\n");
    const cfg = loadProjectReviewConfig(root);
    expect(cfg.confirmRounds).toBe(5);
    expect(cfg.verifyEnabled).toBe(false);
  });

  it("strips UTF-8 BOM before parsing locale / review keys", () => {
    const root = tmpRoot();
    writeConfig(
      root,
      "\uFEFFlocale: zh-CN\nreview:\n  confirm_rounds: 3\n",
    );
    const cfg = loadProjectReviewConfig(root);
    expect(cfg.locale).toBe("zh-CN");
    expect(cfg.confirmRounds).toBe(3);
  });

  it("accepts tab-indented review keys", () => {
    const root = tmpRoot();
    writeConfig(root, "review:\n\tconfirm_rounds: 3\n\tstuck:\n\t\tmax_idle_stops: 4\n");
    const cfg = loadProjectReviewConfig(root);
    expect(cfg.confirmRounds).toBe(3);
    expect(cfg.maxIdleStops).toBe(4);
  });

  it("reads quoted boolean verify.enabled / command.required", () => {
    const root = tmpRoot();
    writeConfig(
      root,
      `
review:
  confirm_rounds: 3
  verify:
    enabled: "true"
    commands:
      - id: test
        run: "cargo test"
        required: "true"
`,
    );
    const cfg = loadProjectReviewConfig(root);
    expect(cfg.verifyEnabled).toBe(true);
    expect(cfg.verifyCommands).toEqual([
      { id: "test", run: "cargo test", required: true },
    ]);
  });

  it("ignores prototype-pollution keys without polluting Object.prototype", () => {
    const root = tmpRoot();
    writeConfig(
      root,
      `locale: en
__proto__:
  polluted: true
constructor:
  polluted: true
review:
  confirm_rounds: 3
  __proto__:
    polluted: true
`,
    );
    const cfg = loadProjectReviewConfig(root);
    expect(cfg.confirmRounds).toBe(3);
    expect(
      Object.prototype.hasOwnProperty.call(Object.prototype, "polluted"),
    ).toBe(false);
  });

  it("createConfiguredReviewEngine applies config without locale bundle", () => {
    const root = tmpRoot();
    writeConfig(
      root,
      `
review:
  confirm_rounds: 3
`,
    );
    const store = new StateStore(root);
    try {
      const engine = createConfiguredReviewEngine(store, root);
      expect(engine).toBeTruthy();
      expect(loadProjectReviewConfig(root).confirmRounds).toBe(3);
    } finally {
      store.close();
    }
  });

  it("createConfiguredReviewEngine sanitizes blank/NUL projectRoot", () => {
    const root = tmpRoot();
    const store = new StateStore(root);
    try {
      const engine = createConfiguredReviewEngine(store, "   ");
      expect(engine).toBeTruthy();
      // Empty safeRoot → containment fail-closed; engine still constructs.
      const engineNul = createConfiguredReviewEngine(store, "bad\0root");
      expect(engineNul).toBeTruthy();
    } finally {
      store.close();
    }
  });

  it("default verifyCommands is a fresh array (no shared mutable default)", () => {
    const root = tmpRoot();
    const a = loadProjectReviewConfig(root);
    const b = loadProjectReviewConfig(root);
    expect(a.verifyCommands).not.toBe(b.verifyCommands);
    a.verifyCommands.push({ id: "pollute" });
    expect(loadProjectReviewConfig(root).verifyCommands).toEqual([]);
  });

  it("normalizeProjectReviewConfig clamps and fill defaults", () => {
    expect(normalizeProjectReviewConfig(null).confirmRounds).toBe(5);
    expect(normalizeProjectReviewConfig({ confirmRounds: 0 }).confirmRounds).toBe(
      5,
    );
    expect(
      normalizeProjectReviewConfig({ confirmRounds: 3, verifyEnabled: "true" })
        .verifyEnabled,
    ).toBe(true);
    expect(
      normalizeProjectReviewConfig({
        confirmRounds: 2,
        verifyCommands: [{ id: "t", run: "x", required: true }],
      }).verifyCommands,
    ).toEqual([{ id: "t", run: "x", required: true }]);
  });

  it("createConfiguredReviewEngine accepts preloaded config (single-read path)", () => {
    const root = tmpRoot();
    // Disk says 5; preloaded says 2 — engine must use preloaded (no second disk read).
    writeConfig(root, "review:\n  confirm_rounds: 5\n");
    const store = new StateStore(root);
    try {
      const cid = "preload-cfg-aaaa-bbbb-cccc-ddddeeee0001";
      store.upsertSession({
        conversation_id: cid,
        project_root: root,
        code_root: root,
        platform: "cursor",
        phase: "executing",
        armed: 1,
        paused: 0,
        track_id: "demo",
        checklist_path: path.join(root, "plans", "demo", "checklist.md"),
      });
      store.updateReviewChain(cid, {
        chain_pending: 1,
        code_edited: 0,
        confirm_left: null,
        item_confirm_complete: 0,
        fix_round: 0,
      });
      const engine = createConfiguredReviewEngine(store, root, undefined, {
        confirmRounds: 2,
        verifyEnabled: false,
        verifyCommands: [],
        maxIdleStops: 5,
        maxErrorsBeforePause: 0,
        locale: "en",
      });
      const action = engine.handleStop({
        conversationId: cid,
        status: "completed",
        loopCount: 1,
      });
      expect(action?.message).toMatch(/1\/2/);
    } finally {
      store.close();
    }
  });

  it("preloaded out-of-range confirmRounds is clamped (no bypass)", () => {
    const root = tmpRoot();
    writeConfig(root, "review:\n  confirm_rounds: 3\n");
    const store = new StateStore(root);
    try {
      const cid = "preload-clamp-aaaa-bbbb-cccc-ddddeeee0002";
      store.upsertSession({
        conversation_id: cid,
        project_root: root,
        code_root: root,
        platform: "cursor",
        phase: "executing",
        armed: 1,
        paused: 0,
        track_id: "demo",
        checklist_path: path.join(root, "plans", "demo", "checklist.md"),
      });
      store.updateReviewChain(cid, {
        chain_pending: 1,
        code_edited: 0,
        confirm_left: null,
        item_confirm_complete: 0,
        fix_round: 0,
      });
      // 99 phải về default 5 — không được đưa vào engine
      const engine = createConfiguredReviewEngine(store, root, undefined, {
        confirmRounds: 99,
        verifyEnabled: false,
        verifyCommands: [],
        maxIdleStops: 5,
        maxErrorsBeforePause: 0,
        locale: "en",
      });
      const action = engine.handleStop({
        conversationId: cid,
        status: "completed",
        loopCount: 1,
      });
      expect(action?.message).toMatch(/1\/5/);
    } finally {
      store.close();
    }
  });
});
