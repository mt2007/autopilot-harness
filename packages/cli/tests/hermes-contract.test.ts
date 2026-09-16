/**
 * v0.9 tests-hermes-contract — umbrella matrix for Hermes I/O (inject
 * `{context}`; Silence `{}`; Post never block; pre_verify continue =
 * `decision:block+reason`), merge/fingerprint, nine-way + wrong-stamp abort.
 * Deeper suites: port-hermes / hermes-hooks-merge / hermes-doctor-uninstall /
 * hook-vendor nine-way.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ReviewEngine, StateStore } from "@autopilot-harness/core";
import {
  handlePostToolCall,
  handlePreLlmCall,
  handlePreVerify,
  HERMES_PLATFORM,
  HERMES_POST_TOOL_MATCHER,
  HERMES_PRE_VERIFY_PRIMARY,
  HERMES_SHELL_PRE_VERIFY_CONTINUE_SUPPORTED,
  HERMES_SOFT_MIN_VERSION,
  injectContext,
  injectNeedPickContext,
  isHermesAllowNoop,
} from "../../ports/hermes-agent/src/index.js";
import {
  handleClaudeStop,
  handleCodexPostToolUse,
  handleCodexStop,
  handleCodexUserPromptSubmit,
  handleCopilotPostToolUse,
  handleCopilotStop,
  handleCopilotUserPromptSubmit,
  handleFactoryPostToolUse,
  handleFactoryStop,
  handleFactoryUserPromptSubmit,
  handleGeminiPostToolUse,
  handleGeminiStop,
  handleGeminiUserPromptSubmit,
  handleGrokPostToolUse,
  handleGrokStop,
  handleGrokUserPromptSubmit,
  handleHermesPostToolCall,
  handleHermesPreLlmCall,
  handleHermesPreVerify,
  handleKimiPostToolUse,
  handleKimiStop,
  handleKimiUserPromptSubmit,
  handlePostToolUse as handleClaudePostToolUse,
  handleUserPromptSubmit as handleClaudeUserPromptSubmit,
  HERMES_PLATFORM as vendorHermesPlatform,
  isHermesAllowNoop as vendorIsHermesAllowNoop,
} from "../src/vendor-entry.js";
import {
  HERMES_AUTOPILOT_EVENTS,
  HERMES_HOOK_TIMEOUT_SEC,
  HERMES_MAX_VERIFY_NUDGES,
  hermesAutopilotHasExpectedPostMatcher,
  hasCompleteHermesAutopilotHooks,
  hermesConfigYamlContainsAutopilot,
  hermesConfigYamlPath,
  hermesHooksContainAutopilot,
  hermesHooksHavePlatformStamp,
  mergeHermesConfig,
  mergeHermesConfigYaml,
  parseHermesConfigYaml,
  stripAutopilotHermesHooks,
} from "../src/init/hermes-hooks-merge.js";
import { installInitYes } from "../src/init/install.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK_ASSET = path.resolve(
  __dirname,
  "../assets/autopilot-harness-hook.mjs",
);

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-hermes-contract-"));
}

function writeChecklist(root: string, slug: string, body: string): string {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plan.md"), `# ${slug}\n`);
  const cp = path.join(dir, "checklist.md");
  fs.writeFileSync(cp, body);
  return cp;
}

function spawnHermesHook(
  root: string,
  event: string,
  payload: Record<string, unknown>,
  platform = "hermes-agent",
): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const hook = path.join(
    root,
    ".autopilot",
    "bin",
    "autopilot-harness-hook.mjs",
  );
  const proc = spawnSync(
    process.execPath,
    [hook, "--platform", platform, "--event", event],
    {
      cwd: root,
      input: JSON.stringify(payload),
      encoding: "utf8",
      timeout: 15_000,
    },
  );
  if (proc.error) {
    throw proc.error;
  }
  if (proc.status == null) {
    throw new Error(
      `hermes hook spawn killed: event=${event} platform=${platform} signal=${proc.signal}`,
    );
  }
  return {
    status: proc.status,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
  };
}

/** Hermes Silence / allow / Post observe — JSON `{}` or `{}\n` only (never empty / padded). */
function expectHermesSilenceStdout(stdout: string): void {
  expect(stdout === "{}" || stdout === "{}\n").toBe(true);
  expect(JSON.parse(stdout.trim())).toEqual({});
}

