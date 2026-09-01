import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyResume,
  migrate,
  parseTrigger,
  StateStore,
} from "../src/index.js";
import { handleBeforeSubmitPrompt } from "../../ports/cursor/src/index.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-resume-claim-"));
}

function writeChecklist(root: string, slug: string, body: string): string {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plan.md"), `# ${slug}\n`);
  const cp = path.join(dir, "checklist.md");
  fs.writeFileSync(cp, body);
  return cp;
}

describe("F-RESUME-CLAIM cross-conversation claim", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const r of roots.splice(0)) {
      fs.rmSync(r, { recursive: true, force: true });
    }
  });

  it("parseTrigger extracts slug from /autopilot-resume <slug>", () => {
    const root = tmpRoot();
    roots.push(root);
    const ev = parseTrigger({
      prompt: "/autopilot-resume admin-pages-smoke-qa",
      conversationId: "c-new",
      projectRoot: root,
    });
    expect(ev?.kind).toBe("resume");
    expect(ev?.slug).toBe("admin-pages-smoke-qa");
  });

  it("parseTrigger extracts slug from text「继续执行 <slug>」", () => {
    const root = tmpRoot();
    roots.push(root);
    const ev = parseTrigger({
      prompt: "继续执行 admin-pages-smoke-qa",
      conversationId: "c-new",
      projectRoot: root,
    });
    expect(ev?.kind).toBe("resume");
    expect(ev?.slug).toBe("admin-pages-smoke-qa");
  });

  it("claims executing session+chain onto new conversation by slug", () => {
    const root = tmpRoot();
    roots.push(root);
    const cp = writeChecklist(
      root,
      "admin-pages-smoke-qa",
      `## Executing\n\n- [x] env-up — done\n- [ ] fix-themes — open\n`,
    );
    const store = new StateStore(root);
    migrate(store.db);
    store.upsertSession({
      conversation_id: "c-old",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "admin-pages-smoke-qa",
      checklist_path: cp,
    });
    store.updateReviewChain("c-old", {
      fix_round: 1,
      confirm_left: 1,
      chain_pending: 0,
      code_edited: 0,
      item_confirm_complete: 0,
      pending_followup: "自审确认 1/5 — 角度",
      pending_followup_at: "2026-08-31T15:00:00.000Z",
    });

    const result = applyResume(store, "c-new", {
      slug: "admin-pages-smoke-qa",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session?.conversation_id).toBe("c-new");
    expect(result.session?.track_id).toBe("admin-pages-smoke-qa");
    expect(result.session?.phase).toBe("executing");
    expect(result.session?.armed).toBe(1);
    expect(store.getSession("c-old")).toBeNull();
    expect(store.getReviewChain("c-old")).toBeNull();
    const chain = store.getReviewChain("c-new")!;
    expect(chain.fix_round).toBe(1);
    expect(chain.confirm_left).toBe(1);
    expect(chain.pending_followup).toBe("自审确认 1/5 — 角度");
  });

  it("claims unique executing session without slug", () => {
    const root = tmpRoot();
    roots.push(root);
    const cp = writeChecklist(
      root,
      "demo",
      `## Executing\n\n- [ ] a — Open\n`,
    );
    const store = new StateStore(root);
    migrate(store.db);
    store.upsertSession({
      conversation_id: "c-old",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      track_id: "demo",
      checklist_path: cp,
    });
    store.updateReviewChain("c-old", { fix_round: 2, confirm_left: null });

    const result = applyResume(store, "c-new");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session?.conversation_id).toBe("c-new");
    expect(store.getSession("c-old")).toBeNull();
    expect(store.getReviewChain("c-new")!.fix_round).toBe(2);
  });

  it("refuses claim without slug when multiple executing sessions", () => {
    const root = tmpRoot();
    roots.push(root);
    const cpA = writeChecklist(root, "alpha", `- [ ] a — Open\n`);
    const cpB = writeChecklist(root, "beta", `- [ ] b — Open\n`);
    const store = new StateStore(root);
    migrate(store.db);
    for (const [cid, slug, cp] of [
      ["c-a", "alpha", cpA],
      ["c-b", "beta", cpB],
    ] as const) {
      store.upsertSession({
        conversation_id: cid,
        project_root: root,
        code_root: root,
        platform: "cursor",
        phase: "executing",
        armed: 1,
        track_id: slug,
        checklist_path: cp,
      });
    }

    const result = applyResume(store, "c-new");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.userMessage).toMatch(/Multiple executing|多个|slug/i);
    expect(store.getSession("c-a")).not.toBeNull();
    expect(store.getSession("c-b")).not.toBeNull();
  });

  it("claims active executing when another same-slug session is only paused", () => {
    const root = tmpRoot();
    roots.push(root);
    const cp = writeChecklist(root, "demo", `- [ ] a — Open\n`);
    const store = new StateStore(root);
    migrate(store.db);
    store.upsertSession({
      conversation_id: "c-active",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "demo",
      checklist_path: cp,
    });
    store.updateReviewChain("c-active", { fix_round: 2, confirm_left: 1 });
    store.upsertSession({
      conversation_id: "c-paused",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 0,
      paused: 1,
      paused_reason: "human_gate",
      track_id: "demo",
      checklist_path: cp,
    });

    const result = applyResume(store, "c-new", { slug: "demo" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session?.conversation_id).toBe("c-new");
    expect(result.session?.track_id).toBe("demo");
    expect(store.getSession("c-active")).toBeNull();
    expect(store.getSession("c-paused")?.phase).toBe("executing");
    expect(store.getReviewChain("c-new")!.fix_round).toBe(2);
  });

  it("bare claim prefers unique active executing over a paused other track", () => {
    const root = tmpRoot();
    roots.push(root);
    const cpA = writeChecklist(root, "alpha", `- [ ] a — Open\n`);
    const cpB = writeChecklist(root, "beta", `- [ ] b — Open\n`);
    const store = new StateStore(root);
    migrate(store.db);
    store.upsertSession({
      conversation_id: "c-active",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "alpha",
      checklist_path: cpA,
    });
    store.upsertSession({
      conversation_id: "c-paused",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 0,
      paused: 1,
      paused_reason: "human_gate",
      track_id: "beta",
      checklist_path: cpB,
    });

    const result = applyResume(store, "c-new");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session?.track_id).toBe("alpha");
    expect(store.getSession("c-paused")?.track_id).toBe("beta");
  });

  it("refuses when only multiple paused executing remain for a slug", () => {
    const root = tmpRoot();
    roots.push(root);
    const cp = writeChecklist(root, "demo", `- [ ] a — Open\n`);
    const store = new StateStore(root);
    migrate(store.db);
    for (const cid of ["c-a", "c-b"] as const) {
      store.upsertSession({
        conversation_id: cid,
        project_root: root,
        code_root: root,
        platform: "cursor",
        phase: "executing",
        armed: 0,
        paused: 1,
        paused_reason: "human_gate",
        track_id: "demo",
        checklist_path: cp,
      });
    }

    const result = applyResume(store, "c-new", { slug: "demo" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.userMessage).toMatch(/paused executing|Leave only one/i);
    expect(store.getSession("c-a")).not.toBeNull();
    expect(store.getSession("c-b")).not.toBeNull();
  });

  it("bare refuse for multiple paused tracks points at slug not pruning", () => {
    const root = tmpRoot();
    roots.push(root);
    const cpA = writeChecklist(root, "alpha", `- [ ] a — Open\n`);
    const cpB = writeChecklist(root, "beta", `- [ ] b — Open\n`);
    const store = new StateStore(root);
    migrate(store.db);
    for (const [cid, slug, cp] of [
      ["c-a", "alpha", cpA],
      ["c-b", "beta", cpB],
    ] as const) {
      store.upsertSession({
        conversation_id: cid,
        project_root: root,
        code_root: root,
        platform: "cursor",
        phase: "executing",
        armed: 0,
        paused: 1,
        paused_reason: "human_gate",
        track_id: slug,
        checklist_path: cp,
      });
    }

    const bare = applyResume(store, "c-new");
    expect(bare.ok).toBe(false);
    if (bare.ok) return;
    expect(bare.userMessage).toMatch(/paused executing/i);
    expect(bare.userMessage).toMatch(/autopilot-resume <slug>/i);
    expect(bare.userMessage).not.toMatch(/leaving only one/i);

    const claimed = applyResume(store, "c-new", { slug: "alpha" });
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    expect(claimed.session?.track_id).toBe("alpha");
    expect(store.getSession("c-b")?.track_id).toBe("beta");
  });

  it("replaces ambient idle session on destination when claiming", () => {
    const root = tmpRoot();
    roots.push(root);
    const cp = writeChecklist(root, "demo", `- [ ] a — Open\n`);
    const store = new StateStore(root);
    migrate(store.db);
    store.upsertSession({
      conversation_id: "c-old",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      paused: 1,
      paused_reason: "human_gate",
      track_id: "demo",
      checklist_path: cp,
    });
    store.updateReviewChain("c-old", { fix_round: 3, confirm_left: 2 });
    store.upsertSession({
      conversation_id: "c-new",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "idle",
      armed: 1,
      track_id: "_pending",
      checklist_path: "",
    });
    store.ensureReviewChain("c-new");

    const result = applyResume(store, "c-new", { slug: "demo" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session?.track_id).toBe("demo");
    expect(result.session?.paused).toBe(0);
    expect(result.session?.armed).toBe(1);
    expect(store.getSession("c-old")).toBeNull();
    expect(store.getReviewChain("c-new")!.fix_round).toBe(3);
    expect(store.getReviewChain("c-new")!.confirm_left).toBe(2);
  });

  it("refuses claim onto destination that already executes a different track", () => {
    const root = tmpRoot();
    roots.push(root);
    const cpOld = writeChecklist(root, "old-track", `- [ ] a — Open\n`);
    const cpNew = writeChecklist(root, "new-track", `- [ ] b — Open\n`);
    const store = new StateStore(root);
    migrate(store.db);
    store.upsertSession({
      conversation_id: "c-old",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      track_id: "old-track",
      checklist_path: cpOld,
    });
    store.upsertSession({
      conversation_id: "c-new",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      track_id: "new-track",
      checklist_path: cpNew,
    });

    const result = applyResume(store, "c-new", { slug: "old-track" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.userMessage).toMatch(/new chat/i);
    expect(result.userMessage).toMatch(/cannot be replaced|OFF only pauses/i);
    expect(result.userMessage).not.toMatch(/OFF here first/i);
    expect(store.getSession("c-old")?.track_id).toBe("old-track");
    expect(store.getSession("c-new")?.track_id).toBe("new-track");
  });

  it("local resume still unpauses without claim", () => {
    const root = tmpRoot();
    roots.push(root);
    const cp = writeChecklist(root, "demo", `- [ ] a — Open\n`);
    const store = new StateStore(root);
    migrate(store.db);
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 0,
      paused: 1,
      paused_reason: "human_gate",
      track_id: "demo",
      checklist_path: cp,
    });
    const result = applyResume(store, "c1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session?.paused).toBe(0);
    expect(result.session?.armed).toBe(1);
  });

  it("refuses claim onto destination that is planning another track", () => {
    const root = tmpRoot();
    roots.push(root);
    const cpOld = writeChecklist(root, "old-track", `- [ ] a — Open\n`);
    const store = new StateStore(root);
    migrate(store.db);
    store.upsertSession({
      conversation_id: "c-old",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      track_id: "old-track",
      checklist_path: cpOld,
    });
    store.upsertSession({
      conversation_id: "c-new",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "planning",
      armed: 0,
      track_id: "new-plan",
      checklist_path: "",
    });

    const result = applyResume(store, "c-new", { slug: "old-track" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.userMessage).toMatch(/planning/i);
    expect(result.userMessage).toMatch(/new chat/i);
    expect(result.userMessage).not.toMatch(/OFF here first/i);
    expect(store.getSession("c-old")?.track_id).toBe("old-track");
    expect(store.getSession("c-new")?.phase).toBe("planning");
  });

  it("refuses claim onto destination with paused executing track", () => {
    const root = tmpRoot();
    roots.push(root);
    const cpOld = writeChecklist(root, "old-track", `- [ ] a — Open\n`);
    const cpNew = writeChecklist(root, "paused-track", `- [ ] b — Open\n`);
    const store = new StateStore(root);
    migrate(store.db);
    store.upsertSession({
      conversation_id: "c-old",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      track_id: "old-track",
      checklist_path: cpOld,
    });
    store.upsertSession({
      conversation_id: "c-new",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 0,
      paused: 1,
      paused_reason: "human_gate",
      track_id: "paused-track",
      checklist_path: cpNew,
    });

    const result = applyResume(store, "c-new", { slug: "old-track" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.userMessage).toMatch(/executing/i);
    expect(result.userMessage).toMatch(/new chat/i);
    expect(result.userMessage).not.toMatch(/OFF here first/i);
    expect(store.getSession("c-new")?.track_id).toBe("paused-track");
    expect(store.getSession("c-old")?.track_id).toBe("old-track");
  });

  it("parseTrigger ignores free-text after resume (no bogus slug)", () => {
    const root = tmpRoot();
    roots.push(root);
    const ev = parseTrigger({
      prompt: "/autopilot-resume please continue",
      conversationId: "c-new",
      projectRoot: root,
    });
    expect(ev?.kind).toBe("resume");
    expect(ev?.slug).toBeUndefined();
  });

  it("parseTrigger passes unsafe single-token resume slug for fail-closed claim", () => {
    const root = tmpRoot();
    roots.push(root);
    const slash = parseTrigger({
      prompt: "/autopilot-resume Foo_Bar",
      conversationId: "c-new",
      projectRoot: root,
    });
    expect(slash?.kind).toBe("resume");
    expect(slash?.slug).toBe("Foo_Bar");

    const text = parseTrigger({
      prompt: "Autopilot RESUME Foo_Bar",
      conversationId: "c-new",
      projectRoot: root,
    });
    expect(text?.kind).toBe("resume");
    expect(text?.slug).toBe("Foo_Bar");
  });

  it("applyResume rejects unsafe slug without claiming", () => {
    const root = tmpRoot();
    roots.push(root);
    const cp = writeChecklist(root, "demo", `- [ ] a — Open\n`);
    const store = new StateStore(root);
    migrate(store.db);
    store.upsertSession({
      conversation_id: "c-old",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      track_id: "demo",
      checklist_path: cp,
    });

    const result = applyResume(store, "c-new", { slug: "Foo_Bar" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.userMessage).toMatch(/Invalid track slug/i);
    expect(store.getSession("c-old")?.track_id).toBe("demo");
    expect(store.getSession("c-new")).toBeNull();
  });

  it("applyResume whitespace-only slug is treated as bare resume", () => {
    const root = tmpRoot();
    roots.push(root);
    const store = new StateStore(root);
    migrate(store.db);
    const result = applyResume(store, "c-new", { slug: "   " });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session).toBeNull();
  });

  it("claims onto destination that is done", () => {
    const root = tmpRoot();
    roots.push(root);
    const cpOld = writeChecklist(root, "demo", `- [ ] a — Open\n`);
    const cpDone = writeChecklist(root, "finished", `- [x] z — Done\n`);
    const store = new StateStore(root);
    migrate(store.db);
    store.upsertSession({
      conversation_id: "c-old",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      track_id: "demo",
      checklist_path: cpOld,
    });
    store.updateReviewChain("c-old", { fix_round: 4, confirm_left: 1 });
    store.upsertSession({
      conversation_id: "c-new",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "done",
      armed: 0,
      track_id: "finished",
      checklist_path: cpDone,
    });

    const result = applyResume(store, "c-new", { slug: "demo" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session?.track_id).toBe("demo");
    expect(result.session?.phase).toBe("executing");
    expect(store.getSession("c-old")).toBeNull();
    expect(store.getReviewChain("c-new")!.fix_round).toBe(4);
  });

  it("refuses claim when slug only matches a done session", () => {
    const root = tmpRoot();
    roots.push(root);
    const cpDone = writeChecklist(root, "demo", `- [x] z — Done\n`);
    const store = new StateStore(root);
    migrate(store.db);
    store.upsertSession({
      conversation_id: "c-old",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "done",
      armed: 0,
      track_id: "demo",
      checklist_path: cpDone,
    });

    const result = applyResume(store, "c-new", { slug: "demo" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.userMessage).toMatch(/already done|autopilot-run/i);
    expect(store.getSession("c-old")?.phase).toBe("done");
  });

  it("claims over idle dest that still has a stale track_id after ambient revive", () => {
    const root = tmpRoot();
    roots.push(root);
    const cpOld = writeChecklist(root, "alive", `- [ ] a — Open\n`);
    const cpStale = writeChecklist(root, "stale", `- [x] z — Done\n`);
    const store = new StateStore(root);
    migrate(store.db);
    store.upsertSession({
      conversation_id: "c-old",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      track_id: "alive",
      checklist_path: cpOld,
    });
    store.updateReviewChain("c-old", { fix_round: 2, confirm_left: 1 });
    // Mimic project-scope revive: idle+armed but track_id left from a prior done track.
    store.upsertSession({
      conversation_id: "c-new",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "idle",
      armed: 1,
      track_id: "stale",
      checklist_path: cpStale,
    });

    const result = applyResume(store, "c-new", { slug: "alive" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session?.track_id).toBe("alive");
    expect(result.session?.phase).toBe("executing");
    expect(store.getSession("c-old")).toBeNull();
    expect(store.getReviewChain("c-new")!.fix_round).toBe(2);
  });

  it("claims executing over local idle with same stale track_id", () => {
    const root = tmpRoot();
    roots.push(root);
    const cpExec = writeChecklist(root, "demo", `- [ ] a — Open\n`);
    const cpStale = writeChecklist(root, "demo-stale", `- [x] z — Done\n`);
    const store = new StateStore(root);
    migrate(store.db);
    store.upsertSession({
      conversation_id: "c-exec",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      track_id: "demo",
      checklist_path: cpExec,
    });
    store.updateReviewChain("c-exec", { fix_round: 5, confirm_left: 2 });
    store.upsertSession({
      conversation_id: "c-idle",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "idle",
      armed: 1,
      track_id: "demo",
      checklist_path: cpStale,
    });

    const result = applyResume(store, "c-idle", { slug: "demo" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session?.phase).toBe("executing");
    expect(result.session?.conversation_id).toBe("c-idle");
    expect(store.getSession("c-exec")).toBeNull();
    expect(store.getReviewChain("c-idle")!.fix_round).toBe(5);
    expect(store.getReviewChain("c-idle")!.confirm_left).toBe(2);
  });

  it("does not insert a ghost session if row vanishes before resume finish", () => {
    const root = tmpRoot();
    roots.push(root);
    const cp = writeChecklist(root, "demo", `- [ ] a — Open\n`);
    const store = new StateStore(root);
    migrate(store.db);
    store.upsertSession({
      conversation_id: "c-old",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      track_id: "demo",
      checklist_path: cp,
    });
    const realClaim = store.claimSessionInto.bind(store);
    store.claimSessionInto = ((toId, opts) => {
      const claimed = realClaim(toId, opts);
      if (claimed.ok && claimed.session) {
        store.purgeSession(toId);
      }
      return claimed;
    }) as typeof store.claimSessionInto;

    const result = applyResume(store, "c-new", { slug: "demo" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.userMessage).toMatch(/concurrently|retry/i);
    expect(store.getSession("c-new")).toBeNull();
    expect(store.getSession("c-old")).toBeNull();
  });

  it("beforeSubmitPrompt resume with slug claims and continues", () => {
    const root = tmpRoot();
    roots.push(root);
    const cp = writeChecklist(root, "demo", `- [ ] a — Open\n`);
    const store = new StateStore(root);
    migrate(store.db);
    store.upsertSession({
      conversation_id: "c-old",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      track_id: "demo",
      checklist_path: cp,
    });
    store.updateReviewChain("c-old", { fix_round: 1, confirm_left: 1 });

    const out = handleBeforeSubmitPrompt(
      store,
      {
        conversation_id: "c-new",
        prompt: "/autopilot-resume demo",
      },
      root,
    );
    expect(out.continue).toBe(true);
    expect(store.getSession("c-new")?.track_id).toBe("demo");
    expect(store.getReviewChain("c-new")!.confirm_left).toBe(1);
    expect(store.getSession("c-old")).toBeNull();
  });

  it("beforeSubmitPrompt blocks unsafe resume slug without claiming", () => {
    const root = tmpRoot();
    roots.push(root);
    const cp = writeChecklist(root, "demo", `- [ ] a — Open\n`);
    const store = new StateStore(root);
    migrate(store.db);
    store.upsertSession({
      conversation_id: "c-old",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      track_id: "demo",
      checklist_path: cp,
    });

    const out = handleBeforeSubmitPrompt(
      store,
      {
        conversation_id: "c-new",
        prompt: "/autopilot-resume Foo_Bar",
      },
      root,
    );
    expect(out.continue).toBe(false);
    expect(out.userMessage).toMatch(/Invalid track slug/i);
    expect(store.getSession("c-old")?.track_id).toBe("demo");
    expect(store.getSession("c-new")).toBeNull();
  });
});
