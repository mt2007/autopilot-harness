import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ReviewEngine, StateStore } from "@autopilot-harness/core";
import {
  buildNeedPickContext,
  changedPathsFromHermesPreVerify,
  filePathsFromHermesEdit,
  handleHermesPostToolCall,
  handleHermesPreLlmCall,
  handleHermesPreVerify,
  handlePostToolCall,
  handlePreLlmCall,
  handlePreVerify,
  HERMES_DEFAULT_MAX_VERIFY_NUDGES,
  HERMES_ENV_HOME,
  HERMES_INIT_MAX_VERIFY_NUDGES,
  HERMES_PLATFORM,
  HERMES_POST_TOOL_MATCHER,
  HERMES_PRE_VERIFY_PRIMARY,
  HERMES_SHELL_PRE_VERIFY_CONTINUE_SUPPORTED,
  HERMES_SOFT_MIN_VERSION,
  injectContext,
  injectNeedPickContext,
  isHermesAllowNoop,
  isHermesEditTool,
  loopCountFromHermesAttempt,
  collectHermesErrorText,
  normalizeHermesStopStatus,
  MAX_HERMES_CHANGED_PATHS,
  MAX_HERMES_PATH_CHARS,
  MAX_TOOL_ARGS_JSON_CHARS,
  pathsFromHermesPatchBody,
  resolveHermesWorkspaceRoot,
  userMessageFromHermesSubmit,
} from "../src/index.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-hermes-port-"));
}

function writeChecklist(root: string, slug: string, body: string): string {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plan.md"), `# ${slug}\n`);
  const cp = path.join(dir, "checklist.md");
  fs.writeFileSync(cp, body);
  return cp;
}

