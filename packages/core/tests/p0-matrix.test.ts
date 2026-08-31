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
  getCurrentSchemaVersion,
  isHarnessFollowupMessage,
  isLastUnchecked,
  isProductCodeEdit,
  isRealpathInsideProject,
  isRunnableTrack,
  listTracks,
  migrate,
  parseChecklist,
  parseSchemaVersionValue,
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
    reviewScope: "executing_only",
    verifyEnabled: false,
    verifyCommands: [],
    maxIdleStops: 5,
    maxErrorsBeforePause: 3,
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
  it("empty db runs migrations → latest; migrate is idempotent", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    expect(store.getSchemaVersion()).toBe(2);
    expect(migrate(store.db)).toBe(2);
    expect(store.getSchemaVersion()).toBe(2);
    store.close();
  });

  it("corrupt schema_version is read as 0 (not NaN / not treated as latest)", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    store.db
      .prepare(
        "INSERT OR REPLACE INTO _schema_meta (key, value) VALUES ('schema_version', ?)",
      )
      .run("nope");
    expect(store.getSchemaVersion()).toBe(0);
    expect(getCurrentSchemaVersion(store.db)).toBe(0);
    store.close();
  });

  it("parseSchemaVersionValue rejects partial / non-integer tokens", () => {
    expect(parseSchemaVersionValue(null)).toBe(0);
    expect(parseSchemaVersionValue("")).toBe(0);
    expect(parseSchemaVersionValue("nope")).toBe(0);
    expect(parseSchemaVersionValue("-1")).toBe(0);
    expect(parseSchemaVersionValue("2.9")).toBe(0);
    expect(parseSchemaVersionValue("2abc")).toBe(0);
    expect(parseSchemaVersionValue(" 2 ")).toBe(2);
    expect(parseSchemaVersionValue("0")).toBe(0);
    expect(parseSchemaVersionValue(2)).toBe(2);
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

  it("RESUME / checklist parse ignore poisoned session.project_root", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-poison-root-"));
    try {
      // Bypass upsert sanitizer — simulate a legacy DB row.
      store.db
        .prepare(
          `UPDATE sessions SET project_root = ?, code_root = ?, paused = 1,
            phase = 'executing', armed = 0 WHERE conversation_id = ?`,
        )
        .run(outside, outside, "c1");
      expect(store.getSession("c1")!.project_root).toBe(outside);
      // Checklist still under the real project — must re-arm using store root.
      const sess = applyResume(store, "c1");
      expect(sess?.paused).toBe(0);
      expect(sess?.armed).toBe(1);

      // Outside checklist + poisoned root must not count as in-project work.
      const evilCp = path.join(outside, "checklist.md");
      fs.writeFileSync(evilCp, `- [ ] x — X\n`);
      store.db
        .prepare(
          `UPDATE sessions SET project_root = ?, checklist_path = ?, paused = 1,
            phase = 'executing', armed = 0 WHERE conversation_id = ?`,
        )
        .run(outside, evilCp, "c1");
      const blocked = applyResume(store, "c1");
      expect(blocked?.armed).toBe(0);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("checklist containment prefers store root over mismatched config.projectRoot", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-cfg-root-"));
    try {
      const evilCp = path.join(outside, "checklist.md");
      fs.writeFileSync(evilCp, `- [ ] secret — Secret\n`);
      // Engine config points outside; store stays on real project.
      const eng = engine(store, outside);
      store.db
        .prepare(
          `UPDATE sessions SET checklist_path = ?, armed = 1, phase = 'executing',
            paused = 0 WHERE conversation_id = ?`,
        )
        .run(evilCp, "c1");
      store.updateReviewChain("c1", {
        code_edited: 0,
        chain_pending: 1,
        confirm_left: 0,
        item_confirm_complete: 0,
      });
      // E5 must not advance/done from outside checklist under evil config root.
      expect(stop(eng, "c1")).toBeNull();

      // In-project checklist still works despite evil config root.
      store.db
        .prepare(
          `UPDATE sessions SET checklist_path = ? WHERE conversation_id = ?`,
        )
        .run(cp, "c1");
      store.updateReviewChain("c1", {
        code_edited: 0,
        chain_pending: 1,
        confirm_left: 0,
        item_confirm_complete: 0,
      });
      const ok = stop(eng, "c1");
      expect(ok?.kind).toBe("advance");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
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
    const advance = stop(eng, "c1");
    expect(advance?.kind).toBe("advance");
    // defaultRender (no locale): mark [x] before commit instruction.
    const advMsg = advance?.message ?? "";
    const advMark = advMsg.search(/First mark the current item \[x\]/i);
    const advCommit = advMsg.search(/conventional commit/i);
    expect(advMark).toBeGreaterThanOrEqual(0);
    expect(advCommit).toBeGreaterThan(advMark);
    expect(advMsg).not.toMatch(/Then mark current item \[x\]/);
    // After marking current (item-a), "implement next" must be the following
    // unchecked item — not firstUnchecked / the item just completed.
    expect(advMsg).toMatch(/item-b/);
    expect(advMsg).toMatch(/Second/);
    expect(advMsg).not.toMatch(/implement next: item-a/i);

    const cp2 = writeChecklist(root, "last", `- [ ] only — One\n`);
    sessionExecuting(store, root, "c2", cp2);
    store.ensureReviewChain("c2");
    store.updateReviewChain("c2", { confirm_left: 0, code_edited: 0 });
    const eng2 = engine(store, root);
    const done = stop(eng2, "c2");
    expect(done?.kind).toBe("done");
    const doneMsg = done?.message ?? "";
    const doneMark = doneMsg.search(/Mark the last item \[x\]/i);
    const doneCommit = doneMsg.search(/conventional commit/i);
    expect(doneMark).toBeGreaterThanOrEqual(0);
    expect(doneCommit).toBeGreaterThan(doneMark);
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

  it("F-ERR: error×N (maxErrorsBeforePause) → repeated_errors; completed/RESUME clear error_count", () => {
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

  it("F-ERR-UNLIMITED: maxErrorsBeforePause=0 never pauses on errors", () => {
    const eng = engine(store, root, { maxErrorsBeforePause: 0 });
    for (let i = 0; i < 10; i++) {
      const action = eng.handleStop({
        conversationId: "c1",
        status: "error",
        loopCount: 0,
      });
      expect(action?.kind).toBe("recover");
    }
    expect(store.getSession("c1")!.paused).toBe(0);
    expect(store.getSession("c1")!.armed).toBe(1);
    expect(store.getSession("c1")!.error_count).toBe(10);
  });

  it("F-ERR-5: maxErrorsBeforePause=5 pauses on 5th error", () => {
    const eng = engine(store, root, { maxErrorsBeforePause: 5 });
    for (let i = 0; i < 4; i++) {
      expect(
        eng.handleStop({ conversationId: "c1", status: "error", loopCount: 0 })
          ?.kind,
      ).toBe("recover");
    }
    expect(store.getSession("c1")!.paused).toBe(0);
    eng.handleStop({ conversationId: "c1", status: "error", loopCount: 0 });
    expect(store.getSession("c1")!.paused_reason).toBe("repeated_errors");
    expect(store.getSession("c1")!.error_count).toBe(5);
  });

  it("F-ERR-PLAN: planning error injects recover_planning (armed=0)", () => {
    const eng = engine(store, root, { maxErrorsBeforePause: 0 });
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "planning",
      armed: 0,
      paused: 0,
      track_id: "_pending",
    });
    const action = eng.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
    });
    expect(action?.kind).toBe("recover");
    expect(action?.message).toMatch(/planning|规划|RUN/i);
    expect(action?.loop).toBe(true);
    expect(store.getSession("c1")!.error_count).toBe(1);
  });

  it("F-SCOPE-PROJECT: ambient edit triggers fix without RUN", () => {
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "review:\n  scope: project\n",
    );
    const eng = engine(store, root, { reviewScope: "project", maxErrorsBeforePause: 0 });
    handleAfterFileEdit(
      store,
      { conversation_id: "c-ambient", file_path: "src/app.ts" },
      root,
    );
    expect(store.getSession("c-ambient")?.phase).toBe("idle");
    expect(store.getSession("c-ambient")?.armed).toBe(1);
    expect(store.getReviewChain("c-ambient")!.code_edited).toBe(1);
    const fix = eng.handleStop({
      conversationId: "c-ambient",
      status: "completed",
      loopCount: 0,
    });
    expect(fix?.kind).toBe("review.fix");
  });

  it("F-SCOPE-PROJECT: E5 ends with review_complete even with leftover checklist + verify", () => {
    const eng = engine(store, root, {
      reviewScope: "project",
      verifyEnabled: true,
      verifyCommands: [{ id: "test", required: true }],
      maxErrorsBeforePause: 0,
    });
    store.upsertSession({
      conversation_id: "c-plan",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "planning",
      armed: 0,
      paused: 0,
      track_id: "demo",
      checklist_path: cp,
    });
    store.ensureReviewChain("c-plan");
    store.updateReviewChain("c-plan", {
      confirm_left: 0,
      code_edited: 0,
      item_confirm_complete: 0,
      chain_pending: 1,
    });
    const done = eng.handleStop({
      conversationId: "c-plan",
      status: "completed",
      loopCount: 1,
    });
    expect(done?.kind).toBe("review_complete");
    expect(store.getSession("c-plan")!.phase).toBe("planning");
  });

  it("F-SCOPE-PROJECT: revive done session on next product edit", () => {
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "review:\n  scope: project\n",
    );
    store.upsertSession({
      conversation_id: "c-done",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "done",
      armed: 0,
      paused: 0,
      track_id: "demo",
      checklist_path: cp,
    });
    store.ensureReviewChain("c-done");
    store.updateReviewChain("c-done", {
      pending_followup: "All checklist items done. Phase is done.",
      chain_pending: 0,
      confirm_left: null,
      fix_round: 3,
    });
    handleAfterFileEdit(
      store,
      { conversation_id: "c-done", file_path: "src/app.ts" },
      root,
    );
    expect(store.getSession("c-done")!.phase).toBe("idle");
    expect(store.getSession("c-done")!.armed).toBe(1);
    expect(store.getReviewChain("c-done")!.pending_followup).toBeNull();
    expect(store.getReviewChain("c-done")!.code_edited).toBe(1);
    const eng = engine(store, root, { reviewScope: "project" });
    expect(
      eng.handleStop({
        conversationId: "c-done",
        status: "completed",
        loopCount: 0,
      })?.kind,
    ).toBe("review.fix");
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

  it("F-OFF-AMBIENT: idle+armed OFF pauses; RESUME re-arms", () => {
    store.upsertSession({
      conversation_id: "c-amb",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "idle",
      armed: 1,
      paused: 0,
    });
    applyOff(store, "c-amb");
    const off = store.getSession("c-amb")!;
    expect(off.phase).toBe("idle");
    expect(off.paused).toBe(1);
    expect(off.armed).toBe(0);
    expect(off.paused_reason).toBe("human_gate");
    applyResume(store, "c-amb");
    const on = store.getSession("c-amb")!;
    expect(on.paused).toBe(0);
    expect(on.armed).toBe(1);
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
      canEnterExecuting({
        slug: "_pending",
        checklistPath: "",
        paused: false,
        projectRoot: root,
      }).ok,
    ).toBe(false);
    store.close();
  });

  it("listTracks: symlinked plan.md falls back to slug; symlinked checklist counts 0", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    const trackDir = path.join(root, "plans", "auth");
    fs.mkdirSync(trackDir, { recursive: true });
    const realPlan = path.join(root, "real-plan.md");
    fs.writeFileSync(realPlan, `# Secret Title\n`);
    fs.symlinkSync(realPlan, path.join(trackDir, "plan.md"));
    const realCl = path.join(root, "real-cl.md");
    fs.writeFileSync(realCl, `- [ ] a — A\n`);
    fs.symlinkSync(realCl, path.join(trackDir, "checklist.md"));
    const tracks = listTracks(root, store, "all");
    const auth = tracks.find((t) => t.slug === "auth");
    expect(auth).toBeTruthy();
    expect(auth!.title).toBe("auth");
    expect(auth!.checklistTotal).toBe(0);
    expect(auth!.checklistDone).toBe(0);
    expect(
      canEnterExecuting({
        slug: "auth",
        checklistPath: path.join(trackDir, "checklist.md"),
        paused: false,
        projectRoot: root,
      }).ok,
    ).toBe(false);
    store.close();
  });

  it("listTracks: refuses plansDir that is a symlink escape", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-out-"));
    try {
      const evilTrack = path.join(outside, "leaked");
      fs.mkdirSync(evilTrack, { recursive: true });
      fs.writeFileSync(path.join(evilTrack, "plan.md"), `# Outside Secret\n`);
      fs.writeFileSync(path.join(evilTrack, "checklist.md"), `- [ ] x — X\n`);
      fs.symlinkSync(outside, path.join(root, "plans"));
      const tracks = listTracks(root, store, "all");
      expect(tracks).toEqual([]);
      expect(tracks.some((t) => t.title.includes("Outside"))).toBe(false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
    store.close();
  });

  it("listTracks: refuses plansDir relative path that escapes the project", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    const sibling = fs.mkdtempSync(path.join(os.tmpdir(), "ap-sib-"));
    try {
      const evilTrack = path.join(sibling, "leaked");
      fs.mkdirSync(evilTrack, { recursive: true });
      fs.writeFileSync(path.join(evilTrack, "plan.md"), `# Sibling Secret\n`);
      fs.writeFileSync(path.join(evilTrack, "checklist.md"), `- [ ] y — Y\n`);
      // plansDir = ../<siblingBasename> relative to root
      const rel = path.relative(root, sibling);
      expect(rel.startsWith("..")).toBe(true);
      const tracks = listTracks(root, store, "all", rel);
      expect(tracks).toEqual([]);
    } finally {
      fs.rmSync(sibling, { recursive: true, force: true });
    }
    store.close();
  });

  it("listTracks: refuses absolute / backslash / tilde plansDir", () => {
    const root = tmpRoot();
    expect(listTracks(root, undefined, "all", "/tmp/plans")).toEqual([]);
    expect(listTracks(root, undefined, "all", "~/.plans")).toEqual([]);
    expect(listTracks(root, undefined, "all", "plans\\evil")).toEqual([]);
    expect(listTracks(root, undefined, "all", "plans\nfoo")).toEqual([]);
  });

  it("canEnterExecuting: refuses checklist whose realpath escapes the project", () => {
    const root = tmpRoot();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-cl-"));
    try {
      const cp = path.join(outside, "checklist.md");
      fs.writeFileSync(cp, `- [ ] z — Z\n`);
      expect(
        canEnterExecuting({
          slug: "auth",
          checklistPath: cp,
          paused: false,
          projectRoot: root,
        }),
      ).toEqual({ ok: false, reason: "checklist outside project" });
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("listTracks: padded projectRoot still lists in-project tracks", () => {
    const root = tmpRoot();
    const trackDir = path.join(root, "plans", "auth");
    fs.mkdirSync(trackDir, { recursive: true });
    fs.writeFileSync(path.join(trackDir, "checklist.md"), `- [ ] a — A\n`);
    fs.writeFileSync(path.join(trackDir, "plan.md"), `# Auth\n`);
    const tracks = listTracks(`  ${root}  `, undefined, "all");
    expect(tracks.map((t) => t.slug)).toEqual(["auth"]);
  });

  it("isRealpathInsideProject: relative target resolves against projectRoot not cwd", () => {
    const root = tmpRoot();
    const trackDir = path.join(root, "plans", "auth");
    fs.mkdirSync(trackDir, { recursive: true });
    const cp = path.join(trackDir, "checklist.md");
    fs.writeFileSync(cp, `- [ ] a — A\n`);
    const prev = process.cwd();
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "ap-cwd-"));
    try {
      process.chdir(other);
      // Relative to project — must succeed even when cwd is elsewhere.
      expect(isRealpathInsideProject(root, "plans/auth/checklist.md")).toBe(
        true,
      );
      // Padded projectRoot should still resolve (trim).
      expect(
        isRealpathInsideProject(`  ${root}  `, "plans/auth/checklist.md"),
      ).toBe(true);
      // Absolute outside still refused.
      const evil = path.join(other, "evil.md");
      fs.writeFileSync(evil, "x");
      expect(isRealpathInsideProject(root, evil)).toBe(false);
    } finally {
      process.chdir(prev);
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  it("F-E8: RUN/ON do not clear chain; normal message clears chain_pending", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    const cp = writeChecklist(root, "demo", `- [ ] a — A\n`);
    sessionExecuting(store, root, "c1", cp);
    store.updateReviewChain("c1", {
      chain_pending: 1,
      confirm_left: 2,
      pending_followup: "Review confirm 3/5 undelivered",
      pending_followup_at: new Date().toISOString(),
    });

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
    const afterChat = store.getReviewChain("c1")!;
    expect(afterChat.chain_pending).toBe(0);
    // Must keep undelivered pending — wiping it would let the next stop skip a lens.
    expect(afterChat.pending_followup).toBe("Review confirm 3/5 undelivered");
    expect(afterChat.confirm_left).toBe(2);

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

    // Pause-threshold upsert failure → stuck text without loop (must not spin).
    store.clearPendingFollowup("c1");
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "executing",
      armed: 1,
      paused: 0,
      error_count: 2,
    });
    const engPause = engine(store, root, { maxErrorsBeforePause: 3 });
    const origUpsert = store.upsertSession.bind(store);
    store.upsertSession = (() => {
      throw new Error("database is locked");
    }) as typeof store.upsertSession;
    try {
      const halted = handleStop(engPause, {
        conversation_id: "c1",
        status: "error",
        loop_count: 0,
      });
      expect(halted.followup_message).toBeTruthy();
      expect(halted.loop).toBeUndefined();
      expect(store.getReviewChain("c1")?.pending_followup ?? null).toBeNull();
    } finally {
      store.upsertSession = origUpsert;
    }

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
    }, root);
    expect(store.getReviewChain("c1")!.code_edited).toBe(1);

    handleAfterFileEdit(store, {
      conversation_id: "c1",
      file_path: "plans/demo/plan.md",
    }, root);
    // still 1 from before; plans do not clear
    expect(store.getReviewChain("c1")!.code_edited).toBe(1);

    applyResumeReview(store, "c1");
    expect(store.getReviewChain("c1")!.chain_pending).toBe(1);
    store.close();
  });
});
