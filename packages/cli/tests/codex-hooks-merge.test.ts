import { describe, expect, it } from "vitest";
import { isAutopilotCommand } from "../src/init/hooks-merge.js";
import {
  CODEX_AUTOPILOT_EVENTS,
  CODEX_POST_TOOL_USE_MATCHER,
  codexAutopilotHasSmallTimeout,
  codexHooksContainAutopilot,
  codexHooksHavePlatformStamp,
  hasCompleteCodexAutopilotHooks,
  mergeCodexHooks,
  stripAutopilotCodexHooks,
  summarizeCodexAutopilotHooks,
  validateCodexHooksShape,
} from "../src/init/codex-hooks-merge.js";

describe("codex hooks merge", () => {
  it("creates UserPromptSubmit/PostToolUse/Stop with --platform codex and no timeout", () => {
    const merged = mergeCodexHooks(null);
    expect(hasCompleteCodexAutopilotHooks(merged)).toBe(true);
    expect(codexHooksHavePlatformStamp(merged)).toBe(true);
    expect(codexAutopilotHasSmallTimeout(merged)).toBe(false);
    for (const event of CODEX_AUTOPILOT_EVENTS) {
      const groups = merged.hooks?.[event];
      expect(Array.isArray(groups)).toBe(true);
      const json = JSON.stringify(groups);
      expect(json).toMatch(/autopilot-harness-hook\.mjs/);
      expect(json).toMatch(/--platform codex/);
      expect(json).toMatch(new RegExp(`--event ${event}`));
      expect(json).not.toMatch(/"timeout"/);
    }
    expect(JSON.stringify(merged.hooks)).not.toMatch(/StopFailure/);
    const post = merged.hooks?.PostToolUse?.[0];
    expect(post?.matcher).toBe(CODEX_POST_TOOL_USE_MATCHER);
    expect(CODEX_POST_TOOL_USE_MATCHER).toBe("apply_patch|Edit|Write");
  });

  it("preserves foreign hooks and replaces Autopilot entries", () => {
    const existing = {
      description: "keep-me",
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: "echo foreign-stop" },
              {
                type: "command",
                command:
                  "node .autopilot/bin/autopilot-harness-hook.mjs --event Stop",
              },
            ],
          },
          { matcher: "legacy-empty", hooks: [] },
          { matcher: "meta-only" },
        ],
        SessionStart: [
          {
            hooks: [{ type: "command", command: "echo session" }],
          },
        ],
      },
    };
    const merged = mergeCodexHooks(existing);
    expect(merged.description).toBe("keep-me");
    expect(JSON.stringify(merged.hooks?.SessionStart)).toMatch(/echo session/);
    const stopJson = JSON.stringify(merged.hooks?.Stop);
    expect(stopJson).toMatch(/foreign-stop/);
    expect(stopJson).toMatch(/--platform codex/);
    expect(stopJson).toMatch(/legacy-empty/);
    expect(stopJson).toMatch(/meta-only/);
    const { duplicates } = summarizeCodexAutopilotHooks(merged);
    expect(duplicates).toBe(0);
  });

  it("force refresh drops legacy flat Autopilot command groups (no stack)", () => {
    const existing = {
      hooks: {
        Stop: [
          {
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --event Stop",
          },
          { command: "echo foreign-flat" },
        ],
      },
    };
    const merged = mergeCodexHooks(existing);
    const stop = merged.hooks?.Stop ?? [];
    const json = JSON.stringify(stop);
    expect(json).toMatch(/echo foreign-flat/);
    expect(json).toMatch(/--platform codex/);
    // Exactly one Autopilot Stop handler after merge (nested hooks shape).
    const { duplicates } = summarizeCodexAutopilotHooks(merged);
    expect(duplicates).toBe(0);
    expect(hasCompleteCodexAutopilotHooks(merged)).toBe(true);
    // Flat Autopilot entry must not remain beside the new matcher group.
    expect(
      stop.some(
        (g) =>
          typeof g.command === "string" &&
          g.command.includes("autopilot-harness-hook.mjs") &&
          !Array.isArray(g.hooks),
      ),
    ).toBe(false);
  });

  it("strips top-level Autopilot command on mixed groups; keeps foreign top-level command", () => {
    const merged = mergeCodexHooks({
      hooks: {
        Stop: [
          {
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --event Stop",
            timeout: 30,
            type: "command",
            hooks: [{ type: "command", command: "echo nested-foreign" }],
          },
          {
            command: "echo top-foreign",
            timeout: 45,
            hooks: [
              {
                type: "command",
                command:
                  "node .autopilot/bin/autopilot-harness-hook.mjs --event Stop",
              },
            ],
          },
          {
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --event Stop",
            hooks: [],
          },
          {
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --event Stop",
            matcher: "keep-matcher",
            hooks: [],
          },
          // Flat Autopilot (no hooks array) must keep matcher meta — same as empty hooks.
          {
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --event Stop",
            matcher: "flat-matcher",
            timeout: 15,
            type: "command",
          },
          // Autopilot type:"command" alone must not become a kept empty shell.
          {
            type: "command",
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --event Stop",
            hooks: [],
          },
          {
            command: "   ",
            matcher: "ws-matcher",
            timeout: 20,
            hooks: [
              {
                type: "command",
                command:
                  "node .autopilot/bin/autopilot-harness-hook.mjs --event Stop",
              },
            ],
          },
        ],
      },
    });
    const stop = merged.hooks?.Stop ?? [];
    const stopJson = JSON.stringify(stop);
    expect(stopJson).toMatch(/echo nested-foreign/);
    expect(stopJson).toMatch(/echo top-foreign/);
    expect(stopJson).toMatch(/--platform codex/);
    expect(stopJson).toMatch(/keep-matcher/);
    expect(stopJson).toMatch(/flat-matcher/);
    expect(stopJson).toMatch(/ws-matcher/);
    const { duplicates } = summarizeCodexAutopilotHooks(merged);
    expect(duplicates).toBe(0);
    // Foreign top-level timeout must survive when only nested Autopilot is removed.
    const foreignFlat = stop.find((g) => g.command === "echo top-foreign");
    expect(foreignFlat?.timeout).toBe(45);
    expect(foreignFlat?.hooks).toBeUndefined();
    const flatMeta = stop.find((g) => g.matcher === "flat-matcher");
    expect(flatMeta?.command).toBeUndefined();
    expect(flatMeta?.timeout).toBeUndefined();
    expect(flatMeta?.type).toBeUndefined();
    const wsMeta = stop.find((g) => g.matcher === "ws-matcher");
    expect(wsMeta?.command).toBeUndefined();
    expect(wsMeta?.timeout).toBeUndefined();
    expect(Array.isArray(wsMeta?.hooks) && wsMeta.hooks.length === 0).toBe(true);
    // No leftover top-level Autopilot command on a group that still has hooks.
    for (const g of stop) {
      if (Array.isArray(g.hooks) && g.hooks.some((h) => h.command === "echo nested-foreign")) {
        expect(isAutopilotCommand(g.command)).toBe(false);
        // Autopilot top-level timeout/type must not stick on foreign nested groups.
        expect(g.timeout).toBeUndefined();
        expect(g.type).toBeUndefined();
      }
    }
    // Pure Autopilot shells (no matcher) must not remain after scrub.
    expect(
      stop.some(
        (g) =>
          !g.matcher &&
          g.command === undefined &&
          g.type === "command" &&
          (!Array.isArray(g.hooks) || g.hooks.length === 0),
      ),
    ).toBe(false);
    // Force idempotent: type-only Autopilot shells must not stack.
    const again = mergeCodexHooks(merged);
    expect(
      (again.hooks?.Stop ?? []).filter(
        (g) => g.type === "command" && g.command === undefined && !g.matcher,
      ),
    ).toHaveLength(0);
    expect(summarizeCodexAutopilotHooks(again).duplicates).toBe(0);
  });

  it("refuses array hooks shape", () => {
    expect(
      validateCodexHooksShape({
        hooks: [] as unknown as Record<string, never>,
      }),
    ).toMatch(/hooks.*object/i);
    expect(() =>
      mergeCodexHooks({ hooks: [] as unknown as Record<string, never> }),
    ).toThrow(/hooks.*object/i);
  });

  it("strip removes Autopilot handlers and contain helper tracks them", () => {
    const merged = mergeCodexHooks(null);
    expect(codexHooksContainAutopilot(merged)).toBe(true);
    const stripped = stripAutopilotCodexHooks(merged);
    expect(codexHooksContainAutopilot(stripped)).toBe(false);
    expect(hasCompleteCodexAutopilotHooks(stripped)).toBe(false);
  });

  it("detects explicit Autopilot timeout under 120s", () => {
    const merged = mergeCodexHooks(null);
    const stop = merged.hooks?.Stop?.[0];
    expect(stop?.hooks?.[0]).toBeTruthy();
    stop!.hooks![0]!.timeout = 30;
    expect(codexAutopilotHasSmallTimeout(merged)).toBe(true);
  });
});
