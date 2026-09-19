/**
 * v0.15 matrix-host — eleven-way shell:
 * - `KNOWN_PLATFORMS` includes `devin` (no `pi` / no `runner`)
 * - Devin stamp on non-Devin events → empty-stdout abort before FSM
 * - prior ten shell hosts do not go red when Devin is also installed
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { StateStore } from "@autopilot-harness/core";
import { DEVIN_PLATFORM } from "@autopilot-harness/port-devin";
import { ANTIGRAVITY_HOOKS_REL_PATH } from "../src/init/antigravity-hooks-merge.js";
import { COPILOT_HOOKS_REL_PATH } from "../src/init/copilot-hooks-merge.js";
import {
  DEVIN_HOOKS_REL_PATH,
  hasCompleteDevinAutopilotHooks,
} from "../src/init/devin-hooks-merge.js";
import { FACTORY_HOOKS_REL_PATH } from "../src/init/factory-hooks-merge.js";
import { GEMINI_SETTINGS_REL_PATH } from "../src/init/gemini-settings-merge.js";
import { GROK_HOOKS_REL_PATH } from "../src/init/grok-hooks-merge.js";
import { hermesConfigYamlPath } from "../src/init/hermes-hooks-merge.js";
import { commandHasPlatformStamp } from "../src/init/hooks-merge.js";
import { kimiConfigTomlPath } from "../src/init/kimi-hooks-merge.js";
import { installInitYes } from "../src/init/install.js";
import { runDoctor } from "../src/status-doctor.js";

type ShellHostId =
  | "cursor"
  | "claude-code"
  | "codex"
  | "kimi-code"
  | "copilot-cli"
  | "grok-build"
  | "gemini-cli"
  | "factory-droid"
  | "hermes-agent"
  | "antigravity"
  | "devin";

const PRIOR_TEN: readonly Exclude<ShellHostId, "devin">[] = [
  "cursor",
  "claude-code",
  "codex",
  "kimi-code",
  "copilot-cli",
  "grok-build",
  "gemini-cli",
  "factory-droid",
  "hermes-agent",
  "antigravity",
] as const;

const ELEVEN_SHELL: readonly ShellHostId[] = [...PRIOR_TEN, "devin"] as const;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK_ASSET = path.resolve(
  __dirname,
  "../assets/autopilot-harness-hook.mjs",
);

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-eleven-host-"));
}

function isSuiteTempHome(p: string): boolean {
  if (!p || !path.isAbsolute(p)) return false;
  let resolved: string;
  let tmpRoot: string;
  try {
    resolved = fs.realpathSync(p);
    tmpRoot = fs.realpathSync(os.tmpdir());
  } catch {
    return false;
  }
  return resolved.startsWith(tmpRoot + path.sep);
}

/** Delete a suite temp dir. Never follow a symlink (realpath can sit under tmp). */
function rmSuiteTemp(dir: string): void {
  if (!dir || !isSuiteTempHome(dir)) return;
  let st: fs.Stats;
  try {
    st = fs.lstatSync(dir);
  } catch {
    return;
  }
  if (st.isSymbolicLink() || !st.isDirectory()) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

function hookPath(root: string): string {
  return path.join(root, ".autopilot", "bin", "autopilot-harness-hook.mjs");
}

function runHook(
  root: string,
  event: string,
  payload: Record<string, unknown>,
  platform?: string,
): {
  status: number | null;
  out: Record<string, unknown>;
  stdout: string;
  stderr: string;
} {
  const args = [hookPath(root)];
  if (platform) args.push("--platform", platform);
  args.push("--event", event);
  const proc = spawnSync(process.execPath, args, {
    cwd: root,
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: 15_000,
    env: { ...process.env, DEVIN_PROJECT_DIR: root },
  });
  if (proc.error) throw proc.error;
  if (proc.status == null) {
    throw new Error(
      `eleven-host hook spawn killed: event=${event} platform=${platform ?? "(none)"} signal=${proc.signal}`,
    );
  }
  const stdout = proc.stdout ?? "";
  const stderr = proc.stderr ?? "";
  let out: Record<string, unknown> = {};
  try {
    out = JSON.parse(stdout.trim() || "{}") as Record<string, unknown>;
  } catch {
    out = { __parse_error: stdout };
  }
  return { status: proc.status, out, stdout, stderr };
}

/** Devin cross-stamp abort: empty allow stdout (never JSON `{}`). */
function expectDevinGateAbort(r: {
  status: number | null;
  out: Record<string, unknown>;
  stdout: string;
  stderr: string;
}): void {
  expect(r.status).toBe(0);
  expect(r.stderr.trim()).toBe("");
  expect(r.out.__parse_error).toBeUndefined();
  expect(r.stdout).toBe("");
  expect(r.stdout.trim()).not.toBe("{}");
  expect(r.out).toEqual({});
  expect(r.out.decision).toBeUndefined();
  expect(r.out.continue).toBeUndefined();
  expect(r.out.reason).toBeUndefined();
  expect(r.out.hookSpecificOutput).toBeUndefined();
  expect(r.out.injectSteps).toBeUndefined();
}

function withStore<T>(root: string, fn: (store: StateStore) => T): T {
  const store = new StateStore(root);
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

/** Prior ten shell hosts + Devin. */
function installElevenShell(
  root: string,
  homes: { kimiHome: string; hermesHome: string },
): void {
  if (!root || !isSuiteTempHome(root)) {
    throw new Error("installElevenShell requires tmp projectRoot");
  }
  if (
    !homes.kimiHome ||
    !isSuiteTempHome(homes.kimiHome) ||
    process.env.KIMI_CODE_HOME !== homes.kimiHome
  ) {
    throw new Error("KIMI_CODE_HOME must be suite temp");
  }
  if (
    !homes.hermesHome ||
    !isSuiteTempHome(homes.hermesHome) ||
    process.env.HERMES_HOME !== homes.hermesHome
  ) {
    throw new Error("HERMES_HOME must be suite temp");
  }
  const cursorInstall = installInitYes({
    projectRoot: root,
    platform: "cursor",
    surface: "ide",
    locale: "en",
    force: false,
  });
  expect(cursorInstall.ok, cursorInstall.ok ? "" : cursorInstall.error).toBe(
    true,
  );
  for (const [platform, surface] of [
    ["claude-code", "cli"],
    ["codex", "cli"],
    ["kimi-code", "cli"],
    ["copilot-cli", "cli"],
    ["grok-build", "cli"],
    ["gemini-cli", "cli"],
    ["factory-droid", "cli"],
    ["hermes-agent", "cli"],
    ["antigravity", "cli"],
    ["devin", "cli"],
  ] as const) {
    const r = installInitYes({
      projectRoot: root,
      platform,
      surface,
      platforms: [{ id: platform, surface }],
      mergePlatforms: true,
      locale: "en",
      force: true,
    });
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
  }
}

describe("eleven-host Devin cross-fire matrix (v0.15)", () => {
  let root = "";
  let kimiHome = "";
  let hermesHome = "";
  let prevKimiHome: string | undefined;
  let prevHermesHome: string | undefined;
  let touchedKimi = false;
  let touchedHermes = false;

  afterEach(() => {
    if (touchedKimi) {
      if (prevKimiHome === undefined) delete process.env.KIMI_CODE_HOME;
      else process.env.KIMI_CODE_HOME = prevKimiHome;
    }
    if (touchedHermes) {
      if (prevHermesHome === undefined) delete process.env.HERMES_HOME;
      else process.env.HERMES_HOME = prevHermesHome;
    }
    for (const dir of [kimiHome, hermesHome, root]) {
      rmSuiteTemp(dir);
    }
    root = "";
    kimiHome = "";
    hermesHome = "";
    prevKimiHome = undefined;
    prevHermesHome = undefined;
    touchedKimi = false;
    touchedHermes = false;
  });

  function withKimiHome(): void {
    const next = fs.mkdtempSync(path.join(os.tmpdir(), "ap-11-kimi-"));
    if (!isSuiteTempHome(next)) {
      throw new Error(`withKimiHome refused non-suite path: ${next}`);
    }
    if (!touchedKimi) {
      prevKimiHome = process.env.KIMI_CODE_HOME;
      touchedKimi = true;
    }
    const previous = kimiHome;
    kimiHome = next;
    process.env.KIMI_CODE_HOME = next;
    if (previous && previous !== next) rmSuiteTemp(previous);
  }

  function withHermesHome(): void {
    const next = fs.mkdtempSync(path.join(os.tmpdir(), "ap-11-hermes-"));
    if (!isSuiteTempHome(next)) {
      throw new Error(`withHermesHome refused non-suite path: ${next}`);
    }
    if (!touchedHermes) {
      prevHermesHome = process.env.HERMES_HOME;
      touchedHermes = true;
    }
    const previous = hermesHome;
    hermesHome = next;
    process.env.HERMES_HOME = next;
    if (previous && previous !== next) rmSuiteTemp(previous);
  }

  it("suite temp guard refuses the temp root, its parent, and non-paths", () => {
    const tmpRoot = fs.realpathSync(os.tmpdir());
    expect(isSuiteTempHome(tmpRoot)).toBe(false);
    expect(isSuiteTempHome(os.tmpdir())).toBe(false);
    expect(isSuiteTempHome(path.dirname(tmpRoot))).toBe(false);
    expect(isSuiteTempHome("")).toBe(false);
    expect(isSuiteTempHome("relative/not-absolute")).toBe(false);

    const outside = path.dirname(tmpRoot);
    expect(isSuiteTempHome(outside)).toBe(false);
    const outsideBefore = fs.lstatSync(outside);
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "ap-11-guard-"));
    try {
      const link = path.join(scratch, "link");
      const dangling = path.join(scratch, "dangling");
      fs.symlinkSync(outside, link);
      fs.symlinkSync(path.join(outside, "no-such-ap-11-target"), dangling);
      expect(isSuiteTempHome(link)).toBe(false);
      expect(isSuiteTempHome(dangling)).toBe(false);
      expect(isSuiteTempHome(scratch)).toBe(true);
    } finally {
      let st: fs.Stats | undefined;
      try {
        st = fs.lstatSync(scratch);
      } catch {
        st = undefined;
      }
      if (
        st &&
        !st.isSymbolicLink() &&
        st.isDirectory() &&
        isSuiteTempHome(scratch)
      ) {
        try {
          fs.rmSync(scratch, { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
      }
    }
    let scratchGoneCode: string | undefined;
    try {
      fs.lstatSync(scratch);
    } catch (err) {
      scratchGoneCode = (err as NodeJS.ErrnoException).code;
    }
    expect(scratchGoneCode).toBe("ENOENT");
    const outsideAfter = fs.lstatSync(outside);
    expect(outsideAfter.dev).toBe(outsideBefore.dev);
    expect(outsideAfter.ino).toBe(outsideBefore.ino);
  });

  it("shipped hook is eleven-way shell with devin; NON_SHELL stays pi+runner", () => {
    const src = fs.readFileSync(HOOK_ASSET, "utf8");
    const known = src.match(
      /KNOWN_PLATFORMS\s*=\s*new Set\(\[([\s\S]*?)\]\)/,
    );
    expect(known).toBeTruthy();
    const ids = [...(known?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(11);
    expect(ids).toEqual([...ELEVEN_SHELL]);
    expect(ids).toContain("devin");
    expect(ids).not.toContain("pi");
    expect(ids).not.toContain("runner");
    expect(src).toMatch(
      /NON_SHELL_PLATFORMS\s*=\s*new Set\(\[\s*"pi"\s*,\s*"runner"\s*\]\)/,
    );
    expect(src).toMatch(/hostId === "devin" && !DEVIN_EVENTS\.has\(event\)/);
    expect(DEVIN_PLATFORM).toBe("devin");
  });

  it(
    "install eleven shell: Devin hooks present; doctor OK; prior hosts not red",
    () => {
      root = tmpProject();
      withKimiHome();
      withHermesHome();
      installElevenShell(root, { kimiHome, hermesHome });

      const hooksPath = path.join(root, DEVIN_HOOKS_REL_PATH);
      expect(fs.existsSync(hooksPath)).toBe(true);
      const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as Record<
        string,
        unknown
      >;
      expect(hasCompleteDevinAutopilotHooks(hooks)).toBe(true);
      const hooksRaw = fs.readFileSync(hooksPath, "utf8");
      expect(commandHasPlatformStamp(hooksRaw, "devin")).toBe(true);
      expect(hooksRaw).toMatch(/\$DEVIN_PROJECT_DIR/);
      expect(hooksRaw).not.toMatch(/claude-code/);
      expect(fs.existsSync(path.join(root, ".devin", "config.json"))).toBe(
        false,
      );
      expect(fs.existsSync(path.join(root, ".devin", "skills"))).toBe(true);

      const priorHookFiles = [
        path.join(root, ".cursor", "hooks.json"),
        path.join(root, ".claude", "settings.json"),
        path.join(root, ".codex", "hooks.json"),
        kimiConfigTomlPath(kimiHome),
        path.join(root, COPILOT_HOOKS_REL_PATH),
        path.join(root, GROK_HOOKS_REL_PATH),
        path.join(root, GEMINI_SETTINGS_REL_PATH),
        path.join(root, FACTORY_HOOKS_REL_PATH),
        hermesConfigYamlPath(hermesHome),
        path.join(root, ANTIGRAVITY_HOOKS_REL_PATH),
      ];
      for (const file of priorHookFiles) {
        expect(fs.existsSync(file), file).toBe(true);
        const body = fs.readFileSync(file, "utf8");
        expect(commandHasPlatformStamp(body, "devin"), file).toBe(false);
      }

      const cfg = fs.readFileSync(
        path.join(root, ".autopilot", "config.yml"),
        "utf8",
      );
      for (const id of ELEVEN_SHELL) {
        expect(cfg).toMatch(new RegExp(`^\\s*-\\s*id:\\s*${id}\\s*$`, "m"));
      }

      const doc = runDoctor(root, {
        kimiCodeHome: kimiHome,
        hermesHome,
      });
      expect(doc.ok).toBe(true);
      const text = doc.lines.join("\n");
      // Line-start only — Devin tip copy contains "(not a FAIL)".
      expect(text).not.toMatch(/^FAIL\b/m);
      expect(text).toMatch(
        new RegExp(
          `OK\\s+${DEVIN_HOOKS_REL_PATH.replace(/\./g, "\\.")} Autopilot entries`,
        ),
      );
      expect(text).toMatch(/OK\s+hooks\.json Autopilot entries/);
      expect(text).toMatch(/OK\s+\.claude\/settings\.json Autopilot entries/);
      expect(text).toMatch(/OK\s+\.codex\/hooks\.json Autopilot entries/);
      expect(text).toMatch(/OK\s+Kimi Code config\.toml Autopilot entries/);
      expect(text).toMatch(
        /OK\s+\.github\/hooks\/autopilot-harness\.json Autopilot entries/,
      );
      expect(text).toMatch(
        /OK\s+\.grok\/hooks\/autopilot-harness\.json Autopilot entries/,
      );
      expect(text).toMatch(/OK\s+\.gemini\/settings\.json Autopilot entries/);
      expect(text).toMatch(
        new RegExp(
          `OK\\s+${FACTORY_HOOKS_REL_PATH.replace(/\./g, "\\.")} Autopilot entries`,
        ),
      );
      expect(text).toMatch(/OK\s+Hermes config\.yaml Autopilot entries/);
      expect(text).toMatch(
        new RegExp(
          `OK\\s+${ANTIGRAVITY_HOOKS_REL_PATH.replace(/\./g, "\\.")} Autopilot entries`,
        ),
      );
    },
    90_000,
  );

  it("Devin stamp on foreign events aborts empty; no state.db on fresh tree", () => {
    root = tmpProject();
    const installed = installInitYes({
      projectRoot: root,
      platforms: [
        { id: "cursor", surface: "ide" },
        { id: "devin", surface: "cli" },
      ],
      locale: "en",
      force: false,
    });
    expect(installed.ok, installed.ok ? "" : installed.error).toBe(true);
    expect(fs.existsSync(hookPath(root))).toBe(true);

    const dbPath = path.join(root, ".autopilot", "state.db");
    expect(fs.existsSync(dbPath)).toBe(false);

    const foreign: Array<{ event: string; payload: Record<string, unknown> }> =
      [
        {
          event: "beforeSubmitPrompt",
          payload: { conversation_id: "xf", prompt: "x" },
        },
        {
          event: "afterFileEdit",
          payload: { conversation_id: "xf", file_path: "src/x.ts", cwd: root },
        },
        {
          event: "stop",
          payload: { conversation_id: "xf", status: "completed", loop_count: 0 },
        },
        {
          event: "PreInvocation",
          payload: {
            conversationId: "xf-agy",
            workspacePaths: [root],
            transcriptPath: path.join(root, "t.jsonl"),
          },
        },
        {
          event: "BeforeAgent",
          payload: { sessionId: "xf-gem", prompt: "x" },
        },
        {
          event: "AfterTool",
          payload: {
            sessionId: "xf-gem",
            toolName: "write_file",
            toolInput: { file_path: "src/x.ts" },
          },
        },
        {
          event: "AfterAgent",
          payload: {
            sessionId: "xf-gem",
            hook_event_name: "AfterAgent",
            stop_hook_active: false,
          },
        },
        {
          event: "userPromptSubmitted",
          payload: { sessionId: "xf-copilot", prompt: "x" },
        },
        {
          event: "userPromptTransformed",
          payload: { sessionId: "xf-copilot", prompt: "x" },
        },
        {
          event: "postToolUse",
          payload: {
            sessionId: "xf-copilot",
            toolName: "edit",
            tool_input: { path: "src/x.ts" },
          },
        },
        {
          event: "agentStop",
          payload: {
            conversation_id: "xf-copilot",
            status: "completed",
            loop_count: 0,
          },
        },
        {
          event: "StopFailure",
          payload: { session_id: "xf-claude" },
        },
        {
          event: "pre_llm_call",
          payload: {
            session_id: "xf-hermes",
            extra: { user_message: "x" },
            cwd: root,
          },
        },
        {
          event: "post_tool_call",
          payload: {
            session_id: "xf-hermes",
            tool_name: "write_file",
            tool_input: { path: "src/x.ts" },
            cwd: root,
          },
        },
        {
          event: "pre_verify",
          payload: {
            session_id: "xf-hermes",
            extra: { attempt: 0, coding: true },
            cwd: root,
          },
        },
      ];

    for (const { event, payload } of foreign) {
      const r = runHook(root, event, payload, DEVIN_PLATFORM);
      expectDevinGateAbort(r);
    }
    expect(fs.existsSync(dbPath)).toBe(false);
    expect(fs.existsSync(`${dbPath}-wal`)).toBe(false);
    expect(fs.existsSync(`${dbPath}-shm`)).toBe(false);

    // Shared Pascal names under Devin stamp are native (not the empty gate).
    // Empty stdout alone cannot distinguish gate abort from idle allow — FSM must
    // open state.db (foreign aborts above leave it absent).
    const nativeUps = runHook(
      root,
      "UserPromptSubmit",
      { session_id: "xf-devin-native-ups", prompt: "hello" },
      DEVIN_PLATFORM,
    );
    expect(nativeUps.status).toBe(0);
    expect(nativeUps.stdout).toBe("");
    expect(nativeUps.out.decision).toBeUndefined();
    expect(nativeUps.out.hookSpecificOutput).toBeUndefined();
    expect(fs.existsSync(dbPath)).toBe(true);

    // Prior host path still works after Devin foreign aborts (no poison).
    const cursor = runHook(
      root,
      "beforeSubmitPrompt",
      { conversation_id: "xf-cursor-ok", prompt: "hello" },
      "cursor",
    );
    expect(cursor.status).toBe(0);
    expect(cursor.out.continue).toBe(true);
  });

  it("prior unique-event gates stay host-shaped when Devin is co-installed", () => {
    root = tmpProject();
    const installed = installInitYes({
      projectRoot: root,
      platforms: [
        { id: "cursor", surface: "ide" },
        { id: "devin", surface: "cli" },
      ],
      locale: "en",
      force: false,
    });
    expect(installed.ok, installed.ok ? "" : installed.error).toBe(true);

    const dbPath = path.join(root, ".autopilot", "state.db");
    expect(fs.existsSync(dbPath)).toBe(false);

    // Antigravity unique under a non-Antigravity stamp → JSON {} (not Devin empty).
    // kimi-code and factory-droid Silence is zero-byte; the gate must still be {}.
    for (const platform of [
      "cursor",
      "claude-code",
      "kimi-code",
      "factory-droid",
    ] as const) {
      const r = runHook(
        root,
        "PreInvocation",
        {
          conversationId: `rev-agy-${platform}`,
          workspacePaths: [root],
          transcriptPath: path.join(root, "t.jsonl"),
        },
        platform,
      );
      expect(r.status).toBe(0);
      expect(r.stderr.trim()).toBe("");
      expect(r.stdout.trim()).toBe("{}");
      expect(r.out).toEqual({});
      expect(r.out.decision).toBeUndefined();
      expect(r.out.injectSteps).toBeUndefined();
    }

    // Hermes unique under Cursor stamp → JSON {} (Hermes gate), never Devin empty.
    const hermesXf = runHook(
      root,
      "pre_llm_call",
      {
        session_id: "rev-hermes",
        extra: { user_message: "x" },
        cwd: root,
      },
      "cursor",
    );
    expect(hermesXf.status).toBe(0);
    expect(hermesXf.stdout.trim()).toBe("{}");
    expect(hermesXf.out).toEqual({});
    expect(hermesXf.out.decision).toBeUndefined();

    // Gemini unique under Cursor stamp → {} (Gemini gate), never Devin empty.
    const gemXf = runHook(
      root,
      "BeforeAgent",
      { sessionId: "rev-gem", prompt: "x" },
      "cursor",
    );
    expect(gemXf.status).toBe(0);
    expect(gemXf.stdout.trim()).toBe("{}");
    expect(gemXf.out).toEqual({});
    expect(gemXf.out.decision).toBeUndefined();

    // Wrong-stamp unique gates must abort before FSM / state.db.
    expect(fs.existsSync(dbPath)).toBe(false);
    expect(fs.existsSync(`${dbPath}-wal`)).toBe(false);
    expect(fs.existsSync(`${dbPath}-shm`)).toBe(false);
  });

  it(
    "Devin stamp + unique foreign events do not mutate armed prior-host sessions",
    () => {
      root = tmpProject();
      withKimiHome();
      withHermesHome();
      installElevenShell(root, { kimiHome, hermesHome });

      const cid = "eleven-devin-cross-aaaa-bbbb-cccc-ddddeeee0001";
      withStore(root, (store) => {
        store.upsertSession({
          conversation_id: cid,
          project_root: root,
          code_root: root,
          platform: "cursor",
          phase: "executing",
          armed: 1,
          paused: 0,
          track_id: "demo",
        });
        store.ensureReviewChain(cid);
        store.updateReviewChain(cid, {
          chain_pending: 1,
          pending_followup: "Review fix round 1 — keep going",
          code_edited: 0,
          fix_round: 1,
        });
      });

      const pendingBefore = withStore(
        root,
        (s) => s.getReviewChain(cid)?.pending_followup ?? "",
      );
      expect(pendingBefore).toMatch(/Review fix round 1/);

      const dbPath = path.join(root, ".autopilot", "state.db");
      const mtimeBefore = fs.statSync(dbPath).mtimeMs;

      // Unique / non-Devin events only. Shared UserPromptSubmit|PostToolUse|Stop
      // under --platform devin are native routes (not this empty gate).
      for (const event of [
        "beforeSubmitPrompt",
        "afterFileEdit",
        "stop",
        "PreInvocation",
        "BeforeAgent",
        "AfterTool",
        "AfterAgent",
        "userPromptSubmitted",
        "userPromptTransformed",
        "postToolUse",
        "pre_llm_call",
        "post_tool_call",
        "pre_verify",
        "StopFailure",
        "agentStop",
      ] as const) {
        const r = runHook(
          root,
          event,
          {
            conversation_id: cid,
            session_id: cid,
            sessionId: cid,
            conversationId: cid,
            prompt: "hostile",
            status: "completed",
            workspacePaths: [root],
            toolName: "edit",
            tool_name: "write_file",
            tool_input: { path: "src/x.ts" },
            toolInput: { file_path: "src/x.ts" },
            extra: { user_message: "hostile", attempt: 0, coding: true },
            hook_event_name: "AfterAgent",
            stop_hook_active: false,
          },
          DEVIN_PLATFORM,
        );
        expectDevinGateAbort(r);
      }

      expect(fs.statSync(dbPath).mtimeMs).toBe(mtimeBefore);
      expect(fs.existsSync(`${dbPath}-wal`)).toBe(false);
      expect(fs.existsSync(`${dbPath}-shm`)).toBe(false);

      withStore(root, (after) => {
        expect(after.getSession(cid)?.platform).toBe("cursor");
        expect(after.getSession(cid)?.phase).toBe("executing");
        expect(after.getSession(cid)?.armed).toBe(1);
        expect(after.getSession(cid)?.paused).toBe(0);
        expect(after.getReviewChain(cid)?.chain_pending).toBe(1);
        expect(after.getReviewChain(cid)?.pending_followup).toBe(pendingBefore);
        expect(after.getReviewChain(cid)?.fix_round).toBe(1);
        expect(after.getReviewChain(cid)?.code_edited).toBe(0);
      });
    },
    90_000,
  );

  it(
    "prior ten shell hosts non-regress when Devin is installed",
    () => {
      root = tmpProject();
      withKimiHome();
      withHermesHome();
      installElevenShell(root, { kimiHome, hermesHome });

      const ids: Record<Exclude<ShellHostId, "devin">, string> = {
        cursor: "e11-sub-aaaa-bbbb-cccc-ddddeeee0010",
        "claude-code": "e11-sub-aaaa-bbbb-cccc-ddddeeee0011",
        codex: "e11-sub-aaaa-bbbb-cccc-ddddeeee0012",
        "kimi-code": "e11-sub-aaaa-bbbb-cccc-ddddeeee0013",
        "copilot-cli": "e11-sub-aaaa-bbbb-cccc-ddddeeee0014",
        "grok-build": "e11-sub-aaaa-bbbb-cccc-ddddeeee0015",
        "gemini-cli": "e11-sub-aaaa-bbbb-cccc-ddddeeee0016",
        "factory-droid": "e11-sub-aaaa-bbbb-cccc-ddddeeee0017",
        "hermes-agent": "e11-sub-aaaa-bbbb-cccc-ddddeeee0018",
        antigravity: "e11-sub-aaaa-bbbb-cccc-ddddeeee0019",
      };
      const devinCid = "e11-sub-aaaa-bbbb-cccc-ddddeeee0020";

      withStore(root, (seed) => {
        for (const platform of PRIOR_TEN) {
          seed.upsertSession({
            conversation_id: ids[platform],
            project_root: root,
            code_root: root,
            platform,
            phase: "idle",
            armed: 0,
            paused: 0,
            track_id: "_pending",
          });
        }
        seed.upsertSession({
          conversation_id: devinCid,
          project_root: root,
          code_root: root,
          platform: DEVIN_PLATFORM,
          phase: "idle",
          armed: 0,
          paused: 0,
          track_id: "_pending",
        });
      });

      const cursor = runHook(
        root,
        "beforeSubmitPrompt",
        { conversation_id: ids.cursor, prompt: "hello cursor" },
        "cursor",
      );
      expect(cursor.status).toBe(0);
      expect(cursor.out.continue).toBe(true);

      const claude = runHook(
        root,
        "UserPromptSubmit",
        { session_id: ids["claude-code"], prompt: "hello claude" },
        "claude-code",
      );
      expect(claude.status).toBe(0);
      expect(claude.out.decision).toBeUndefined();

      const codex = runHook(
        root,
        "UserPromptSubmit",
        { session_id: ids.codex, prompt: "hello codex" },
        "codex",
      );
      expect(codex.status).toBe(0);
      expect(codex.out.decision).toBeUndefined();

      const kimi = runHook(
        root,
        "UserPromptSubmit",
        { session_id: ids["kimi-code"], prompt: "hello kimi" },
        "kimi-code",
      );
      expect(kimi.status).toBe(0);
      expect(kimi.stdout.length).toBe(0);

      const copilot = runHook(
        root,
        "userPromptSubmitted",
        { sessionId: ids["copilot-cli"], prompt: "hello copilot" },
        "copilot-cli",
      );
      expect(copilot.status).toBe(0);
      expect(copilot.stdout.trim()).toBe("{}");

      const grok = runHook(
        root,
        "UserPromptSubmit",
        { session_id: ids["grok-build"], prompt: "hello grok" },
        "grok-build",
      );
      expect(grok.status).toBe(0);
      expect(grok.stdout.trim()).toBe("{}");

      const gem = runHook(
        root,
        "BeforeAgent",
        { sessionId: ids["gemini-cli"], prompt: "hello gemini" },
        "gemini-cli",
      );
      expect(gem.status).toBe(0);
      expect(gem.stdout.trim()).toBe("{}");

      const factory = runHook(
        root,
        "UserPromptSubmit",
        { session_id: ids["factory-droid"], prompt: "hello factory" },
        "factory-droid",
      );
      expect(factory.status).toBe(0);
      expect(factory.stdout.length).toBe(0);

      const hermes = runHook(
        root,
        "pre_llm_call",
        {
          session_id: ids["hermes-agent"],
          extra: { user_message: "hello hermes" },
        },
        "hermes-agent",
      );
      expect(hermes.status).toBe(0);
      expect(hermes.stdout.trim()).toBe("{}");

      const transcriptPath = path.join(root, "t.jsonl");
      fs.writeFileSync(
        transcriptPath,
        `${JSON.stringify({ USER_INPUT: "hello antigravity" })}\n`,
      );
      const agy = runHook(
        root,
        "PreInvocation",
        {
          conversationId: ids.antigravity,
          transcriptPath,
          workspacePaths: [root],
        },
        "antigravity",
      );
      expect(agy.status).toBe(0);
      expect(agy.stdout.trim()).toBe("{}");

      const devin = runHook(
        root,
        "UserPromptSubmit",
        { session_id: devinCid, prompt: "hello devin" },
        DEVIN_PLATFORM,
      );
      expect(devin.status).toBe(0);
      expect(devin.stdout).toBe("");
      expect(devin.stdout.trim()).not.toBe("{}");
      expect(devin.out.decision).toBeUndefined();
      expect(devin.out.hookSpecificOutput).toBeUndefined();

      withStore(root, (s) => {
        for (const platform of PRIOR_TEN) {
          const row = s.getSession(ids[platform]);
          expect(row?.platform).toBe(platform);
          expect(row?.phase).toBe("idle");
          expect(row?.armed).toBe(0);
          expect(row?.paused).toBe(0);
        }
        const d = s.getSession(devinCid);
        expect(d?.platform).toBe(DEVIN_PLATFORM);
        expect(d?.phase).toBe("idle");
        expect(d?.armed).toBe(0);
      });
    },
    90_000,
  );
});
