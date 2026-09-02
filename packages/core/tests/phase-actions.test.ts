import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyReplan,
  applyRun,
  applyTrackPick,
  countUnchecked,
  parseChecklist,
  StateStore,
} from "../src/index.js";
import {
  handleBeforeSubmitPrompt,
} from "../../ports/cursor/src/index.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-run-"));
}

function writeChecklist(root: string, slug: string, body: string): string {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plan.md"), `# ${slug}\n`);
  const cp = path.join(dir, "checklist.md");
  fs.writeFileSync(cp, body);
  return cp;
}

describe("F-RUN applyRun gates", () => {
  let root: string;
  let store: StateStore;

  beforeEach(() => {
    root = tmpRoot();
    store = StateStore.openMemory(root);
  });
  afterEach(() => store.close());

  it("applyRun ignores blank caller projectRoot and uses store root", () => {
    const cp = writeChecklist(root, "demo", `- [ ] a — A\n`);
    const out = applyRun(store, "c1", "   ", { slug: "demo" });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.session.checklist_path).toBe(cp);
      expect(out.session.project_root).toBe(store.projectRoot);
    }
  });

  it("applyRun prefers store.projectRoot over mismatched caller arg", () => {
    const cp = writeChecklist(root, "demo", `- [ ] a — A\n`);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-run-root-"));
    try {
      // Decoy track under outside — must not be selected / written into session.
      writeChecklist(outside, "demo", `- [ ] evil — Evil\n`);
      const out = applyRun(store, "c1", outside, { slug: "demo" });
      expect(out.ok).toBe(true);
      if (out.ok) {
        expect(out.session.checklist_path).toBe(cp);
        expect(out.session.project_root).toBe(store.projectRoot);
        expect(out.session.checklist_path.startsWith(outside)).toBe(false);
      }
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("applyRun refuses plansDir that escapes the project", () => {
    writeChecklist(root, "demo", `- [ ] a — A\n`);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-plans-esc-"));
    try {
      writeChecklist(outside, "demo", `- [ ] evil — Evil\n`);
      const rel = path.relative(root, outside);
      expect(rel.startsWith("..")).toBe(true);
      const out = applyRun(store, "c1", root, {
        slug: "demo",
        config: { plansDir: rel },
      });
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.userMessage).toMatch(/Invalid plans directory/i);
      expect(applyRun(store, "c1", root, {
        slug: "demo",
        config: { plansDir: "/tmp/absolute-plans" },
      }).ok).toBe(false);
      expect(applyRun(store, "c1", root, {
        slug: "demo",
        config: { plansDir: "plans/../../etc" },
      }).ok).toBe(false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("enters executing when slug + checklist ready", () => {
    const cp = writeChecklist(root, "demo", `- [ ] a — A\n`);
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "planning",
      track_id: "demo",
      checklist_path: cp,
      armed: 0,
      paused: 0,
    });
    const r = applyRun(store, "c1", root, { slug: "demo" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.session.phase).toBe("executing");
      expect(r.session.armed).toBe(1);
      expect(r.session.paused).toBe(0);
      expect(r.session.track_id).toBe("demo");
      expect(r.session.checklist_path).toBe(cp);
    }
  });

  it("applyRun from planning resets review chain including stale pending", () => {
    const cp = writeChecklist(root, "demo", `- [ ] a — A\n`);
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "planning",
      track_id: "demo",
      checklist_path: cp,
      armed: 0,
      paused: 0,
    });
    store.updateReviewChain("c1", {
      fix_round: 9,
      confirm_left: 2,
      chain_pending: 1,
      code_edited: 1,
      item_confirm_complete: 1,
      pending_followup: "全部完成。自审确认已干净通过",
      pending_followup_at: new Date().toISOString(),
      pending_redeliver_at: new Date().toISOString(),
    });
    const r = applyRun(store, "c1", root, { slug: "demo" });
    expect(r.ok).toBe(true);
    const chain = store.getReviewChain("c1")!;
    expect(chain.fix_round).toBe(0);
    expect(chain.confirm_left).toBeNull();
    expect(chain.chain_pending).toBe(0);
    expect(chain.code_edited).toBe(0);
    expect(chain.item_confirm_complete).toBe(0);
    expect(chain.pending_followup).toBeNull();
    expect(chain.pending_followup_at).toBeNull();
    expect(chain.pending_redeliver_at).toBeNull();
    expect(chain.reviewing_item_id).toBe("a");
  });

  it("idempotent re-RUN while executing preserves chain_pending (F-E8)", () => {
    const cp = writeChecklist(root, "demo", `- [ ] a — A\n`);
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "executing",
      track_id: "demo",
      checklist_path: cp,
      armed: 1,
      paused: 0,
    });
    store.updateReviewChain("c1", {
      chain_pending: 1,
      confirm_left: 2,
      pending_followup: "Review confirm 1/5",
    });
    const r = applyRun(store, "c1", root, { slug: "demo" });
    expect(r.ok).toBe(true);
    const chain = store.getReviewChain("c1")!;
    expect(chain.chain_pending).toBe(1);
    expect(chain.confirm_left).toBe(2);
    expect(chain.pending_followup).toBe("Review confirm 1/5");
  });

  it("idempotent re-RUN preserves chain when stored checklist_path is relative", () => {
    writeChecklist(root, "demo", `- [ ] a — A\n`);
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "executing",
      track_id: "demo",
      // Relative spelling — must still match absolute checklistPathFor rebuild.
      checklist_path: "plans/demo/checklist.md",
      armed: 1,
      paused: 0,
    });
    store.updateReviewChain("c1", {
      chain_pending: 1,
      confirm_left: 2,
      pending_followup: "Review confirm relative-path",
    });
    const r = applyRun(store, "c1", root, { slug: "demo" });
    expect(r.ok).toBe(true);
    const chain = store.getReviewChain("c1")!;
    expect(chain.chain_pending).toBe(1);
    expect(chain.confirm_left).toBe(2);
    expect(chain.pending_followup).toBe("Review confirm relative-path");
  });

  it("RUN switching track while executing resets review chain (no cross-track leak)", () => {
    const cpA = writeChecklist(root, "alpha", `- [ ] a — A\n`);
    const cpB = writeChecklist(root, "beta", `- [ ] b — B\n`);
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "executing",
      track_id: "alpha",
      checklist_path: cpA,
      armed: 1,
      paused: 0,
    });
    store.updateReviewChain("c1", {
      fix_round: 4,
      chain_pending: 1,
      confirm_left: 2,
      code_edited: 1,
      item_confirm_complete: 1,
      pending_followup: "Review confirm for alpha",
      pending_followup_at: new Date().toISOString(),
    });
    const r = applyRun(store, "c1", root, { slug: "beta" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.session.track_id).toBe("beta");
      expect(r.session.checklist_path).toBe(cpB);
    }
    const chain = store.getReviewChain("c1")!;
    expect(chain.fix_round).toBe(0);
    expect(chain.confirm_left).toBeNull();
    expect(chain.chain_pending).toBe(0);
    expect(chain.code_edited).toBe(0);
    expect(chain.item_confirm_complete).toBe(0);
    expect(chain.pending_followup).toBeNull();
  });

  it("RUN same slug but different checklist_path resets review chain", () => {
    const cpDefault = writeChecklist(root, "demo", `- [ ] a — A\n`);
    const altDir = path.join(root, "docs", "plans", "demo");
    fs.mkdirSync(altDir, { recursive: true });
    fs.writeFileSync(path.join(altDir, "plan.md"), `# demo\n`);
    const cpAlt = path.join(altDir, "checklist.md");
    fs.writeFileSync(cpAlt, `- [ ] a — A\n`);
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "executing",
      track_id: "demo",
      checklist_path: cpDefault,
      armed: 1,
      paused: 0,
    });
    store.updateReviewChain("c1", {
      chain_pending: 1,
      confirm_left: 3,
      pending_followup: "stale for plans/",
    });
    const r = applyRun(store, "c1", root, {
      slug: "demo",
      config: { plansDir: "docs/plans" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.session.checklist_path).toBe(cpAlt);
    }
    const chain = store.getReviewChain("c1")!;
    expect(chain.chain_pending).toBe(0);
    expect(chain.confirm_left).toBeNull();
    expect(chain.pending_followup).toBeNull();
  });

  it("rejects _pending / missing checklist without writing executing", () => {
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "planning",
      track_id: "_pending",
      checklist_path: "",
      armed: 0,
      paused: 0,
    });
    const r = applyRun(store, "c1", root);
    expect(r.ok).toBe(false);
    expect(store.getSession("c1")!.phase).toBe("planning");
    expect(store.getSession("c1")!.armed).toBe(0);
  });

  it("multi runnable → pending_action=run, does not arm executing", () => {
    writeChecklist(root, "alpha", `- [ ] a — A\n`);
    writeChecklist(root, "beta", `- [ ] b — B\n`);
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "planning",
      track_id: "_pending",
      checklist_path: "",
      armed: 0,
      paused: 0,
    });
    const r = applyRun(store, "c1", root);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.needPick).toBe(true);
    }
    const s = store.getSession("c1")!;
    expect(s.phase).toBe("planning");
    expect(s.armed).toBe(0);
    expect(s.pending_action).toBe("run");
    expect(s.track_candidates_json).toBeTruthy();

    const picked = applyTrackPick(store, "c1", root, "1");
    expect(picked.ok).toBe(true);
    if (picked.ok) {
      expect(picked.session.phase).toBe("executing");
      expect(picked.session.armed).toBe(1);
      expect(picked.session.pending_action).toBeNull();
      expect(picked.session.track_candidates_json).toBeNull();
      expect(["alpha", "beta"]).toContain(picked.session.track_id);
    }
  });

  it("one_executor blocks second armed executing session", () => {
    const cp = writeChecklist(root, "demo", `- [ ] a — A\n`);
    store.upsertSession({
      conversation_id: "busy",
      project_root: root,
      code_root: root,
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "demo",
      checklist_path: cp,
    });
    store.upsertSession({
      conversation_id: "c2",
      project_root: root,
      code_root: root,
      phase: "planning",
      track_id: "demo",
      checklist_path: cp,
      armed: 0,
      paused: 0,
    });
    const r = applyRun(store, "c2", root, { slug: "demo" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.userMessage).toMatch(/already executing/i);
    }
    expect(store.getSession("c2")!.phase).toBe("planning");
  });

  it("exclusiveWrite rolls back when commit=false (no dirty session)", () => {
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "planning",
      track_id: "_pending",
      checklist_path: "",
      armed: 0,
      paused: 0,
    });
    store.exclusiveWrite(() => {
      store.upsertSession({
        conversation_id: "c1",
        project_root: root,
        code_root: root,
        phase: "executing",
        armed: 1,
        track_id: "should-not-stick",
      });
      return { commit: false, value: null };
    });
    const s = store.getSession("c1")!;
    expect(s.phase).toBe("planning");
    expect(s.armed).toBe(0);
    expect(s.track_id).toBe("_pending");
  });

  it("exclusiveWrite rejects nesting", () => {
    expect(() =>
      store.exclusiveWrite(() => {
        store.exclusiveWrite(() => ({ commit: true, value: null }));
        return { commit: true, value: null };
      }),
    ).toThrow(/nesting/i);
  });

  it("rejects path-traversal slug", () => {
    const r = applyRun(store, "c1", root, { slug: "../etc" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.userMessage).toMatch(/invalid track slug/i);
    }
  });

  it("track_pick rejects non-array candidates JSON without throwing", () => {
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "planning",
      pending_action: "run",
      track_candidates_json: "null",
      armed: 0,
      paused: 0,
    });
    const r = applyTrackPick(store, "c1", root, "1");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.userMessage).toMatch(/invalid track candidates/i);
    }
  });

  it("track_pick rejects empty candidates JSON", () => {
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "planning",
      pending_action: "run",
      track_candidates_json: "[]",
      armed: 0,
      paused: 0,
    });
    const r = applyTrackPick(store, "c1", root, "demo");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.userMessage).toMatch(/invalid track candidates/i);
    }
    expect(store.getSession("c1")!.pending_action).toBe("run");
  });

  it("track_pick rejects candidates with no safe slug", () => {
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "planning",
      pending_action: "run",
      track_candidates_json: JSON.stringify([null, { slug: "../x" }, {}]),
      armed: 0,
      paused: 0,
    });
    const r = applyTrackPick(store, "c1", root, "1");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.userMessage).toMatch(/invalid track candidates/i);
    }
  });

  it("track_pick rejects unknown pending_action", () => {
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "planning",
      pending_action: "weird",
      track_candidates_json: JSON.stringify([{ slug: "demo" }]),
      armed: 0,
      paused: 0,
    });
    const r = applyTrackPick(store, "c1", root, "1");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.userMessage).toMatch(/unknown pending action/i);
    }
  });

  it("track_pick keeps pending when nested applyRun fails (retry-safe)", () => {
    writeChecklist(root, "alpha", `- [ ] a — A\n`);
    writeChecklist(root, "beta", `- [ ] b — B\n`);
    store.upsertSession({
      conversation_id: "busy",
      project_root: root,
      code_root: root,
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "alpha",
      checklist_path: path.join(root, "plans", "alpha", "checklist.md"),
    });
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "planning",
      track_id: "_pending",
      checklist_path: "",
      armed: 0,
      paused: 0,
      pending_action: "run",
      track_candidates_json: JSON.stringify([
        { slug: "alpha", title: "A" },
        { slug: "beta", title: "B" },
      ]),
    });

    const r = applyTrackPick(store, "c1", root, "1");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.userMessage).toMatch(/already executing/i);
    }
    const s = store.getSession("c1")!;
    expect(s.pending_action).toBe("run");
    expect(s.track_candidates_json).toBeTruthy();
    expect(s.phase).toBe("planning");
    expect(s.armed).toBe(0);
  });
});

