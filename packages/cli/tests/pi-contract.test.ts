/**
 * v0.14 tests-pi-contract — umbrella matrix for Pi in-process extension I/O,
 * continue (R1 pending-only), dirty-arm (tool + R8 settle), harness-owned,
 * merge/fingerprint (extension markers + doctor leftover/incomplete).
 * Deeper suites: port-pi / pi-init-doctor / pi-vendor-wire.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ReviewEngine, StateStore } from "@autopilot-harness/core";
import {
  buildPiConversationId,
  handlePiAgentSettled,
  handlePiBeforeAgentStart,
  handlePiInput,
  handlePiStop,
  handlePiSubmit,
  handlePiToolResult,
  handlePiUserInput,
  PI_CONTINUE_CUSTOM_TYPE,
  PI_CONTINUE_DELIVER,
  PI_EDIT_TOOLS,
  PI_PLATFORM,
  PI_SOFT_MIN_VERSION,
} from "../../ports/pi/src/index.js";
import {
  buildPiConversationId as vendorBuildPiConversationId,
  handlePiAgentSettled as vendorHandlePiAgentSettled,
  handlePiBeforeAgentStart as vendorHandlePiBeforeAgentStart,
  handlePiInput as vendorHandlePiInput,
  handlePiStop as vendorHandlePiStop,
  handlePiSubmit as vendorHandlePiSubmit,
  handlePiToolResult as vendorHandlePiToolResult,
  PI_CONTINUE_CUSTOM_TYPE as vendorContinueCustomType,
  PI_CONTINUE_DELIVER as vendorContinueDeliver,
  PI_PLATFORM as vendorPiPlatform,
} from "../src/vendor-entry.js";
import {
  PI_EXTENSION_FINGERPRINTS,
  PI_EXTENSION_REL_PATH,
  piExtensionContainsAutopilot,
} from "../src/init/pi-extension.js";
import { pathResolveCwd } from "../assets/pi-extension/autopilot.ts";
import { installInitYes } from "../src/init/install.js";
import { runDoctor } from "../src/status-doctor.js";
import { uninstallProject } from "../src/uninstall.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(__dirname, "..");
const PI_EXT = path.join(cliRoot, "assets/pi-extension/autopilot.ts");
const HOOK_ASSET = path.join(cliRoot, "assets/autopilot-harness-hook.mjs");

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-pi-contract-"));
}

function writeChecklist(root: string, slug: string, body: string): string {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plan.md"), `# ${slug}\n`);
  const cp = path.join(dir, "checklist.md");
  fs.writeFileSync(cp, body);
  return cp;
}

function git(cwd: string, args: string[]): void {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
    shell: false,
  });
  if (r.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${r.stderr || r.stdout || r.status}`,
    );
  }
}

/** Real ReviewEngine for settle proofs — never omit config (fail-open hides bugs). */
function testEngine(store: StateStore, projectRoot: string): ReviewEngine {
  return new ReviewEngine(store, {
    confirmRounds: 5,
    reviewScope: "executing_only",
    verifyEnabled: false,
    verifyCommands: [],
    maxIdleStops: 5,
    maxErrorsBeforePause: 3,
    projectRoot,
    recoverDebounceMs: 0,
  });
}