describe("port-hermes-agent adapters", () => {
  it("documents constants, matcher, aliases", () => {
    expect(HERMES_PLATFORM).toBe("hermes-agent");
    expect(HERMES_SHELL_PRE_VERIFY_CONTINUE_SUPPORTED).toBe(true);
    expect(HERMES_SOFT_MIN_VERSION).toBe("0.21.3");
    expect(HERMES_PRE_VERIFY_PRIMARY).toBe("decision:block+reason");
    expect(HERMES_INIT_MAX_VERIFY_NUDGES).toBe(32);
    expect(HERMES_DEFAULT_MAX_VERIFY_NUDGES).toBe(3);
    expect(HERMES_POST_TOOL_MATCHER).toBe("write_file|patch");
    expect(HERMES_ENV_HOME).toBe("HERMES_HOME");
    expect(handleHermesPreLlmCall).toBe(handlePreLlmCall);
    expect(handleHermesPostToolCall).toBe(handlePostToolCall);
    expect(handleHermesPreVerify).toBe(handlePreVerify);
    expect(isHermesEditTool("write_file")).toBe(true);
    expect(isHermesEditTool("patch")).toBe(true);
    expect(isHermesEditTool("terminal")).toBe(false);
    expect(isHermesAllowNoop({})).toBe(true);
    expect(isHermesAllowNoop({ context: "x" })).toBe(false);
    expect(isHermesAllowNoop({ decision: "block", reason: "r" })).toBe(false);
  });

  it("resolves workspace root without process.cwd or HERMES_HOME", () => {
    expect(
      resolveHermesWorkspaceRoot({
        installRoot: "/proj",
        stdinCwd: "/other",
        env: { HERMES_HOME: "/home/.hermes" },
      }),
    ).toBe("/proj");
    expect(
      resolveHermesWorkspaceRoot({
        stdinCwd: "/cwd",
        env: { HERMES_HOME: "/home/.hermes" },
      }),
    ).toBe("/cwd");
    expect(
      resolveHermesWorkspaceRoot({
        env: { HERMES_HOME: "/home/.hermes" },
      }),
    ).toBeNull();
    expect(resolveHermesWorkspaceRoot({})).toBeNull();
    // Hermes shell cwd often lives under HERMES_HOME — refuse as project root.
    expect(
      resolveHermesWorkspaceRoot({
        stdinCwd: "/home/.hermes/hermes-agent",
        env: { HERMES_HOME: "/home/.hermes" },
      }),
    ).toBeNull();
    expect(
      resolveHermesWorkspaceRoot({
        stdinCwd: "/home/.hermes",
        env: { HERMES_HOME: "/home/.hermes" },
      }),
    ).toBeNull();
    // install-root still wins even when cwd is under HERMES_HOME
    expect(
      resolveHermesWorkspaceRoot({
        installRoot: "/proj",
        stdinCwd: "/home/.hermes/hermes-agent",
        env: { HERMES_HOME: "/home/.hermes" },
      }),
    ).toBe("/proj");
    // omit env → still consult process.env / default ~/.hermes (not a no-op guard)
    expect(
      resolveHermesWorkspaceRoot({
        stdinCwd: path.join(os.homedir(), ".hermes", "hermes-agent"),
        env: {},
      }),
    ).toBeNull();
    expect(
      resolveHermesWorkspaceRoot({
        stdinCwd: "/safe/project",
        env: {},
      }),
    ).toBe("/safe/project");
    // Profile HERMES_HOME ≠ default tree — still refuse ~/.hermes/agent cwd.
    expect(
      resolveHermesWorkspaceRoot({
        stdinCwd: path.join(os.homedir(), ".hermes", "hermes-agent"),
        env: {
          HERMES_HOME: path.join(os.homedir(), ".hermes", "profiles", "work"),
        },
      }),
    ).toBeNull();
    expect(
      resolveHermesWorkspaceRoot({
        stdinCwd: "/safe/project",
        env: {
          HERMES_HOME: path.join(os.homedir(), ".hermes", "profiles", "work"),
        },
      }),
    ).toBe("/safe/project");
    // Lexical `..` must not bypass the HERMES_HOME / ~/.hermes guard.
    expect(
      resolveHermesWorkspaceRoot({
        stdinCwd: "/safe/project/../.hermes/hermes-agent",
        env: { HERMES_HOME: "/safe/.hermes" },
      }),
    ).toBeNull();
    expect(
      resolveHermesWorkspaceRoot({
        stdinCwd: `${path.join(os.homedir(), "proj")}/../.hermes/hermes-agent`,
        env: {},
      }),
    ).toBeNull();
    // Trailing slash + install-root still wins
    expect(
      resolveHermesWorkspaceRoot({
        installRoot: "/proj/",
        stdinCwd: "/home/.hermes/hermes-agent",
        env: { HERMES_HOME: "/home/.hermes" },
      }),
    ).toBe("/proj");
    // Relative stdin cwd (after .. collapse → `.hermes/...`) must not become a root.
    expect(
      resolveHermesWorkspaceRoot({
        stdinCwd: "../../.hermes/hermes-agent",
        env: { HERMES_HOME: "/home/.hermes" },
      }),
    ).toBeNull();
    expect(
      resolveHermesWorkspaceRoot({
        stdinCwd: "foo/../../.hermes/agent",
        env: {},
      }),
    ).toBeNull();
    // Absolute cwd is returned in collapsed form.
    expect(
      resolveHermesWorkspaceRoot({
        stdinCwd: "/safe/project/../app",
        env: {},
      }),
    ).toBe("/safe/app");
    // Filesystem root / relative installRoot are not usable project roots.
    expect(
      resolveHermesWorkspaceRoot({
        installRoot: "/",
        env: {},
      }),
    ).toBeNull();
    expect(
      resolveHermesWorkspaceRoot({
        installRoot: "///",
        env: {},
      }),
    ).toBeNull();
    expect(
      resolveHermesWorkspaceRoot({
        installRoot: "../proj",
        env: {},
      }),
    ).toBeNull();
    expect(
      resolveHermesWorkspaceRoot({
        stdinCwd: "/",
        env: {},
      }),
    ).toBeNull();
    // `/.hermes` at FS root (or any `.hermes` segment) is never a project root.
    expect(
      resolveHermesWorkspaceRoot({
        stdinCwd: "/.hermes/hermes-agent",
        env: {},
      }),
    ).toBeNull();
    expect(
      resolveHermesWorkspaceRoot({
        installRoot: "/var/lib/.hermes/project",
        env: {},
      }),
    ).toBeNull();
    expect(
      resolveHermesWorkspaceRoot({
        stdinCwd: "/safe/.hermes-backup/app",
        env: {},
      }),
    ).toBe("/safe/.hermes-backup/app");
    // Case-insensitive `.Hermes` segment (APFS / Windows).
    expect(
      resolveHermesWorkspaceRoot({
        stdinCwd: "/safe/.Hermes/agent",
        env: {},
      }),
    ).toBeNull();
  });

  it("parses user_message / attempt / changed_paths from extra", () => {
    expect(
      userMessageFromHermesSubmit({
        session_id: "s",
        extra: { user_message: "hello" },
      }),
    ).toBe("hello");
    // Hermes vision turns may pass a content list — flatten text parts.
    expect(
      userMessageFromHermesSubmit({
        session_id: "s",
        extra: {
          user_message: [
            { type: "text", text: "Autopilot RUN" },
            { type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
          ],
        },
      }),
    ).toBe("Autopilot RUN");
    expect(
      userMessageFromHermesSubmit({
        session_id: "s",
        user_message: ["plain", { text: " tail" }],
      }),
    ).toBe("plain\n tail");
    expect(
      userMessageFromHermesSubmit({
        session_id: "s",
        extra: { user_message: [{ type: "image_url", image_url: {} }] },
      }),
    ).toBe("");
    // Image parts must not leak url/base64 via content/value into the prompt.
    expect(
      userMessageFromHermesSubmit({
        session_id: "s",
        extra: {
          user_message: [
            {
              type: "image_url",
              content: "data:image/png;base64,AAAA",
              text: "should-ignore-on-image",
            },
            { type: "text", text: "keep-me" },
          ],
        },
      }),
    ).toBe("keep-me");
    // audio / input_audio must not contribute content either (Hermes non-text set).
    expect(
      userMessageFromHermesSubmit({
        session_id: "s",
        extra: {
          user_message: [
            { type: "input_audio", content: "base64-audio-blob" },
            { type: "input_text", input_text: "from-input-text-key" },
          ],
        },
      }),
    ).toBe("from-input-text-key");
    // video_url skipped; single part object (not a list) still flattens.
    expect(
      userMessageFromHermesSubmit({
        session_id: "s",
        extra: {
          user_message: [
            { type: "video_url", content: "https://example.com/v.mp4" },
            { type: "text", text: "after-video" },
          ],
        },
      }),
    ).toBe("after-video");
    expect(
      userMessageFromHermesSubmit({
        session_id: "s",
        extra: { user_message: { type: "text", text: "solo-part" } },
      }),
    ).toBe("solo-part");
    expect(
      userMessageFromHermesSubmit({
        session_id: "s",
        extra: {
          user_message: {
            type: "image_url",
            image_url: { url: "data:image/png;base64,xx" },
            text: "nope",
          },
        },
      }),
    ).toBe("");
    // Untyped video_url key must skip the whole part (same as image_url).
    expect(
      userMessageFromHermesSubmit({
        session_id: "s",
        extra: {
          user_message: [
            { video_url: "https://example.com/v.mp4", content: "leak" },
            { type: "text", text: "ok" },
          ],
        },
      }),
    ).toBe("ok");
    expect(loopCountFromHermesAttempt({ extra: { attempt: 2 } })).toBe(2);
    expect(loopCountFromHermesAttempt({ extra: { attempt: -1 } })).toBe(0);
    expect(loopCountFromHermesAttempt({ extra: { attempt: Number.NaN } })).toBe(
      0,
    );
    expect(
      loopCountFromHermesAttempt({ extra: { attempt: Number.POSITIVE_INFINITY } }),
    ).toBe(0);
    expect(loopCountFromHermesAttempt({ extra: { attempt: "1" } })).toBe(1);
    expect(loopCountFromHermesAttempt({})).toBe(0);
    expect(
      changedPathsFromHermesPreVerify({
        extra: { changed_paths: ["src/a.ts", "bad\0", ""] },
      }),
    ).toEqual(["src/a.ts"]);
    expect(
      filePathsFromHermesEdit({
        tool_name: "write_file",
        tool_input: { path: "src/b.ts" },
      }),
    ).toEqual(["src/b.ts"]);
    expect(
      filePathsFromHermesEdit({
        tool_name: "patch",
        tool_input: JSON.stringify({ path: "src/c.ts" }),
      }),
    ).toEqual(["src/c.ts"]);
    expect(
      filePathsFromHermesEdit({
        tool_name: "write_file",
        tool_input: "x".repeat(MAX_TOOL_ARGS_JSON_CHARS + 1),
      }),
    ).toEqual([]);
    // parent_session_id must not become Autopilot conversation id
    expect(
      userMessageFromHermesSubmit({
        extra: { parent_session_id: "parent-only", user_message: "hi" },
      }),
    ).toBe("hi");
    expect(
      changedPathsFromHermesPreVerify({
        extra: {
          changed_paths: Array.from(
            { length: MAX_HERMES_CHANGED_PATHS + 10 },
            (_, i) => `src/f${i}.ts`,
          ),
        },
      }),
    ).toHaveLength(MAX_HERMES_CHANGED_PATHS);
    expect(
      changedPathsFromHermesPreVerify({
        extra: { changed_paths: ["x".repeat(MAX_HERMES_PATH_CHARS + 1)] },
      }),
    ).toEqual([]);
    expect(
      pathsFromHermesPatchBody(
        "*** Update File: src/a.ts\n*** Add File: src/b.ts\n+++ b/src/c.ts\n",
      ),
    ).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    // Hermes V4A: Move File + compact ***Update (no space after ***).
    expect(
      pathsFromHermesPatchBody(
        "***Move File: src/old.ts -> src/new.ts\n***Update File: src/z.ts\n",
      ),
    ).toEqual(["src/old.ts", "src/new.ts", "src/z.ts"]);
    expect(
      filePathsFromHermesEdit({
        tool_name: "patch",
        tool_input: {
          mode: "patch",
          patch:
            "*** Update File: src/d.ts\n*** Update File: src/e.ts\n",
        },
      }),
    ).toEqual(["src/d.ts", "src/e.ts"]);
    // Union top-level path + V4A body (Hermes patch_tool merges both).
    expect(
      filePathsFromHermesEdit({
        tool_name: "patch",
        tool_input: {
          mode: "patch",
          path: "plans/t1/checklist.md",
          patch: "*** Update File: src/product.ts\n",
        },
      }),
    ).toEqual(["plans/t1/checklist.md", "src/product.ts"]);
  });

  it("empty session_id is a no-op", () => {
    const root = tmpRoot();
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
    expect(
      handlePreVerify(eng, store, { session_id: "", extra: { attempt: 0 } }, root),
    ).toEqual({});
    expect(
      handlePreLlmCall(store, { session_id: "", extra: { user_message: "x" } }, root),
    ).toEqual({});
    // parent_session_id alone must not invent a session
    expect(
      handlePreLlmCall(
        store,
        { extra: { parent_session_id: "only-parent", user_message: "Autopilot ON" } },
        root,
      ),
    ).toEqual({});
    expect(
      handlePreLlmCall(
        store,
        { session_id: "bad\nid", extra: { user_message: "Autopilot ON" } },
        root,
      ),
    ).toEqual({});
    store.close();
  });

  it("injects needPick as context (cannot discard prompt)", () => {
    const out = injectNeedPickContext("", [
      { slug: "alpha" },
      { slug: "beta" },
    ]);
    expect(out.context).toMatch(/alpha/);
    expect(out.context).toMatch(/beta/);
    expect(out.decision).toBeUndefined();
    expect(injectContext("")).toEqual({});
    expect(buildNeedPickContext("", [{ slug: "only-plan" }])).toMatch(
      /only-plan/,
    );
  });

  it("pre_llm_call ON allow; RUN needPick injects context", () => {
    const root = tmpRoot();
    writeChecklist(root, "alpha", "# Checklist\n\n- [ ] item-a — A\n");
    writeChecklist(root, "beta", "# Checklist\n\n- [ ] item-b — B\n");
    const store = new StateStore(root);
    const cid = "sess-run";

    const on = handlePreLlmCall(
      store,
      {
        session_id: cid,
        extra: { user_message: "Autopilot ON" },
      },
      root,
    );
    expect(isHermesAllowNoop(on)).toBe(true);
    expect(store.getSession(cid)?.phase).toBe("planning");
    expect(store.getSession(cid)?.platform).toBe(HERMES_PLATFORM);

    const run = handlePreLlmCall(
      store,
      {
        session_id: cid,
        extra: { user_message: "Autopilot RUN" },
      },
      root,
    );
    expect(typeof run.context).toBe("string");
    expect(run.context).toMatch(/alpha|beta/);
    expect(run.decision).toBeUndefined();

    store.close();
  });

  it("post_tool_call arms write_file", () => {
    const root = tmpRoot();
    const store = new StateStore(root);
    const cid = "sess-edit";
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: HERMES_PLATFORM,
      phase: "executing",
    });
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "x.ts"), "export {}\n");
    handlePostToolCall(
      store,
      {
        session_id: cid,
        tool_name: "write_file",
        tool_input: { path: "src/x.ts", content: "export const x = 1\n" },
      },
      root,
    );
    const session = store.getSession(cid);
    expect(session?.platform).toBe(HERMES_PLATFORM);
    expect(store.getReviewChain(cid)?.code_edited).toBe(1);
    store.close();
  });

  it("post_tool_call does not arm plans-only edits", () => {
    const root = tmpRoot();
    const store = new StateStore(root);
    const cid = "sess-plans";
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: HERMES_PLATFORM,
      phase: "executing",
    });
    handlePostToolCall(
      store,
      {
        session_id: cid,
        tool_name: "write_file",
        tool_input: { path: "plans/t1/checklist.md", content: "- [x] a\n" },
      },
      root,
    );
    expect(store.getReviewChain(cid)?.code_edited ?? 0).toBe(0);
    store.close();
  });

  it("post_tool_call arms multi-file V4A patch body", () => {
    const root = tmpRoot();
    const store = new StateStore(root);
    const cid = "sess-v4a";
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: HERMES_PLATFORM,
      phase: "executing",
    });
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "a.ts"), "export {}\n");
    handlePostToolCall(
      store,
      {
        session_id: cid,
        tool_name: "patch",
        tool_input: {
          mode: "patch",
          patch: "*** Update File: src/a.ts\n*** Add File: src/b.ts\n",
        },
      },
      root,
    );
    expect(store.getReviewChain(cid)?.code_edited).toBe(1);
    store.close();
  });

  it("post_tool_call arms product files when path is plans but patch body has src", () => {
    const root = tmpRoot();
    const store = new StateStore(root);
    const cid = "sess-union";
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: HERMES_PLATFORM,
      phase: "executing",
    });
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "product.ts"), "export {}\n");
    handlePostToolCall(
      store,
      {
        session_id: cid,
        tool_name: "patch",
        tool_input: {
          mode: "patch",
          path: "plans/t1/checklist.md",
          patch: "*** Update File: src/product.ts\n",
        },
      },
      root,
    );
    expect(store.getReviewChain(cid)?.code_edited).toBe(1);
    store.close();
  });

  it("pre_verify may continue with decision:block+reason", () => {
    const root = tmpRoot();
    const cp = writeChecklist(
      root,
      "t1",
      "# Checklist\n\n- [ ] do-work — work\n",
    );
    const store = new StateStore(root);
    const cid = "sess-stop";
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: HERMES_PLATFORM,
      phase: "executing",
      track_id: "t1",
      checklist_path: cp,
      reviewing_item_id: "do-work",
      armed: 1,
      paused: 0,
    });
    store.updateReviewChain(cid, { code_edited: 1 });
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
    const cont = handlePreVerify(
      engine,
      store,
      {
        session_id: cid,
        extra: {
          attempt: 0,
          changed_paths: ["src/x.ts"],
          coding: true,
        },
      },
      root,
    );
    if (cont.decision === "block") {
      expect(typeof cont.reason).toBe("string");
      expect(cont.reason!.length).toBeGreaterThan(0);
    } else {
      expect(isHermesAllowNoop(cont)).toBe(true);
    }
    store.close();
  });

  it("pre_verify hard-stop (loop:false) returns allow noop {}", () => {
    const root = tmpRoot();
    const store = new StateStore(root);
    const cid = "sess-halt";
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: HERMES_PLATFORM,
      phase: "executing",
    });
    const halt = handlePreVerify(
      {
        handleStop: () => ({
          message: "Stuck: too many loops",
          loop: false,
        }),
      } as unknown as ReviewEngine,
      store,
      { session_id: cid, extra: { attempt: 0 } },
      root,
    );
    expect(isHermesAllowNoop(halt)).toBe(true);
    store.close();
  });

  it("harness followup pre_llm_call does not clear chain_pending", () => {
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
      platform: HERMES_PLATFORM,
    });
    store.updateReviewChain(cid, {
      chain_pending: 1,
      pending_followup: "Review fix round 1",
    });
    expect(store.getReviewChain(cid)?.chain_pending).toBe(1);

    const out = handlePreLlmCall(
      store,
      {
        session_id: cid,
        extra: { user_message: "Review fix round 1 — keep going" },
      },
      root,
    );
    expect(isHermesAllowNoop(out)).toBe(true);
    expect(store.getReviewChain(cid)?.chain_pending).toBe(1);

    store.updateReviewChain(cid, {
      chain_pending: 1,
      pending_followup: "自审修复第 1 轮",
    });
    handlePreLlmCall(
      store,
      {
        session_id: cid,
        extra: {
          user_message: [
            { type: "text", text: "自审修复第 1 轮（无硬顶）。" },
            { type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
          ],
        },
      },
      root,
    );
    expect(store.getReviewChain(cid)?.chain_pending).toBe(1);

    handlePreLlmCall(
      store,
      { session_id: cid, extra: { user_message: "hello ordinary chat" } },
      root,
    );
    expect(store.getReviewChain(cid)?.chain_pending ?? 0).toBe(0);
    store.close();
  });

  it("pre_verify changed_paths alone arms product dirty", () => {
    const root = tmpRoot();
    const store = new StateStore(root);
    const cid = "sess-paths-arm";
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: HERMES_PLATFORM,
      phase: "executing",
    });
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "y.ts"), "export {}\n");
    expect(store.getReviewChain(cid)?.code_edited ?? 0).toBe(0);

    handlePreVerify(
      {
        handleStop: () => null,
      } as unknown as ReviewEngine,
      store,
      {
        session_id: cid,
        extra: { attempt: 0, changed_paths: ["src/y.ts"] },
      },
      root,
    );
    expect(store.getReviewChain(cid)?.code_edited).toBe(1);
    store.close();
  });

  it("normalizes stop status and collects error text", () => {
    expect(normalizeHermesStopStatus({}, { status: "aborted" })).toBe(
      "aborted",
    );
    expect(normalizeHermesStopStatus({}, { status: "completed" })).toBe(
      "completed",
    );
    expect(
      normalizeHermesStopStatus(
        { extra: { error: "User aborted the request" } },
        { status: "error" },
      ),
    ).toBe("aborted");
    expect(
      normalizeHermesStopStatus(
        { extra: { error_message: "tool failed" } },
        { status: "error" },
      ),
    ).toBe("error");
    expect(
      collectHermesErrorText({
        extra: { error: "a", error_message: "b", message: "c" },
      }),
    ).toMatch(/a[\s\S]*b[\s\S]*c/);
  });
});