describe("F-REPLAN", () => {
  it("resets review chain, phase=planning, keeps checklist [x]", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    const cp = writeChecklist(
      root,
      "demo",
      `- [x] done-item — Done\n- [ ] next — Next\n`,
    );
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "demo",
      checklist_path: cp,
    });
    store.updateReviewChain("c1", {
      fix_round: 3,
      confirm_left: 2,
      chain_pending: 1,
      code_edited: 1,
      item_confirm_complete: 1,
      pending_followup: "Review confirm 1/5 stale",
      pending_followup_at: new Date().toISOString(),
      pending_redeliver_at: new Date().toISOString(),
    });

    const r = applyReplan(store, "c1", root, { slug: "demo" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.session.phase).toBe("planning");
      expect(r.session.armed).toBe(0);
      expect(r.session.paused).toBe(0);
      expect(r.session.track_id).toBe("demo");
    }
    const chain = store.getReviewChain("c1")!;
    expect(chain.fix_round).toBe(0);
    expect(chain.confirm_left).toBeNull();
    expect(chain.chain_pending).toBe(0);
    expect(chain.code_edited).toBe(0);
    expect(chain.item_confirm_complete).toBe(0);
    expect(chain.pending_followup).toBeNull();
    expect(chain.pending_followup_at).toBeNull();
    expect(chain.pending_redeliver_at).toBeNull();

    const cl = parseChecklist(cp);
    expect(cl.items.find((i) => i.id === "done-item")?.checked).toBe(true);
    expect(countUnchecked(cl)).toBe(1);
    store.close();
  });

  it("applyReplan discards checklist_path that escapes the project", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    const cp = writeChecklist(root, "demo", `- [ ] a — A\n`);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-replan-"));
    try {
      const evil = path.join(outside, "checklist.md");
      fs.writeFileSync(evil, `- [ ] evil — Evil\n`);
      store.upsertSession({
        conversation_id: "c1",
        project_root: root,
        code_root: root,
        phase: "executing",
        armed: 1,
        paused: 0,
        track_id: "demo",
        checklist_path: evil,
      });
      const r = applyReplan(store, "c1", root, { slug: "demo" });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.session.checklist_path).toBe(cp);
        expect(r.session.checklist_path).not.toBe(evil);
      }
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
    store.close();
  });

  it("applyReplan keeps in-project relative checklist_path when file is missing", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    writeChecklist(root, "demo", `- [ ] a — A\n`);
    // Missing sibling path — lexical allow branch (exercises isLexicallyInsideProject import).
    const missingRel = "plans/demo/not-yet.md";
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "demo",
      checklist_path: missingRel,
    });
    const r = applyReplan(store, "c1", root, { slug: "demo" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.session.checklist_path).toBe(missingRel);
    }
    store.close();
  });
});

