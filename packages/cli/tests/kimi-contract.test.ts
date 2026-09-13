/**
 * v0.4 tests-kimi-contract — umbrella matrix for Kimi I/O, Stop exit2,
 * needPick (Channel A), toml merge / fingerprint uninstall, doctor WARN,
 * add-platform, quaternary dispatch + aliased exports.
 * Deeper suites live in port-kimi / kimi-hooks-merge / hook-vendor /
 * status-doctor / uninstall.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ReviewEngine, StateStore, loadProjectReviewConfig } from "@autopilot-harness/core";
import {
  allowNeedPickContext,
  handleStop,
  handleUserPromptSubmit,
  KIMI_PLATFORM,
  MAX_NEED_PICK_SLUGS,
  normalizeKimiStopStatus,
} from "../../ports/kimi-code/src/index.js";
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
  kimiAutopilotMissingHookEvents,
  mergeKimiConfigToml,
  removeAutopilotKimiHooks,
} from "../src/init/kimi-hooks-merge.js";
import { installInitYes } from "../src/init/install.js";
import { runDoctor } from "../src/status-doctor.js";
import { uninstallProject } from "../src/uninstall.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK_ASSET = path.resolve(
  __dirname,
  "../assets/autopilot-harness-hook.mjs",
);

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-kimi-contract-"));
}

function writeChecklist(root: string, slug: string, body: string): void {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plan.md"), `# ${slug}\n`);
  fs.writeFileSync(path.join(dir, "checklist.md"), body);
}

describe("kimi contract matrix", () => {
  let root = "";
  let kimiHome = "";
  let prevKimiHome: string | undefined;
  afterEach(() => {
    // Only restore env when this test actually swapped KIMI_CODE_HOME.
    if (kimiHome) {
      if (prevKimiHome === undefined) delete process.env.KIMI_CODE_HOME;
      else process.env.KIMI_CODE_HOME = prevKimiHome;
      prevKimiHome = undefined;
      fs.rmSync(kimiHome, { recursive: true, force: true });
      kimiHome = "";
    }
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = "";
  });

  it("vendor-entry aliases Kimi handlers without colliding with Claude/Codex bare names", () => {
    expect(handleKimiUserPromptSubmit).toBeTypeOf("function");
    expect(handleKimiPostToolUse).toBeTypeOf("function");
    expect(handleKimiStop).toBeTypeOf("function");
    expect(handleKimiUserPromptSubmit).not.toBe(handleClaudeUserPromptSubmit);
    expect(handleKimiPostToolUse).not.toBe(handleClaudePostToolUse);
    expect(handleKimiStop).not.toBe(handleClaudeStop);
    expect(handleKimiUserPromptSubmit).not.toBe(handleCodexUserPromptSubmit);
    expect(handleKimiPostToolUse).not.toBe(handleCodexPostToolUse);
    expect(handleKimiStop).not.toBe(handleCodexStop);
  });

  it("shipped hook asset keeps quaternary Kimi dispatch (exit2 path, not Claude JSON)", () => {
    expect(fs.existsSync(HOOK_ASSET)).toBe(true);
    const src = fs.readFileSync(HOOK_ASSET, "utf8");
    expect(src).toMatch(
      /KNOWN_PLATFORMS\s*=\s*new Set\(\[\s*"cursor"\s*,\s*"claude-code"\s*,\s*"codex"\s*,\s*"kimi-code"\s*,\s*"copilot-cli"\s*,?\s*\]\)/,
    );
    expect(src).toMatch(/declaredPlatform === "kimi-code"/);
    expect(src).toMatch(/resolveStopHostId/);
    expect(src).toMatch(/handleKimiStop/);
    expect(src).toMatch(/hostId === "kimi-code"/);
    expect(src).toMatch(/exitCode\s*===\s*2/);
  });

  it("I/O: needPick is Channel A (exit 0 + stdout); filters hostile slugs", () => {
    const out = allowNeedPickContext("", [
      { slug: "ok-plan" },
      { slug: "../evil" },
      { slug: "bad/slug" },
      { slug: "has spaces" },
      { slug: "" },
    ]);
    expect(out.exitCode).toBe(0);
    expect(out.stderr).toBeUndefined();
    expect(out.stdout ?? "").toMatch(/\bok-plan\b/);
    expect(out.stdout ?? "").not.toMatch(/\.\.\/evil/);
    expect(out.stdout ?? "").not.toMatch(/bad\/slug/);
    expect(out.stdout ?? "").not.toMatch(/has spaces/);
    expect(Object.keys(out).sort()).toEqual(["exitCode", "stdout"]);

    const many = Array.from({ length: MAX_NEED_PICK_SLUGS + 5 }, (_, i) => ({
      slug: `slug-${i}`,
    }));
    const ctx = allowNeedPickContext("", many).stdout ?? "";
    expect(ctx).toMatch(/(?:^|\n)\s*1\.\s*slug-0\b/);
    expect(ctx).toMatch(
      new RegExp(
        `(?:^|\\n)\\s*${MAX_NEED_PICK_SLUGS}\\.\\s*slug-${MAX_NEED_PICK_SLUGS - 1}\\b`,
      ),
    );
    expect(ctx).not.toMatch(new RegExp(`\\bslug-${MAX_NEED_PICK_SLUGS}\\b`));
  });

  it("needPick bare RUN uses exit 0 + stdout (not decision:block JSON)", () => {
    root = tmpProject();
    writeChecklist(root, "alpha", `- [ ] a — A\n`);
    writeChecklist(root, "beta", `- [ ] b — B\n`);
    const store = new StateStore(root);
    try {
      const out = handleUserPromptSubmit(
        store,
        { session_id: "pick1", prompt: "/autopilot-run" },
        root,
      );
      expect(out.exitCode).toBe(0);
      expect(out.stderr).toBeUndefined();
      expect(out.stdout).toMatch(/\balpha\b/);
      expect(out.stdout).toMatch(/\bbeta\b/);
      expect("decision" in out).toBe(false);
      expect(Object.keys(out).sort()).toEqual(["exitCode", "stdout"]);
      expect(JSON.stringify(out)).not.toMatch(/"decision"\s*:\s*"block"/);
    } finally {
      store.close();
    }
  });

  it("busy RUN stays exit 2 + stderr (not needPick stdout / Claude JSON block)", () => {
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
      ).toEqual({ exitCode: 0 });
      expect(store.getSession("owner")?.phase).toBe("executing");
      expect(store.getSession("owner")?.platform).toBe(KIMI_PLATFORM);

      const busy = handleUserPromptSubmit(
        store,
        { session_id: "peer", prompt: "/autopilot-run demo" },
        root,
      );
      expect(busy.exitCode).toBe(2);
      expect(busy.stderr).toMatch(/already executing/i);
      expect(busy.stdout).toBeUndefined();
      expect("decision" in busy).toBe(false);
      expect(Object.keys(busy).sort()).toEqual(["exitCode", "stderr"]);
      expect(busy.stderr).not.toMatch(/"decision"\s*:\s*"block"/);
      // Owner keeps the one_executor lease; busy rolls back after ensureSession.
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

  it("Stop continue is exit 2 + stderr; aborted halt is exit 0 (no Claude JSON)", () => {
    expect(normalizeKimiStopStatus({ status: "aborted" })).toBe("aborted");
    root = tmpProject();
    writeChecklist(root, "demo", `- [ ] a — A\n`);
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
        platform: KIMI_PLATFORM,
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
        session_id: "s-cont",
        stop_hook_active: false,
      });
      expect(cont.exitCode).toBe(2);
      expect(cont.stderr).toBeTruthy();
      expect(cont.stdout).toBeUndefined();
      expect("decision" in cont).toBe(false);
      expect(Object.keys(cont).sort()).toEqual(["exitCode", "stderr"]);
      expect(cont.stderr).not.toMatch(/"decision"\s*:\s*"block"/);

      // Separate session: abort must hard-stop with exit 0 (not continue / Claude JSON).
      store.upsertSession({
        conversation_id: "s-abort",
        project_root: root,
        code_root: root,
        phase: "executing",
        armed: 1,
        paused: 0,
        checklist_path: cp,
        track_id: "demo",
        platform: KIMI_PLATFORM,
      });
      store.updateReviewChain("s-abort", { code_edited: 1 });
      expect(
        handleStop(eng, {
          session_id: "s-abort",
          status: "aborted",
        }),
      ).toEqual({ exitCode: 0 });
    } finally {
      store.close();
    }
  });

  it("toml merge stamps three events with timeout ≥120; fingerprint uninstall keeps foreign", () => {
    const merged = mergeKimiConfigToml(null);
    expect(kimiAutopilotMissingHookEvents(merged)).toEqual([]);
    expect(merged).toMatch(/UserPromptSubmit/);
    expect(merged).toMatch(/PostToolUse/);
    expect(merged).toMatch(/Stop/);
    expect(merged).toMatch(/--platform kimi-code/);
    expect(merged).toMatch(/timeout\s*=\s*120\b/);

    const withForeign = `${merged}\n[[hooks]]\nevent = "Notification"\ncommand = "echo keep-foreign"\ntimeout = 5\n`;
    const stripped = removeAutopilotKimiHooks(withForeign);
    expect(stripped).not.toMatch(/autopilot-harness-hook\.mjs/);
    expect(stripped).toMatch(/echo keep-foreign/);
    expect(stripped).toMatch(/event\s*=\s*"Notification"/);
  });

  it("doctor: Kimi Stop≤1 WARN + prefer confirm_rounds:1; missing hooks WARN", () => {
    root = tmpProject();
    prevKimiHome = process.env.KIMI_CODE_HOME;
    kimiHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-kimi-doc-c-"));
    process.env.KIMI_CODE_HOME = kimiHome;
    expect(
      installInitYes({
        projectRoot: root,
        platform: "kimi-code",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();

    const healthy = runDoctor(root, { kimiCodeHome: kimiHome });
    expect(healthy.ok).toBe(true);
    const joined = healthy.lines.join("\n");
    expect(joined).toMatch(/Stop-continue.*≤1|≤1\/turn/i);
    expect(joined).toMatch(/prefer confirm_rounds:\s*1/);
    expect(joined).toMatch(/OK\s+Kimi Code config\.toml Autopilot entries/);
    expect(joined).not.toMatch(/review\.confirm_rounds is \d+/);

    // Pre-clamp YAML >1 must surface the dedicated WARN (runtime still clamps).
    const cfgPath = path.join(root, ".autopilot", "config.yml");
    const yaml = fs.readFileSync(cfgPath, "utf8");
    expect(yaml).toMatch(/confirm_rounds:\s*1\b/);
    fs.writeFileSync(
      cfgPath,
      yaml.replace(/confirm_rounds:\s*\d+/, "confirm_rounds: 5"),
      "utf8",
    );
    const highConfirm = runDoctor(root, { kimiCodeHome: kimiHome });
    expect(highConfirm.ok).toBe(true);
    expect(highConfirm.lines.join("\n")).toMatch(
      /review\.confirm_rounds is 5 but Kimi Stop-continue[\s\S]*runtime clamps to 1/i,
    );
    expect(loadProjectReviewConfig(root).confirmRounds).toBe(1);

    fs.writeFileSync(path.join(kimiHome, "config.toml"), "model = \"x\"\n", "utf8");
    const missing = runDoctor(root, { kimiCodeHome: kimiHome });
    expect(missing.ok).toBe(true);
    expect(missing.lines.join("\n")).toMatch(
      /WARN\s+Kimi Code config\.toml missing Autopilot/i,
    );
  });

  it("add-platform kimi-code keeps Cursor hooks and wires user-home config.toml", () => {
    root = tmpProject();
    prevKimiHome = process.env.KIMI_CODE_HOME;
    kimiHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-kimi-add-c-"));
    process.env.KIMI_CODE_HOME = kimiHome;
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
        platform: "kimi-code",
        surface: "cli",
        platforms: [{ id: "kimi-code", surface: "cli" }],
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

    const toml = fs.readFileSync(path.join(kimiHome, "config.toml"), "utf8");
    expect(toml).toMatch(/--platform kimi-code/);
    expect(toml).toMatch(/timeout\s*=\s*120\b/);
    expect(fs.existsSync(path.join(root, ".kimi-code"))).toBe(false);
    expect(fs.existsSync(path.join(kimiHome, "local.toml"))).toBe(false);

    const cfg = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(cfg).toMatch(/id:\s*cursor/);
    expect(cfg).toMatch(/id:\s*kimi-code/);
    // add-platform preserves Cursor's confirm_rounds:5 in YAML; runtime clamps to 1.
    expect(cfg).toMatch(/confirm_rounds:\s*5/);
    expect(loadProjectReviewConfig(root).confirmRounds).toBe(1);
  });

  it("fingerprint uninstall drops Autopilot [[hooks]] and keeps foreign tables", () => {
    root = tmpProject();
    prevKimiHome = process.env.KIMI_CODE_HOME;
    kimiHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-kimi-un-c-"));
    process.env.KIMI_CODE_HOME = kimiHome;
    expect(
      installInitYes({
        projectRoot: root,
        platform: "kimi-code",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const tomlPath = path.join(kimiHome, "config.toml");
    fs.appendFileSync(
      tomlPath,
      `\n[[hooks]]\nevent = "Notification"\ncommand = "echo keep-kimi"\ntimeout = 5\n`,
      "utf8",
    );
    const r = uninstallProject({ projectRoot: root });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(
      r.actions.some((a) => /Kimi Code config\.toml|KIMI_CODE_HOME/i.test(a)),
    ).toBe(true);
    const after = fs.readFileSync(tomlPath, "utf8");
    expect(after).not.toMatch(/autopilot-harness-hook\.mjs/);
    expect(after).toMatch(/echo keep-kimi/);
    expect(fs.existsSync(path.join(kimiHome, "local.toml"))).toBe(false);
  });
});
