import { describe, expect, it } from "vitest";
import {
  CLAUDE_AUTOPILOT_EVENTS,
  CLAUDE_BLOCK_CAP_ENV,
  claudeSettingsContainAutopilot,
  hasClaudeBlockCapZero,
  hasCompleteClaudeAutopilotHooks,
  mergeClaudeSettings,
  stripAutopilotClaudeSettings,
  summarizeClaudeAutopilotHooks,
  validateClaudeSettingsShape,
} from "../src/init/claude-settings-merge.js";

describe("claude settings merge", () => {
  it("creates hooks + BLOCK_CAP=0 from empty", () => {
    const merged = mergeClaudeSettings(null);
    expect(hasClaudeBlockCapZero(merged)).toBe(true);
    expect(merged.env?.[CLAUDE_BLOCK_CAP_ENV]).toBe("0");
    expect(hasCompleteClaudeAutopilotHooks(merged)).toBe(true);
    for (const event of CLAUDE_AUTOPILOT_EVENTS) {
      const groups = merged.hooks?.[event];
      expect(Array.isArray(groups)).toBe(true);
      expect(JSON.stringify(groups)).toMatch(/autopilot-harness-hook\.mjs/);
      expect(JSON.stringify(groups)).toMatch(/--platform claude-code/);
      expect(JSON.stringify(groups)).toMatch(new RegExp(`--event ${event}`));
    }
    const post = merged.hooks?.PostToolUse?.[0];
    expect(post?.matcher).toBe("Edit|Write|NotebookEdit");
  });

  it("preserves foreign env and foreign hooks; replaces Autopilot entries", () => {
    const existing = {
      env: { MY_KEY: "keep", [CLAUDE_BLOCK_CAP_ENV]: "8" },
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: "echo foreign-stop",
              },
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
      permissions: { allow: ["Bash"] },
    };
    const merged = mergeClaudeSettings(existing);
    expect(merged.env?.MY_KEY).toBe("keep");
    expect(merged.env?.[CLAUDE_BLOCK_CAP_ENV]).toBe("0");
    expect(merged.permissions).toEqual({ allow: ["Bash"] });
    expect(JSON.stringify(merged.hooks?.SessionStart)).toMatch(/echo session/);
    const stopJson = JSON.stringify(merged.hooks?.Stop);
    expect(stopJson).toMatch(/foreign-stop/);
    expect(stopJson).toMatch(/autopilot-harness/);
    expect(stopJson).toMatch(/legacy-empty/);
    expect(stopJson).toMatch(/meta-only/);
    const { duplicates } = summarizeClaudeAutopilotHooks(merged);
    expect(duplicates).toBe(0);
  });

  it("refuses array hooks shape", () => {
    expect(
      validateClaudeSettingsShape({
        hooks: [] as unknown as Record<string, never>,
      }),
    ).toMatch(/hooks.*object/i);
    expect(() =>
      mergeClaudeSettings({
        hooks: [] as unknown as Record<string, never>,
      }),
    ).toThrow(/hooks.*object/i);
  });

  it("refuses __proto__ hooks/env keys (no prototype pollution on merge)", () => {
    const hostileHooks = JSON.parse(
      '{"hooks":{"__proto__":[{"hooks":[]}],"Stop":[]}}',
    ) as { hooks: Record<string, unknown> };
    expect(validateClaudeSettingsShape(hostileHooks)).toMatch(/not allowed/i);
    expect(() => mergeClaudeSettings(hostileHooks)).toThrow(/not allowed/i);

    const hostileEnv = JSON.parse(
      '{"env":{"__proto__":{"polluted":true},"MY":"x"}}',
    ) as { env: Record<string, unknown> };
    expect(validateClaudeSettingsShape(hostileEnv)).toMatch(/not allowed/i);
    expect(() => mergeClaudeSettings(hostileEnv)).toThrow(/not allowed/i);

    const hostileRoot = JSON.parse(
      '{"__proto__":{"polluted":true},"hooks":{}}',
    ) as Record<string, unknown>;
    expect(validateClaudeSettingsShape(hostileRoot)).toMatch(/not allowed/i);

    const merged = mergeClaudeSettings({
      env: { MY: "x" },
      hooks: { Stop: [] },
    });
    expect(Object.getPrototypeOf(merged.hooks!)).toBe(null);
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")).toBe(
      false,
    );
  });

  it("refuses non-string handler type and non-finite timeout", () => {
    expect(
      validateClaudeSettingsShape({
        hooks: {
          Stop: [
            {
              hooks: [
                {
                  type: 1 as unknown as string,
                  command: "echo x",
                },
              ],
            },
          ],
        },
      }),
    ).toMatch(/non-string type/i);
    expect(
      validateClaudeSettingsShape({
        hooks: {
          Stop: [
            {
              hooks: [
                {
                  type: "command",
                  command: "echo x",
                  timeout: Number.NaN,
                },
              ],
            },
          ],
        },
      }),
    ).toMatch(/non-finite timeout/i);
  });

  it("is idempotent and does not mutate the input object", () => {
    const input = {
      env: { MY_KEY: "keep", [CLAUDE_BLOCK_CAP_ENV]: "8" },
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: "echo foreign" },
              {
                type: "command",
                command:
                  "node .autopilot/bin/autopilot-harness-hook.mjs --event Stop",
              },
            ],
          },
        ],
      },
      permissions: { allow: ["Bash"] },
    };
    const before = structuredClone(input);
    const once = mergeClaudeSettings(input);
    const twice = mergeClaudeSettings(once);
    expect(input).toEqual(before);
    expect(hasCompleteClaudeAutopilotHooks(once)).toBe(true);
    expect(summarizeClaudeAutopilotHooks(twice).duplicates).toBe(0);
    expect(JSON.stringify(once.hooks)).toBe(JSON.stringify(twice.hooks));
    expect(once.env?.[CLAUDE_BLOCK_CAP_ENV]).toBe("0");
  });

  it("stripAutopilotClaudeSettings removes Autopilot hooks and BLOCK_CAP", () => {
    const merged = mergeClaudeSettings({
      env: { MY_KEY: "keep", [CLAUDE_BLOCK_CAP_ENV]: "0" },
      hooks: {
        Stop: [
          {
            hooks: [{ type: "command", command: "echo foreign-stop" }],
          },
        ],
        SessionStart: [
          {
            hooks: [{ type: "command", command: "echo session" }],
          },
        ],
      },
    });
    expect(claudeSettingsContainAutopilot(merged)).toBe(true);
    const stripped = stripAutopilotClaudeSettings(merged);
    expect(claudeSettingsContainAutopilot(stripped)).toBe(false);
    expect(hasClaudeBlockCapZero(stripped)).toBe(false);
    expect(stripped.env?.MY_KEY).toBe("keep");
    expect(stripped.env?.[CLAUDE_BLOCK_CAP_ENV]).toBeUndefined();
    expect(JSON.stringify(stripped.hooks?.Stop)).toMatch(/foreign-stop/);
    expect(JSON.stringify(stripped.hooks?.SessionStart)).toMatch(/echo session/);
    expect(hasCompleteClaudeAutopilotHooks(stripped)).toBe(false);
  });

  it("claudeSettingsContainAutopilot is true for BLOCK_CAP-only leftovers", () => {
    const leftover = {
      env: { [CLAUDE_BLOCK_CAP_ENV]: "0" },
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "echo foreign" }] }],
      },
    };
    expect(claudeSettingsContainAutopilot(leftover)).toBe(true);
    const stripped = stripAutopilotClaudeSettings(leftover);
    expect(claudeSettingsContainAutopilot(stripped)).toBe(false);
    expect(stripped.env).toBeUndefined();
    expect(JSON.stringify(stripped.hooks?.Stop)).toMatch(/echo foreign/);
  });

  it("strip does not invent hooks when only BLOCK_CAP env is present", () => {
    const leftover = { env: { [CLAUDE_BLOCK_CAP_ENV]: "8" } };
    expect(claudeSettingsContainAutopilot(leftover)).toBe(true);
    const stripped = stripAutopilotClaudeSettings(leftover);
    expect(stripped).toEqual({});
    expect(Object.prototype.hasOwnProperty.call(stripped, "hooks")).toBe(false);
  });

  it("strip drops Autopilot-only event keys instead of leaving empty arrays", () => {
    const merged = mergeClaudeSettings(null);
    const stripped = stripAutopilotClaudeSettings(merged);
    expect(stripped.hooks).toBeUndefined();
    expect(stripped.env).toBeUndefined();
  });
});
