/**
 * v0.12 tests-runner-contract — umbrella hard proofs (research §5):
 * first-prompt shape; product→fix re-inject; soft verify→advance→[x];
 * budget leaves pending; resume without `--run`; empty-start; missing command;
 * needPick fail-closed; ten-way hook matrix untouched (no `runner` platform).
 *
 * v0.13 tests-runner-on-contract — research §8: `--on`/`--brief`/`--message`,
 * C1–C9 + C6 split exit, create db, planning resume, re-ON, `--run` still
 * non-zero on stopped; ten-way untouched.
 * Deeper suites: port-runner / runner-cli / runner-init-doctor.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  StateStore,
  applyRun,
  isHarnessFollowupMessage,
} from "@autopilot-harness/core";
import {
  RUNNER_PLATFORM,
  MockDriver,
  stableRunnerConversationId,
} from "@autopilot-harness/port-runner";
import { startRunner } from "../src/runner-cli.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK_ASSET = path.resolve(
  __dirname,
  "../assets/autopilot-harness-hook.mjs",
);

const tmpDirs: string[] = [];

function tmpRoot(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ap-runner-contract-"));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function writeConfig(
  root: string,
  runnerBlock = "runner:\n  command: echo {prompt}\n  max_iterations: 8\n",
  reviewBlock = "review:\n  scope: executing_only\n  confirm_rounds: 1\n",
): void {
  fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".autopilot", "config.yml"),
    `locale: en\nartifacts:\n  plans_dir: plans\n${reviewBlock}${runnerBlock}`,
    "utf8",
  );
}

function writeTrack(
  root: string,
  slug: string,
  body = "- [ ] item-a — First\n- [ ] item-b — Second\n",
): string {
  const plans = path.join(root, "plans", slug);
  fs.mkdirSync(plans, { recursive: true });
  const cp = path.join(plans, "checklist.md");
  fs.writeFileSync(cp, `# ${slug}\n\n${body}`, "utf8");
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

function initProductRepo(root: string): void {
  git(root, ["init"]);
  git(root, ["config", "user.email", "runner-contract@example.com"]);
  git(root, ["config", "user.name", "Runner Contract"]);
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
}

describe("tests-runner-contract (research §5)", () => {
  it("first prompt shape: track slug + item id + executing guidance", async () => {
    const root = tmpRoot();
    writeConfig(root);
    writeTrack(root, "demo");

    const mock = new MockDriver([{ exitCode: 0 }]);
    const outcome = await startRunner({
      projectRoot: root,
      runSlug: "demo",
      flags: { command: "echo {prompt}", maxIterations: 1 },
      driver: mock,
    });
    expect(outcome.ok).toBe(true);
    expect(mock.calls.length).toBe(1);
    const prompt = mock.calls[0]!.prompt;
    expect(prompt).toMatch(/\[Autopilot Runner — executing\]/);
    expect(prompt).toContain("Track: demo");
    expect(prompt).toContain("item-a");
    expect(prompt).toMatch(/verify-last\.json/i);
    expect(prompt).toMatch(/Do not invent Advance\/Done/i);
  });

  it("product edit → stop tick → next prompt is fix tip (re-inject)", async () => {
    const root = tmpRoot();
    initProductRepo(root);
    writeConfig(root);
    writeTrack(root, "demo");

    const mock = new MockDriver([
      () => {
        fs.writeFileSync(
          path.join(root, "packages", "x.ts"),
          "export const n = 2;\n",
        );
        return { exitCode: 0 };
      },
      { exitCode: 0 },
    ]);
    const outcome = await startRunner({
      projectRoot: root,
      runSlug: "demo",
      flags: { command: "echo {prompt}", maxIterations: 2 },
      driver: mock,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(mock.calls.length).toBeGreaterThanOrEqual(2);
    const first = mock.calls[0]!.prompt;
    const second = mock.calls[1]!.prompt;
    expect(first).toMatch(/\[Autopilot Runner — executing\]/);
    expect(second).toMatch(/^Review fix round/i);
    expect(isHarnessFollowupMessage(second)).toBe(true);
    expect(second).not.toBe(first);

    const store = new StateStore(root);
    try {
      const chain = store.getReviewChain(outcome.conversationId);
      // Fix tip was emitted (and may already be ack-cleared after re-inject).
      expect(chain?.fix_round ?? 0).toBeGreaterThan(0);
    } finally {
      store.close();
    }
  });

  it("soft verify → advance tip re-inject → checklist [x] chain advance", async () => {
    const root = tmpRoot();
    writeConfig(root);
    const cp = writeTrack(root, "demo");
    const reportPath = path.join(root, ".autopilot", "verify-last.json");

    const mock = new MockDriver([
      () => {
        fs.mkdirSync(path.dirname(reportPath), { recursive: true });
        fs.writeFileSync(
          reportPath,
          JSON.stringify({
            itemId: "item-a",
            ok: true,
            at: new Date().toISOString(),
          }),
        );
        return { exitCode: 0 };
      },
      (input) => {
        expect(input.prompt).toMatch(/^Advance checklist/i);
        expect(input.prompt).toContain("item-a");
        expect(input.prompt).toContain("item-b");
        fs.writeFileSync(
          cp,
          `# demo\n\n- [x] item-a — First\n- [ ] item-b — Second\n`,
          "utf8",
        );
        fs.writeFileSync(
          reportPath,
          JSON.stringify({
            itemId: "item-b",
            ok: true,
            at: new Date().toISOString(),
          }),
        );
        return { exitCode: 0 };
      },
      { exitCode: 0 },
    ]);

    const outcome = await startRunner({
      projectRoot: root,
      runSlug: "demo",
      flags: { command: "echo {prompt}", maxIterations: 4 },
      driver: mock,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(mock.calls[1]!.prompt).toMatch(/^Advance checklist/i);
    expect(isHarnessFollowupMessage(mock.calls[1]!.prompt)).toBe(true);
    // After [x] item-a + verify item-b, engine must continue the chain (Done).
    expect(mock.calls[2]!.prompt).toMatch(/^All checklist items done/i);
    expect(isHarnessFollowupMessage(mock.calls[2]!.prompt)).toBe(true);

    const checklist = fs.readFileSync(cp, "utf8");
    expect(checklist).toMatch(/- \[x\] item-a/);
    expect(checklist).toMatch(/- \[ \] item-b/);
  });

  it("budget_exhausted leaves pending_followup for later resume", async () => {
    const root = tmpRoot();
    writeConfig(
      root,
      "runner:\n  command: echo {prompt}\n  max_iterations: 1\n",
    );
    writeTrack(root, "demo");

    const mock = new MockDriver([{ exitCode: 0 }, { exitCode: 0 }]);
    const outcome = await startRunner({
      projectRoot: root,
      runSlug: "demo",
      flags: { command: "echo {prompt}", maxIterations: 1 },
      driver: mock,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.result.outcome).toBe("budget_exhausted");
    expect(mock.calls.length).toBe(1);

    const store = new StateStore(root);
    try {
      const pending =
        store.getReviewChain(outcome.conversationId)?.pending_followup?.trim() ??
        "";
      expect(pending.length).toBeGreaterThan(0);
      expect(isHarnessFollowupMessage(pending)).toBe(true);
      // Tip queued for continue must survive budget stop for the next resume.
      expect(pending).toBe(outcome.result.lastMessage?.trim());
    } finally {
      store.close();
    }
  });

  it("resume without --run re-injects pending tip", async () => {
    const root = tmpRoot();
    writeConfig(root);
    writeTrack(root, "demo");
    const tip = "Review fix round 3 (contract resume).";
    const cid = stableRunnerConversationId(root);
    const store = new StateStore(root);
    expect(
      applyRun(store, cid, root, {
        slug: "demo",
        platform: RUNNER_PLATFORM,
        config: { plansDir: "plans" },
      }).ok,
    ).toBe(true);
    store.updateReviewChain(cid, {
      pending_followup: tip,
      pending_followup_at: new Date().toISOString(),
    });
    store.close();

    const mock = new MockDriver([{ exitCode: 0 }]);
    const outcome = await startRunner({
      projectRoot: root,
      conversationId: cid,
      flags: { command: "echo {prompt}", maxIterations: 1 },
      driver: mock,
    });
    expect(outcome.ok).toBe(true);
    expect(mock.calls[0]?.prompt).toBe(tip);
  });

  it("empty-start without --run and without resumable session errors", async () => {
    const root = tmpRoot();
    writeConfig(root);
    const dbPath = path.join(root, ".autopilot", "state.db");
    const outcome = await startRunner({
      projectRoot: root,
      // no runSlug → resume path
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toMatch(/No runner session|Nothing to resume|--run/i);
    }
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it("missing runner.command fails closed (no driver)", async () => {
    const root = tmpRoot();
    writeConfig(root, "runner:\n  command: \n  max_iterations: 4\n");
    writeTrack(root, "demo");
    const dbPath = path.join(root, ".autopilot", "state.db");
    const outcome = await startRunner({
      projectRoot: root,
      runSlug: "demo",
      // no driver → CliDriver path requires command
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toMatch(/runner\.command is required/i);
    }
    // Fail before bind — must not create an empty state.db side effect.
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it("bare --run with multiple tracks maps needPick to exit 2", async () => {
    const root = tmpRoot();
    writeConfig(root);
    writeTrack(root, "alpha");
    writeTrack(root, "beta");
    const mock = new MockDriver([{ exitCode: 0 }]);
    const outcome = await startRunner({
      projectRoot: root,
      runSlug: "",
      flags: { command: "echo {prompt}" },
      driver: mock,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.exitCode).toBe(2);
      expect(outcome.error).toMatch(/pick|choose|slug|track/i);
    }
    // Fail-closed: never spawn the agent; never enter executing.
    expect(mock.calls.length).toBe(0);
    const store = new StateStore(root);
    try {
      const sess = store.getSession(stableRunnerConversationId(root));
      // needPick upserts a session — null would silently pass phase/armed checks.
      expect(sess).toBeTruthy();
      expect(sess!.armed).toBe(0);
      expect(sess!.phase).not.toBe("executing");
      expect(sess!.pending_action).toBe("run");
    } finally {
      store.close();
    }
  });

  it("shipped hook asset stays ten-way — no runner platform in KNOWN_PLATFORMS", () => {
    expect(fs.existsSync(HOOK_ASSET)).toBe(true);
    const src = fs.readFileSync(HOOK_ASSET, "utf8");
    const known = src.match(
      /KNOWN_PLATFORMS\s*=\s*new Set\(\[([\s\S]*?)\]\)/,
    );
    expect(known).toBeTruthy();
    const ids = [...(known?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual([
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
    ]);
    expect(ids).toHaveLength(10);
    expect(ids).not.toContain("runner");
    expect(src).not.toMatch(/handleRunnerStop/);
    expect(src).not.toMatch(/declaredPlatform === "runner"/);
    expect(RUNNER_PLATFORM).toBe("runner");
  });
});

describe("tests-runner-on-contract (research §8 / C1–C9)", () => {
  it("ten-way hook matrix stays untouched (no runner platform)", () => {
    const src = fs.readFileSync(HOOK_ASSET, "utf8");
    const known = src.match(
      /KNOWN_PLATFORMS\s*=\s*new Set\(\[([\s\S]*?)\]\)/,
    );
    expect(known).toBeTruthy();
    const ids = [...(known?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual([
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
    ]);
    expect(ids).toHaveLength(10);
    expect(ids).not.toContain("runner");
    expect(src).not.toMatch(/handleRunnerStop/);
    expect(src).not.toMatch(/declaredPlatform === "runner"/);
  });

  it("--on + --run FAIL", async () => {
    const root = tmpRoot();
    writeConfig(root);
    const dbPath = path.join(root, ".autopilot", "state.db");
    const outcome = await startRunner({
      projectRoot: root,
      wantOn: true,
      runSlug: "demo",
      driver: new MockDriver([{ exitCode: 0 }]),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toMatch(/Cannot combine --on|--on[\s\S]*--run/i);
      expect(outcome.exitCode).toBe(1);
    }
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it("--brief without --on FAIL", async () => {
    const root = tmpRoot();
    writeConfig(root);
    const dbPath = path.join(root, ".autopilot", "state.db");
    const outcome = await startRunner({
      projectRoot: root,
      brief: "ship it",
      driver: new MockDriver([{ exitCode: 0 }]),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(/--brief requires --on/i);
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it("C1 --message + --run FAIL", async () => {
    const root = tmpRoot();
    writeConfig(root);
    writeTrack(root, "demo");
    const dbPath = path.join(root, ".autopilot", "state.db");
    const mock = new MockDriver([{ exitCode: 0 }]);
    const outcome = await startRunner({
      projectRoot: root,
      runSlug: "demo",
      message: "hi",
      driver: mock,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toMatch(/Cannot combine --message and --run \(C1\)/i);
      expect(outcome.exitCode).toBe(1);
    }
    expect(mock.calls.length).toBe(0);
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it("C4 empty --message FAIL", async () => {
    const root = tmpRoot();
    writeConfig(root);
    const dbPath = path.join(root, ".autopilot", "state.db");
    const mock = new MockDriver([{ exitCode: 0 }]);
    const outcome = await startRunner({
      projectRoot: root,
      wantOn: true,
      message: "  ",
      driver: mock,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toMatch(/--message must be non-empty after trim \(C4\)/i);
      expect(outcome.exitCode).toBe(1);
    }
    expect(mock.calls.length).toBe(0);
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it("--on creates state.db, enters planning, brief/message in prompt, C6 exit 0", async () => {
    const root = tmpRoot();
    writeConfig(root);
    const dbPath = path.join(root, ".autopilot", "state.db");
    expect(fs.existsSync(dbPath)).toBe(false);
    const mock = new MockDriver([{ exitCode: 0 }]);
    const outcome = await startRunner({
      projectRoot: root,
      wantOn: true,
      brief: "ON · v0.13-runner-on · ship planning in runner",
      message: "Q1: prefer A",
      flags: { maxIterations: 2 },
      driver: mock,
    });
    expect(fs.existsSync(dbPath)).toBe(true);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.outcome).toBe("stopped");
      expect(outcome.exitCode).toBe(0);
      expect(mock.calls[0]?.prompt).toMatch(/Autopilot Runner — planning/i);
      expect(mock.calls[0]?.prompt).toContain("Track: v0.13-runner-on");
      expect(mock.calls[0]?.prompt).toContain("ship planning in runner");
      expect(mock.calls[0]?.prompt).toContain("Q1: prefer A");
    }
    const store = new StateStore(root);
    try {
      const sess = store.getSession(stableRunnerConversationId(root));
      expect(sess?.phase).toBe("planning");
      expect(sess?.track_id).toBe("v0.13-runner-on");
    } finally {
      store.close();
    }
  });

  it("C7 --on + --message OK (alias of planning entry)", async () => {
    const root = tmpRoot();
    writeConfig(root);
    const mock = new MockDriver([{ exitCode: 0 }]);
    const outcome = await startRunner({
      projectRoot: root,
      wantOn: true,
      message: "grill continue",
      flags: { maxIterations: 2 },
      driver: mock,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.exitCode).toBe(0);
      expect(mock.calls[0]?.prompt).toContain("grill continue");
    }
  });

  it("bare resume phase=planning OK (C6 exit 0)", async () => {
    const root = tmpRoot();
    writeConfig(root);
    const cid = stableRunnerConversationId(root);
    const store = new StateStore(root);
    try {
      store.upsertSession({
        conversation_id: cid,
        project_root: root,
        code_root: root,
        platform: RUNNER_PLATFORM,
        phase: "planning",
        armed: 0,
        paused: 0,
        track_id: "v0.13-runner-on",
      });
    } finally {
      store.close();
    }
    const mock = new MockDriver([{ exitCode: 0 }]);
    const outcome = await startRunner({
      projectRoot: root,
      flags: { maxIterations: 2 },
      driver: mock,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.exitCode).toBe(0);
      expect(mock.calls[0]?.prompt).toMatch(/Autopilot Runner — planning/i);
    }
  });

  it("re--on clears pending tip (C9)", async () => {
    const root = tmpRoot();
    writeConfig(root);
    const cid = stableRunnerConversationId(root);
    const store = new StateStore(root);
    try {
      store.upsertSession({
        conversation_id: cid,
        project_root: root,
        code_root: root,
        platform: RUNNER_PLATFORM,
        phase: "planning",
        armed: 0,
        paused: 0,
        track_id: "_pending",
      });
      store.updateReviewChain(cid, {
        pending_followup: "Review fix round 1: stale tip",
        pending_followup_at: new Date().toISOString(),
      });
    } finally {
      store.close();
    }
    const mock = new MockDriver([{ exitCode: 0 }]);
    const outcome = await startRunner({
      projectRoot: root,
      wantOn: true,
      message: "fresh turn",
      flags: { maxIterations: 2 },
      driver: mock,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(mock.calls[0]?.prompt).toContain("fresh turn");
      expect(mock.calls[0]?.prompt).not.toContain("stale tip");
    }
    const store2 = new StateStore(root);
    try {
      expect(store2.getReviewChain(cid)?.pending_followup?.trim() ?? "").toBe(
        "",
      );
    } finally {
      store2.close();
    }
  });

  it("C2 --message on executing resume FAIL", async () => {
    const root = tmpRoot();
    writeConfig(root);
    writeTrack(root, "demo");
    const cid = stableRunnerConversationId(root);
    const store = new StateStore(root);
    try {
      applyRun(store, cid, root, {
        slug: "demo",
        config: { plansDir: "plans" },
        platform: RUNNER_PLATFORM,
      });
    } finally {
      store.close();
    }
    const mock = new MockDriver([{ exitCode: 0 }]);
    const outcome = await startRunner({
      projectRoot: root,
      message: "nope",
      driver: mock,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toMatch(
        /--message is only valid in planning \(C2\)/i,
      );
      expect(outcome.exitCode).toBe(1);
    }
    expect(mock.calls.length).toBe(0);
  });

  it("C5 --message with pending tip FAIL", async () => {
    const root = tmpRoot();
    writeConfig(root);
    const cid = stableRunnerConversationId(root);
    const store = new StateStore(root);
    try {
      store.upsertSession({
        conversation_id: cid,
        project_root: root,
        code_root: root,
        platform: RUNNER_PLATFORM,
        phase: "planning",
        armed: 0,
        paused: 0,
        track_id: "_pending",
      });
      store.updateReviewChain(cid, {
        pending_followup: "Review confirm round 1/5: tip",
        pending_followup_at: new Date().toISOString(),
      });
    } finally {
      store.close();
    }
    const mock = new MockDriver([{ exitCode: 0 }]);
    const outcome = await startRunner({
      projectRoot: root,
      message: "answer",
      driver: mock,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toMatch(
        /--message cannot be used while a pending tip is set \(C5\)/i,
      );
      expect(outcome.exitCode).toBe(1);
    }
    expect(mock.calls.length).toBe(0);
  });

  it("C6 --run stopped/budget still non-zero", async () => {
    const root = tmpRoot();
    writeConfig(root);
    writeTrack(root, "demo");
    const outcome = await startRunner({
      projectRoot: root,
      runSlug: "demo",
      flags: { maxIterations: 1 },
      driver: new MockDriver([{ exitCode: 0 }]),
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(["stopped", "budget_exhausted"]).toContain(outcome.result.outcome);
      expect(outcome.exitCode).toBe(1);
    }
  });

  it("--on while executing FAIL (no spawn)", async () => {
    const root = tmpRoot();
    writeConfig(root);
    writeTrack(root, "demo");
    const cid = stableRunnerConversationId(root);
    const store = new StateStore(root);
    try {
      applyRun(store, cid, root, {
        slug: "demo",
        config: { plansDir: "plans" },
        platform: RUNNER_PLATFORM,
      });
    } finally {
      store.close();
    }
    const mock = new MockDriver([{ exitCode: 0 }]);
    const outcome = await startRunner({
      projectRoot: root,
      wantOn: true,
      driver: mock,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(/executing|OFF|REPLAN/i);
    expect(mock.calls.length).toBe(0);
  });
});
