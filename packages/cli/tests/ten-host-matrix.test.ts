/**
 * Ten-host matrix: Antigravity ↔ Cursor/Claude/Codex/Kimi/Copilot/Grok/Gemini/
 * Factory/Hermes cross-fire. Wrong stamp / wrong payload → abort before FSM.
 *
 * Antigravity-unique `PreInvocation` under a non-Antigravity --platform always
 * emits JSON `{}` (Silence) before FSM. Shared `PostToolUse` / `Stop` follow the
 * stamp host (not this early gate). Antigravity stamp + non-Antigravity events
 * likewise `{}`. Prior nine hosts must not go red when Antigravity is also enabled.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StateStore } from "@autopilot-harness/core";
import {
  ANTIGRAVITY_AUTOPILOT_EVENTS,
  ANTIGRAVITY_HOOK_TIMEOUT_SEC,
  ANTIGRAVITY_HOOKS_REL_PATH,
  ANTIGRAVITY_POST_TOOL_USE_MATCHER,
  antigravityHooksHavePlatformStamp,
  hasCompleteAntigravityAutopilotHooks,
} from "../src/init/antigravity-hooks-merge.js";
import { FACTORY_HOOKS_REL_PATH } from "../src/init/factory-hooks-merge.js";
import {
  HERMES_AUTOPILOT_EVENTS,
  hermesConfigYamlPath,
  hermesHooksHavePlatformStamp,
  hasCompleteHermesAutopilotHooks,
  parseHermesConfigYaml,
} from "../src/init/hermes-hooks-merge.js";
import { installInitYes } from "../src/init/install.js";
import { runDoctor } from "../src/status-doctor.js";
import { ANTIGRAVITY_PLATFORM } from "../../ports/antigravity/src/index.js";
import { HERMES_PLATFORM } from "../../ports/hermes-agent/src/index.js";

type HostId =
  | "cursor"
  | "claude-code"
  | "codex"
  | "kimi-code"
  | "copilot-cli"
  | "grok-build"
  | "gemini-cli"
  | "factory-droid"
  | "hermes-agent"
  | "antigravity";

const ALL_HOSTS: readonly HostId[] = [
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

const PRIOR_NINE: readonly Exclude<HostId, "antigravity">[] = [
  "cursor",
  "claude-code",
  "codex",
  "kimi-code",
  "copilot-cli",
  "grok-build",
  "gemini-cli",
  "factory-droid",
  "hermes-agent",
] as const;

const AGY_EVENTS = ["PreInvocation", "PostToolUse", "Stop"] as const;

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-ten-host-"));
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
  });
  if (proc.error) {
    throw proc.error;
  }
  if (proc.status == null) {
    throw new Error(
      `ten-host hook spawn killed: event=${event} platform=${platform ?? "(none)"} signal=${proc.signal}`,
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

/** Antigravity Silence / early-gate abort: JSON `{}` or `{}\n`. */
function expectAntigravityGateAbort(r: {
  status: number | null;
  out: Record<string, unknown>;
  stdout: string;
  stderr: string;
}): void {
  expect(r.status).toBe(0);
  expect(r.stderr.trim()).toBe("");
  expect(r.out.__parse_error).toBeUndefined();
  expect(["{}", "{}\n"]).toContain(r.stdout);
  expect(r.out).toEqual({});
  expect(r.out.decision).toBeUndefined();
  expect(r.out.context).toBeUndefined();
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

function seedChecklist(root: string, slug = "demo"): string {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  const cp = path.join(dir, "checklist.md");
  fs.writeFileSync(path.join(dir, "plan.md"), `# ${slug}\n`);
  fs.writeFileSync(cp, "- [ ] a — A\n- [ ] b — B\n");
  return cp;
}

/** True when `p` resolves under `os.tmpdir()` (blocks real ~/.hermes / ~/.kimi). */
function isSuiteTempHome(p: string): boolean {
  if (!p || !path.isAbsolute(p)) return false;
  let resolved: string;
  let tmpRoot: string;
  try {
    resolved = fs.realpathSync(p);
  } catch {
    resolved = path.resolve(p);
  }
  try {
    tmpRoot = fs.realpathSync(os.tmpdir());
  } catch {
    tmpRoot = path.resolve(os.tmpdir());
  }
  return resolved === tmpRoot || resolved.startsWith(tmpRoot + path.sep);
}

function agyPreInvocationPayload(
  cid: string,
  root: string,
  transcriptPath: string,
): Record<string, unknown> {
  return {
    conversationId: cid,
    transcriptPath,
    workspacePaths: [root],
  };
}

/** Ten hosts: prior nine + Antigravity. */
function installTenHost(
  root: string,
  homes: { kimiHome: string; hermesHome: string },
): void {
  if (!root || !isSuiteTempHome(root)) {
    throw new Error(
      "installTenHost requires projectRoot under os.tmpdir() (call tmpProject first)",
    );
  }
  const kimi = process.env.KIMI_CODE_HOME;
  const hermes = process.env.HERMES_HOME;
  if (
    !homes.kimiHome ||
    !isSuiteTempHome(homes.kimiHome) ||
    kimi !== homes.kimiHome
  ) {
    throw new Error(
      "installTenHost requires process.env.KIMI_CODE_HOME === suite temp (call withKimiHome first)",
    );
  }
  if (
    !homes.hermesHome ||
    !isSuiteTempHome(homes.hermesHome) ||
    hermes !== homes.hermesHome
  ) {
    throw new Error(
      "installTenHost requires process.env.HERMES_HOME === suite temp (call withHermesHome first)",
    );
  }
  expect(
    installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    }).ok,
  ).toBe(true);
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
  ] as const) {
    expect(
      installInitYes({
        projectRoot: root,
        platform,
        surface,
        platforms: [{ id: platform, surface }],
        mergePlatforms: true,
        locale: "en",
        force: true,
      }).ok,
    ).toBe(true);
  }
}

