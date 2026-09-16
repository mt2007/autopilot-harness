import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ReviewEngine, StateStore } from "@autopilot-harness/core";
import {
  ANTIGRAVITY_EVENTS,
  ANTIGRAVITY_HOOK_BLOCK_NAME,
  ANTIGRAVITY_PLATFORM,
  ANTIGRAVITY_POST_TOOL_MATCHER,
  ANTIGRAVITY_PRE_INVOCATION_HAS_PROMPT,
  ANTIGRAVITY_STOP_CONTINUE,
  ANTIGRAVITY_STOP_CONTINUE_DOCS_SUPPORTED,
  ANTIGRAVITY_STOP_CAP_RAISE_FOUND,
  ANTIGRAVITY_TIMEOUT_SEC,
  ANTIGRAVITY_TRIGGER_SOURCE,
  filePathsFromAntigravityEdit,
  handleAntigravityPostToolUse,
  handleAntigravityPreInvocation,
  handleAntigravityStop,
  handlePostToolUse,
  handlePreInvocation,
  handleStop,
  injectEphemeral,
  injectNeedPickContext,
  isAntigravityAllowNoop,
  isAntigravityEditTool,
  isAntigravityFullyIdle,
  isAntigravityStopCompletionReason,
  latestUserPromptFromTranscriptText,
  loopCountFromExecutionNum,
  normalizeAntigravityStopStatus,
  resolveAntigravityUserPrompt,
  resolveAntigravityWorkspaceRoot,
  sanitizeAntigravityTranscriptPath,
  shouldClearChainPendingOnAntigravityPreInvocation,
  shouldProcessAntigravityUserPrompt,
  claimAntigravityUserPrompt,
  rollbackAntigravityUserPromptClaim,
  persistAntigravityUserPromptBestEffort,
  isSafeAntigravityCursorProjectRoot,
} from "../src/index.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-agy-port-"));
}

function writeChecklist(root: string, slug: string, body: string): string {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plan.md"), `# ${slug}\n`);
  const cp = path.join(dir, "checklist.md");
  fs.writeFileSync(cp, body);
  return cp;
}

