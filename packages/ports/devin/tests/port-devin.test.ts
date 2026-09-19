import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ReviewEngine, StateStore } from "@autopilot-harness/core";
import {
  DEVIN_FAIL_OPEN_EXIT,
  DEVIN_HOOK_TIMEOUT_SEC,
  DEVIN_HOOKS_REL_PATH,
  DEVIN_PLATFORM,
  DEVIN_POST_TOOL_USE_MATCHER,
  DEVIN_PROJECT_DIR_ENV,
  devinHookCommandLine,
  filePathFromDevinEdit,
  handleDevinPostToolUse,
  handleDevinStop,
  handleDevinUserPromptSubmit,
  isDevinEditTool,
  isDevinExecTool,
  isDevinHookFingerprint,
  isDevinSilentAllow,
  loopCountFromDevinStopHookActive,
  MAX_TOOL_INPUT_JSON_CHARS,
  resolveDevinWorkspaceRoot,
  type DevinSubmitPayload,
} from "../src/index.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-devin-port-"));
}

function writeChecklist(root: string, slug: string, body: string): string {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plan.md"), `# ${slug}\n`);
  const checklist = path.join(dir, "checklist.md");
  fs.writeFileSync(checklist, body);
  return checklist;
}

function gitRepo(root: string): void {
  const git = (args: string[]) => {
    execFileSync("git", args, { cwd: root, stdio: "ignore" });
  };
  git(["init"]);
  git(["config", "user.email", "devin-port@example.com"]);
  git(["config", "user.name", "devin-port"]);
  fs.writeFileSync(path.join(root, "README.md"), "init\n");
  git(["add", "README.md"]);
  git(["commit", "-m", "init"]);
}

