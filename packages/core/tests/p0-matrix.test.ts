import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyOff,
  applyOn,
  applyResume,
  applyResumeReview,
  canEnterExecuting,
  countUnchecked,
  evaluateVerifyReport,
  firstUnchecked,
  isHarnessFollowupMessage,
  isLastUnchecked,
  isProductCodeEdit,
  isRunnableTrack,
  listTracks,
  migrate,
  parseChecklist,
  parseTrigger,
  ReviewEngine,
  StateStore,
  type FollowupAction,
} from "../src/index.js";
import {
  handleAfterFileEdit,
  handleBeforeSubmitPrompt,
  handleStop,
} from "../../ports/cursor/src/index.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-p0-"));
}

function writeChecklist(root: string, slug: string, body: string): string {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plan.md"), `# ${slug}\n`);
  const cp = path.join(dir, "checklist.md");
  fs.writeFileSync(cp, body);
  return cp;
}

function sessionExecuting(
  store: StateStore,
  root: string,
  cid: string,
  checklistPath: string,
  opts?: { armed?: number; paused?: number; paused_reason?: string | null },
) {
  return store.upsertSession({
    conversation_id: cid,
    project_root: root,
    code_root: root,
    platform: "cursor",
    phase: "executing",
    armed: opts?.armed ?? 1,
    paused: opts?.paused ?? 0,
    paused_reason: opts?.paused_reason ?? null,
    track_id: "demo",
    checklist_path: checklistPath,
  });
}

function engine(store: StateStore, root: string, overrides?: Partial<ConstructorParameters<typeof ReviewEngine>[1]>) {
  return new ReviewEngine(store, {
    confirmRounds: 5,
    verifyEnabled: false,
    verifyCommands: [],
    maxIdleStops: 5,
    projectRoot: root,
    ...overrides,
  });
}

function stop(
  eng: ReviewEngine,
  cid: string,
  loopCount = 1,
): FollowupAction | null {
  return eng.handleStop({ conversationId: cid, status: "completed", loopCount });
}

describe("F-CM ChecklistMd", () => {
  it("parses id — title and slugifies without separator", () => {
    const root = tmpRoot();
    const cp = writeChecklist(
      root,
      "demo",
      `## Executing\n\n- [ ] add-model — Add Comment model\n- [ ] UI component without sep\n- [x] done-item — Done\n`,
    );
    const cl = parseChecklist(cp);
    expect(cl.items).toHaveLength(3);
    expect(cl.items[0]!.id).toBe("add-model");
    expect(cl.items[0]!.idFromSeparator).toBe(true);
    expect(cl.items[1]!.id).toBe("ui-component-without-sep");
    expect(cl.items[1]!.idFromSeparator).toBe(false);
    expect(countUnchecked(cl)).toBe(2);
    expect(firstUnchecked(cl)!.id).toBe("add-model");
    expect(isLastUnchecked(cl)).toBe(false);
  });
});

describe("F-VR verify-report", () => {
  it("fails on missing/bad/mismatch; skips when no required", () => {
    const root = tmpRoot();
    const cp = writeChecklist(root, "demo", `- [ ] item-a — A\n`);
    const item = firstUnchecked(parseChecklist(cp))!;
    const reportPath = path.join(root, ".autopilot", "verify-last.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });

    expect(
      evaluateVerifyReport({
        enabled: false,
        commands: [{ id: "test", required: true }],
        reportPath,
        currentItem: item,
        checklistPath: cp,
      }).outcome,
    ).toBe("skip");

    expect(
      evaluateVerifyReport({
        enabled: true,
        commands: [{ id: "test", required: false }],
        reportPath,
        currentItem: item,
        checklistPath: cp,
      }).outcome,
    ).toBe("skip");

    expect(
      evaluateVerifyReport({
        enabled: true,
        commands: [{ id: "test", required: true }],
        reportPath,
        currentItem: item,
        checklistPath: cp,
      }).outcome,
    ).toBe("fail");

    fs.writeFileSync(reportPath, "{not json");
    expect(
      evaluateVerifyReport({
        enabled: true,
        commands: [{ id: "test", required: true }],
        reportPath,
        currentItem: item,
        checklistPath: cp,
      }).outcome,
    ).toBe("fail");

    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        itemId: "wrong",
        checklistPath: cp,
        ranAt: new Date().toISOString(),
        commands: [{ id: "test", exitCode: 0 }],
      }),
    );
    expect(
      evaluateVerifyReport({
        enabled: true,
        commands: [{ id: "test", required: true }],
        reportPath,
        currentItem: item,
        checklistPath: cp,
      }).reason,
    ).toBe("itemId mismatch");

    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        itemId: "item-a",
        checklistPath: cp,
        ranAt: new Date().toISOString(),
        commands: [{ id: "test" }],
      }),
    );
    expect(
      evaluateVerifyReport({
        enabled: true,
        commands: [{ id: "test", required: true }],
        reportPath,
        currentItem: item,
        checklistPath: cp,
      }).reason,
    ).toMatch(/exitCode/);

    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        itemId: "item-a",
        checklistPath: cp,
        ranAt: new Date().toISOString(),
      }),
    );
    expect(
      evaluateVerifyReport({
        enabled: true,
        commands: [{ id: "test", required: true }],
        reportPath,
        currentItem: item,
        checklistPath: cp,
      }).reason,
    ).toMatch(/commands/);

    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        itemId: "item-a",
        checklistPath: cp,
        ranAt: new Date().toISOString(),
        commands: [null, { id: "test", exitCode: NaN }],
      }),
    );
    expect(
      evaluateVerifyReport({
        enabled: true,
        commands: [{ id: "test", required: true }],
        reportPath,
        currentItem: item,
        checklistPath: cp,
      }).reason,
    ).toMatch(/exitCode/);
  });
});

