/**
 * v0.7 tests-gemini-contract — umbrella matrix for Gemini I/O (deny / inject /
 * Silence `{}`), AfterAgent multi-deny + no clearContext, BeforeAgent
 * harness-owned (not AfterAgent.prompt), AfterTool observe-only, merge
 * (foreign + nested + name + timeout ms), ignore, doctor (omit timeout +
 * hooksConfig + disabled), add-platform, GEMINI_EVENTS + aliases, symlink
 * fail-closed, uninstall keeps non-empty settings.
 * Deeper suites: port-gemini / gemini-settings-merge / status-doctor / upgrade.
 */
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
  denySubmit,
  GEMINI_AFTER_AGENT_TURN_CAP,
  GEMINI_AFTER_TOOL_MATCHER,
  GEMINI_MIN_CLI_VERSION_HINT,
  GEMINI_PLATFORM,
  GEMINI_STOP_CAP_RAISE_FOUND,
  handlePostToolUse,
  handleStop,
  handleUserPromptSubmit,
  injectNeedPickContext,
  loopCountFromStopHookActive,
  MAX_NEED_PICK_SLUGS,
} from "../../ports/gemini-cli/src/index.js";
import {
  handleClaudeStop,
  handleCodexPostToolUse,
  handleCodexStop,
  handleCodexUserPromptSubmit,
  handleCopilotPostToolUse,
  handleCopilotStop,
  handleCopilotUserPromptSubmit,
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
} from "../src/vendor-entry.js";
import {
  GEMINI_AUTOPILOT_EVENTS,
  GEMINI_HOOK_NAME_PREFIX,
  GEMINI_HOOK_TIMEOUT_MS,
  GEMINI_SETTINGS_REL_PATH,
  GEMINI_WILDCARD_MATCHER,
  geminiAutopilotNamesInHooksConfigDisabled,
  geminiHooksConfigEnabledIsFalse,
  geminiSettingsContainAutopilot,
  geminiSettingsFileIsVacant,
  hasCompleteGeminiAutopilotHooks,
  mergeGeminiSettings,
  stripAutopilotGeminiSettings,
  validateGeminiSettingsShape,
} from "../src/init/gemini-settings-merge.js";
import { installInitYes } from "../src/init/install.js";
import { runDoctor } from "../src/status-doctor.js";
import { uninstallProject } from "../src/uninstall.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK_ASSET = path.resolve(
  __dirname,
  "../assets/autopilot-harness-hook.mjs",
);

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-gemini-contract-"));
}

function writeChecklist(root: string, slug: string, body: string): void {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plan.md"), `# ${slug}\n`);
  fs.writeFileSync(path.join(dir, "checklist.md"), body);
}