describe("F-HOOK run / one_executor via port-cursor", () => {
  it("RUN fail-closed and one_executor busy via submit hook", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);

    // no plans at all → fail closed
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "planning",
      track_id: "_pending",
      checklist_path: "",
      armed: 0,
      paused: 0,
    });
    const empty = handleBeforeSubmitPrompt(
      store,
      { conversation_id: "c1", prompt: "/autopilot-run" },
      root,
    );
    expect(empty.continue).toBe(false);
    expect(empty.userMessage).toMatch(/no runnable/i);

    const cp = writeChecklist(root, "demo", `- [ ] a — A\n`);

    // success path with explicit slug
    const ok = handleBeforeSubmitPrompt(
      store,
      { conversation_id: "c1", prompt: "/autopilot-run demo" },
      root,
    );
    expect(ok.continue).toBe(true);
    expect(store.getSession("c1")!.phase).toBe("executing");
    expect(store.getSession("c1")!.armed).toBe(1);

    // second session blocked
    store.upsertSession({
      conversation_id: "c2",
      project_root: root,
      code_root: root,
      phase: "planning",
      track_id: "demo",
      checklist_path: cp,
      armed: 0,
      paused: 0,
    });
    const blocked = handleBeforeSubmitPrompt(
      store,
      { conversation_id: "c2", prompt: "Autopilot RUN · demo" },
      root,
    );
    expect(blocked.continue).toBe(false);
    expect(blocked.userMessage).toMatch(/already executing/i);
    store.close();
  });
});
