import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ReviewEngine,
  StateStore,
  applyResume,
  automationFollowupPresent,
  followupInFlight,
  getLatestSchemaVersion,
  readTranscriptTail,
} from "../src/index.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-pending-"));
}

function writeTranscript(
  file: string,
  events: Array<{ role: string; text: string }>,
): void {
  const lines = events.map((e) =>
    JSON.stringify({
      role: e.role,
      message: { content: [{ type: "text", text: e.text }] },
    }),
  );
  fs.writeFileSync(file, lines.join("\n") + "\n");
}

describe("pending followup + session round", () => {
  let root: string;
  let store: StateStore;
  let transcript: string;

  beforeEach(() => {
    root = tmpRoot();
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    store = new StateStore(root);
    expect(store.getSchemaVersion()).toBe(getLatestSchemaVersion());
    transcript = path.join(root, "transcript.jsonl");
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      paused: 0,
      checklist_path: "",
      track_id: "t",
    });
  });

  afterEach(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function engine(): ReviewEngine {
    return new ReviewEngine(store, {
      confirmRounds: 5,
      reviewScope: "executing_only",
      verifyEnabled: false,
      verifyCommands: [],
      maxIdleStops: 5,
      maxErrorsBeforePause: 0,
      recoverDebounceMs: 0,
      projectRoot: root,
    });
  }

  it("handleStop soft-fails on legacy invalid conversation id", () => {
    const bad = "bad\nid-aaaa-bbbb-cccc-ddddeeee0001";
    const ts = new Date().toISOString();
    store.db
      .prepare(
        `INSERT INTO sessions (
          conversation_id, platform, track_id, checklist_path, phase, armed, paused,
          project_root, code_root, last_active_at, updated_at
        ) VALUES (?, 'cursor', 't', '', 'executing', 1, 0, ?, ?, ?, ?)`,
      )
      .run(bad, root, root, ts, ts);
    const eng = engine();
    expect(
      eng.handleStop({
        conversationId: bad,
        status: "completed",
        loopCount: 0,
      }),
    ).toBeNull();
    // error path upserts — must not throw on corrupt ids either.
    expect(
      eng.handleStop({
        conversationId: bad,
        status: "error",
        loopCount: 0,
      }),
    ).toBeNull();
  });

  it("handleStop still returns committed fix if post-commit bookkeeping throws", () => {
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "executing",
      armed: 1,
      paused: 0,
      idle_stop_count: 2,
      error_count: 1,
    });
    store.updateReviewChain("c1", {
      code_edited: 1,
      confirm_left: null,
      chain_pending: 0,
    });
    const orig = store.upsertSession.bind(store);
    store.upsertSession = (() => {
      throw new Error("No session for conversation");
    }) as typeof store.upsertSession;
    try {
      const out = engine().handleStop({
        conversationId: "c1",
        status: "completed",
        loopCount: 0,
      });
      expect(out?.kind).toBe("review.fix");
      expect(out?.message).toBeTruthy();
      expect(store.getReviewChain("c1")!.pending_followup).toBe(out!.message);
    } finally {
      store.upsertSession = orig;
    }
  });

  it("handleStop still redelivers if touchPendingRedeliver throws", () => {
    const pending =
      "Review confirm 2/5 (session round 4; consecutive no-edit confirms, counted on the fix-round counter). Lens 【Correctness】";
    store.updateReviewChain("c1", {
      confirm_left: 3,
      chain_pending: 1,
      code_edited: 0,
      fix_round: 4,
      pending_followup: pending,
      pending_followup_at: new Date().toISOString(),
      pending_redeliver_at: null,
    });
    writeTranscript(transcript, [{ role: "assistant", text: "done previous" }]);
    const orig = store.touchPendingRedeliver.bind(store);
    store.touchPendingRedeliver = (() => {
      throw new Error("No session for conversation");
    }) as typeof store.touchPendingRedeliver;
    try {
      const out = engine().handleStop({
        conversationId: "c1",
        status: "completed",
        loopCount: 1,
        transcriptPath: transcript,
      });
      expect(out?.meta?.redeliver).toBe(true);
      expect(out?.message).toBe(pending);
      expect(store.getReviewChain("c1")!.confirm_left).toBe(3);
    } finally {
      store.touchPendingRedeliver = orig;
    }
  });

  it("redeliver aborts if pending cleared before touch (no stale in-memory msg)", () => {
    const pending =
      "Review confirm 2/5 (session round 4; consecutive no-edit confirms, counted on the fix-round counter). Lens 【Correctness】";
    store.updateReviewChain("c1", {
      confirm_left: 3,
      chain_pending: 1,
      code_edited: 0,
      fix_round: 4,
      pending_followup: pending,
      pending_followup_at: new Date().toISOString(),
      pending_redeliver_at: null,
    });
    writeTranscript(transcript, [{ role: "assistant", text: "done previous" }]);
    const orig = store.touchPendingRedeliver.bind(store);
    store.touchPendingRedeliver = ((id: string) => {
      // Simulate concurrent neutralize/clear winning before the stamp write.
      store.clearPendingFollowup(id);
      store.neutralizeReviewChain(id);
      return orig(id);
    }) as typeof store.touchPendingRedeliver;
    try {
      expect(
        engine().handleStop({
          conversationId: "c1",
          status: "completed",
          loopCount: 1,
          transcriptPath: transcript,
        }),
      ).toBeNull();
      expect(store.getReviewChain("c1")!.pending_followup).toBeNull();
      expect(store.getReviewChain("c1")!.chain_pending).toBe(0);
    } finally {
      store.touchPendingRedeliver = orig;
    }
  });

  it("handleStop must not return unstamped recover if savePendingFollowup throws", () => {
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "executing",
      armed: 1,
      paused: 0,
      error_count: 0,
    });
    const orig = store.savePendingFollowup.bind(store);
    store.savePendingFollowup = (() => {
      throw new Error("No session for conversation");
    }) as typeof store.savePendingFollowup;
    try {
      const out = engine().handleStop({
        conversationId: "c1",
        status: "error",
        loopCount: 0,
      });
      // Unstamped recover would double-inject with a claimer that still owns the window.
      expect(out).toBeNull();
    } finally {
      store.savePendingFollowup = orig;
    }
  });

  it("handleStop still returns recover if error-count upsert throws", () => {
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "executing",
      armed: 1,
      paused: 0,
      error_count: 0,
    });
    const orig = store.upsertSession.bind(store);
    let calls = 0;
    store.upsertSession = ((partial) => {
      calls += 1;
      // First call is the error-count bump inside handleErrorStop.
      if (calls === 1) {
        throw new Error("No session for conversation");
      }
      return orig(partial);
    }) as typeof store.upsertSession;
    try {
      const out = engine().handleStop({
        conversationId: "c1",
        status: "error",
        loopCount: 0,
      });
      expect(out?.kind).toBe("recover");
      expect(out?.message).toBeTruthy();
    } finally {
      store.upsertSession = orig;
    }
  });

  it("handleStop emits stuck if pause-threshold upsert throws", () => {
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "executing",
      armed: 1,
      paused: 0,
      error_count: 2,
    });
    store.updateReviewChain("c1", {
      chain_pending: 1,
      code_edited: 1,
      confirm_left: 3,
      item_confirm_complete: 0,
      pending_followup: "Review confirm 1/5 prior undelivered",
      pending_followup_at: new Date().toISOString(),
    });
    const eng = new ReviewEngine(store, {
      confirmRounds: 5,
      reviewScope: "executing_only",
      verifyEnabled: false,
      verifyCommands: [],
      maxIdleStops: 5,
      maxErrorsBeforePause: 3,
      recoverDebounceMs: 0,
      projectRoot: root,
    });
    const orig = store.upsertSession.bind(store);
    store.upsertSession = (() => {
      throw new Error("database is locked");
    }) as typeof store.upsertSession;
    // Pause column-write throws, neutralize must still run (independent tries).
    const origPause = store.pauseSessionForRepeatedErrors.bind(store);
    store.pauseSessionForRepeatedErrors = (() => {
      throw new Error("pause column write failed");
    }) as typeof store.pauseSessionForRepeatedErrors;
    try {
      const out = eng.handleStop({
        conversationId: "c1",
        status: "error",
        loopCount: 0,
      });
      expect(out?.kind).toBe("stuck");
      expect(out?.loop).toBe(false);
      expect(out?.message).toBeTruthy();
      const chain = store.getReviewChain("c1")!;
      expect(chain.pending_followup).toBeNull();
      expect(chain.chain_pending).toBe(0);
      expect(chain.code_edited).toBe(0);
      expect(chain.confirm_left).toBeNull();
      expect(chain.fix_round).toBe(0);
      // Richer pause threw — fallback disarm must still halt + mark repeated_errors.
      const halted = store.getSession("c1")!;
      expect(halted.armed).toBe(0);
      expect(halted.paused).toBe(1);
      expect(halted.paused_reason).toBe("repeated_errors");
      store.upsertSession = orig;
      store.pauseSessionForRepeatedErrors = origPause;
      // Even if something re-arms without clearing chain, loopCount alone +
      // fix_round=0 must not E3; and with armed=0/paused handleStop stays null.
      expect(
        eng.handleStop({
          conversationId: "c1",
          status: "completed",
          loopCount: 2,
        }),
      ).toBeNull();
      // code_edited must not resume the loop while halted.
      store.markCodeEdited("c1");
      expect(
        eng.handleStop({
          conversationId: "c1",
          status: "completed",
          loopCount: 0,
        }),
      ).toBeNull();
      // Fallback pause must be RESUME-clearable (paused=1 was required).
      const cp = path.join(root, "plans", "t", "checklist.md");
      fs.mkdirSync(path.dirname(cp), { recursive: true });
      fs.writeFileSync(cp, `- [ ] a — Open\n`);
      store.upsertSession({
        conversation_id: "c1",
        project_root: root,
        code_root: root,
        phase: "executing",
        checklist_path: cp,
        track_id: "t",
      });
      // upsertSession merge keeps paused=1 from disarm; applyResume clears it.
      expect(store.getSession("c1")!.paused).toBe(1);
      const resumed = applyResume(store, "c1");
      expect(resumed.ok).toBe(true);
      if (!resumed.ok) return;
      expect(resumed.session!.paused).toBe(0);
      expect(resumed.session!.paused_reason).toBeNull();
      expect(resumed.session!.armed).toBe(1);
    } finally {
      store.upsertSession = orig;
      store.pauseSessionForRepeatedErrors = origPause;
    }
  });

  it("E8 clearChainPending + loopCount + fix_round>0 still reaches E3", () => {
    const eng = engine();
    store.updateReviewChain("c1", {
      chain_pending: 0,
      confirm_left: null,
      code_edited: 0,
      item_confirm_complete: 0,
      fix_round: 2,
      pending_followup: null,
    });
    const out = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 1,
    });
    expect(out?.kind).toBe("review.confirm");
    expect(out?.meta?.n).toBe(1);
    expect(store.getReviewChain("c1")!.confirm_left).toBe(4);
  });

  it("E3 aborts under write lock if concurrent halt paused the session", () => {
    const eng = engine();
    store.updateReviewChain("c1", {
      chain_pending: 1,
      confirm_left: null,
      code_edited: 0,
      item_confirm_complete: 0,
      fix_round: 2,
    });
    const origEnsure = store.ensureReviewChain.bind(store);
    store.ensureReviewChain = ((id: string) => {
      const chain = origEnsure(id);
      // Simulate concurrent error-halt after outer armed check, before E3 write.
      store.pauseSessionForRepeatedErrors(id, 3, "error");
      return chain;
    }) as typeof store.ensureReviewChain;
    try {
      expect(
        eng.handleStop({
          conversationId: "c1",
          status: "completed",
          loopCount: 1,
        }),
      ).toBeNull();
      const chain = store.getReviewChain("c1")!;
      expect(chain.confirm_left).toBeNull();
      expect(store.getSession("c1")!.paused).toBe(1);
    } finally {
      store.ensureReviewChain = origEnsure;
    }
  });

  it("handleStop column-pauses when upsert fails at pause threshold", () => {
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "executing",
      armed: 1,
      paused: 0,
      error_count: 2,
    });
    store.updateReviewChain("c1", {
      chain_pending: 1,
      code_edited: 1,
      confirm_left: 3,
      pending_followup: "Review confirm 1/5 prior undelivered",
      pending_followup_at: new Date().toISOString(),
    });
    const eng = new ReviewEngine(store, {
      confirmRounds: 5,
      reviewScope: "executing_only",
      verifyEnabled: false,
      verifyCommands: [],
      maxIdleStops: 5,
      maxErrorsBeforePause: 3,
      recoverDebounceMs: 0,
      projectRoot: root,
    });
    const orig = store.upsertSession.bind(store);
    store.upsertSession = (() => {
      throw new Error("database is locked");
    }) as typeof store.upsertSession;
    try {
      const out = eng.handleStop({
        conversationId: "c1",
        status: "error",
        loopCount: 0,
      });
      expect(out?.kind).toBe("stuck");
      expect(out?.loop).toBe(false);
      const sess = store.getSession("c1")!;
      expect(sess.armed).toBe(0);
      expect(sess.paused).toBe(1);
      expect(sess.paused_reason).toBe("repeated_errors");
      expect(sess.error_count).toBe(3);
      const chain = store.getReviewChain("c1")!;
      expect(chain.code_edited).toBe(0);
      expect(chain.pending_followup).toBeNull();
      store.upsertSession = orig;
      expect(
        eng.handleStop({
          conversationId: "c1",
          status: "completed",
          loopCount: 2,
        }),
      ).toBeNull();
    } finally {
      store.upsertSession = orig;
    }
  });

  it("session-monotonic: confirm bumps fix_round; confirm→fix continues", () => {
    const eng = engine();
    store.updateReviewChain("c1", {
      chain_pending: 1,
      confirm_left: null,
      code_edited: 0,
      fix_round: 2,
    });
    const a1 = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 1,
    });
    expect(a1?.kind).toBe("review.confirm");
    expect(a1?.meta?.sessionRound).toBe(3);
    expect(store.getReviewChain("c1")!.fix_round).toBe(3);
    expect(a1!.message).toContain("session round 3");

    store.markCodeEdited("c1");
    const fix = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 1,
    });
    expect(fix?.kind).toBe("review.fix");
    expect(fix?.meta?.fixRound).toBe(4);
    expect(fix!.message).toMatch(/round 4/);
  });

  it("redelivers undelivered pending without advancing confirm_left", () => {
    const eng = engine();
    store.updateReviewChain("c1", {
      confirm_left: 4,
      chain_pending: 1,
      code_edited: 0,
      fix_round: 3,
      pending_followup:
        "Review confirm 1/5 (session round 3; consecutive no-edit confirms, counted on the fix-round counter). Lens 【Correctness & invariants】",
      pending_followup_at: new Date().toISOString(),
      pending_redeliver_at: null,
    });
    // Transcript has unrelated assistant turn only — pending not present.
    writeTranscript(transcript, [
      { role: "assistant", text: "done previous" },
    ]);
    const out = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 1,
      transcriptPath: transcript,
    });
    expect(out?.meta?.redeliver).toBe(true);
    expect(out?.message).toContain("Review confirm 1/5");
    expect(store.getReviewChain("c1")!.confirm_left).toBe(4);
  });

  it("resetReviewChain clears pending so stop cannot redeliver stale prompt", () => {
    const eng = engine();
    store.updateReviewChain("c1", {
      confirm_left: 4,
      chain_pending: 1,
      code_edited: 0,
      fix_round: 3,
      pending_followup: "Review confirm 1/5 stale after CLI reset",
      pending_followup_at: new Date().toISOString(),
      pending_redeliver_at: null,
    });
    expect(store.resetReviewChain("c1")).toBe(true);
    writeTranscript(transcript, [{ role: "assistant", text: "done previous" }]);
    const out = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out?.meta?.redeliver).not.toBe(true);
    const chain = store.getReviewChain("c1")!;
    expect(chain.pending_followup).toBeNull();
    expect(chain.confirm_left).toBeNull();
    expect(chain.chain_pending).toBe(0);
  });

  it("clearChainPending keeps pending so next stop redelivers instead of skipping lens", () => {
    const eng = engine();
    const pending =
      "Review confirm 1/5 (session round 3; consecutive no-edit confirms, counted on the fix-round counter). Lens 【Correctness & invariants】";
    store.updateReviewChain("c1", {
      confirm_left: 4,
      chain_pending: 1,
      code_edited: 0,
      fix_round: 3,
      pending_followup: pending,
      pending_followup_at: new Date().toISOString(),
      pending_redeliver_at: null,
    });
    store.clearChainPending("c1");
    expect(store.getReviewChain("c1")!.chain_pending).toBe(0);
    expect(store.getReviewChain("c1")!.pending_followup).toBe(pending);
    writeTranscript(transcript, [{ role: "assistant", text: "done previous" }]);
    const out = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 1,
      transcriptPath: transcript,
    });
    expect(out?.meta?.redeliver).toBe(true);
    expect(out?.message).toContain("Review confirm 1/5");
    expect(store.getReviewChain("c1")!.confirm_left).toBe(4);
  });

  it("does not advance while prior automation followup is in flight", () => {
    const eng = engine();
    store.updateReviewChain("c1", {
      confirm_left: 4,
      chain_pending: 1,
      code_edited: 0,
      fix_round: 3,
      pending_followup: null,
    });
    writeTranscript(transcript, [
      {
        role: "user",
        text: "<user_query>\nReview confirm 1/5 (session round 3)\n</user_query>",
      },
    ]);
    const out = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 1,
      transcriptPath: transcript,
    });
    expect(out).toBeNull();
    expect(store.getReviewChain("c1")!.confirm_left).toBe(4);
  });

  it("blocks advance when pending undelivered (after cooldown touch)", () => {
    const eng = engine();
    const pending =
      "Review confirm 1/5 (session round 3; consecutive no-edit confirms, counted on the fix-round counter).";
    store.updateReviewChain("c1", {
      confirm_left: 4,
      chain_pending: 1,
      code_edited: 0,
      fix_round: 3,
      pending_followup: pending,
      pending_followup_at: new Date().toISOString(),
      // Cooldown not elapsed → tryRedeliver returns null, then pendingBlocksAdvance.
      pending_redeliver_at: new Date().toISOString(),
    });
    writeTranscript(transcript, [{ role: "assistant", text: "ok" }]);
    const out = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 1,
      transcriptPath: transcript,
    });
    expect(out).toBeNull();
    expect(store.getReviewChain("c1")!.confirm_left).toBe(4);
  });

  it("transcript helpers: delivered pending clears, delivery tip is noise", () => {
    const pending = "自审确认 2/5（会话第 8 轮；连续无改动确认，计入修复轮计数）。";
    writeTranscript(transcript, [
      { role: "user", text: `<user_query>\n${pending}\n</user_query>` },
      { role: "user", text: "<user_query>\nBriefly inform the user about the task result.继续\n</user_query>" },
      { role: "assistant", text: "ack" },
    ]);
    const events = readTranscriptTail(transcript);
    expect(automationFollowupPresent(events, pending)).toBe(true);
    expect(followupInFlight(events)).toBe(false);
  });

  it("delivered snapshot clear must not wipe a replaced live pending", () => {
    const delivered =
      "Review confirm 1/5 (session round 3; consecutive no-edit confirms, counted on the fix-round counter).";
    const replacement =
      "Recover: the previous turn ended with an error. Continue the current task.";
    writeTranscript(transcript, [
      {
        role: "user",
        text: `<user_query>\n${delivered}\n</user_query>`,
      },
      { role: "assistant", text: "acked confirm" },
    ]);
    // Live row already replaced (concurrent claim) while outer snapshot still
    // looks like the delivered confirm — clear must be needle-scoped.
    // Keep confirm_left so a buggy unblock would let e4 overwrite recover.
    store.updateReviewChain("c1", {
      confirm_left: 4,
      chain_pending: 0,
      code_edited: 0,
      fix_round: 3,
      pending_followup: replacement,
      pending_followup_at: new Date().toISOString(),
      // Claim hold — completed must not redeliver recover during debounce.
      pending_redeliver_at: new Date().toISOString(),
    });
    const origEnsure = store.ensureReviewChain.bind(store);
    let reads = 0;
    store.ensureReviewChain = ((id: string) => {
      reads += 1;
      const row = origEnsure(id);
      // First handleStop snapshot still shows the delivered confirm.
      if (reads === 1) {
        return {
          ...row,
          pending_followup: delivered,
          pending_followup_at: new Date().toISOString(),
          confirm_left: 4,
          chain_pending: 1,
          fix_round: 3,
          pending_redeliver_at: null,
        };
      }
      return row;
    }) as typeof store.ensureReviewChain;
    try {
      const out = engine().handleStop({
        conversationId: "c1",
        status: "completed",
        loopCount: 1,
        transcriptPath: transcript,
      });
      // Must not advance e4 over recover; live recover (+ hold) stays.
      expect(out).toBeNull();
      expect(store.getReviewChain("c1")!.pending_followup).toBe(replacement);
      expect(store.getReviewChain("c1")!.confirm_left).toBe(4);
    } finally {
      store.ensureReviewChain = origEnsure;
    }
  });

  it("replaced live pending must not redeliver while another harness tip is in flight", () => {
    const delivered =
      "Review confirm 1/5 (session round 3; consecutive no-edit confirms, counted on the fix-round counter).";
    const replacement =
      "Recover: the previous turn ended with an error. Continue the current task.";
    const inflightFix = "Review fix round 2/5 (session round 4).";
    writeTranscript(transcript, [
      {
        role: "user",
        text: `<user_query>\n${delivered}\n</user_query>`,
      },
      { role: "assistant", text: "acked confirm" },
      {
        role: "user",
        text: `<user_query>\n${inflightFix}\n</user_query>`,
      },
    ]);
    store.updateReviewChain("c1", {
      confirm_left: 4,
      chain_pending: 0,
      code_edited: 0,
      fix_round: 3,
      pending_followup: replacement,
      pending_followup_at: new Date().toISOString(),
      pending_redeliver_at: null,
    });
    const origEnsure = store.ensureReviewChain.bind(store);
    let reads = 0;
    store.ensureReviewChain = ((id: string) => {
      reads += 1;
      const row = origEnsure(id);
      if (reads === 1) {
        return {
          ...row,
          pending_followup: delivered,
          pending_followup_at: new Date().toISOString(),
          confirm_left: 4,
          chain_pending: 1,
          fix_round: 3,
          pending_redeliver_at: null,
        };
      }
      return row;
    }) as typeof store.ensureReviewChain;
    try {
      const out = engine().handleStop({
        conversationId: "c1",
        status: "completed",
        loopCount: 1,
        transcriptPath: transcript,
      });
      expect(out).toBeNull();
      expect(store.getReviewChain("c1")!.pending_followup).toBe(replacement);
    } finally {
      store.ensureReviewChain = origEnsure;
    }
  });

  it("readTranscriptTail refuses symlinks (no follow)", () => {
    const real = path.join(root, "real-transcript.jsonl");
    writeTranscript(real, [{ role: "user", text: "secret" }]);
    const link = path.join(root, "link-transcript.jsonl");
    fs.symlinkSync(real, link);
    expect(readTranscriptTail(link)).toEqual([]);
    expect(readTranscriptTail(real).length).toBeGreaterThan(0);
    expect(readTranscriptTail("path\0evil")).toEqual([]);
  });

  it("confirm lens 3 is concurrency (not security)", () => {
    const eng = engine();
    store.updateReviewChain("c1", {
      confirm_left: 3,
      chain_pending: 1,
      code_edited: 0,
      fix_round: 5,
    });
    // n = 5 - 3 + 1 = 3
    const out = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 1,
    });
    expect(out?.meta?.n).toBe(3);
    expect(out!.message).toMatch(/Concurrency|concurrency|并发/);
  });

  it("code_edited wins over pending redelivery", () => {
    const eng = engine();
    store.updateReviewChain("c1", {
      confirm_left: 4,
      chain_pending: 1,
      code_edited: 1,
      fix_round: 3,
      pending_followup: "Review confirm 1/5 (session round 3)",
      pending_followup_at: new Date().toISOString(),
      pending_redeliver_at: null,
    });
    writeTranscript(transcript, [{ role: "assistant", text: "ok" }]);
    const out = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 1,
      transcriptPath: transcript,
    });
    expect(out?.kind).toBe("review.fix");
    expect(out?.meta?.fixRound).toBe(4);
  });

  it("with transcript_path empty file: undelivered pending redelivers", () => {
    const eng = engine();
    fs.writeFileSync(transcript, "");
    store.updateReviewChain("c1", {
      confirm_left: 4,
      chain_pending: 1,
      code_edited: 0,
      fix_round: 3,
      pending_followup: "Review confirm 1/5 (session round 3)",
      pending_followup_at: new Date().toISOString(),
      pending_redeliver_at: null,
    });
    const out = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 1,
      transcriptPath: transcript,
    });
    expect(out?.meta?.redeliver).toBe(true);
    expect(store.getReviewChain("c1")!.confirm_left).toBe(4);
  });

  it("savePendingFollowup resets redelivery cooldown", () => {
    store.updateReviewChain("c1", {
      pending_followup: "old",
      pending_followup_at: new Date().toISOString(),
      pending_redeliver_at: new Date().toISOString(),
    });
    store.savePendingFollowup("c1", "Review confirm 2/5 (session round 4)");
    const row = store.getReviewChain("c1")!;
    expect(row.pending_followup).toContain("Review confirm 2/5");
    expect(row.pending_redeliver_at).toBeNull();
  });

  it("done emit keeps pending for redelivery but chain_pending=0", () => {
    const eng = engine();
    const cp = path.join(root, "plans", "t", "checklist.md");
    fs.mkdirSync(path.dirname(cp), { recursive: true });
    fs.writeFileSync(cp, `- [ ] only — Last item\n`);
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      paused: 0,
      checklist_path: cp,
      track_id: "t",
    });
    store.updateReviewChain("c1", {
      confirm_left: 0,
      chain_pending: 1,
      code_edited: 0,
      item_confirm_complete: 0,
      fix_round: 3,
    });
    const out = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 1,
    });
    expect(out?.kind).toBe("done");
    const chain = store.getReviewChain("c1")!;
    expect(chain.pending_followup).toBeTruthy();
    expect(chain.chain_pending).toBe(0);
    expect(chain.fix_round).toBe(0);
    expect(chain.confirm_left).toBeNull();
    expect(store.getSession("c1")!.phase).toBe("done");
    expect(store.getSession("c1")!.armed).toBe(0);
  });

  it("E5 advance atomically resets chain and sets pending (no reset-without-pending window)", () => {
    const eng = engine();
    const cp = path.join(root, "plans", "t", "checklist.md");
    fs.mkdirSync(path.dirname(cp), { recursive: true });
    fs.writeFileSync(
      cp,
      `- [ ] a — First\n- [ ] b — Second\n`,
    );
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      paused: 0,
      checklist_path: cp,
      track_id: "t",
    });
    store.updateReviewChain("c1", {
      confirm_left: 0,
      chain_pending: 1,
      code_edited: 0,
      item_confirm_complete: 0,
      fix_round: 7,
      pending_followup: "stale confirm",
      pending_followup_at: new Date().toISOString(),
    });
    const out = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 1,
    });
    expect(out?.kind).toBe("advance");
    const chain = store.getReviewChain("c1")!;
    expect(chain.fix_round).toBe(0);
    expect(chain.confirm_left).toBeNull();
    expect(chain.chain_pending).toBe(1);
    expect(chain.pending_followup).toBe(out!.message);
    expect(chain.pending_followup).not.toContain("stale confirm");

    // After E5 reset, confirm_left is null — a follow-up stop must not emit
    // another advance (E3 may arm confirm for the next item instead).
    const again = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 1,
    });
    expect(again?.kind).not.toBe("advance");
    expect(again?.kind).not.toBe("done");
  });

  it("E5 does not mark done when checklist is unreadable", () => {
    const eng = engine();
    const cp = path.join(root, "plans", "t", "checklist.md");
    fs.mkdirSync(path.dirname(cp), { recursive: true });
    // Directory at checklist path → not a regular file
    fs.mkdirSync(cp, { recursive: true });
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      paused: 0,
      checklist_path: cp,
      track_id: "t",
    });
    store.updateReviewChain("c1", {
      confirm_left: 0,
      chain_pending: 1,
      code_edited: 0,
      item_confirm_complete: 0,
      fix_round: 3,
    });
    const out = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 1,
    });
    expect(out).toBeNull();
    expect(store.getSession("c1")!.phase).toBe("executing");
    expect(store.getSession("c1")!.armed).toBe(1);
    expect(store.getReviewChain("c1")!.confirm_left).toBe(0);
  });

  it("E5 refuses symlinked checklist path", () => {
    const eng = engine();
    const real = path.join(root, "plans", "t", "real-checklist.md");
    const link = path.join(root, "plans", "t", "checklist.md");
    fs.mkdirSync(path.dirname(real), { recursive: true });
    fs.writeFileSync(real, `- [ ] a — First\n- [ ] b — Second\n`);
    fs.symlinkSync(real, link);
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      paused: 0,
      checklist_path: link,
      track_id: "t",
    });
    store.updateReviewChain("c1", {
      confirm_left: 0,
      chain_pending: 1,
      code_edited: 0,
      item_confirm_complete: 0,
      fix_round: 3,
    });
    const out = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 1,
    });
    expect(out).toBeNull();
    expect(store.getSession("c1")!.phase).toBe("executing");
    expect(store.getReviewChain("c1")!.confirm_left).toBe(0);
  });

  it("E5 does not mark done when configured checklist path is missing", () => {
    const eng = engine();
    const cp = path.join(root, "plans", "t", "missing-checklist.md");
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      paused: 0,
      checklist_path: cp,
      track_id: "t",
    });
    store.updateReviewChain("c1", {
      confirm_left: 0,
      chain_pending: 1,
      code_edited: 0,
      item_confirm_complete: 0,
      fix_round: 3,
    });
    const out = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 1,
    });
    expect(out).toBeNull();
    expect(store.getSession("c1")!.phase).toBe("executing");
    expect(store.getSession("c1")!.armed).toBe(1);
    expect(store.getReviewChain("c1")!.confirm_left).toBe(0);
  });

  it("E5 with verify on: unchecked=0 (empty path) → done, not verify_fix", () => {
    const eng = new ReviewEngine(store, {
      confirmRounds: 5,
      reviewScope: "executing_only",
      verifyEnabled: true,
      verifyCommands: [{ id: "test", required: true }],
      maxIdleStops: 5,
      maxErrorsBeforePause: 0,
      recoverDebounceMs: 0,
      projectRoot: root,
    });
    // checklist_path "" → unchecked 0, currentItem null
    store.updateReviewChain("c1", {
      confirm_left: 0,
      chain_pending: 1,
      code_edited: 0,
      item_confirm_complete: 0,
      fix_round: 2,
    });
    const out = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 1,
    });
    expect(out?.kind).toBe("done");
    expect(store.getSession("c1")!.phase).toBe("done");
    expect(store.getSession("c1")!.armed).toBe(0);
  });

  it("E5 with verify on: all items checked → done, not verify_fix", () => {
    const eng = new ReviewEngine(store, {
      confirmRounds: 5,
      reviewScope: "executing_only",
      verifyEnabled: true,
      verifyCommands: [{ id: "test", required: true }],
      maxIdleStops: 5,
      maxErrorsBeforePause: 0,
      recoverDebounceMs: 0,
      projectRoot: root,
    });
    const cp = path.join(root, "plans", "t", "checklist.md");
    fs.mkdirSync(path.dirname(cp), { recursive: true });
    fs.writeFileSync(cp, `- [x] a — Done\n- [x] b — Also done\n`);
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      paused: 0,
      checklist_path: cp,
      track_id: "t",
    });
    store.updateReviewChain("c1", {
      confirm_left: 0,
      chain_pending: 1,
      code_edited: 0,
      item_confirm_complete: 0,
      fix_round: 2,
    });
    const out = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 1,
    });
    expect(out?.kind).toBe("done");
    expect(store.getSession("c1")!.phase).toBe("done");
  });

  it("E5 with verify on: unchecked=1 still requires report (not skipped as done)", () => {
    const eng = new ReviewEngine(store, {
      confirmRounds: 5,
      reviewScope: "executing_only",
      verifyEnabled: true,
      verifyCommands: [{ id: "test", required: true }],
      maxIdleStops: 5,
      maxErrorsBeforePause: 0,
      recoverDebounceMs: 0,
      projectRoot: root,
      verifyReportPath: path.join(root, ".autopilot", "verify-last.json"),
    });
    const cp = path.join(root, "plans", "t", "checklist.md");
    fs.mkdirSync(path.dirname(cp), { recursive: true });
    fs.writeFileSync(cp, `- [ ] only — Last open\n`);
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      paused: 0,
      checklist_path: cp,
      track_id: "t",
    });
    store.updateReviewChain("c1", {
      confirm_left: 0,
      chain_pending: 1,
      code_edited: 0,
      item_confirm_complete: 0,
      fix_round: 2,
    });
    const out = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 1,
    });
    expect(out?.kind).toBe("verify_fix");
    expect(store.getSession("c1")!.phase).toBe("executing");
    expect(store.getReviewChain("c1")!.item_confirm_complete).toBe(1);
    expect(store.getReviewChain("c1")!.pending_followup).toBe(out!.message);
  });

  it("e4 atomically pairs confirm_left decrement with pending message", () => {
    const eng = engine();
    store.updateReviewChain("c1", {
      confirm_left: 3,
      chain_pending: 1,
      code_edited: 0,
      fix_round: 5,
      pending_followup: "stale prior confirm",
      pending_followup_at: new Date().toISOString(),
    });
    const out = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 1,
    });
    expect(out?.kind).toBe("review.confirm");
    expect(out?.meta?.n).toBe(3);
    const chain = store.getReviewChain("c1")!;
    expect(chain.confirm_left).toBe(2);
    expect(chain.pending_followup).toBe(out!.message);
    expect(chain.pending_followup).not.toContain("stale prior");
    expect(chain.pending_redeliver_at).toBeNull();
  });

  it("e2 atomically clears code_edited with pending fix message", () => {
    const eng = engine();
    store.updateReviewChain("c1", {
      confirm_left: 2,
      chain_pending: 1,
      code_edited: 1,
      item_confirm_complete: 1,
      fix_round: 4,
      pending_followup: "stale confirm",
      pending_followup_at: new Date().toISOString(),
    });
    const out = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 1,
    });
    expect(out?.kind).toBe("review.fix");
    const chain = store.getReviewChain("c1")!;
    expect(chain.code_edited).toBe(0);
    expect(chain.confirm_left).toBeNull();
    expect(chain.fix_round).toBe(5);
    expect(chain.item_confirm_complete).toBe(1);
    expect(chain.pending_followup).toBe(out!.message);
  });

  it("e3 atomically arms confirm_left with pending message", () => {
    const eng = engine();
    store.updateReviewChain("c1", {
      confirm_left: null,
      chain_pending: 1,
      code_edited: 0,
      item_confirm_complete: 0,
      fix_round: 1,
      pending_followup: "stale",
      pending_followup_at: new Date().toISOString(),
    });
    const out = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 1,
    });
    expect(out?.kind).toBe("review.confirm");
    expect(out?.meta?.n).toBe(1);
    const chain = store.getReviewChain("c1")!;
    expect(chain.confirm_left).toBe(4);
    expect(chain.pending_followup).toBe(out!.message);
    expect(chain.pending_followup).not.toBe("stale");
  });

  it("E5c: checklist all-checked after verify_fail → done (no stale ICC loop)", () => {
    const reportPath = path.join(root, ".autopilot", "verify-last.json");
    const eng = new ReviewEngine(store, {
      confirmRounds: 5,
      reviewScope: "executing_only",
      verifyEnabled: true,
      verifyCommands: [{ id: "test", required: true }],
      maxIdleStops: 5,
      maxErrorsBeforePause: 0,
      recoverDebounceMs: 0,
      projectRoot: root,
      verifyReportPath: reportPath,
    });
    const cp = path.join(root, "plans", "t", "checklist.md");
    fs.mkdirSync(path.dirname(cp), { recursive: true });
    fs.writeFileSync(cp, `- [ ] a — Open\n`);
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      paused: 0,
      checklist_path: cp,
      track_id: "t",
    });
    store.updateReviewChain("c1", {
      confirm_left: 0,
      chain_pending: 1,
      code_edited: 0,
      item_confirm_complete: 0,
      fix_round: 2,
    });
    expect(
      eng.handleStop({ conversationId: "c1", status: "completed", loopCount: 1 })
        ?.kind,
    ).toBe("verify_fix");
    expect(store.getReviewChain("c1")!.item_confirm_complete).toBe(1);

    fs.writeFileSync(cp, `- [x] a — Open\n`);
    const done = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 1,
    });
    expect(done?.kind).toBe("done");
    expect(store.getSession("c1")!.phase).toBe("done");
  });

  it("E5 verify enabled but no required cmds: skip still advances (guard not over-armed)", () => {
    const eng = new ReviewEngine(store, {
      confirmRounds: 5,
      reviewScope: "executing_only",
      verifyEnabled: true,
      verifyCommands: [{ id: "optional" }],
      maxIdleStops: 5,
      maxErrorsBeforePause: 0,
      recoverDebounceMs: 0,
      projectRoot: root,
    });
    const cp = path.join(root, "plans", "t", "checklist.md");
    fs.mkdirSync(path.dirname(cp), { recursive: true });
    fs.writeFileSync(cp, `- [ ] a — First\n- [ ] b — Second\n`);
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      paused: 0,
      checklist_path: cp,
      track_id: "t",
    });
    store.updateReviewChain("c1", {
      confirm_left: 0,
      chain_pending: 1,
      code_edited: 0,
      item_confirm_complete: 0,
      fix_round: 2,
    });
    const out = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 1,
    });
    expect(out?.kind).toBe("advance");
    expect(store.getReviewChain("c1")!.pending_followup).toBe(out!.message);
  });
});
