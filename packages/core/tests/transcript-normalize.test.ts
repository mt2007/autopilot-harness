import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ReviewEngine,
  StateStore,
  automationFollowupPresent,
  followupInFlight,
  getLatestSchemaVersion,
  readTranscriptTail,
  transcriptHasUnresolvedTurnEndedError,
} from "../src/index.js";
import { TRANSCRIPT_TAIL_EVENTS } from "../src/transcript-followup.js";

const FIX_ZH =
  "自审修复第 4 轮（无硬顶；确认阶段需连续 5 轮无改动）。本轮改过代码。请立刻对本轮 diff 做缺陷优先自审并直接修复：1) 用 git diff / git status 看改动时，跳过命中 .autopilotignore 的路径，以及未被 Git 跟踪且被 .gitignore 忽略的路径；只对剩余路径审；2) 查正确性、空值/边界、并发、安全、回归、缺测；3) CRITICAL/HIGH 必须改，MEDIUM 尽量改；4) 跑相关测试；5) 修完后简短说明审了什么、改了什么（或「自审无问题」）。不要 commit/push。若本轮未再改代码，下一轮会进入确认审查（每轮不同审查角度）。";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-tnorm-"));
}

function writeJsonl(file: string, rows: unknown[]): void {
  fs.writeFileSync(
    file,
    rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
}

function codexUserHook(text: string): unknown {
  return {
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: `<hook_prompt hook_run_id="stop:2:/proj/.codex/hooks.json">${text}</hook_prompt>`,
        },
      ],
    },
  };
}

function codexAssistant(text: string): unknown {
  return {
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text }],
    },
  };
}