function withStore<T>(root: string, fn: (store: StateStore) => T): T {
  const store = new StateStore(root);
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

describe("hermes contract matrix", () => {
  let root = "";
  let hermesHome = "";
  let prevHome: string | undefined;
  let touchedHermesHome = false;

  afterEach(() => {
    // Only restore when this suite mutated HERMES_HOME — never delete a
    // pre-existing user/env value from tests that never called withHermesHome.
    if (touchedHermesHome) {
      if (prevHome === undefined) delete process.env.HERMES_HOME;
      else process.env.HERMES_HOME = prevHome;
    }
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    if (hermesHome && fs.existsSync(hermesHome)) {
      fs.rmSync(hermesHome, { recursive: true, force: true });
    }
    root = "";
    hermesHome = "";
    prevHome = undefined;
    touchedHermesHome = false;
  });

  function withHermesHome(): string {
    // Allocate first so a mkdtemp failure never marks the env as touched.
    const next = fs.mkdtempSync(path.join(os.tmpdir(), "ap-hermes-home-"));
    const previous = hermesHome;
    if (!touchedHermesHome) {
      prevHome = process.env.HERMES_HOME;
      touchedHermesHome = true;
    }
    hermesHome = next;
    process.env.HERMES_HOME = next;
    if (previous && previous !== next && fs.existsSync(previous)) {
      fs.rmSync(previous, { recursive: true, force: true });
    }
    return next;
  }

  it("vendor-entry aliases Hermes handlers without colliding with other hosts", () => {
    expect(handleHermesPreLlmCall).toBeTypeOf("function");
    expect(handleHermesPostToolCall).toBeTypeOf("function");
    expect(handleHermesPreVerify).toBeTypeOf("function");
    expect(vendorIsHermesAllowNoop).toBeTypeOf("function");
    expect(vendorHermesPlatform).toBe("hermes-agent");
    expect(vendorHermesPlatform).toBe(HERMES_PLATFORM);
    const vendorSrc = fs.readFileSync(
      path.resolve(__dirname, "../src/vendor-entry.ts"),
      "utf8",
    );
    expect(vendorSrc).toMatch(/handleHermesPreLlmCall/);
    expect(vendorSrc).toMatch(/handleHermesPostToolCall/);
    expect(vendorSrc).toMatch(/handleHermesPreVerify/);
    expect(vendorSrc).toMatch(/isHermesAllowNoop/);
    expect(vendorSrc).toMatch(
      /from\s+["']@autopilot-harness\/port-hermes-agent["']/,
    );
    expect(vendorIsHermesAllowNoop({})).toBe(true);
    expect(
      vendorIsHermesAllowNoop({ decision: "block", reason: "x" }),
    ).toBe(false);
    // Distinct from other host Stop / UPS symbols (nine-way identity).
    expect(handleHermesPreVerify).not.toBe(handleClaudeStop);
    expect(handleHermesPreVerify).not.toBe(handleCodexStop);
    expect(handleHermesPreVerify).not.toBe(handleKimiStop);
    expect(handleHermesPreVerify).not.toBe(handleCopilotStop);
    expect(handleHermesPreVerify).not.toBe(handleGrokStop);
    expect(handleHermesPreVerify).not.toBe(handleGeminiStop);
    expect(handleHermesPreVerify).not.toBe(handleFactoryStop);
    expect(handleHermesPreLlmCall).not.toBe(handleClaudeUserPromptSubmit);
    expect(handleHermesPreLlmCall).not.toBe(handleCodexUserPromptSubmit);
    expect(handleHermesPreLlmCall).not.toBe(handleKimiUserPromptSubmit);
    expect(handleHermesPreLlmCall).not.toBe(handleCopilotUserPromptSubmit);
    expect(handleHermesPreLlmCall).not.toBe(handleGrokUserPromptSubmit);
    expect(handleHermesPreLlmCall).not.toBe(handleGeminiUserPromptSubmit);
    expect(handleHermesPreLlmCall).not.toBe(handleFactoryUserPromptSubmit);
    expect(handleHermesPostToolCall).not.toBe(handleClaudePostToolUse);
    expect(handleHermesPostToolCall).not.toBe(handleCodexPostToolUse);
    expect(handleHermesPostToolCall).not.toBe(handleKimiPostToolUse);
    expect(handleHermesPostToolCall).not.toBe(handleCopilotPostToolUse);
    expect(handleHermesPostToolCall).not.toBe(handleGrokPostToolUse);
    expect(handleHermesPostToolCall).not.toBe(handleGeminiPostToolUse);
    expect(handleHermesPostToolCall).not.toBe(handleFactoryPostToolUse);
  });

  it("shipped hook asset keeps ten-way dispatch + Hermes Silence writer", () => {
    expect(fs.existsSync(HOOK_ASSET)).toBe(true);
    const src = fs.readFileSync(HOOK_ASSET, "utf8");
    expect(src).toMatch(
      /KNOWN_PLATFORMS\s*=\s*new Set\(\[\s*"cursor"\s*,\s*"claude-code"\s*,\s*"codex"\s*,\s*"kimi-code"\s*,\s*"copilot-cli"\s*,\s*"grok-build"\s*,\s*"gemini-cli"\s*,\s*"factory-droid"\s*,\s*"hermes-agent"\s*,\s*"antigravity"\s*,?\s*\]\)/,
    );
    expect(src).toMatch(
      /HERMES_EVENTS\s*=\s*new Set\(\[\s*"pre_llm_call"\s*,\s*"post_tool_call"\s*,\s*"pre_verify"\s*,?\s*\]\)/,
    );
    expect(src).toMatch(/handleHermesPreLlmCall/);
    expect(src).toMatch(/handleHermesPostToolCall/);
    expect(src).toMatch(/handleHermesPreVerify/);
    expect(src).toMatch(/function writeHermesReply\(/);
    expect(src).toMatch(/isHermesAllowNoop/);
    expect(src).toMatch(/declaredPlatform === "hermes-agent"/);
    expect(src).toMatch(/hostId === "hermes-agent"/);
    // Wrong stamp on Hermes-unique events → {} before FSM.
    expect(src).toMatch(
      /HERMES_EVENTS\.has\(event\)\s*&&\s*hostId\s*!==\s*"hermes-agent"/,
    );
    // Hermes stamp + non-Hermes event → {} before side effects.
    expect(src).toMatch(
      /hostId === "hermes-agent"\s*&&\s*!HERMES_EVENTS\.has\(event\)/,
    );
    // post_tool_call observe path always writeReply("{}") after postFn.
    expect(src).toMatch(
      /event === "post_tool_call"[\s\S]*?postFn\(store, payload, projectRoot\);[\s\S]*?writeReply\("\{\}"\)/,
    );
  });

  it("I/O: inject context; Silence {}; R1 continue primary; Post void", () => {
    expect(HERMES_SHELL_PRE_VERIFY_CONTINUE_SUPPORTED).toBe(true);
    expect(HERMES_SOFT_MIN_VERSION).toBe("0.21.3");
    expect(HERMES_PRE_VERIFY_PRIMARY).toBe("decision:block+reason");
    expect(HERMES_PLATFORM).toBe("hermes-agent");
    expect(HERMES_POST_TOOL_MATCHER).toBe("write_file|patch");

    expect(isHermesAllowNoop({})).toBe(true);
    expect(isHermesAllowNoop({ context: undefined })).toBe(true);
    expect(isHermesAllowNoop({ context: "x" })).toBe(false);
    expect(isHermesAllowNoop({ decision: "block", reason: "r" })).toBe(false);
    expect(isHermesAllowNoop(null)).toBe(false);
    expect(isHermesAllowNoop(undefined)).toBe(false);

    expect(injectContext("")).toEqual({});
    expect(isHermesAllowNoop(injectContext(""))).toBe(true);
    const injected = injectNeedPickContext("", [
      { slug: "alpha" },
      { slug: "beta" },
    ]);
    expect(typeof injected.context).toBe("string");
    expect(injected.context).toMatch(/alpha|beta|Select a plan/i);
    expect(injected.decision).toBeUndefined();
    expect(Object.keys(injected).sort()).toEqual(["context"]);
    expect(isHermesAllowNoop(injected)).toBe(false);

    root = tmpProject();
    writeChecklist(root, "alpha", "- [ ] a — A\n");
    writeChecklist(root, "beta", "- [ ] b — B\n");
    const store = new StateStore(root);
    try {
      const cid = "herm-pick-1";
      const on = handlePreLlmCall(
        store,
        { session_id: cid, extra: { user_message: "Autopilot ON" } },
        root,
      );
      expect(on).toEqual({});
      expect(isHermesAllowNoop(on)).toBe(true);
      expect(store.getSession(cid)?.phase).toBe("planning");
      expect(store.getSession(cid)?.platform).toBe(HERMES_PLATFORM);

      const run = handlePreLlmCall(
        store,
        { session_id: cid, extra: { user_message: "Autopilot RUN" } },
        root,
      );
      expect(typeof run.context).toBe("string");
      expect(run.context).toMatch(/alpha|beta/i);
      expect(run.decision).toBeUndefined();
      expect(Object.keys(run).sort()).toEqual(["context"]);

      // Blank / control-char session → Silence, no row.
      expect(
        handlePreLlmCall(
          store,
          { session_id: "", extra: { user_message: "Autopilot ON" } },
          root,
        ),
      ).toEqual({});
      expect(
        handlePreLlmCall(
          store,
          { session_id: "bad\u0000id", extra: { user_message: "Autopilot ON" } },
          root,
        ),
      ).toEqual({});
      expect(store.getSession("") ?? null).toBeNull();
      expect(store.getSession("bad\u0000id") ?? null).toBeNull();
    } finally {
      store.close();
    }
  });

  it("Post never block; pre_verify continue is decision:block+reason; Silence keys", () => {
    root = tmpProject();
    const cp = writeChecklist(root, "demo", "- [ ] a — A\n- [ ] b — B\n");
    const store = new StateStore(root);
    try {
      const cid = "herm-stop";
      store.upsertSession({
        conversation_id: cid,
        project_root: root,
        code_root: root,
        phase: "executing",
        armed: 1,
        paused: 0,
        checklist_path: cp,
        track_id: "demo",
        platform: HERMES_PLATFORM,
        reviewing_item_id: "a",
      });

      fs.mkdirSync(path.join(root, "src"), { recursive: true });
      const file = path.join(root, "src", "x.ts");
      fs.writeFileSync(file, "export const x = 1;\n");

      const afterEdit = handlePostToolCall(
        store,
        {
          session_id: cid,
          tool_name: "write_file",
          tool_input: { path: file, content: "export const x = 2;\n" },
        },
        root,
      );
      expect(afterEdit).toBeUndefined();
      expect(store.getReviewChain(cid)?.code_edited).toBe(1);

      store.updateReviewChain(cid, { code_edited: 0 });
      handlePostToolCall(
        store,
        {
          session_id: cid,
          tool_name: "patch",
          tool_input: {
            command: `*** Begin Patch\n*** Update File: src/x.ts\n@@\n-export const x = 1;\n+export const x = 3;\n*** End Patch`,
          },
        },
        root,
      );
      expect(store.getReviewChain(cid)?.code_edited).toBe(1);

      // Non-edit tool — no arm, still void (never block).
      store.updateReviewChain(cid, { code_edited: 0 });
      expect(
        handlePostToolCall(
          store,
          {
            session_id: cid,
            tool_name: "terminal",
            tool_input: { command: "echo hi" },
          },
          root,
        ),
      ).toBeUndefined();
      expect(store.getReviewChain(cid)?.code_edited ?? 0).toBe(0);

      // plans/** ignored — no dirty-arm, still void.
      handlePostToolCall(
        store,
        {
          session_id: cid,
          tool_name: "write_file",
          tool_input: {
            path: "plans/demo/checklist.md",
            content: "- [x] a — A\n",
          },
        },
        root,
      );
      expect(store.getReviewChain(cid)?.code_edited ?? 0).toBe(0);

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
            coding: true,
            changed_paths: ["src/x.ts"],
          },
        },
        root,
      );
      expect(cont.decision).toBe("block");
      expect(typeof cont.reason).toBe("string");
      expect(cont.reason!.length).toBeGreaterThan(0);
      expect(cont).not.toHaveProperty("context");
      expect(cont).not.toHaveProperty("continue");
      expect(cont).not.toHaveProperty("stopReason");
      expect(Object.keys(cont).sort()).toEqual(["decision", "reason"]);
      expect(isHermesAllowNoop(cont)).toBe(false);

      // Hard-stop (loop:false) → Silence {}
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
      expect(halt).toEqual({});
      expect(isHermesAllowNoop(halt)).toBe(true);
    } finally {
      store.close();
    }
  });

  it("merge/fingerprint: complete hooks, post matcher, stamp, strip", () => {
    const merged = mergeHermesConfig(null);
    expect(hasCompleteHermesAutopilotHooks(merged)).toBe(true);
    expect(hermesHooksHavePlatformStamp(merged)).toBe(true);
    expect(hermesAutopilotHasExpectedPostMatcher(merged)).toBe(true);
    expect(hermesHooksContainAutopilot(merged)).toBe(true);
    expect(HERMES_HOOK_TIMEOUT_SEC).toBe(120);
    expect(HERMES_MAX_VERIFY_NUDGES).toBe(32);
    expect(HERMES_AUTOPILOT_EVENTS).toEqual([
      "pre_llm_call",
      "post_tool_call",
      "pre_verify",
    ]);

    for (const event of HERMES_AUTOPILOT_EVENTS) {
      const entries = merged.hooks![event] as Array<{
        command?: string;
        timeout?: number;
        matcher?: string;
      }>;
      expect(entries).toHaveLength(1);
      const h = entries[0]!;
      expect(h.command).toBe(
        `node .autopilot/bin/autopilot-harness-hook.mjs --platform hermes-agent --event ${event}`,
      );
      expect(h.timeout).toBe(HERMES_HOOK_TIMEOUT_SEC);
      if (event === "post_tool_call") {
        expect(h.matcher).toBe(HERMES_POST_TOOL_MATCHER);
      } else {
        expect(h.matcher).toBeUndefined();
      }
    }

    const yaml = mergeHermesConfigYaml(null);
    expect(hermesConfigYamlContainsAutopilot(yaml)).toBe(true);
    expect(yaml).toMatch(/max_verify_nudges:\s*32/);
    expect(yaml).not.toMatch(/hooks_auto_accept/);

    // Missing post matcher → incomplete fingerprint (mutate a copy).
    const complete = mergeHermesConfig(null);
    const noMatcher = {
      ...complete,
      hooks: {
        ...complete.hooks,
        post_tool_call: (
          complete.hooks!.post_tool_call as Array<Record<string, unknown>>
        ).map((entry) => {
          const copy = { ...entry };
          delete copy.matcher;
          return copy;
        }),
      },
    };
    expect(hermesAutopilotHasExpectedPostMatcher(noMatcher)).toBe(false);
    expect(hasCompleteHermesAutopilotHooks(noMatcher)).toBe(false);
    // Original merge result stays complete (no shared mutation).
    expect(hasCompleteHermesAutopilotHooks(complete)).toBe(true);

    // Strip leaves foreign sibling + clears Autopilot fingerprint.
    const withForeign = mergeHermesConfig({
      hooks: {
        pre_llm_call: [
          { command: "echo foreign-pre", timeout: 30 },
        ],
      },
      agent: { max_verify_nudges: 40 },
    });
    expect(hasCompleteHermesAutopilotHooks(withForeign)).toBe(true);
    const stripped = stripAutopilotHermesHooks(withForeign);
    expect(hermesHooksContainAutopilot(stripped)).toBe(false);
    expect(hasCompleteHermesAutopilotHooks(stripped)).toBe(false);
    const foreignPre = stripped.hooks?.pre_llm_call as Array<{
      command?: string;
    }>;
    expect(foreignPre?.some((e) => e.command === "echo foreign-pre")).toBe(
      true,
    );
    expect(
      (stripped.agent as { max_verify_nudges?: number } | undefined)
        ?.max_verify_nudges,
    ).toBe(40);

    hermesHome = withHermesHome();
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "hermes-agent",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const cfgPath = hermesConfigYamlPath(hermesHome);
    expect(fs.existsSync(cfgPath)).toBe(true);
    const onDisk = parseHermesConfigYaml(fs.readFileSync(cfgPath, "utf8"));
    expect(hasCompleteHermesAutopilotHooks(onDisk)).toBe(true);
    expect(hermesHooksHavePlatformStamp(onDisk)).toBe(true);
  });

  it("runner: inject/Silence/Post {}; pre_verify continue; nine-way stamp cross", () => {
    hermesHome = withHermesHome();
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "hermes-agent",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    writeChecklist(root, "alpha", "- [ ] a — A\n");
    writeChecklist(root, "beta", "- [ ] b — B\n");

    const cid = "hook-hermes-contract-aaaa-bbbb-cccc-ddddeeee0001";

    const on = spawnHermesHook(root, "pre_llm_call", {
      session_id: cid,
      user_message: "Autopilot ON",
      cwd: root,
    });
    expect(on.status).toBe(0);
    expectHermesSilenceStdout(on.stdout);
    withStore(root, (onStore) => {
      expect(onStore.getSession(cid)?.phase).toBe("planning");
      expect(onStore.getSession(cid)?.platform).toBe(HERMES_PLATFORM);
    });

    // extra.user_message shape (Hermes may nest prompt under extra).
    const onExtra = spawnHermesHook(root, "pre_llm_call", {
      session_id: "hook-hermes-contract-aaaa-bbbb-cccc-ddddeeee00e1",
      extra: { user_message: "Autopilot ON" },
      cwd: root,
    });
    expect(onExtra.status).toBe(0);
    expectHermesSilenceStdout(onExtra.stdout);
    withStore(root, (extraStore) => {
      expect(
        extraStore.getSession("hook-hermes-contract-aaaa-bbbb-cccc-ddddeeee00e1")
          ?.platform,
      ).toBe(HERMES_PLATFORM);
    });

    const pick = spawnHermesHook(root, "pre_llm_call", {
      session_id: cid,
      user_message: "Autopilot RUN",
      cwd: root,
    });
    expect(pick.status).toBe(0);
    expect(pick.stdout.trim()).not.toBe("{}");
    expect(pick.stdout.trim().length).toBeGreaterThan(0);
    const pickOut = JSON.parse(pick.stdout.trim()) as {
      context?: string;
      decision?: string;
    };
    expect(pickOut.decision).toBeUndefined();
    expect(typeof pickOut.context).toBe("string");
    expect(pickOut.context).toMatch(/alpha|beta|Select a plan/i);
    expect(Object.keys(pickOut).sort()).toEqual(["context"]);

    // Bind executing, then Post must arm + stay Silence {} (never block JSON).
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    const editFile = path.join(root, "src", "contract-edit.ts");
    fs.writeFileSync(editFile, "export const n = 1;\n");
    withStore(root, (armed) => {
      armed.upsertSession({
        conversation_id: cid,
        project_root: root,
        code_root: root,
        platform: HERMES_PLATFORM,
        phase: "executing",
        armed: 1,
        paused: 0,
        track_id: "alpha",
        checklist_path: path.join(root, "plans", "alpha", "checklist.md"),
        reviewing_item_id: "a",
      });
    });

    const post = spawnHermesHook(root, "post_tool_call", {
      session_id: cid,
      tool_name: "write_file",
      tool_input: { path: editFile, content: "export const n = 2;\n" },
      cwd: root,
    });
    expect(post.status).toBe(0);
    expectHermesSilenceStdout(post.stdout);
    expect(post.stdout).not.toMatch(/"decision"\s*:\s*"block"/);
    withStore(root, (postStore) => {
      expect(postStore.getReviewChain(cid)?.code_edited).toBe(1);
    });

    const verify = spawnHermesHook(root, "pre_verify", {
      session_id: cid,
      extra: {
        attempt: 0,
        coding: true,
        changed_paths: ["src/contract-edit.ts"],
      },
      cwd: root,
    });
    expect(verify.status).toBe(0);
    expect(verify.stdout.trim()).not.toBe("{}");
    const verifyOut = JSON.parse(verify.stdout.trim()) as {
      decision?: string;
      reason?: string;
      context?: string;
    };
    expect(verifyOut.decision).toBe("block");
    expect(verifyOut.reason).toBeTruthy();
    expect(verifyOut.context).toBeUndefined();
    expect(Object.keys(verifyOut).sort()).toEqual(["decision", "reason"]);
    expect(JSON.stringify(verifyOut)).not.toMatch(/continue:false|stopReason/);
    const pendingBeforeCross = withStore(root, (afterVerify) => {
      expect(afterVerify.getReviewChain(cid)?.chain_pending).toBe(1);
      const pending = afterVerify.getReviewChain(cid)?.pending_followup ?? null;
      expect(pending).toBeTruthy();
      return pending;
    });

    // Wrong stamp on Hermes event → {} before FSM (no new session).
    for (const badPlatform of [
      "factory-droid",
      "claude-code",
      "kimi-code",
      "codex",
      "gemini-cli",
      "grok-build",
    ] as const) {
      const wrongCid = `hook-hermes-wrong-${badPlatform}-0001`;
      const wrong = spawnHermesHook(
        root,
        "pre_llm_call",
        {
          session_id: wrongCid,
          user_message: "Autopilot ON",
          cwd: root,
        },
        badPlatform,
      );
      expect(wrong.status).toBe(0);
      expectHermesSilenceStdout(wrong.stdout);
      withStore(root, (wrongStore) => {
        expect(wrongStore.getSession(wrongCid)).toBeNull();
      });
    }

    // Hermes stamp + Claude/Cursor event → {} abort; no pending mutation.
    expect(pendingBeforeCross).toBeTruthy();
    const hermesClaude = spawnHermesHook(root, "UserPromptSubmit", {
      session_id: cid,
      prompt: "hostile claude shape",
      cwd: root,
    });
    expect(hermesClaude.status).toBe(0);
    expectHermesSilenceStdout(hermesClaude.stdout);
    withStore(root, (afterAbort) => {
      expect(afterAbort.getSession(cid)?.platform).toBe(HERMES_PLATFORM);
      expect(afterAbort.getReviewChain(cid)?.pending_followup ?? null).toBe(
        pendingBeforeCross,
      );
    });

    // Fresh project: Hermes stamp + Cursor-only event must not open state.db.
    const freshRoot = tmpProject();
    const outerHome = hermesHome;
    const freshHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-hermes-home-"));
    try {
      process.env.HERMES_HOME = freshHome;
      expect(
        installInitYes({
          projectRoot: freshRoot,
          platform: "hermes-agent",
          surface: "cli",
          locale: "en",
          force: false,
        }).ok,
      ).toBe(true);
      const freshAbort = spawnHermesHook(freshRoot, "beforeSubmitPrompt", {
        conversation_id: "hook-hermes-fresh-abort-0001",
        prompt: "hello",
      });
      expect(freshAbort.status).toBe(0);
      expectHermesSilenceStdout(freshAbort.stdout);
      expect(
        fs.existsSync(path.join(freshRoot, ".autopilot", "state.db")),
      ).toBe(false);
    } finally {
      try {
        fs.rmSync(freshRoot, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
      try {
        fs.rmSync(freshHome, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
      process.env.HERMES_HOME = outerHome;
    }
  });
});
