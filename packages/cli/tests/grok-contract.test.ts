/**
 * v0.6 tests-grok-contract — umbrella matrix for Grok I/O, Stop single-channel,
 * UPS/needPick (UPS-block), busy, hooks merge (sibling + empty unlink + no
 * UPS/Stop matcher + command path), ignore, doctor (omit timeout), add-platform,
 * six-way dispatch + aliased exports.
 * Deeper suites live in port-grok / grok-hooks-merge / hook-vendor /
 * status-doctor / upgrade.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ReviewEngine, StateStore } from "@autopilot-harness/core";
import {
  blockSubmit,
  buildNeedPickContext,
  GROK_PLATFORM,
  GROK_POST_TOOL_USE_MATCHER,
  GROK_STOP_CAP_RAISE_FOUND,
  GROK_STOP_PER_TURN_BLOCK_CAP,
  handlePostToolUse,
  handleStop,
  handleUserPromptSubmit,
  MAX_NEED_PICK_SLUGS,
  normalizeGrokStopStatus,
} from "../../ports/grok-build/src/index.js";
import {
  handleClaudeStop,
  handleCodexPostToolUse,
  handleCodexStop,
  handleCodexUserPromptSubmit,
  handleCopilotPostToolUse,
  handleCopilotStop,
  handleCopilotUserPromptSubmit,
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
  GROK_AUTOPILOT_EVENTS,
  GROK_HOOK_TIMEOUT_SEC,
  GROK_HOOKS_REL_PATH,
  grokHooksContainAutopilot,
  grokHooksFileIsVacant,
  hasCompleteGrokAutopilotHooks,
  mergeGrokHooks,
  stripAutopilotGrokHooks,
} from "../src/init/grok-hooks-merge.js";
import { installInitYes } from "../src/init/install.js";
import { runDoctor } from "../src/status-doctor.js";
import { uninstallProject } from "../src/uninstall.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK_ASSET = path.resolve(
  __dirname,
  "../assets/autopilot-harness-hook.mjs",
);

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-grok-contract-"));
}

function writeChecklist(root: string, slug: string, body: string): void {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plan.md"), `# ${slug}\n`);
  fs.writeFileSync(path.join(dir, "checklist.md"), body);
}

describe("grok contract matrix", () => {
  let root = "";
  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = "";
  });

  it("vendor-entry aliases Grok handlers", () => {
    expect(handleGrokUserPromptSubmit).toBeTypeOf("function");
    expect(handleGrokPostToolUse).toBeTypeOf("function");
    expect(handleGrokStop).toBeTypeOf("function");
    expect(handleGrokUserPromptSubmit).not.toBe(handleClaudeUserPromptSubmit);
    expect(handleGrokPostToolUse).not.toBe(handleClaudePostToolUse);
    expect(handleGrokStop).not.toBe(handleClaudeStop);
    expect(handleGrokUserPromptSubmit).not.toBe(handleCodexUserPromptSubmit);
    expect(handleGrokPostToolUse).not.toBe(handleCodexPostToolUse);
    expect(handleGrokStop).not.toBe(handleCodexStop);
    expect(handleGrokUserPromptSubmit).not.toBe(handleKimiUserPromptSubmit);
    expect(handleGrokPostToolUse).not.toBe(handleKimiPostToolUse);
    expect(handleGrokStop).not.toBe(handleKimiStop);
    expect(handleGrokUserPromptSubmit).not.toBe(handleCopilotUserPromptSubmit);
    expect(handleGrokPostToolUse).not.toBe(handleCopilotPostToolUse);
    expect(handleGrokStop).not.toBe(handleCopilotStop);
  });

  it("shipped hook asset keeps seven-way dispatch + Grok Stop single-channel scrub", () => {
    expect(fs.existsSync(HOOK_ASSET)).toBe(true);
    const src = fs.readFileSync(HOOK_ASSET, "utf8");
    expect(src).toMatch(
      /KNOWN_PLATFORMS\s*=\s*new Set\(\[\s*"cursor"\s*,\s*"claude-code"\s*,\s*"codex"\s*,\s*"kimi-code"\s*,\s*"copilot-cli"\s*,\s*"grok-build"\s*,\s*"gemini-cli"\s*,\s*"factory-droid"\s*,\s*"hermes-agent"\s*,\s*"antigravity"\s*,?\s*\]\)/,
    );
    expect(src).toMatch(/declaredPlatform === "grok-build"/);
    expect(src).toMatch(/hostId === "grok-build"/);
    expect(src).toMatch(/handleGrokUserPromptSubmit/);
    expect(src).toMatch(/handleGrokPostToolUse/);
    expect(src).toMatch(/handleGrokStop/);
    expect(src).toMatch(/GEMINI_EVENTS/);
    expect(src).toMatch(/handleGeminiUserPromptSubmit/);
    expect(src).toMatch(/handleGeminiPostToolUse/);
    expect(src).toMatch(/handleGeminiStop/);
    // Continue uses decision:block only; hard-stop may use continue:false first.
    expect(src).toMatch(
      /stopHost === "grok-build"[\s\S]*?result\.continue === false[\s\S]*?decision === "block"/,
    );
  });

  it("I/O: UPS ON empty allow; RUN needPick is UPS decision:block (camelCase + snake_case)", () => {
    root = tmpProject();
    writeChecklist(root, "alpha", "- [ ] a — A\n");
    writeChecklist(root, "beta", "- [ ] b — B\n");
    const store = new StateStore(root);
    try {
      expect(
        handleUserPromptSubmit(store, { prompt: "Autopilot RUN" }, root),
      ).toEqual({});

      const cid = "grok-pick-1";
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
        { session_id: cid, prompt: "Autopilot RUN" },
        root,
      );
      expect(run.decision).toBe("block");
      expect(run.reason).toMatch(/Select a plan|alpha|beta/i);
      expect(run).not.toHaveProperty("hookSpecificOutput");
      expect(run).not.toHaveProperty("additionalContext");
      expect(Object.keys(run).sort()).toEqual(["decision", "reason"]);

      const filtered = buildNeedPickContext("", [
        { slug: "ok-plan" },
        { slug: "../evil" },
        { slug: "bad/slug" },
        { slug: "has spaces" },
        { slug: "" },
      ]);
      expect(filtered).toMatch(/\bok-plan\b/);
      expect(filtered).not.toMatch(/\.\.\/evil/);
      expect(filtered).not.toMatch(/bad\/slug/);
      expect(filtered).not.toMatch(/has spaces/);
      const blocked = blockSubmit(filtered, "fallback");
      expect(blocked.decision).toBe("block");
      expect(blocked).not.toHaveProperty("hookSpecificOutput");
      expect(blocked).not.toHaveProperty("additionalContext");
      expect(Object.keys(blocked).sort()).toEqual(["decision", "reason"]);

      const many = Array.from({ length: MAX_NEED_PICK_SLUGS + 5 }, (_, i) => ({
        slug: `slug-${i}`,
      }));
      const capped = buildNeedPickContext("", many);
      expect((capped.match(/slug-\d+/g) ?? []).length).toBe(MAX_NEED_PICK_SLUGS);
      expect(capped).not.toMatch(
        new RegExp(`\\bslug-${MAX_NEED_PICK_SLUGS}\\b`),
      );
    } finally {
      store.close();
    }
  });

  it("busy RUN uses UPS decision:block (not additionalContext)", () => {
    root = tmpProject();
    writeChecklist(root, "demo", "- [ ] a — A\n");
    const store = new StateStore(root);
    try {
      expect(
        handleUserPromptSubmit(
          store,
          { session_id: "owner", prompt: "/autopilot-run demo" },
          root,
        ),
      ).toEqual({});
      expect(store.getSession("owner")?.phase).toBe("executing");
      expect(store.getSession("owner")?.platform).toBe(GROK_PLATFORM);
      expect(store.getSession("owner")?.track_id).toBe("demo");

      const busy = handleUserPromptSubmit(
        store,
        { sessionId: "peer", prompt: "/autopilot-run demo" },
        root,
      );
      expect(busy.decision).toBe("block");
      expect(busy.reason).toMatch(/already executing/i);
      expect(busy).not.toHaveProperty("hookSpecificOutput");
      expect(busy).not.toHaveProperty("additionalContext");
      expect(Object.keys(busy).sort()).toEqual(["decision", "reason"]);
      // Busy peer must not steal the one_executor lease.
      expect(store.getSession("owner")?.phase).toBe("executing");
      expect(store.getSession("owner")?.track_id).toBe("demo");
      expect(store.findExecutingSession("owner")).toBeNull();
      expect(store.getSession("peer")).toMatchObject({
        phase: "idle",
        track_id: "_pending",
      });
    } finally {
      store.close();
    }
  });

  it("Stop continue is decision:block+reason only; abort/hard-stop stay single-channel", () => {
    expect(GROK_STOP_CAP_RAISE_FOUND).toBe(false);
    expect(GROK_STOP_PER_TURN_BLOCK_CAP).toBe(8);
    expect(normalizeGrokStopStatus({ status: "aborted" })).toBe("aborted");

    root = tmpProject();
    writeChecklist(root, "demo", "- [ ] a — A\n");
    const store = new StateStore(root);
    try {
      const cp = path.join(root, "plans", "demo", "checklist.md");
      store.upsertSession({
        conversation_id: "s-cont",
        project_root: root,
        code_root: root,
        phase: "executing",
        armed: 1,
        paused: 0,
        checklist_path: cp,
        track_id: "demo",
        platform: GROK_PLATFORM,
      });
      store.updateReviewChain("s-cont", { code_edited: 1 });
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
        sessionId: "s-cont",
        reason: "end_turn",
        stop_hook_active: false,
      });
      expect(cont.decision).toBe("block");
      expect(cont.reason).toBeTruthy();
      expect(cont.continue).toBeUndefined();
      expect(cont).not.toHaveProperty("hookSpecificOutput");
      expect(cont).not.toHaveProperty("additionalContext");
      expect(Object.keys(cont).sort()).toEqual(["decision", "reason"]);

      store.upsertSession({
        conversation_id: "s-abort",
        project_root: root,
        code_root: root,
        phase: "executing",
        armed: 1,
        paused: 0,
        checklist_path: cp,
        track_id: "demo",
        platform: GROK_PLATFORM,
      });
      store.updateReviewChain("s-abort", { code_edited: 1 });
      expect(
        handleStop(eng, {
          session_id: "s-abort",
          status: "aborted",
          reason: "end_turn",
        }),
      ).toEqual({});

      const halt = handleStop(
        {
          handleStop: () => ({
            kind: "stuck",
            message: "Stuck: contract halt",
            loop: false,
          }),
        } as unknown as ReviewEngine,
        { sessionId: "s-halt", reason: "end_turn" },
      );
      expect(halt.continue).toBe(false);
      expect(halt.decision).toBeUndefined();
      expect(halt.stopReason).toMatch(/Stuck: contract halt/);
      expect(halt).not.toHaveProperty("hookSpecificOutput");
      expect(halt).not.toHaveProperty("additionalContext");
      expect(halt).not.toHaveProperty("reason");
      expect(Object.keys(halt).sort()).toEqual(["continue", "stopReason"]);
    } finally {
      store.close();
    }
  });

  it("hooks merge: three events, timeout 120, stock command path, no UPS/Stop matcher; strip/vacant", () => {
    const merged = mergeGrokHooks(null);
    expect(hasCompleteGrokAutopilotHooks(merged)).toBe(true);
    for (const event of GROK_AUTOPILOT_EVENTS) {
      const groups = merged.hooks?.[event];
      expect(Array.isArray(groups)).toBe(true);
      expect(groups!.length).toBe(1);
      const g = groups![0]!;
      if (event === "PostToolUse") {
        expect(g.matcher).toBe(GROK_POST_TOOL_USE_MATCHER);
      } else {
        expect(g.matcher).toBeUndefined();
      }
      const h = g.hooks?.[0];
      expect(h?.type).toBe("command");
      expect(h?.timeout).toBe(GROK_HOOK_TIMEOUT_SEC);
      expect(h?.command).toBe(
        `node .autopilot/bin/autopilot-harness-hook.mjs --platform grok-build --event ${event}`,
      );
    }

    const withForeign = mergeGrokHooks({
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: "echo keep-foreign", timeout: 9 },
            ],
          },
        ],
      },
    });
    expect(grokHooksContainAutopilot(withForeign)).toBe(true);
    expect(JSON.stringify(withForeign.hooks?.Stop)).toMatch(/echo keep-foreign/);

    const stripped = stripAutopilotGrokHooks(withForeign);
    expect(grokHooksContainAutopilot(stripped)).toBe(false);
    expect(JSON.stringify(stripped.hooks?.Stop)).toMatch(/echo keep-foreign/);
    expect(JSON.stringify(stripped)).not.toMatch(/autopilot-harness-hook\.mjs/);
    expect(grokHooksFileIsVacant(stripped)).toBe(false);
    expect(grokHooksFileIsVacant(stripAutopilotGrokHooks(mergeGrokHooks(null)))).toBe(
      true,
    );
  });

  it("init ignore includes .grok/hooks/**; doctor WARNs Stop≤8 + omit timeout; add-platform keeps Cursor", () => {
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
        platform: "grok-build",
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
    expect(ignore).toMatch(/\.grok\/hooks\/\*\*/);
    expect(GROK_HOOKS_REL_PATH).toBe(".grok/hooks/autopilot-harness.json");
    expect(fs.existsSync(path.join(root, ".cursor", "hooks.json"))).toBe(true);
    const cursor = JSON.parse(
      fs.readFileSync(path.join(root, ".cursor", "hooks.json"), "utf8"),
    ) as {
      hooks?: { beforeSubmitPrompt?: Array<{ command?: string }> };
    };
    expect(
      cursor.hooks?.beforeSubmitPrompt?.some(
        (h) =>
          typeof h.command === "string" &&
          h.command.includes("--platform cursor"),
      ),
    ).toBe(true);
    expect(fs.existsSync(path.join(root, ".cursor", "skills"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".grok", "skills"))).toBe(false);
    expect(fs.existsSync(path.join(root, "AGENTS.md"))).toBe(false);

    const cfg = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(cfg).toMatch(/id:\s*cursor/);
    expect(cfg).toMatch(/id:\s*grok-build/);
    // Grok does not clamp confirm_rounds (unlike Kimi).
    expect(cfg).toMatch(/confirm_rounds:\s*5/);

    const healthy = runDoctor(root);
    expect(healthy.ok).toBe(true);
    const healthyJoined = healthy.lines.join("\n");
    expect(healthyJoined).toMatch(
      new RegExp(
        `Stop-continue per-turn block cap ≤${GROK_STOP_PER_TURN_BLOCK_CAP}`,
        "i",
      ),
    );
    expect(healthyJoined).toMatch(/hooks-trust|--trust/i);
    expect(healthyJoined).toMatch(/Reload Grok Build|new session/i);
    expect(healthyJoined).toMatch(
      /OK\s+\.grok\/hooks\/autopilot-harness\.json Autopilot entries/,
    );
    expect(healthyJoined).toMatch(/Grok Build \+ Cursor both enabled/i);

    const hooksPath = path.join(
      root,
      ".grok",
      "hooks",
      "autopilot-harness.json",
    );
    const file = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      hooks?: Record<string, Array<{ hooks?: Array<{ timeout?: number }> }>>;
    };
    for (const groups of Object.values(file.hooks ?? {})) {
      for (const g of groups) {
        for (const h of g.hooks ?? []) {
          delete h.timeout;
        }
      }
    }
    fs.writeFileSync(hooksPath, JSON.stringify(file, null, 2) + "\n");
    const omitted = runDoctor(root);
    expect(omitted.ok).toBe(true);
    const omitJoined = omitted.lines.join("\n");
    expect(omitJoined).toMatch(/timeout below 120 \(or omitted/i);
    expect(omitJoined).not.toMatch(
      /OK\s+\.grok\/hooks\/autopilot-harness\.json Autopilot entries/,
    );
  });

  it("fingerprint uninstall unlinks vacant hooks file and keeps sibling", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "grok-build",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const hooksDir = path.join(root, ".grok", "hooks");
    const hooksPath = path.join(hooksDir, "autopilot-harness.json");
    const sibling = path.join(hooksDir, "other.json");
    fs.writeFileSync(sibling, '{"ok":true}\n');

    const r = uninstallProject({ projectRoot: root });
    expect(r.ok).toBe(true);
    expect(fs.existsSync(hooksPath)).toBe(false);
    expect(fs.existsSync(sibling)).toBe(true);
  });

  it("PostToolUse dirty-arm product edit; plans path does not arm", () => {
    root = tmpProject();
    writeChecklist(root, "demo", "- [ ] a — A\n");
    const store = new StateStore(root);
    try {
      const cid = "grok-edit";
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
        platform: GROK_PLATFORM,
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
    } finally {
      store.close();
    }
  });
});