describe("gemini contract matrix", () => {
  let root = "";
  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = "";
  });

  it("vendor-entry aliases Gemini handlers without colliding with other hosts", () => {
    expect(handleGeminiUserPromptSubmit).toBeTypeOf("function");
    expect(handleGeminiPostToolUse).toBeTypeOf("function");
    expect(handleGeminiStop).toBeTypeOf("function");
    // Dual package resolution breaks Object.is across port vs vendor imports;
    // pin the re-export wiring in source instead.
    const vendorSrc = fs.readFileSync(
      path.resolve(__dirname, "../src/vendor-entry.ts"),
      "utf8",
    );
    expect(vendorSrc).toMatch(
      /handleUserPromptSubmit\s+as\s+handleGeminiUserPromptSubmit/,
    );
    expect(vendorSrc).toMatch(
      /handlePostToolUse\s+as\s+handleGeminiPostToolUse/,
    );
    expect(vendorSrc).toMatch(/handleStop\s+as\s+handleGeminiStop/);
    expect(vendorSrc).toMatch(
      /from\s+["']@autopilot-harness\/port-gemini-cli["']/,
    );
    expect(handleGeminiUserPromptSubmit).not.toBe(handleClaudeUserPromptSubmit);
    expect(handleGeminiPostToolUse).not.toBe(handleClaudePostToolUse);
    expect(handleGeminiStop).not.toBe(handleClaudeStop);
    expect(handleGeminiUserPromptSubmit).not.toBe(handleCodexUserPromptSubmit);
    expect(handleGeminiPostToolUse).not.toBe(handleCodexPostToolUse);
    expect(handleGeminiStop).not.toBe(handleCodexStop);
    expect(handleGeminiUserPromptSubmit).not.toBe(handleKimiUserPromptSubmit);
    expect(handleGeminiPostToolUse).not.toBe(handleKimiPostToolUse);
    expect(handleGeminiStop).not.toBe(handleKimiStop);
    expect(handleGeminiUserPromptSubmit).not.toBe(handleCopilotUserPromptSubmit);
    expect(handleGeminiPostToolUse).not.toBe(handleCopilotPostToolUse);
    expect(handleGeminiStop).not.toBe(handleCopilotStop);
    expect(handleGeminiUserPromptSubmit).not.toBe(handleGrokUserPromptSubmit);
    expect(handleGeminiPostToolUse).not.toBe(handleGrokPostToolUse);
    expect(handleGeminiStop).not.toBe(handleGrokStop);
  });

  it("shipped hook asset keeps ten-way dispatch + GEMINI_EVENTS allowlist", () => {
    expect(fs.existsSync(HOOK_ASSET)).toBe(true);
    const src = fs.readFileSync(HOOK_ASSET, "utf8");
    expect(src).toMatch(
      /KNOWN_PLATFORMS\s*=\s*new Set\(\[\s*"cursor"\s*,\s*"claude-code"\s*,\s*"codex"\s*,\s*"kimi-code"\s*,\s*"copilot-cli"\s*,\s*"grok-build"\s*,\s*"gemini-cli"\s*,\s*"factory-droid"\s*,\s*"hermes-agent"\s*,\s*"antigravity"\s*,?\s*\]\)/,
    );
    expect(src).toMatch(
      /GEMINI_EVENTS\s*=\s*new Set\(\[\s*"BeforeAgent"\s*,\s*"AfterTool"\s*,\s*"AfterAgent"\s*,?\s*\]\)/,
    );
    expect(src).toMatch(/handleGeminiUserPromptSubmit/);
    expect(src).toMatch(/handleGeminiPostToolUse/);
    expect(src).toMatch(/handleGeminiStop/);
    expect(src).toMatch(/handleFactoryUserPromptSubmit/);
    expect(src).toMatch(/handleFactoryPostToolUse/);
    expect(src).toMatch(/handleFactoryStop/);
    expect(src).toMatch(/writeFactoryReply|isFactoryEmptyStdoutResult/);
    expect(src).toMatch(/clipFactoryStdio|FACTORY_MAX_STDIO_CHARS/);
    expect(src).toMatch(/declaredPlatform === "gemini-cli"/);
    expect(src).toMatch(/hostId === "gemini-cli"/);
    expect(src).toMatch(/declaredPlatform === "factory-droid"/);
    expect(src).toMatch(/hostId === "factory-droid"/);
    // Missing/illegal --event remaps to beforeSubmitPrompt; non-Cursor stamps
    // must fail-open before Cursor handlers (Factory zero-byte allow).
    expect(src).toMatch(
      /CURSOR_EVENTS\.has\(event\)\s*&&\s*hostId\s*!==\s*"cursor"/,
    );
    // Copilot early abort must list command/edit events — not agentStop
    // (shared Stop|agentStop + resolveStopHostId).
    expect(src).toMatch(
      /hostId\s*!==\s*"copilot-cli"[\s\S]*?userPromptSubmitted[\s\S]*?userPromptTransformed[\s\S]*?postToolUse/,
    );
    expect(src).not.toMatch(
      /COPILOT_EVENTS\.has\(event\)\s*&&\s*hostId\s*!==\s*"copilot-cli"/,
    );
  });

  it("I/O: ON success {}; needPick inject has hookEventName; deny fallback; Silence keys", () => {
    expect(GEMINI_STOP_CAP_RAISE_FOUND).toBe(false);
    expect(GEMINI_AFTER_AGENT_TURN_CAP).toBe(100);
    expect(GEMINI_MIN_CLI_VERSION_HINT).toMatch(/^\d+\.\d+/);
    expect(GEMINI_PLATFORM).toBe("gemini-cli");

    root = tmpProject();
    writeChecklist(root, "alpha", "- [ ] a — A\n");
    writeChecklist(root, "beta", "- [ ] b — B\n");
    const store = new StateStore(root);
    try {
      const cid = "gem-pick-1";
      const on = handleUserPromptSubmit(
        store,
        { sessionId: cid, prompt: "Autopilot ON" },
        root,
      );
      // Silence: success allow is exactly {}.
      expect(on).toEqual({});
      expect(Object.keys(on)).toEqual([]);
      expect(store.getSession(cid)?.phase).toBe("planning");
      expect(store.getSession(cid)?.platform).toBe(GEMINI_PLATFORM);

      // Blank / missing / control-char session id → fail-open Silence, no extra session.
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
      expect(run.hookSpecificOutput?.hookEventName).toBe("BeforeAgent");
      expect(run.hookSpecificOutput?.additionalContext).toMatch(
        /Select a plan|alpha|beta/i,
      );
      expect(run.decision).toBeUndefined();
      expect(run).not.toHaveProperty("decision");
      expect(JSON.stringify(run)).not.toMatch(/clearContext/);
      // Silence: inject payload must not grow extra top-level keys.
      expect(Object.keys(run).sort()).toEqual(["hookSpecificOutput"]);
      // Invariant: needPick must not advance phase to executing.
      expect(store.getSession(cid)?.phase).toBe("planning");
      expect(store.getSession(cid)?.armed ?? 0).toBe(0);
      expect(store.getSession(cid)?.pending_action).toBe("run");
      // ON→bare RUN pick: stay on sentinel; do not bind a real slug yet.
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
      // Empty userMessage → build from candidates (string message short-circuits list).
      const injected = injectNeedPickContext("", many);
      expect(injected.hookSpecificOutput?.hookEventName).toBe("BeforeAgent");
      expect(injected.decision).toBeUndefined();
      expect(Object.keys(injected).sort()).toEqual(["hookSpecificOutput"]);
      // Invariant: inject and deny channels are mutually exclusive.
      expect(injected).not.toHaveProperty("decision");
      expect(injected).not.toHaveProperty("reason");
      const pickCtx = injected.hookSpecificOutput?.additionalContext ?? "";
      expect(pickCtx).toMatch(/plan-0/);
      expect(pickCtx).toMatch(new RegExp(`plan-${MAX_NEED_PICK_SLUGS - 1}`));
      expect(pickCtx).not.toMatch(
        new RegExp(`plan-${MAX_NEED_PICK_SLUGS}(?:\\D|$)`),
      );
      const unsafePick = injectNeedPickContext("", [
        { slug: "safe-slug" },
        { slug: "../evil" },
        { slug: "has space" },
        { slug: "" },
      ]);
      const unsafeCtx = unsafePick.hookSpecificOutput?.additionalContext ?? "";
      expect(unsafeCtx).toMatch(/safe-slug/);
      expect(unsafeCtx).not.toMatch(/\.\.\/evil/);
      expect(unsafeCtx).not.toMatch(/has space/);

      const denied = denySubmit("pick", "fallback");
      expect(denied.decision).toBe("deny");
      expect(denied.reason).toBeTruthy();
      expect(Object.keys(denied).sort()).toEqual(["decision", "reason"]);
      expect(denied).not.toHaveProperty("hookSpecificOutput");
      expect(JSON.stringify(denied)).not.toMatch(/"block"/);

      // Live BeforeAgent deny path: peer RUN while track already executing.
      expect(
        handleUserPromptSubmit(
          store,
          { session_id: cid, prompt: "/autopilot-run alpha" },
          root,
        ),
      ).toEqual({});
      expect(store.getSession(cid)?.phase).toBe("executing");
      expect(store.getSession(cid)?.track_id).toBe("alpha");
      // Claim must clear pick leftovers.
      expect(store.getSession(cid)?.pending_action ?? null).toBeNull();
      expect(store.getSession(cid)?.track_candidates_json ?? null).toBeNull();
      expect(store.getSession(cid)?.armed).toBe(1);
      expect(store.getSession(cid)?.checklist_path).toMatch(
        /plans[/\\]alpha[/\\]checklist\.md$/,
      );
      // Idempotent same-session re-RUN: keep executing bind + parked review chain (F-E8).
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
      expect(store.getSession(cid)?.paused ?? 0).toBe(0);
      expect(store.getSession(cid)?.pending_action ?? null).toBeNull();
      expect(store.getSession(cid)?.checklist_path).toMatch(
        /plans[/\\]alpha[/\\]checklist\.md$/,
      );
      expect(store.getReviewChain(cid)?.fix_round).toBe(2);
      expect(store.getReviewChain(cid)?.chain_pending).toBe(1);
      expect(store.getReviewChain(cid)?.pending_followup).toBe(
        "Review fix round park",
      );
      const busy = handleUserPromptSubmit(
        store,
        { sessionId: "gem-peer", prompt: "/autopilot-run alpha" },
        root,
      );
      expect(busy.decision).toBe("deny");
      expect(busy.reason).toMatch(/already executing/i);
      expect(busy).not.toHaveProperty("hookSpecificOutput");
      expect(Object.keys(busy).sort()).toEqual(["decision", "reason"]);
      expect(JSON.stringify(busy)).not.toMatch(/clearContext|"block"/);
      // Invariant: busy deny does not steal the owner's executing bind.
      expect(store.getSession(cid)?.phase).toBe("executing");
      expect(store.getSession(cid)?.track_id).toBe("alpha");
      expect(store.getSession(cid)?.armed).toBe(1);
      expect(store.getSession(cid)?.pending_action ?? null).toBeNull();
      expect(store.getSession(cid)?.checklist_path).toMatch(
        /plans[/\\]alpha[/\\]checklist\.md$/,
      );
      // Owner's parked tip survives peer busy (no partial wipe under contention).
      expect(store.getReviewChain(cid)?.fix_round).toBe(2);
      expect(store.getReviewChain(cid)?.chain_pending).toBe(1);
      expect(store.getReviewChain(cid)?.pending_followup).toBe(
        "Review fix round park",
      );
      // ensureSession creates peer; busy aborts before bind — idle + _pending.
      expect(store.getSession("gem-peer")).toBeTruthy();
      expect(store.getSession("gem-peer")?.platform).toBe(GEMINI_PLATFORM);
      expect(store.getSession("gem-peer")?.phase).toBe("idle");
      expect(store.getSession("gem-peer")?.armed ?? 0).toBe(0);
      expect(store.getSession("gem-peer")?.track_id).toBe("_pending");
      expect(store.getSession("gem-peer")!.checklist_path).toBe("");
      expect(store.getSession("gem-peer")?.pending_action ?? null).toBeNull();
      expect(store.getSession("gem-peer")?.track_candidates_json ?? null).toBeNull();
      // Busy aborts with commit:false before ensure/updateReviewChain — no peer chain row.
      expect(store.getReviewChain("gem-peer")).toBeNull();
      // Deny names the occupier via production formatter; must not echo parked tip.
      expect(busy.reason).toBe(formatOneExecutorBusyMessage("alpha", cid));
      expect(JSON.stringify(busy)).not.toMatch(/Review fix round park/);
    } finally {
      store.close();
    }
  });

  it("BeforeAgent harness-owned followup does not clear chain_pending (not AfterAgent.prompt)", () => {
    root = tmpProject();
    writeChecklist(root, "trk", "- [ ] x — X\n");
    const store = new StateStore(root);
    try {
      const cid = "gem-follow";
      const cp = path.join(root, "plans", "trk", "checklist.md");
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
      const out = handleUserPromptSubmit(
        store,
        {
          sessionId: cid,
          // BeforeAgent.prompt — harness-owned prefix (not AfterAgent.prompt).
          prompt: "Review fix round 1 — keep going",
        },
        root,
      );
      expect(out).toEqual({});
      expect(store.getReviewChain(cid)?.chain_pending).toBe(1);
      // Pending tip must survive harness-owned re-entry (not only the flag bit).
      expect(store.getReviewChain(cid)?.pending_followup).toMatch(
        /Review fix round 1/,
      );
      // Invariant: harness-owned re-entry stays executing (not ON/RUN / not idle).
      expect(store.getSession(cid)?.phase).toBe("executing");
      expect(store.getSession(cid)?.track_id).toBe("trk");

      handleUserPromptSubmit(
        store,
        { sessionId: cid, prompt: "ordinary user chat" },
        root,
      );
      // E8: ordinary chat clears chain_pending only — keep pending_followup for redeliver.
      expect(store.getReviewChain(cid)?.chain_pending ?? 0).toBe(0);
      expect(store.getReviewChain(cid)?.pending_followup).toMatch(
        /Review fix round 1/,
      );
      expect(store.getSession(cid)?.phase).toBe("executing");
      expect(store.getSession(cid)?.track_id).toBe("trk");
    } finally {
      store.close();
    }
  });

  it("AfterTool is observe-only (no deny); AfterAgent multi-deny + no clearContext; dirty-arm", () => {
    root = tmpProject();
    writeChecklist(root, "demo", "- [ ] a — A\n- [ ] b — B\n");
    const store = new StateStore(root);
    try {
      const cid = "gem-stop";
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
        platform: GEMINI_PLATFORM,
      });

      fs.mkdirSync(path.join(root, "src"), { recursive: true });
      const file = path.join(root, "src", "x.ts");
      fs.writeFileSync(file, "export const x = 1;\n");

      const afterTool = handlePostToolUse(
        store,
        {
          sessionId: cid,
          toolName: "write_file",
          toolInput: { file_path: file },
        },
        root,
      );
      // AfterTool observe/arm only — never deny/hide (void or empty Silence).
      expect(afterTool == null || Object.keys(afterTool as object).length === 0).toBe(
        true,
      );
      expect(
        afterTool == null || !("decision" in (afterTool as object)),
      ).toBe(true);
      expect(JSON.stringify(afterTool ?? {})).not.toMatch(
        /decision|clearContext|"block"|hide/i,
      );
      expect(store.getReviewChain(cid)?.code_edited).toBe(1);

      // Matcher includes replace — must arm the same way as write_file.
      store.updateReviewChain(cid, { code_edited: 0 });
      const afterReplace = handlePostToolUse(
        store,
        {
          session_id: cid,
          tool_name: "replace",
          tool_input: { filePath: file },
        },
        root,
      );
      expect(
        afterReplace == null || Object.keys(afterReplace as object).length === 0,
      ).toBe(true);
      expect(store.getReviewChain(cid)?.code_edited).toBe(1);

      // Non-edit tools (shell): observe-only — no arm, no deny/hide.
      store.updateReviewChain(cid, { code_edited: 0 });
      const afterShell = handlePostToolUse(
        store,
        {
          sessionId: cid,
          toolName: "run_shell_command",
          toolInput: { command: `echo hi > ${file}` },
        },
        root,
      );
      expect(
        afterShell == null || Object.keys(afterShell as object).length === 0,
      ).toBe(true);
      expect(JSON.stringify(afterShell ?? {})).not.toMatch(
        /decision|clearContext|"block"|hide/i,
      );
      expect(store.getReviewChain(cid)?.code_edited ?? 0).toBe(0);

      // Edit tool with no resolvable path — still Silence, no arm.
      const afterEmptyPath = handlePostToolUse(
        store,
        {
          session_id: cid,
          tool_name: "write_file",
          tool_input: {},
        },
        root,
      );
      expect(
        afterEmptyPath == null ||
          Object.keys(afterEmptyPath as object).length === 0,
      ).toBe(true);
      expect(store.getReviewChain(cid)?.code_edited ?? 0).toBe(0);

      // Invalid JSON tool_input string → fail-open Silence, no arm.
      const afterBadJson = handlePostToolUse(
        store,
        {
          sessionId: cid,
          toolName: "write_file",
          toolInput: "{not-json",
        },
        root,
      );
      expect(
        afterBadJson == null || Object.keys(afterBadJson as object).length === 0,
      ).toBe(true);
      expect(store.getReviewChain(cid)?.code_edited ?? 0).toBe(0);

      // Blank / NUL sid AfterTool → no arm of the live session, no phantom chain.
      handlePostToolUse(
        store,
        {
          sessionId: "   ",
          toolName: "write_file",
          toolInput: { file_path: file },
        },
        root,
      );
      handlePostToolUse(
        store,
        {
          sessionId: "bad\u0000id",
          toolName: "write_file",
          toolInput: { file_path: file },
        },
        root,
      );
      expect(store.getReviewChain(cid)?.code_edited ?? 0).toBe(0);
      expect(store.getReviewChain("   ") ?? null).toBeNull();
      expect(store.getReviewChain("bad\u0000id") ?? null).toBeNull();
      expect(store.getSession("   ") ?? null).toBeNull();
      expect(store.getSession("bad\u0000id") ?? null).toBeNull();

      // tool_input as JSON string + target_file key still arms.
      const afterJsonInput = handlePostToolUse(
        store,
        {
          sessionId: cid,
          toolName: "write_file",
          toolInput: JSON.stringify({ target_file: file }),
        },
        root,
      );
      expect(
        afterJsonInput == null ||
          Object.keys(afterJsonInput as object).length === 0,
      ).toBe(true);
      expect(store.getReviewChain(cid)?.code_edited).toBe(1);

      // Paths with NUL/CR/LF must not arm (injection / path-smuggling).
      store.updateReviewChain(cid, { code_edited: 0 });
      handlePostToolUse(
        store,
        {
          sessionId: cid,
          toolName: "write_file",
          toolInput: { file_path: `${file}\n../escape.ts` },
        },
        root,
      );
      expect(store.getReviewChain(cid)?.code_edited ?? 0).toBe(0);
      handlePostToolUse(
        store,
        {
          session_id: cid,
          tool_name: "replace",
          tool_input: { path: `${file}\0extra` },
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
      expect(loopCountFromStopHookActive({ stop_hook_active: true })).toBe(1);
      expect(loopCountFromStopHookActive({ stopHookActive: true })).toBe(1);
      expect(loopCountFromStopHookActive({ stop_hook_active: false })).toBe(0);
      expect(loopCountFromStopHookActive({})).toBe(0);
      // Snake wins when both present (?? short-circuit).
      expect(
        loopCountFromStopHookActive({
          stop_hook_active: false,
          stopHookActive: true,
        }),
      ).toBe(0);

      const cont = handleStop(eng, {
        sessionId: cid,
        prompt: "original user",
        prompt_response: "assistant done",
        stop_hook_active: false,
      });
      expect(cont.decision).toBe("deny");
      expect(cont.reason).toBeTruthy();
      expect(Object.keys(cont).sort()).toEqual(["decision", "reason"]);
      expect(cont.continue).toBeUndefined();
      expect(JSON.stringify(cont)).not.toMatch(/clearContext/);
      expect(JSON.stringify(cont)).not.toMatch(/"block"/);
      // Invariant: continue-deny must not also hard-stop.
      expect(cont).not.toHaveProperty("stopReason");
      // Invariant: AfterAgent continue does not drop the executing bind.
      expect(store.getSession(cid)?.phase).toBe("executing");
      expect(store.getSession(cid)?.track_id).toBe("demo");
      expect(store.getSession(cid)?.armed).toBe(1);
      expect(store.getSession(cid)?.paused ?? 0).toBe(0);
      expect(store.getSession(cid)?.checklist_path).toMatch(
        /plans[/\\]demo[/\\]checklist\.md$/,
      );
      // Continue parks tip + in-chain flag; stdout reason is trim(tip) (denyReason).
      expect(store.getReviewChain(cid)?.chain_pending).toBe(1);
      const tip = store.getReviewChain(cid)?.pending_followup ?? "";
      expect(tip.trim().length).toBeGreaterThan(0);
      expect(tip).toMatch(/Review|fix|keep going/i);
      expect(cont.reason).toBe(tip.trim());

      let multiLoop: number | undefined;
      const multiDeny = handleStop(
        {
          handleStop: (args: { loopCount?: number }) => {
            multiLoop = args.loopCount;
            return {
              kind: "fix",
              message: "Review fix round 2 — keep going",
              loop: true,
            };
          },
        } as unknown as ReviewEngine,
        // camelCase must map to loopCount 1 (not only be accepted by the mock).
        { sessionId: cid, stopHookActive: true },
      );
      expect(multiLoop).toBe(1);
      expect(multiDeny.decision).toBe("deny");
      expect(multiDeny.reason).toMatch(/Review fix round/);
      expect(multiDeny.continue).toBeUndefined();
      expect(multiDeny).not.toHaveProperty("stopReason");
      expect(JSON.stringify(multiDeny)).not.toMatch(/clearContext/);
      expect(Object.keys(multiDeny).sort()).toEqual(["decision", "reason"]);

      let haltLoop: number | undefined;
      const halt = handleStop(
        {
          handleStop: (args: { loopCount?: number }) => {
            haltLoop = args.loopCount;
            return {
              kind: "stuck",
              message: "Stuck: contract halt",
              loop: false,
            };
          },
        } as unknown as ReviewEngine,
        { sessionId: cid, stop_hook_active: true },
      );
      expect(haltLoop).toBe(1);
      expect(halt.continue).toBe(false);
      expect(halt.decision).toBeUndefined();
      expect(halt).not.toHaveProperty("reason");
      expect(halt.stopReason).toMatch(/Stuck: contract halt/);
      expect(JSON.stringify(halt)).not.toMatch(/clearContext/);
      expect(Object.keys(halt).sort()).toEqual(["continue", "stopReason"]);

      // Engine idle / empty message / missing session → fail-open Silence.
      expect(
        handleStop(
          { handleStop: () => null } as unknown as ReviewEngine,
          { sessionId: cid, stop_hook_active: false },
        ),
      ).toEqual({});
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
      expect(handleStop(eng, { stop_hook_active: false })).toEqual({});
      expect(
        handleStop(eng, { sessionId: "   ", stop_hook_active: false }),
      ).toEqual({});
      expect(
        handleStop(eng, { sessionId: "bad\u0000id", stop_hook_active: false }),
      ).toEqual({});
      // Blank sid must not pause/unbind the live executing session or mutate the parked tip.
      expect(store.getSession(cid)?.phase).toBe("executing");
      expect(store.getSession(cid)?.armed).toBe(1);
      expect(store.getSession(cid)?.track_id).toBe("demo");
      expect(store.getReviewChain(cid)?.chain_pending).toBe(1);
      expect(store.getReviewChain(cid)?.pending_followup).toBe(tip);
      expect(store.getSession("   ") ?? null).toBeNull();
      expect(store.getSession("bad\u0000id") ?? null).toBeNull();
      expect(store.getReviewChain("   ") ?? null).toBeNull();
      expect(store.getReviewChain("bad\u0000id") ?? null).toBeNull();

      // plans/** ignored — no dirty-arm.
      store.updateReviewChain(cid, { code_edited: 0 });
      handlePostToolUse(
        store,
        {
          session_id: cid,
          tool_name: "replace",
          tool_input: {
            file_path: path.join(root, "plans", "demo", "plan.md"),
          },
        },
        root,
      );
      expect(store.getReviewChain(cid)?.code_edited ?? 0).toBe(0);
    } finally {
      store.close();
    }
  });

  it("hooks merge: nested events, name fingerprint, timeout 120000ms; foreign + hooksConfig kept", () => {
    expect(GEMINI_HOOK_TIMEOUT_MS).toBe(120_000);
    expect(GEMINI_AFTER_TOOL_MATCHER).toBe("write_file|replace");
    expect(GEMINI_HOOK_NAME_PREFIX).toBe("autopilot-harness");
    expect(GEMINI_WILDCARD_MATCHER).toBe("*");
    expect([...GEMINI_AUTOPILOT_EVENTS]).toEqual([
      "BeforeAgent",
      "AfterTool",
      "AfterAgent",
    ]);
    const merged = mergeGeminiSettings(null);
    expect(hasCompleteGeminiAutopilotHooks(merged)).toBe(true);
    expect(validateGeminiSettingsShape(merged)).toBeNull();
    for (const event of GEMINI_AUTOPILOT_EVENTS) {
      const groups = merged.hooks?.[event];
      expect(Array.isArray(groups)).toBe(true);
      expect(groups!.length).toBe(1);
      const g = groups![0]!;
      if (event === "AfterTool") {
        expect(g.matcher).toBe(GEMINI_AFTER_TOOL_MATCHER);
      } else {
        expect(g.matcher).toBe(GEMINI_WILDCARD_MATCHER);
      }
      const h = g.hooks?.[0];
      expect(h?.name).toBe(`${GEMINI_HOOK_NAME_PREFIX}-${event}`);
      expect(h?.type).toBe("command");
      expect(h?.timeout).toBe(GEMINI_HOOK_TIMEOUT_MS);
      expect(h?.command).toBe(
        `node .autopilot/bin/autopilot-harness-hook.mjs --platform gemini-cli --event ${event}`,
      );
    }

    const withForeign = mergeGeminiSettings({
      hooksConfig: { enabled: true, disabled: ["keep-me"] },
      general: { vimMode: true },
      hooks: {
        BeforeAgent: [
          {
            matcher: "*",
            hooks: [
              { name: "foreign", type: "command", command: "echo keep-foreign" },
            ],
          },
        ],
      },
    });
    expect(geminiSettingsContainAutopilot(withForeign)).toBe(true);
    expect(JSON.stringify(withForeign.hooks?.BeforeAgent)).toMatch(
      /echo keep-foreign/,
    );
    expect(withForeign.hooksConfig).toEqual({
      enabled: true,
      disabled: ["keep-me"],
    });
    expect(withForeign.general).toEqual({ vimMode: true });

    const stripped = stripAutopilotGeminiSettings(withForeign);
    expect(geminiSettingsContainAutopilot(stripped)).toBe(false);
    expect(hasCompleteGeminiAutopilotHooks(stripped)).toBe(false);
    expect(JSON.stringify(stripped.hooks?.BeforeAgent)).toMatch(
      /echo keep-foreign/,
    );
    expect(stripped.hooksConfig).toEqual({
      enabled: true,
      disabled: ["keep-me"],
    });
    expect(geminiSettingsFileIsVacant(stripped)).toBe(false);
    expect(
      geminiSettingsFileIsVacant(stripAutopilotGeminiSettings(mergeGeminiSettings(null))),
    ).toBe(true);

    // Flat handlers fail-closed.
    expect(
      validateGeminiSettingsShape({
        hooks: {
          BeforeAgent: [{ type: "command", command: "echo flat" }],
        },
      }),
    ).toMatch(/nested matcher groups/i);
  });

  it("init ignore + add-platform; doctor omit timeout + hooksConfig + disabled", () => {
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
        platform: "gemini-cli",
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
    expect(ignore).toMatch(/\.gemini\/settings\.json/);
    expect(GEMINI_SETTINGS_REL_PATH).toBe(".gemini/settings.json");
    expect(fs.existsSync(path.join(root, ".cursor", "hooks.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".cursor", "skills"))).toBe(true);
    expect(
      fs.existsSync(
        path.join(root, ".gemini", "skills", "autopilot-on", "SKILL.md"),
      ),
    ).toBe(true);
    expect(fs.existsSync(path.join(root, "AGENTS.md"))).toBe(false);

    const cfg = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(cfg).toMatch(/id:\s*cursor/);
    expect(cfg).toMatch(/id:\s*gemini-cli/);
    expect(cfg).toMatch(/confirm_rounds:\s*5/);

    const healthy = runDoctor(root);
    expect(healthy.ok).toBe(true);
    const healthyJoined = healthy.lines.join("\n");
    expect(healthyJoined).toMatch(
      new RegExp(`AfterAgent turn cap ≤${GEMINI_AFTER_AGENT_TURN_CAP}`, "i"),
    );
    expect(healthyJoined).toMatch(
      new RegExp(
        `Prefer Gemini CLI ≥${GEMINI_MIN_CLI_VERSION_HINT.replace(/\./g, "\\.")}`,
        "i",
      ),
    );
    expect(healthyJoined).toMatch(/re-trust|\/hooks panel|folder trust/i);
    expect(healthyJoined).toMatch(/Reload Gemini CLI|new session/i);
    expect(healthyJoined).toMatch(
      /OK\s+\.gemini\/settings\.json Autopilot entries/,
    );

    const settingsPath = path.join(root, ".gemini", "settings.json");
    const file = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
      hooks?: Record<
        string,
        Array<{ hooks?: Array<{ timeout?: number; command?: string }> }>
      >;
      hooksConfig?: unknown;
    };
    for (const groups of Object.values(file.hooks ?? {})) {
      for (const g of groups) {
        for (const h of g.hooks ?? []) {
          if (
            typeof h.command === "string" &&
            h.command.includes("autopilot-harness-hook")
          ) {
            delete h.timeout;
          }
        }
      }
    }
    fs.writeFileSync(settingsPath, JSON.stringify(file, null, 2) + "\n");
    const omitted = runDoctor(root);
    expect(omitted.ok).toBe(true);
    expect(omitted.lines.join("\n")).toMatch(/timeout below 120000/i);
    expect(omitted.lines.join("\n")).not.toMatch(
      /OK\s+\.gemini\/settings\.json Autopilot entries/,
    );

    // Restore timeouts then exercise hooksConfig disable paths.
    const restored = mergeGeminiSettings(
      JSON.parse(fs.readFileSync(settingsPath, "utf8")),
    );
    restored.hooksConfig = {
      enabled: false,
      disabled: ["autopilot-harness-AfterAgent", "other"],
    };
    fs.writeFileSync(settingsPath, JSON.stringify(restored, null, 2) + "\n");
    expect(geminiHooksConfigEnabledIsFalse(restored)).toBe(true);
    expect(geminiAutopilotNamesInHooksConfigDisabled(restored)).toEqual([
      "autopilot-harness-AfterAgent",
    ]);
    const disabledDoc = runDoctor(root);
    expect(disabledDoc.ok).toBe(true);
    const disabledJoined = disabledDoc.lines.join("\n");
    expect(disabledJoined).toMatch(/hooksConfig\.enabled===false/i);
    expect(disabledJoined).toMatch(
      /disabled lists Autopilot name\(s\):.*autopilot-harness-AfterAgent/i,
    );
    expect(disabledJoined).not.toMatch(
      /OK\s+\.gemini\/settings\.json Autopilot entries/,
    );
  });

  it("symlink settings.json fail-closed on init", () => {
    root = tmpProject();
    fs.mkdirSync(path.join(root, ".gemini"), { recursive: true });
    // Existing target — refuse (must not follow/write through symlink).
    const existingTarget = path.join(root, "outside-settings.json");
    fs.writeFileSync(existingTarget, "{}\n");
    fs.symlinkSync(
      existingTarget,
      path.join(root, ".gemini", "settings.json"),
    );
    const existing = installInitYes({
      projectRoot: root,
      platform: "gemini-cli",
      surface: "cli",
      locale: "en",
      force: false,
    });
    expect(existing.ok).toBe(false);
    expect(existing.error ?? "").toMatch(/symlink/i);

    // Dangling symlink — existsSync lies; still fail-closed via lstat.
    fs.rmSync(root, { recursive: true, force: true });
    root = tmpProject();
    fs.mkdirSync(path.join(root, ".gemini"), { recursive: true });
    fs.symlinkSync(
      path.join(root, "missing-settings.json"),
      path.join(root, ".gemini", "settings.json"),
    );
    const dangling = installInitYes({
      projectRoot: root,
      platform: "gemini-cli",
      surface: "cli",
      locale: "en",
      force: false,
    });
    expect(dangling.ok).toBe(false);
    expect(dangling.error ?? "").toMatch(/symlink/i);
  });

  it("fingerprint uninstall keeps non-empty settings (foreign + hooksConfig)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "gemini-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const keepPath = path.join(root, ".gemini", "settings.json");
    const before = JSON.parse(fs.readFileSync(keepPath, "utf8")) as {
      hooks?: Record<string, unknown>;
      hooksConfig?: unknown;
      general?: unknown;
    };
    before.hooksConfig = { enabled: true };
    before.general = { foo: 1 };
    before.hooks = {
      ...(before.hooks ?? {}),
      SessionStart: [
        {
          matcher: "*",
          hooks: [{ name: "keep", type: "command", command: "echo keep" }],
        },
      ],
    };
    fs.writeFileSync(keepPath, JSON.stringify(before, null, 2) + "\n");
    expect(geminiSettingsContainAutopilot(before)).toBe(true);
    const un = uninstallProject({ projectRoot: root });
    expect(un.ok).toBe(true);
    expect(fs.existsSync(keepPath)).toBe(true);
    const after = JSON.parse(fs.readFileSync(keepPath, "utf8")) as {
      hooks?: Record<string, unknown>;
      hooksConfig?: unknown;
      general?: unknown;
    };
    expect(after.hooksConfig).toEqual({ enabled: true });
    expect(after.general).toEqual({ foo: 1 });
    expect(JSON.stringify(after.hooks?.SessionStart)).toMatch(/echo keep/);
    expect(JSON.stringify(after)).not.toMatch(/autopilot-harness-hook\.mjs/);
    expect(geminiSettingsContainAutopilot(after)).toBe(false);
  });
});
