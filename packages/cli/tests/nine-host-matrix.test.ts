/**
 * Nine-host matrix: Hermes ↔ Cursor/Claude/Codex/Kimi/Copilot/Grok/Gemini/Factory
 * cross-fire. Wrong stamp / wrong payload → abort before FSM.
 *
 * Hermes-unique events under a non-Hermes --platform always emit JSON `{}`
 * (even when the stamp is kimi-code / factory-droid — those hosts' normal
 * Silence is empty body; Hermes early gate must still be JSON for the host
 * that owns the event). Hermes stamp + non-Hermes events likewise `{}`.
 * Prior eight hosts must not go red when Hermes is also enabled.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StateStore } from "@autopilot-harness/core";
import {
  FACTORY_HOOKS_REL_PATH,
} from "../src/init/factory-hooks-merge.js";
import {
  HERMES_AUTOPILOT_EVENTS,
  HERMES_HOOK_TIMEOUT_SEC,
  HERMES_MAX_VERIFY_NUDGES,
  HERMES_POST_TOOL_MATCHER,
  hasCompleteHermesAutopilotHooks,
  hermesConfigYamlPath,
  hermesHooksHavePlatformStamp,
  parseHermesConfigYaml,
} from "../src/init/hermes-hooks-merge.js";
import { installInitYes } from "../src/init/install.js";
import { AUTOPILOT_EVENTS } from "../src/init/types.js";
import { runDoctor } from "../src/status-doctor.js";
import { HERMES_PLATFORM } from "../../ports/hermes-agent/src/index.js";
import { FACTORY_PLATFORM } from "../../ports/factory-droid/src/index.js";

type HostId =
  | "cursor"
  | "claude-code"
  | "codex"
  | "kimi-code"
  | "copilot-cli"
  | "grok-build"
  | "gemini-cli"
  | "factory-droid"
  | "hermes-agent";

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
] as const;

const PRIOR_EIGHT: readonly Exclude<HostId, "hermes-agent">[] = [
  "cursor",
  "claude-code",
  "codex",
  "kimi-code",
  "copilot-cli",
  "grok-build",
  "gemini-cli",
  "factory-droid",
] as const;

const HERMES_EVENTS = [
  "pre_llm_call",
  "post_tool_call",
  "pre_verify",
] as const;

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-nine-host-"));
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
      `nine-host hook spawn killed: event=${event} platform=${platform ?? "(none)"} signal=${proc.signal}`,
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

/** Hermes early-gate abort: always JSON `{}` or `{}\n` (never Kimi/Factory empty). */
function expectHermesGateAbort(r: {
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
  expect(r.out.stopReason).toBeUndefined();
  expect(r.out.hookSpecificOutput).toBeUndefined();
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

function hermesEventPayload(
  event: (typeof HERMES_EVENTS)[number],
  cid: string,
  root: string,
): Record<string, unknown> {
  if (event === "pre_llm_call") {
    return { session_id: cid, user_message: "Autopilot ON", cwd: root };
  }
  if (event === "post_tool_call") {
    return {
      session_id: cid,
      tool_name: "write_file",
      tool_input: { path: "src/x.ts", content: "x\n" },
      cwd: root,
    };
  }
  return {
    session_id: cid,
    extra: { attempt: 0, coding: true },
    cwd: root,
  };
}

/** Cursor + Claude + Codex + Kimi + Copilot + Grok + Gemini + Factory + Hermes. */
function installNineHost(
  root: string,
  homes: { kimiHome: string; hermesHome: string },
): void {
  // Fail closed: never write into the developer's real ~/.kimi / ~/.hermes.
  // Absolute alone is not enough — a pre-set HERMES_HOME=~/.hermes is absolute.
  if (!root || !isSuiteTempHome(root)) {
    throw new Error(
      "installNineHost requires projectRoot under os.tmpdir() (call tmpProject first)",
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
      "installNineHost requires process.env.KIMI_CODE_HOME === suite temp (call withKimiHome first)",
    );
  }
  if (
    !homes.hermesHome ||
    !isSuiteTempHome(homes.hermesHome) ||
    hermes !== homes.hermesHome
  ) {
    throw new Error(
      "installNineHost requires process.env.HERMES_HOME === suite temp (call withHermesHome first)",
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

describe("nine-host Hermes cross-fire matrix", () => {
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
    // Never rmSync outside os.tmpdir() — a poisoned kimiHome/root must not
    // wipe ~/.hermes or the repo.
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
    const next = fs.mkdtempSync(path.join(os.tmpdir(), "ap-nine-kimi-"));
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
    const next = fs.mkdtempSync(path.join(os.tmpdir(), "ap-nine-hermes-"));
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

  it("nine install stamps all hosts; doctor stays ok for prior eight + Hermes", () => {
    root = tmpProject();
    withKimiHome();
    withHermesHome();
    installNineHost(root, { kimiHome, hermesHome });

    const cursorHooks = JSON.parse(
      fs.readFileSync(path.join(root, ".cursor", "hooks.json"), "utf8"),
    ) as { hooks: Record<string, { command: string }[]> };
    for (const event of AUTOPILOT_EVENTS) {
      const ap = cursorHooks.hooks[event]?.filter((h) =>
        h.command.includes("autopilot-harness"),
      );
      expect(ap?.length).toBe(1);
      expect(ap![0].command).toMatch(/--platform cursor(?:\s|$)/);
    }

    expect(
      fs.readFileSync(path.join(root, ".codex", "hooks.json"), "utf8"),
    ).toMatch(/--platform codex(?:\s|$)/);
    expect(
      fs.readFileSync(path.join(kimiHome, "config.toml"), "utf8"),
    ).toMatch(/--platform kimi-code/);
    expect(
      fs.readFileSync(path.join(root, FACTORY_HOOKS_REL_PATH), "utf8"),
    ).toMatch(/--platform factory-droid/);

    const cfgPath = hermesConfigYamlPath(hermesHome);
    expect(fs.existsSync(cfgPath)).toBe(true);
    const hermesCfg = parseHermesConfigYaml(fs.readFileSync(cfgPath, "utf8"));
    expect(hasCompleteHermesAutopilotHooks(hermesCfg)).toBe(true);
    expect(hermesHooksHavePlatformStamp(hermesCfg)).toBe(true);
    expect(HERMES_AUTOPILOT_EVENTS).toEqual([...HERMES_EVENTS]);
    expect(HERMES_HOOK_TIMEOUT_SEC).toBe(120);
    expect(HERMES_MAX_VERIFY_NUDGES).toBe(32);
    expect(HERMES_POST_TOOL_MATCHER).toBe("write_file|patch");
    for (const event of HERMES_AUTOPILOT_EVENTS) {
      const entries = hermesCfg.hooks![event] as Array<{
        command?: string;
        timeout?: number;
        matcher?: string;
      }>;
      expect(entries).toHaveLength(1);
      expect(entries[0]!.command).toBe(
        `node .autopilot/bin/autopilot-harness-hook.mjs --platform ${HERMES_PLATFORM} --event ${event}`,
      );
      expect(entries[0]!.timeout).toBe(HERMES_HOOK_TIMEOUT_SEC);
      if (event === "post_tool_call") {
        expect(entries[0]!.matcher).toBe(HERMES_POST_TOOL_MATCHER);
      }
    }

    const ignore = fs.readFileSync(path.join(root, ".autopilotignore"), "utf8");
    expect(ignore).toMatch(/\.factory\/hooks\.json/);

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
    expect(joined).toMatch(/Hermes Agent \+ Claude Code both enabled/i);
  });

  it(
    "Hermes events + wrong --platform → JSON {} abort; no session steal",
    () => {
      root = tmpProject();
      withKimiHome();
      withHermesHome();
      installNineHost(root, { kimiHome, hermesHome });
      seedChecklist(root);

      for (const platform of PRIOR_EIGHT) {
        for (const event of HERMES_EVENTS) {
          const cid = `nine-wrong-${platform}-${event}-0001`;
          expect(
            withStore(root, (s) => s.getSession(cid)),
          ).toBeNull();

          const r = runHook(
            root,
            event,
            hermesEventPayload(event, cid, root),
            platform,
          );
          expectHermesGateAbort(r);

          expect(
            withStore(root, (s) => s.getSession(cid)),
          ).toBeNull();
        }
      }
    },
    60_000,
  );

  it("Hermes stamp + foreign events → {} abort; pending_followup untouched", () => {
    root = tmpProject();
    withKimiHome();
    withHermesHome();
    installNineHost(root, { kimiHome, hermesHome });
    const cp = seedChecklist(root);
    const cid = "nine-hermes-park-aaaa-bbbb-cccc-ddddeeee0001";
    withStore(root, (store) => {
      store.upsertSession({
        conversation_id: cid,
        project_root: root,
        code_root: root,
        platform: HERMES_PLATFORM,
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
        pending_followup: "park tip nine",
      });
    });

    const foreign: Array<{ event: string; payload: Record<string, unknown> }> =
      [
        {
          event: "UserPromptSubmit",
          payload: { session_id: cid, prompt: "hostile ups" },
        },
        {
          event: "Stop",
          payload: {
            session_id: cid,
            reason: "end_turn",
            stop_hook_active: false,
          },
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
          event: "AfterAgent",
          payload: {
            sessionId: cid,
            hook_event_name: "AfterAgent",
            stop_hook_active: false,
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
          event: "PostToolUse",
          payload: {
            session_id: cid,
            tool_name: "Edit",
            tool_input: { file_path: "src/x.ts" },
          },
        },
        {
          event: "StopFailure",
          payload: { session_id: cid },
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

      const r = runHook(root, event, payload, HERMES_PLATFORM);
      expectHermesGateAbort(r);

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

  it("lookalike Hermes pre_llm_call / pre_verify under hermes-agent stamp still runs FSM", () => {
    root = tmpProject();
    withKimiHome();
    withHermesHome();
    installNineHost(root, { kimiHome, hermesHome });
    seedChecklist(root, "alpha");
    seedChecklist(root, "beta");
    const cid = "nine-hermes-live-aaaa-bbbb-cccc-ddddeeee0002";

    const on = runHook(
      root,
      "pre_llm_call",
      { session_id: cid, user_message: "Autopilot ON", cwd: root },
      HERMES_PLATFORM,
    );
    expect(on.status).toBe(0);
    expect(["{}", "{}\n"]).toContain(on.stdout);
    withStore(root, (onStore) => {
      expect(onStore.getSession(cid)?.platform).toBe(HERMES_PLATFORM);
      expect(onStore.getSession(cid)?.phase).toBe("planning");
    });

    const pick = runHook(
      root,
      "pre_llm_call",
      { session_id: cid, user_message: "Autopilot RUN", cwd: root },
      HERMES_PLATFORM,
    );
    expect(pick.status).toBe(0);
    expect(pick.out.__parse_error).toBeUndefined();
    expect(pick.stdout.trim()).not.toBe("{}");
    expect(typeof pick.out.context).toBe("string");
    expect(pick.out.decision).toBeUndefined();
    expect(Object.keys(pick.out).sort()).toEqual(["context"]);

    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    const editFile = path.join(root, "src", "nine-edit.ts");
    fs.writeFileSync(editFile, "export const n = 1;\n");
    withStore(root, (armed) => {
      armed.upsertSession({
        conversation_id: cid,
        project_root: root,
        code_root: root,
        platform: HERMES_PLATFORM,
        phase: "executing",
        armed: 1,
        paused: 0,
        track_id: "alpha",
        checklist_path: path.join(root, "plans", "alpha", "checklist.md"),
        reviewing_item_id: "a",
      });
    });

    const post = runHook(
      root,
      "post_tool_call",
      {
        session_id: cid,
        tool_name: "write_file",
        tool_input: { path: editFile, content: "export const n = 2;\n" },
        cwd: root,
      },
      HERMES_PLATFORM,
    );
    expect(post.status).toBe(0);
    expect(["{}", "{}\n"]).toContain(post.stdout);
    withStore(root, (postStore) => {
      expect(postStore.getReviewChain(cid)?.code_edited).toBe(1);
    });

    const verify = runHook(
      root,
      "pre_verify",
      {
        session_id: cid,
        extra: {
          attempt: 0,
          coding: true,
          changed_paths: ["src/nine-edit.ts"],
        },
        cwd: root,
      },
      HERMES_PLATFORM,
    );
    expect(verify.status).toBe(0);
    expect(verify.out.__parse_error).toBeUndefined();
    expect(verify.out.decision).toBe("block");
    expect(typeof verify.out.reason).toBe("string");
    expect(String(verify.out.reason).length).toBeGreaterThan(0);
    expect(verify.out.context).toBeUndefined();
    expect(Object.keys(verify.out).sort()).toEqual(["decision", "reason"]);
    withStore(root, (after) => {
      expect(after.getReviewChain(cid)?.chain_pending).toBe(1);
      expect(after.getReviewChain(cid)?.pending_followup).toBeTruthy();
    });
  });

  it("prior eight hosts non-regress when Hermes hooks exist (submit shapes)", () => {
    root = tmpProject();
    withKimiHome();
    withHermesHome();
    installNineHost(root, { kimiHome, hermesHome });

    const ids: Record<Exclude<HostId, "hermes-agent">, string> = {
      cursor: "nine-sub-aaaa-bbbb-cccc-ddddeeee0010",
      "claude-code": "nine-sub-aaaa-bbbb-cccc-ddddeeee0011",
      codex: "nine-sub-aaaa-bbbb-cccc-ddddeeee0012",
      "kimi-code": "nine-sub-aaaa-bbbb-cccc-ddddeeee0013",
      "copilot-cli": "nine-sub-aaaa-bbbb-cccc-ddddeeee0014",
      "grok-build": "nine-sub-aaaa-bbbb-cccc-ddddeeee0015",
      "gemini-cli": "nine-sub-aaaa-bbbb-cccc-ddddeeee0016",
      "factory-droid": "nine-sub-aaaa-bbbb-cccc-ddddeeee0017",
    };

    withStore(root, (seed) => {
      for (const platform of PRIOR_EIGHT) {
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
    expect(cursor.out.decision).toBeUndefined();

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
    expect(kimi.out).toEqual({});

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

    withStore(root, (verify) => {
      for (const platform of PRIOR_EIGHT) {
        expect(verify.getSession(ids[platform])?.platform).toBe(platform);
      }
    });
  });

  it("Factory/Kimi sessions survive Hermes-event cross-fire under their stamps", () => {
    root = tmpProject();
    withKimiHome();
    withHermesHome();
    installNineHost(root, { kimiHome, hermesHome });
    const cp = seedChecklist(root);
    const facCid = "nine-xf-fac-aaaa-bbbb-cccc-ddddeeee0081";
    const kimiCid = "nine-xf-kimi-aaaa-bbbb-cccc-ddddeeee0082";
    withStore(root, (store) => {
      for (const [cid, platform] of [
        [facCid, FACTORY_PLATFORM],
        [kimiCid, "kimi-code"],
      ] as const) {
        store.upsertSession({
          conversation_id: cid,
          project_root: root,
          code_root: root,
          platform,
          phase: "executing",
          armed: 1,
          paused: 0,
          track_id: "demo",
          checklist_path: cp,
        });
        store.updateReviewChain(cid, {
          code_edited: 1,
          chain_pending: 1,
          pending_followup: "survive tip",
        });
      }
    });

    // Hermes-unique events under Factory/Kimi stamps → Hermes gate {}
    // (never Factory/Kimi empty Silence); armed session tip must survive.
    for (const [cid, platform] of [
      [facCid, FACTORY_PLATFORM],
      [kimiCid, "kimi-code"],
    ] as const) {
      for (const event of HERMES_EVENTS) {
        const xf = runHook(
          root,
          event,
          hermesEventPayload(event, cid, root),
          platform,
        );
        expectHermesGateAbort(xf);
        withStore(root, (v) => {
          expect(v.getSession(cid)?.platform).toBe(platform);
          expect(v.getSession(cid)?.armed).toBe(1);
          expect(v.getSession(cid)?.phase).toBe("executing");
          expect(v.getReviewChain(cid)?.pending_followup).toBe("survive tip");
          expect(v.getReviewChain(cid)?.chain_pending).toBe(1);
          expect(v.getReviewChain(cid)?.code_edited).toBe(1);
        });
      }
    }
  });
});