describe("port-devin", () => {
  it("uses an independent fingerprint and an anchored matcher", () => {
    const line = devinHookCommandLine("Stop");
    expect(line).toContain(`"$${DEVIN_PROJECT_DIR_ENV}"`);
    expect(line).toContain("--platform devin");
    expect(line).not.toContain("claude-code");
    expect(line).not.toContain("node .autopilot/bin/");
    expect(isDevinHookFingerprint(line)).toBe(true);
    expect(
      isDevinHookFingerprint(
        "node .autopilot/bin/autopilot-harness-hook.mjs --platform claude-code --event Stop",
      ),
    ).toBe(false);
    expect(isDevinHookFingerprint("--platform devin")).toBe(false);
    expect(
      isDevinHookFingerprint(
        "node hook.mjs autopilot-harness-hook.mjs --platform devin-extra",
      ),
    ).toBe(false);
    expect(() => devinHookCommandLine("StopFailure")).toThrow(/invalid event/);
    expect(DEVIN_PLATFORM).toBe("devin");
    expect(DEVIN_HOOKS_REL_PATH).toBe(".devin/hooks.v1.json");
    expect(DEVIN_HOOK_TIMEOUT_SEC).toBe(120);
    expect(DEVIN_FAIL_OPEN_EXIT).toBe(0);
    expect(DEVIN_POST_TOOL_USE_MATCHER).toBe(
      "^(write|edit|apply_patch|notebook_edit)$",
    );
    expect(isDevinEditTool("write")).toBe(true);
    expect(isDevinEditTool("edit")).toBe(true);
    expect(isDevinEditTool("apply_patch")).toBe(true);
    expect(isDevinEditTool("notebook_edit")).toBe(true);
    expect(isDevinEditTool("edit_file")).toBe(false);
    expect(isDevinEditTool("Write")).toBe(false);
    expect(isDevinEditTool("exec")).toBe(false);
    expect(isDevinExecTool("exec")).toBe(true);
    expect(isDevinExecTool("execute")).toBe(false);
    expect(loopCountFromDevinStopHookActive({ stop_hook_active: true })).toBe(
      1,
    );
    expect(loopCountFromDevinStopHookActive({ stopHookActive: true })).toBe(1);
    expect(
      loopCountFromDevinStopHookActive({
        stop_hook_active: false,
        stopHookActive: true,
      }),
    ).toBe(1);
    expect(loopCountFromDevinStopHookActive({})).toBe(0);
    expect(
      loopCountFromDevinStopHookActive({
        stop_hook_active: false,
      }),
    ).toBe(0);
    expect(
      loopCountFromDevinStopHookActive({
        stop_hook_active: "true" as unknown as boolean,
      }),
    ).toBe(0);
    expect(isDevinSilentAllow({})).toBe(true);
    expect(isDevinSilentAllow({ decision: "block", reason: "x" })).toBe(
      false,
    );
    expect(
      resolveDevinWorkspaceRoot({
        installRoot: "/inst",
        env: { [DEVIN_PROJECT_DIR_ENV]: "/proj" },
        stdinCwd: "/cwd",
      }),
    ).toBe("/inst");
    expect(
      resolveDevinWorkspaceRoot({
        installRoot: "/bad\troot",
        env: { [DEVIN_PROJECT_DIR_ENV]: "/proj" },
      }),
    ).toBe("/proj");
    expect(resolveDevinWorkspaceRoot(null)).toBeNull();
    expect(filePathFromDevinEdit(null)).toBe("");
    expect(filePathFromDevinEdit({ tool_name: "exec" })).toBe("");
    expect(
      filePathFromDevinEdit({
        tool_name: "write",
        tool_input: { file_path: "src/a.ts" },
      }),
    ).toBe("src/a.ts");
    expect(
      filePathFromDevinEdit({
        tool_name: " ",
        toolName: "write",
        tool_input: "",
        toolInput: { path: "src/camel.ts" },
      }),
    ).toBe("src/camel.ts");
    expect(
      filePathFromDevinEdit({
        tool_name: "write",
        tool_input: { path: "src/a\nb.ts" },
      }),
    ).toBe("");
    expect(
      filePathFromDevinEdit({
        tool_name: "write",
        tool_input: { file_path: "src/a\nb.ts", path: "src/ok.ts" },
      }),
    ).toBe("src/ok.ts");
    expect(
      filePathFromDevinEdit({
        tool_name: "write",
        tool_input: "x".repeat(MAX_TOOL_INPUT_JSON_CHARS + 1),
      }),
    ).toBe("");
    expect(
      filePathFromDevinEdit({
        tool_name: "notebook_edit",
        tool_input: JSON.stringify({ notebook_path: "notes/a.ipynb" }),
      }),
    ).toBe("notes/a.ipynb");
    expect(
      filePathFromDevinEdit({
        tool_name: "write",
        tool_input: "{",
      }),
    ).toBe("");
  });

  it("binds only session_id and does not treat harness text as ON/RUN", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    const ignored = handleDevinUserPromptSubmit(
      store,
      {
        prompt: "Autopilot ON",
        conversation_id: "other",
      } as DevinSubmitPayload,
      root,
    );
    expect(isDevinSilentAllow(ignored)).toBe(true);
    expect(store.getSession("other")).toBeFalsy();

    const on = handleDevinUserPromptSubmit(
      store,
      { session_id: "sess-1", prompt: "Autopilot ON" },
      root,
    );
    expect(isDevinSilentAllow(on)).toBe(true);
    expect(store.getSession("sess-1")?.phase).toBe("planning");
    expect(store.getSession("sess-1")?.platform).toBe(DEVIN_PLATFORM);

    store.updateReviewChain("sess-1", {
      chain_pending: 1,
      pending_followup: "推进下一项：Autopilot RUN",
    });
    const harness = handleDevinUserPromptSubmit(
      store,
      {
        session_id: "sess-1",
        prompt: "推进下一项：Autopilot RUN v0.15-devin",
      },
      root,
    );
    expect(isDevinSilentAllow(harness)).toBe(true);
    expect(store.getSession("sess-1")?.phase).toBe("planning");
    expect(store.getReviewChain("sess-1")?.chain_pending).toBe(1);

    const blankId = handleDevinUserPromptSubmit(
      store,
      { session_id: "  ", sessionId: "sess-camel", prompt: "Autopilot ON" },
      root,
    );
    expect(isDevinSilentAllow(blankId)).toBe(true);
    expect(store.getSession("sess-camel")?.phase).toBe("planning");
    expect(store.getSession("sess-1")?.phase).toBe("planning");
    store.close();
  });

  it("replan needPick injects context and does not block", () => {
    const root = tmpRoot();
    writeChecklist(root, "alpha", "# Checklist\n\n- [ ] a — A\n");
    writeChecklist(root, "beta", "# Checklist\n\n- [ ] b — B\n");
    const store = StateStore.openMemory(root);
    handleDevinUserPromptSubmit(
      store,
      { session_id: "sess-replan", prompt: "Autopilot ON" },
      root,
    );
    const replan = handleDevinUserPromptSubmit(
      store,
      { session_id: "sess-replan", prompt: "Autopilot REPLAN" },
      root,
    );
    expect(replan.decision).toBeUndefined();
    expect(replan.hookSpecificOutput?.hookEventName).toBe("UserPromptSubmit");
    expect(replan.hookSpecificOutput?.additionalContext).toMatch(/alpha/);
    expect(replan.hookSpecificOutput?.additionalContext).toMatch(/beta/);
    store.close();
  });

  it("Post arms matcher tools, ignores exec, and never blocks", () => {
    const root = tmpRoot();
    const checklist = writeChecklist(
      root,
      "trk",
      "# Checklist\n\n- [ ] item-a — A\n",
    );
    const store = StateStore.openMemory(root);
    store.upsertSession({
      conversation_id: "sess-edit",
      project_root: root,
      code_root: root,
      phase: "executing",
      armed: 1,
      checklist_path: checklist,
      track_id: "trk",
      platform: DEVIN_PLATFORM,
    });

    const execResult = handleDevinPostToolUse(
      store,
      {
        session_id: "sess-edit",
        tool_name: "exec",
        tool_input: { command: "touch src/from-exec.ts" },
      },
      root,
    );
    expect(execResult).toBeUndefined();
    expect(store.getReviewChain("sess-edit")?.code_edited ?? 0).toBe(0);

    const writeResult = handleDevinPostToolUse(
      store,
      {
        session_id: "sess-edit",
        tool_name: "write",
        tool_input: { path: "src/a.ts" },
      },
      root,
    );
    expect(writeResult).toBeUndefined();
    expect(store.getReviewChain("sess-edit")?.code_edited).toBe(1);

    store.updateReviewChain("sess-edit", { code_edited: 0 });
    handleDevinPostToolUse(
      store,
      {
        session_id: "sess-edit",
        tool_name: "edit_file",
        tool_input: { path: "src/nope.ts" },
      },
      root,
    );
    expect(store.getReviewChain("sess-edit")?.code_edited).toBe(0);

    handleDevinPostToolUse(
      store,
      {
        session_id: "sess-edit",
        tool_name: "apply_patch",
        tool_input: JSON.stringify({ path: "src/from-json.ts" }),
      },
      root,
    );
    expect(store.getReviewChain("sess-edit")?.code_edited).toBe(1);

    store.updateReviewChain("sess-edit", { code_edited: 0 });
    handleDevinPostToolUse(
      store,
      {
        session_id: "sess-edit",
        tool_name: "edit",
        tool_input: { file_path: "../outside.ts", path: "src/kept.ts" },
      },
      root,
    );
    expect(store.getReviewChain("sess-edit")?.code_edited).toBe(1);
    store.close();
  });

  it("Stop continues with decision:block + reason; dirty exec arms on Stop", () => {
    const root = tmpRoot();
    gitRepo(root);
    const checklist = writeChecklist(
      root,
      "trk",
      "# Checklist\n\n- [ ] item-a — A\n",
    );
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: "sess-stop",
      project_root: root,
      code_root: root,
      phase: "executing",
      armed: 1,
      paused: 0,
      checklist_path: checklist,
      track_id: "trk",
      platform: DEVIN_PLATFORM,
    });
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "dirty.ts"), "export const n = 1;\n");

    const engine = new ReviewEngine(store, { projectRoot: root });
    const cont = handleDevinStop(engine, {
      session_id: "sess-stop",
      stop_hook_active: false,
    });
    expect(cont.decision).toBe("block");
    expect(cont.reason).toBeTruthy();
    expect(cont).not.toHaveProperty("exitCode");

    const aborted = handleDevinStop(engine, {
      session_id: "sess-stop",
      status: "aborted",
      stop_hook_active: true,
    });
    expect(aborted.decision).not.toBe("block");
    store.close();
  });

  it("Stop block keeps looping; deliver-once does not use decision:block", () => {
    const looping = {
      handleStop(input: { loopCount: number; platform?: string }) {
        expect(input.loopCount).toBe(1);
        expect(input.platform).toBe(DEVIN_PLATFORM);
        return { kind: "fix", message: "Review fix round 1", loop: true };
      },
    } as unknown as ReviewEngine;
    expect(
      handleDevinStop(looping, {
        session_id: "sess-loop",
        stop_hook_active: true,
      }),
    ).toEqual({ decision: "block", reason: "Review fix round 1" });

    const once = {
      handleStop() {
        return { kind: "stuck", message: "Stuck: wait", loop: false };
      },
    } as unknown as ReviewEngine;
    expect(
      handleDevinStop(once, { session_id: "sess-once", stop_hook_active: true }),
    ).toEqual({ continue: false, stopReason: "Stuck: wait" });
  });

  it("fail-open returns silent allow and does not throw", () => {
    const root = tmpRoot();
    const boom = {
      getSession() {
        throw new Error("boom");
      },
      clearPendingFollowupIf() {
        throw new Error("boom");
      },
    } as unknown as StateStore;
    expect(
      handleDevinUserPromptSubmit(
        boom,
        { session_id: "s", prompt: "Autopilot ON" },
        root,
      ),
    ).toEqual({});
    expect(() =>
      handleDevinPostToolUse(
        boom,
        {
          session_id: "s",
          tool_name: "write",
          tool_input: { path: "src/a.ts" },
        },
        root,
      ),
    ).not.toThrow();
    const engine = {
      handleStop() {
        throw new Error("boom");
      },
    } as unknown as ReviewEngine;
    expect(handleDevinStop(engine, { session_id: "s" })).toEqual({});
    expect(
      handleDevinUserPromptSubmit(
        boom,
        null as unknown as DevinSubmitPayload,
        root,
      ),
    ).toEqual({});
    expect(loopCountFromDevinStopHookActive(null)).toBe(0);
  });
});