describe("F-CED code-edit-detector", () => {
  it("excludes plans/docs/md/autopilot; includes .ts", () => {
    expect(isProductCodeEdit("plans/foo/checklist.md")).toBe(false);
    expect(isProductCodeEdit("docs/readme.md")).toBe(false);
    expect(isProductCodeEdit(".autopilot/config.yml")).toBe(false);
    expect(isProductCodeEdit(".cursor/hooks.json")).toBe(false);
    expect(isProductCodeEdit("README.md")).toBe(false);
    expect(isProductCodeEdit("src/index.ts")).toBe(true);
    expect(isProductCodeEdit("package.json")).toBe(true);
  });

  it("treats common non-JS languages as product code", () => {
    expect(isProductCodeEdit("lib/main.dart")).toBe(true);
    expect(isProductCodeEdit("src/Main.scala")).toBe(true);
    expect(isProductCodeEdit("lib/app.ex")).toBe(true);
    expect(isProductCodeEdit("src/App.vue")).toBe(true);
    expect(isProductCodeEdit("infra/main.tf")).toBe(true);
    expect(isProductCodeEdit("api/schema.proto")).toBe(true);
    expect(isProductCodeEdit("Cargo.toml")).toBe(true);
    expect(isProductCodeEdit("services/config.yaml")).toBe(true);
  });
});

describe("F-MIG migrate", () => {
  it("empty db runs 001 → version 1; migrate is idempotent", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    expect(store.getSchemaVersion()).toBe(1);
    expect(migrate(store.db)).toBe(1);
    expect(store.getSchemaVersion()).toBe(1);
    store.close();
  });
});

