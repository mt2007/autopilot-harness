/**
 * v0.14 matrix-host — R7 「十路 shell + Pi 扩展」(+ v0.15 hook stamp list has Devin):
 * - shell `KNOWN_PLATFORMS` is eleven-way (includes `devin`; no `pi` / no `runner`)
 * - `--platform pi|runner` aborts before FSM (JSON `{}`)
 * - Pi stamp must not mutate existing host sessions / open state.db on abort
 * - prior ten shell hosts do not go red when Pi extension is also installed
 * - this suite still installs the prior ten shell hosts + Pi; Devin matrix coverage
 *   lands in v0.15 `matrix-host`
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { StateStore } from "@autopilot-harness/core";
import { ANTIGRAVITY_HOOKS_REL_PATH } from "../src/init/antigravity-hooks-merge.js";
import { COPILOT_HOOKS_REL_PATH } from "../src/init/copilot-hooks-merge.js";
import { FACTORY_HOOKS_REL_PATH } from "../src/init/factory-hooks-merge.js";
import { GEMINI_SETTINGS_REL_PATH } from "../src/init/gemini-settings-merge.js";
import { GROK_HOOKS_REL_PATH } from "../src/init/grok-hooks-merge.js";
import { hermesConfigYamlPath } from "../src/init/hermes-hooks-merge.js";
import { commandHasPlatformStamp } from "../src/init/hooks-merge.js";
import { kimiConfigTomlPath } from "../src/init/kimi-hooks-merge.js";
import { PI_EXTENSION_REL_PATH } from "../src/init/pi-extension.js";
import { installInitYes } from "../src/init/install.js";
import { runDoctor } from "../src/status-doctor.js";
import { PI_PLATFORM } from "@autopilot-harness/port-pi";

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
  | "antigravity";

const SHELL_HOSTS: readonly ShellHostId[] = [
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK_ASSET = path.resolve(
  __dirname,
  "../assets/autopilot-harness-hook.mjs",
);
const VENDOR_RUNTIME = path.resolve(
  __dirname,
  "../assets/vendor/runtime.mjs",
);

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-ten-shell-pi-"));
}

function isSuiteTempHome(p: string): boolean {
  if (!p || !path.isAbsolute(p)) return false;
  let resolved: string;
  let tmpRoot: string;
  try {
    resolved = fs.realpathSync(p);
    tmpRoot = fs.realpathSync(os.tmpdir());
  } catch {
    // Unresolvable path is not a suite temp — do not fall back to the
    // lexical path (a symlink can sit under tmp and point outside).
    return false;
  }
  // Child of the temp root only. Equality would let afterEach rmSync(os.tmpdir()).
  return resolved.startsWith(tmpRoot + path.sep);
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
  if (proc.error) throw proc.error;
  if (proc.status == null) {
    throw new Error(
      `ten-shell+pi hook spawn killed: event=${event} platform=${platform ?? "(none)"} signal=${proc.signal}`,
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

/** Non-shell stamp abort: always JSON `{}` (before FSM / stamp-shaped writers). */
function expectNonShellAbort(r: {
  status: number | null;
  out: Record<string, unknown>;
  stdout: string;
  stderr: string;
}): void {
  expect(r.status).toBe(0);
  expect(r.stderr.trim()).toBe("");
  expect(r.out.__parse_error).toBeUndefined();
  expect(r.stdout.trim()).toBe("{}");
  expect(r.out).toEqual({});
  expect(r.out.decision).toBeUndefined();
  expect(r.out.continue).toBeUndefined();
  expect(r.out.reason).toBeUndefined();
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

/** Ten shell hosts + Pi (extension; not a shell stamp). */
function installTenShellPlusPi(
  root: string,
  homes: { kimiHome: string; hermesHome: string },
): void {
  if (!root || !isSuiteTempHome(root)) {
    throw new Error("installTenShellPlusPi requires tmp projectRoot");
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
    ["pi", "cli"],
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

describe("ten-shell + Pi extension matrix (R7)", () => {
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
    const next = fs.mkdtempSync(path.join(os.tmpdir(), "ap-pi-mx-kimi-"));
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
    const next = fs.mkdtempSync(path.join(os.tmpdir(), "ap-pi-mx-hermes-"));
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

  it("suite temp guard refuses the temp root, its parent, and non-paths", () => {
    const tmpRoot = fs.realpathSync(os.tmpdir());
    expect(isSuiteTempHome(tmpRoot)).toBe(false);
    expect(isSuiteTempHome(os.tmpdir())).toBe(false);
    expect(isSuiteTempHome(path.dirname(tmpRoot))).toBe(false);
    expect(isSuiteTempHome("")).toBe(false);
    expect(isSuiteTempHome("relative/not-absolute")).toBe(false);

    const outside = path.dirname(tmpRoot);
    // Symlink target must itself fail the suite guard (not merely "exist").
    expect(isSuiteTempHome(outside)).toBe(false);
    const outsideBefore = fs.lstatSync(outside);
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "ap-pi-mx-guard-"));
    try {
      const link = path.join(scratch, "link");
      const dangling = path.join(scratch, "dangling");
      fs.symlinkSync(outside, link);
      fs.symlinkSync(path.join(outside, "no-such-ap-pi-target"), dangling);
      // realpath follows the link; lexical "under tmp" must not count.
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
      // Same bar as afterEach: suite child + real dir (not a swapped symlink).
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
    // Cleanup must have removed scratch (incl. symlink litter); outside identity survives.
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

  it("R7: shipped hook is eleven-way shell (+devin); NON_SHELL has pi+runner; vendor R1 trim present", () => {
    const src = fs.readFileSync(HOOK_ASSET, "utf8");
    const known = src.match(
      /KNOWN_PLATFORMS\s*=\s*new Set\(\[([\s\S]*?)\]\)/,
    );
    expect(known).toBeTruthy();
    const ids = [...(known?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(11);
    expect(ids).toEqual([...SHELL_HOSTS, "devin"]);
    expect(ids).not.toContain("pi");
    expect(ids).not.toContain("runner");
    expect(src).toMatch(
      /NON_SHELL_PLATFORMS\s*=\s*new Set\(\[\s*"pi"\s*,\s*"runner"\s*\]\)/,
    );
    expect(src).toMatch(/NON_SHELL_PLATFORMS\.has\(rawPlatform\)/);

    // Live Pi extension loads vendor — catch forgotten bundle-vendor after port-pi.
    const vendor = fs.readFileSync(VENDOR_RUNTIME, "utf8");
    expect(vendor).toMatch(
      /typeof action\?\.message === "string" \? action\.message\.trim\(\)/,
    );
    expect(vendor).toMatch(/!msg \|\| !action\?\.loop/);
    expect(PI_PLATFORM).toBe("pi");
  });

  it("install ten shell + Pi: extension present; doctor OK extension; no shell hooks for Pi", () => {
    root = tmpProject();
    withKimiHome();
    withHermesHome();
    installTenShellPlusPi(root, { kimiHome, hermesHome });

    expect(
      fs.existsSync(path.join(root, ".pi", "extensions", "autopilot.ts")),
    ).toBe(true);
    expect(fs.existsSync(path.join(root, ".cursor", "hooks.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".agents", "hooks.json"))).toBe(true);
    // Pi must not invent a shell hooks file of its own, nor stamp shell configs.
    expect(fs.existsSync(path.join(root, ".pi", "hooks.json"))).toBe(false);
    const shellHookFiles = [
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
    for (const file of shellHookFiles) {
      expect(fs.existsSync(file), file).toBe(true);
      const body = fs.readFileSync(file, "utf8");
      expect(commandHasPlatformStamp(body, "pi"), file).toBe(false);
      expect(commandHasPlatformStamp(body, "runner"), file).toBe(false);
    }

    const cfg = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(cfg).toMatch(/^\s*-\s*id:\s*pi\s*$/m);
    for (const id of SHELL_HOSTS) {
      expect(cfg).toMatch(new RegExp(`^\\s*-\\s*id:\\s*${id}\\s*$`, "m"));
    }

    // Inject suite homes — bare resolve can miss env and FAIL on real ~/.kimi.
    const doc = runDoctor(root, {
      kimiCodeHome: kimiHome,
      hermesHome,
    });
    expect(doc.ok).toBe(true);
    const text = doc.lines.join("\n");
    expect(text).not.toMatch(/\bFAIL\b/);
    expect(text).toMatch(
      new RegExp(`OK\\s+${PI_EXTENSION_REL_PATH.replace(/\./g, "\\.")}`),
    );
    // Shell hosts must stay green with Pi extension present (not Pi-only OK).
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
  });

  it("--platform pi|runner aborts before FSM on shell events; no state.db on fresh abort", () => {
    root = tmpProject();
    // Minimal wiring: Cursor shell host + Pi extension (avoid heavy ten-host install).
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [
          { id: "cursor", surface: "ide" },
          { id: "pi", surface: "cli" },
        ],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    expect(fs.existsSync(hookPath(root))).toBe(true);

    const dbPath = path.join(root, ".autopilot", "state.db");
    expect(fs.existsSync(dbPath)).toBe(false);

    const shellEvents = [
      ["beforeSubmitPrompt", { prompt: "x" }],
      ["UserPromptSubmit", { prompt: "x", session_id: "abort-sess" }],
      ["Stop", { session_id: "abort-sess", status: "completed" }],
      ["PreInvocation", { conversationId: "abort-agy", workspacePaths: [root] }],
    ] as const;

    for (const platform of ["pi", "runner"] as const) {
      for (const [event, payload] of shellEvents) {
        const r = runHook(root, event, payload, platform);
        expectNonShellAbort(r);
      }
    }
    expect(fs.existsSync(dbPath)).toBe(false);
    expect(fs.existsSync(`${dbPath}-wal`)).toBe(false);
    expect(fs.existsSync(`${dbPath}-shm`)).toBe(false);
  });

  it("Pi stamp cross-fire does not mutate armed shell sessions", () => {
    root = tmpProject();
    withKimiHome();
    withHermesHome();
    installTenShellPlusPi(root, { kimiHome, hermesHome });

    const cid = "ten-pi-cross-aaaa-bbbb-cccc-ddddeeee0001";
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
    // Refuse ""==="" false-green if seed failed to stick.
    expect(pendingBefore).toMatch(/Review fix round 1/);

    const dbPath = path.join(root, ".autopilot", "state.db");
    const mtimeBefore = fs.statSync(dbPath).mtimeMs;

    for (const stamp of ["pi", "runner"] as const) {
      for (const event of [
        "beforeSubmitPrompt",
        "UserPromptSubmit",
        "Stop",
        "agentStop",
      ] as const) {
        const r = runHook(
          root,
          event,
          {
            conversation_id: cid,
            session_id: cid,
            sessionId: cid,
            prompt: "hostile",
            status: "completed",
          },
          stamp,
        );
        expectNonShellAbort(r);
      }
    }

    expect(fs.statSync(dbPath).mtimeMs).toBe(mtimeBefore);

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
  });

  it("prior ten shell hosts non-regress when Pi extension is installed", () => {
    root = tmpProject();
    withKimiHome();
    withHermesHome();
    installTenShellPlusPi(root, { kimiHome, hermesHome });

    const ids: Record<ShellHostId, string> = {
      cursor: "tsp-sub-aaaa-bbbb-cccc-ddddeeee0010",
      "claude-code": "tsp-sub-aaaa-bbbb-cccc-ddddeeee0011",
      codex: "tsp-sub-aaaa-bbbb-cccc-ddddeeee0012",
      "kimi-code": "tsp-sub-aaaa-bbbb-cccc-ddddeeee0013",
      "copilot-cli": "tsp-sub-aaaa-bbbb-cccc-ddddeeee0014",
      "grok-build": "tsp-sub-aaaa-bbbb-cccc-ddddeeee0015",
      "gemini-cli": "tsp-sub-aaaa-bbbb-cccc-ddddeeee0016",
      "factory-droid": "tsp-sub-aaaa-bbbb-cccc-ddddeeee0017",
      "hermes-agent": "tsp-sub-aaaa-bbbb-cccc-ddddeeee0018",
      antigravity: "tsp-sub-aaaa-bbbb-cccc-ddddeeee0019",
    };

    withStore(root, (seed) => {
      for (const platform of SHELL_HOSTS) {
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

    // Sessions still present under their stamps (Pi abort path did not wipe).
    withStore(root, (s) => {
      for (const platform of SHELL_HOSTS) {
        const row = s.getSession(ids[platform]);
        expect(row?.platform).toBe(platform);
        expect(row?.phase).toBe("idle");
        expect(row?.armed).toBe(0);
        expect(row?.paused).toBe(0);
      }
    });
  });
});