describe("tests-pi-contract (v0.14)", () => {
  let root = "";

  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    root = "";
  });

  it("vendor-entry aliases Pi handlers + continue constants", () => {
    expect(vendorPiPlatform).toBe(PI_PLATFORM);
    expect(vendorPiPlatform).toBe("pi");
    expect(vendorContinueDeliver).toEqual(PI_CONTINUE_DELIVER);
    expect(vendorContinueDeliver).toEqual({
      deliverAs: "followUp",
      triggerTurn: true,
    });
    expect(vendorContinueCustomType).toBe(PI_CONTINUE_CUSTOM_TYPE);
    expect(vendorHandlePiInput).toBe(handlePiInput);
    expect(vendorHandlePiBeforeAgentStart).toBe(handlePiBeforeAgentStart);
    expect(vendorHandlePiSubmit).toBe(handlePiSubmit);
    expect(vendorHandlePiToolResult).toBe(handlePiToolResult);
    expect(vendorHandlePiAgentSettled).toBe(handlePiAgentSettled);
    expect(vendorHandlePiStop).toBe(handlePiStop);
    expect(vendorBuildPiConversationId).toBe(buildPiConversationId);
    expect(handlePiUserInput).toBe(handlePiInput);
    expect(handlePiSubmit).toBe(handlePiBeforeAgentStart);
    expect(handlePiStop).toBe(handlePiAgentSettled);
    expect(PI_SOFT_MIN_VERSION).toBe("0.85.1");
    expect([...PI_EDIT_TOOLS]).toEqual(["write", "edit"]);
  });

  it("extension asset I/O: events, vendor runtime, R1 continue, R9 no UI", () => {
    expect(fs.existsSync(PI_EXT)).toBe(true);
    const ext = fs.readFileSync(PI_EXT, "utf8");
    expect(ext).toMatch(/pi\.on\(\s*["']input["']/);
    expect(ext).toMatch(/pi\.on\(\s*["']before_agent_start["']/);
    expect(ext).toMatch(/pi\.on\(\s*["']tool_result["']/);
    expect(ext).toMatch(/pi\.on\(\s*["']agent_settled["']/);
    expect(ext).toMatch(/\.autopilot\/bin\/vendor\/runtime\.mjs/);
    expect(ext).toMatch(/handlePiAgentSettled/);
    expect(ext).toMatch(/PI_CONTINUE_DELIVER/);
    expect(ext).toMatch(/sendMessage/);
    expect(ext).toMatch(/sendUserMessage/);
    // R1: only inject when continueMessage is non-empty.
    expect(ext).toMatch(/if\s*\(\s*!continueMessage\s*\)\s*return/);
    // R2: session id / mode are on the event context, not ExtensionAPI.
    expect(ext).toMatch(/ctx\?\.sessionManager\?\.getSessionFile/);
    expect(ext).toMatch(/ctx\?\.sessionManager\?\.getSessionId/);
    expect(ext).not.toMatch(/pi\.sessionManager/);
    expect(ext).toMatch(/pi\.on\(\s*["']input["']\s*,\s*async\s*\(\s*event\s*,\s*ctx\s*\)/);
    expect(ext).toMatch(
      /pi\.on\(\s*["']before_agent_start["']\s*,\s*async\s*\(\s*event\s*,\s*ctx\s*\)/,
    );
    expect(ext).toMatch(
      /pi\.on\(\s*["']tool_result["']\s*,\s*async\s*\(\s*event\s*,\s*ctx\s*\)/,
    );
    expect(ext).toMatch(
      /pi\.on\(\s*["']agent_settled["']\s*,\s*async\s*\(\s*_?event\s*,\s*ctx\s*\)/,
    );
    // Install root is the extension file's project (.. / ..), not a later cwd.
    expect(ext).toMatch(/function extensionInstallRoot/);
    expect(ext).toMatch(/import\.meta\.url/);
    expect(ext).toMatch(/fileURLToPath/);
    expect(ext).toMatch(/basename\(extDir\) !== ["']extensions["']/);
    expect(ext).toMatch(/basename\(piDir\) !== ["']\.pi["']/);
    expect(ext).toMatch(/if \(fromFile\) return fromFile/);
    expect(ext).not.toMatch(/vendorPresent/);
    expect(ext).toMatch(/ensureRuntime\s*\(\s*\)/);
    expect(ext).toMatch(/function eventMode\s*\(\s*ctx\s*\)/);
    expect(ext).not.toMatch(/maybeAdoptCtxRoot/);
    expect(ext).not.toMatch(/eventMode\s*\(\s*ctx\s*,\s*pi\s*\)/);
    expect(ext).not.toMatch(/eventRoot\s*\(/);
    expect(ext).not.toMatch(/pi\?\.mode/);
    // Relative write/edit paths follow ctx.cwd only when it stays in the install root.
    expect(ext).toMatch(/function pathResolveCwd/);
    expect(ext).toMatch(/cwd:\s*pathResolveCwd\(ctx,\s*projectRoot\)/);
    expect(ext).toMatch(/isDirectory\(\)/);
    // R9: no blocking UI calls on continue path (comment may mention ctx.ui).
    const settledIdx = ext.search(/pi\.on\(\s*["']agent_settled["']/);
    expect(settledIdx).toBeGreaterThanOrEqual(0);
    const settledHandler = ext.slice(settledIdx);
    expect(settledHandler).not.toMatch(
      /\b(?:ctx|pi)\.ui\.(?:confirm|select|input|ask)\b/,
    );
    expect(ext).not.toMatch(/pi install/i);
    for (const fp of PI_EXTENSION_FINGERPRINTS) {
      expect(ext).toContain(fp);
    }
    expect(piExtensionContainsAutopilot(ext)).toBe(true);
  });

  it("pathResolveCwd stays inside the install root and rejects non-directories", () => {
    root = tmpProject();
    const sub = path.join(root, "pkg");
    fs.mkdirSync(sub, { recursive: true });
    const file = path.join(root, "note.txt");
    fs.writeFileSync(file, "x\n");
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-pi-outside-"));
    const sibling = `${root}-evil`;
    fs.mkdirSync(sibling, { recursive: true });
    try {
      const realRoot = fs.realpathSync(root);
      expect(pathResolveCwd({}, realRoot)).toBe(realRoot);
      expect(pathResolveCwd({ cwd: "  " }, realRoot)).toBe(realRoot);
      expect(pathResolveCwd({ cwd: sub }, realRoot)).toBe(fs.realpathSync(sub));
      expect(pathResolveCwd({ cwd: file }, realRoot)).toBe(realRoot);
      expect(pathResolveCwd({ cwd: outside }, realRoot)).toBe(realRoot);
      expect(pathResolveCwd({ cwd: sibling }, realRoot)).toBe(realRoot);
      expect(pathResolveCwd({ cwd: sub }, "")).toBe("");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
      fs.rmSync(sibling, { recursive: true, force: true });
    }
  });

  it("R7: shell stamp --platform pi aborts before FSM", () => {
    const r = spawnSync(
      process.execPath,
      [HOOK_ASSET, "--event", "beforeSubmitPrompt", "--platform", "pi"],
      {
        input: JSON.stringify({ prompt: "hello" }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(r.status).toBe(0);
    expect((r.stdout ?? "").trim()).toBe("{}");
  });

  it("I/O: harness-owned input; submit ON; R1 no continue without pending", () => {
    root = tmpProject();
    const store = new StateStore(root);
    const engine = testEngine(store, root);
    try {
      const owned = handlePiInput(
        store,
        {
          text: "Autopilot ON",
          source: "extension",
          sessionId: "own-1",
          mode: "tui",
        },
        root,
      );
      expect(owned.harnessOwned).toBe(true);
      expect(store.getSession("pi:own-1")).toBeNull();

      const follow = handlePiInput(
        store,
        {
          text: "Review fix round 1 — keep going",
          source: "interactive",
          sessionId: "own-2",
          mode: "tui",
        },
        root,
      );
      expect(follow.harnessOwned).toBe(true);

      const on = handlePiBeforeAgentStart(
        store,
        {
          prompt: "Autopilot ON · contract brief",
          sessionId: "io-on",
          mode: "tui",
        },
        root,
      );
      expect(on.message).toBeUndefined();
      expect(store.getSession("pi:io-on")?.platform).toBe(PI_PLATFORM);
      expect(store.getSession("pi:io-on")?.phase).toBe("planning");

      // R1: idle planning settle → no continueMessage (must not rely on fail-open).
      const idle = handlePiAgentSettled(
        engine,
        store,
        { sessionId: "io-on", mode: "tui" },
        root,
      );
      expect(idle.continueMessage).toBeUndefined();
      expect(Object.keys(idle)).toEqual([]);
      expect(store.getReviewChain("pi:io-on")?.chain_pending ?? 0).toBe(0);
    } finally {
      store.close();
    }
  });

  it("continue: loop:true yields message; loop:false / empty message does not", () => {
    root = tmpProject();
    const store = new StateStore(root);
    const cid = "pi:loop-gate";
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: PI_PLATFORM,
      phase: "executing",
    });
    try {
      expect(
        handlePiAgentSettled(
          {
            handleStop: () => ({ message: "x", loop: false }),
          } as unknown as ReviewEngine,
          store,
          { sessionId: "loop-gate", mode: "tui" },
          root,
        ).continueMessage,
      ).toBeUndefined();

      expect(
        handlePiAgentSettled(
          {
            handleStop: () => ({ message: "", loop: true }),
          } as unknown as ReviewEngine,
          store,
          { sessionId: "loop-gate", mode: "tui" },
          root,
        ).continueMessage,
      ).toBeUndefined();

      expect(
        handlePiAgentSettled(
          {
            handleStop: () => ({ message: "   \n\t  ", loop: true }),
          } as unknown as ReviewEngine,
          store,
          { sessionId: "loop-gate", mode: "tui" },
          root,
        ).continueMessage,
      ).toBeUndefined();

      expect(
        handlePiAgentSettled(
          {
            handleStop: () => ({
              message: "Review fix round 1 — keep going",
              loop: true,
            }),
          } as unknown as ReviewEngine,
          store,
          { sessionId: "loop-gate", mode: "tui" },
          root,
        ).continueMessage,
      ).toMatch(/^Review fix round/);
    } finally {
      store.close();
    }
  });

  it("harness-owned before_agent_start does not clear chain_pending", () => {
    root = tmpProject();
    const store = StateStore.openMemory(root);
    const cid = "pi:harness-pending";
    const cp = writeChecklist(root, "trk", "- [ ] x — X\n");
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      phase: "executing",
      track_id: "trk",
      checklist_path: cp,
      platform: PI_PLATFORM,
    });
    store.updateReviewChain(cid, {
      chain_pending: 1,
      pending_followup: "Review fix round 1 — keep going",
    });
    try {
      handlePiBeforeAgentStart(
        store,
        {
          prompt: "Review fix round 1 — keep going",
          sessionId: "harness-pending",
          mode: "tui",
        },
        root,
      );
      expect(store.getReviewChain(cid)?.chain_pending).toBe(1);
      expect(store.getReviewChain(cid)?.pending_followup).toMatch(/Review fix/);
    } finally {
      store.close();
    }
  });

  it("dirty-arm: write/edit product arms; plans/** and bash do not", () => {
    root = tmpProject();
    const store = new StateStore(root);
    const src = path.join(root, "src");
    fs.mkdirSync(src, { recursive: true });
    const product = path.join(src, "a.ts");
    fs.writeFileSync(product, "export const x = 1;\n");
    const plansFile = writeChecklist(root, "demo", "- [ ] item-a — A\n");
    try {
      handlePiBeforeAgentStart(
        store,
        { prompt: "Autopilot RUN demo", sessionId: "arm-1", mode: "tui" },
        root,
      );
      const cid = "pi:arm-1";

      handlePiToolResult(
        store,
        {
          toolName: "write",
          input: { path: product },
          sessionId: "arm-1",
          cwd: root,
        },
        root,
      );
      expect(store.getReviewChain(cid)?.code_edited).toBe(1);

      store.updateReviewChain(cid, { code_edited: 0 });
      handlePiToolResult(
        store,
        {
          toolName: "edit",
          input: { path: product },
          sessionId: "arm-1",
          cwd: root,
        },
        root,
      );
      expect(store.getReviewChain(cid)?.code_edited).toBe(1);

      store.updateReviewChain(cid, { code_edited: 0 });
      handlePiToolResult(
        store,
        {
          toolName: "write",
          input: { path: plansFile },
          sessionId: "arm-1",
          cwd: root,
        },
        root,
      );
      expect(store.getReviewChain(cid)?.code_edited ?? 0).toBe(0);

      handlePiToolResult(
        store,
        {
          toolName: "bash",
          input: { path: product },
          sessionId: "arm-1",
          cwd: root,
        },
        root,
      );
      expect(store.getReviewChain(cid)?.code_edited ?? 0).toBe(0);
    } finally {
      store.close();
    }
  });

  it("R8: agent_settled dirty-tree arms fix continue (bash-only edit)", () => {
    root = tmpProject();
    git(root, ["init"]);
    git(root, ["config", "user.email", "pi-contract@example.com"]);
    git(root, ["config", "user.name", "Pi Contract"]);
    fs.mkdirSync(path.join(root, "packages"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "packages", "x.ts"),
      "export const n = 1;\n",
    );
    fs.writeFileSync(
      path.join(root, ".autopilotignore"),
      "plans/**\n.autopilot/**\n",
    );
    git(root, ["add", "-A"]);
    git(root, ["commit", "-m", "init"]);

    const cp = writeChecklist(
      root,
      "dirty-demo",
      "- [ ] item-a — First\n- [ ] item-b — Second\n",
    );
    // Shell-style write (no tool_result): dirties product vs HEAD.
    fs.writeFileSync(
      path.join(root, "packages", "x.ts"),
      "export const n = 2;\n",
    );

    const store = StateStore.openMemory(root);
    const cid = "pi:dirty-settle";
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      phase: "executing",
      track_id: "dirty-demo",
      checklist_path: cp,
      platform: PI_PLATFORM,
      armed: 1,
    });
    store.ensureReviewChain(cid);
    store.updateReviewChain(cid, {
      confirm_left: null,
      chain_pending: 0,
      code_edited: 0,
      fix_round: 0,
      item_confirm_complete: 0,
    });
    try {
      const engine = testEngine(store, root);
      const out = handlePiAgentSettled(
        engine,
        store,
        { sessionId: "dirty-settle", mode: "tui" },
        root,
      );
      expect(out.continueMessage).toBeTruthy();
      expect(out.continueMessage).toMatch(
        /Review fix|自审修复|fix round|keep going/i,
      );
      const chain = store.getReviewChain(cid)!;
      expect(chain.chain_pending).toBe(1);
      expect(chain.fix_round).toBeGreaterThan(0);
      expect(chain.pending_followup).toBeTruthy();
    } finally {
      store.close();
    }
  });

  it("merge/fingerprint: incomplete FAIL; leftover WARN; fingerprint uninstall", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [{ id: "pi", surface: "cli" }],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const extPath = path.join(root, ".pi", "extensions", "autopilot.ts");
    expect(piExtensionContainsAutopilot(fs.readFileSync(extPath, "utf8"))).toBe(
      true,
    );

    // Incomplete fingerprint (file present, markers gone).
    fs.writeFileSync(extPath, "// not autopilot\n", "utf8");
    const incomplete = runDoctor(root);
    expect(incomplete.ok).toBe(false);
    expect(incomplete.lines.join("\n")).toMatch(
      new RegExp(
        `FAIL\\s+${PI_EXTENSION_REL_PATH.replace(/\./g, "\\.")} Autopilot fingerprint incomplete`,
      ),
    );

    // Restore healthy extension via force init, then drop pi from platforms.
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [{ id: "pi", surface: "cli" }],
        locale: "en",
        force: true,
      }).ok,
    ).toBe(true);
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [{ id: "cursor", surface: "ide" }],
        locale: "en",
        force: true,
        mergePlatforms: true,
      }).ok,
    ).toBe(true);

    const cfgPath = path.join(root, ".autopilot", "config.yml");
    const before = fs.readFileSync(cfgPath, "utf8");
    expect(before).toMatch(/^\s*-\s*id:\s*pi\s*$/m);
    // Init defaults put `integration:` immediately after platforms — anchor on it.
    expect(before).toMatch(/\nintegration:\s/);
    const cfg = before.replace(
      /platforms:[\s\S]*?(?=\nintegration:)/,
      "platforms:\n  - id: cursor\n    surface: ide\n",
    );
    fs.writeFileSync(cfgPath, cfg, "utf8");
    const after = fs.readFileSync(cfgPath, "utf8");
    expect(after).not.toMatch(/^\s*-\s*id:\s*pi\s*$/m);
    expect(after).toMatch(/^\s*-\s*id:\s*cursor\s*$/m);

    expect(fs.existsSync(extPath)).toBe(true);
    expect(piExtensionContainsAutopilot(fs.readFileSync(extPath, "utf8"))).toBe(
      true,
    );
    const leftoverDoc = runDoctor(root);
    expect(leftoverDoc.lines.join("\n")).toMatch(
      new RegExp(
        `WARN\\s+leftover ${PI_EXTENSION_REL_PATH.replace(/\./g, "\\.")} Autopilot fingerprint`,
      ),
    );

    // Fingerprint uninstall (pi not in platforms) still removes extension.
    const un = uninstallProject({ projectRoot: root, dryRun: false });
    expect(un.ok).toBe(true);
    expect(fs.existsSync(extPath)).toBe(false);
  });

  it("merge/fingerprint: Pi + Antigravity dual WARN; PATH tip when pi missing", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [
          { id: "pi", surface: "cli" },
          { id: "antigravity", surface: "cli" },
        ],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const prev = process.env.PATH;
    try {
      process.env.PATH = "/nonexistent-pi-bin-dir";
      const doc = runDoctor(root);
      const text = doc.lines.join("\n");
      expect(text).toMatch(
        /WARN\s+Pi \+ Antigravity both enabled — shared \.agents\/skills/i,
      );
      expect(text).toMatch(
        /WARN\s+pi CLI not found on PATH[\s\S]*soft min/i,
      );
      expect(text).toMatch(
        new RegExp(`OK\\s+${PI_EXTENSION_REL_PATH.replace(/\./g, "\\.")}`),
      );
      expect(fs.existsSync(path.join(root, ".agents", "hooks.json"))).toBe(
        true,
      );
      expect(
        fs.existsSync(
          path.join(root, ".agents", "skills", "autopilot-on", "SKILL.md"),
        ),
      ).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.PATH;
      else process.env.PATH = prev;
    }
  });
});
