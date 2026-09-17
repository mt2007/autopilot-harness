/**
 * v0.10 tests-antigravity-contract — umbrella matrix for Antigravity I/O
 * (`injectSteps`; Silence `{}`; Post always `{}`; Stop continue =
 * `decision:continue+reason` gated by `fullyIdle === true`), merge/fingerprint
 * (named block + timeout 120 + relative command + PostToolUse matcher),
 * ten-way + wrong-stamp abort.
 * Deeper suites: port-antigravity / antigravity-hooks-merge / hook-vendor
 * ten-way / status-doctor.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ReviewEngine, StateStore } from "@autopilot-harness/core";
import {
  ANTIGRAVITY_EVENTS,
  ANTIGRAVITY_HOOK_BLOCK_NAME,
  ANTIGRAVITY_PLATFORM,
  ANTIGRAVITY_POST_TOOL_MATCHER,
  ANTIGRAVITY_PRE_INVOCATION_HAS_PROMPT,
  ANTIGRAVITY_STOP_CAP_RAISE_FOUND,
  ANTIGRAVITY_STOP_CONTINUE,
  ANTIGRAVITY_STOP_CONTINUE_DOCS_SUPPORTED,
  ANTIGRAVITY_TIMEOUT_SEC,
  ANTIGRAVITY_TRIGGER_SOURCE,
  handleAntigravityPostToolUse,
  handleAntigravityPreInvocation,
  handleAntigravityStop,
  handlePostToolUse,
  handlePreInvocation,
  handleStop,
  injectEphemeral,
  injectNeedPickContext,
  isAntigravityAllowNoop,
  isAntigravityFullyIdle,
  MAX_NEED_PICK_SLUGS,
  sanitizeAntigravityTranscriptPath,
} from "../../ports/antigravity/src/index.js";
import {
  ANTIGRAVITY_PLATFORM as vendorAntigravityPlatform,
  handleAntigravityPostToolUse as vendorHandleAntigravityPostToolUse,
  handleAntigravityPreInvocation as vendorHandleAntigravityPreInvocation,
  handleAntigravityStop as vendorHandleAntigravityStop,
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
  isAntigravityAllowNoop as vendorIsAntigravityAllowNoop,
} from "../src/vendor-entry.js";
import {
  ANTIGRAVITY_AUTOPILOT_EVENTS,
  ANTIGRAVITY_HOOK_TIMEOUT_SEC,
  ANTIGRAVITY_HOOKS_REL_PATH,
  ANTIGRAVITY_POST_TOOL_USE_MATCHER,
  antigravityAutopilotHasExpectedPostMatcher,
  antigravityAutopilotHasOmittedOrSmallTimeout,
  antigravityHooksContainAutopilot,
  antigravityHooksHavePlatformStamp,
  antigravityHooksUseRelativeCommand,
  hasCompleteAntigravityAutopilotHooks,
  mergeAntigravityHooks,
  stripAutopilotAntigravityHooks,
} from "../src/init/antigravity-hooks-merge.js";
import { installInitYes } from "../src/init/install.js";
import { uninstallProject } from "../src/uninstall.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK_ASSET = path.resolve(
  __dirname,
  "../assets/autopilot-harness-hook.mjs",
);

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-agy-contract-"));
}

function writeChecklist(root: string, slug: string, body: string): void {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plan.md"), `# ${slug}\n`);
  fs.writeFileSync(path.join(dir, "checklist.md"), body);
}

function expectAntigravitySilenceStdout(stdout: string): void {
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

function spawnAntigravityHook(
  root: string,
  event: string,
  payload: Record<string, unknown>,
  platform = "antigravity",
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
  const args =
    platform.length > 0
      ? [hook, "--platform", platform, "--event", event]
      : [hook, "--event", event];
  const proc = spawnSync(process.execPath, args, {
    cwd: root,
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: 15_000,
  });
  if (proc.error) {
    throw proc.error;
  }
  if (proc.status == null) {
    throw new Error(
      `antigravity hook spawn killed: event=${event} platform=${platform} signal=${proc.signal}`,
    );
  }
  return {
    status: proc.status,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
  };
}

describe("antigravity contract matrix", () => {
  let root = "";

  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    root = "";
  });

  it("vendor-entry aliases Antigravity handlers without colliding with other hosts", () => {
    expect(vendorHandleAntigravityPreInvocation).toBeTypeOf("function");
    expect(vendorHandleAntigravityPostToolUse).toBeTypeOf("function");
    expect(vendorHandleAntigravityStop).toBeTypeOf("function");
    expect(vendorIsAntigravityAllowNoop).toBeTypeOf("function");
    expect(vendorAntigravityPlatform).toBe("antigravity");
    expect(vendorAntigravityPlatform).toBe(ANTIGRAVITY_PLATFORM);
    // Same exported names (identity across workspace package graphs may differ).
    expect(vendorHandleAntigravityPreInvocation.name).toMatch(
      /handlePreInvocation|handleAntigravityPreInvocation/,
    );
    expect(vendorHandleAntigravityPostToolUse.name).toMatch(
      /handlePostToolUse|handleAntigravityPostToolUse/,
    );
    expect(vendorHandleAntigravityStop.name).toMatch(
      /handleStop|handleAntigravityStop/,
    );
    expect(vendorIsAntigravityAllowNoop({})).toBe(true);
    expect(
      vendorIsAntigravityAllowNoop({
        decision: "continue",
        reason: "x",
      }),
    ).toBe(false);

    const vendorSrc = fs.readFileSync(
      path.resolve(__dirname, "../src/vendor-entry.ts"),
      "utf8",
    );
    expect(vendorSrc).toMatch(/handleAntigravityPreInvocation/);
    expect(vendorSrc).toMatch(/handleAntigravityPostToolUse/);
    expect(vendorSrc).toMatch(/handleAntigravityStop/);
    expect(vendorSrc).toMatch(/isAntigravityAllowNoop/);
    expect(vendorSrc).toMatch(
      /from\s+["']@autopilot-harness\/port-antigravity["']/,
    );

    expect(handleAntigravityStop).not.toBe(handleClaudeStop);
    expect(handleAntigravityStop).not.toBe(handleCodexStop);
    expect(handleAntigravityStop).not.toBe(handleKimiStop);
    expect(handleAntigravityStop).not.toBe(handleCopilotStop);
    expect(handleAntigravityStop).not.toBe(handleGrokStop);
    expect(handleAntigravityStop).not.toBe(handleGeminiStop);
    expect(handleAntigravityStop).not.toBe(handleFactoryStop);
    expect(handleAntigravityStop).not.toBe(handleHermesPreVerify);
    expect(handleAntigravityPreInvocation).not.toBe(
      handleClaudeUserPromptSubmit,
    );
    expect(handleAntigravityPreInvocation).not.toBe(
      handleCodexUserPromptSubmit,
    );
    expect(handleAntigravityPreInvocation).not.toBe(handleKimiUserPromptSubmit);
    expect(handleAntigravityPreInvocation).not.toBe(
      handleCopilotUserPromptSubmit,
    );
    expect(handleAntigravityPreInvocation).not.toBe(handleGrokUserPromptSubmit);
    expect(handleAntigravityPreInvocation).not.toBe(
      handleGeminiUserPromptSubmit,
    );
    expect(handleAntigravityPreInvocation).not.toBe(
      handleFactoryUserPromptSubmit,
    );
    expect(handleAntigravityPreInvocation).not.toBe(handleHermesPreLlmCall);
    expect(handleAntigravityPostToolUse).not.toBe(handleClaudePostToolUse);
    expect(handleAntigravityPostToolUse).not.toBe(handleCodexPostToolUse);
    expect(handleAntigravityPostToolUse).not.toBe(handleKimiPostToolUse);
    expect(handleAntigravityPostToolUse).not.toBe(handleCopilotPostToolUse);
    expect(handleAntigravityPostToolUse).not.toBe(handleGrokPostToolUse);
    expect(handleAntigravityPostToolUse).not.toBe(handleGeminiPostToolUse);
    expect(handleAntigravityPostToolUse).not.toBe(handleFactoryPostToolUse);
    expect(handleAntigravityPostToolUse).not.toBe(handleHermesPostToolCall);
  });

  it("shipped hook asset keeps ten-way dispatch + Antigravity Silence writer", () => {
    expect(fs.existsSync(HOOK_ASSET)).toBe(true);
    const src = fs.readFileSync(HOOK_ASSET, "utf8");
    expect(src).toMatch(
      /KNOWN_PLATFORMS\s*=\s*new Set\(\[\s*"cursor"\s*,\s*"claude-code"\s*,\s*"codex"\s*,\s*"kimi-code"\s*,\s*"copilot-cli"\s*,\s*"grok-build"\s*,\s*"gemini-cli"\s*,\s*"factory-droid"\s*,\s*"hermes-agent"\s*,\s*"antigravity"\s*,?\s*\]\)/,
    );
    expect(src).toMatch(
      /ANTIGRAVITY_EVENTS\s*=\s*new Set\(\[\s*"PreInvocation"\s*,\s*"PostToolUse"\s*,\s*"Stop"\s*,?\s*\]\)/,
    );
    expect(src).toMatch(/handleAntigravityPreInvocation/);
    expect(src).toMatch(/handleAntigravityPostToolUse/);
    expect(src).toMatch(/handleAntigravityStop/);
    expect(src).toMatch(/isAntigravityAllowNoop/);
    expect(src).toMatch(/declaredPlatform === "antigravity"/);
    expect(src).toMatch(/hostId === "antigravity"/);
    expect(src).toMatch(
      /event === "PreInvocation"\s*&&\s*hostId\s*!==\s*"antigravity"/,
    );
    expect(src).toMatch(
      /hostId === "antigravity"\s*&&\s*!ANTIGRAVITY_EVENTS\.has\(event\)/,
    );
  });

  it("I/O: injectSteps; Silence {}; Post {}; Stop continue gated by fullyIdle", () => {
    expect(ANTIGRAVITY_PLATFORM).toBe("antigravity");
    expect(ANTIGRAVITY_HOOK_BLOCK_NAME).toBe("autopilot-harness");
    expect(ANTIGRAVITY_EVENTS).toEqual([
      "PreInvocation",
      "PostToolUse",
      "Stop",
    ]);
    expect(ANTIGRAVITY_STOP_CONTINUE).toBe("decision:continue+reason");
    expect(ANTIGRAVITY_STOP_CONTINUE_DOCS_SUPPORTED).toBe(true);
    expect(ANTIGRAVITY_STOP_CAP_RAISE_FOUND).toBe(false);
    expect(ANTIGRAVITY_PRE_INVOCATION_HAS_PROMPT).toBe(false);
    expect(ANTIGRAVITY_TRIGGER_SOURCE).toBe("transcriptPath+statefulCursor");
    expect(ANTIGRAVITY_POST_TOOL_MATCHER).toBe(
      "write_to_file|replace_file_content|multi_replace_file_content",
    );
    expect(ANTIGRAVITY_TIMEOUT_SEC).toBe(120);
    expect(handleAntigravityPreInvocation).toBe(handlePreInvocation);
    expect(handleAntigravityPostToolUse).toBe(handlePostToolUse);
    expect(handleAntigravityStop).toBe(handleStop);

    expect(isAntigravityAllowNoop({})).toBe(true);
    expect(isAntigravityAllowNoop({ injectSteps: undefined })).toBe(true);
    // Explicit null fields are still Silence; empty string / empty array / array root are not.
    expect(
      isAntigravityAllowNoop({ injectSteps: null } as never),
    ).toBe(true);
    expect(
      isAntigravityAllowNoop({ decision: null, reason: null } as never),
    ).toBe(true);
    expect(isAntigravityAllowNoop({ reason: "" })).toBe(false);
    expect(isAntigravityAllowNoop({ decision: "" })).toBe(false);
    expect(isAntigravityAllowNoop({ injectSteps: [] })).toBe(false);
    expect(isAntigravityAllowNoop([] as never)).toBe(false);
    expect(
      isAntigravityAllowNoop({
        injectSteps: [{ ephemeralMessage: "x" }],
      }),
    ).toBe(false);
    expect(
      isAntigravityAllowNoop({ decision: "continue", reason: "r" }),
    ).toBe(false);
    expect(isAntigravityAllowNoop(null)).toBe(false);
    expect(isAntigravityAllowNoop(undefined)).toBe(false);

    expect(isAntigravityFullyIdle({ fullyIdle: true })).toBe(true);
    expect(isAntigravityFullyIdle({ fully_idle: true })).toBe(true);
    expect(isAntigravityFullyIdle({ fullyIdle: false })).toBe(false);
    expect(isAntigravityFullyIdle({})).toBe(false);
    // Strict boolean true only — host string/number must fail-open (no continue).
    expect(isAntigravityFullyIdle({ fullyIdle: "true" } as never)).toBe(false);
    expect(isAntigravityFullyIdle({ fully_idle: 1 } as never)).toBe(false);
    expect(
      isAntigravityFullyIdle({ fullyIdle: false, fully_idle: true }),
    ).toBe(true);
    expect(
      isAntigravityFullyIdle({ fullyIdle: true, fully_idle: false }),
    ).toBe(true);

    const injected = injectNeedPickContext("", [
      { slug: "alpha" },
      { slug: "beta" },
    ]);
    expect(Array.isArray(injected.injectSteps)).toBe(true);
    const injectedMsg = injected.injectSteps?.[0]?.ephemeralMessage ?? "";
    expect(injectedMsg).toMatch(/Select a plan/i);
    expect(injectedMsg).toMatch(/alpha/i);
    expect(injectedMsg).toMatch(/beta/i);
    expect(Object.keys(injected).sort()).toEqual(["injectSteps"]);
    expect(isAntigravityAllowNoop(injected)).toBe(false);
    expect(isAntigravityAllowNoop(injectEphemeral(""))).toBe(false);

    // Untrusted candidate slugs must not enter injectSteps (path / prompt injection).
    const unsafePick = injectNeedPickContext("", [
      { slug: "safe-slug" },
      { slug: "../evil" },
      { slug: "bad/slug" },
      { slug: "has space" },
      { slug: "" },
      { slug: undefined },
      {},
    ]);
    const unsafeMsg = unsafePick.injectSteps?.[0]?.ephemeralMessage ?? "";
    expect(unsafeMsg).toMatch(/safe-slug/);
    expect(unsafeMsg).not.toMatch(/\.\.\/evil/);
    expect(unsafeMsg).not.toMatch(/bad\/slug/);
    expect(unsafeMsg).not.toMatch(/has space/);
    const many = Array.from({ length: MAX_NEED_PICK_SLUGS + 5 }, (_, i) => ({
      slug: `plan-${i}`,
    }));
    const capped = injectNeedPickContext("", many);
    const cappedMsg = capped.injectSteps?.[0]?.ephemeralMessage ?? "";
    expect(cappedMsg).toMatch(/plan-0/);
    expect(cappedMsg).not.toMatch(
      new RegExp(`plan-${MAX_NEED_PICK_SLUGS}(?:\\D|$)`),
    );

    // Host-supplied transcriptPath is untrusted — reject secrets / relative / traversal / controls.
    expect(sanitizeAntigravityTranscriptPath("/tmp/secret.env")).toBeUndefined();
    expect(
      sanitizeAntigravityTranscriptPath("logs/transcript.jsonl"),
    ).toBeUndefined();
    expect(
      sanitizeAntigravityTranscriptPath("/proj/../etc/logs/transcript.jsonl"),
    ).toBeUndefined();
    expect(
      sanitizeAntigravityTranscriptPath("/tmp/secret.env\0/logs/transcript.jsonl"),
    ).toBeUndefined();
    expect(
      sanitizeAntigravityTranscriptPath("/tmp/logs/transcript.jsonl\n/etc/passwd"),
    ).toBeUndefined();
    expect(sanitizeAntigravityTranscriptPath("")).toBeUndefined();
    expect(sanitizeAntigravityTranscriptPath(null)).toBeUndefined();
    expect(
      sanitizeAntigravityTranscriptPath("/tmp/logs/transcript_full.jsonl"),
    ).toBe("/tmp/logs/transcript_full.jsonl");
    expect(
      sanitizeAntigravityTranscriptPath("logs/transcript_full.jsonl"),
    ).toBeUndefined();
    expect(
      sanitizeAntigravityTranscriptPath(
        "/proj/../etc/logs/transcript_full.jsonl",
      ),
    ).toBeUndefined();
    expect(
      sanitizeAntigravityTranscriptPath(
        "/tmp/secret.env\0/logs/transcript_full.jsonl",
      ),
    ).toBeUndefined();
    expect(
      sanitizeAntigravityTranscriptPath(
        "/tmp/logs/transcript_full.jsonl\n/etc/passwd",
      ),
    ).toBeUndefined();

    root = tmpProject();
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    writeChecklist(root, "demo", "- [ ] a — A\n");
    const store = new StateStore(root);
    try {
      const cid = "agy-contract-io-1";
      store.upsertSession({
        conversation_id: cid,
        project_root: root,
        code_root: root,
        platform: ANTIGRAVITY_PLATFORM,
        phase: "executing",
        armed: 1,
        paused: 0,
        track_id: "demo",
        checklist_path: path.join(root, "plans", "demo", "checklist.md"),
      });
      store.markCodeEdited(cid, () => "a");
      expect(store.getReviewChain(cid)?.reviewing_item_id).toBe("a");
      expect(store.getReviewChain(cid)?.code_edited).toBe(1);
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

      // Empty / whitespace / control-char conversationId: illegal → Silence even with fullyIdle true.
      expect(
        handleStop(engine, {
          conversationId: "",
          fullyIdle: true,
          terminationReason: "model_stop",
        }),
      ).toEqual({});
      expect(
        handleStop(engine, {
          conversationId: "   ",
          fullyIdle: true,
          terminationReason: "model_stop",
        }),
      ).toEqual({});
      expect(
        handleStop(engine, {
          conversationId: "bad\u0000id",
          fullyIdle: true,
          terminationReason: "model_stop",
        }),
      ).toEqual({});
      // sid must not materialize ghost sessions for rejected ids.
      expect(store.getSession("") ?? null).toBeNull();
      expect(store.getSession("   ") ?? null).toBeNull();
      expect(store.getSession("bad\u0000id") ?? null).toBeNull();
      expect(store.getReviewChain("") ?? null).toBeNull();
      expect(store.getReviewChain("   ") ?? null).toBeNull();
      expect(store.getReviewChain("bad\u0000id") ?? null).toBeNull();
      expect(store.getReviewChain(cid)?.code_edited).toBe(1);
      expect(store.getSession(cid)?.armed).toBe(1);
      expect(store.getSession(cid)?.paused).toBe(0);
      expect(
        (store.getReviewChain(cid)?.pending_followup ?? "").trim(),
      ).toBe("");
      expect(store.getReviewChain(cid)?.chain_pending ?? 0).toBe(0);

      // Omitted fullyIdle: fail-open Silence (no truthy coercion of missing).
      expect(
        handleStop(engine, {
          conversationId: cid,
          terminationReason: "model_stop",
        }),
      ).toEqual({});
      expect(store.getReviewChain(cid)?.code_edited).toBe(1);
      expect(
        (store.getReviewChain(cid)?.pending_followup ?? "").trim(),
      ).toBe("");
      expect(store.getReviewChain(cid)?.chain_pending ?? 0).toBe(0);

      expect(
        handleStop(engine, {
          conversationId: cid,
          fullyIdle: false,
          terminationReason: "model_stop",
        }),
      ).toEqual({});
      expect(store.getReviewChain(cid)?.code_edited).toBe(1);
      // Mid-tool fail-open must not park a review tip or arm the chain.
      expect(
        (store.getReviewChain(cid)?.pending_followup ?? "").trim(),
      ).toBe("");
      expect(store.getReviewChain(cid)?.chain_pending ?? 0).toBe(0);

      const cont = handleStop(engine, {
        conversationId: cid,
        fullyIdle: true,
        terminationReason: "model_stop",
        executionNum: 1,
      });
      expect(cont.decision).toBe("continue");
      expect(typeof cont.reason).toBe("string");
      expect(String(cont.reason).trim().length).toBeGreaterThan(0);
      expect(String(cont.decision)).not.toBe("block");
      expect(Object.keys(cont).sort()).toEqual(["decision", "reason"]);
      // Continue stdout reason and parked tip are the same handoff payload.
      const tip = (store.getReviewChain(cid)?.pending_followup ?? "").trim();
      expect(tip.length).toBeGreaterThan(0);
      expect(String(cont.reason).trim()).toBe(tip);
      expect(store.getReviewChain(cid)?.chain_pending).toBe(1);
      // E2 opens fix: clear sticky edit arm so the next idle Stop cannot re-open.
      expect(store.getReviewChain(cid)?.code_edited ?? 0).toBe(0);
      expect(store.getReviewChain(cid)?.reviewing_item_id).toBe("a");
      expect(store.getReviewChain(cid)?.fix_round).toBe(1);
      // E2 (fix) must not arm confirm — distinguish from E3.
      expect(store.getReviewChain(cid)?.confirm_left ?? null).toBeNull();
      expect(store.getSession(cid)?.armed).toBe(1);
      expect(store.getSession(cid)?.paused).toBe(0);
      expect(store.getSession(cid)?.phase).toBe("executing");

      // Unknown terminationReason: fail-closed for continue (stdout Silence) even
      // when fullyIdle — must not emit decision:continue.
      const weird = handleStop(engine, {
        conversationId: cid,
        fullyIdle: true,
        terminationReason: "weird_host_reason",
        executionNum: 2,
      });
      expect(weird).toEqual({});
      expect(weird.decision).toBeUndefined();
      expect(
        (store.getReviewChain(cid)?.pending_followup ?? "").trim(),
      ).toBe(tip);
      expect(store.getReviewChain(cid)?.chain_pending).toBe(1);
      expect(store.getReviewChain(cid)?.code_edited ?? 0).toBe(0);
      expect(store.getReviewChain(cid)?.fix_round).toBe(1);
      expect(store.getReviewChain(cid)?.reviewing_item_id).toBe("a");
      expect(store.getReviewChain(cid)?.confirm_left ?? null).toBeNull();
    } finally {
      store.close();
    }
  });

  it("merge: named block fingerprint + matcher/stamp/relative + strip", () => {
    expect(ANTIGRAVITY_AUTOPILOT_EVENTS).toEqual([
      "PreInvocation",
      "PostToolUse",
      "Stop",
    ]);
    expect(ANTIGRAVITY_HOOK_TIMEOUT_SEC).toBe(120);
    expect(ANTIGRAVITY_HOOKS_REL_PATH).toBe(".agents/hooks.json");
    expect(ANTIGRAVITY_POST_TOOL_USE_MATCHER).toBe(ANTIGRAVITY_POST_TOOL_MATCHER);

    const merged = mergeAntigravityHooks(null);
    expect(hasCompleteAntigravityAutopilotHooks(merged)).toBe(true);
    expect(antigravityHooksHavePlatformStamp(merged)).toBe(true);
    expect(antigravityAutopilotHasExpectedPostMatcher(merged)).toBe(true);
    expect(antigravityHooksUseRelativeCommand(merged)).toBe(true);
    expect(antigravityAutopilotHasOmittedOrSmallTimeout(merged)).toBe(false);

    const block = merged[ANTIGRAVITY_HOOK_BLOCK_NAME] as {
      enabled?: boolean;
      PreInvocation?: Array<{
        type?: string;
        command?: string;
        timeout?: number;
      }>;
      Stop?: Array<{ type?: string; command?: string; timeout?: number }>;
      PostToolUse?: Array<{
        matcher?: string;
        hooks?: Array<{ type?: string; command?: string; timeout?: number }>;
        command?: string;
      }>;
    };
    expect(block.enabled).toBe(true);
    expect(block.PostToolUse?.[0]?.matcher).toBe(ANTIGRAVITY_POST_TOOL_USE_MATCHER);
    for (const event of ANTIGRAVITY_AUTOPILOT_EVENTS) {
      const entries = block[event];
      expect(Array.isArray(entries)).toBe(true);
      expect(entries).toHaveLength(1);
      if (event === "PostToolUse") {
        const group = entries![0]!;
        expect(group.matcher).toBe(ANTIGRAVITY_POST_TOOL_USE_MATCHER);
        expect(group.command).toBeUndefined();
        const h = group.hooks![0]!;
        expect(h.type).toBe("command");
        expect(h.timeout).toBe(ANTIGRAVITY_HOOK_TIMEOUT_SEC);
        expect(h.command).toMatch(
          /node \.agents\/bin\/autopilot-harness-hook\.mjs/,
        );
        expect(h.command).toMatch(/--platform antigravity/);
        expect(h.command).toMatch(/--event PostToolUse/);
      } else {
        const h = (
          entries as Array<{
            type?: string;
            command?: string;
            timeout?: number;
          }>
        )[0]!;
        expect(h.type).toBe("command");
        expect(h.timeout).toBe(ANTIGRAVITY_HOOK_TIMEOUT_SEC);
        expect(h.command).toMatch(
          /node \.agents\/bin\/autopilot-harness-hook\.mjs/,
        );
        expect(h.command).toMatch(/--platform antigravity/);
        expect(h.command).toMatch(new RegExp(`--event ${event}`));
      }
    }

    const noMatcher = mergeAntigravityHooks(null);
    const noMatcherBlock = noMatcher[ANTIGRAVITY_HOOK_BLOCK_NAME] as {
      PostToolUse: Array<{ matcher?: string }>;
    };
    delete noMatcherBlock.PostToolUse[0]!.matcher;
    expect(antigravityAutopilotHasExpectedPostMatcher(noMatcher)).toBe(false);
    expect(hasCompleteAntigravityAutopilotHooks(noMatcher)).toBe(false);
    expect(hasCompleteAntigravityAutopilotHooks(merged)).toBe(true);

    const withForeign = mergeAntigravityHooks({
      "my-linter-hook": {
        PostToolUse: [
          {
            matcher: "run_command",
            hooks: [{ type: "command", command: "echo lint" }],
          },
        ],
      },
    });
    expect(hasCompleteAntigravityAutopilotHooks(withForeign)).toBe(true);
    const stripped = stripAutopilotAntigravityHooks(withForeign);
    expect(antigravityHooksContainAutopilot(stripped)).toBe(false);
    expect(hasCompleteAntigravityAutopilotHooks(stripped)).toBe(false);
    expect(JSON.stringify(stripped["my-linter-hook"])).toMatch(/echo lint/);

    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "antigravity",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const hooksPath = path.join(root, ".agents", "hooks.json");
    expect(fs.existsSync(hooksPath)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as Parameters<
      typeof hasCompleteAntigravityAutopilotHooks
    >[0];
    expect(hasCompleteAntigravityAutopilotHooks(onDisk)).toBe(true);
    expect(antigravityHooksHavePlatformStamp(onDisk)).toBe(true);
    expect(antigravityAutopilotHasExpectedPostMatcher(onDisk)).toBe(true);
    expect(antigravityHooksUseRelativeCommand(onDisk)).toBe(true);
    expect(antigravityAutopilotHasOmittedOrSmallTimeout(onDisk)).toBe(false);
    expect(
      fs.existsSync(
        path.join(root, ".agents", "bin", "autopilot-harness-hook.mjs"),
      ),
    ).toBe(true);
    expect(fs.existsSync(path.join(root, ".agent"))).toBe(false);
  });

  it("install writes cwd-agnostic .agents/bin shim (resolves real hook via import.meta.url)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "antigravity",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const shim = path.join(
      root,
      ".agents",
      "bin",
      "autopilot-harness-hook.mjs",
    );
    expect(fs.existsSync(shim)).toBe(true);
    const cid = "hook-agy-shim-aaaa-bbbb-cccc-ddddeeee0001";
    const runFrom = (cwd: string) => {
      const proc = spawnSync(
        process.execPath,
        [shim, "--platform", "antigravity", "--event", "Stop"],
        {
          cwd,
          input: JSON.stringify({
            conversationId: cid,
            fullyIdle: false,
            workspacePaths: [root],
          }),
          encoding: "utf8",
          timeout: 15_000,
        },
      );
      if (proc.error) throw proc.error;
      expect(proc.status).toBe(0);
      expectAntigravitySilenceStdout(proc.stdout ?? "");
    };
    // Host may resolve relative command from project root or from .agents/.
    runFrom(root);
    runFrom(path.join(root, ".agents"));
  });

  it("uninstall removes Antigravity .agents/bin shim", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "antigravity",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const shim = path.join(
      root,
      ".agents",
      "bin",
      "autopilot-harness-hook.mjs",
    );
    expect(fs.existsSync(shim)).toBe(true);
    const un = uninstallProject({ projectRoot: root, dryRun: false });
    expect(un.ok).toBe(true);
    if (!un.ok) return;
    expect(fs.existsSync(shim)).toBe(false);
    expect(
      un.actions.some((a) =>
        /\.agents\/bin\/autopilot-harness-hook\.mjs/.test(a),
      ),
    ).toBe(true);
  });

  it("uninstall skips symlink Antigravity shim without failing (hooks still strip)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "antigravity",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const shim = path.join(
      root,
      ".agents",
      "bin",
      "autopilot-harness-hook.mjs",
    );
    const outside = path.join(root, "outside-shim.mjs");
    fs.writeFileSync(outside, "// outside\n", "utf8");
    fs.unlinkSync(shim);
    fs.symlinkSync(outside, shim);
    const un = uninstallProject({ projectRoot: root, dryRun: false });
    expect(un.ok).toBe(true);
    if (!un.ok) return;
    expect(
      un.actions.some((a) =>
        /skip \.agents\/bin\/autopilot-harness-hook\.mjs \(symlink\)/i.test(a),
      ),
    ).toBe(true);
    // Symlink left in place (safeRemovePath does not follow/unlink links).
    expect(fs.lstatSync(shim).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(root, ".agents", "hooks.json"))).toBe(false);
  });

  it("runner: injectSteps/Silence/Post {}; Stop fullyIdle; ten-way stamp cross", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "antigravity",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    writeChecklist(root, "alpha", "- [ ] a — A\n");
    writeChecklist(root, "beta", "- [ ] b — B\n");

    const cid = "hook-agy-contract-aaaa-bbbb-cccc-ddddeeee0001";
    const transcriptDir = path.join(root, "logs");
    fs.mkdirSync(transcriptDir, { recursive: true });
    const transcriptPath = path.join(transcriptDir, "transcript.jsonl");
    fs.writeFileSync(
      transcriptPath,
      `${JSON.stringify({ role: "user", text: "Autopilot ON" })}\n`,
    );

    const on = spawnAntigravityHook(root, "PreInvocation", {
      conversationId: cid,
      transcriptPath,
      workspacePaths: [root],
    });
    expect(on.status).toBe(0);
    expectAntigravitySilenceStdout(on.stdout);
    withStore(root, (onStore) => {
      expect(onStore.getSession(cid)?.phase).toBe("planning");
      expect(onStore.getSession(cid)?.platform).toBe(ANTIGRAVITY_PLATFORM);
    });

    // Unstamped PreInvocation still routes (unique event).
    const unstampedCid = "hook-agy-contract-aaaa-bbbb-cccc-ddddeeee0099";
    const unstamped = spawnAntigravityHook(
      root,
      "PreInvocation",
      {
        conversationId: unstampedCid,
        transcriptPath,
        workspacePaths: [root],
      },
      "",
    );
    expect(unstamped.status).toBe(0);
    expectAntigravitySilenceStdout(unstamped.stdout);
    withStore(root, (s) => {
      expect(s.getSession(unstampedCid)?.platform).toBe(ANTIGRAVITY_PLATFORM);
    });

    fs.writeFileSync(
      transcriptPath,
      `${JSON.stringify({ role: "user", text: "Autopilot RUN" })}\n`,
    );
    const pick = spawnAntigravityHook(root, "PreInvocation", {
      conversationId: cid,
      transcriptPath,
      workspacePaths: [root],
    });
    expect(pick.status).toBe(0);
    const pickOut = JSON.parse(pick.stdout.trim()) as {
      injectSteps?: Array<{ ephemeralMessage?: string }>;
      decision?: string;
    };
    expect(pickOut.decision).toBeUndefined();
    expect(Array.isArray(pickOut.injectSteps)).toBe(true);
    const pickMsg = pickOut.injectSteps?.[0]?.ephemeralMessage ?? "";
    // needPick must list every runnable candidate (not just one of them).
    expect(pickMsg).toMatch(/Select a plan/i);
    expect(pickMsg).toMatch(/alpha/i);
    expect(pickMsg).toMatch(/beta/i);
    expect(Object.keys(pickOut).sort()).toEqual(["injectSteps"]);
    // needPick must not jump into executing before the user picks a track.
    withStore(root, (afterPick) => {
      expect(afterPick.getSession(cid)?.phase).toBe("planning");
      expect(afterPick.getSession(cid)?.pending_action).toBe("run");
      expect(afterPick.getSession(cid)?.track_id).toBe("_pending");
      // Channel A pick is disarmed until a real track is claimed.
      expect(afterPick.getSession(cid)?.armed ?? 0).toBe(0);
      expect(afterPick.getSession(cid)?.paused ?? 0).toBe(0);
      const cands = JSON.parse(
        afterPick.getSession(cid)?.track_candidates_json ?? "null",
      ) as Array<{ slug?: string }>;
      expect(Array.isArray(cands)).toBe(true);
      expect(cands.map((c) => c.slug).sort()).toEqual(["alpha", "beta"]);
    });

    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    const editFile = path.join(root, "src", "contract-edit.ts");
    fs.writeFileSync(editFile, "export const n = 1;\n");
    withStore(root, (armed) => {
      // Post-pick executing: clear Channel A needPick residue (pending_action /
      // candidates) so edit-arm → Stop matches a real claimed track.
      armed.upsertSession({
        conversation_id: cid,
        project_root: root,
        code_root: root,
        platform: ANTIGRAVITY_PLATFORM,
        phase: "executing",
        armed: 1,
        paused: 0,
        track_id: "alpha",
        checklist_path: path.join(root, "plans", "alpha", "checklist.md"),
        pending_action: null,
        track_candidates_json: null,
      });
      expect(armed.getSession(cid)?.pending_action ?? null).toBeNull();
      expect(armed.getSession(cid)?.track_candidates_json ?? null).toBeNull();
      expect(armed.getSession(cid)?.phase).toBe("executing");
      expect(armed.getSession(cid)?.track_id).toBe("alpha");
    });

    const post = spawnAntigravityHook(root, "PostToolUse", {
      conversationId: cid,
      toolCall: {
        name: "write_to_file",
        args: { TargetFile: editFile },
      },
    });
    expect(post.status).toBe(0);
    expectAntigravitySilenceStdout(post.stdout);
    expect(post.stdout).not.toMatch(/"decision"\s*:\s*"block"/);
    withStore(root, (postStore) => {
      expect(postStore.getReviewChain(cid)?.code_edited).toBe(1);
      // Sticky reviewing item comes from checklist via PostToolUse, not session upsert.
      expect(postStore.getReviewChain(cid)?.reviewing_item_id).toBe("a");
    });

    // Idempotent retry: second Post stays Silence and does not flip flags.
    const postRetry = spawnAntigravityHook(root, "PostToolUse", {
      conversationId: cid,
      toolCall: {
        name: "write_to_file",
        args: { TargetFile: editFile },
      },
    });
    expect(postRetry.status).toBe(0);
    expectAntigravitySilenceStdout(postRetry.stdout);
    withStore(root, (retryStore) => {
      expect(retryStore.getReviewChain(cid)?.code_edited).toBe(1);
      expect(retryStore.getReviewChain(cid)?.reviewing_item_id).toBe("a");
    });

    withStore(root, (ready) => {
      ready.updateReviewChain(cid, { code_edited: 1 });
    });

    // Empty / whitespace / control-char conversationId on Stop: Silence (no throw / continue / ghost).
    const emptyCidStop = spawnAntigravityHook(root, "Stop", {
      conversationId: "",
      fullyIdle: true,
      terminationReason: "model_stop",
    });
    expect(emptyCidStop.status).toBe(0);
    expectAntigravitySilenceStdout(emptyCidStop.stdout);
    const wsCidStop = spawnAntigravityHook(root, "Stop", {
      conversationId: "   ",
      fullyIdle: true,
      terminationReason: "model_stop",
    });
    expect(wsCidStop.status).toBe(0);
    expectAntigravitySilenceStdout(wsCidStop.stdout);
    const ctrlCidStop = spawnAntigravityHook(root, "Stop", {
      conversationId: "bad\u0000id",
      fullyIdle: true,
      terminationReason: "model_stop",
    });
    expect(ctrlCidStop.status).toBe(0);
    expectAntigravitySilenceStdout(ctrlCidStop.stdout);
    withStore(root, (afterEmpty) => {
      expect(afterEmpty.getSession("") ?? null).toBeNull();
      expect(afterEmpty.getSession("   ") ?? null).toBeNull();
      expect(afterEmpty.getSession("bad\u0000id") ?? null).toBeNull();
      expect(afterEmpty.getReviewChain("") ?? null).toBeNull();
      expect(afterEmpty.getReviewChain("   ") ?? null).toBeNull();
      expect(afterEmpty.getReviewChain("bad\u0000id") ?? null).toBeNull();
      expect(afterEmpty.getReviewChain(cid)?.code_edited).toBe(1);
      expect(
        (afterEmpty.getReviewChain(cid)?.pending_followup ?? "").trim(),
      ).toBe("");
      expect(afterEmpty.getReviewChain(cid)?.chain_pending ?? 0).toBe(0);
      expect(afterEmpty.getSession(cid)?.armed).toBe(1);
      expect(afterEmpty.getSession(cid)?.paused).toBe(0);
      expect(afterEmpty.getSession(cid)?.phase).toBe("executing");
    });

    const idleFalse = spawnAntigravityHook(root, "Stop", {
      conversationId: cid,
      fullyIdle: false,
      terminationReason: "model_stop",
    });
    expect(idleFalse.status).toBe(0);
    expectAntigravitySilenceStdout(idleFalse.stdout);
    // Mid-tool completed: fail-open {} without advancing ReviewEngine.
    withStore(root, (afterIdleFalse) => {
      expect(afterIdleFalse.getSession(cid)?.phase).toBe("executing");
      expect(afterIdleFalse.getReviewChain(cid)?.code_edited).toBe(1);
      expect(
        (afterIdleFalse.getReviewChain(cid)?.pending_followup ?? "").trim(),
      ).toBe("");
      expect(afterIdleFalse.getReviewChain(cid)?.chain_pending ?? 0).toBe(0);
    });

    // Snake_case fully_idle through hook stdin (camelCase covered in I/O unit).
    // Pass transcriptPath so undelivered tip can redeliver on retry Stops.
    const cont = spawnAntigravityHook(root, "Stop", {
      conversationId: cid,
      fully_idle: true,
      terminationReason: "model_stop",
      executionNum: 1,
      transcriptPath,
    });
    expect(cont.status).toBe(0);
    const contOut = JSON.parse(cont.stdout.trim()) as {
      decision?: string;
      reason?: string;
    };
    expect(contOut.decision).toBe("continue");
    expect(typeof contOut.reason).toBe("string");
    expect(String(contOut.reason).trim().length).toBeGreaterThan(0);
    expect(Object.keys(contOut).sort()).toEqual(["decision", "reason"]);

    // Idempotent retry: second idle Stop redelivers the same tip without bumping fix_round.
    const contRetry = spawnAntigravityHook(root, "Stop", {
      conversationId: cid,
      fully_idle: true,
      terminationReason: "model_stop",
      executionNum: 2,
      transcriptPath,
    });
    expect(contRetry.status).toBe(0);
    const contRetryOut = JSON.parse(contRetry.stdout.trim()) as {
      decision?: string;
      reason?: string;
    };
    expect(contRetryOut.decision).toBe("continue");
    expect(String(contRetryOut.reason).trim()).toBe(
      String(contOut.reason).trim(),
    );
    expect(Object.keys(contRetryOut).sort()).toEqual(["decision", "reason"]);

    const pendingBeforeCross = withStore(root, (mid) => {
      expect(mid.getSession(cid)?.phase).toBe("executing");
      expect(mid.getSession(cid)?.track_id).toBe("alpha");
      expect(mid.getSession(cid)?.platform).toBe(ANTIGRAVITY_PLATFORM);
      expect(mid.getSession(cid)?.armed).toBe(1);
      expect(mid.getSession(cid)?.paused).toBe(0);
      const pending = (mid.getReviewChain(cid)?.pending_followup ?? "").trim();
      expect(pending.length).toBeGreaterThan(0);
      // Same handoff as Stop continue reason (including retry).
      expect(String(contOut.reason).trim()).toBe(pending);
      expect(String(contRetryOut.reason).trim()).toBe(pending);
      expect(mid.getReviewChain(cid)?.chain_pending).toBe(1);
      // E2 opens fix: sticky edit arm cleared; reviewing item + fix_round stay.
      expect(mid.getReviewChain(cid)?.code_edited ?? 0).toBe(0);
      expect(mid.getReviewChain(cid)?.reviewing_item_id).toBe("a");
      expect(mid.getReviewChain(cid)?.fix_round).toBe(1);
      expect(mid.getReviewChain(cid)?.confirm_left ?? null).toBeNull();
      return pending;
    });

    // Wrong stamp on Antigravity-unique event → {} before FSM (nine other hosts).
    for (const badPlatform of [
      "cursor",
      "claude-code",
      "codex",
      "kimi-code",
      "copilot-cli",
      "grok-build",
      "gemini-cli",
      "factory-droid",
      "hermes-agent",
    ] as const) {
      const wrongCid = `hook-agy-wrong-${badPlatform}-0001`;
      const wrong = spawnAntigravityHook(
        root,
        "PreInvocation",
        {
          conversationId: wrongCid,
          transcriptPath,
          workspacePaths: [root],
        },
        badPlatform,
      );
      expect(wrong.status).toBe(0);
      expectAntigravitySilenceStdout(wrong.stdout);
      withStore(root, (wrongStore) => {
        expect(wrongStore.getSession(wrongCid)).toBeNull();
      });
    }
    // Wrong-stamp loops must not mutate the armed session's E2 handoff.
    withStore(root, (afterWrong) => {
      expect(afterWrong.getSession(cid)?.phase).toBe("executing");
      expect(afterWrong.getSession(cid)?.track_id).toBe("alpha");
      expect(afterWrong.getSession(cid)?.platform).toBe(ANTIGRAVITY_PLATFORM);
      expect(
        (afterWrong.getReviewChain(cid)?.pending_followup ?? "").trim(),
      ).toBe(pendingBeforeCross);
      expect(afterWrong.getReviewChain(cid)?.chain_pending).toBe(1);
      expect(afterWrong.getReviewChain(cid)?.code_edited ?? 0).toBe(0);
      expect(afterWrong.getReviewChain(cid)?.reviewing_item_id).toBe("a");
      expect(afterWrong.getReviewChain(cid)?.fix_round).toBe(1);
      expect(afterWrong.getReviewChain(cid)?.confirm_left ?? null).toBeNull();
      expect(afterWrong.getSession(cid)?.armed).toBe(1);
      expect(afterWrong.getSession(cid)?.paused).toBe(0);
    });

    // Antigravity stamp + non-Antigravity event → {} abort; no pending mutation.
    expect(pendingBeforeCross).toBeTruthy();
    const cross = spawnAntigravityHook(root, "UserPromptSubmit", {
      conversationId: cid,
      prompt: "hostile claude shape",
    });
    expect(cross.status).toBe(0);
    expectAntigravitySilenceStdout(cross.stdout);
    withStore(root, (afterAbort) => {
      expect(afterAbort.getSession(cid)?.phase).toBe("executing");
      expect(afterAbort.getSession(cid)?.track_id).toBe("alpha");
      expect(afterAbort.getSession(cid)?.platform).toBe(ANTIGRAVITY_PLATFORM);
      expect(
        (afterAbort.getReviewChain(cid)?.pending_followup ?? "").trim(),
      ).toBe(pendingBeforeCross);
      expect(afterAbort.getReviewChain(cid)?.chain_pending).toBe(1);
      expect(afterAbort.getReviewChain(cid)?.code_edited ?? 0).toBe(0);
      expect(afterAbort.getReviewChain(cid)?.reviewing_item_id).toBe("a");
      expect(afterAbort.getReviewChain(cid)?.fix_round).toBe(1);
      expect(afterAbort.getReviewChain(cid)?.confirm_left ?? null).toBeNull();
      expect(afterAbort.getSession(cid)?.armed).toBe(1);
      expect(afterAbort.getSession(cid)?.paused).toBe(0);
    });

    // Fresh project: Antigravity stamp + non-Antigravity event must not open state.db.
    const freshRoot = tmpProject();
    try {
      expect(
        installInitYes({
          projectRoot: freshRoot,
          platform: "antigravity",
          surface: "cli",
          locale: "en",
          force: false,
        }).ok,
      ).toBe(true);
      // Install must not open the FSM db; abort must not create it either.
      expect(
        fs.existsSync(path.join(freshRoot, ".autopilot", "state.db")),
      ).toBe(false);
      const freshAbort = spawnAntigravityHook(freshRoot, "beforeSubmitPrompt", {
        conversationId: "hook-agy-fresh-abort-0001",
        prompt: "hello",
      });
      expect(freshAbort.status).toBe(0);
      expectAntigravitySilenceStdout(freshAbort.stdout);
      expect(
        fs.existsSync(path.join(freshRoot, ".autopilot", "state.db")),
      ).toBe(false);
    } finally {
      try {
        fs.rmSync(freshRoot, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  });
});
