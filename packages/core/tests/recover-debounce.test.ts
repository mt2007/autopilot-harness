import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PENDING_REDELIVER_COOLDOWN_MS,
  RECOVER_DEBOUNCE_MS,
  ReviewEngine,
  StateStore,
  inRecoverDebounceWindow,
  isRecoverFollowupMessage,
} from "../src/index.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-recover-debounce-"));
}

function writeTranscript(
  file: string,
  events: Array<
    | { role: string; text: string }
    | { type: "turn_ended"; status: string; error?: string }
  >,
): void {
  const lines = events.map((e) => {
    if ("type" in e && e.type === "turn_ended") {
      return JSON.stringify({
        type: "turn_ended",
        status: e.status,
        ...(e.error !== undefined ? { error: e.error } : {}),
      });
    }
    const row = e as { role: string; text: string };
    return JSON.stringify({
      role: row.role,
      message: { content: [{ type: "text", text: row.text }] },
    });
  });
  fs.writeFileSync(file, lines.join("\n") + "\n");
}

describe("error recover debounce (3s window, once)", () => {
  let root: string;
  let store: StateStore;
  let transcript: string;

  beforeEach(() => {
    root = tmpRoot();
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    store = new StateStore(root);
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

  function eng(
    overrides?: Partial<ConstructorParameters<typeof ReviewEngine>[1]>,
  ): ReviewEngine {
    return new ReviewEngine(store, {
      confirmRounds: 5,
      reviewScope: "executing_only",
      verifyEnabled: false,
      verifyCommands: [],
      maxIdleStops: 5,
      maxErrorsBeforePause: 0,
      projectRoot: root,
      recoverDebounceMs: 1000,
      sleepSync: () => {
        /* no wall-clock wait in unit tests */
      },
      ...overrides,
    });
  }

  it("exports a 3s production debounce constant", () => {
    expect(RECOVER_DEBOUNCE_MS).toBe(3000);
    expect(inRecoverDebounceWindow(new Date().toISOString(), 3000)).toBe(true);
    expect(
      inRecoverDebounceWindow(new Date(Date.now() - 4000).toISOString(), 3000),
    ).toBe(false);
  });

  it("F-ERR-DEBOUNCE-ONCE: same window coalesces N error stops into one recover", () => {
    const sleeps: number[] = [];
    const e = eng({
      sleepSync: (ms) => {
        sleeps.push(ms);
      },
    });
    const a1 = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    const a2 = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    const a3 = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(a1?.kind).toBe("recover");
    expect(a2).toBeNull();
    expect(a3).toBeNull();
    expect(sleeps).toEqual([1000]);
    expect(store.getSession("c1")!.error_count).toBe(3);
    expect(store.getReviewChain("c1")!.pending_followup).toMatch(/恢复|Recover/);
  });

  it("F-ERR-EXEC-CLAIM-DISARMS: executing claim clears leftover chain_pending", () => {
    store.updateReviewChain("c1", {
      chain_pending: 1,
      code_edited: 1,
      fix_round: 2,
      pending_followup: "Review fix round 2/5",
      pending_followup_at: new Date().toISOString(),
    });
    const e = eng({ sleepSync: () => {} });
    const out = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out?.kind).toBe("recover");
    const chain = store.getReviewChain("c1")!;
    expect(chain.pending_followup).toMatch(/恢复|Recover/);
    expect(chain.chain_pending).toBe(0);
  });

  it("F-ERR-REDELIVER-DISARMS: completed-stop redeliver of recover keeps chain_pending=0", () => {
    const recoverMsg =
      "Recover: the previous turn ended with an error. Continue the current task.";
    // No claim hold (pending_redeliver_at null) → host-drop style redeliver.
    store.updateReviewChain("c1", {
      chain_pending: 0,
      code_edited: 0,
      fix_round: 0,
      pending_followup: recoverMsg,
      pending_followup_at: new Date(Date.now() - 5000).toISOString(),
      pending_redeliver_at: null,
    });
    writeTranscript(transcript, [
      { role: "assistant", text: "previous turn crashed" },
    ]);
    const e = eng({ sleepSync: () => {} });
    const out = e.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 1,
      transcriptPath: transcript,
    });
    expect(out?.meta?.redeliver).toBe(true);
    expect(out?.kind).toBe("recover");
    expect(out?.message).toBe(recoverMsg);
    expect(store.getReviewChain("c1")!.chain_pending).toBe(0);
  });

  it("F-ERR-REDELIVER-CLAIM-HOLD: claim redeliver hold blocks completed recover inject during sleep", () => {
    const recoverMsg =
      "Recover: the previous turn ended with an error. Continue the current task.";
    // Simulate claim hold for 1000ms debounce against redeliver cooldown clock.
    const holdMs = 1000;
    const at = new Date(
      Date.now() - (PENDING_REDELIVER_COOLDOWN_MS - holdMs),
    ).toISOString();
    store.updateReviewChain("c1", {
      chain_pending: 0,
      pending_followup: recoverMsg,
      pending_followup_at: new Date().toISOString(),
      pending_redeliver_at: at,
    });
    writeTranscript(transcript, [
      { role: "assistant", text: "previous turn crashed" },
    ]);
    const e = eng({ sleepSync: () => {} });
    const out = e.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 1,
      transcriptPath: transcript,
    });
    expect(out).toBeNull();
    expect(store.getReviewChain("c1")!.pending_followup).toBe(recoverMsg);
    expect(store.getReviewChain("c1")!.chain_pending).toBe(0);
  });

  it("F-ERR-REDELIVER-LONG-HOLD: holdMs > cooldown still blocks until full debounce", () => {
    const recoverMsg =
      "Recover: the previous turn ended with an error. Continue the current task.";
    // 30s debounce → future pending_redeliver_at (must not clamp to 8s cooldown).
    const holdMs = 30_000;
    const at = new Date(
      Date.now() - (PENDING_REDELIVER_COOLDOWN_MS - holdMs),
    ).toISOString();
    expect(Date.parse(at)).toBeGreaterThan(Date.now());
    store.updateReviewChain("c1", {
      chain_pending: 0,
      pending_followup: recoverMsg,
      pending_followup_at: new Date().toISOString(),
      pending_redeliver_at: at,
    });
    writeTranscript(transcript, [
      { role: "assistant", text: "previous turn crashed" },
    ]);
    const e = eng({ sleepSync: () => {} });
    expect(
      e.handleStop({
        conversationId: "c1",
        status: "completed",
        loopCount: 1,
        transcriptPath: transcript,
      }),
    ).toBeNull();
  });

  it("F-ERR-REDELIVER-AFTER-EMIT: CAS clears hold so host-drop can redeliver immediately", () => {
    writeTranscript(transcript, [{ role: "assistant", text: "crashed" }]);
    const e = eng({ sleepSync: () => {} });
    const emitted = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(emitted?.kind).toBe("recover");
    expect(store.getReviewChain("c1")!.pending_redeliver_at).toBeNull();
    const out = e.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 1,
      transcriptPath: transcript,
    });
    expect(out?.meta?.redeliver).toBe(true);
    expect(out?.kind).toBe("recover");
    expect(store.getReviewChain("c1")!.chain_pending).toBe(0);
  });

  it("F-ERR-REDELIVER-VS-CLAIMER: completed redeliver during claim sleep does not double-emit", () => {
    writeTranscript(transcript, [
      { role: "assistant", text: "crashed" },
    ]);
    let completedDuringSleep: ReturnType<
      ReviewEngine["handleStop"]
    > = null;
    const e = eng({
      sleepSync: () => {
        completedDuringSleep = e.handleStop({
          conversationId: "c1",
          status: "completed",
          loopCount: 1,
          transcriptPath: transcript,
        });
      },
    });
    const fromError = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(completedDuringSleep).toBeNull();
    expect(fromError?.kind).toBe("recover");
  });

  it("F-ERR-DEBOUNCE-ALIVE: after wait, if recover already answered, do not emit", () => {
    const recoverMsg =
      "Recover: the previous turn ended with an error. Continue the current task.";
    const e = eng({
      sleepSync: () => {
        writeTranscript(transcript, [
          {
            role: "user",
            text: `<user_query>\n${recoverMsg}\n</user_query>`,
          },
          { role: "assistant", text: "continuing after recover" },
        ]);
      },
    });
    const out = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out).toBeNull();
    expect(store.getReviewChain("c1")!.pending_followup).toBeNull();
  });

  it("F-ERR-DEBOUNCE-STALE-ASSISTANT: prior assistant tip alone must not suppress recover", () => {
    const e = eng({
      sleepSync: () => {
        writeTranscript(transcript, [
          {
            role: "user",
            text: `<user_query>\n再审查下\n</user_query>`,
          },
          { role: "assistant", text: "finished prior turn" },
        ]);
      },
    });
    const out = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out?.kind).toBe("recover");
    expect(store.getReviewChain("c1")!.pending_followup).toMatch(/恢复|Recover/);
  });

  it("F-ERR-DEBOUNCE-NEW-AFTER-REVIVE: answered prior recover must not suppress a new error claim", () => {
    // Invariant: after a successful recover was answered and pending cleared, a
    // later error must still inject — finish must not treat historical
    // Recover+assistant as "already alive" for this new claim.
    const recoverMsg =
      "Recover: the previous turn ended with an error. Continue the current task.";
    writeTranscript(transcript, [
      {
        role: "user",
        text: `<user_query>\n${recoverMsg}\n</user_query>`,
      },
      { role: "assistant", text: "continuing after recover" },
    ]);
    const e = eng({
      renderFollowup: () => recoverMsg,
      sleepSync: () => {
        /* claim→finish with transcript unchanged */
      },
    });
    const out = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out?.kind).toBe("recover");
    expect(out?.message).toBe(recoverMsg);
    expect(store.getReviewChain("c1")!.pending_followup).toBe(recoverMsg);
  });

  it("F-ERR-DEBOUNCE-STALE-ANSWERED-PENDING: outside-window answered recover is dropped then fresh-claimed for the new error", () => {
    const recoverMsg =
      "Recover: the previous turn ended with an error. Continue the current task.";
    writeTranscript(transcript, [
      {
        role: "user",
        text: `<user_query>\n${recoverMsg}\n</user_query>`,
      },
      { role: "assistant", text: "already continued" },
    ]);
    store.updateReviewChain("c1", {
      pending_followup: recoverMsg,
      pending_followup_at: new Date(Date.now() - 60_000).toISOString(),
      chain_pending: 0,
    });
    let slept = false;
    const e = eng({
      renderFollowup: () => recoverMsg,
      sleepSync: () => {
        slept = true;
      },
    });
    const out = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    // New error after revive must still inject; only the stale row is dropped.
    expect(out?.kind).toBe("recover");
    expect(slept).toBe(true);
    expect(store.getReviewChain("c1")!.pending_followup).toBe(recoverMsg);
  });

  it("F-ERR-PEER-ANSWERED-HIST-NO-WIPE: peer must not clear in-window claim when prior recover is answered on transcript", () => {
    const recoverMsg =
      "Recover: the previous turn ended with an error. Continue the current task.";
    writeTranscript(transcript, [
      {
        role: "user",
        text: `<user_query>\n${recoverMsg}\n</user_query>`,
      },
      { role: "assistant", text: "prior revive" },
    ]);
    let peerDuringSleep: ReturnType<ReviewEngine["handleStop"]> = null;
    const e = eng({
      renderFollowup: () => recoverMsg,
      sleepSync: () => {
        peerDuringSleep = e.handleStop({
          conversationId: "c1",
          status: "error",
          loopCount: 0,
          transcriptPath: transcript,
        });
      },
    });
    const fromClaimer = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(peerDuringSleep).toBeNull();
    expect(fromClaimer?.kind).toBe("recover");
    expect(store.getReviewChain("c1")!.pending_followup).toBe(recoverMsg);
  });

  it("F-ERR-DEBOUNCE-INFLIGHT: after wait, if recover pending in flight, do not emit again", () => {
    const recoverMsg =
      "Recover: the previous turn ended with an error. Continue the current task.";
    const e = eng({
      recoverDebounceMs: 3000,
      sleepSync: () => {
        // No-op sleep (Atomics unavailable / stub): hold must still be cleared
        // when finish skips CAS due to in-flight recover tip.
        writeTranscript(transcript, [
          {
            role: "user",
            text: `<user_query>\n${recoverMsg}\n</user_query>`,
          },
        ]);
      },
    });
    const out = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out).toBeNull();
    // Still pending for completed-stop redelivery if the host drops the turn.
    expect(store.getReviewChain("c1")!.pending_followup).toMatch(/恢复|Recover/);
    expect(store.getReviewChain("c1")!.pending_redeliver_at).toBeNull();
  });

  it("F-ERR-DEBOUNCE-OTHER-INFLIGHT: tip race during sleep keeps recover pending", () => {
    const e = eng({
      recoverDebounceMs: 3000,
      sleepSync: () => {
        writeTranscript(transcript, [
          {
            role: "user",
            text: `<user_query>\nReview fix round 2 (no hard cap)\n</user_query>`,
          },
        ]);
      },
    });
    const out = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out).toBeNull();
    // Claim already wrote recover; clearing would drop both fix (transcript-only)
    // and recover — keep recover for later redelivery.
    expect(store.getReviewChain("c1")!.pending_followup).toMatch(/恢复|Recover/);
    // Hold dropped so host-drop redeliver is not blocked for full debounceMs.
    expect(store.getReviewChain("c1")!.pending_redeliver_at).toBeNull();
  });

  it("F-ERR-DEBOUNCE-TIP-SWAP: claim fix tip then sleep confirm tip must not stack recover inject", () => {
    writeTranscript(transcript, [
      {
        role: "user",
        text: `<user_query>\nReview fix round 2 (no hard cap)\n</user_query>`,
      },
    ]);
    store.updateReviewChain("c1", {
      pending_followup: "Review fix round 2 (no hard cap)",
      pending_followup_at: new Date().toISOString(),
      chain_pending: 1,
      code_edited: 0,
      fix_round: 2,
    });
    const e = eng({
      recoverDebounceMs: 3000,
      sleepSync: () => {
        writeTranscript(transcript, [
          {
            role: "user",
            text: `<user_query>\n自审确认 2/5（会话第 6 轮；连续无改动确认，计入修复轮计数）。\n</user_query>`,
          },
        ]);
      },
    });
    const out = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out).toBeNull();
    expect(store.getReviewChain("c1")!.pending_followup).toMatch(/恢复|Recover/);
    expect(store.getReviewChain("c1")!.pending_redeliver_at).toBeNull();
  });

  it("F-ERR-DEBOUNCE-TIP-SWAP-FIX-ROUNDS: different fix-round tips are not the same dead tip", () => {
    writeTranscript(transcript, [
      {
        role: "user",
        text: `<user_query>\nReview fix round 1 (no hard cap)\n</user_query>`,
      },
    ]);
    store.updateReviewChain("c1", {
      pending_followup: "Review fix round 1 (no hard cap)",
      pending_followup_at: new Date().toISOString(),
      chain_pending: 1,
      code_edited: 0,
      fix_round: 1,
    });
    const e = eng({
      recoverDebounceMs: 3000,
      sleepSync: () => {
        writeTranscript(transcript, [
          {
            role: "user",
            text: `<user_query>\nReview fix round 2 (no hard cap)\n</user_query>`,
          },
        ]);
      },
    });
    const out = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out).toBeNull();
    expect(store.getReviewChain("c1")!.pending_followup).toMatch(/恢复|Recover/);
  });

  it("F-ERR-DEBOUNCE-TIP-SWAP-BRIEFLY: different Briefly tips must not prefix-match as same", () => {
    writeTranscript(transcript, [
      {
        role: "user",
        text: `<user_query>\nBriefly inform the user that deploy A failed.\n</user_query>`,
      },
    ]);
    const e = eng({
      recoverDebounceMs: 3000,
      sleepSync: () => {
        writeTranscript(transcript, [
          {
            role: "user",
            text: `<user_query>\nBriefly inform the user that deploy B succeeded.\n</user_query>`,
          },
        ]);
      },
    });
    const out = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out).toBeNull();
    expect(store.getReviewChain("c1")!.pending_followup).toMatch(/恢复|Recover/);
  });

  it("F-ERR-DEBOUNCE-TIP-SWAP-ADVANCE: different advance nextIds must not share lead-in as same tip", () => {
    const advA =
      "推进下一项：自审确认已干净通过（确认轮不 commit）。先勾选刚完成的当前项 item-a [x]。然后实现下一项：item-b — B。";
    const advB =
      "推进下一项：自审确认已干净通过（确认轮不 commit）。先勾选刚完成的当前项 item-b [x]。然后实现下一项：item-c — C。";
    writeTranscript(transcript, [
      {
        role: "user",
        text: `<user_query>\n${advA}\n</user_query>`,
      },
    ]);
    const e = eng({
      recoverDebounceMs: 3000,
      sleepSync: () => {
        writeTranscript(transcript, [
          {
            role: "user",
            text: `<user_query>\n${advB}\n</user_query>`,
          },
        ]);
      },
    });
    const out = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out).toBeNull();
    expect(store.getReviewChain("c1")!.pending_followup).toMatch(/恢复|Recover/);
  });

  it("F-ERR-DEBOUNCE-TIP-SWAP-CONFIRM-EN: different EN confirm lenses must not share 48-char lead-in", () => {
    const cA =
      "Review confirm 3/5 (session round 8; consecutive no-edit confirms, counted on the fix-round counter). Lens 【Correctness & invariants】 (multi-lens confirm, not the same checklist again). Dig A.";
    const cB =
      "Review confirm 3/5 (session round 8; consecutive no-edit confirms, counted on the fix-round counter). Lens 【Nulls & boundaries】 (multi-lens confirm, not the same checklist again). Dig B.";
    writeTranscript(transcript, [
      {
        role: "user",
        text: `<user_query>\n${cA}\n</user_query>`,
      },
    ]);
    const e = eng({
      recoverDebounceMs: 3000,
      sleepSync: () => {
        writeTranscript(transcript, [
          {
            role: "user",
            text: `<user_query>\n${cB}\n</user_query>`,
          },
        ]);
      },
    });
    const out = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out).toBeNull();
    expect(store.getReviewChain("c1")!.pending_followup).toMatch(/恢复|Recover/);
  });

  it("F-ERR-DEBOUNCE-TIP-SWAP-CONFIRM-MULTILINE: same first line + different body must not count as same tip", () => {
    const cA = "自审确认 2/5\n角度：正确性\nDig A.";
    const cB = "自审确认 2/5\n角度：空值边界\nDig B.";
    writeTranscript(transcript, [
      {
        role: "user",
        text: `<user_query>\n<timestamp>t1</timestamp>\n${cA}\n</user_query>`,
      },
    ]);
    const e = eng({
      recoverDebounceMs: 3000,
      sleepSync: () => {
        writeTranscript(transcript, [
          {
            role: "user",
            text: `<user_query>\n<timestamp>t2</timestamp>\n${cB}\n</user_query>`,
          },
        ]);
      },
    });
    const out = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out).toBeNull();
    expect(store.getReviewChain("c1")!.pending_followup).toMatch(/恢复|Recover/);
  });

  it("F-ERR-DEBOUNCE-DEAD-BRIEFLY-TIP: same unanswered Briefly tip still injects recover", () => {
    const tip = "Briefly inform the user that the previous turn failed.";
    writeTranscript(transcript, [
      {
        role: "user",
        text: `<user_query>\n${tip}\n</user_query>`,
      },
    ]);
    store.updateReviewChain("c1", {
      pending_followup: tip,
      pending_followup_at: new Date().toISOString(),
    });
    const e = eng();
    const out = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out?.kind).toBe("recover");
    expect(out?.message).toMatch(/恢复|Recover/);
    expect(store.getReviewChain("c1")!.pending_followup).toMatch(/恢复|Recover/);
  });

  it("F-ERR-INFLIGHT-HOLD-STAMP: must not clear peer redeliver hold on stamp mismatch", () => {
    const recoverMsg =
      "Recover: the previous turn ended with an error. Continue the current task.";
    writeTranscript(transcript, [{ role: "assistant", text: "crashed" }]);
    const e = eng({
      recoverDebounceMs: 50,
      sleepSync: () => {
        // Peer redeliver with a deliberately different stamp + new hold.
        store.updateReviewChain("c1", {
          pending_followup: recoverMsg,
          pending_followup_at: "2099-01-01T00:00:00.001Z",
          chain_pending: 0,
        });
        store.setPendingRedeliverHold(
          "c1",
          new Date(Date.now() + 60_000).toISOString(),
        );
        writeTranscript(transcript, [
          {
            role: "user",
            text: `<user_query>\nReview fix round 2 (no hard cap)\n</user_query>`,
          },
        ]);
      },
      renderFollowup: () => recoverMsg,
    });
    const out = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out).toBeNull();
    // Peer hold must survive — unconditional clear would unlock mid-sleep redeliver.
    expect(store.getReviewChain("c1")!.pending_redeliver_at).toBeTruthy();
    expect(store.getReviewChain("c1")!.pending_followup).toBe(recoverMsg);
    expect(store.getReviewChain("c1")!.pending_followup_at).toBe(
      "2099-01-01T00:00:00.001Z",
    );
  });

  it("F-ERR-DEBOUNCE-DEAD-FIX-TIP: error on unanswered fix tip still injects recover", () => {
    writeTranscript(transcript, [
      {
        role: "user",
        text: `<user_query>\nReview fix round 2 (no hard cap)\n</user_query>`,
      },
    ]);
    store.updateReviewChain("c1", {
      pending_followup: "Review fix round 2 (no hard cap)",
      pending_followup_at: new Date().toISOString(),
      chain_pending: 1,
      code_edited: 0,
      fix_round: 2,
    });
    const e = eng();
    const out = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out?.kind).toBe("recover");
    expect(out?.message).toMatch(/恢复|Recover/);
    expect(store.getReviewChain("c1")!.pending_followup).toMatch(/恢复|Recover/);
    // Executing claim must re-arm so the next completed stop resumes fix/E2.
    expect(store.getReviewChain("c1")!.code_edited).toBe(1);
    expect(store.getReviewChain("c1")!.chain_pending).toBe(0);
  });

  it("F-ERR-DEBOUNCE-DEAD-FIX-TIP-PLANNING: planning soft-reset preserves resumeFix", () => {
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "planning",
      armed: 0,
      paused: 0,
      checklist_path: "",
      track_id: "t",
    });
    writeTranscript(transcript, [
      {
        role: "user",
        text: `<user_query>\n自审修复第 2 轮（无硬顶；确认阶段需连续 5 轮无改动）。本轮改过代码。\n</user_query>`,
      },
    ]);
    store.updateReviewChain("c1", {
      pending_followup:
        "自审修复第 2 轮（无硬顶；确认阶段需连续 5 轮无改动）。本轮改过代码。",
      pending_followup_at: new Date().toISOString(),
      chain_pending: 1,
      code_edited: 0,
      fix_round: 2,
    });
    const e = eng({ reviewScope: "project" });
    const out = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out?.kind).toBe("recover");
    expect(out?.message).toMatch(/规划|planning|Recover|恢复/i);
    expect(store.getReviewChain("c1")!.pending_followup).toMatch(/恢复|Recover/);
    expect(store.getReviewChain("c1")!.code_edited).toBe(1);
  });

  it("F-ERR-DEBOUNCE-DEAD-FIX-TIP-DESYNC: empty pending + fix tip still re-arms code_edited", () => {
    writeTranscript(transcript, [
      {
        role: "user",
        text: `<user_query>\nReview fix round 2 (no hard cap)\n</user_query>`,
      },
    ]);
    store.updateReviewChain("c1", {
      pending_followup: null,
      pending_followup_at: null,
      chain_pending: 0,
      code_edited: 0,
      fix_round: 2,
    });
    const e = eng();
    const out = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out?.kind).toBe("recover");
    expect(store.getReviewChain("c1")!.code_edited).toBe(1);
  });

  it("F-ERR-DEAD-FIX-TIP-TRAILING-TURN-ENDED: turn_ended after fix tip still re-arms code_edited", () => {
    writeTranscript(transcript, [
      {
        role: "user",
        text: `<user_query>\nReview fix round 2 (no hard cap)\n</user_query>`,
      },
      {
        type: "turn_ended",
        status: "error",
        error: "You've hit your usage limit",
      },
    ]);
    store.updateReviewChain("c1", {
      pending_followup: null,
      pending_followup_at: null,
      chain_pending: 0,
      code_edited: 0,
      fix_round: 2,
    });
    const e = eng({ recoverDebounceMs: 0, sleepSync: () => {} });
    const out = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out?.kind).toBe("recover");
    expect(store.getReviewChain("c1")!.code_edited).toBe(1);
  });

  it("F-ERR-DEAD-FIX-TIP-NOT-BEFORE-SUCCESS: success turn_ended must not expose older fix tip", async () => {
    const { harnessTipBeforeTrailingTurnEnded } = await import("../src/index.js");
    const events = [
      {
        role: "user",
        message: {
          content: [
            {
              type: "text",
              text: "<user_query>\nReview fix round 2 (no hard cap)\n</user_query>",
            },
          ],
        },
      },
      { type: "turn_ended", status: "success" },
      { type: "turn_ended", status: "error", error: "later failure" },
    ];
    // Must not peek past success and treat the prior fix tip as this error's dead tip.
    expect(harnessTipBeforeTrailingTurnEnded(events)).toBeNull();
  });

  it("F-ERR-DEBOUNCE-DEAD-CONFIRM-TIP: error on unanswered confirm tip injects recover and keeps confirm_left", () => {
    writeTranscript(transcript, [
      {
        role: "user",
        text: `<user_query>\n自审确认 3/5（会话第 7 轮；连续无改动确认，计入修复轮计数）。\n</user_query>`,
      },
    ]);
    store.updateReviewChain("c1", {
      pending_followup:
        "自审确认 3/5（会话第 7 轮；连续无改动确认，计入修复轮计数）。",
      pending_followup_at: new Date().toISOString(),
      chain_pending: 1,
      code_edited: 0,
      confirm_left: 3,
      fix_round: 2,
    });
    const e = eng();
    const out = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out?.kind).toBe("recover");
    expect(store.getReviewChain("c1")!.pending_followup).toMatch(/恢复|Recover/);
    expect(store.getReviewChain("c1")!.confirm_left).toBe(3);
    // Confirm tip must not force a phantom fix arm.
    expect(store.getReviewChain("c1")!.code_edited).toBe(0);
  });

  it("F-ERR-DEBOUNCE-CONFIRM-NO-PHANTOM-FIX: mid-confirm + stale fix pending must not arm code_edited", () => {
    writeTranscript(transcript, [
      {
        role: "user",
        text: `<user_query>\n自审确认 2/5（会话第 6 轮；连续无改动确认，计入修复轮计数）。\n</user_query>`,
      },
    ]);
    store.updateReviewChain("c1", {
      // Desync: tip is confirm, pending still looks like an old fix message.
      pending_followup: "Review fix round 2 (no hard cap)",
      pending_followup_at: new Date().toISOString(),
      chain_pending: 1,
      code_edited: 0,
      confirm_left: 2,
      fix_round: 2,
    });
    const e = eng();
    const out = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out?.kind).toBe("recover");
    expect(store.getReviewChain("c1")!.confirm_left).toBe(2);
    expect(store.getReviewChain("c1")!.code_edited).toBe(0);
  });

  it("F-ERR-DEBOUNCE-RECOVER-INFLIGHT-TIP: stuck recover tip must not suppress coalesce path", () => {
    const recoverMsg =
      "Recover: the previous turn ended with an error. Continue the current task.";
    writeTranscript(transcript, [
      {
        role: "user",
        text: `<user_query>\n${recoverMsg}\n</user_query>`,
      },
    ]);
    const e = eng({ renderFollowup: () => recoverMsg });
    const first = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    // Tip already recover in-flight → claim for pending, finish suppresses re-inject.
    expect(first).toBeNull();
    expect(store.getReviewChain("c1")!.pending_followup).toBe(recoverMsg);
    const second = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(second).toBeNull();
    expect(store.getReviewChain("c1")!.pending_followup).toBe(recoverMsg);
  });

  it("F-ERR-ORPHAN-SALVAGE: completed stop with unresolved transcript turn_ended error injects recover", () => {
    writeTranscript(transcript, [
      {
        role: "user",
        text: `<user_query>\n<timestamp>t</timestamp>\nReview fix round 2 (no hard cap)\n</user_query>`,
      },
      { role: "assistant", text: "started review" },
      {
        type: "turn_ended",
        status: "error",
        error:
          "You've hit your usage limit Get Cursor Pro for more Agent usage, unlimited Tab, and more.",
      },
    ]);
    store.updateReviewChain("c1", {
      pending_followup: "Review fix round 2 (no hard cap)",
      pending_followup_at: new Date().toISOString(),
      chain_pending: 1,
    });
    const e = eng({ recoverDebounceMs: 0, sleepSync: () => {} });
    const out = e.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out?.kind).toBe("recover");
    expect(out?.message).toMatch(/恢复|Recover/);
    expect(store.getReviewChain("c1")!.pending_followup).toMatch(/恢复|Recover/);
  });

  it("F-ERR-ORPHAN-SKIP-RECOVER-TIP: unanswered recover tip must not re-enter handleErrorStop", () => {
    const recoverMsg = "恢复：上一回合出错。继续当前任务。";
    writeTranscript(transcript, [
      {
        type: "turn_ended",
        status: "error",
        error: "You've hit your usage limit",
      },
      {
        role: "user",
        // Host wraps injects with <timestamp>; recover detect must still match.
        text: `<user_query>\n<timestamp>Thursday, Sep 3, 2026, 5:25 PM (UTC+8)</timestamp>\n${recoverMsg}\n</user_query>`,
      },
    ]);
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      error_count: 2,
    });
    store.updateReviewChain("c1", {
      pending_followup: recoverMsg,
      pending_followup_at: new Date().toISOString(),
      chain_pending: 0,
    });
    const e = eng({ recoverDebounceMs: 0, sleepSync: () => {} });
    const out = e.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out).toBeNull();
    expect(store.getSession("c1")!.error_count).toBe(2);
    // Must not clear recover pending via completed delivered-tip logic.
    expect(store.getReviewChain("c1")!.pending_followup).toBe(recoverMsg);
  });

  it("F-ERR-ORPHAN-SALVAGE-AFTER-STALE-RECOVER: newer error after old recover tip must salvage again", () => {
    const recoverMsg = "恢复：上一回合出错。继续当前任务。";
    writeTranscript(transcript, [
      {
        type: "turn_ended",
        status: "error",
        error: "usage limit first",
      },
      {
        role: "user",
        text: `<user_query>\n${recoverMsg}\n</user_query>`,
      },
      // Agent died again before answering recover — new orphan error.
      {
        type: "turn_ended",
        status: "error",
        error: "usage limit again",
      },
    ]);
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      paused: 0,
      error_count: 1,
      checklist_path: "",
      track_id: "t",
    });
    store.updateReviewChain("c1", {
      pending_followup: recoverMsg,
      pending_followup_at: new Date().toISOString(),
      chain_pending: 0,
    });
    const e = eng({ recoverDebounceMs: 0, sleepSync: () => {} });
    const out = e.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out?.kind).toBe("recover");
    expect(store.getSession("c1")!.error_count).toBe(2);
  });

  it("F-ERR-ORPHAN-RESOLVED: completed stop does not salvage after assistant moved past transcript error", () => {
    writeTranscript(transcript, [
      {
        type: "turn_ended",
        status: "error",
        error: "You've hit your usage limit",
      },
      {
        role: "user",
        text: `<user_query>\n恢复：上一回合出错。继续当前任务。\n</user_query>`,
      },
      { role: "assistant", text: "continuing after recover" },
      { type: "turn_ended", status: "success" },
    ]);
    const e = eng({ recoverDebounceMs: 0, sleepSync: () => {} });
    const out = e.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out?.kind).not.toBe("recover");
  });

  it("F-ERR-ORPHAN-RESOLVED-FAILED: later non-error turn_ended clears orphan", async () => {
    const { latestUnresolvedTurnEndedError } = await import("../src/index.js");
    const events = [
      { type: "turn_ended", status: "error", error: "usage limit" },
      { type: "turn_ended", status: "failed" },
    ];
    expect(latestUnresolvedTurnEndedError(events)).toBeNull();
  });

  it("F-ERR-ORPHAN-HELPER-STATUS-CASE: Error status is normalized for orphan detect", async () => {
    const { latestUnresolvedTurnEndedError } = await import("../src/index.js");
    expect(
      latestUnresolvedTurnEndedError([
        { type: "turn_ended", status: "Error", error: "usage limit" },
      ])?.status,
    ).toBe("Error");
    expect(
      latestUnresolvedTurnEndedError([
        { type: "turn_ended", status: " ERROR ", error: "usage limit" },
      ])?.status,
    ).toBe(" ERROR ");
  });

  it("F-ERR-ORPHAN-HELPER: unanswered harness after error stays unresolved", async () => {
    const { latestUnresolvedTurnEndedError } = await import("../src/index.js");
    const events = [
      {
        role: "user",
        message: {
          content: [
            {
              type: "text",
              text: "<user_query>\nReview fix round 1\n</user_query>",
            },
          ],
        },
      },
      { type: "turn_ended", status: "error", error: "usage limit" },
      {
        role: "user",
        message: {
          content: [
            {
              type: "text",
              text: "<user_query>\n恢复：上一回合出错。继续当前任务。\n</user_query>",
            },
          ],
        },
      },
    ];
    expect(latestUnresolvedTurnEndedError(events)?.status).toBe("error");
  });

  it("F-ERR-ORPHAN-HELPER-BRIEFLY-TS: timestamped Briefly after error stays unresolved", async () => {
    const { latestUnresolvedTurnEndedError, isDeliveryNoiseUserQuery } =
      await import("../src/index.js");
    expect(
      isDeliveryNoiseUserQuery(
        "<user_query>\n<timestamp>t</timestamp>\nBriefly inform the user about the task result.\n</user_query>",
      ),
    ).toBe(true);
    const events = [
      { type: "turn_ended", status: "error", error: "usage limit" },
      {
        role: "user",
        message: {
          content: [
            {
              type: "text",
              text: "<user_query>\n<timestamp>t</timestamp>\nBriefly inform the user about the task result.\n</user_query>",
            },
          ],
        },
      },
    ];
    expect(latestUnresolvedTurnEndedError(events)?.status).toBe("error");
  });

  it("F-ERR-ORPHAN-HELPER-TS-ONLY: bare timestamp user row does not resolve orphan", async () => {
    const { latestUnresolvedTurnEndedError, inFlightUserQuery } = await import(
      "../src/index.js"
    );
    const recover =
      "<user_query>\n恢复：上一回合出错。继续当前任务。\n</user_query>";
    const events = [
      { type: "turn_ended", status: "error", error: "usage limit" },
      {
        role: "user",
        message: { content: [{ type: "text", text: recover }] },
      },
      {
        role: "user",
        message: {
          content: [
            {
              type: "text",
              text: "<timestamp>Thursday, Sep 3, 2026, 4:15 PM (UTC+8)</timestamp>",
            },
          ],
        },
      },
    ];
    expect(latestUnresolvedTurnEndedError(events)?.status).toBe("error");
    expect(inFlightUserQuery(events)).toMatch(/恢复|Recover/);
  });

  it("F-ERR-ORPHAN-HELPER-INFLIGHT-TURN-ENDED: turn_ended closes prior recover tip", async () => {
    const { inFlightUserQuery } = await import("../src/index.js");
    const events = [
      {
        role: "user",
        message: {
          content: [
            {
              type: "text",
              text: "<user_query>\n恢复：上一回合出错。继续当前任务。\n</user_query>",
            },
          ],
        },
      },
      { type: "turn_ended", status: "error", error: "usage limit again" },
    ];
    expect(inFlightUserQuery(events)).toBeNull();
  });

  it("inFlightUserQuery returns harness tip or null", async () => {
    const { inFlightUserQuery, isRecoverFollowupMessage } = await import(
      "../src/index.js"
    );
    expect(inFlightUserQuery([])).toBeNull();
    expect(
      inFlightUserQuery([
        {
          role: "user",
          message: {
            content: [
              {
                type: "text",
                text: "<user_query>\nReview fix round 1\n</user_query>",
              },
            ],
          },
        },
      ]),
    ).toMatch(/^Review fix/);
    expect(
      inFlightUserQuery([
        {
          role: "user",
          message: {
            content: [{ type: "text", text: "<user_query>\nhello\n</user_query>" }],
          },
        },
      ]),
    ).toBeNull();
    expect(isRecoverFollowupMessage("恢复：上一回合出错。")).toBe(true);
    expect(isRecoverFollowupMessage("卡住：x")).toBe(false);
    expect(
      isRecoverFollowupMessage(
        "<user_query>\n<timestamp>t</timestamp>\n恢复：上一回合出错。继续当前任务。\n</user_query>",
      ),
    ).toBe(true);
    expect(
      isRecoverFollowupMessage(
        "<user_query>\n<timestamp>t</timestamp>\nStuck: wait\n</user_query>",
      ),
    ).toBe(false);
  });

  it("F-ERR-DEBOUNCE-USER-TIP: unanswered normal user tip is still dead → emit recover", () => {
    const e = eng({
      sleepSync: () => {
        writeTranscript(transcript, [
          {
            role: "user",
            text: `<user_query>\n再审查下\n</user_query>`,
          },
        ]);
      },
    });
    const out = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out?.kind).toBe("recover");
    expect(store.getReviewChain("c1")!.pending_followup).toMatch(/恢复|Recover/);
  });

  it("F-ERR-DEBOUNCE-REDELIVER: outside window and still dead → emit recover again", () => {
    const e = eng();
    const first = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(first?.kind).toBe("recover");
    store.updateReviewChain("c1", {
      pending_followup_at: new Date(Date.now() - 5000).toISOString(),
    });
    const second = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(second?.kind).toBe("recover");
    expect(store.getReviewChain("c1")!.pending_followup).toMatch(/恢复|Recover/);
  });

  it("F-ERR-DEBOUNCE-BLANK-MSG: blank recover render must not soft-reset/claim", () => {
    store.updateReviewChain("c1", {
      confirm_left: 3,
      chain_pending: 1,
      code_edited: 0,
      pending_followup: "自审确认 2/5 — keep me",
      pending_followup_at: new Date().toISOString(),
    });
    const e = eng({
      reviewScope: "project",
      renderFollowup: () => "   ",
    });
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "idle",
      armed: 1,
      paused: 0,
    });
    const out = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out).toBeNull();
    const chain = store.getReviewChain("c1")!;
    expect(chain.pending_followup).toBe("自审确认 2/5 — keep me");
    expect(chain.confirm_left).toBe(3);
  });

  it("F-ERR-DEBOUNCE-SLEEP-THROW: sleepSync throw still finishes recover emit", () => {
    const e = eng({
      sleepSync: () => {
        throw new Error("sleep blew up");
      },
    });
    const out = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out?.kind).toBe("recover");
    expect(store.getReviewChain("c1")!.pending_followup).toMatch(/恢复|Recover/);
  });

  it("inRecoverDebounceWindow rejects empty/invalid/non-positive window", () => {
    expect(inRecoverDebounceWindow("", 3000)).toBe(false);
    expect(inRecoverDebounceWindow(null, 3000)).toBe(false);
    expect(inRecoverDebounceWindow("not-a-date", 3000)).toBe(false);
    expect(inRecoverDebounceWindow(new Date().toISOString(), 0)).toBe(false);
    expect(inRecoverDebounceWindow(new Date().toISOString(), -1)).toBe(false);
  });

  it("F-ERR-DEBOUNCE-CAS: claimer loses emit when stamp changes during sleep", () => {
    const e = eng({
      sleepSync: () => {
        // Concurrent redeliver (or CAS winner) refreshed ownership stamp.
        store.updateReviewChain("c1", {
          pending_followup_at: new Date(Date.now() + 10).toISOString(),
        });
      },
    });
    const out = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out).toBeNull();
    expect(store.getReviewChain("c1")!.pending_followup).toMatch(/恢复|Recover/);
  });

  it("F-ERR-DEBOUNCE-CAS-WINNER: redeliver emits once; peers in new window coalesce", () => {
    const e = eng({
      recoverDebounceMs: 1000,
      sleepSync: () => {},
    });
    const first = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(first?.kind).toBe("recover");
    // Age out window with a distinct past stamp → redeliver takes ownership.
    const aged = "2020-01-01T00:00:00.000Z";
    store.updateReviewChain("c1", {
      pending_followup_at: aged,
    });
    const second = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(second?.kind).toBe("recover");
    expect(store.getReviewChain("c1")!.pending_followup_at).not.toBe(aged);
    const third = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(third).toBeNull();
  });

  it("F-ERR-DEBOUNCE-FAILED-COALESCE: claim txn fail with in-window recover does not emit again", () => {
    const e = eng();
    expect(
      e.handleStop({
        conversationId: "c1",
        status: "error",
        loopCount: 0,
        transcriptPath: transcript,
      })?.kind,
    ).toBe("recover");
    const orig = store.exclusiveWrite.bind(store);
    store.exclusiveWrite = (() => {
      throw new Error("database is locked");
    }) as typeof store.exclusiveWrite;
    try {
      const second = e.handleStop({
        conversationId: "c1",
        status: "error",
        loopCount: 0,
        transcriptPath: transcript,
      });
      expect(second).toBeNull();
    } finally {
      store.exclusiveWrite = orig;
    }
  });

  it("F-ERR-DEBOUNCE-FAILED-AGED: claim fail with aged recover pending still must not legacy-emit", () => {
    const e = eng({ recoverDebounceMs: 0, sleepSync: () => {} });
    expect(
      e.handleStop({
        conversationId: "c1",
        status: "error",
        loopCount: 0,
        transcriptPath: transcript,
      })?.kind,
    ).toBe("recover");
    store.updateReviewChain("c1", {
      pending_followup_at: "2020-01-01T00:00:00.000Z",
    });
    const orig = store.exclusiveWrite.bind(store);
    store.exclusiveWrite = (() => {
      throw new Error("database is locked");
    }) as typeof store.exclusiveWrite;
    try {
      expect(
        e.handleStop({
          conversationId: "c1",
          status: "error",
          loopCount: 0,
          transcriptPath: transcript,
        }),
      ).toBeNull();
      expect(store.getReviewChain("c1")!.pending_followup).toMatch(/恢复|Recover/);
    } finally {
      store.exclusiveWrite = orig;
    }
  });

  it("F-ERR-DEBOUNCE-FAILED-NO-NEUTRALIZE: ambient claim fail must not wipe racing recover via neutralize", () => {
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "idle",
      armed: 1,
      paused: 0,
    });
    store.updateReviewChain("c1", {
      confirm_left: 2,
      chain_pending: 1,
      pending_followup: "Recover: racing peer",
      pending_followup_at: new Date().toISOString(),
    });
    let writes = 0;
    const orig = store.exclusiveWrite.bind(store);
    store.exclusiveWrite = ((fn) => {
      writes += 1;
      // First exclusiveWrite is tryClaim → fail; later tryCommit also fails.
      throw new Error("database is locked");
    }) as typeof store.exclusiveWrite;
    const neutralize = store.neutralizeReviewChain.bind(store);
    let neutralized = 0;
    store.neutralizeReviewChain = ((id: string) => {
      neutralized += 1;
      return neutralize(id);
    }) as typeof store.neutralizeReviewChain;
    const unlessRecover = store.neutralizeReviewChainUnlessRecover.bind(store);
    let unlessCalls = 0;
    store.neutralizeReviewChainUnlessRecover = ((id: string) => {
      unlessCalls += 1;
      return unlessRecover(id);
    }) as typeof store.neutralizeReviewChainUnlessRecover;
    try {
      const e = eng({ reviewScope: "project" });
      expect(
        e.handleStop({
          conversationId: "c1",
          status: "error",
          loopCount: 0,
          transcriptPath: transcript,
        }),
      ).toBeNull();
      expect(neutralized).toBe(0);
      // Unlocked full-neutralize removed on locked_unavailable (wipe/emit TOCTOU).
      expect(unlessCalls).toBe(0);
      expect(store.getReviewChain("c1")!.pending_followup).toBe(
        "Recover: racing peer",
      );
      expect(store.getReviewChain("c1")!.confirm_left).toBe(2);
      expect(writes).toBeGreaterThan(0);
    } finally {
      store.exclusiveWrite = orig;
      store.neutralizeReviewChain = neutralize;
      store.neutralizeReviewChainUnlessRecover = unlessRecover;
    }
  });

  it("F-ERR-DEBOUNCE-FAILED-TRYCOMMIT-EXISTS: claim throw then tryCommit must not overwrite peer recover", () => {
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "idle",
      armed: 1,
      paused: 0,
    });
    store.updateReviewChain("c1", {
      confirm_left: 2,
      chain_pending: 1,
      pending_followup: "自审修复第 1 轮",
      pending_followup_at: new Date().toISOString(),
    });
    let writes = 0;
    const orig = store.exclusiveWrite.bind(store);
    store.exclusiveWrite = ((fn) => {
      writes += 1;
      // Claim fails once; before tryCommit body runs, peer already claimed recover.
      if (writes === 1) throw new Error("claim boom");
      store.updateReviewChain("c1", {
        pending_followup: "Recover: peer claimer",
        pending_followup_at: new Date().toISOString(),
        confirm_left: 2,
      });
      return orig(fn);
    }) as typeof store.exclusiveWrite;
    try {
      const e = eng({ reviewScope: "project" });
      expect(
        e.handleStop({
          conversationId: "c1",
          status: "error",
          loopCount: 0,
          transcriptPath: transcript,
        }),
      ).toBeNull();
      expect(store.getReviewChain("c1")!.pending_followup).toBe(
        "Recover: peer claimer",
      );
      expect(store.getReviewChain("c1")!.confirm_left).toBe(2);
    } finally {
      store.exclusiveWrite = orig;
    }
  });

  it("F-ERR-SOFTRESET-SQL: softResetAmbientChainUnlessRecover refuses recover pending", () => {
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "idle",
      armed: 1,
      paused: 0,
    });
    store.updateReviewChain("c1", {
      confirm_left: 3,
      chain_pending: 1,
      code_edited: 1,
      pending_followup: "恢复：peer",
      pending_followup_at: new Date().toISOString(),
    });
    expect(
      store.softResetAmbientChainUnlessRecover("c1", {
        confirm_left: null,
        item_confirm_complete: 0,
        chain_pending: 0,
        code_edited: 0,
      }),
    ).toBe(false);
    const row = store.getReviewChain("c1")!;
    expect(row.pending_followup).toBe("恢复：peer");
    expect(row.confirm_left).toBe(3);
    expect(row.code_edited).toBe(1);

    store.updateReviewChain("c1", {
      pending_followup: "自审修复第 2 轮",
      reviewing_item_id: "item-under-review",
    });
    expect(
      store.softResetAmbientChainUnlessRecover("c1", {
        confirm_left: null,
        item_confirm_complete: 0,
        chain_pending: 0,
        code_edited: 1,
      }),
    ).toBe(true);
    const after = store.getReviewChain("c1")!;
    expect(after.pending_followup).toBeNull();
    expect(after.chain_pending).toBe(0);
    expect(after.code_edited).toBe(1);
    expect(after.reviewing_item_id).toBe("item-under-review");
  });

  it("F-ERR-TRYCOMMIT-NOPENDING: savePending no-op must not report ok; later tryCommit stamps", () => {
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "idle",
      armed: 1,
      paused: 0,
    });
    store.updateReviewChain("c1", {
      confirm_left: 2,
      chain_pending: 1,
      item_confirm_complete: 1,
      pending_followup: "自审确认 2/5（会话）",
      pending_followup_at: new Date().toISOString(),
    });
    let writes = 0;
    let neutCalls = 0;
    const origEx = store.exclusiveWrite.bind(store);
    const origSave = store.savePendingFollowup.bind(store);
    const origUnless = store.neutralizeReviewChainUnlessRecover.bind(store);
    store.exclusiveWrite = ((fn) => {
      writes += 1;
      if (writes === 1) throw new Error("claim boom");
      // First two tryCommits no-op; 3rd tryCommit stamps (no full-neutralize).
      if (writes <= 3) {
        store.savePendingFollowup = (() => {
          /* simulate missing-session / no-op */
        }) as typeof store.savePendingFollowup;
        try {
          return origEx(fn);
        } finally {
          store.savePendingFollowup = origSave;
        }
      }
      return origEx(fn);
    }) as typeof store.exclusiveWrite;
    store.neutralizeReviewChainUnlessRecover = ((id: string) => {
      neutCalls += 1;
      return origUnless(id);
    }) as typeof store.neutralizeReviewChainUnlessRecover;
    try {
      const e = eng({ reviewScope: "project" });
      const out = e.handleStop({
        conversationId: "c1",
        status: "error",
        loopCount: 0,
        transcriptPath: transcript,
      });
      expect(neutCalls).toBe(0);
      expect(out?.kind).toBe("recover");
      const chain = store.getReviewChain("c1")!;
      expect(isRecoverFollowupMessage(chain.pending_followup)).toBe(true);
      // Soft-reset preserves mid-confirm confirm_left — full neutralize would null it.
      expect(chain.confirm_left).toBe(2);
      expect(chain.chain_pending).toBe(0);
    } finally {
      store.exclusiveWrite = origEx;
      store.savePendingFollowup = origSave;
      store.neutralizeReviewChainUnlessRecover = origUnless;
    }
  });

  it("F-ERR-TRYCOMMIT-ROLLBACK-NO-WIPE: failed stamps must not full-neutralize mid-confirm", () => {
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "idle",
      armed: 1,
      paused: 0,
    });
    store.updateReviewChain("c1", {
      confirm_left: 2,
      chain_pending: 1,
      fix_round: 3,
      item_confirm_complete: 1,
      pending_followup: "自审确认 2/5（回滚）",
    });
    let writes = 0;
    let neutCalls = 0;
    const origEx = store.exclusiveWrite.bind(store);
    const origSave = store.savePendingFollowup.bind(store);
    const origUnless = store.neutralizeReviewChainUnlessRecover.bind(store);
    store.exclusiveWrite = ((fn) => {
      writes += 1;
      if (writes === 1) throw new Error("claim boom");
      // All tryCommit + emitRecover: savePending no-op → no stamp, no wipe.
      store.savePendingFollowup = (() => {}) as typeof store.savePendingFollowup;
      try {
        return origEx(fn);
      } finally {
        store.savePendingFollowup = origSave;
      }
    }) as typeof store.exclusiveWrite;
    store.neutralizeReviewChainUnlessRecover = ((id: string) => {
      neutCalls += 1;
      return origUnless(id);
    }) as typeof store.neutralizeReviewChainUnlessRecover;
    try {
      const e = eng({ reviewScope: "project" });
      const out = e.handleStop({
        conversationId: "c1",
        status: "error",
        loopCount: 0,
        transcriptPath: transcript,
      });
      expect(neutCalls).toBe(0);
      expect(out).toBeNull();
      const chain = store.getReviewChain("c1")!;
      expect(chain.confirm_left).toBe(2);
      expect(chain.item_confirm_complete).toBe(1);
      expect(chain.fix_round).toBe(3);
      expect(chain.pending_followup).toBe("自审确认 2/5（回滚）");
      expect(chain.chain_pending).toBe(0);
    } finally {
      store.exclusiveWrite = origEx;
      store.savePendingFollowup = origSave;
      store.neutralizeReviewChainUnlessRecover = origUnless;
    }
  });

  it("F-ERR-CAS-BUMP: casBumpPendingFollowupAt is single-winner", () => {
    store.updateReviewChain("c1", {
      pending_followup: "Recover: cas",
      pending_followup_at: "2024-01-01T00:00:00.000Z",
    });
    const first = store.casBumpPendingFollowupAt(
      "c1",
      "2024-01-01T00:00:00.000Z",
    );
    expect(first).toBeTruthy();
    expect(first).not.toBe("2024-01-01T00:00:00.000Z");
    expect(
      store.casBumpPendingFollowupAt("c1", "2024-01-01T00:00:00.000Z"),
    ).toBeNull();
    expect(store.getReviewChain("c1")!.pending_followup_at).toBe(first);

    store.updateReviewChain("c1", {
      pending_followup: "自审修复第 1 轮",
      pending_followup_at: "2024-06-01T00:00:00.000Z",
    });
    expect(
      store.casBumpPendingFollowupAt("c1", "2024-06-01T00:00:00.000Z"),
    ).toBeNull();
    expect(store.getReviewChain("c1")!.pending_followup_at).toBe(
      "2024-06-01T00:00:00.000Z",
    );
  });

  it("F-ERR-DEBOUNCE-FAILED-EMIT-EXISTS: compensating emit must not overwrite peer recover", () => {
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "idle",
      armed: 1,
      paused: 0,
    });
    store.updateReviewChain("c1", {
      confirm_left: 1,
      chain_pending: 0,
      pending_followup: null,
    });
    let writes = 0;
    const orig = store.exclusiveWrite.bind(store);
    store.exclusiveWrite = ((fn) => {
      writes += 1;
      // claim + 3×tryCommit fail; emitRecover's exclusiveWrite sees peer recover.
      if (writes <= 4) throw new Error("locked");
      store.updateReviewChain("c1", {
        pending_followup: "Recover: peer before emit",
        pending_followup_at: new Date().toISOString(),
        confirm_left: 1,
      });
      return orig(fn);
    }) as typeof store.exclusiveWrite;
    try {
      const e = eng({ reviewScope: "project" });
      expect(
        e.handleStop({
          conversationId: "c1",
          status: "error",
          loopCount: 0,
          transcriptPath: transcript,
        }),
      ).toBeNull();
      expect(store.getReviewChain("c1")!.pending_followup).toBe(
        "Recover: peer before emit",
      );
    } finally {
      store.exclusiveWrite = orig;
    }
  });

  it("F-ERR-EMIT-RECOVER-DISARMS: compensate emit clears leftover chain_pending", () => {
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "idle",
      armed: 1,
      paused: 0,
    });
    store.updateReviewChain("c1", {
      confirm_left: null,
      chain_pending: 1,
      code_edited: 0,
      fix_round: 1,
      pending_followup: "自审修复第 1 轮",
    });
    let writes = 0;
    const orig = store.exclusiveWrite.bind(store);
    store.exclusiveWrite = ((fn) => {
      writes += 1;
      // claim + 3×tryCommit throw; emitRecover (5th) stamps.
      if (writes <= 4) throw new Error("locked");
      return orig(fn);
    }) as typeof store.exclusiveWrite;
    try {
      const e = eng({ reviewScope: "project" });
      const out = e.handleStop({
        conversationId: "c1",
        status: "error",
        loopCount: 0,
        transcriptPath: transcript,
      });
      expect(out?.kind).toBe("recover");
      const chain = store.getReviewChain("c1")!;
      expect(chain.pending_followup).toMatch(/恢复|Recover/);
      expect(chain.chain_pending).toBe(0);
      // Ambient emit soft-resets under lock → mid-fix resumes via code_edited.
      expect(chain.code_edited).toBe(1);
      expect(chain.fix_round).toBe(1);
    } finally {
      store.exclusiveWrite = orig;
    }
  });

  it("F-ERR-EMIT-PRESERVES-CONFIRM: ambient emit soft-reset keeps mid-confirm counters", () => {
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "idle",
      armed: 1,
      paused: 0,
    });
    store.updateReviewChain("c1", {
      confirm_left: 3,
      chain_pending: 1,
      code_edited: 0,
      item_confirm_complete: 0,
      pending_followup: "自审确认 2/5（空值）",
      pending_followup_at: new Date().toISOString(),
    });
    let writes = 0;
    const orig = store.exclusiveWrite.bind(store);
    store.exclusiveWrite = ((fn) => {
      writes += 1;
      if (writes <= 4) throw new Error("locked");
      return orig(fn);
    }) as typeof store.exclusiveWrite;
    try {
      const out = eng({ reviewScope: "project" }).handleStop({
        conversationId: "c1",
        status: "error",
        loopCount: 0,
        transcriptPath: transcript,
      });
      expect(out?.kind).toBe("recover");
      const chain = store.getReviewChain("c1")!;
      expect(isRecoverFollowupMessage(chain.pending_followup)).toBe(true);
      expect(chain.confirm_left).toBe(3);
      expect(chain.code_edited).toBe(0);
      expect(chain.chain_pending).toBe(0);
    } finally {
      store.exclusiveWrite = orig;
    }
  });

  it("F-ERR-LOCKED-UNAVAIL-NO-WIPE: lock storm must not unlocked-neutralize/soft-reset mid-confirm", () => {
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "idle",
      armed: 1,
      paused: 0,
    });
    store.updateReviewChain("c1", {
      confirm_left: 2,
      chain_pending: 1,
      code_edited: 0,
      item_confirm_complete: 1,
      pending_followup: "自审确认 2/5（会话第 4 轮）",
      pending_followup_at: new Date().toISOString(),
    });
    let writes = 0;
    const orig = store.exclusiveWrite.bind(store);
    store.exclusiveWrite = ((_fn) => {
      writes += 1;
      throw new Error("database is locked");
    }) as typeof store.exclusiveWrite;
    let unlessCalls = 0;
    const unlessRecover = store.neutralizeReviewChainUnlessRecover.bind(store);
    store.neutralizeReviewChainUnlessRecover = ((id: string) => {
      unlessCalls += 1;
      return unlessRecover(id);
    }) as typeof store.neutralizeReviewChainUnlessRecover;
    let mergeDisarm = 0;
    const origUpdate = store.updateReviewChain.bind(store);
    store.updateReviewChain = ((id, patch) => {
      // Unlocked disarm via merge write would clobber concurrent confirm_left.
      if (
        patch.chain_pending === 0 &&
        patch.confirm_left === undefined &&
        patch.pending_followup === undefined
      ) {
        mergeDisarm += 1;
      }
      return origUpdate(id, patch);
    }) as typeof store.updateReviewChain;
    try {
      const e = eng({ reviewScope: "project" });
      const out = e.handleStop({
        conversationId: "c1",
        status: "error",
        loopCount: 0,
        transcriptPath: transcript,
      });
      // No stamped recover → no hook inject (avoids double-inject with claimer).
      expect(out).toBeNull();
      // Must never unlocked full-neutralize (would zero confirm_left) or
      // unlocked soft-reset (would clear undelivered confirm → E4 lens skip).
      expect(unlessCalls).toBe(0);
      expect(mergeDisarm).toBe(0);
      const mid = store.getReviewChain("c1")!;
      expect(mid.confirm_left).toBe(2);
      expect(mid.item_confirm_complete).toBe(1);
      expect(mid.code_edited).toBe(0);
      expect(mid.chain_pending).toBe(0);
      expect(mid.pending_followup).toBe("自审确认 2/5（会话第 4 轮）");
      expect(writes).toBeGreaterThan(0);
    } finally {
      store.exclusiveWrite = orig;
      store.neutralizeReviewChainUnlessRecover = unlessRecover;
      store.updateReviewChain = origUpdate;
    }
  });

  it("F-ERR-LOCKED-NO-UNSTAMPED-EMIT: total lock storm returns null without stamped recover", () => {
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "idle",
      armed: 1,
      paused: 0,
    });
    store.updateReviewChain("c1", {
      confirm_left: 2,
      chain_pending: 1,
      pending_followup: "自审确认 2/5（并发）",
      pending_followup_at: new Date().toISOString(),
    });
    const orig = store.exclusiveWrite.bind(store);
    store.exclusiveWrite = (() => {
      throw new Error("database is locked");
    }) as typeof store.exclusiveWrite;
    try {
      const out = eng({ reviewScope: "project" }).handleStop({
        conversationId: "c1",
        status: "error",
        loopCount: 0,
        transcriptPath: transcript,
      });
      // Unstamped recover would race a claimer that still CAS-emits after debounce.
      expect(out).toBeNull();
      expect(store.getReviewChain("c1")!.pending_followup).toBe(
        "自审确认 2/5（并发）",
      );
      expect(
        isRecoverFollowupMessage(store.getReviewChain("c1")!.pending_followup),
      ).toBe(false);
    } finally {
      store.exclusiveWrite = orig;
    }
  });

  it("F-ERR-DEBOUNCE-PAUSED: pause during sleep clears recover claim", () => {
    const e = eng({
      sleepSync: () => {
        store.upsertSession({
          conversation_id: "c1",
          project_root: root,
          code_root: root,
          paused: 1,
          armed: 0,
          paused_reason: "human_gate",
        });
      },
    });
    const out = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out).toBeNull();
    expect(store.getReviewChain("c1")!.pending_followup).toBeNull();
  });

  it("F-ERR-CAS-THEN-PAUSE: post-CAS pause clears recover (no hook inject)", () => {
    writeTranscript(transcript, [{ role: "assistant", text: "crashed" }]);
    let casDone = false;
    const orig = store.exclusiveWrite.bind(store);
    store.exclusiveWrite = ((fn) => {
      const value = orig(fn);
      // After claim txn: no pause yet. After CAS emit txn: pause before return.
      if (
        !casDone &&
        isRecoverFollowupMessage(
          store.getReviewChain("c1")?.pending_followup ?? "",
        )
      ) {
        // First successful write is claim (pending stamped, hold armed).
        // Second that still has recover + bumped stamp is CAS — detect via
        // pending_redeliver_at cleared by casBump.
        const hold = store.getReviewChain("c1")?.pending_redeliver_at;
        if (hold === null) {
          casDone = true;
          store.upsertSession({
            conversation_id: "c1",
            project_root: root,
            code_root: root,
            paused: 1,
            armed: 0,
            paused_reason: "human_gate",
          });
        }
      }
      return value;
    }) as typeof store.exclusiveWrite;
    try {
      const out = eng({
        recoverDebounceMs: 10,
        sleepSync: () => {},
      }).handleStop({
        conversationId: "c1",
        status: "error",
        loopCount: 0,
        transcriptPath: transcript,
      });
      expect(out).toBeNull();
      expect(store.getReviewChain("c1")!.pending_followup).toBeNull();
      expect(casDone).toBe(true);
    } finally {
      store.exclusiveWrite = orig;
    }
  });

  it("F-ERR-COMPENSATE-PAUSED: claim fail then pause must not inject recover", () => {
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "idle",
      armed: 1,
      paused: 0,
    });
    store.updateReviewChain("c1", {
      confirm_left: 2,
      chain_pending: 1,
      pending_followup: "自审修复第 1 轮",
    });
    let writes = 0;
    const orig = store.exclusiveWrite.bind(store);
    store.exclusiveWrite = ((fn) => {
      writes += 1;
      if (writes === 1) throw new Error("claim boom");
      // Before tryCommit/emitRecover body: concurrent repeated_errors pause.
      store.upsertSession({
        conversation_id: "c1",
        project_root: root,
        code_root: root,
        phase: "idle",
        armed: 0,
        paused: 1,
        paused_reason: "repeated_errors",
      });
      return orig(fn);
    }) as typeof store.exclusiveWrite;
    try {
      const e = eng({ reviewScope: "project" });
      expect(
        e.handleStop({
          conversationId: "c1",
          status: "error",
          loopCount: 0,
          transcriptPath: transcript,
        }),
      ).toBeNull();
      // Must not neutralize/wipe mid-confirm after observing pause.
      const chain = store.getReviewChain("c1")!;
      expect(chain.pending_followup).toBe("自审修复第 1 轮");
      expect(chain.confirm_left).toBe(2);
    } finally {
      store.exclusiveWrite = orig;
    }
  });

  it("F-ERR-EMIT-THEN-PAUSE: post-stamp pause clears recover (no hook inject)", () => {
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "idle",
      armed: 1,
      paused: 0,
    });
    store.updateReviewChain("c1", {
      confirm_left: null,
      chain_pending: 1,
      code_edited: 0,
      fix_round: 2,
      pending_followup: "自审修复第 2 轮",
    });
    let writes = 0;
    const orig = store.exclusiveWrite.bind(store);
    store.exclusiveWrite = ((fn) => {
      writes += 1;
      // claim + 3×tryCommit locked; emitRecover (5th) stamps successfully.
      if (writes <= 4) throw new Error("locked");
      const value = orig(fn);
      // Pause after stamp commit — recoverActionIfStillRunnable must drop inject.
      store.upsertSession({
        conversation_id: "c1",
        project_root: root,
        code_root: root,
        phase: "idle",
        armed: 0,
        paused: 1,
        paused_reason: "human_gate",
      });
      return value;
    }) as typeof store.exclusiveWrite;
    try {
      expect(
        eng({ reviewScope: "project" }).handleStop({
          conversationId: "c1",
          status: "error",
          loopCount: 0,
          transcriptPath: transcript,
        }),
      ).toBeNull();
      const chain = store.getReviewChain("c1")!;
      expect(chain.pending_followup).toBeNull();
      // Soft-reset markers from emit may remain; pending must not redeliver.
      expect(chain.code_edited).toBe(1);
      expect(chain.chain_pending).toBe(0);
    } finally {
      store.exclusiveWrite = orig;
    }
  });

  it("F-ERR-DEBOUNCE-NUL-MSG: NUL recover render must not claim", () => {
    store.updateReviewChain("c1", {
      pending_followup: "自审确认 1/5",
      pending_followup_at: new Date().toISOString(),
      confirm_left: 4,
    });
    const e = eng({
      reviewScope: "project",
      renderFollowup: () => "Recover:\0poison",
    });
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "idle",
      armed: 1,
      paused: 0,
    });
    expect(
      e.handleStop({
        conversationId: "c1",
        status: "error",
        loopCount: 0,
        transcriptPath: transcript,
      }),
    ).toBeNull();
    expect(store.getReviewChain("c1")!.pending_followup).toBe("自审确认 1/5");
  });

  it("F-ERR-HALFWIDTH-INFLIGHT: 恢复: tip is harness in-flight (no double emit)", () => {
    writeTranscript(transcript, [
      { role: "user", text: "恢复: 上一回合出错。继续当前任务。" },
    ]);
    store.savePendingFollowup("c1", "恢复: 上一回合出错。继续当前任务。", {
      armChain: false,
    });
    const e = eng();
    const out = e.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    // In-window recover tip must coalesce / skip re-inject, not treat as ordinary user.
    expect(out).toBeNull();
    expect(store.getReviewChain("c1")!.pending_followup).toMatch(/^恢复:/);
  });

  it("F-ERR-RECOVER-COPY: mid-advance error emits neutral recover (no 不要推进)", () => {
    // Mid-advance: E5 advance was in flight, Agent mid-turn, then usage-limit
    // error. Recover must not say「不要推进」.
    const zh = "恢复：上一回合出错。继续当前任务。";
    const advance =
      "推进下一项：自审确认已干净通过。先勾选当前项 [x]。然后实现下一项：item-b — next feature。";
    store.updateReviewChain("c1", {
      pending_followup: advance,
      pending_followup_at: new Date().toISOString(),
      chain_pending: 1,
      confirm_left: null,
      code_edited: 0,
      item_confirm_complete: 0,
    });
    writeTranscript(transcript, [
      {
        role: "user",
        text: `<user_query>\n${advance}\n</user_query>`,
      },
      {
        role: "assistant",
        text: "确认链已通过。先勾选 item-a 并提交本项改动…",
      },
    ]);
    const out = eng({
      recoverDebounceMs: 0,
      sleepSync: () => {},
      renderFollowup: (kind) => (kind === "recover" ? zh : ""),
    }).handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out?.kind).toBe("recover");
    expect(out?.message).toBe(zh);
    expect(out?.message).not.toMatch(/不要推进|without advancing|checklist 项/);
    expect(out?.message).toMatch(/继续当前任务/);
    expect(store.getReviewChain("c1")!.pending_followup).toBe(zh);
  });

  it("F-ERR-RECOVER-COPY-EN: defaultRender recover is neutral", () => {
    const out = eng({
      recoverDebounceMs: 0,
      sleepSync: () => {},
    }).handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out?.kind).toBe("recover");
    expect(out?.message).toBe(
      "Recover: the previous turn ended with an error. Continue the current task.",
    );
    expect(out?.message).not.toMatch(/without advancing|do not advance/i);
  });

  it("F-ERR-DEBOUNCE-ZH: Chinese recover coalesce + answered-alive", () => {
    const zh =
      "恢复：上一回合出错。继续当前任务。";
    const e = eng({
      renderFollowup: () => zh,
    });
    expect(
      e.handleStop({
        conversationId: "c1",
        status: "error",
        loopCount: 0,
        transcriptPath: transcript,
      })?.message,
    ).toBe(zh);
    expect(
      e.handleStop({
        conversationId: "c1",
        status: "error",
        loopCount: 0,
        transcriptPath: transcript,
      }),
    ).toBeNull();

    store.updateReviewChain("c1", {
      pending_followup: null,
      pending_followup_at: null,
    });
    const e2 = eng({
      renderFollowup: () => zh,
      sleepSync: () => {
        writeTranscript(transcript, [
          {
            role: "user",
            text: `<user_query>\n${zh}\n</user_query>`,
          },
          { role: "assistant", text: "已恢复" },
        ]);
      },
    });
    expect(
      e2.handleStop({
        conversationId: "c1",
        status: "error",
        loopCount: 0,
        transcriptPath: transcript,
      }),
    ).toBeNull();
    expect(store.getReviewChain("c1")!.pending_followup).toBeNull();
  });

  it("F-ABORT-HALFWIDTH-RECOVER: aborted clears 恢复:/卡住: pending", () => {
    const e = eng({ recoverDebounceMs: 0 });
    store.updateReviewChain("c1", {
      pending_followup: "恢复: halfwidth recover pending",
      pending_followup_at: new Date().toISOString(),
    });
    expect(
      e.handleStop({ conversationId: "c1", status: "aborted", loopCount: 0 }),
    ).toBeNull();
    expect(store.getReviewChain("c1")!.pending_followup).toBeNull();

    store.updateReviewChain("c1", {
      pending_followup: "卡住: halfwidth stuck",
      pending_followup_at: new Date().toISOString(),
    });
    expect(
      e.handleStop({ conversationId: "c1", status: "aborted", loopCount: 0 }),
    ).toBeNull();
    expect(store.getReviewChain("c1")!.pending_followup).toBeNull();
  });

  it("transcriptTipIsAssistant and sleepSyncMs helpers", async () => {
    const { transcriptTipIsAssistant, sleepSyncMs } = await import(
      "../src/index.js"
    );
    expect(transcriptTipIsAssistant([])).toBe(false);
    expect(
      transcriptTipIsAssistant([{ role: "assistant" }, { role: "user" }]),
    ).toBe(false);
    expect(
      transcriptTipIsAssistant([{ role: "user" }, { role: "assistant" }]),
    ).toBe(true);
    expect(() => sleepSyncMs(0)).not.toThrow();
    expect(() => sleepSyncMs(-5)).not.toThrow();
    expect(() => sleepSyncMs(Number.NaN)).not.toThrow();
  });
});