describe("port-antigravity adapters", () => {
  it("documents constants and aliases", () => {
    expect(ANTIGRAVITY_PLATFORM).toBe("antigravity");
    expect(ANTIGRAVITY_HOOK_BLOCK_NAME).toBe("autopilot-harness");
    expect(ANTIGRAVITY_EVENTS).toEqual([
      "PreInvocation",
      "PostToolUse",
      "Stop",
    ]);
    expect(ANTIGRAVITY_STOP_CONTINUE).toBe("decision:continue+reason");
    expect(ANTIGRAVITY_PRE_INVOCATION_HAS_PROMPT).toBe(false);
    expect(ANTIGRAVITY_TRIGGER_SOURCE).toBe("transcriptPath+statefulCursor");
    expect(ANTIGRAVITY_STOP_CONTINUE_DOCS_SUPPORTED).toBe(true);
    expect(ANTIGRAVITY_STOP_CAP_RAISE_FOUND).toBe(false);
    expect(ANTIGRAVITY_POST_TOOL_MATCHER).toBe(
      "write_to_file|replace_file_content|multi_replace_file_content",
    );
    expect(ANTIGRAVITY_TIMEOUT_SEC).toBe(120);
    expect(handleAntigravityPreInvocation).toBe(handlePreInvocation);
    expect(handleAntigravityPostToolUse).toBe(handlePostToolUse);
    expect(handleAntigravityStop).toBe(handleStop);
    expect(isAntigravityEditTool("write_to_file")).toBe(true);
    expect(isAntigravityEditTool("replace_file_content")).toBe(true);
    expect(isAntigravityEditTool("multi_replace_file_content")).toBe(true);
    expect(isAntigravityEditTool("run_command")).toBe(false);
    expect(isAntigravityAllowNoop({})).toBe(true);
    expect(
      isAntigravityAllowNoop({ decision: "continue", reason: "x" }),
    ).toBe(false);
  });

  it("resolves workspace root without process.cwd", () => {
    expect(
      resolveAntigravityWorkspaceRoot({
        installRoot: "/proj",
        workspacePaths: ["/other"],
      }),
    ).toBe("/proj");
    expect(
      resolveAntigravityWorkspaceRoot({
        workspacePaths: ["/ws"],
      }),
    ).toBe("/ws");
    expect(
      resolveAntigravityWorkspaceRoot({
        workspace_paths: ["/snake"],
      }),
    ).toBe("/snake");
    expect(
      resolveAntigravityWorkspaceRoot({
        workspacePaths: ["/proj/../etc"],
      }),
    ).toBeNull();
    expect(resolveAntigravityWorkspaceRoot({})).toBeNull();
  });

  it("parses transcript user prompts and wrappers", () => {
    const raw = [
      JSON.stringify({ role: "assistant", text: "hi" }),
      JSON.stringify({
        role: "user",
        text: "<USER_REQUEST>\nAutopilot ON\n</USER_REQUEST>",
      }),
    ].join("\n");
    expect(latestUserPromptFromTranscriptText(raw)).toBe("Autopilot ON");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({ USER_INPUT: "Autopilot RUN from field" }),
      ),
    ).toBe("Autopilot RUN from field");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "user",
          content: [{ type: "text", text: "part-a" }, { text: "part-b" }],
        }),
      ),
    ).toBe("part-a\npart-b");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({ USER_INPUT: true, role: "user" }),
      ),
    ).toBe("");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({ USER_INPUT: false, text: "not-user" }),
      ),
    ).toBe("");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({ USER_INPUT: true, text: "flagged-user" }),
      ),
    ).toBe("flagged-user");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          USER_INPUT: "field-wins",
          text: "sibling-text",
        }),
      ),
    ).toBe("field-wins");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          USER_INPUT: "   ",
          text: "sibling-after-blank-field",
          role: "user",
        }),
      ),
    ).toBe("sibling-after-blank-field");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          USER_INPUT: "   ",
          text: "sibling-no-role",
        }),
      ),
    ).toBe("sibling-no-role");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "assistant",
          USER_INPUT: "   ",
          text: "asst-leak",
        }),
      ),
    ).toBe("");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "system",
          USER_INPUT: "should-not-leak",
          text: "sys-text",
        }),
      ),
    ).toBe("");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "",
          type: "assistant",
          USER_INPUT: "   ",
          text: "empty-role-type-leak",
        }),
      ),
    ).toBe("");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "assistant_user",
          text: "assistant-user-leak",
        }),
      ),
    ).toBe("");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "function",
          USER_INPUT: true,
          text: "function-leak",
        }),
      ),
    ).toBe("");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "model_turn",
          USER_INPUT: true,
          text: "model-turn-leak",
        }),
      ),
    ).toBe("");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "function_call",
          USER_INPUT: true,
          text: "function-call-leak",
        }),
      ),
    ).toBe("");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "event",
          type: "user",
          text: "type-user-wins",
        }),
      ),
    ).toBe("type-user-wins");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "user",
          type: "model_request",
          text: "role-user-beats-type",
        }),
      ),
    ).toBe("role-user-beats-type");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "user",
          type: "assistant",
          text: "role-user-authoritative",
        }),
      ),
    ).toBe("role-user-authoritative");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "malfunction",
          USER_INPUT: true,
          text: "malfunction-not-function",
        }),
      ),
    ).toBe("malfunction-not-function");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "ModelResponse",
          USER_INPUT: true,
          text: "camel-model-leak",
        }),
      ),
    ).toBe("");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "toolresult",
          USER_INPUT: true,
          text: "glued-tool-leak",
        }),
      ),
    ).toBe("");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "toolbox",
          USER_INPUT: true,
          text: "toolbox-not-tool",
        }),
      ),
    ).toBe("toolbox-not-tool");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          type: "subsystem",
          USER_INPUT: true,
          text: "subsystem-leak",
        }),
      ),
    ).toBe("");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "agents",
          USER_INPUT: true,
          text: "agents-plural-leak",
        }),
      ),
    ).toBe("");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "coagent",
          USER_INPUT: true,
          text: "coagent-leak",
        }),
      ),
    ).toBe("");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "humanerror",
          text: "humanerror-not-user",
        }),
      ),
    ).toBe("");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "humanerror",
          USER_INPUT: true,
          text: "humanerror-key-leak",
        }),
      ),
    ).toBe("");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "HumanError",
          USER_INPUT: true,
          text: "HumanError-camel-leak",
        }),
      ),
    ).toBe("");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "user_error",
          USER_INPUT: true,
          text: "user_error-leak",
        }),
      ),
    ).toBe("");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "users_error",
          USER_INPUT: true,
          text: "users_error-leak",
        }),
      ),
    ).toBe("");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "error_user",
          text: "error_user-leak",
        }),
      ),
    ).toBe("");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "error_message",
          USER_INPUT: true,
          text: "error_message-leak",
        }),
      ),
    ).toBe("");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "errors",
          USER_INPUT: true,
          text: "errors-alone-leak",
        }),
      ),
    ).toBe("");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "result",
          USER_INPUT: true,
          text: "result-alone-leak",
        }),
      ),
    ).toBe("");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          type: "output",
          USER_INPUT: true,
          text: "output-alone-leak",
        }),
      ),
    ).toBe("");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "user",
          type: "result",
          text: "role-user-beats-result-type",
        }),
      ),
    ).toBe("role-user-beats-result-type");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "input",
          USER_INPUT: true,
          text: "bare-input-leak",
        }),
      ),
    ).toBe("");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          type: "request",
          USER_INPUT: true,
          text: "bare-request-leak",
        }),
      ),
    ).toBe("");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "prompt",
          USER_INPUT: true,
          text: "bare-prompt-leak",
        }),
      ),
    ).toBe("");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "query",
          USER_INPUT: true,
          text: "bare-query-leak",
        }),
      ),
    ).toBe("");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "users_input",
          text: "users_input-still-user",
        }),
      ),
    ).toBe("users_input-still-user");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "user_input",
          text: "user_input-still-user",
        }),
      ),
    ).toBe("user_input-still-user");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "userinput",
          text: "userinput-still-user",
        }),
      ),
    ).toBe("userinput-still-user");
    expect(
      latestUserPromptFromTranscriptText(
        JSON.stringify({
          role: "user",
          message: { text: "nested-message-text" },
        }),
      ),
    ).toBe("nested-message-text");
    expect(
      resolveAntigravityUserPrompt(
        { conversationId: "c1" },
        { userPrompt: "  Autopilot RUN  " },
      ),
    ).toBe("Autopilot RUN");
  });

  it("fullyIdle and completion gates", () => {
    expect(isAntigravityFullyIdle({ fullyIdle: true })).toBe(true);
    expect(isAntigravityFullyIdle({ fully_idle: true })).toBe(true);
    expect(isAntigravityFullyIdle({ fullyIdle: false })).toBe(false);
    expect(isAntigravityFullyIdle({})).toBe(false);
    expect(
      isAntigravityStopCompletionReason({ terminationReason: "model_stop" }),
    ).toBe(true);
    expect(
      isAntigravityStopCompletionReason({
        terminationReason: "max_steps_exceeded",
      }),
    ).toBe(false);
    expect(
      isAntigravityStopCompletionReason({
        terminationReason: "weird_host_reason",
      }),
    ).toBe(false);
    expect(loopCountFromExecutionNum({ executionNum: 1 })).toBe(0);
    expect(loopCountFromExecutionNum({ executionNum: 2 })).toBe(1);
    expect(loopCountFromExecutionNum({ executionNum: "2" as unknown as number })).toBe(
      1,
    );
    expect(
      normalizeAntigravityStopStatus({ terminationReason: "model_stop" }),
    ).toBe("completed");
    expect(
      normalizeAntigravityStopStatus({
        terminationReason: "max_steps_exceeded",
      }),
    ).toBe("error");
    expect(
      normalizeAntigravityStopStatus({ terminationReason: "timeout" }),
    ).toBe("error");
    expect(
      normalizeAntigravityStopStatus({ error: "tool blew up" }),
    ).toBe("error");
    expect(
      normalizeAntigravityStopStatus({
        error: { message: "host object failure" },
      }),
    ).toBe("error");
    expect(
      normalizeAntigravityStopStatus({
        error: { code: 500, status: "FAILED" },
      }),
    ).toBe("error");
    expect(
      normalizeAntigravityStopStatus({
        error: [{ message: "ignored" }, "array failure"],
      }),
    ).toBe("error");
    expect(
      normalizeAntigravityStopStatus({
        error: [{ message: "object-only array failure" }],
      }),
    ).toBe("error");
    expect(
      normalizeAntigravityStopStatus({
        error: [42, true],
      }),
    ).toBe("error");
    expect(normalizeAntigravityStopStatus({ error: [] })).toBe("completed");
    expect(
      normalizeAntigravityStopStatus({
        error: { error: { message: "nested host failure" } },
      }),
    ).toBe("error");
    expect(normalizeAntigravityStopStatus({ error: {} })).toBe("completed");
    {
      const circular: Record<string, unknown> = { code: 1 };
      circular.error = circular;
      expect(normalizeAntigravityStopStatus({ error: circular })).toBe("error");
    }
    expect(
      normalizeAntigravityStopStatus({
        error: "x".repeat(20_000),
      }),
    ).toBe("error");
    expect(
      normalizeAntigravityStopStatus({
        error: `${"x".repeat(20_000)}user aborted`,
      }),
    ).toBe("aborted");
    expect(
      normalizeAntigravityStopStatus({
        error: `${"x".repeat(9_000)}user aborted${"y".repeat(9_000)}`,
      }),
    ).toBe("aborted");
    expect(
      normalizeAntigravityStopStatus({
        terminationReason: "model_stop",
        error: { message: "prior tool warning" },
      }),
    ).toBe("completed");
    expect(
      normalizeAntigravityStopStatus({
        terminationReason: "model_stop",
        error: "prior tool warning",
      }),
    ).toBe("completed");
    expect(
      normalizeAntigravityStopStatus(
        { error: "stale host warning" },
        { status: "completed" },
      ),
    ).toBe("completed");
    expect(
      normalizeAntigravityStopStatus(
        { terminationReason: "interrupted manually by user" },
        { status: "completed" },
      ),
    ).toBe("aborted");
    expect(
      normalizeAntigravityStopStatus({ error: "  " }),
    ).toBe("completed");
  });

  it("does not clear chain_pending on mid-turn PreInvocation", () => {
    expect(
      shouldClearChainPendingOnAntigravityPreInvocation(
        { invocationNum: 2 },
        "hello",
      ),
    ).toBe(false);
    expect(
      shouldClearChainPendingOnAntigravityPreInvocation(
        {},
        "hello",
      ),
    ).toBe(false);
    expect(
      shouldClearChainPendingOnAntigravityPreInvocation(
        { invocationNum: 0 },
        "",
      ),
    ).toBe(false);
    expect(
      shouldClearChainPendingOnAntigravityPreInvocation(
        { invocationNum: 0 },
        "hello",
      ),
    ).toBe(true);
    expect(
      shouldClearChainPendingOnAntigravityPreInvocation(
        { invocationNum: 0 },
        "hello",
        { hasUndeliveredPending: true },
      ),
    ).toBe(false);
    expect(
      shouldClearChainPendingOnAntigravityPreInvocation(
        { invocationNum: 1, initialNumSteps: 0 },
        "hello",
      ),
    ).toBe(true);
    expect(
      shouldClearChainPendingOnAntigravityPreInvocation(
        { invocationNum: 1 },
        "hello",
      ),
    ).toBe(false);
    // Host JSON bridges may stringify counters — still clear on turn start.
    expect(
      shouldClearChainPendingOnAntigravityPreInvocation(
        { invocationNum: "0" as unknown as number },
        "hello",
      ),
    ).toBe(true);
    expect(
      shouldClearChainPendingOnAntigravityPreInvocation(
        {
          invocationNum: "1" as unknown as number,
          initialNumSteps: "0" as unknown as number,
        },
        "hello",
      ),
    ).toBe(true);
    expect(
      shouldClearChainPendingOnAntigravityPreInvocation(
        { invocationNum: "nope" as unknown as number },
        "hello",
      ),
    ).toBe(false);
    expect(
      shouldClearChainPendingOnAntigravityPreInvocation(
        { invocationNum: "0x10" as unknown as number },
        "hello",
      ),
    ).toBe(false);
    expect(
      shouldClearChainPendingOnAntigravityPreInvocation(
        { invocationNum: "1e0" as unknown as number, initialNumSteps: 0 },
        "hello",
      ),
    ).toBe(false);
    expect(loopCountFromExecutionNum({ executionNum: "2e1" as unknown as number })).toBe(
      0,
    );

    const root = tmpRoot();
    try {
      fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
      const store = new StateStore(root);
      store.upsertSession({
        conversation_id: "agy-clear",
        project_root: root,
        code_root: root,
        platform: ANTIGRAVITY_PLATFORM,
        phase: "executing",
      });
      // Undelivered pending must keep chain_pending even on invocation 0.
      store.updateReviewChain("agy-clear", {
        chain_pending: 1,
        pending_followup: "pending tip",
        pending_followup_at: new Date().toISOString(),
      });
      handlePreInvocation(
        store,
        {
          conversationId: "agy-clear",
          invocationNum: 0,
        },
        root,
        undefined,
        { userPrompt: "new user turn while tip pending" },
      );
      expect(store.getReviewChain("agy-clear")?.chain_pending).toBe(1);

      // E8: no undelivered tip → first-invocation clear ok.
      store.updateReviewChain("agy-clear", {
        chain_pending: 1,
        pending_followup: null,
        pending_followup_at: null,
      });
      handlePreInvocation(
        store,
        {
          conversationId: "agy-clear",
          invocationNum: 0,
        },
        root,
        undefined,
        { userPrompt: "another ordinary turn" },
      );
      expect(store.getReviewChain("agy-clear")?.chain_pending).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not clear undelivered recover tip on mid-turn duplicate PreInvocation", () => {
    const root = tmpRoot();
    try {
      fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
      const store = new StateStore(root);
      store.upsertSession({
        conversation_id: "agy-recover-keep",
        project_root: root,
        code_root: root,
        platform: ANTIGRAVITY_PLATFORM,
        phase: "executing",
        armed: 1,
      });
      const tip = "Recover: please retry the failed step.";
      store.updateReviewChain("agy-recover-keep", {
        chain_pending: 1,
        pending_followup: tip,
        pending_followup_at: new Date().toISOString(),
      });
      // First claim consumes the prompt.
      handlePreInvocation(
        store,
        { conversationId: "agy-recover-keep", invocationNum: 0 },
        root,
        undefined,
        { userPrompt: "ordinary user message" },
      );
      // Re-seed recover tip as if Stop just armed it after that prompt.
      store.updateReviewChain("agy-recover-keep", {
        chain_pending: 1,
        pending_followup: tip,
        pending_followup_at: new Date().toISOString(),
      });
      // Mid-turn re-entry with same transcript prompt must not wipe recover.
      handlePreInvocation(
        store,
        { conversationId: "agy-recover-keep", invocationNum: 2 },
        root,
        undefined,
        { userPrompt: "ordinary user message" },
      );
      expect(store.getReviewChain("agy-recover-keep")?.pending_followup).toBe(
        tip,
      );

      // A later distinct user prompt (UPS-equivalent) may clear recover/stuck.
      handlePreInvocation(
        store,
        { conversationId: "agy-recover-keep", invocationNum: 0 },
        root,
        undefined,
        { userPrompt: "brand new user turn after recover armed" },
      );
      expect(
        (store.getReviewChain("agy-recover-keep")?.pending_followup ?? "").trim(),
      ).toBe("");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("dedupes transcript-only PreInvocation prompts via durable cursor", () => {
    const root = tmpRoot();
    try {
      fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
      fs.mkdirSync(path.join(root, "logs"), { recursive: true });
      fs.writeFileSync(
        path.join(root, ".autopilot", "config.yml"),
        "platforms:\n  - id: antigravity\n    surface: cli\n",
      );
      writeChecklist(root, "demo", "# Checklist\n\n- [ ] a — A\n");
      const prompt = "Autopilot ON demo track";
      expect(
        shouldProcessAntigravityUserPrompt({
          projectRoot: root,
          conversationId: "agy-cursor",
          prompt,
          explicit: false,
        }),
      ).toBe(true);
      expect(
        shouldProcessAntigravityUserPrompt({
          projectRoot: root,
          conversationId: "agy-cursor",
          prompt,
          explicit: false,
        }),
      ).toBe(false);
      expect(
        shouldProcessAntigravityUserPrompt({
          projectRoot: root,
          conversationId: "agy-cursor",
          prompt: "Autopilot RUN demo",
          explicit: false,
        }),
      ).toBe(true);

      const tp = path.join(root, "logs", "transcript.jsonl");
      fs.writeFileSync(
        tp,
        `${JSON.stringify({ role: "user", text: "Autopilot ON demo track" })}\n`,
      );
      // Bare basename outside /logs/ must not be read.
      const decoy = path.join(root, "transcript.jsonl");
      fs.writeFileSync(
        decoy,
        `${JSON.stringify({ role: "user", text: "Autopilot ON decoy" })}\n`,
      );
      expect(
        resolveAntigravityUserPrompt({
          conversationId: "x",
          transcriptPath: decoy,
        }),
      ).toBe("");
      expect(
        sanitizeAntigravityTranscriptPath("/tmp/secret.env"),
      ).toBeUndefined();
      expect(
        sanitizeAntigravityTranscriptPath("logs/transcript.jsonl"),
      ).toBeUndefined();
      expect(
        sanitizeAntigravityTranscriptPath("rel/logs/transcript.jsonl"),
      ).toBeUndefined();
      expect(
        sanitizeAntigravityTranscriptPath(tp + "/"),
      ).toBe(tp.replace(/\\/g, "/"));

      const store = new StateStore(root);
      const first = handlePreInvocation(
        store,
        {
          conversationId: "agy-on",
          transcriptPath: tp,
        },
        root,
      );
      expect(isAntigravityAllowNoop(first) || Boolean(first.injectSteps)).toBe(
        true,
      );
      expect(store.getSession("agy-on")?.phase).toBe("planning");
      const phaseAfterFirst = store.getSession("agy-on")?.phase;
      // Same transcript prompt again must not re-enter applyOn path.
      handlePreInvocation(
        store,
        {
          conversationId: "agy-on",
          transcriptPath: tp,
          invocationNum: 2,
        },
        root,
      );
      expect(store.getSession("agy-on")?.phase).toBe(phaseAfterFirst);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("dedupes repeated explicit userPrompt (runner re-attach)", () => {
    const root = tmpRoot();
    try {
      fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
      fs.writeFileSync(
        path.join(root, ".autopilot", "config.yml"),
        "platforms:\n  - id: antigravity\n    surface: cli\n",
      );
      writeChecklist(root, "demo", "# Checklist\n\n- [ ] a — A\n");
      const store = new StateStore(root);
      const prompt = "Autopilot ON demo track";
      handlePreInvocation(
        store,
        { conversationId: "agy-exp" },
        root,
        undefined,
        { userPrompt: prompt },
      );
      expect(store.getSession("agy-exp")?.phase).toBe("planning");
      expect(
        shouldProcessAntigravityUserPrompt({
          projectRoot: root,
          conversationId: "agy-exp",
          prompt,
          explicit: true,
        }),
      ).toBe(false);
      // Same attached prompt again must not re-enter applyOn.
      handlePreInvocation(
        store,
        { conversationId: "agy-exp", invocationNum: 2 },
        root,
        undefined,
        { userPrompt: prompt },
      );
      expect(store.getSession("agy-exp")?.phase).toBe("planning");
      // OFF then same ON text must process again (cursor advanced by OFF).
      handlePreInvocation(
        store,
        { conversationId: "agy-exp" },
        root,
        undefined,
        { userPrompt: "Autopilot OFF" },
      );
      handlePreInvocation(
        store,
        { conversationId: "agy-exp" },
        root,
        undefined,
        { userPrompt: prompt },
      );
      expect(store.getSession("agy-exp")?.phase).toBe("planning");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("extracts TargetFile from toolCall.args", () => {
    expect(
      filePathsFromAntigravityEdit({
        toolCall: {
          name: "write_to_file",
          args: { TargetFile: "/proj/a.ts", CodeContent: "x" },
        },
      }),
    ).toEqual(["/proj/a.ts"]);
    expect(
      filePathsFromAntigravityEdit({
        toolCall: {
          name: "write_to_file",
          args: { TargetFile: "/proj/../etc/passwd" },
        },
      }),
    ).toEqual([]);
    expect(isAntigravityEditTool(null)).toBe(false);
  });

  it("keeps prompt claim after successful apply if later stamp throws", () => {
    const root = tmpRoot();
    try {
      fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
      fs.writeFileSync(
        path.join(root, ".autopilot", "config.yml"),
        "platforms:\n  - id: antigravity\n    surface: cli\n",
      );
      const store = new StateStore(root);
      store.upsertSession({
        conversation_id: "agy-partial",
        project_root: root,
        code_root: root,
        phase: "planning",
        platform: "cursor",
        armed: 1,
      });
      const prompt = "Autopilot OFF";
      const origUpsert = store.upsertSession.bind(store);
      store.upsertSession = ((partial) => {
        // Stamp runs after applyOff marks committed — simulate post-apply failure.
        if (partial.platform === ANTIGRAVITY_PLATFORM) {
          throw new Error("post-apply stamp boom");
        }
        return origUpsert(partial);
      }) as typeof store.upsertSession;

      handlePreInvocation(
        store,
        { conversationId: "agy-partial" },
        root,
        undefined,
        { userPrompt: prompt },
      );
      store.upsertSession = origUpsert;
      expect(store.getSession("agy-partial")?.armed).toBe(0);
      expect(
        claimAntigravityUserPrompt({
          projectRoot: root,
          conversationId: "agy-partial",
          prompt,
          explicit: true,
        }).status,
      ).toBe("duplicate");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps injectEphemeral when stamp throws after a failed apply", () => {
    const root = tmpRoot();
    try {
      fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
      fs.writeFileSync(
        path.join(root, ".autopilot", "config.yml"),
        "platforms:\n  - id: antigravity\n    surface: cli\n",
      );
      const store = new StateStore(root);
      // ON while executing fails closed without writing platform — stamp still runs.
      store.upsertSession({
        conversation_id: "agy-stamp-fail",
        project_root: root,
        code_root: root,
        phase: "executing",
        platform: "cursor",
        track_id: "demo",
        armed: 1,
      });
      const origUpsert = store.upsertSession.bind(store);
      store.upsertSession = ((partial) => {
        if (partial.platform === ANTIGRAVITY_PLATFORM) {
          throw new Error("stamp boom after failed on");
        }
        return origUpsert(partial);
      }) as typeof store.upsertSession;
      const prompt = "Autopilot ON other";
      const out = handlePreInvocation(
        store,
        { conversationId: "agy-stamp-fail" },
        root,
        undefined,
        { userPrompt: prompt },
      );
      expect(Boolean(out.injectSteps)).toBe(true);
      expect(String(out.injectSteps?.[0]?.ephemeralMessage ?? "")).toMatch(
        /OFF|REPLAN|RESUME|executing/i,
      );
      store.upsertSession = origUpsert;
      expect(store.getSession("agy-stamp-fail")?.phase).toBe("executing");
      expect(
        claimAntigravityUserPrompt({
          projectRoot: root,
          conversationId: "agy-stamp-fail",
          prompt,
          explicit: true,
        }).status,
      ).toBe("claimed");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("needPick consumes prompt claim so transcript re-reads do not re-fire", () => {
    const root = tmpRoot();
    try {
      fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
      fs.writeFileSync(
        path.join(root, ".autopilot", "config.yml"),
        "platforms:\n  - id: antigravity\n    surface: cli\n",
      );
      writeChecklist(root, "alpha", "# Checklist\n\n- [ ] a — A\n");
      writeChecklist(root, "beta", "# Checklist\n\n- [ ] b — B\n");
      // Constructor arg is project root (not the db file path).
      const store = new StateStore(root);
      const prompt = "Autopilot RUN";
      const out = handlePreInvocation(
        store,
        { conversationId: "agy-needpick" },
        root,
        undefined,
        { userPrompt: prompt },
      );
      expect(Boolean(out.injectSteps)).toBe(true);
      expect(String(out.injectSteps?.[0]?.ephemeralMessage ?? "")).toMatch(
        /Select a plan/i,
      );
      expect(store.getSession("agy-needpick")?.pending_action).toBe("run");
      // Same USER_INPUT must stay claimed (not rolled back) after Channel A pick.
      expect(
        claimAntigravityUserPrompt({
          projectRoot: root,
          conversationId: "agy-needpick",
          prompt,
          explicit: true,
        }).status,
      ).toBe("duplicate");
      const again = handlePreInvocation(
        store,
        { conversationId: "agy-needpick", invocationNum: 1 },
        root,
        undefined,
        { userPrompt: prompt },
      );
      expect(again).toEqual({});
      expect(store.getSession("agy-needpick")?.pending_action).toBe("run");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rolls back prompt cursor when trigger apply fails", () => {
    const root = tmpRoot();
    try {
      fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
      fs.writeFileSync(
        path.join(root, ".autopilot", "config.yml"),
        "platforms:\n  - id: antigravity\n    surface: cli\n",
      );
      // No plans → hard fail (not Channel A needPick) and release claim for retry.
      const store = new StateStore(root);
      const prompt = "Autopilot RUN";
      const first = handlePreInvocation(
        store,
        { conversationId: "agy-retry" },
        root,
        undefined,
        { userPrompt: prompt },
      );
      expect(Boolean(first.injectSteps)).toBe(true);
      expect(String(first.injectSteps?.[0]?.ephemeralMessage ?? "")).toMatch(
        /No runnable plan|No plan/i,
      );
      expect(store.getSession("agy-retry")?.pending_action ?? null).toBe(null);
      // Same text must be claimable again after failed apply.
      expect(
        claimAntigravityUserPrompt({
          projectRoot: root,
          conversationId: "agy-retry",
          prompt,
          explicit: true,
        }).status,
      ).toBe("claimed");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates .autopilot before lock so first claim persists and duplicates", () => {
    const root = tmpRoot();
    try {
      // Fresh project root — no .autopilot yet (lock open must not ENOENT).
      expect(fs.existsSync(path.join(root, ".autopilot"))).toBe(false);
      const first = claimAntigravityUserPrompt({
        projectRoot: root,
        conversationId: "agy-fresh",
        prompt: "Autopilot ON",
        explicit: true,
      });
      expect(first.status).toBe("claimed");
      expect(
        fs.existsSync(
          path.join(
            root,
            ".autopilot",
            "antigravity-preinvocation-cursor.json",
          ),
        ),
      ).toBe(true);
      const second = claimAntigravityUserPrompt({
        projectRoot: root,
        conversationId: "agy-fresh",
        prompt: "Autopilot ON",
        explicit: true,
      });
      expect(second.status).toBe("duplicate");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not fail-open claim when project root is unsafe or .autopilot is not a dir", () => {
    expect(
      claimAntigravityUserPrompt({
        projectRoot: "",
        conversationId: "agy-unsafe",
        prompt: "Autopilot ON",
        explicit: true,
      }).status,
    ).toBe("unavailable");
    expect(
      claimAntigravityUserPrompt({
        projectRoot: "/tmp/foo/../bar",
        conversationId: "agy-unsafe",
        prompt: "Autopilot ON",
        explicit: true,
      }).status,
    ).toBe("unavailable");
    const root = tmpRoot();
    try {
      fs.writeFileSync(path.join(root, ".autopilot"), "not-a-directory");
      expect(
        claimAntigravityUserPrompt({
          projectRoot: root,
          conversationId: "agy-bad-dir",
          prompt: "Autopilot ON",
          explicit: true,
        }).status,
      ).toBe("unavailable");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns unavailable (no throw) when .autopilot is a symlink", () => {
    const root = tmpRoot();
    const target = tmpRoot();
    try {
      fs.symlinkSync(target, path.join(root, ".autopilot"));
      expect(
        claimAntigravityUserPrompt({
          projectRoot: root,
          conversationId: "agy-symlink",
          prompt: "Autopilot ON",
          explicit: true,
        }).status,
      ).toBe("unavailable");
      expect(() =>
        rollbackAntigravityUserPromptClaim({
          projectRoot: root,
          conversationId: "agy-symlink",
          previous: null,
          expected: "Autopilot ON",
        }),
      ).not.toThrow();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  it("fail-open claim is marked not persisted so rollback cannot wipe durable cursor", () => {
    const root = tmpRoot();
    try {
      fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
      // Durable claim first.
      expect(
        claimAntigravityUserPrompt({
          projectRoot: root,
          conversationId: "agy-fo",
          prompt: "Autopilot ON",
          explicit: true,
        }).status,
      ).toBe("claimed");
      // Simulate lock contention: hold the lock file so the next claim fail-opens.
      const lockPath = path.join(
        root,
        ".autopilot",
        "antigravity-preinvocation-cursor.json.lock",
      );
      fs.writeFileSync(lockPath, "");
      // Same prompt must stay duplicate even under lock contention.
      expect(
        claimAntigravityUserPrompt({
          projectRoot: root,
          conversationId: "agy-fo",
          prompt: "Autopilot ON",
          explicit: true,
        }).status,
      ).toBe("duplicate");
      const ephemeral = claimAntigravityUserPrompt({
        projectRoot: root,
        conversationId: "agy-fo",
        prompt: "Autopilot RUN other",
        explicit: true,
      });
      expect(ephemeral.status).toBe("claimed");
      if (ephemeral.status === "claimed") {
        expect(ephemeral.persisted).toBe(false);
      }
      // Stale-style rollback as if the fail-open apply failed — must not delete
      // the durable "Autopilot ON" entry (expected mismatches / no-op for non-persisted
      // is enforced at the PreInvocation layer; here ensure durable still duplicates).
      rollbackAntigravityUserPromptClaim({
        projectRoot: root,
        conversationId: "agy-fo",
        previous: null,
        expected: "Autopilot RUN other",
      });
      fs.unlinkSync(lockPath);
      expect(
        claimAntigravityUserPrompt({
          projectRoot: root,
          conversationId: "agy-fo",
          prompt: "Autopilot ON",
          explicit: true,
        }).status,
      ).toBe("duplicate");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists ephemeral fail-open prompt after successful commit best-effort", () => {
    const root = tmpRoot();
    try {
      fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
      const lockPath = path.join(
        root,
        ".autopilot",
        "antigravity-preinvocation-cursor.json.lock",
      );
      fs.writeFileSync(lockPath, "");
      const ephemeral = claimAntigravityUserPrompt({
        projectRoot: root,
        conversationId: "agy-persist",
        prompt: "Autopilot ON ephemeral",
        explicit: true,
      });
      expect(ephemeral.status).toBe("claimed");
      if (ephemeral.status === "claimed") {
        expect(ephemeral.persisted).toBe(false);
      }
      fs.unlinkSync(lockPath);
      persistAntigravityUserPromptBestEffort({
        projectRoot: root,
        conversationId: "agy-persist",
        prompt: "Autopilot ON ephemeral",
      });
      expect(
        claimAntigravityUserPrompt({
          projectRoot: root,
          conversationId: "agy-persist",
          prompt: "Autopilot ON ephemeral",
          explicit: true,
        }).status,
      ).toBe("duplicate");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips rollback when cursor was advanced by a concurrent claim", () => {
    const root = tmpRoot();
    try {
      fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
      const first = claimAntigravityUserPrompt({
        projectRoot: root,
        conversationId: "agy-race",
        prompt: "first",
        explicit: true,
      });
      expect(first.status).toBe("claimed");
      const second = claimAntigravityUserPrompt({
        projectRoot: root,
        conversationId: "agy-race",
        prompt: "second",
        explicit: true,
      });
      expect(second.status).toBe("claimed");
      // Stale rollback for "first" must not wipe "second".
      rollbackAntigravityUserPromptClaim({
        projectRoot: root,
        conversationId: "agy-race",
        previous: null,
        expected: "first",
      });
      expect(
        claimAntigravityUserPrompt({
          projectRoot: root,
          conversationId: "agy-race",
          prompt: "second",
          explicit: true,
        }).status,
      ).toBe("duplicate");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("PreInvocation ON with attached userPrompt (not stdin field)", () => {
    const root = tmpRoot();
    try {
      fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
      fs.writeFileSync(
        path.join(root, ".autopilot", "config.yml"),
        "platforms:\n  - id: antigravity\n    surface: cli\n",
      );
      writeChecklist(root, "demo", "# Checklist\n\n- [ ] a — A\n");
      const store = new StateStore(root);
      const out = handlePreInvocation(
        store,
        { conversationId: "agy-1" },
        root,
        undefined,
        { userPrompt: "Autopilot ON demo track" },
      );
      expect(isAntigravityAllowNoop(out) || Boolean(out.injectSteps)).toBe(
        true,
      );
      const session = store.getSession("agy-1");
      expect(session?.platform).toBe("antigravity");
      expect(session?.phase).toBe("planning");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("PostToolUse returns {} and arms product edit", () => {
    const root = tmpRoot();
    try {
      fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
      fs.writeFileSync(path.join(root, "src.ts"), "export {}\n");
      const store = new StateStore(root);
      store.upsertSession({
        conversation_id: "agy-2",
        project_root: root,
        code_root: root,
        platform: ANTIGRAVITY_PLATFORM,
        phase: "executing",
      });
      const out = handlePostToolUse(
        store,
        {
          conversationId: "agy-2",
          toolCall: {
            name: "write_to_file",
            args: { TargetFile: path.join(root, "src.ts") },
          },
        },
        root,
      );
      expect(out).toEqual({});
      const chain = store.getReviewChain("agy-2");
      expect(chain?.code_edited).toBe(1);

      store.upsertSession({
        conversation_id: "agy-2-err",
        project_root: root,
        code_root: root,
        platform: ANTIGRAVITY_PLATFORM,
        phase: "executing",
      });
      expect(
        handlePostToolUse(
          store,
          {
            conversationId: "agy-2-err",
            toolCall: {
              name: "write_to_file",
              args: { TargetFile: path.join(root, "src.ts") },
            },
            error: { message: "write failed" },
          },
          root,
        ),
      ).toEqual({});
      expect(store.getReviewChain("agy-2-err")?.code_edited ?? 0).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("Stop continue uses decision:continue; fullyIdle false → {}", () => {
    const root = tmpRoot();
    try {
      fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
      writeChecklist(root, "demo", "# Checklist\n\n- [ ] a — A\n");
      const store = new StateStore(root);
      store.upsertSession({
        conversation_id: "agy-3",
        project_root: root,
        code_root: root,
        platform: ANTIGRAVITY_PLATFORM,
        phase: "executing",
        track_id: "demo",
        checklist_path: path.join(root, "plans", "demo", "checklist.md"),
        armed: 1,
      });
      store.markCodeEdited("agy-3", () => "a");
      const engine = new ReviewEngine(store, {
        confirmRounds: 5,
        reviewScope: "executing_only",
        verifyEnabled: false,
        verifyCommands: [],
        maxIdleStops: 5,
        maxErrorsBeforePause: 0,
        projectRoot: root,
        recoverDebounceMs: 0,
      });

      expect(
        handleStop(engine, {
          conversationId: "agy-3",
          fullyIdle: false,
          terminationReason: "model_stop",
        }),
      ).toEqual({});

      const cont = handleStop(engine, {
        conversationId: "agy-3",
        fullyIdle: true,
        terminationReason: "model_stop",
        executionNum: 1,
      });
      expect(cont.decision).toBe("continue");
      expect(typeof cont.reason).toBe("string");
      expect(String(cont.decision)).not.toBe("block");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("Stop unknown terminationReason still notifies engine but never continues", () => {
    const root = tmpRoot();
    try {
      fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
      writeChecklist(root, "demo", "# Checklist\n\n- [ ] a — A\n");
      const store = new StateStore(root);
      store.upsertSession({
        conversation_id: "agy-weird-stop",
        project_root: root,
        code_root: root,
        platform: ANTIGRAVITY_PLATFORM,
        phase: "executing",
        track_id: "demo",
        checklist_path: path.join(root, "plans", "demo", "checklist.md"),
        armed: 1,
      });
      store.markCodeEdited("agy-weird-stop", () => "a");
      const engine = new ReviewEngine(store, {
        confirmRounds: 5,
        reviewScope: "executing_only",
        verifyEnabled: false,
        verifyCommands: [],
        maxIdleStops: 5,
        maxErrorsBeforePause: 0,
        projectRoot: root,
        recoverDebounceMs: 0,
      });
      expect(store.getReviewChain("agy-weird-stop")?.code_edited).toBe(1);
      const out = handleStop(engine, {
        conversationId: "agy-weird-stop",
        fullyIdle: true,
        terminationReason: "weird_host_reason",
        executionNum: 1,
      });
      expect(out).toEqual({});
      expect(out.decision).toBeUndefined();
      // Engine ran (fix path) and stored pending — continue suppressed only.
      const after = store.getReviewChain("agy-weird-stop");
      expect((after?.pending_followup ?? "").trim().length).toBeGreaterThan(0);
      expect(after?.fix_round ?? 0).toBeGreaterThan(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("Stop error recovers with continue when fullyIdle; skips continue when not", () => {
    const root = tmpRoot();
    try {
      fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
      writeChecklist(root, "demo", "# Checklist\n\n- [ ] a — A\n");
      const store = new StateStore(root);
      const mkSession = (id: string) => {
        store.upsertSession({
          conversation_id: id,
          project_root: root,
          code_root: root,
          platform: ANTIGRAVITY_PLATFORM,
          phase: "executing",
          track_id: "demo",
          checklist_path: path.join(root, "plans", "demo", "checklist.md"),
          armed: 1,
        });
      };
      const engine = new ReviewEngine(store, {
        confirmRounds: 5,
        reviewScope: "executing_only",
        verifyEnabled: false,
        verifyCommands: [],
        maxIdleStops: 5,
        maxErrorsBeforePause: 0,
        projectRoot: root,
        recoverDebounceMs: 0,
      });

      mkSession("agy-err-busy");
      const busy = handleStop(engine, {
        conversationId: "agy-err-busy",
        fullyIdle: false,
        terminationReason: "error",
      });
      expect(busy).toEqual({});
      expect(store.getSession("agy-err-busy")?.error_count ?? 0).toBeGreaterThan(
        0,
      );

      mkSession("agy-err-idle");
      const idle = handleStop(engine, {
        conversationId: "agy-err-idle",
        fullyIdle: true,
        terminationReason: "error",
        executionNum: 1,
      });
      expect(idle.decision).toBe("continue");
      expect(typeof idle.reason).toBe("string");
      expect(String(idle.reason).length).toBeGreaterThan(0);

      mkSession("agy-err-bare");
      const bare = handleStop(engine, {
        conversationId: "agy-err-bare",
        fullyIdle: true,
        error: "host failure without reason",
        executionNum: 1,
      });
      expect(bare.decision).toBe("continue");
      expect(store.getSession("agy-err-bare")?.error_count ?? 0).toBeGreaterThan(
        0,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("Stop aborted still notifies engine but never continues", () => {
    const root = tmpRoot();
    try {
      fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
      const store = new StateStore(root);
      store.upsertSession({
        conversation_id: "agy-abort",
        project_root: root,
        code_root: root,
        platform: ANTIGRAVITY_PLATFORM,
        phase: "executing",
        armed: 1,
      });
      store.markCodeEdited("agy-abort", () => null);
      store.updateReviewChain("agy-abort", { chain_pending: 1 });
      expect(store.getReviewChain("agy-abort")?.code_edited).toBe(1);
      const engine = new ReviewEngine(store, {
        confirmRounds: 5,
        reviewScope: "executing_only",
        verifyEnabled: false,
        verifyCommands: [],
        maxIdleStops: 5,
        maxErrorsBeforePause: 0,
        projectRoot: root,
        recoverDebounceMs: 0,
      });
      const out = handleStop(engine, {
        conversationId: "agy-abort",
        fullyIdle: false,
        terminationReason: "aborted",
      });
      expect(out).toEqual({});
      expect(out.decision).toBeUndefined();
      // Engine ran despite fullyIdle=false — abort clears sticky code_edited.
      expect(store.getReviewChain("agy-abort")?.code_edited ?? 0).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects unsafe cursor project roots and skips arm on tool error", () => {
    expect(isSafeAntigravityCursorProjectRoot("")).toBe(false);
    expect(isSafeAntigravityCursorProjectRoot("/tmp/proj/../etc")).toBe(
      false,
    );
    expect(isSafeAntigravityCursorProjectRoot("/tmp/proj")).toBe(true);
    expect(
      shouldProcessAntigravityUserPrompt({
        projectRoot: "/tmp/not-real/../evil",
        conversationId: "c1",
        prompt: "Autopilot ON",
        explicit: false,
      }),
    ).toBe(false);

    const root = tmpRoot();
    try {
      fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
      fs.writeFileSync(path.join(root, "src.ts"), "export {}\n");
      const store = new StateStore(root);
      store.upsertSession({
        conversation_id: "agy-err",
        project_root: root,
        code_root: root,
        platform: ANTIGRAVITY_PLATFORM,
        phase: "executing",
      });
      handlePostToolUse(
        store,
        {
          conversationId: "agy-err",
          error: "write failed",
          toolCall: {
            name: "write_to_file",
            args: { TargetFile: path.join(root, "src.ts") },
          },
        },
        root,
      );
      expect(store.getReviewChain("agy-err")?.code_edited ?? 0).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("inject helpers use ephemeralMessage", () => {
    const a = injectEphemeral("hello");
    expect(a.injectSteps?.[0]?.ephemeralMessage).toBe("hello");
    const b = injectNeedPickContext("", [{ slug: "v0.10-antigravity" }]);
    expect(b.injectSteps?.[0]?.ephemeralMessage).toContain("v0.10-antigravity");
  });
});
