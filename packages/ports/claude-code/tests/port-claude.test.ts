import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ReviewEngine, StateStore } from "@autopilot-harness/core";
import {
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
