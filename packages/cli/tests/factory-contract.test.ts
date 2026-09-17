/**
 * v0.8 tests-factory-contract — umbrella matrix for Factory I/O (allow
 * stdout.length === 0; inject hookEventName; Silence), Post never block,
 * harness-owned UPS, merge/shape (top-level events + timeout 120 +
 * $FACTORY_PROJECT_DIR), nine-way + Claude stamp cross, runner empty-body.
 * Deeper suites: port-factory / factory-hooks-merge / status-doctor / upgrade.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatOneExecutorBusyMessage,
  ReviewEngine,
  StateStore,
} from "@autopilot-harness/core";
import {
  blockSubmit,
  FACTORY_DROID_ALLOW_MULTI_BLOCK_WHEN_ACTIVE,
  FACTORY_DROID_DEGRADED_STOP_CONTINUE_CAP,
  FACTORY_DROID_MULTI_BLOCK_ACROSS_ACTIVE_PROVEN,
  FACTORY_DROID_STOP_CAP_RAISE_FOUND,
  FACTORY_PLATFORM,
  FACTORY_POST_TOOL_USE_MATCHER,
  handlePostToolUse,
  handleStop,
  handleUserPromptSubmit,
  injectNeedPickContext,
  isFactoryEmptyStdout,
  MAX_NEED_PICK_SLUGS,
} from "../../ports/factory-droid/src/index.js";
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
  handleKimiPostToolUse,
  handleKimiStop,
  handleKimiUserPromptSubmit,
  handlePostToolUse as handleClaudePostToolUse,
  handleUserPromptSubmit as handleClaudeUserPromptSubmit,
  isFactoryEmptyStdout as vendorIsFactoryEmptyStdout,
} from "../src/vendor-entry.js";
import {
  FACTORY_AUTOPILOT_EVENTS,
  FACTORY_HOOK_TIMEOUT_SEC,
  FACTORY_HOOKS_REL_PATH,
  factoryHooksContainAutopilot,
  factoryHooksFileIsVacant,
  factoryHooksUseProjectDirEnv,
  hasCompleteFactoryAutopilotHooks,
  mergeFactoryHooks,
  stripAutopilotFactoryHooks,
  validateFactoryHooksShape,
} from "../src/init/factory-hooks-merge.js";
import { installInitYes } from "../src/init/install.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK_ASSET = path.resolve(
  __dirname,
  "../assets/autopilot-harness-hook.mjs",
);

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-factory-contract-"));
}

function writeChecklist(root: string, slug: string, body: string): void {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plan.md"), `# ${slug}\n`);
  fs.writeFileSync(path.join(dir, "checklist.md"), body);
}

function spawnFactoryHook(
  root: string,
  event: string,
  payload: Record<string, unknown>,
  platform = "factory-droid",
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
      env: {
        ...process.env,
        FACTORY_PROJECT_DIR: root,
      },
    },
  );
  // Spawn failure / timeout must not look like Factory Silence (empty stdout).
  if (proc.error) {
    throw proc.error;
  }
  if (proc.status == null) {
    throw new Error(
      `factory hook spawn killed: event=${event} platform=${platform} signal=${proc.signal}`,
    );
  }
  return {
    status: proc.status,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
  };
}

describe("factory contract matrix", () => {
  let root = "";
  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    root = "";
  });

  it("vendor-entry aliases Factory handlers", () => {
    expect(handleFactoryUserPromptSubmit).toBeTypeOf("function");
    expect(handleFactoryPostToolUse).toBeTypeOf("function");
    expect(handleFactoryStop).toBeTypeOf("function");
    expect(vendorIsFactoryEmptyStdout).toBeTypeOf("function");
    const vendorSrc = fs.readFileSync(
      path.resolve(__dirname, "../src/vendor-entry.ts"),
      "utf8",
    );
    expect(vendorSrc).toMatch(
      /handleUserPromptSubmit\s+as\s+handleFactoryUserPromptSubmit/,
    );
    expect(vendorSrc).toMatch(
      /handlePostToolUse\s+as\s+handleFactoryPostToolUse/,
    );
    expect(vendorSrc).toMatch(/handleStop\s+as\s+handleFactoryStop/);
    expect(vendorSrc).toMatch(
      /from\s+["']@autopilot-harness\/port-factory-droid["']/,
    );
    expect(handleFactoryUserPromptSubmit).not.toBe(handleClaudeUserPromptSubmit);
    expect(handleFactoryPostToolUse).not.toBe(handleClaudePostToolUse);
    expect(handleFactoryStop).not.toBe(handleClaudeStop);
    expect(handleFactoryUserPromptSubmit).not.toBe(handleCodexUserPromptSubmit);
    expect(handleFactoryPostToolUse).not.toBe(handleCodexPostToolUse);
    expect(handleFactoryStop).not.toBe(handleCodexStop);
    expect(handleFactoryUserPromptSubmit).not.toBe(handleKimiUserPromptSubmit);
    expect(handleFactoryPostToolUse).not.toBe(handleKimiPostToolUse);
    expect(handleFactoryStop).not.toBe(handleKimiStop);
    expect(handleFactoryUserPromptSubmit).not.toBe(handleCopilotUserPromptSubmit);
    expect(handleFactoryPostToolUse).not.toBe(handleCopilotPostToolUse);
    expect(handleFactoryStop).not.toBe(handleCopilotStop);
    expect(handleFactoryUserPromptSubmit).not.toBe(handleGrokUserPromptSubmit);
    expect(handleFactoryPostToolUse).not.toBe(handleGrokPostToolUse);
    expect(handleFactoryStop).not.toBe(handleGrokStop);
    expect(handleFactoryUserPromptSubmit).not.toBe(handleGeminiUserPromptSubmit);
    expect(handleFactoryPostToolUse).not.toBe(handleGeminiPostToolUse);
    expect(handleFactoryStop).not.toBe(handleGeminiStop);
    expect(vendorIsFactoryEmptyStdout({})).toBe(true);
    expect(
      vendorIsFactoryEmptyStdout({ decision: "block", reason: "x" }),
    ).toBe(false);
  });

  it("shipped hook asset keeps ten-way dispatch + Factory empty-body writer", () => {
    expect(fs.existsSync(HOOK_ASSET)).toBe(true);
    const src = fs.readFileSync(HOOK_ASSET, "utf8");
    expect(src).toMatch(
      /KNOWN_PLATFORMS\s*=\s*new Set\(\[\s*"cursor"\s*,\s*"claude-code"\s*,\s*"codex"\s*,\s*"kimi-code"\s*,\s*"copilot-cli"\s*,\s*"grok-build"\s*,\s*"gemini-cli"\s*,\s*"factory-droid"\s*,\s*"hermes-agent"\s*,\s*"antigravity"\s*,?\s*\]\)/,
    );
    expect(src).toMatch(
      /FACTORY_EVENTS\s*=\s*new Set\(\[\s*"UserPromptSubmit"\s*,\s*"PostToolUse"\s*,\s*"Stop"\s*,?\s*\]\)/,
    );
    expect(src).toMatch(/handleFactoryUserPromptSubmit/);
    expect(src).toMatch(/handleFactoryPostToolUse/);
    expect(src).toMatch(/handleFactoryStop/);
    expect(src).toMatch(/writeFactoryReply|isFactoryEmptyStdoutResult/);
    expect(src).toMatch(/clipFactoryStdio|FACTORY_MAX_STDIO_CHARS/);
    expect(src).toMatch(/declaredPlatform === "factory-droid"/);
    expect(src).toMatch(/hostId === "factory-droid"/);
    // Shared Pascal events must not imply Claude when factory-droid is stamped.
    expect(src).toMatch(
      /Never map PascalCase events to Claude[\s\S]*factory-droid/,
    );
    // Missing/illegal Cursor-only event with Factory stamp → zero-byte fail-open.
    expect(src).toMatch(
      /CURSOR_EVENTS\.has\(event\)\s*&&\s*hostId\s*!==\s*"cursor"/,
    );
  });

  it("I/O: ON empty allow; needPick inject has hookEventName; block fallback; Silence", () => {
    expect(FACTORY_DROID_STOP_CAP_RAISE_FOUND).toBe(false);
    expect(FACTORY_DROID_MULTI_BLOCK_ACROSS_ACTIVE_PROVEN).toBe(true);
    expect(FACTORY_DROID_ALLOW_MULTI_BLOCK_WHEN_ACTIVE).toBe(true);
    expect(FACTORY_DROID_DEGRADED_STOP_CONTINUE_CAP).toBe(1);
    expect(FACTORY_PLATFORM).toBe("factory-droid");
    expect(FACTORY_POST_TOOL_USE_MATCHER).toBe("Create|Edit|ApplyPatch");
    expect(isFactoryEmptyStdout({})).toBe(true);
    expect(isFactoryEmptyStdout({ decision: "block", reason: "x" })).toBe(
      false,
    );
    expect(isFactoryEmptyStdout(null)).toBe(false);
    expect(isFactoryEmptyStdout({ reason: "   " })).toBe(false);
    expect(
      isFactoryEmptyStdout({ continue: false, stopReason: "Stuck: x" }),
    ).toBe(false);

    root = tmpProject();
    writeChecklist(root, "alpha", "- [ ] a — A\n");
    writeChecklist(root, "beta", "- [ ] b — B\n");
    const store = new StateStore(root);
    try {
      const cid = "fac-pick-1";
      const on = handleUserPromptSubmit(
        store,
        { sessionId: cid, prompt: "Autopilot ON" },
        root,
      );
      // Silence: success allow is exactly {} (runner empties stdout).
      expect(on).toEqual({});
      expect(Object.keys(on)).toEqual([]);
      expect(isFactoryEmptyStdout(on)).toBe(true);
      expect(store.getSession(cid)?.phase).toBe("planning");
      expect(store.getSession(cid)?.platform).toBe(FACTORY_PLATFORM);

      // Blank / missing / control-char session id → fail-open Silence, no row.
      expect(
        handleUserPromptSubmit(
          store,
          { sessionId: "", prompt: "Autopilot ON" },
          root,
        ),
      ).toEqual({});
      expect(
        handleUserPromptSubmit(
          store,
          { prompt: "Autopilot RUN" } as { prompt: string },
          root,
        ),
      ).toEqual({});
      expect(
        handleUserPromptSubmit(
          store,
          { sessionId: "   ", prompt: "Autopilot ON" },
          root,
        ),
      ).toEqual({});
      expect(
        handleUserPromptSubmit(
          store,
          { sessionId: "bad\u0000id", prompt: "Autopilot ON" },
          root,
        ),
      ).toEqual({});
      expect(store.getSession("") ?? null).toBeNull();
      expect(store.getSession("   ") ?? null).toBeNull();
      expect(store.getSession("bad\u0000id") ?? null).toBeNull();
      expect(store.getSession(cid)?.phase).toBe("planning");

      const run = handleUserPromptSubmit(
        store,
        { session_id: cid, prompt: "Autopilot RUN" },
        root,
      );
      expect(run.hookSpecificOutput?.hookEventName).toBe("UserPromptSubmit");
      expect(run.hookSpecificOutput?.additionalContext).toMatch(
        /Select a plan|alpha|beta/i,
      );
      expect(run.decision).toBeUndefined();
      expect(run).not.toHaveProperty("decision");
      expect(Object.keys(run).sort()).toEqual(["hookSpecificOutput"]);
      expect(isFactoryEmptyStdout(run)).toBe(false);
      expect(store.getSession(cid)?.phase).toBe("planning");
      expect(store.getSession(cid)?.pending_action).toBe("run");
      expect(store.getSession(cid)?.track_id).toBe("_pending");
      const pickCands = JSON.parse(
        store.getSession(cid)?.track_candidates_json ?? "null",
      ) as Array<{ slug?: string }>;
      expect(Array.isArray(pickCands)).toBe(true);
      expect(
        pickCands
          .map((c) => c.slug)
          .filter(Boolean)
          .sort(),
      ).toEqual(["alpha", "beta"]);

      const many = Array.from({ length: MAX_NEED_PICK_SLUGS + 3 }, (_, i) => ({
        slug: `plan-${i}`,
      }));
      const injected = injectNeedPickContext("", many);
      expect(injected.hookSpecificOutput?.hookEventName).toBe(
        "UserPromptSubmit",
      );
      expect(injected.decision).toBeUndefined();
      expect(Object.keys(injected).sort()).toEqual(["hookSpecificOutput"]);
      expect(injected).not.toHaveProperty("decision");
      expect(injected).not.toHaveProperty("reason");
      const pickCtx = injected.hookSpecificOutput?.additionalContext ?? "";
      expect(pickCtx).toMatch(/plan-0/);
      expect(pickCtx).not.toMatch(
        new RegExp(`plan-${MAX_NEED_PICK_SLUGS}(?:\\D|$)`),
      );
      const unsafePick = injectNeedPickContext("", [
        { slug: "safe-slug" },
        { slug: "../evil" },
        { slug: "bad/slug" },
        { slug: "has space" },
        { slug: "" },
      ]);
      const unsafeCtx =
        unsafePick.hookSpecificOutput?.additionalContext ?? "";
      expect(unsafeCtx).toMatch(/safe-slug/);
      expect(unsafeCtx).not.toMatch(/\.\.\/evil/);
      expect(unsafeCtx).not.toMatch(/bad\/slug/);
      expect(unsafeCtx).not.toMatch(/has space/);

      const blocked = blockSubmit("pick", "fallback");
      expect(blocked.decision).toBe("block");
      expect(blocked.reason).toBeTruthy();
      expect(Object.keys(blocked).sort()).toEqual(["decision", "reason"]);
      expect(blocked).not.toHaveProperty("hookSpecificOutput");
      expect(isFactoryEmptyStdout(blocked)).toBe(false);

      expect(
        handleUserPromptSubmit(
          store,
          { session_id: cid, prompt: "/autopilot-run alpha" },
          root,
        ),
      ).toEqual({});
      expect(store.getSession(cid)?.phase).toBe("executing");
      expect(store.getSession(cid)?.track_id).toBe("alpha");
      expect(store.getSession(cid)?.armed).toBe(1);
      expect(store.getSession(cid)?.pending_action ?? null).toBeNull();
      expect(store.getSession(cid)?.track_candidates_json ?? null).toBeNull();
      expect(store.getSession(cid)?.checklist_path).toMatch(
        /plans[/\\]alpha[/\\]checklist\.md$/,
      );

      // Idempotent same-session re-RUN: keep bind + parked review tip.
      store.updateReviewChain(cid, {
        fix_round: 2,
        chain_pending: 1,
        pending_followup: "Review fix round park",
      });
      expect(
        handleUserPromptSubmit(
          store,
          { session_id: cid, prompt: "/autopilot-run alpha" },
          root,
        ),
      ).toEqual({});
      expect(store.getSession(cid)?.phase).toBe("executing");
      expect(store.getSession(cid)?.track_id).toBe("alpha");
      expect(store.getSession(cid)?.armed).toBe(1);
      expect(store.getSession(cid)?.pending_action ?? null).toBeNull();
      expect(store.getReviewChain(cid)?.fix_round).toBe(2);
      expect(store.getReviewChain(cid)?.chain_pending).toBe(1);
      expect(store.getReviewChain(cid)?.pending_followup).toBe(
        "Review fix round park",
      );

      const busy = handleUserPromptSubmit(
        store,
        { sessionId: "fac-peer", prompt: "/autopilot-run alpha" },
        root,
      );
      expect(busy.decision).toBe("block");
      expect(busy.reason).toBe(formatOneExecutorBusyMessage("alpha", cid));
      expect(JSON.stringify(busy)).not.toMatch(/Review fix round park/);
      expect(busy).not.toHaveProperty("hookSpecificOutput");
      expect(Object.keys(busy).sort()).toEqual(["decision", "reason"]);
      expect(store.getSession(cid)?.phase).toBe("executing");
      expect(store.getSession(cid)?.track_id).toBe("alpha");
      expect(store.getSession(cid)?.armed).toBe(1);
      expect(store.getReviewChain(cid)?.chain_pending).toBe(1);
      expect(store.getReviewChain(cid)?.pending_followup).toBe(
        "Review fix round park",
      );
      // No *other* executor besides the owner.
      expect(store.findExecutingSession(cid)).toBeNull();
      expect(store.getSession("fac-peer")).toMatchObject({
        phase: "idle",
        track_id: "_pending",
      });
      expect(store.getSession("fac-peer")!.checklist_path).toBe("");
      expect(store.getSession("fac-peer")?.pending_action ?? null).toBeNull();
      expect(store.getReviewChain("fac-peer")).toBeNull();
    } finally {
      store.close();
    }
  });

  it("UPS harness-owned followup does not clear chain_pending", () => {
    root = tmpProject();
    writeChecklist(root, "trk", "- [ ] x — X\n");
    const store = new StateStore(root);
    try {
      const cid = "fac-follow";
      const cp = path.join(root, "plans", "trk", "checklist.md");
      store.upsertSession({
        conversation_id: cid,
        project_root: root,
        code_root: root,
        phase: "executing",
        track_id: "trk",
        checklist_path: cp,
        platform: FACTORY_PLATFORM,
      });
      store.updateReviewChain(cid, {
        chain_pending: 1,
        pending_followup: "Review fix round 1",
      });
      const out = handleUserPromptSubmit(
        store,
        {
          sessionId: cid,
          prompt: "Review fix round 1 — keep going",
        },
        root,
      );
      expect(out).toEqual({});
      expect(isFactoryEmptyStdout(out)).toBe(true);
      expect(store.getReviewChain(cid)?.chain_pending).toBe(1);
      expect(store.getReviewChain(cid)?.pending_followup).toMatch(
        /Review fix round 1/,
      );
      expect(store.getSession(cid)?.phase).toBe("executing");
      expect(store.getSession(cid)?.track_id).toBe("trk");

      handleUserPromptSubmit(
        store,
        { sessionId: cid, prompt: "ordinary user chat" },
        root,
      );
      // E8: ordinary chat clears chain_pending only — keep pending_followup.
      expect(store.getReviewChain(cid)?.chain_pending ?? 0).toBe(0);
      expect(store.getReviewChain(cid)?.pending_followup).toMatch(
        /Review fix round 1/,
      );
      expect(store.getSession(cid)?.phase).toBe("executing");
      expect(store.getSession(cid)?.track_id).toBe("trk");

      // zh Stop→UPS followup must also stay harness-owned.
      store.updateReviewChain(cid, {
        chain_pending: 1,
        pending_followup: "自审修复第 1 轮",
      });
      handleUserPromptSubmit(
        store,
        {
          sessionId: cid,
          prompt: "自审修复第 1 轮（无硬顶；确认阶段需连续 5 轮无改动）。",
        },
        root,
      );
      expect(store.getReviewChain(cid)?.chain_pending).toBe(1);
      expect(store.getReviewChain(cid)?.pending_followup).toMatch(/自审修复/);
      expect(store.getSession(cid)?.phase).toBe("executing");
    } finally {
      store.close();
    }
  });

  it("PostToolUse never block; Stop continue is decision:block+reason; Silence keys", () => {
    root = tmpProject();
    writeChecklist(root, "demo", "- [ ] a — A\n- [ ] b — B\n");
    const store = new StateStore(root);
    try {
      const cid = "fac-stop";
      const cp = path.join(root, "plans", "demo", "checklist.md");
      store.upsertSession({
        conversation_id: cid,
        project_root: root,
        code_root: root,
        phase: "executing",
        armed: 1,
        paused: 0,
        checklist_path: cp,
        track_id: "demo",
        platform: FACTORY_PLATFORM,
      });

      fs.mkdirSync(path.join(root, "src"), { recursive: true });
      const file = path.join(root, "src", "x.ts");
      fs.writeFileSync(file, "export const x = 1;\n");

      const afterEdit = handlePostToolUse(
        store,
        {
          sessionId: cid,
          toolName: "Edit",
          toolInput: { file_path: file },
        },
        root,
      );
      // Post is void / observe-only — never decision:block.
      expect(afterEdit).toBeUndefined();
      expect(store.getReviewChain(cid)?.code_edited).toBe(1);

      store.updateReviewChain(cid, { code_edited: 0 });
      handlePostToolUse(
        store,
        {
          session_id: cid,
          tool_name: "Create",
          tool_input: { path: file },
        },
        root,
      );
      expect(store.getReviewChain(cid)?.code_edited).toBe(1);

      store.updateReviewChain(cid, { code_edited: 0 });
      handlePostToolUse(
        store,
        {
          sessionId: cid,
          toolName: "Execute",
          toolInput: { command: "echo hi" },
        },
        root,
      );
      expect(store.getReviewChain(cid)?.code_edited ?? 0).toBe(0);

      // Edit tool with no resolvable path — still Silence, no arm.
      const afterEmptyPath = handlePostToolUse(
        store,
        {
          session_id: cid,
          tool_name: "Edit",
          tool_input: {},
        },
        root,
      );
      expect(afterEmptyPath).toBeUndefined();
      expect(store.getReviewChain(cid)?.code_edited ?? 0).toBe(0);

      // ApplyPatch arms; still never returns a block payload.
      store.updateReviewChain(cid, { code_edited: 0 });
      const afterPatch = handlePostToolUse(
        store,
        {
          session_id: cid,
          tool_name: "ApplyPatch",
          tool_input: {
            command: `*** Update File: ${file}\n@@\n-a\n+b\n`,
          },
        },
        root,
      );
      expect(afterPatch).toBeUndefined();
      expect(store.getReviewChain(cid)?.code_edited).toBe(1);

      // plans/** ignored — no dirty-arm, still Silence (void).
      store.updateReviewChain(cid, { code_edited: 0 });
      handlePostToolUse(
        store,
        {
          sessionId: cid,
          toolName: "Edit",
          toolInput: {
            file_path: path.join(root, "plans", "demo", "plan.md"),
          },
        },
        root,
      );
      expect(store.getReviewChain(cid)?.code_edited ?? 0).toBe(0);

      store.updateReviewChain(cid, { code_edited: 1 });
      const eng = new ReviewEngine(store, {
        confirmRounds: 1,
        reviewScope: "executing_only",
        verifyEnabled: false,
        verifyCommands: [],
        maxIdleStops: 5,
        maxErrorsBeforePause: 0,
        projectRoot: root,
        recoverDebounceMs: 0,
      });
      const cont = handleStop(eng, {
        sessionId: cid,
        reason: "end_turn",
        stop_hook_active: false,
      });
      expect(cont.decision).toBe("block");
      expect(cont.reason).toBeTruthy();
      expect(cont.continue).toBeUndefined();
      expect(cont).not.toHaveProperty("hookSpecificOutput");
      expect(Object.keys(cont).sort()).toEqual(["decision", "reason"]);
      expect(isFactoryEmptyStdout(cont)).toBe(false);
      expect(store.getReviewChain(cid)?.chain_pending).toBe(1);
      expect(store.getReviewChain(cid)?.pending_followup).toBeTruthy();
      const tipAfterBlock = store.getReviewChain(cid)?.pending_followup ?? null;

      // Re-arm + stop_hook_active: default ALLOW_MULTI must still continue (block).
      store.updateReviewChain(cid, {
        code_edited: 1,
        chain_pending: 1,
        pending_followup: tipAfterBlock,
      });
      const multi = handleStop(eng, {
        sessionId: cid,
        reason: "end_turn",
        stop_hook_active: true,
      });
      expect(multi.decision).toBe("block");
      expect(multi.reason).toBeTruthy();
      expect(multi.continue).toBeUndefined();
      expect(Object.keys(multi).sort()).toEqual(["decision", "reason"]);
      expect(store.getReviewChain(cid)?.chain_pending).toBe(1);
      const tipAfterMulti = store.getReviewChain(cid)?.pending_followup ?? null;
      expect(tipAfterMulti).toBeTruthy();

      // Empty followup message → Silence (never block JSON).
      expect(
        handleStop(
          {
            handleStop: () => ({
              kind: "fix",
              message: "",
              loop: true,
            }),
          } as unknown as ReviewEngine,
          { sessionId: cid, stopHookActive: true },
        ),
      ).toEqual({});

      const halt = handleStop(
        {
          handleStop: () => ({
            kind: "stuck",
            message: "Stuck: contract halt",
            loop: false,
          }),
        } as unknown as ReviewEngine,
        { sessionId: cid, reason: "end_turn" },
      );
      expect(halt.continue).toBe(false);
      expect(halt.decision).toBeUndefined();
      expect(halt.stopReason).toMatch(/Stuck: contract halt/);
      expect(Object.keys(halt).sort()).toEqual(["continue", "stopReason"]);
      expect(isFactoryEmptyStdout(halt)).toBe(false);

      expect(
        handleStop(
          { handleStop: () => null } as unknown as ReviewEngine,
          { sessionId: cid, stop_hook_active: false },
        ),
      ).toEqual({});
      expect(
        handleStop(eng, { sessionId: "   ", stop_hook_active: false }),
      ).toEqual({});
      expect(
        handleStop(eng, { sessionId: "bad\u0000id", reason: "end_turn" }),
      ).toEqual({});
      // Blank sid must not unbind the live executing session.
      expect(store.getSession(cid)?.phase).toBe("executing");
      expect(store.getSession(cid)?.track_id).toBe("demo");
      expect(store.getSession("   ") ?? null).toBeNull();
      expect(store.getSession("bad\u0000id") ?? null).toBeNull();

      // User abort / non-completion → Silence (never block); tip survives.
      store.updateReviewChain(cid, { code_edited: 1 });
      expect(
        handleStop(eng, {
          sessionId: cid,
          status: "aborted",
          reason: "end_turn",
        }),
      ).toEqual({});
      expect(
        handleStop(eng, {
          session_id: cid,
          reason: "channel_closed",
        }),
      ).toEqual({});
      expect(store.getSession(cid)?.phase).toBe("executing");
      expect(store.getReviewChain(cid)?.pending_followup ?? null).toBe(
        tipAfterMulti,
      );
      expect(store.getReviewChain(cid)?.chain_pending).toBe(1);
    } finally {
      store.close();
    }
  });

  it("hooks merge: top-level events, timeout 120, $FACTORY_PROJECT_DIR; shape fail-closed", () => {
    expect(FACTORY_HOOK_TIMEOUT_SEC).toBe(120);
    expect(FACTORY_HOOKS_REL_PATH).toBe(".factory/hooks.json");
    expect([...FACTORY_AUTOPILOT_EVENTS]).toEqual([
      "UserPromptSubmit",
      "PostToolUse",
      "Stop",
    ]);

    const merged = mergeFactoryHooks(null);
    expect(hasCompleteFactoryAutopilotHooks(merged)).toBe(true);
    expect(validateFactoryHooksShape(merged)).toBeNull();
    expect(factoryHooksUseProjectDirEnv(merged)).toBe(true);
    expect(merged.hooks).toBeUndefined();
    for (const event of FACTORY_AUTOPILOT_EVENTS) {
      const groups = merged[event] as Array<{
        matcher?: string;
        hooks?: Array<{ type?: string; command?: string; timeout?: number }>;
      }>;
      expect(Array.isArray(groups)).toBe(true);
      expect(groups.length).toBe(1);
      const g = groups[0]!;
      if (event === "PostToolUse") {
        expect(g.matcher).toBe(FACTORY_POST_TOOL_USE_MATCHER);
      } else {
        expect(g.matcher).toBeUndefined();
      }
      const h = g.hooks?.[0];
      expect(h?.type).toBe("command");
      expect(h?.timeout).toBe(FACTORY_HOOK_TIMEOUT_SEC);
      expect(h?.command).toBe(
        `node "$FACTORY_PROJECT_DIR"/.autopilot/bin/autopilot-harness-hook.mjs --platform factory-droid --event ${event}`,
      );
    }

    const withForeign = mergeFactoryHooks({
      description: "keep-me",
      Stop: [
        {
          hooks: [
            { type: "command", command: "echo keep-foreign", timeout: 9 },
          ],
        },
      ],
    });
    expect(factoryHooksContainAutopilot(withForeign)).toBe(true);
    expect(JSON.stringify(withForeign.Stop)).toMatch(/echo keep-foreign/);
    expect(withForeign.description).toBe("keep-me");

    const stripped = stripAutopilotFactoryHooks(withForeign);
    expect(factoryHooksContainAutopilot(stripped)).toBe(false);
    expect(JSON.stringify(stripped.Stop)).toMatch(/echo keep-foreign/);
    expect(JSON.stringify(stripped)).not.toMatch(/autopilot-harness-hook\.mjs/);
    expect(factoryHooksFileIsVacant(stripped)).toBe(false);
    expect(
      factoryHooksFileIsVacant(
        stripAutopilotFactoryHooks(mergeFactoryHooks(null)),
      ),
    ).toBe(true);

    expect(
      validateFactoryHooksShape({
        hooks: {
          Stop: [
            {
              hooks: [
                {
                  type: "command",
                  command:
                    "node \"$FACTORY_PROJECT_DIR\"/.autopilot/bin/autopilot-harness-hook.mjs --platform factory-droid --event Stop",
                },
              ],
            },
          ],
        },
      }),
    ).toMatch(/top-level event keys/i);
  });

  it("runner empty-body: allow stdout.length === 0; inject/block JSON; Claude stamp cross", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "factory-droid",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    writeChecklist(root, "alpha", "- [ ] a — A\n");
    writeChecklist(root, "beta", "- [ ] b — B\n");

    const cid = "hook-factory-contract-aaaa-bbbb-cccc-ddddeeee0001";

    const on = spawnFactoryHook(root, "UserPromptSubmit", {
      session_id: cid,
      prompt: "Autopilot ON",
      cwd: root,
    });
    expect(on.status).toBe(0);
    expect(on.stdout.length).toBe(0);
    expect(on.stdout).toBe("");
    // Never leak JSON {} into model context on allow.
    expect(on.stdout.trim()).not.toBe("{}");
    const onStore = new StateStore(root);
    expect(onStore.getSession(cid)?.phase).toBe("planning");
    expect(onStore.getSession(cid)?.platform).toBe(FACTORY_PLATFORM);
    onStore.close();

    const pick = spawnFactoryHook(root, "UserPromptSubmit", {
      session_id: cid,
      prompt: "Autopilot RUN",
      cwd: root,
    });
    expect(pick.status).toBe(0);
    expect(pick.stdout.length).toBeGreaterThan(0);
    const pickOut = JSON.parse(pick.stdout.trim()) as {
      hookSpecificOutput?: {
        hookEventName?: string;
        additionalContext?: string;
      };
      decision?: string;
    };
    expect(pickOut.hookSpecificOutput?.hookEventName).toBe("UserPromptSubmit");
    expect(pickOut.hookSpecificOutput?.additionalContext).toMatch(
      /Select a plan|alpha|beta/i,
    );
    expect(pickOut.decision).toBeUndefined();
    expect(pickOut).not.toHaveProperty("reason");
    expect(Object.keys(pickOut).sort()).toEqual(["hookSpecificOutput"]);

    // Bind executing first, then Post must arm + stay zero-byte (never {} / block).
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    const editFile = path.join(root, "src", "contract-edit.ts");
    fs.writeFileSync(editFile, "export const n = 1;\n");
    const armed = new StateStore(root);
    armed.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: FACTORY_PLATFORM,
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "alpha",
      checklist_path: path.join(root, "plans", "alpha", "checklist.md"),
    });
    armed.close();

    const post = spawnFactoryHook(root, "PostToolUse", {
      session_id: cid,
      tool_name: "Edit",
      tool_input: { file_path: editFile },
      cwd: root,
    });
    expect(post.status).toBe(0);
    expect(post.stdout.length).toBe(0);
    expect(post.stdout).toBe("");
    expect(post.stdout.trim()).not.toBe("{}");
    const postStore = new StateStore(root);
    expect(postStore.getSession(cid)?.phase).toBe("executing");
    expect(postStore.getReviewChain(cid)?.code_edited).toBe(1);
    postStore.close();

    // Stop continue is block JSON (not empty / not {}).
    const stop = spawnFactoryHook(root, "Stop", {
      session_id: cid,
      reason: "end_turn",
      stop_hook_active: false,
      cwd: root,
    });
    expect(stop.status).toBe(0);
    expect(stop.stdout.length).toBeGreaterThan(0);
    expect(stop.stdout.trim()).not.toBe("{}");
    const stopOut = JSON.parse(stop.stdout.trim()) as {
      decision?: string;
      reason?: string;
      continue?: boolean;
    };
    expect(stopOut.decision).toBe("block");
    expect(stopOut.reason).toBeTruthy();
    expect(stopOut.continue).toBeUndefined();
    expect(stopOut).not.toHaveProperty("hookSpecificOutput");
    expect(Object.keys(stopOut).sort()).toEqual(["decision", "reason"]);
    const afterStop = new StateStore(root);
    expect(afterStop.getReviewChain(cid)?.chain_pending).toBe(1);
    expect(afterStop.getReviewChain(cid)?.pending_followup).toBeTruthy();
    // Stop opens fix → code_edited cleared; prove plans path cannot re-arm.
    expect(afterStop.getReviewChain(cid)?.code_edited ?? 0).toBe(0);
    afterStop.close();

    // plans/** via runner — empty stdout and no dirty-arm.
    const plansPost = spawnFactoryHook(root, "PostToolUse", {
      session_id: cid,
      tool_name: "Edit",
      tool_input: {
        file_path: path.join(root, "plans", "alpha", "plan.md"),
      },
      cwd: root,
    });
    expect(plansPost.status).toBe(0);
    expect(plansPost.stdout.length).toBe(0);
    expect(plansPost.stdout.trim()).not.toBe("{}");
    const plansStore = new StateStore(root);
    expect(plansStore.getSession(cid)?.phase).toBe("executing");
    expect(plansStore.getReviewChain(cid)?.code_edited ?? 0).toBe(0);
    expect(plansStore.getReviewChain(cid)?.chain_pending).toBe(1);
    plansStore.close();

    // Missing session Stop → Silence empty body (never stringify {}).
    const silenceStop = spawnFactoryHook(root, "Stop", {
      session_id: "hook-factory-missing-stop-0001",
      reason: "end_turn",
      cwd: root,
    });
    expect(silenceStop.status).toBe(0);
    expect(silenceStop.stdout.length).toBe(0);
    expect(silenceStop.stdout.trim()).not.toBe("{}");
    const silenceStore = new StateStore(root);
    expect(
      silenceStore.getSession("hook-factory-missing-stop-0001"),
    ).toBeNull();
    silenceStore.close();

    // User abort under Factory stamp → empty body; keep executing lease.
    const beforeAbort = new StateStore(root);
    const tipBefore =
      beforeAbort.getReviewChain(cid)?.pending_followup ?? null;
    expect(tipBefore).toBeTruthy();
    expect(beforeAbort.getReviewChain(cid)?.chain_pending).toBe(1);
    expect(beforeAbort.getSession(cid)?.phase).toBe("executing");
    beforeAbort.close();
    const abortStop = spawnFactoryHook(root, "Stop", {
      session_id: cid,
      status: "aborted",
      reason: "end_turn",
      cwd: root,
    });
    expect(abortStop.status).toBe(0);
    expect(abortStop.stdout.length).toBe(0);
    expect(abortStop.stdout.trim()).not.toBe("{}");
    const afterAbort = new StateStore(root);
    expect(afterAbort.getSession(cid)?.phase).toBe("executing");
    expect(afterAbort.getSession(cid)?.track_id).toBe("alpha");
    expect(afterAbort.getSession(cid)?.platform).toBe(FACTORY_PLATFORM);
    expect(afterAbort.getReviewChain(cid)?.pending_followup ?? null).toBe(
      tipBefore,
    );
    expect(afterAbort.getReviewChain(cid)?.chain_pending).toBe(1);
    afterAbort.close();

    // Claude stamp on shared UPS → Claude allow `{}` (not Factory empty body).
    const claudeOn = spawnFactoryHook(
      root,
      "UserPromptSubmit",
      {
        session_id: "hook-claude-cross-aaaa-bbbb-cccc-ddddeeee0002",
        prompt: "hello claude",
        cwd: root,
      },
      "claude-code",
    );
    expect(claudeOn.status).toBe(0);
    expect(claudeOn.stdout.trim()).toBe("{}");
    expect(claudeOn.stdout.length).toBeGreaterThan(0);
    // Claude allow must not steal the Factory executing lease or wipe tip.
    const afterClaude = new StateStore(root);
    expect(afterClaude.getSession(cid)?.phase).toBe("executing");
    expect(afterClaude.getSession(cid)?.track_id).toBe("alpha");
    expect(afterClaude.getSession(cid)?.platform).toBe(FACTORY_PLATFORM);
    expect(afterClaude.getReviewChain(cid)?.pending_followup ?? null).toBe(
      tipBefore,
    );
    expect(afterClaude.getReviewChain(cid)?.chain_pending).toBe(1);
    expect(afterClaude.findExecutingSession(cid)).toBeNull();
    const claudePeer = afterClaude.getSession(
      "hook-claude-cross-aaaa-bbbb-cccc-ddddeeee0002",
    );
    expect(claudePeer == null || claudePeer.phase === "idle").toBe(true);
    expect(claudePeer?.armed ?? 0).toBe(0);
    afterClaude.close();

    // Grok stamp on shared UPS → Grok allow `{}` (not Factory empty body); no lease steal.
    const grokOn = spawnFactoryHook(
      root,
      "UserPromptSubmit",
      {
        session_id: "hook-grok-cross-aaaa-bbbb-cccc-ddddeeee0003",
        prompt: "hello grok",
        cwd: root,
      },
      "grok-build",
    );
    expect(grokOn.status).toBe(0);
    expect(grokOn.stdout.trim()).toBe("{}");
    expect(grokOn.stdout.length).toBeGreaterThan(0);
    const afterGrok = new StateStore(root);
    expect(afterGrok.getSession(cid)?.phase).toBe("executing");
    expect(afterGrok.getSession(cid)?.platform).toBe(FACTORY_PLATFORM);
    expect(afterGrok.getReviewChain(cid)?.pending_followup ?? null).toBe(
      tipBefore,
    );
    expect(afterGrok.getReviewChain(cid)?.chain_pending).toBe(1);
    expect(afterGrok.findExecutingSession(cid)).toBeNull();
    const grokPeer = afterGrok.getSession(
      "hook-grok-cross-aaaa-bbbb-cccc-ddddeeee0003",
    );
    expect(grokPeer == null || grokPeer.phase === "idle").toBe(true);
    expect(grokPeer?.armed ?? 0).toBe(0);
    afterGrok.close();

    // Factory stamp + Cursor-only event → abort before FSM, zero-byte.
    const wrongEvent = spawnFactoryHook(root, "beforeSubmitPrompt", {
      conversation_id: "hook-factory-wrong-event-0001",
      prompt: "hello",
      cwd: root,
    });
    expect(wrongEvent.status).toBe(0);
    expect(wrongEvent.stdout.length).toBe(0);
    expect(wrongEvent.stdout.trim()).not.toBe("{}");
    const wrongStore = new StateStore(root);
    expect(wrongStore.getSession("hook-factory-wrong-event-0001")).toBeNull();
    expect(wrongStore.getSession(cid)?.phase).toBe("executing");
    expect(wrongStore.getReviewChain(cid)?.pending_followup ?? null).toBe(
      tipBefore,
    );
    expect(wrongStore.getReviewChain(cid)?.chain_pending).toBe(1);
    wrongStore.close();

    // Factory stamp + StopFailure (Claude-only) → fail-open empty body.
    const beforeFail = new StateStore(root);
    const tipBeforeFail =
      beforeFail.getReviewChain(cid)?.pending_followup ?? null;
    const phaseBeforeFail = beforeFail.getSession(cid)?.phase;
    const pendingBeforeFail = beforeFail.getReviewChain(cid)?.chain_pending;
    beforeFail.close();
    const stopFail = spawnFactoryHook(root, "StopFailure", {
      session_id: cid,
      cwd: root,
    });
    expect(stopFail.status).toBe(0);
    expect(stopFail.stdout.length).toBe(0);
    expect(stopFail.stdout.trim()).not.toBe("{}");
    const afterFail = new StateStore(root);
    expect(afterFail.getSession(cid)?.phase).toBe(phaseBeforeFail);
    expect(afterFail.getReviewChain(cid)?.pending_followup ?? null).toBe(
      tipBeforeFail,
    );
    expect(afterFail.getReviewChain(cid)?.chain_pending).toBe(pendingBeforeFail);
    afterFail.close();
  });

  it("init ignore includes .factory/hooks.json; add-platform keeps Cursor", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    expect(
      installInitYes({
        projectRoot: root,
        platform: "factory-droid",
        surface: "cli",
        locale: "en",
        force: true,
        mergePlatforms: true,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();

    const ignore = fs.readFileSync(
      path.join(root, ".autopilotignore"),
      "utf8",
    );
    expect(ignore).toMatch(/\.factory\/hooks\.json/);
    expect(fs.existsSync(path.join(root, ".cursor", "hooks.json"))).toBe(true);
    const cursorHooks = JSON.parse(
      fs.readFileSync(path.join(root, ".cursor", "hooks.json"), "utf8"),
    ) as { hooks?: { beforeSubmitPrompt?: Array<{ command?: string }> } };
    expect(
      cursorHooks.hooks?.beforeSubmitPrompt?.some(
        (h) =>
          typeof h.command === "string" &&
          h.command.includes("--platform cursor"),
      ),
    ).toBe(true);
    const factoryPath = path.join(root, ".factory", "hooks.json");
    expect(fs.existsSync(factoryPath)).toBe(true);
    const factoryHooks = JSON.parse(fs.readFileSync(factoryPath, "utf8")) as {
      hooks?: unknown;
      UserPromptSubmit?: Array<{
        matcher?: string;
        hooks?: Array<{ command?: string; timeout?: number }>;
      }>;
      PostToolUse?: Array<{
        matcher?: string;
        hooks?: Array<{ command?: string; timeout?: number }>;
      }>;
      Stop?: Array<{
        matcher?: string;
        hooks?: Array<{ command?: string; timeout?: number }>;
      }>;
    };
    expect(hasCompleteFactoryAutopilotHooks(factoryHooks)).toBe(true);
    expect(validateFactoryHooksShape(factoryHooks)).toBeNull();
    expect(factoryHooks.hooks).toBeUndefined();
    expect(factoryHooks.UserPromptSubmit?.[0]?.matcher).toBeUndefined();
    expect(factoryHooks.PostToolUse?.[0]?.matcher).toBe(
      FACTORY_POST_TOOL_USE_MATCHER,
    );
    expect(factoryHooks.Stop?.[0]?.matcher).toBeUndefined();
    expect(factoryHooks.Stop?.[0]?.hooks?.[0]?.timeout).toBe(
      FACTORY_HOOK_TIMEOUT_SEC,
    );
    expect(factoryHooks.UserPromptSubmit?.[0]?.hooks?.[0]?.command).toBe(
      'node "$FACTORY_PROJECT_DIR"/.autopilot/bin/autopilot-harness-hook.mjs --platform factory-droid --event UserPromptSubmit',
    );
    expect(factoryHooks.PostToolUse?.[0]?.hooks?.[0]?.command).toBe(
      'node "$FACTORY_PROJECT_DIR"/.autopilot/bin/autopilot-harness-hook.mjs --platform factory-droid --event PostToolUse',
    );
    expect(factoryHooks.Stop?.[0]?.hooks?.[0]?.command).toBe(
      'node "$FACTORY_PROJECT_DIR"/.autopilot/bin/autopilot-harness-hook.mjs --platform factory-droid --event Stop',
    );
    expect(
      fs.existsSync(
        path.join(root, ".factory", "skills", "autopilot-on", "SKILL.md"),
      ),
    ).toBe(true);
    expect(fs.existsSync(path.join(root, "AGENTS.md"))).toBe(false);

    const cfg = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(cfg).toMatch(/id:\s*cursor/);
    expect(cfg).toMatch(/id:\s*factory-droid/);
    expect(cfg).toMatch(/confirm_rounds:\s*5/);
  });
});
