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
    expect(cfg.locale).toBe("en");
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

  it("reads confirm_rounds, verify, stuck, locale from config.yml", () => {
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
`,
    );
    const cfg = loadProjectReviewConfig(root);
    expect(cfg.confirmRounds).toBe(3);
    expect(cfg.verifyEnabled).toBe(true);
    expect(cfg.verifyCommands).toEqual([
      { id: "test", run: "cargo test", required: true },
    ]);
    expect(cfg.maxIdleStops).toBe(7);
    expect(cfg.locale).toBe("zh-CN");
  });

  it("clamps invalid confirm_rounds / max_idle_stops to defaults", () => {
    const root = tmpRoot();
    writeConfig(
      root,
      `
review:
  confirm_rounds: 99
  stuck:
    max_idle_stops: 0
`,
    );
    const cfg = loadProjectReviewConfig(root);
    expect(cfg.confirmRounds).toBe(5);
    expect(cfg.maxIdleStops).toBe(5);
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