describe("ten-host Antigravity cross-fire matrix", () => {
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
      if (dir && isSuiteTempHome(dir) && fs.existsSync(dir)) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
      }
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
    const next = fs.mkdtempSync(path.join(os.tmpdir(), "ap-ten-kimi-"));
    if (!isSuiteTempHome(next)) {
      throw new Error(`withKimiHome refused non-suite path: ${next}`);
    }
    const previous = kimiHome;
    if (!touchedKimi) {
      prevKimiHome = process.env.KIMI_CODE_HOME;
      touchedKimi = true;
    }
    kimiHome = next;
    process.env.KIMI_CODE_HOME = next;
    if (
      previous &&
      previous !== next &&
      isSuiteTempHome(previous) &&
      fs.existsSync(previous)
    ) {
      try {
        fs.rmSync(previous, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  }

  function withHermesHome(): void {
    const next = fs.mkdtempSync(path.join(os.tmpdir(), "ap-ten-hermes-"));
    if (!isSuiteTempHome(next)) {
      throw new Error(`withHermesHome refused non-suite path: ${next}`);
    }
    const previous = hermesHome;
    if (!touchedHermes) {
      prevHermesHome = process.env.HERMES_HOME;
      touchedHermes = true;
    }
    hermesHome = next;
    process.env.HERMES_HOME = next;
    if (
      previous &&
      previous !== next &&
      isSuiteTempHome(previous) &&
      fs.existsSync(previous)
    ) {
      try {
        fs.rmSync(previous, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  }

  it("ten install stamps all hosts; doctor stays ok for prior nine + Antigravity", () => {
    root = tmpProject();
    withKimiHome();
    withHermesHome();
    installTenHost(root, { kimiHome, hermesHome });

    const cursorHooks = JSON.parse(
      fs.readFileSync(path.join(root, ".cursor", "hooks.json"), "utf8"),
    ) as { hooks: Record<string, { command: string }[]> };
    for (const event of ["beforeSubmitPrompt", "afterFileEdit", "stop"]) {
      const ap = cursorHooks.hooks[event]?.filter((h) =>
        h.command.includes("autopilot-harness"),
      );
      expect(ap?.length).toBe(1);
      expect(ap![0].command).toMatch(/--platform cursor(?:\s|$)/);
    }

    expect(
      fs.readFileSync(path.join(root, FACTORY_HOOKS_REL_PATH), "utf8"),
    ).toMatch(/--platform factory-droid/);

    const cfgPath = hermesConfigYamlPath(hermesHome);
    expect(fs.existsSync(cfgPath)).toBe(true);
    const hermesCfg = parseHermesConfigYaml(fs.readFileSync(cfgPath, "utf8"));
    expect(hasCompleteHermesAutopilotHooks(hermesCfg)).toBe(true);
    expect(hermesHooksHavePlatformStamp(hermesCfg)).toBe(true);
    expect(HERMES_AUTOPILOT_EVENTS.length).toBeGreaterThan(0);

    const agyRaw = fs.readFileSync(
      path.join(root, ANTIGRAVITY_HOOKS_REL_PATH),
      "utf8",
    );
    const agyHooks = JSON.parse(agyRaw) as Record<string, unknown>;
    expect(hasCompleteAntigravityAutopilotHooks(agyHooks)).toBe(true);
    expect(antigravityHooksHavePlatformStamp(agyHooks)).toBe(true);
    expect(ANTIGRAVITY_AUTOPILOT_EVENTS).toEqual([...AGY_EVENTS]);
    expect(ANTIGRAVITY_HOOK_TIMEOUT_SEC).toBe(120);
    expect(ANTIGRAVITY_POST_TOOL_USE_MATCHER).toMatch(/write_to_file/);
    expect(agyRaw).toMatch(/--platform antigravity(?:\s|$)/);
    expect(agyRaw).toMatch(/"timeout"\s*:\s*120/);
    expect(fs.existsSync(path.join(root, ".agent"))).toBe(false);

    const ignore = fs.readFileSync(path.join(root, ".autopilotignore"), "utf8");
    expect(ignore).toMatch(/\.agents\/hooks\.json/);
    expect(ignore).toMatch(/\.agents\/skills\/\*\*/);

    const cfg = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    for (const id of ALL_HOSTS) {
      expect(cfg).toMatch(new RegExp(`^\\s*-\\s*id:\\s*${id}\\s*$`, "m"));
    }

    const { ok, lines } = runDoctor(root, {
      kimiCodeHome: kimiHome,
      hermesHome,
    });
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).not.toMatch(/\bFAIL\b/);
    expect(joined).toMatch(/OK\s+hooks\.json Autopilot entries/);
    expect(joined).toMatch(/OK\s+\.claude\/settings\.json Autopilot entries/);
    expect(joined).toMatch(/OK\s+\.codex\/hooks\.json Autopilot entries/);
    expect(joined).toMatch(/OK\s+Kimi Code config\.toml Autopilot entries/);
    expect(joined).toMatch(
      /OK\s+\.github\/hooks\/autopilot-harness\.json Autopilot entries/,
    );
    expect(joined).toMatch(
      /OK\s+\.grok\/hooks\/autopilot-harness\.json Autopilot entries/,
    );
    expect(joined).toMatch(/OK\s+\.gemini\/settings\.json Autopilot entries/);
    expect(joined).toMatch(
      new RegExp(
        `OK\\s+${FACTORY_HOOKS_REL_PATH.replace(/\./g, "\\.")} Autopilot entries`,
      ),
    );
    expect(joined).toMatch(/OK\s+Hermes config\.yaml Autopilot entries/);
    expect(joined).toMatch(
      new RegExp(
        `OK\\s+${ANTIGRAVITY_HOOKS_REL_PATH.replace(/\./g, "\\.")} Autopilot entries`,
      ),
    );
  });

  it(
    "Antigravity PreInvocation + wrong --platform → JSON {} abort; no session steal",
    () => {
      root = tmpProject();
      withKimiHome();
      withHermesHome();
      installTenHost(root, { kimiHome, hermesHome });
      seedChecklist(root);
      const transcriptDir = path.join(root, "logs");
      fs.mkdirSync(transcriptDir, { recursive: true });
      const transcriptPath = path.join(transcriptDir, "transcript.jsonl");
      fs.writeFileSync(transcriptPath, "");
      const stateDb = path.join(root, ".autopilot", "state.db");
      expect(fs.existsSync(stateDb)).toBe(false);

      // Early gate must not open FSM db, and must emit JSON {} even for hosts
      // whose normal Silence is empty (kimi-code / factory-droid).
      for (const [i, platform] of (
        ["cursor", "kimi-code", "factory-droid"] as const
      ).entries()) {
        const freshCid = `ten-wrong-fresh-PreInvocation-000${i}`;
        const fresh = runHook(
          root,
          "PreInvocation",
          agyPreInvocationPayload(freshCid, root, transcriptPath),
          platform,
        );
        expectAntigravityGateAbort(fresh);
        expect(fs.existsSync(stateDb)).toBe(false);
      }

      // PreInvocation is Antigravity-unique; PostToolUse/Stop are shared and
      // follow the stamp host (not this early {} gate).
      for (const platform of PRIOR_NINE) {
        const cid = `ten-wrong-${platform}-PreInvocation-0001`;
        expect(withStore(root, (s) => s.getSession(cid))).toBeNull();

        const r = runHook(
          root,
          "PreInvocation",
          agyPreInvocationPayload(cid, root, transcriptPath),
          platform,
        );
        expectAntigravityGateAbort(r);
        expect(withStore(root, (s) => s.getSession(cid))).toBeNull();
      }
    },
    90_000,
  );

  it("Antigravity stamp + foreign events → {} abort; pending_followup untouched", () => {
    root = tmpProject();
    withKimiHome();
    withHermesHome();
    installTenHost(root, { kimiHome, hermesHome });
    const cp = seedChecklist(root);
    const cid = "ten-agy-park-aaaa-bbbb-cccc-ddddeeee0001";
    withStore(root, (store) => {
      store.upsertSession({
        conversation_id: cid,
        project_root: root,
        code_root: root,
        platform: ANTIGRAVITY_PLATFORM,
        phase: "executing",
        armed: 1,
        paused: 0,
        track_id: "demo",
        checklist_path: cp,
        reviewing_item_id: "a",
      });
      store.updateReviewChain(cid, {
        code_edited: 1,
        chain_pending: 1,
        pending_followup: "park tip ten",
      });
    });

    const foreign: Array<{ event: string; payload: Record<string, unknown> }> =
      [
        {
          event: "UserPromptSubmit",
          payload: { session_id: cid, prompt: "hostile ups" },
        },
        {
          event: "beforeSubmitPrompt",
          payload: { conversation_id: cid, prompt: "hostile cursor" },
        },
        {
          event: "afterFileEdit",
          payload: {
            conversation_id: cid,
            file_path: "src/x.ts",
            cwd: root,
          },
        },
        {
          event: "stop",
          payload: {
            conversation_id: cid,
            status: "completed",
            loop_count: 0,
          },
        },
        {
          event: "BeforeAgent",
          payload: { sessionId: cid, prompt: "hostile before-agent" },
        },
        {
          event: "AfterTool",
          payload: {
            sessionId: cid,
            toolName: "write_file",
            toolInput: { file_path: "src/x.ts" },
          },
        },
        {
          event: "AfterAgent",
          payload: {
            sessionId: cid,
            hook_event_name: "AfterAgent",
            stop_hook_active: false,
          },
        },
        {
          event: "userPromptSubmitted",
          payload: { sessionId: cid, prompt: "hostile copilot" },
        },
        {
          event: "postToolUse",
          payload: {
            sessionId: cid,
            toolName: "edit",
            tool_input: { path: "src/x.ts" },
          },
        },
        {
          event: "agentStop",
          payload: {
            conversation_id: cid,
            status: "aborted",
            loop_count: 0,
          },
        },
        {
          event: "StopFailure",
          payload: { session_id: cid },
        },
        {
          event: "pre_llm_call",
          payload: {
            session_id: cid,
            user_message: "hostile hermes",
            cwd: root,
          },
        },
        {
          event: "post_tool_call",
          payload: {
            session_id: cid,
            tool_name: "write_file",
            tool_input: { path: "src/x.ts" },
            cwd: root,
          },
        },
        {
          event: "pre_verify",
          payload: {
            session_id: cid,
            extra: { attempt: 0, coding: true },
            cwd: root,
          },
        },
      ];

    for (const { event, payload } of foreign) {
      const before = withStore(root, (s) => ({
        tip: s.getReviewChain(cid)?.pending_followup ?? null,
        pending: s.getReviewChain(cid)?.chain_pending ?? 0,
        edited: s.getReviewChain(cid)?.code_edited ?? 0,
        plat: s.getSession(cid)?.platform,
        armed: s.getSession(cid)?.armed ?? 0,
        phase: s.getSession(cid)?.phase,
      }));

      const r = runHook(root, event, payload, ANTIGRAVITY_PLATFORM);
      expectAntigravityGateAbort(r);

      withStore(root, (mid) => {
        expect(mid.getSession(cid)?.platform).toBe(before.plat);
        expect(mid.getSession(cid)?.armed).toBe(before.armed);
        expect(mid.getSession(cid)?.phase).toBe(before.phase);
        expect(mid.getReviewChain(cid)?.pending_followup ?? null).toBe(
          before.tip,
        );
        expect(mid.getReviewChain(cid)?.chain_pending).toBe(before.pending);
        expect(mid.getReviewChain(cid)?.code_edited).toBe(before.edited);
      });
    }
  });

  it("lookalike Antigravity PreInvocation under antigravity stamp still runs FSM", () => {
    root = tmpProject();
    withKimiHome();
    withHermesHome();
    installTenHost(root, { kimiHome, hermesHome });
    seedChecklist(root, "alpha");
    seedChecklist(root, "beta");
    const cid = "ten-agy-live-aaaa-bbbb-cccc-ddddeeee0002";
    const transcriptDir = path.join(root, "logs");
    fs.mkdirSync(transcriptDir, { recursive: true });
    const transcriptPath = path.join(transcriptDir, "transcript.jsonl");
    fs.writeFileSync(
      transcriptPath,
      `${JSON.stringify({ role: "user", text: "Autopilot ON" })}\n`,
    );

    const on = runHook(
      root,
      "PreInvocation",
      {
        conversationId: cid,
        transcriptPath,
        workspacePaths: [root],
      },
      ANTIGRAVITY_PLATFORM,
    );
    expect(on.status).toBe(0);
    expect(["{}", "{}\n"]).toContain(on.stdout);
    withStore(root, (onStore) => {
      expect(onStore.getSession(cid)?.platform).toBe(ANTIGRAVITY_PLATFORM);
      expect(onStore.getSession(cid)?.phase).toBe("planning");
    });
    expect(fs.existsSync(path.join(root, ".agent"))).toBe(false);
  });

  it("prior nine hosts non-regress when Antigravity hooks exist (submit shapes)", () => {
    root = tmpProject();
    withKimiHome();
    withHermesHome();
    installTenHost(root, { kimiHome, hermesHome });

    const ids: Record<Exclude<HostId, "antigravity">, string> = {
      cursor: "ten-sub-aaaa-bbbb-cccc-ddddeeee0010",
      "claude-code": "ten-sub-aaaa-bbbb-cccc-ddddeeee0011",
      codex: "ten-sub-aaaa-bbbb-cccc-ddddeeee0012",
      "kimi-code": "ten-sub-aaaa-bbbb-cccc-ddddeeee0013",
      "copilot-cli": "ten-sub-aaaa-bbbb-cccc-ddddeeee0014",
      "grok-build": "ten-sub-aaaa-bbbb-cccc-ddddeeee0015",
      "gemini-cli": "ten-sub-aaaa-bbbb-cccc-ddddeeee0016",
      "factory-droid": "ten-sub-aaaa-bbbb-cccc-ddddeeee0017",
      "hermes-agent": "ten-sub-aaaa-bbbb-cccc-ddddeeee0018",
    };

    withStore(root, (seed) => {
      for (const platform of PRIOR_NINE) {
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
    expect(kimi.stdout.trim()).toBe("");

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
        user_message: "hello hermes",
        cwd: root,
      },
      HERMES_PLATFORM,
    );
    expect(hermes.status).toBe(0);
    expect(["{}", "{}\n"]).toContain(hermes.stdout);

    withStore(root, (verify) => {
      for (const platform of PRIOR_NINE) {
        expect(verify.getSession(ids[platform])?.platform).toBe(platform);
        expect(verify.getSession(ids[platform])?.phase).toBe("idle");
        expect(verify.getSession(ids[platform])?.armed).toBe(0);
        expect(verify.getSession(ids[platform])?.paused).toBe(0);
      }
    });
    expect(fs.existsSync(path.join(root, ".agent"))).toBe(false);
  });

  it("prior nine sessions survive Antigravity PreInvocation cross-fire under their stamps", () => {
    root = tmpProject();
    withKimiHome();
    withHermesHome();
    installTenHost(root, { kimiHome, hermesHome });
    const cp = seedChecklist(root);
    const transcriptDir = path.join(root, "logs");
    fs.mkdirSync(transcriptDir, { recursive: true });
    const transcriptPath = path.join(transcriptDir, "transcript.jsonl");
    fs.writeFileSync(transcriptPath, "");

    const ids: Record<Exclude<HostId, "antigravity">, string> = {
      cursor: "ten-xf-cursor-aaaa-bbbb-cccc-ddddeeee0080",
      "claude-code": "ten-xf-claude-aaaa-bbbb-cccc-ddddeeee0081",
      codex: "ten-xf-codex-aaaa-bbbb-cccc-ddddeeee0082",
      "kimi-code": "ten-xf-kimi-aaaa-bbbb-cccc-ddddeeee0083",
      "copilot-cli": "ten-xf-copilot-aaaa-bbbb-cccc-ddddeeee0084",
      "grok-build": "ten-xf-grok-aaaa-bbbb-cccc-ddddeeee0085",
      "gemini-cli": "ten-xf-gemini-aaaa-bbbb-cccc-ddddeeee0086",
      "factory-droid": "ten-xf-fac-aaaa-bbbb-cccc-ddddeeee0087",
      "hermes-agent": "ten-xf-hermes-aaaa-bbbb-cccc-ddddeeee0088",
    };

    withStore(root, (store) => {
      for (const platform of PRIOR_NINE) {
        store.upsertSession({
          conversation_id: ids[platform],
          project_root: root,
          code_root: root,
          platform,
          phase: "executing",
          armed: 1,
          paused: 0,
          track_id: "demo",
          checklist_path: cp,
        });
        store.updateReviewChain(ids[platform], {
          code_edited: 1,
          chain_pending: 1,
          pending_followup: "survive tip ten",
        });
      }
    });

    for (const platform of PRIOR_NINE) {
      const cid = ids[platform];
      const xf = runHook(
        root,
        "PreInvocation",
        agyPreInvocationPayload(cid, root, transcriptPath),
        platform,
      );
      expectAntigravityGateAbort(xf);
      withStore(root, (v) => {
        expect(v.getSession(cid)?.platform).toBe(platform);
        expect(v.getSession(cid)?.armed).toBe(1);
        expect(v.getSession(cid)?.phase).toBe("executing");
        expect(v.getReviewChain(cid)?.pending_followup).toBe("survive tip ten");
        expect(v.getReviewChain(cid)?.chain_pending).toBe(1);
        expect(v.getReviewChain(cid)?.code_edited).toBe(1);
      });
    }
    expect(fs.existsSync(path.join(root, ".agent"))).toBe(false);
  });
});
