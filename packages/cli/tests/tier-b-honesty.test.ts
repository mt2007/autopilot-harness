/**
 * v0.17 Tier-B honesty — no fake SubagentStop on hosts without a usable event.
 * Parent Stop dirty-arm (ReviewEngine) is the documented closeout when a child
 * edited product files without a parent edit hook (see p0-matrix F-DIRTY-STOP).
 */
import { describe, expect, it } from "vitest";
import { AUTOPILOT_EVENTS } from "../src/init/types.js";
import { CLAUDE_AUTOPILOT_EVENTS } from "../src/init/claude-settings-merge.js";
import { CODEX_AUTOPILOT_EVENTS } from "../src/init/codex-hooks-merge.js";
import { KIMI_AUTOPILOT_EVENTS } from "../src/init/kimi-hooks-merge.js";
import { COPILOT_AUTOPILOT_EVENTS } from "../src/init/copilot-hooks-merge.js";
import { GROK_AUTOPILOT_EVENTS } from "../src/init/grok-hooks-merge.js";
import { GEMINI_AUTOPILOT_EVENTS } from "../src/init/gemini-settings-merge.js";
import { FACTORY_AUTOPILOT_EVENTS } from "../src/init/factory-hooks-merge.js";
import { HERMES_AUTOPILOT_EVENTS } from "../src/init/hermes-hooks-merge.js";
import { ANTIGRAVITY_AUTOPILOT_EVENTS } from "../src/init/antigravity-hooks-merge.js";
import { DEVIN_AUTOPILOT_EVENTS } from "../src/init/devin-hooks-merge.js";

const TIER_S_SUBAGENT_EVENTS = new Set(["subagentStop", "SubagentStop"]);

const TIER_B_EVENT_TABLES: ReadonlyArray<{
  host: string;
  events: readonly string[];
}> = [
  { host: "codex", events: CODEX_AUTOPILOT_EVENTS },
  { host: "kimi-code", events: KIMI_AUTOPILOT_EVENTS },
  { host: "copilot-cli", events: COPILOT_AUTOPILOT_EVENTS },
  { host: "grok-build", events: GROK_AUTOPILOT_EVENTS },
  { host: "gemini-cli", events: GEMINI_AUTOPILOT_EVENTS },
  { host: "factory-droid", events: FACTORY_AUTOPILOT_EVENTS },
  { host: "hermes-agent", events: HERMES_AUTOPILOT_EVENTS },
  { host: "antigravity", events: ANTIGRAVITY_AUTOPILOT_EVENTS },
  { host: "devin", events: DEVIN_AUTOPILOT_EVENTS },
];

describe("Tier-B honesty — no fake SubagentStop", () => {
  it("Tier-S event tables include subagent stop; Tier-B tables do not", () => {
    expect(AUTOPILOT_EVENTS).toContain("subagentStop");
    expect(CLAUDE_AUTOPILOT_EVENTS).toContain("SubagentStop");

    for (const { host, events } of TIER_B_EVENT_TABLES) {
      for (const ev of events) {
        expect(
          TIER_S_SUBAGENT_EVENTS.has(ev),
          `${host} must not install fake ${ev}`,
        ).toBe(false);
      }
      expect(events.join(",")).not.toMatch(/subagentStop|SubagentStop/i);
    }
  });
});