describe("review-engine P0 matrix", () => {
  let root: string;
  let store: StateStore;
  let cp: string;

  beforeEach(() => {
    root = tmpRoot();
    store = StateStore.openMemory(root);
    cp = writeChecklist(
      root,
      "demo",
      `- [ ] item-a — First\n- [ ] item-b — Second\n`,
    );
    sessionExecuting(store, root, "c1", cp);
    store.ensureReviewChain("c1");
  });

  afterEach(() => {
    store.close();
  });

  it("F-E3E4: five confirms, no duplicate 1/5; E3 sets left=rounds-1", () => {
    const eng = engine(store, root);
    store.updateReviewChain("c1", { chain_pending: 1, confirm_left: null, code_edited: 0 });
    const confirms: number[] = [];
    const a1 = stop(eng, "c1");
    expect(a1?.kind).toMatch(/confirm/);
    expect(a1?.meta?.n).toBe(1);
    confirms.push(a1!.meta!.n as number);
    expect(store.getReviewChain("c1")!.confirm_left).toBe(4);

    for (let i = 0; i < 4; i++) {
      const a = stop(eng, "c1");
      expect(a?.kind).toMatch(/confirm/);
      confirms.push(a!.meta!.n as number);
    }
    expect(confirms).toEqual([1, 2, 3, 4, 5]);
    expect(store.getReviewChain("c1")!.confirm_left).toBe(0);
  });

  it("F-E4E5: E4 1→0 does not advance same stop; next stop E5", () => {
    const eng = engine(store, root);
    store.updateReviewChain("c1", {
      confirm_left: 1,
      chain_pending: 1,
      code_edited: 0,
      item_confirm_complete: 0,
    });
    const a = stop(eng, "c1");
    expect(a?.kind).toBe("review.confirm_final");
    expect(a?.meta?.n).toBe(5);
    expect(store.getReviewChain("c1")!.confirm_left).toBe(0);
    // same chain state would advance on NEXT stop
    const b = stop(eng, "c1");
    expect(b?.kind).toBe("advance");
  });

  it("F-NULL: confirm_left NULL does not enter E5", () => {
    const eng = engine(store, root);
    store.updateReviewChain("c1", {
      confirm_left: null,
      chain_pending: 0,
      code_edited: 0,
      fix_round: 0,
      item_confirm_complete: 0,
    });
    // loopCount 0 and no pending → E0
    expect(eng.handleStop({ conversationId: "c1", status: "completed", loopCount: 0 })).toBeNull();
  });

  it("F-ICC: E5c FAIL sets item_confirm_complete; fix skips E3; PASS advances", () => {
    const reportPath = path.join(root, ".autopilot", "verify-last.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    const eng = engine(store, root, {
      verifyEnabled: true,
      verifyCommands: [{ id: "test", required: true }],
      verifyReportPath: reportPath,
    });
    store.updateReviewChain("c1", { confirm_left: 0, code_edited: 0 });
    const fail = stop(eng, "c1");
    expect(fail?.kind).toBe("verify_fix");
    expect(store.getReviewChain("c1")!.item_confirm_complete).toBe(1);

    // code edit → E2 fix; preserves ICC
    store.markCodeEdited("c1");
    const fix = stop(eng, "c1");
    expect(fix?.kind).toBe("review.fix");
    expect(store.getReviewChain("c1")!.item_confirm_complete).toBe(1);
    expect(store.getReviewChain("c1")!.confirm_left).toBeNull();

    // next stop with ICC=1 and confirm_left NULL → E5 (skip E3), still fail
    const again = stop(eng, "c1");
    expect(again?.kind).toBe("verify_fix");

    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        itemId: "item-a",
        checklistPath: cp,
        ranAt: new Date().toISOString(),
        commands: [{ id: "test", exitCode: 0 }],
      }),
    );
    const pass = stop(eng, "c1");
    expect(pass?.kind).toBe("advance");
    expect(store.getReviewChain("c1")!.item_confirm_complete).toBe(0);
  });

  it("F-LAST: countUnchecked===1 → done; >1 → advance", () => {
    const eng = engine(store, root);
    store.updateReviewChain("c1", { confirm_left: 0, code_edited: 0 });
    expect(stop(eng, "c1")?.kind).toBe("advance");

    const cp2 = writeChecklist(root, "last", `- [ ] only — One\n`);
    sessionExecuting(store, root, "c2", cp2);
    store.ensureReviewChain("c2");
    store.updateReviewChain("c2", { confirm_left: 0, code_edited: 0 });
    const eng2 = engine(store, root);
    expect(stop(eng2, "c2")?.kind).toBe("done");
    expect(store.getSession("c2")!.phase).toBe("done");
    expect(store.getSession("c2")!.armed).toBe(0);
  });

  it("F-ARM: paused or armed=0 → no inject", () => {
    const eng = engine(store, root);
    store.updateReviewChain("c1", { confirm_left: 3, chain_pending: 1 });
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      armed: 0,
    });
    expect(stop(eng, "c1")).toBeNull();

    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      armed: 1,
      paused: 1,
      paused_reason: "human_gate",
    });
    expect(stop(eng, "c1")).toBeNull();
  });

  it("F-ERR: error×3 → repeated_errors; completed/RESUME clear error_count", () => {
    const eng = engine(store, root);
    eng.handleStop({ conversationId: "c1", status: "error", loopCount: 0 });
    eng.handleStop({ conversationId: "c1", status: "error", loopCount: 0 });
    expect(store.getSession("c1")!.error_count).toBe(2);
    eng.handleStop({ conversationId: "c1", status: "error", loopCount: 0 });
    expect(store.getSession("c1")!.paused).toBe(1);
    expect(store.getSession("c1")!.paused_reason).toBe("repeated_errors");
    expect(store.getSession("c1")!.armed).toBe(0);

    applyResume(store, "c1");
    expect(store.getSession("c1")!.error_count).toBe(0);
    expect(store.getSession("c1")!.paused).toBe(0);
    expect(store.getSession("c1")!.armed).toBe(1);

    eng.handleStop({ conversationId: "c1", status: "error", loopCount: 0 });
    store.updateReviewChain("c1", { code_edited: 1 });
    stop(eng, "c1"); // completed fix → noteCompletedOk
    expect(store.getSession("c1")!.error_count).toBe(0);
  });

  it("F-ITEM: E5b advance zeroes error_count", () => {
    const eng = engine(store, root);
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      error_count: 2,
    });
    store.updateReviewChain("c1", { confirm_left: 0, code_edited: 0 });
    expect(stop(eng, "c1")?.kind).toBe("advance");
    expect(store.getSession("c1")!.error_count).toBe(0);
  });

  it("F-STUCK: repeated E5c FAIL → stuck + followup.stuck", () => {
    const reportPath = path.join(root, ".autopilot", "verify-last.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    const eng = engine(store, root, {
      verifyEnabled: true,
      verifyCommands: [{ id: "test", required: true }],
      verifyReportPath: reportPath,
      maxIdleStops: 3,
    });
    store.updateReviewChain("c1", { confirm_left: 0, code_edited: 0 });
    expect(stop(eng, "c1")?.kind).toBe("verify_fix");
    expect(stop(eng, "c1")?.kind).toBe("verify_fix");
    const stuck = stop(eng, "c1");
    expect(stuck?.kind).toBe("stuck");
    expect(store.getSession("c1")!.paused_reason).toBe("stuck");
    expect(store.getSession("c1")!.armed).toBe(0);
  });
});

