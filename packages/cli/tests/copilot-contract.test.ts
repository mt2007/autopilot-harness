/**
 * v0.5 tests-copilot-contract — umbrella matrix for Copilot I/O, Stop block,
 * UPS side-effects vs Transform needPick/busy, hooks merge (dual OS) /
 * fingerprint, .autopilotignore `.github/hooks/**`, doctor, add-platform,
 * five-way→six-way dispatch + aliased exports.
 * Deeper suites live in port-copilot / copilot-hooks-merge / hook-vendor /
 * status-doctor / upgrade.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ReviewEngine, StateStore } from "@autopilot-harness/core";
import {
  buildNeedPickContext,
  COPILOT_PLATFORM,
  COPILOT_STOP_CAP_RAISE_FOUND,
  COPILOT_STOP_CONSECUTIVE_BLOCK_CAP,
  handlePostToolUse,
  handleStop,
  handleUserPromptSubmit,
  handleUserPromptTransformed,
  MAX_NEED_PICK_SLUGS,
  normalizeCopilotStopStatus,
  submitGateFilePath,
} from "../../ports/copilot-cli/src/index.js";
import {
  handleClaudeStop,
  handleCodexPostToolUse,
  handleCodexStop,
  handleCodexUserPromptSubmit,
  handleCopilotPostToolUse,
  handleCopilotStop,
  handleCopilotUserPromptSubmit,
  handleCopilotUserPromptTransformed,
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
  COPILOT_AUTOPILOT_EVENTS,
  COPILOT_HOOK_TIMEOUT_SEC,
  COPILOT_HOOKS_REL_PATH,
  copilotHooksContainAutopilot,
  hasCompleteCopilotAutopilotHooks,
  mergeCopilotHooks,
  stripAutopilotCopilotHooks,
} from "../src/init/copilot-hooks-merge.js";
import { installInitYes } from "../src/init/install.js";
import { runDoctor } from "../src/status-doctor.js";
import { uninstallProject } from "../src/uninstall.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK_ASSET = path.resolve(
  __dirname,
  "../assets/autopilot-harness-hook.mjs",
);

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-copilot-contract-"));
}

function writeChecklist(root: string, slug: string, body: string): void {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plan.md"), `# ${slug}\n`);
  fs.writeFileSync(path.join(dir, "checklist.md"), body);
}

describe("copilot contract matrix", () => {
  let root = "";
  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = "";
  });

  it("vendor-entry aliases Copilot handlers", () => {
    expect(handleCopilotUserPromptSubmit).toBeTypeOf("function");
    expect(handleCopilotUserPromptTransformed).toBeTypeOf("function");
    expect(handleCopilotPostToolUse).toBeTypeOf("function");
    expect(handleCopilotStop).toBeTypeOf("function");
    expect(handleGrokUserPromptSubmit).toBeTypeOf("function");
    expect(handleGrokPostToolUse).toBeTypeOf("function");
    expect(handleGrokStop).toBeTypeOf("function");
    expect(handleCopilotUserPromptSubmit).not.toBe(handleClaudeUserPromptSubmit);
    expect(handleCopilotPostToolUse).not.toBe(handleClaudePostToolUse);
    expect(handleCopilotStop).not.toBe(handleClaudeStop);
    expect(handleCopilotUserPromptSubmit).not.toBe(handleCodexUserPromptSubmit);
    expect(handleCopilotPostToolUse).not.toBe(handleCodexPostToolUse);
    expect(handleCopilotStop).not.toBe(handleCodexStop);
    expect(handleCopilotUserPromptSubmit).not.toBe(handleKimiUserPromptSubmit);
    expect(handleCopilotPostToolUse).not.toBe(handleKimiPostToolUse);
    expect(handleCopilotStop).not.toBe(handleKimiStop);
    expect(handleGrokUserPromptSubmit).not.toBe(handleClaudeUserPromptSubmit);
    expect(handleGrokPostToolUse).not.toBe(handleClaudePostToolUse);
    expect(handleGrokStop).not.toBe(handleClaudeStop);
    expect(handleGrokUserPromptSubmit).not.toBe(handleCodexUserPromptSubmit);
    expect(handleGrokStop).not.toBe(handleCodexStop);
    expect(handleGrokUserPromptSubmit).not.toBe(handleCopilotUserPromptSubmit);
    expect(handleGrokStop).not.toBe(handleCopilotStop);
    expect(handleGrokUserPromptSubmit).not.toBe(handleKimiUserPromptSubmit);
    expect(handleGrokStop).not.toBe(handleKimiStop);
  });

  it("shipped hook asset keeps six-way dispatch (Copilot + Grok stamps)", () => {
    expect(fs.existsSync(HOOK_ASSET)).toBe(true);
    const src = fs.readFileSync(HOOK_ASSET, "utf8");
    expect(src).toMatch(
      /KNOWN_PLATFORMS\s*=\s*new Set\(\[\s*"cursor"\s*,\s*"claude-code"\s*,\s*"codex"\s*,\s*"kimi-code"\s*,\s*"copilot-cli"\s*,\s*"grok-build"\s*,\s*"gemini-cli"\s*,\s*"factory-droid"\s*,\s*"hermes-agent"\s*,\s*"antigravity"\s*,\s*"devin"\s*,?\s*\]\)/,
    );
    expect(src).toMatch(/declaredPlatform === "copilot-cli"/);
    expect(src).toMatch(/declaredPlatform === "grok-build"/);
    expect(src).toMatch(/handleCopilotUserPromptSubmit/);
    expect(src).toMatch(/handleCopilotUserPromptTransformed/);
    expect(src).toMatch(/handleCopilotPostToolUse/);
    expect(src).toMatch(/handleCopilotStop/);
    expect(src).toMatch(/handleGrokUserPromptSubmit/);
    expect(src).toMatch(/handleGrokPostToolUse/);
    expect(src).toMatch(/handleGrokStop/);
    expect(src).toMatch(/userPromptTransformed/);
    expect(src).toMatch(/hostId === "copilot-cli"/);
    expect(src).toMatch(/hostId === "grok-build"/);
    // Grok Stop scrub: hard-stop (continue:false) before single-channel block.
    expect(src).toMatch(
      /stopHost === "grok-build"[\s\S]*?result\.continue === false[\s\S]*?decision === "block"/,
    );
  });

  it("I/O: UPS side-effects only; Transform needPick prepends (stdout not the UPS channel)", () => {
    root = tmpProject();
    writeChecklist(root, "alpha", "- [ ] a — A\n");
    writeChecklist(root, "beta", "- [ ] b — B\n");
    const store = new StateStore(root);
    try {
      // Missing session id → fail-open empty side-effects (no throw).
      expect(
        handleUserPromptSubmit(store, { prompt: "Autopilot RUN" }, root),
      ).toEqual({ _sideEffectsOnly: true });

      const cid = "copilot-pick-1";
      const on = handleUserPromptSubmit(
        store,
        { sessionId: cid, prompt: "Autopilot ON" },
        root,
      );
      expect(on).toMatchObject({ _sideEffectsOnly: true });
      expect(on._stashedGate).toBeUndefined();
      expect(store.getSession(cid)?.phase).toBe("planning");
      expect(store.getSession(cid)?.platform).toBe(COPILOT_PLATFORM);

      const run = handleUserPromptSubmit(
        store,
        { sessionId: cid, prompt: "Autopilot RUN" },
        root,
      );
      expect(run._sideEffectsOnly).toBe(true);
      expect(run._stashedGate).toMatch(/Select a plan|alpha|beta/i);
      expect("decision" in run).toBe(false);
      expect("modifiedPrompt" in run).toBe(false);
      expect(fs.existsSync(submitGateFilePath(root, cid))).toBe(true);

      const tr = handleUserPromptTransformed(
        store,
        {
          sessionId: cid,
          prompt: "Autopilot RUN",
          transformedPrompt: "Autopilot RUN",
        },
        root,
      );
      expect(tr.modifiedTransformedPrompt).toMatch(/\[Autopilot\]/);
      expect(tr.modifiedTransformedPrompt).toMatch(/Select a plan|alpha|beta/i);
      expect(tr.modifiedTransformedPrompt).toMatch(/Autopilot RUN/);
      expect(fs.existsSync(submitGateFilePath(root, cid))).toBe(false);

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

  it("busy/error channel: UPS stashes block gate; Transform replaces prompt (no leftover RUN)", () => {
    root = tmpProject();
    writeChecklist(root, "demo", "- [ ] a — A\n");
    const store = new StateStore(root);
    try {
      const owner = "copilot-owner";
      const peer = "copilot-peer";
      expect(
        handleUserPromptSubmit(
          store,
          { sessionId: owner, prompt: "Autopilot RUN demo" },
          root,
        ),
      ).toMatchObject({ _sideEffectsOnly: true });
      expect(store.getSession(owner)?.phase).toBe("executing");
      expect(store.getSession(owner)?.platform).toBe(COPILOT_PLATFORM);

      const busy = handleUserPromptSubmit(
        store,
        { sessionId: peer, prompt: "Autopilot RUN demo" },
        root,
      );
      expect(busy._sideEffectsOnly).toBe(true);
      expect(busy._stashedGate).toMatch(/already executing|busy|one.?executor/i);
      expect("decision" in busy).toBe(false);
      expect(fs.existsSync(submitGateFilePath(root, peer))).toBe(true);
      // Busy peer must not steal the one_executor lease.
      expect(store.getSession(owner)?.phase).toBe("executing");
      expect(store.getSession(owner)?.track_id).toBe("demo");
      // exclude owner → no other executing session (peer did not take the lease).
      expect(store.findExecutingSession(owner)).toBeNull();
      expect(store.getSession(peer)).toMatchObject({
        phase: "idle",
        track_id: "_pending",
      });

      const tr = handleUserPromptTransformed(
        store,
        {
          sessionId: peer,
          prompt: "Autopilot RUN demo",
          transformedPrompt: "Autopilot RUN demo",
        },
        root,
      );
      expect(tr.modifiedTransformedPrompt).toMatch(
        /already executing|busy|one.?executor/i,
      );
      expect(tr.modifiedTransformedPrompt).not.toMatch(/Autopilot RUN demo/);
      expect(fs.existsSync(submitGateFilePath(root, peer))).toBe(false);
      // Transform compensates the peer gate only — must not promote peer or
      // drop the owner's one_executor lease (partial-failure / race surface).
      expect(store.getSession(owner)?.phase).toBe("executing");
      expect(store.getSession(owner)?.track_id).toBe("demo");
      expect(store.findExecutingSession(owner)).toBeNull();
      expect(store.getSession(peer)).toMatchObject({
        phase: "idle",
        track_id: "_pending",
      });
    } finally {
      store.close();
    }
  });

  it("Stop continue is decision:block+reason; hard-stop/abort is {} (no Claude continue:false)", () => {
    expect(COPILOT_STOP_CAP_RAISE_FOUND).toBe(false);
    expect(COPILOT_STOP_CONSECUTIVE_BLOCK_CAP).toBe(8);
    expect(normalizeCopilotStopStatus({ status: "aborted" })).toBe("aborted");

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
        platform: COPILOT_PLATFORM,
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
        stop_hook_active: false,
      });
      expect(cont.decision).toBe("block");
      expect(cont.reason).toBeTruthy();
      expect(cont.continue).toBeUndefined();
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
        platform: COPILOT_PLATFORM,
      });
      store.updateReviewChain("s-abort", { code_edited: 1 });
      expect(
        handleStop(eng, {
          sessionId: "s-abort",
          status: "aborted",
        }),
      ).toEqual({});
    } finally {
      store.close();
    }
  });

  it("hooks merge: four camelCase events, dual OS fields, stamp, timeout≥120; fingerprint strip keeps foreign", () => {
    const merged = mergeCopilotHooks(null);
    expect(hasCompleteCopilotAutopilotHooks(merged)).toBe(true);
    expect(merged.version).toBe(1);
    for (const event of COPILOT_AUTOPILOT_EVENTS) {
      const handlers = merged.hooks?.[event];
      expect(Array.isArray(handlers)).toBe(true);
      expect(handlers!.length).toBeGreaterThanOrEqual(1);
      const h = handlers![0]!;
      expect(h.bash).toMatch(/--platform copilot-cli/);
      expect(h.powershell).toMatch(/--platform copilot-cli/);
      expect(h.timeoutSec).toBe(COPILOT_HOOK_TIMEOUT_SEC);
    }

    const withForeign = mergeCopilotHooks({
      version: 1,
      hooks: {
        agentStop: [
          {
            type: "command",
            bash: "echo keep-foreign",
            powershell: "echo keep-foreign",
            timeoutSec: 5,
          },
        ],
      },
    });
    expect(copilotHooksContainAutopilot(withForeign)).toBe(true);
    const stripped = stripAutopilotCopilotHooks(withForeign);
    expect(copilotHooksContainAutopilot(stripped)).toBe(false);
    const stop = stripped.hooks?.agentStop ?? [];
    expect(JSON.stringify(stop)).toMatch(/echo keep-foreign/);
    expect(JSON.stringify(stop)).not.toMatch(/autopilot-harness-hook\.mjs/);
  });

  it("init ignore includes .github/hooks/**; doctor WARNs Stop≤8 + restart", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "copilot-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();

    const ignore = fs.readFileSync(
      path.join(root, ".autopilotignore"),
      "utf8",
    );
    expect(ignore).toMatch(/\.github\/hooks\/\*\*/);
    expect(ignore).toMatch(/\.github\/skills\/\*\*/);

    const hooksPath = path.join(root, ".github", "hooks", "autopilot-harness.json");
    expect(fs.existsSync(hooksPath)).toBe(true);
    expect(COPILOT_HOOKS_REL_PATH).toBe(".github/hooks/autopilot-harness.json");
    expect(
      fs.existsSync(
        path.join(root, ".github", "skills", "autopilot-on", "SKILL.md"),
      ),
    ).toBe(true);

    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(
      new RegExp(
        `Stop-continue consecutive block cap ≤${COPILOT_STOP_CONSECUTIVE_BLOCK_CAP}`,
        "i",
      ),
    );
    expect(joined).toMatch(/Restart Copilot CLI/i);
    expect(joined).toMatch(
      /OK\s+\.github\/hooks\/autopilot-harness\.json Autopilot entries/,
    );
  });

  it("add-platform copilot-cli keeps Cursor hooks and wires Copilot file + skills", () => {
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
        platform: "copilot-cli",
        surface: "cli",
        locale: "en",
        force: true,
        mergePlatforms: true,
      }).ok,
    ).toBe(true);

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

    const file = JSON.parse(
      fs.readFileSync(
        path.join(root, ".github", "hooks", "autopilot-harness.json"),
        "utf8",
      ),
    ) as {
      hooks?: Record<string, Array<{ bash?: string; powershell?: string }>>;
    };
    expect(hasCompleteCopilotAutopilotHooks(file)).toBe(true);
    expect(file.hooks?.agentStop?.[0]?.bash).toMatch(/--platform copilot-cli/);
    expect(file.hooks?.agentStop?.[0]?.powershell).toMatch(
      /--platform copilot-cli/,
    );

    expect(fs.existsSync(path.join(root, ".cursor", "skills"))).toBe(true);
    expect(
      fs.existsSync(
        path.join(root, ".github", "skills", "autopilot-on", "SKILL.md"),
      ),
    ).toBe(true);
    expect(fs.existsSync(path.join(root, "AGENTS.md"))).toBe(false);

    const cfg = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(cfg).toMatch(/id:\s*cursor/);
    expect(cfg).toMatch(/id:\s*copilot-cli/);
    // Copilot does not clamp confirm_rounds (unlike Kimi).
    expect(cfg).toMatch(/confirm_rounds:\s*5/);
  });

  it("fingerprint uninstall strips Autopilot Copilot hooks and keeps foreign", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "copilot-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const hooksPath = path.join(
      root,
      ".github",
      "hooks",
      "autopilot-harness.json",
    );
    const file = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      hooks?: Record<string, Array<Record<string, unknown>>>;
    };
    file.hooks = file.hooks ?? {};
    file.hooks.agentStop = [
      ...(file.hooks.agentStop ?? []),
      {
        type: "command",
        bash: "echo keep-copilot-foreign",
        powershell: "echo keep-copilot-foreign",
        timeoutSec: 5,
      },
    ];
    fs.writeFileSync(hooksPath, JSON.stringify(file, null, 2) + "\n");

    const r = uninstallProject({ projectRoot: root });
    expect(r.ok).toBe(true);
    const after = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      hooks?: Record<string, Array<Record<string, unknown>>>;
    };
    expect(copilotHooksContainAutopilot(after)).toBe(false);
    expect(JSON.stringify(after)).toMatch(/echo keep-copilot-foreign/);
  });

  it("PostToolUse edit arms dirty; Stop block follows (contract I/O chain)", () => {
    root = tmpProject();
    writeChecklist(root, "t1", "- [ ] port-item — do thing\n");
    const store = new StateStore(root);
    try {
      const cid = "copilot-edit-stop";
      const cp = path.join(root, "plans", "t1", "checklist.md");
      store.upsertSession({
        conversation_id: cid,
        project_root: root,
        code_root: root,
        platform: COPILOT_PLATFORM,
        phase: "executing",
        armed: 1,
        checklist_path: cp,
        track_id: "t1",
      });
      const src = path.join(root, "src");
      fs.mkdirSync(src, { recursive: true });
      const file = path.join(src, "x.ts");
      fs.writeFileSync(file, "export const x = 1;\n");

      handlePostToolUse(
        store,
        { sessionId: cid, toolName: "edit", tool_input: { path: file } },
        root,
      );
      expect(store.getReviewChain(cid)?.code_edited).toBe(1);

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
      const stop = handleStop(eng, { sessionId: cid, stop_hook_active: false });
      expect(stop.decision).toBe("block");
      expect(stop.reason).toBeTruthy();
      expect(stop.continue).toBeUndefined();
      expect(Object.keys(stop).sort()).toEqual(["decision", "reason"]);
    } finally {
      store.close();
    }
  });
});
