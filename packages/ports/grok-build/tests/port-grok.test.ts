import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ReviewEngine, StateStore } from "@autopilot-harness/core";
import {
  blockSubmit,
  buildNeedPickContext,
  filePathsFromGrokEdit,
  GROK_PLATFORM,
  GROK_POST_TOOL_USE_MATCHER,
  GROK_STOP_CAP_RAISE_FOUND,
  GROK_STOP_PER_TURN_BLOCK_CAP,
  handlePostToolUse,
  handleStop,
  handleUserPromptSubmit,
  isGrokEditTool,
  isGrokStopCompletionReason,
  loopCountFromStopHookActive,
  MAX_NEED_PICK_SLUGS,
  normalizeGrokStopStatus,
} from "../src/index.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-grok-port-"));
}

function writeChecklist(root: string, slug: string, body: string): string {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plan.md"), `# ${slug}\n`);
  const cp = path.join(dir, "checklist.md");
  fs.writeFileSync(cp, body);
  return cp;
}

describe("port-grok-build adapters", () => {
  it("documents Stop-cap constants; matcher; helpers", () => {
    expect(GROK_STOP_CAP_RAISE_FOUND).toBe(false);
    expect(GROK_STOP_PER_TURN_BLOCK_CAP).toBe(8);
    expect(GROK_POST_TOOL_USE_MATCHER).toMatch(/search_replace/);
    expect(GROK_PLATFORM).toBe("grok-build");
    expect(loopCountFromStopHookActive({ stopHookActive: true })).toBe(1);
    expect(loopCountFromStopHookActive({ stop_hook_active: false })).toBe(0);
    expect(isGrokEditTool("search_replace")).toBe(true);
    expect(isGrokEditTool("Edit")).toBe(true);
    expect(isGrokEditTool("run_terminal_command")).toBe(false);
    expect(
      filePathsFromGrokEdit({
        toolName: "search_replace",
        toolInput: { path: "src/a.ts" },
      }),
    ).toEqual(["src/a.ts"]);
    expect(
      filePathsFromGrokEdit({
        toolName: "search_replace",
        toolInput: JSON.stringify({ file_path: "src/b.ts" }),
      }),
    ).toEqual(["src/b.ts"]);
    expect(
      filePathsFromGrokEdit({
        toolName: "search_replace",
        toolInput: { path: "src/a\0.ts" },
      }),
    ).toEqual([]);
    expect(normalizeGrokStopStatus({ status: "aborted" })).toBe("aborted");
    expect(isGrokStopCompletionReason({ reason: "end_turn" })).toBe(true);
    expect(isGrokStopCompletionReason({ reason: "channel_closed" })).toBe(
      false,
    );
    expect(isGrokStopCompletionReason({ reason: "shutdown" })).toBe(false);
    expect(isGrokStopCompletionReason({ reason: { weird: true } })).toBe(
      false,
    );
    expect(isGrokStopCompletionReason({ reason: "mystery_future" })).toBe(
      false,
    );
    expect(isGrokStopCompletionReason({})).toBe(true);
    expect(isGrokEditTool("write_file")).toBe(true);
    expect(GROK_POST_TOOL_USE_MATCHER).toMatch(/write_file/);
  });

  it("sid skips blank session_id and falls through to conversationId", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    const on = handleUserPromptSubmit(
      store,
      {
        session_id: "   ",
        conversationId: "cid-fallback",
        prompt: "Autopilot ON",
      },
      root,
    );
    expect(on).toEqual({});
    expect(store.getSession("cid-fallback")?.phase).toBe("planning");
    expect(store.getSession("cid-fallback")?.platform).toBe(GROK_PLATFORM);
    store.close();
  });

  it("needPick / busy use UPS decision:block (no additionalContext)", () => {
    const many = Array.from({ length: MAX_NEED_PICK_SLUGS + 10 }, (_, i) => ({
      slug: `plan-${i}`,
    }));
    const ctx = buildNeedPickContext("", many);
    expect(ctx).toMatch(/Select a plan/);
    expect((ctx.match(/plan-\d+/g) ?? []).length).toBe(MAX_NEED_PICK_SLUGS);

    const blocked = blockSubmit(ctx, "fallback");
    expect(blocked.decision).toBe("block");
    expect(blocked.reason).toMatch(/Select a plan/);
    expect(blocked).not.toHaveProperty("hookSpecificOutput");
  });

  it("UPS ON empty allow; RUN needPick returns decision:block list", () => {
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
    expect(store.getSession(cid)?.platform).toBe(GROK_PLATFORM);

    const run = handleUserPromptSubmit(
      store,
      { sessionId: cid, prompt: "Autopilot RUN" },
      root,
    );
    expect(run.decision).toBe("block");
    expect(run.reason).toMatch(/Select a plan|alpha|beta/i);
    store.close();
  });

  it("busy RUN uses UPS decision:block (not needPick / additionalContext)", () => {
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
      platform: GROK_PLATFORM,
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
    expect(busy).not.toHaveProperty("hookSpecificOutput");
    expect(busy).toEqual({
      decision: "block",
      reason: expect.stringMatching(
        /already executing[\s\S]*track:[\s\S]*session:[\s\S]*cli status[\s\S]*cli doctor/i,
      ),
    });
    store.close();
  });

  it("PostToolUse arms product edit; plans path does not; Stop continue is single-channel block", () => {
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
      platform: GROK_PLATFORM,
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
        toolName: "search_replace",
        toolInput: { path: file },
      },
      root,
    );
    expect(store.getReviewChain(cid)?.code_edited).toBe(1);

    store.updateReviewChain(cid, { code_edited: 0 });
    handlePostToolUse(
      store,
      {
        session_id: cid,
        tool_name: "Write",
        tool_input: { file_path: path.join(root, "plans", "demo", "plan.md") },
      },
      root,
    );
    expect(store.getReviewChain(cid)?.code_edited ?? 0).toBe(0);

    store.updateReviewChain(cid, { code_edited: 1 });
    const engine = new ReviewEngine(store, { projectRoot: root });
    const cont = handleStop(engine, {
      sessionId: cid,
      reason: "end_turn",
      stopHookActive: false,
    });
    expect(cont.decision).toBe("block");
    expect(cont.reason).toBeTruthy();
    expect(cont).not.toHaveProperty("hookSpecificOutput");

    const skip = handleStop(engine, {
      sessionId: cid,
      reason: "channel_closed",
    });
    expect(skip).toEqual({});

    const haltMapped = handleStop(
      {
        handleStop: () => ({
          kind: "stuck",
          message: "Stuck: test halt",
          loop: false,
        }),
      } as unknown as ReviewEngine,
      { sessionId: cid, reason: "end_turn" },
    );
    expect(haltMapped.continue).toBe(false);
    expect(haltMapped.decision).toBeUndefined();
    expect(haltMapped.stopReason).toMatch(/Stuck/);
    expect(
      handleStop(engine, { sessionId: "", reason: "end_turn" }),
    ).toEqual({});
    expect(
      handleStop(engine, { sessionId: "   ", reason: "end_turn" }),
    ).toEqual({});
    store.close();
  });
});