describe("F-OFF / F-OFF-DONE / F-ON", () => {
  let root: string;
  let store: StateStore;
  let cp: string;

  beforeEach(() => {
    root = tmpRoot();
    store = StateStore.openMemory(root);
    cp = writeChecklist(root, "demo", `- [ ] a — A\n`);
  });
  afterEach(() => store.close());

  it("F-OFF: executing OFF keeps phase, sets paused+human_gate; review unchanged", () => {
    sessionExecuting(store, root, "c1", cp);
    store.updateReviewChain("c1", {
      confirm_left: 3,
      fix_round: 2,
      chain_pending: 1,
      item_confirm_complete: 0,
    });
    applyOff(store, "c1");
    const s = store.getSession("c1")!;
    expect(s.phase).toBe("executing");
    expect(s.paused).toBe(1);
    expect(s.armed).toBe(0);
    expect(s.paused_reason).toBe("human_gate");
    const r = store.getReviewChain("c1")!;
    expect(r.confirm_left).toBe(3);
    expect(r.fix_round).toBe(2);
    expect(r.chain_pending).toBe(1);

    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "planning",
      paused: 0,
      paused_reason: null,
      armed: 0,
    });
    applyOff(store, "c1");
    expect(store.getSession("c1")!.paused_reason).toBeNull();

    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "executing",
      paused: 1,
      paused_reason: "stuck",
      armed: 0,
    });
    applyOff(store, "c1");
    expect(store.getSession("c1")!.paused_reason).toBe("stuck");
  });

  it("F-OFF-DONE: done OFF → idle, not paused", () => {
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "done",
      armed: 0,
      paused: 0,
      track_id: "demo",
      checklist_path: cp,
    });
    applyOff(store, "c1");
    const s = store.getSession("c1")!;
    expect(s.phase).toBe("idle");
    expect(s.paused).toBe(0);
  });

  it("F-ON: executing (incl paused) fail-closed; done → planning", () => {
    sessionExecuting(store, root, "c1", cp, { armed: 0, paused: 1, paused_reason: "human_gate" });
    const bad = applyOn(store, "c1", root);
    expect(bad.ok).toBe(false);

    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "done",
      armed: 0,
      paused: 0,
    });
    const ok = applyOn(store, "c1", root);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.session.phase).toBe("planning");
      expect(ok.session.paused).toBe(0);
    }
  });
});

