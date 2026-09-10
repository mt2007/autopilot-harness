/**
 * tests-needpick-bind — regression matrix for run-pick-ux channel A/C + bind.
 * Keeps the checklist bullets in one discoverable suite (dual port + skill text).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MULTI_PLAN_EDIT_TRACK,
  applyRun,
  isChannelANeedPick,
  notePlansDirEdit,
  StateStore,
} from "../src/index.js";
import { handleBeforeSubmitPrompt } from "../../ports/cursor/src/index.js";
import { handleUserPromptSubmit } from "../../ports/claude-code/src/index.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-run-pick-matrix-"));
}

function writeChecklist(root: string, slug: string, body: string): void {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plan.md"), `# ${slug}\n`);
  fs.writeFileSync(path.join(dir, "checklist.md"), body);
}

describe("run-pick-ux matrix (tests-needpick-bind)", () => {
  let root = "";
  let store: StateStore | null = null;

  beforeEach(() => {
    root = tmpRoot();
    store = StateStore.openMemory(root);
  });
  afterEach(() => {
    try {
      store?.close();
    } catch {
      /* already closed / never opened */
    }
    store = null;
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    root = "";
  });

  function db(): StateStore {
    if (!store) throw new Error("store not opened");
    return store;
  }

  it("needPick: Cursor continues (channel A); Claude adds additionalContext", () => {
    writeChecklist(root, "alpha", `- [ ] a — A\n`);
    writeChecklist(root, "beta", `- [ ] b — B\n`);
    db().upsertSession({
      conversation_id: "cur-pick",
      project_root: root,
      code_root: root,
      phase: "planning",
      track_id: "_pending",
      checklist_path: "",
      armed: 0,
      paused: 0,
    });
    db().upsertSession({
      conversation_id: "cla-pick",
      project_root: root,
      code_root: root,
      phase: "planning",
      track_id: "_pending",
      checklist_path: "",
      armed: 0,
      paused: 0,
      platform: "claude-code",
    });

    const cursor = handleBeforeSubmitPrompt(
      db(),
      { conversation_id: "cur-pick", prompt: "/autopilot-run" },
      root,
    );
    expect(cursor).toEqual({ continue: true });
    expect(Object.keys(cursor)).toEqual(["continue"]);
    expect(db().getSession("cur-pick")!.phase).not.toBe("executing");
    expect(db().getSession("cur-pick")!.armed).toBe(0);
    expect(db().getSession("cur-pick")!.pending_action).toBe("run");

    // Fresh conversation — core needPick gate (not mid-pick re-entry).
    const corePick = applyRun(db(), "core-pick", root);
    expect(corePick.ok).toBe(false);
    if (!corePick.ok) {
      expect(corePick.needPick).toBe(true);
      expect(corePick.busy).toBeUndefined();
      expect(isChannelANeedPick(corePick)).toBe(true);
    }
    expect(db().getSession("core-pick")!.phase).not.toBe("executing");
    expect(db().getSession("core-pick")!.armed).toBe(0);
    expect(db().getSession("core-pick")!.pending_action).toBe("run");

    const claude = handleUserPromptSubmit(
      db(),
      { session_id: "cla-pick", prompt: "/autopilot-run" },
      root,
    );
    expect(claude.decision).toBeUndefined();
    expect(claude.continue).toBeUndefined();
    expect(Object.keys(claude)).toEqual(["hookSpecificOutput"]);
    const ctx = claude.hookSpecificOutput?.additionalContext ?? "";
    expect(ctx).toMatch(/Select a plan/i);
    expect(ctx).toMatch(/alpha/);
    expect(ctx).toMatch(/beta/);
    expect(db().getSession("cla-pick")!.phase).not.toBe("executing");
    expect(db().getSession("cla-pick")!.armed).toBe(0);
    expect(db().getSession("cla-pick")!.pending_action).toBe("run");
  });

  it("busy: dual port stays channel C (user_message / no additionalContext)", () => {
    writeChecklist(root, "demo", `- [ ] a — A\n`);
    expect(
      handleBeforeSubmitPrompt(
        db(),
        { conversation_id: "owner", prompt: "/autopilot-run demo" },
        root,
      ).continue,
    ).toBe(true);
    expect(db().getSession("owner")!.phase).toBe("executing");

    // Core busy must not set needPick (mutually exclusive; ports rely on this).
    const coreBusy = applyRun(db(), "peer-core", root, { slug: "demo" });
    expect(coreBusy.ok).toBe(false);
    if (!coreBusy.ok) {
      expect(coreBusy.busy).toBe(true);
      expect(coreBusy.needPick).toBeUndefined();
      expect(isChannelANeedPick(coreBusy)).toBe(false);
    }
    // exclusiveWrite commit:false — caller must not land in executing.
    expect(db().getSession("peer-core")!.phase).not.toBe("executing");
    expect(db().getSession("peer-core")!.armed).toBe(0);

    const cursorBusy = handleBeforeSubmitPrompt(
      db(),
      { conversation_id: "peer-cur", prompt: "/autopilot-run demo" },
      root,
    );
    expect(cursorBusy.continue).toBe(false);
    expect(typeof cursorBusy.user_message).toBe("string");
    expect(cursorBusy.user_message!.length).toBeGreaterThan(0);
    expect(cursorBusy.user_message).toMatch(/already executing/i);
    expect(cursorBusy.user_message).toMatch(/track:/i);
    expect(cursorBusy.user_message).toMatch(/session:/i);
    expect(cursorBusy.userMessage).toBe(cursorBusy.user_message);
    expect(Object.keys(cursorBusy).sort()).toEqual(
      ["continue", "userMessage", "user_message"].sort(),
    );
    expect(
      isChannelANeedPick({
        ok: false,
        busy: true,
        needPick: true,
        userMessage: "x",
      }),
    ).toBe(false);

    const claudeBusy = handleUserPromptSubmit(
      db(),
      { session_id: "peer-cla", prompt: "/autopilot-run demo" },
      root,
    );
    expect(claudeBusy.decision).toBe("block");
    expect(claudeBusy.reason).toMatch(/already executing/i);
    expect(claudeBusy.continue).toBeUndefined();
    expect(claudeBusy.hookSpecificOutput).toBeUndefined();
    expect(Object.keys(claudeBusy).sort()).toEqual(["decision", "reason"]);
  });

  it("planning peers do not block slug RUN", () => {
    writeChecklist(root, "alpha", `- [ ] a — A\n`);
    writeChecklist(root, "beta", `- [ ] b — B\n`);
    db().upsertSession({
      conversation_id: "plan-a",
      project_root: root,
      code_root: root,
      phase: "planning",
      track_id: "alpha",
      checklist_path: path.join(root, "plans", "alpha", "checklist.md"),
      armed: 0,
      paused: 0,
    });
    db().upsertSession({
      conversation_id: "plan-b",
      project_root: root,
      code_root: root,
      phase: "planning",
      track_id: "beta",
      checklist_path: path.join(root, "plans", "beta", "checklist.md"),
      armed: 0,
      paused: 0,
    });
    const peer = applyRun(db(), "plan-b", root, { slug: "beta" });
    expect(peer.ok).toBe(true);
    if (peer.ok) {
      expect(peer.session.phase).toBe("executing");
      expect(peer.session.armed).toBe(1);
    }
    expect(db().getSession("plan-a")!.phase).toBe("planning");
    expect(db().getSession("plan-a")!.armed).toBe(0);
  });

  it("plans bind: single slug auto-runs; dirty _multi stays needPick", () => {
    writeChecklist(root, "alpha", `- [ ] a — A\n`);
    writeChecklist(root, "beta", `- [ ] b — B\n`);

    notePlansDirEdit(
      db(),
      "dirty",
      root,
      path.join(root, "plans", "alpha", "plan.md"),
    );
    notePlansDirEdit(
      db(),
      "dirty",
      root,
      path.join(root, "plans", "beta", "plan.md"),
    );
    expect(db().getSession("dirty")!.track_id).toBe(MULTI_PLAN_EDIT_TRACK);
    const dirtyRun = applyRun(db(), "dirty", root);
    expect(dirtyRun.ok).toBe(false);
    if (!dirtyRun.ok) {
      expect(dirtyRun.needPick).toBe(true);
      expect(dirtyRun.busy).toBeUndefined();
      expect(isChannelANeedPick(dirtyRun)).toBe(true);
    }
    expect(db().getSession("dirty")!.phase).not.toBe("executing");
    expect(db().getSession("dirty")!.armed).toBe(0);
    expect(db().getSession("dirty")!.pending_action).toBe("run");

    notePlansDirEdit(
      db(),
      "bound",
      root,
      path.join(root, "plans", "alpha", "checklist.md"),
    );
    expect(db().getSession("bound")!.track_id).toBe("alpha");
    const bound = applyRun(db(), "bound", root);
    expect(bound.ok).toBe(true);
    if (bound.ok) {
      expect(bound.session.track_id).toBe("alpha");
      expect(bound.session.phase).toBe("executing");
      expect(bound.session.armed).toBe(1);
    }
  });
});

describe("run-pick-ux matrix skill text (tests-needpick-bind)", () => {
  it("autopilot-run skill templates keep needPick / pick-vs-execute branch", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const templatesSkill = path.resolve(
      here,
      "../../templates/skills/autopilot-run/SKILL.md.tpl",
    );
    const bundledSkill = path.resolve(
      here,
      "../../cli/assets/templates/skills/autopilot-run/SKILL.md.tpl",
    );
    expect(fs.existsSync(templatesSkill)).toBe(true);
    expect(fs.existsSync(bundledSkill)).toBe(true);
    const src = fs.readFileSync(templatesSkill, "utf8");
    const bundled = fs.readFileSync(bundledSkill, "utf8");
    expect(bundled).toBe(src);
    for (const [label, text] of [
      ["templates", src],
      ["cli assets", bundled],
    ] as const) {
      expect(text, label).toMatch(/pick vs execute/i);
      expect(text, label).toMatch(/needPick/);
      expect(text, label).toMatch(/pending_action=run/);
      expect(text, label).toMatch(/This turn's only job/i);
      expect(text, label).not.toMatch(
        /The submit hook has already set phase=executing/i,
      );
    }
  });
});
