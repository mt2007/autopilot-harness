import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ReviewEngine, StateStore } from "@autopilot-harness/core";
import {
  allowNeedPickContext,
  filePathFromClaudeEdit,
  handlePostToolUse,
  handleStop,
  handleStopFailure,
  handleUserPromptSubmit,
  isClaudeEditTool,
  loopCountFromStopHookActive,
  normalizeClaudeStopStatus,
} from "../src/index.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-claude-port-"));
}

function writeChecklist(root: string, slug: string, body: string): string {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plan.md"), `# ${slug}\n`);
  const cp = path.join(dir, "checklist.md");
  fs.writeFileSync(cp, body);
  return cp;
}

describe("port-claude-code adapters", () => {
  it("maps stop_hook_active and edit tool helpers", () => {
    expect(loopCountFromStopHookActive({ stop_hook_active: true })).toBe(1);
    expect(loopCountFromStopHookActive({ stopHookActive: false })).toBe(0);
    expect(loopCountFromStopHookActive({})).toBe(0);
    expect(isClaudeEditTool("Edit")).toBe(true);
    expect(isClaudeEditTool("NotebookEdit")).toBe(true);
    expect(isClaudeEditTool("Bash")).toBe(false);
    expect(
      filePathFromClaudeEdit({
        tool_input: { file_path: "src/a.ts" },
      }),
    ).toBe("src/a.ts");
    expect(
      filePathFromClaudeEdit({
        tool_input: { notebook_path: "notes/demo.ipynb" },
      }),
    ).toBe("notes/demo.ipynb");
    expect(
      filePathFromClaudeEdit({
        toolInput: { notebookPath: "notes/camel.ipynb" },
      }),
    ).toBe("notes/camel.ipynb");
    expect(
      filePathFromClaudeEdit({
        tool_input: [] as unknown as Record<string, unknown>,
      }),
    ).toBe("");
    expect(filePathFromClaudeEdit({ tool_input: undefined })).toBe("");
    expect(
      normalizeClaudeStopStatus({ status: "aborted", hook_event_name: "stop" }),
    ).toBe("aborted");
    expect(
      normalizeClaudeStopStatus(
        { hook_event_name: "StopFailure" },
        { status: "error" },
      ),
    ).toBe("error");
    expect(
      normalizeClaudeStopStatus(
        { error: "User aborted/interrupted manually." },
        { status: "error" },
      ),
    ).toBe("aborted");
    expect(
      normalizeClaudeStopStatus({
        status: "completed",
        hook_event_name: "Stop",
      }),
    ).toBe("completed");
    expect(
      normalizeClaudeStopStatus(
        { status: "aborted", hook_event_name: "Stop" },
        { status: "error" },
      ),
    ).toBe("aborted");
    expect(normalizeClaudeStopStatus({ hook_event_name: "stopfailure" })).toBe(
      "error",
    );
    expect(
      normalizeClaudeStopStatus([] as unknown as { status?: string }),
    ).toBe("completed");
  });

  it("Stop with no followup returns {}; empty session_id is a no-op", () => {
    const root = tmpRoot();
    try {
      const store = StateStore.openMemory(root);
      const eng = new ReviewEngine(store, {
        confirmRounds: 5,
        reviewScope: "executing_only",
        verifyEnabled: false,
        verifyCommands: [],
        maxIdleStops: 5,
        maxErrorsBeforePause: 0,
        projectRoot: root,
        recoverDebounceMs: 0,
      });
      expect(handleStop(eng, { session_id: "" })).toEqual({});
      expect(
        handleUserPromptSubmit(store, { session_id: "", prompt: "x" }, root),
      ).toEqual({});
      // Idle / no session → allow stop (empty object, not decision:block).
      expect(handleStop(eng, { session_id: "missing-session" })).toEqual({});
      store.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("ON stamps session platform as claude-code (not cursor default)", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    expect(
      handleUserPromptSubmit(
        store,
        { session_id: "claude-s1", prompt: "/autopilot-on plat-tag" },
        root,
      ),
    ).toEqual({});
    expect(store.getSession("claude-s1")?.platform).toBe("claude-code");
    expect(store.getSession("claude-s1")?.phase).toBe("planning");
    store.close();
  });

  it("submit stamp canonicalizes mixed-case Claude platform", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    store.upsertSession({
      conversation_id: "s-case",
      project_root: root,
      code_root: root,
      platform: "Claude-Code",
      phase: "planning",
      armed: 0,
      paused: 0,
      track_id: "_pending",
      checklist_path: "",
    });
    expect(
      handleUserPromptSubmit(
        store,
        { session_id: "s-case", prompt: "hello" },
        root,
      ),
    ).toEqual({});
    expect(store.getSession("s-case")?.platform).toBe("claude-code");
    store.close();
  });

  it("blocked ON while executing still stamps claude-code platform", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    const cp = writeChecklist(root, "demo", `- [ ] a — A\n`);
    store.upsertSession({
      conversation_id: "s-block",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      paused: 0,
      checklist_path: cp,
      track_id: "demo",
    });
    const blocked = handleUserPromptSubmit(
      store,
      { session_id: "s-block", prompt: "/autopilot-on nope" },
      root,
    );
    expect(blocked.decision).toBe("block");
    expect(store.getSession("s-block")?.platform).toBe("claude-code");
    expect(store.getSession("s-block")?.phase).toBe("executing");
    store.close();
  });

  it("fail-closes ON while executing; ignores hostile cwd for store bind", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    const cp = writeChecklist(root, "demo", `- [ ] a — A\n`);
    store.upsertSession({
      conversation_id: "s1",
      project_root: root,
      code_root: root,
      phase: "executing",
      armed: 1,
      paused: 0,
      checklist_path: cp,
      track_id: "demo",
    });

    const blocked = handleUserPromptSubmit(
      store,
      {
        session_id: "s1",
        prompt: "/autopilot-on more",
        cwd: "/tmp/evil-not-install-root",
      },
      root,
    );
    expect(blocked.decision).toBe("block");
    expect(blocked.reason?.length).toBeGreaterThan(0);
    // Session still bound to install root track — cwd did not relocate.
    expect(store.getSession("s1")?.phase).toBe("executing");
    expect(store.getSession("s1")?.project_root).toBe(root);

    // Non-string prompt must not throw / must not treat as trigger.
    const weird = handleUserPromptSubmit(
      store,
      { session_id: "s1", prompt: 123 as unknown as string },
      root,
    );
    expect(weird).toEqual({});
    store.close();
  });

  it("allowNeedPickContext falls back when message empty / blank", () => {
    const empty = allowNeedPickContext("");
    expect(empty.decision).toBeUndefined();
    expect(empty.hookSpecificOutput?.hookEventName).toBe("UserPromptSubmit");
    expect(empty.hookSpecificOutput?.additionalContext).toMatch(
      /Select a plan to execute/i,
    );
    expect(
      allowNeedPickContext("   \n\t  ").hookSpecificOutput?.additionalContext,
    ).toMatch(/Select a plan to execute/i);
    expect(
      allowNeedPickContext(undefined).hookSpecificOutput?.additionalContext,
    ).toMatch(/Select a plan to execute/i);
    const fromCandidates = allowNeedPickContext("", [
      { slug: "alpha" },
      { slug: "beta" },
    ]);
    expect(fromCandidates.hookSpecificOutput?.additionalContext).toMatch(
      /alpha/,
    );
    expect(fromCandidates.hookSpecificOutput?.additionalContext).toMatch(
      /beta/,
    );
    const hostileFiltered = allowNeedPickContext("", [
      { slug: "../evil" },
      { slug: "alpha" },
      { slug: "bad/slug" },
    ]);
    const hostileCtx = hostileFiltered.hookSpecificOutput?.additionalContext ?? "";
    expect(hostileCtx).toMatch(/alpha/);
    expect(hostileCtx).not.toMatch(/\.\./);
    expect(hostileCtx).not.toMatch(/evil/);
    expect(hostileCtx).not.toMatch(/bad\/slug/);
    const allHostile = allowNeedPickContext("", [
      { slug: "../evil" },
      { slug: "bad/slug" },
    ]);
    expect(allHostile.hookSpecificOutput?.additionalContext).toMatch(
      /Select a plan to execute/i,
    );
    expect(allHostile.hookSpecificOutput?.additionalContext).not.toMatch(
      /\.\.|evil|bad/,
    );
    const deduped = allowNeedPickContext("", [
      { slug: "alpha" },
      { slug: "alpha" },
      { slug: "beta" },
    ]);
    expect(deduped.hookSpecificOutput?.additionalContext).toMatch(
      /1\.\s*alpha/,
    );
    expect(deduped.hookSpecificOutput?.additionalContext).toMatch(/2\.\s*beta/);
    expect(deduped.hookSpecificOutput?.additionalContext).not.toMatch(
      /3\.\s*/,
    );
    const real = allowNeedPickContext("Select a plan to execute:\n\n  1. alpha");
    expect(real.hookSpecificOutput?.additionalContext).toContain("alpha");
  });

  it("needPick RUN allows submit with additionalContext (no block)", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    writeChecklist(root, "alpha", `- [ ] a — A\n`);
    writeChecklist(root, "beta", `- [ ] b — B\n`);
    store.upsertSession({
      conversation_id: "s-pick",
      project_root: root,
      code_root: root,
      phase: "planning",
      track_id: "_pending",
      checklist_path: "",
      armed: 0,
      paused: 0,
    });
    const out = handleUserPromptSubmit(
      store,
      { session_id: "s-pick", prompt: "/autopilot-run" },
      root,
    );
    // Channel A: allow — never decision:block / Cursor continue shape
    expect(out.decision).toBeUndefined();
    expect(out.reason).toBeUndefined();
    expect(out.continue).toBeUndefined();
    expect(Object.keys(out)).toEqual(["hookSpecificOutput"]);
    expect(out.hookSpecificOutput?.hookEventName).toBe("UserPromptSubmit");
    const ctx = out.hookSpecificOutput?.additionalContext ?? "";
    expect(ctx.trim().length).toBeGreaterThan(0);
    expect(ctx).toMatch(/Select a plan/i);
    expect(ctx).toMatch(/alpha/);
    expect(ctx).toMatch(/beta/);
    const wire = JSON.parse(JSON.stringify(out)) as Record<string, unknown>;
    expect(wire).not.toHaveProperty("decision");
    expect(wire).toHaveProperty("hookSpecificOutput");
    const s = store.getSession("s-pick")!;
    expect(s.phase).toBe("planning");
    expect(s.armed).toBe(0);
    expect(s.pending_action).toBe("run");
    expect(s.track_candidates_json).toBeTruthy();
    expect(s.platform).toBe("claude-code");
    store.close();
  });

  it("hard-fail RUN (illegal slug) blocks without additionalContext", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    writeChecklist(root, "demo", `- [ ] a — A\n`);
    store.upsertSession({
      conversation_id: "s-bad",
      project_root: root,
      code_root: root,
      phase: "planning",
      track_id: "_pending",
      checklist_path: "",
      armed: 0,
      paused: 0,
    });
    const bad = handleUserPromptSubmit(
      store,
      { session_id: "s-bad", prompt: "/autopilot-run ../evil" },
      root,
    );
    expect(bad.decision).toBe("block");
    expect(bad.reason).toMatch(/invalid track slug/i);
    expect(bad.hookSpecificOutput).toBeUndefined();
    expect(store.getSession("s-bad")!.phase).toBe("planning");

    // No runnable plans → channel C (not needPick context)
    const emptyRoot = tmpRoot();
    const emptyStore = StateStore.openMemory(emptyRoot);
    emptyStore.upsertSession({
      conversation_id: "s-empty",
      project_root: emptyRoot,
      code_root: emptyRoot,
      phase: "planning",
      track_id: "_pending",
      checklist_path: "",
      armed: 0,
      paused: 0,
    });
    const none = handleUserPromptSubmit(
      emptyStore,
      { session_id: "s-empty", prompt: "/autopilot-run" },
      emptyRoot,
    );
    expect(none.decision).toBe("block");
    expect(none.reason).toMatch(/no runnable/i);
    expect(none.hookSpecificOutput).toBeUndefined();
    emptyStore.close();
    store.close();
  });

  it("busy RUN still blocks (channel C), never needPick additionalContext", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    writeChecklist(root, "demo", `- [ ] a — A\n`);
    store.upsertSession({
      conversation_id: "owner",
      project_root: root,
      code_root: root,
      phase: "planning",
      track_id: "_pending",
      checklist_path: "",
      armed: 0,
      paused: 0,
    });
    expect(
      handleUserPromptSubmit(
        store,
        { session_id: "owner", prompt: "/autopilot-run demo" },
        root,
      ),
    ).toEqual({});
    expect(store.getSession("owner")!.phase).toBe("executing");

    const busy = handleUserPromptSubmit(
      store,
      { session_id: "peer", prompt: "/autopilot-run demo" },
      root,
    );
    expect(busy.decision).toBe("block");
    expect(busy.reason).toMatch(/already executing/i);
    expect(busy.hookSpecificOutput).toBeUndefined();
    // busy-keep-block: channel C shape only — never empty allow / additionalContext.
    expect(busy).toEqual({
      decision: "block",
      reason: expect.stringMatching(/already executing/i),
    });
    store.close();
  });

  it("PostToolUse Edit arms code_edited; plans path does not", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    const cp = writeChecklist(root, "demo", `- [ ] a — A\n`);
    store.upsertSession({
      conversation_id: "s1",
      project_root: root,
      code_root: root,
      phase: "executing",
      armed: 1,
      paused: 0,
      checklist_path: cp,
      track_id: "demo",
    });

    handlePostToolUse(
      store,
      {
        session_id: "s1",
        tool_name: "Edit",
        tool_input: { file_path: path.join(root, "src", "app.ts") },
      },
      root,
    );
    expect(store.getReviewChain("s1")?.code_edited).toBe(1);
    expect(store.getSession("s1")?.platform).toBe("claude-code");

    store.updateReviewChain("s1", { code_edited: 0 });
    handlePostToolUse(
      store,
      {
        session_id: "s1",
        tool_name: "Write",
        tool_input: { file_path: path.join(root, "plans", "demo", "plan.md") },
      },
      root,
    );
    expect(store.getReviewChain("s1")?.code_edited ?? 0).toBe(0);
    store.close();
  });

  it("Stop returns decision:block+reason; loop:false hard-stops; StopFailure recovers", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    const cp = writeChecklist(root, "demo", `- [ ] a — A\n- [ ] b — B\n`);
    store.upsertSession({
      conversation_id: "s1",
      project_root: root,
      code_root: root,
      phase: "executing",
      armed: 1,
      paused: 0,
      checklist_path: cp,
      track_id: "demo",
    });
    store.updateReviewChain("s1", { code_edited: 1 });

    const eng = new ReviewEngine(store, {
      confirmRounds: 5,
      reviewScope: "executing_only",
      verifyEnabled: false,
      verifyCommands: [],
      maxIdleStops: 5,
      maxErrorsBeforePause: 0,
      projectRoot: root,
      recoverDebounceMs: 0,
    });

    const out = handleStop(eng, {
      session_id: "s1",
      stop_hook_active: false,
    });
    expect(out.decision).toBe("block");
    expect(out.reason).toBeTruthy();
    expect(out.continue).toBeUndefined();

    // Simulate engine halt (loop:false) via stuck path after forced pause fail —
    // assert port maps loop:false → continue:false (unit the mapper directly).
    const haltMapped = (() => {
      const action = {
        kind: "stuck" as const,
        message: "Stuck: test halt",
        loop: false,
      };
      // Re-enter through handleStop by stubbing engine
      const stub = {
        handleStop: () => action,
      } as unknown as ReviewEngine;
      return handleStop(stub, { session_id: "s1" });
    })();
    expect(haltMapped.continue).toBe(false);
    expect(haltMapped.stopReason).toMatch(/Stuck/);
    expect(haltMapped.decision).toBeUndefined();

    store.upsertSession({
      conversation_id: "s1",
      project_root: root,
      code_root: root,
      phase: "executing",
      armed: 1,
      paused: 0,
      checklist_path: cp,
      track_id: "demo",
      error_count: 0,
    });
    const errOut = handleStopFailure(eng, { session_id: "s1" });
    expect(errOut.decision).toBe("block");
    expect(errOut.reason).toMatch(/Recover|恢复/i);
    store.close();
  });

  it("Stop with Cursor status=aborted does not recover (cross-fire halt)", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    const cp = writeChecklist(root, "demo", `- [ ] a — A\n`);
    store.upsertSession({
      conversation_id: "s1",
      project_root: root,
      code_root: root,
      phase: "planning",
      armed: 0,
      paused: 0,
      checklist_path: cp,
      track_id: "demo",
      error_count: 0,
    });
    store.updateReviewChain("s1", {
      pending_followup:
        "恢复：上一回合出错。继续当前规划，不要 RUN 或写产品代码。",
    });

    const eng = new ReviewEngine(store, {
      confirmRounds: 5,
      reviewScope: "project",
      verifyEnabled: false,
      verifyCommands: [],
      maxIdleStops: 5,
      maxErrorsBeforePause: 0,
      projectRoot: root,
      recoverDebounceMs: 0,
    });

    const before = store.getSession("s1")!.error_count;
    const out = handleStop(eng, {
      session_id: "s1",
      status: "aborted",
      hook_event_name: "stop",
    });
    expect(out).toEqual({});
    expect(store.getSession("s1")!.error_count).toBe(before);
    expect(store.getReviewChain("s1")?.pending_followup ?? null).toBeNull();
    store.close();
  });

  it("StopFailure ambient bootstrap uses claude-code platform", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    const eng = new ReviewEngine(store, {
      confirmRounds: 5,
      reviewScope: "project",
      verifyEnabled: false,
      verifyCommands: [],
      maxIdleStops: 5,
      maxErrorsBeforePause: 0,
      projectRoot: root,
      recoverDebounceMs: 0,
    });
    const out = handleStopFailure(eng, {
      session_id: "ambient-new",
      hook_event_name: "StopFailure",
    });
    expect(out.decision).toBe("block");
    expect(store.getSession("ambient-new")?.platform).toBe("claude-code");
    store.close();
  });
});