describe("F-RUN / F-E8 triggers + list-tracks", () => {
  it("F-RUN: runnable includes planning; _pending without checklist rejects RUN", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    writeChecklist(root, "auth", `- [ ] a — A\n`);
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "planning",
      track_id: "auth",
      checklist_path: path.join(root, "plans", "auth", "checklist.md"),
      armed: 0,
      paused: 0,
    });
    const runnable = listTracks(root, store, "runnable");
    expect(runnable.some((t) => t.slug === "auth")).toBe(true);
    expect(isRunnableTrack(runnable[0]!)).toBe(true);

    expect(
      canEnterExecuting({ slug: "_pending", checklistPath: "", paused: false }).ok,
    ).toBe(false);
    store.close();
  });

  it("F-E8: RUN/ON do not clear chain; normal message clears chain_pending", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    const cp = writeChecklist(root, "demo", `- [ ] a — A\n`);
    sessionExecuting(store, root, "c1", cp);
    store.updateReviewChain("c1", { chain_pending: 1, confirm_left: 2 });

    handleBeforeSubmitPrompt(
      store,
      { conversation_id: "c1", prompt: "Autopilot RUN · demo" },
      root,
    );
    expect(store.getReviewChain("c1")!.chain_pending).toBe(1);

    handleBeforeSubmitPrompt(
      store,
      { conversation_id: "c1", prompt: "hello world ordinary chat" },
      root,
    );
    expect(store.getReviewChain("c1")!.chain_pending).toBe(0);

    expect(isHarnessFollowupMessage("Review fix round 1: ...")).toBe(true);
    expect(isHarnessFollowupMessage("Briefly inform the user about the task result.继续")).toBe(true);
    expect(isHarnessFollowupMessage("自审确认 1/5 — 角度")).toBe(true);
    expect(isHarnessFollowupMessage("恢复一下备份")).toBe(false);
    expect(
      isHarnessFollowupMessage(
        "<user_query>\nBriefly inform the user about the task result.继续\n</user_query>",
      ),
    ).toBe(true);
    expect(
      isHarnessFollowupMessage(
        "<user_query>\n<timestamp>Saturday, Aug 29, 2026, 8:14 PM (UTC+8)</timestamp>\nBriefly inform the user about the task result.继续\n</user_query>",
      ),
    ).toBe(true);
    expect(parseTrigger({ prompt: "/autopilot-on build comments", conversationId: "c1", projectRoot: root })?.kind).toBe("on");

    // E8: usage-limit continue must not clear chain_pending
    store.updateReviewChain("c1", { chain_pending: 1 });
    handleBeforeSubmitPrompt(
      store,
      { conversation_id: "c1", prompt: "Briefly inform the user about the task result.继续" },
      root,
    );
    expect(store.getReviewChain("c1")!.chain_pending).toBe(1);

    store.updateReviewChain("c1", { chain_pending: 1 });
    handleBeforeSubmitPrompt(
      store,
      {
        conversation_id: "c1",
        prompt: "<user_query>\nBriefly inform the user about the task result.继续\n</user_query>",
      },
      root,
    );
    expect(store.getReviewChain("c1")!.chain_pending).toBe(1);

    store.updateReviewChain("c1", { chain_pending: 1 });
    handleBeforeSubmitPrompt(
      store,
      {
        conversation_id: "c1",
        prompt:
          "<user_query>\n<timestamp>t</timestamp>\nBriefly inform the user about the task result.继续\n</user_query>",
      },
      root,
    );
    expect(store.getReviewChain("c1")!.chain_pending).toBe(1);
    store.close();
  });
});

describe("F-HOOK port-cursor", () => {
  it("stop returns loop+followup; submit continue:false on ON while executing", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    const cp = writeChecklist(root, "demo", `- [ ] a — A\n- [ ] b — B\n`);
    sessionExecuting(store, root, "c1", cp);
    store.updateReviewChain("c1", { code_edited: 1 });

    const eng = engine(store, root);
    const out = handleStop(eng, {
      conversation_id: "c1",
      status: "completed",
      loop_count: 0,
    });
    expect(out.loop).toBe(true);
    expect(out.followup_message).toBeTruthy();

    const blocked = handleBeforeSubmitPrompt(
      store,
      { conversation_id: "c1", prompt: "/autopilot-on something" },
      root,
    );
    expect(blocked.continue).toBe(false);
    expect(blocked.userMessage).toBeTruthy();

    handleAfterFileEdit(store, {
      conversation_id: "c1",
      file_path: "src/app.ts",
    });
    expect(store.getReviewChain("c1")!.code_edited).toBe(1);

    handleAfterFileEdit(store, {
      conversation_id: "c1",
      file_path: "plans/demo/plan.md",
    });
    // still 1 from before; plans do not clear
    expect(store.getReviewChain("c1")!.code_edited).toBe(1);

    applyResumeReview(store, "c1");
    expect(store.getReviewChain("c1")!.chain_pending).toBe(1);
    store.close();
  });
});
