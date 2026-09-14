import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ReviewEngine, StateStore } from "@autopilot-harness/core";
import {
  buildNeedPickContext,
  denySubmit,
  filePathsFromGeminiEdit,
  GEMINI_AFTER_AGENT_TURN_CAP,
  GEMINI_AFTER_TOOL_MATCHER,
  GEMINI_MIN_CLI_VERSION_HINT,
  GEMINI_PLATFORM,
  GEMINI_STOP_CAP_RAISE_FOUND,
  handleGeminiPostToolUse,
  handleGeminiStop,
  handleGeminiUserPromptSubmit,
  handlePostToolUse,
  handleStop,
  handleUserPromptSubmit,
  injectNeedPickContext,
  isGeminiEditTool,
  loopCountFromStopHookActive,
  MAX_NEED_PICK_SLUGS,
  MAX_TOOL_ARGS_JSON_CHARS,
  normalizeGeminiStopStatus,
} from "../src/index.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-gemini-port-"));
}

function writeChecklist(root: string, slug: string, body: string): string {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plan.md"), `# ${slug}\n`);
  const cp = path.join(dir, "checklist.md");
  fs.writeFileSync(cp, body);
  return cp;
}

describe("port-gemini-cli adapters", () => {
  it("documents cap constants; matcher; aliases; helpers", () => {
    expect(GEMINI_STOP_CAP_RAISE_FOUND).toBe(false);
    expect(GEMINI_AFTER_AGENT_TURN_CAP).toBe(100);
    expect(GEMINI_MIN_CLI_VERSION_HINT).toMatch(/^\d+\.\d+/);
    expect(GEMINI_AFTER_TOOL_MATCHER).toBe("write_file|replace");
    expect(GEMINI_PLATFORM).toBe("gemini-cli");
    expect(handleGeminiUserPromptSubmit).toBe(handleUserPromptSubmit);
    expect(handleGeminiPostToolUse).toBe(handlePostToolUse);
    expect(handleGeminiStop).toBe(handleStop);
    expect(loopCountFromStopHookActive({ stopHookActive: true })).toBe(1);
    expect(loopCountFromStopHookActive({ stop_hook_active: false })).toBe(0);
    expect(isGeminiEditTool("write_file")).toBe(true);
    expect(isGeminiEditTool("replace")).toBe(true);
    expect(isGeminiEditTool("run_shell_command")).toBe(false);
    expect(
      filePathsFromGeminiEdit({
        toolName: "write_file",
        toolInput: { file_path: "src/a.ts" },
      }),
    ).toEqual(["src/a.ts"]);
    expect(
      filePathsFromGeminiEdit({
        toolName: "replace",
        toolInput: JSON.stringify({ filePath: "src/b.ts" }),
      }),
    ).toEqual(["src/b.ts"]);
    expect(
      filePathsFromGeminiEdit({
        toolName: "write_file",
        toolInput: { file_path: "src/a\0.ts" },
      }),
    ).toEqual([]);
    expect(
      filePathsFromGeminiEdit({
        toolName: "write_file",
        toolInput: { file_path: "src/a\n.ts" },
      }),
    ).toEqual([]);
    expect(
      filePathsFromGeminiEdit({
        toolName: "write_file",
        toolInput: "{not-json",
      }),
    ).toEqual([]);
    expect(
      filePathsFromGeminiEdit({
        toolName: "write_file",
        // Oversize string args must not be JSON.parsed (DoS / memory).
        toolInput: `{"file_path":"src/x.ts"}${" ".repeat(MAX_TOOL_ARGS_JSON_CHARS)}`,
      }),
    ).toEqual([]);
    expect(normalizeGeminiStopStatus({})).toBe("completed");
    expect(normalizeGeminiStopStatus({ status: "aborted" })).toBe("aborted");
    expect(
      normalizeGeminiStopStatus({
        status: "error",
        message: "user aborted the request",
      }),
    ).toBe("aborted");
  });

  it("empty / blank session id is a no-op allow", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    expect(
      handleUserPromptSubmit(
        store,
        { session_id: "", prompt: "Autopilot ON" },
        root,
      ),
    ).toEqual({});
    expect(
      handleUserPromptSubmit(
        store,
        { session_id: "   ", conversationId: "", prompt: "Autopilot ON" },
        root,
      ),
    ).toEqual({});
    expect(
      handleUserPromptSubmit(
        store,
        { session_id: "bad\0id", prompt: "Autopilot ON" },
        root,
      ),
    ).toEqual({});
    expect(store.getSession("bad\0id")).toBeNull();
    expect(handleStop(new ReviewEngine(store, { projectRoot: root }), {})).toEqual(
      {},
    );
    expect(
      handleStop(new ReviewEngine(store, { projectRoot: root }), {
        sessionId: "x\ny",
        stop_hook_active: true,
      }),
    ).toEqual({});
    store.close();
  });

  it("needPick prefers inject with hookEventName; deny fallback has no inject", () => {
    const many = Array.from({ length: MAX_NEED_PICK_SLUGS + 10 }, (_, i) => ({
      slug: `plan-${i}`,
    }));
    const ctx = buildNeedPickContext("", many);
    expect(ctx).toMatch(/Select a plan/);
    expect((ctx.match(/plan-\d+/g) ?? []).length).toBe(MAX_NEED_PICK_SLUGS);

    const injected = injectNeedPickContext(ctx, many);
    expect(injected.hookSpecificOutput?.hookEventName).toBe("BeforeAgent");
    expect(injected.hookSpecificOutput?.additionalContext).toMatch(
      /Select a plan/,
    );
    expect(injected.decision).toBeUndefined();

    const denied = denySubmit(ctx, "fallback");
    expect(denied.decision).toBe("deny");
    expect(denied.reason).toMatch(/Select a plan/);
    expect(denied).not.toHaveProperty("hookSpecificOutput");
  });

  it("BeforeAgent ON empty allow {}; RUN needPick injects context", () => {
    const root = tmpRoot();
    writeChecklist(root, "alpha", "# Checklist\n\n- [ ] item-a — A\n");
    writeChecklist(root, "beta", "# Checklist\n\n- [ ] item-b — B\n");
    const store = new StateStore(root);
    const cid = "sess-run";

    const on = handleUserPromptSubmit(
      store,
      { sessionId: cid, prompt: "Autopilot ON" },
      root,
    );
    expect(on).toEqual({});
    expect(store.getSession(cid)?.phase).toBe("planning");
    expect(store.getSession(cid)?.platform).toBe(GEMINI_PLATFORM);

    const run = handleUserPromptSubmit(
      store,
      { sessionId: cid, prompt: "Autopilot RUN" },
      root,
    );
    expect(run.hookSpecificOutput?.hookEventName).toBe("BeforeAgent");
    expect(run.hookSpecificOutput?.additionalContext).toMatch(
      /Select a plan|alpha|beta/i,
    );
    expect(run.decision).toBeUndefined();
    store.close();
  });

  it("busy RUN uses deny (not inject)", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    writeChecklist(root, "demo", "- [ ] a — A\n");
    store.upsertSession({
      conversation_id: "owner",
      project_root: root,
      code_root: root,
      phase: "planning",
      track_id: "_pending",
      checklist_path: "",
      armed: 0,
      paused: 0,
      platform: GEMINI_PLATFORM,
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
    expect(busy.decision).toBe("deny");
    expect(busy.reason).toMatch(/already executing/i);
    expect(busy).not.toHaveProperty("hookSpecificOutput");
    store.close();
  });

  it("harness followup BeforeAgent does not clear chain_pending", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    const cid = "sess-follow";
    const cp = writeChecklist(root, "trk", "- [ ] x — X\n");
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      phase: "executing",
      track_id: "trk",
      checklist_path: cp,
      platform: GEMINI_PLATFORM,
    });
    store.updateReviewChain(cid, {
      chain_pending: 1,
      pending_followup: "Review fix round 1",
    });
    expect(store.getReviewChain(cid)?.chain_pending).toBe(1);

    const out = handleUserPromptSubmit(
      store,
      {
        sessionId: cid,
        // Must match HARNESS_FOLLOWUP_PREFIXES (e.g. Review fix round…).
        prompt: "Review fix round 1 — keep going",
      },
      root,
    );
    expect(out).toEqual({});
    expect(store.getReviewChain(cid)?.chain_pending).toBe(1);

    // Ordinary user text still clears pending.
    handleUserPromptSubmit(
      store,
      { sessionId: cid, prompt: "hello ordinary chat" },
      root,
    );
    expect(store.getReviewChain(cid)?.chain_pending ?? 0).toBe(0);
    store.close();
  });

  it("AfterTool arms product edit; AfterAgent continue is deny+reason", () => {
    const root = tmpRoot();
    const cp = writeChecklist(
      root,
      "demo",
      "# Checklist\n\n- [ ] a — A\n- [ ] b — B\n",
    );
    const store = new StateStore(root);
    const cid = "sess-stop";
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: GEMINI_PLATFORM,
      phase: "executing",
      armed: 1,
      paused: 0,
      checklist_path: cp,
      track_id: "demo",
    });

    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    const file = path.join(root, "src", "x.ts");
    fs.writeFileSync(file, "export const x = 1;\n");

    handlePostToolUse(
      store,
      {
        sessionId: cid,
        toolName: "write_file",
        toolInput: { file_path: file },
      },
      root,
    );
    expect(store.getReviewChain(cid)?.code_edited).toBe(1);

    store.updateReviewChain(cid, { code_edited: 1 });
    const engine = new ReviewEngine(store, { projectRoot: root });
    const cont = handleStop(engine, {
      sessionId: cid,
      prompt: "original user",
      prompt_response: "assistant done",
      stop_hook_active: false,
    });
    expect(cont.decision).toBe("deny");
    expect(cont.reason).toBeTruthy();
    expect(cont).not.toHaveProperty("hookSpecificOutput");
    // Host may send decision:"block" as alias on input; Autopilot must emit deny.
    expect(JSON.stringify(cont)).not.toMatch(/"block"/);

    const haltMapped = handleStop(
      {
        handleStop: () => ({
          kind: "stuck",
          message: "Stuck: test halt",
          loop: false,
        }),
      } as unknown as ReviewEngine,
      { sessionId: cid, stop_hook_active: true },
    );
    expect(haltMapped.continue).toBe(false);
    expect(haltMapped.decision).toBeUndefined();
    expect(haltMapped.stopReason).toMatch(/Stuck/);

    // Multi-deny while stop_hook_active=true (not Ralph one-shot allow).
    const multiDeny = handleStop(
      {
        handleStop: () => ({
          kind: "fix",
          message: "Review fix round 2 — keep going",
          loop: true,
        }),
      } as unknown as ReviewEngine,
      { sessionId: cid, stop_hook_active: true },
    );
    expect(multiDeny.decision).toBe("deny");
    expect(multiDeny.reason).toMatch(/Review fix round/);
    expect(multiDeny.continue).toBeUndefined();
    expect(JSON.stringify(multiDeny)).not.toMatch(/clearContext/);
    expect(JSON.stringify(multiDeny)).not.toMatch(/"block"/);

    // Aborted stop must not Autopilot-continue (no deny retry).
    const aborted = handleStop(engine, {
      sessionId: cid,
      status: "aborted",
      stop_hook_active: false,
    });
    expect(aborted).toEqual({});

    // plans/** is .autopilotignore — must not arm code_edited.
    store.updateReviewChain(cid, { code_edited: 0 });
    handlePostToolUse(
      store,
      {
        session_id: cid,
        tool_name: "write_file",
        tool_input: {
          file_path: path.join(root, "plans", "demo", "plan.md"),
        },
      },
      root,
    );
    expect(store.getReviewChain(cid)?.code_edited ?? 0).toBe(0);
    store.close();
  });
});