describe("host transcript normalize", () => {
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
      platform: "codex",
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

  it("matches pending inside a single-line <hook_prompt> wrapper", () => {
    writeJsonl(transcript, [
      {
        role: "user",
        message: {
          content: [
            {
              type: "text",
              text: `<hook_prompt hook_run_id="stop:1">${FIX_ZH}</hook_prompt>`,
            },
          ],
        },
      },
      {
        role: "assistant",
        message: { content: [{ type: "text", text: "自审无问题" }] },
      },
    ]);
    const events = readTranscriptTail(transcript);
    expect(automationFollowupPresent(events, FIX_ZH)).toBe(true);
    expect(followupInFlight(events)).toBe(false);
  });

  it("unwraps Codex response_item payload + input_text + hook_prompt", () => {
    writeJsonl(transcript, [
      codexUserHook(FIX_ZH),
      {
        type: "event_msg",
        payload: {
          type: "item_completed",
          item: {
            type: "HookPrompt",
            fragments: [{ text: FIX_ZH, hookRunId: "stop:2" }],
          },
        },
      },
      codexAssistant("自审无问题"),
    ]);
    const events = readTranscriptTail(transcript);
    expect(automationFollowupPresent(events, FIX_ZH)).toBe(true);
    expect(followupInFlight(events)).toBe(false);
  });

  it("matches Claude type:user text amid tool_result user rows", () => {
    writeJsonl(transcript, [
      {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: FIX_ZH }],
        },
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_1",
              content: "ok",
            },
            // Decoy: if this row is kept as user, it becomes the latest tip
            // and must not satisfy automationFollowupPresent.
            { type: "text", text: "Read output from tool" },
          ],
        },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "done" }],
        },
      },
    ]);
    const events = readTranscriptTail(transcript);
    expect(automationFollowupPresent(events, FIX_ZH)).toBe(true);
  });

  it("still sees the hook when more than TRANSCRIPT_TAIL_EVENTS raw tool rows follow", () => {
    const rows: unknown[] = [codexUserHook(FIX_ZH)];
    for (let i = 0; i < TRANSCRIPT_TAIL_EVENTS + 5; i++) {
      rows.push({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: `call_${i}`,
              content: `noise-${i}`,
            },
            { type: "text", text: `tool stdout ${i}` },
          ],
        },
      });
    }
    rows.push(codexAssistant("ack"));
    writeJsonl(transcript, rows);
    const events = readTranscriptTail(transcript);
    expect(automationFollowupPresent(events, FIX_ZH)).toBe(true);
  });

  it("does not match compacted replacement_history of an older fix round", () => {
    const oldFix = FIX_ZH.replace("第 4 轮", "第 1 轮");
    writeJsonl(transcript, [
      {
        type: "compacted",
        payload: {
          replacement_history: [
            {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: oldFix }],
            },
          ],
        },
      },
      {
        role: "assistant",
        message: { content: [{ type: "text", text: "working" }] },
      },
    ]);
    const events = readTranscriptTail(transcript);
    expect(automationFollowupPresent(events, oldFix)).toBe(false);
    expect(automationFollowupPresent(events, FIX_ZH)).toBe(false);
  });

  it("does not treat Antigravity USER_INPUT as missing", () => {
    writeJsonl(transcript, [
      { USER_INPUT: `<USER_REQUEST>\n${FIX_ZH}\n</USER_REQUEST>` },
      {
        role: "assistant",
        message: { content: [{ type: "text", text: "ok" }] },
      },
    ]);
    const events = readTranscriptTail(transcript);
    expect(automationFollowupPresent(events, FIX_ZH)).toBe(true);
  });

  it("keeps Cursor turn_ended so in-flight closes and orphan error remains visible", () => {
    const pending = "Review confirm 1/5 (session round 3).";
    writeJsonl(transcript, [
      {
        role: "user",
        message: {
          content: [{ type: "text", text: `<user_query>\n${pending}\n</user_query>` }],
        },
      },
      { type: "turn_ended", status: "completed" },
      {
        role: "assistant",
        message: { content: [{ type: "text", text: "acked" }] },
      },
    ]);
    let events = readTranscriptTail(transcript);
    expect(followupInFlight(events)).toBe(false);
    expect(automationFollowupPresent(events, pending)).toBe(true);

    writeJsonl(transcript, [
      {
        role: "user",
        message: {
          content: [
            {
              type: "text",
              text: "<user_query>\nReview fix round 1/5.\n</user_query>",
            },
          ],
        },
      },
      { type: "turn_ended", status: "error" },
    ]);
    events = readTranscriptTail(transcript);
    expect(transcriptHasUnresolvedTurnEndedError(events)).toBe(true);
  });

  it("handleStop does not redeliver a Codex-shaped delivered fix tip", () => {
    store.updateReviewChain("c1", {
      confirm_left: null,
      chain_pending: 1,
      code_edited: 0,
      fix_round: 4,
      pending_followup: FIX_ZH,
      pending_followup_at: new Date().toISOString(),
      pending_redeliver_at: null,
    });
    writeJsonl(transcript, [codexUserHook(FIX_ZH), codexAssistant("自审无问题")]);
    const out = engine().handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 1,
      transcriptPath: transcript,
    });
    expect(out?.meta?.redeliver).not.toBe(true);
    expect(out?.kind).toBe("review.confirm");
    expect(out?.message).not.toBe(FIX_ZH);
    const chain = store.getReviewChain("c1")!;
    expect(chain.pending_followup?.trim()).not.toBe(FIX_ZH);
    expect(chain.confirm_left).toBe(4);
    expect(chain.fix_round).toBe(5);
  });

  it("still redelivers when the window has no matching tip", () => {
    store.updateReviewChain("c1", {
      confirm_left: null,
      chain_pending: 1,
      code_edited: 0,
      fix_round: 4,
      pending_followup: FIX_ZH,
      pending_followup_at: new Date().toISOString(),
      pending_redeliver_at: null,
    });
    writeJsonl(transcript, [
      {
        role: "assistant",
        message: { content: [{ type: "text", text: "unrelated" }] },
      },
    ]);
    const out = engine().handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 1,
      transcriptPath: transcript,
    });
    expect(out?.meta?.redeliver).toBe(true);
    expect(out?.message).toBe(FIX_ZH);
  });
});
