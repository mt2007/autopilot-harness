/**
 * v0.3 tests-codex-contract — umbrella matrix for Codex I/O, apply_patch,
 * needPick, Stop, merge, doctor, add-platform, quaternary + aliased exports.
 * Deeper suites live in port-codex / codex-hooks-merge / hook-vendor / init-yes.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ReviewEngine, StateStore } from "@autopilot-harness/core";
import {
  allowNeedPickContext,
  CODEX_PLATFORM,
  handleStop,
  handleUserPromptSubmit,
  MAX_APPLY_PATCH_COMMAND_CHARS,
  MAX_NEED_PICK_SLUGS,
  normalizeCodexStopStatus,
  pathsFromApplyPatchCommand,
} from "../../ports/codex/src/index.js";
import {
  handleClaudeStop,
  handleCodexPostToolUse,
  handleCodexStop,
  handleCodexUserPromptSubmit,
  handleKimiPostToolUse,
  handleKimiStop,
  handleKimiUserPromptSubmit,
  handlePostToolUse as handleClaudePostToolUse,
  handleUserPromptSubmit as handleClaudeUserPromptSubmit,
} from "../src/vendor-entry.js";
import {
  mergeCodexHooks,
  summarizeCodexAutopilotHooks,
} from "../src/init/codex-hooks-merge.js";
import { installInitYes } from "../src/init/install.js";
import { runDoctor } from "../src/status-doctor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK_ASSET = path.resolve(
  __dirname,
  "../assets/autopilot-harness-hook.mjs",
);

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-codex-contract-"));
}

function writeChecklist(root: string, slug: string, body: string): void {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plan.md"), `# ${slug}\n`);
  fs.writeFileSync(path.join(dir, "checklist.md"), body);
}

describe("codex contract matrix", () => {
  let root = "";
  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = "";
  });

  it("vendor-entry aliases Codex/Kimi handlers without colliding with Claude bare names", () => {
    expect(handleCodexUserPromptSubmit).toBeTypeOf("function");
    expect(handleCodexPostToolUse).toBeTypeOf("function");
    expect(handleCodexStop).toBeTypeOf("function");
    expect(handleKimiUserPromptSubmit).toBeTypeOf("function");
    expect(handleKimiPostToolUse).toBeTypeOf("function");
    expect(handleKimiStop).toBeTypeOf("function");
    // Aliases must be distinct function identities from Claude's bare exports.
    expect(handleCodexUserPromptSubmit).not.toBe(handleClaudeUserPromptSubmit);
    expect(handleCodexPostToolUse).not.toBe(handleClaudePostToolUse);
    expect(handleCodexStop).not.toBe(handleClaudeStop);
    expect(handleKimiUserPromptSubmit).not.toBe(handleClaudeUserPromptSubmit);
    expect(handleKimiPostToolUse).not.toBe(handleClaudePostToolUse);
    expect(handleKimiStop).not.toBe(handleClaudeStop);
    expect(handleKimiUserPromptSubmit).not.toBe(handleCodexUserPromptSubmit);
    expect(handleKimiPostToolUse).not.toBe(handleCodexPostToolUse);
    expect(handleKimiStop).not.toBe(handleCodexStop);
  });

  it("shipped hook asset keeps quaternary Codex/Kimi dispatch (not PascalCase→Claude)", () => {
    expect(fs.existsSync(HOOK_ASSET)).toBe(true);
    const src = fs.readFileSync(HOOK_ASSET, "utf8");
    expect(src).toMatch(
      /KNOWN_PLATFORMS\s*=\s*new Set\(\[\s*"cursor"\s*,\s*"claude-code"\s*,\s*"codex"\s*,\s*"kimi-code"\s*,\s*"copilot-cli"\s*,\s*"grok-build"\s*,\s*"gemini-cli"\s*,\s*"factory-droid"\s*,?\s*\]\)/,
    );
    expect(src).toMatch(/declaredPlatform === "codex"/);
    expect(src).toMatch(/declaredPlatform === "kimi-code"/);
    expect(src).toMatch(/resolveStopHostId/);
    expect(src).toMatch(/handleCodexStop/);
    expect(src).toMatch(/handleKimiStop/);
    expect(src).toMatch(/hostId === "codex"/);
    expect(src).toMatch(/hostId === "kimi-code"/);
  });

  it("apply_patch command: Delete File + command-length cap", () => {
    expect(
      pathsFromApplyPatchCommand("*** Delete File: src/gone.ts\n"),
    ).toEqual(["src/gone.ts"]);

    const header = "*** Update File: src/visible.ts\n";
    // One oversized buffer is enough — reuse for both past-cap and in-cap cases.
    const pad = "x".repeat(MAX_APPLY_PATCH_COMMAND_CHARS);
    const pastCap = `${pad}*** Update File: src/hidden-past-cap.ts\n`;
    expect(pathsFromApplyPatchCommand(pastCap)).toEqual([]);
    expect(pathsFromApplyPatchCommand(`${header}${pad}`)).toEqual([
      "src/visible.ts",
    ]);
  });

  it("needPick filters hostile slugs and never decision:block", () => {
    const out = allowNeedPickContext("", [
      { slug: "ok-plan" },
      { slug: "../evil" },
      { slug: "bad/slug" },
      { slug: "has spaces" },
      { slug: "" },
    ]);
    expect(out.decision).toBeUndefined();
    expect(out.hookSpecificOutput?.hookEventName).toBe("UserPromptSubmit");
    const ctx = out.hookSpecificOutput?.additionalContext ?? "";
    expect(ctx).toMatch(/\bok-plan\b/);
    expect(ctx).not.toMatch(/\.\.\/evil/);
    expect(ctx).not.toMatch(/bad\/slug/);
    expect(ctx).not.toMatch(/has spaces/);

    const allHostile = allowNeedPickContext("", [
      { slug: "../evil" },
      { slug: "bad/slug" },
    ]);
    expect(allHostile.decision).toBeUndefined();
    const hostileCtx =
      allHostile.hookSpecificOutput?.additionalContext ?? "";
    expect(hostileCtx).toMatch(/Select a plan/i);
    expect(hostileCtx).not.toMatch(/\.\.\/evil/);
    expect(hostileCtx).not.toMatch(/bad\/slug/);
  });

  it("busy RUN stays Channel C (decision:block), not needPick additionalContext", () => {
    root = tmpProject();
    writeChecklist(root, "demo", `- [ ] a — A\n`);
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
      expect(store.getSession("owner")?.platform).toBe(CODEX_PLATFORM);

      const busy = handleUserPromptSubmit(
        store,
        { session_id: "peer", prompt: "/autopilot-run demo" },
        root,
      );
      expect(busy.decision).toBe("block");
      expect(busy.reason).toMatch(/already executing/i);
      expect(busy.hookSpecificOutput).toBeUndefined();
      expect(busy.continue).toBeUndefined();
      expect(Object.keys(busy).sort()).toEqual(["decision", "reason"]);
      expect(store.getSession("peer")?.phase).not.toBe("executing");
    } finally {
      store.close();
    }
  });

  it("Stop aborted status normalizes and returns halt {} (no confirm continue)", () => {
    expect(normalizeCodexStopStatus({ status: "aborted" })).toBe("aborted");
    root = tmpProject();
    writeChecklist(root, "demo", `- [ ] a — A\n`);
    const store = new StateStore(root);
    try {
      const cp = path.join(root, "plans", "demo", "checklist.md");
      store.upsertSession({
        conversation_id: "s-abort",
        project_root: root,
        code_root: root,
        phase: "executing",
        armed: 1,
        paused: 0,
        checklist_path: cp,
        track_id: "demo",
        platform: CODEX_PLATFORM,
      });
      store.updateReviewChain("s-abort", { code_edited: 1 });
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
      // Match vendor/matrix: universal abort → empty halt (not decision:block continue).
      expect(
        handleStop(eng, {
          session_id: "s-abort",
          status: "aborted",
        }),
      ).toEqual({});
    } finally {
      store.close();
    }
  });

  it("merge installs three events with --platform codex and no timeout", () => {
    const merged = mergeCodexHooks(null);
    const { missingEvents, duplicates } = summarizeCodexAutopilotHooks(merged);
    expect(missingEvents).toEqual([]);
    expect(duplicates).toBe(0);
    const raw = JSON.stringify(merged);
    expect(raw).toMatch(/UserPromptSubmit/);
    expect(raw).toMatch(/PostToolUse/);
    expect(raw).toMatch(/Stop/);
    expect(raw).toMatch(/--platform codex/);
    expect(raw).not.toMatch(/"timeout"\s*:/);
    expect(raw).toMatch(/apply_patch\|Edit\|Write/);
  });

  it("doctor: Codex OK + trust WARN; corrupt JSON FAIL; timeout <120 WARN", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "codex",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();

    const healthy = runDoctor(root);
    expect(healthy.ok).toBe(true);
    const healthyJoined = healthy.lines.join("\n");
    expect(healthyJoined).toMatch(/OK\s+\.codex\/hooks\.json Autopilot entries/);
    expect(healthyJoined).toMatch(/\/hooks trust/i);
    expect(healthyJoined).toMatch(/re-trust/i);

    const hooksPath = path.join(root, ".codex", "hooks.json");
    const file = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      hooks?: { Stop?: Array<{ hooks?: Array<{ timeout?: number }> }> };
    };
    const stopHook = file.hooks?.Stop?.[0]?.hooks?.[0];
    expect(stopHook).toBeTruthy();
    stopHook!.timeout = 30;
    fs.writeFileSync(hooksPath, JSON.stringify(file, null, 2) + "\n");
    const timed = runDoctor(root);
    expect(timed.ok).toBe(true);
    expect(timed.lines.join("\n")).toMatch(/timeout set below 120s/i);
    expect(timed.lines.join("\n")).not.toMatch(
      /OK\s+\.codex\/hooks\.json Autopilot entries/,
    );

    fs.writeFileSync(hooksPath, "{not-json", "utf8");
    const corrupt = runDoctor(root);
    expect(corrupt.ok).toBe(false);
    expect(corrupt.lines.join("\n")).toMatch(
      /FAIL\s+\.codex\/hooks\.json unreadable/i,
    );
  });

  it("add-platform codex keeps Cursor hooks and wires .codex/hooks.json", () => {
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
        platform: "codex",
        surface: "cli",
        platforms: [{ id: "codex", surface: "cli" }],
        mergePlatforms: true,
        locale: "en",
        force: true,
      }).ok,
    ).toBe(true);

    const cursor = JSON.parse(
      fs.readFileSync(path.join(root, ".cursor", "hooks.json"), "utf8"),
    ) as {
      hooks?: { beforeSubmitPrompt?: Array<{ command?: string }> };
    };
    const beforeSubmit = cursor.hooks?.beforeSubmitPrompt;
    expect(Array.isArray(beforeSubmit)).toBe(true);
    expect(
      beforeSubmit!.some(
        (h) =>
          typeof h.command === "string" &&
          h.command.includes("--platform cursor"),
      ),
    ).toBe(true);

    const codex = fs.readFileSync(
      path.join(root, ".codex", "hooks.json"),
      "utf8",
    );
    expect(codex).toMatch(/--platform codex/);
    expect(codex).not.toMatch(/"timeout"\s*:/);
    expect(fs.existsSync(path.join(root, ".codex", "skills"))).toBe(false);

    const cfg = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(cfg).toMatch(/id:\s*cursor/);
    expect(cfg).toMatch(/id:\s*codex/);
  });

  it("needPick slug cap matches MAX_NEED_PICK_SLUGS", () => {
    const many = Array.from({ length: MAX_NEED_PICK_SLUGS + 5 }, (_, i) => ({
      slug: `slug-${i}`,
    }));
    const ctx =
      allowNeedPickContext("", many).hookSpecificOutput?.additionalContext ??
      "";
    // Numbered lines — avoid /slug-0/ matching slug-10 / slug-20 / …
    expect(ctx).toMatch(/1\.\s*slug-0\b/);
    expect(ctx).toMatch(
      new RegExp(`${MAX_NEED_PICK_SLUGS}\\.\\s*slug-${MAX_NEED_PICK_SLUGS - 1}\\b`),
    );
    expect(ctx).not.toMatch(
      new RegExp(`\\bslug-${MAX_NEED_PICK_SLUGS}\\b`),
    );
  });
});
