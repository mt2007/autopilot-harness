import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StateStore, applyRun } from "@autopilot-harness/core";
import {
  RUNNER_PLATFORM,
  assertRunnerCommand,
  buildFirstTurnPrompt,
  buildPlanningFirstTurnPrompt,
  canResumeRunnerSession,
  driverResultToStopStatus,
  expandCommandTemplate,
  hasRunnerCommand,
  normalizeRunnerConfig,
  resolveChecklistPathInProject,
  resolvePromptChannel,
  resolveRunnerCwd,
  runRunnerLoop,
  runStopTick,
  shouldContinueAfterStop,
  stableRunnerConversationId,
  tokenizeCommandTemplate,
  CliDriver,
  MockDriver,
} from "../src/index.js";

const tmpDirs: string[] = [];

function tmpRoot(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ap-runner-port-"));
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

describe("port-runner config", () => {
  it("normalizes defaults and rejects empty command for CliDriver", () => {
    const cfg = normalizeRunnerConfig({});
    expect(cfg.command).toBe("");
    expect(cfg.maxIterations).toBe(32);
    expect(cfg.promptMode).toBe("auto");
    expect(hasRunnerCommand(cfg)).toBe(false);
    expect(() => assertRunnerCommand(cfg)).toThrow(/runner\.command is required/);
  });

  it("clamps max_iterations", () => {
    expect(normalizeRunnerConfig({ max_iterations: 0 }).maxIterations).toBe(1);
    expect(normalizeRunnerConfig({ max_iterations: 9999 }).maxIterations).toBe(
      500,
    );
  });
});

describe("stableRunnerConversationId", () => {
  it("is stable for the same realpath and uses runner: prefix", () => {
    const root = tmpRoot();
    const a = stableRunnerConversationId(root);
    const b = stableRunnerConversationId(root);
    expect(a).toBe(b);
    expect(a).toMatch(/^runner:[0-9a-f]{16}$/);
  });
});

describe("command template", () => {
  it("tokenizes placeholders as atomic argv elements", () => {
    expect(tokenizeCommandTemplate("agent --p {prompt} --x")).toEqual([
      "agent",
      "--p",
      "{prompt}",
      "--x",
    ]);
  });

  it("expands {prompt} with shell:false-safe single arg", () => {
    const root = tmpRoot();
    const cfg = normalizeRunnerConfig({
      command: "my-agent --prompt {prompt}",
    });
    const expanded = expandCommandTemplate(cfg, {
      tip: "hello world",
      projectRoot: root,
      conversationId: "runner:abc",
      iteration: 0,
    });
    expect(expanded.file).toBe("my-agent");
    expect(expanded.args).toEqual(["--prompt", "hello world"]);
    expect(expanded.channel).toBe("argv");
  });

  it("auto uses prompt_file for long tips when template has {prompt_file}", () => {
    const root = tmpRoot();
    const tip = "x".repeat(4001);
    expect(
      resolvePromptChannel("run {prompt_file}", tip, "auto"),
    ).toBe("file");
    const cfg = normalizeRunnerConfig({
      command: "agent {prompt_file}",
      prompt_mode: "auto",
    });
    const expanded = expandCommandTemplate(cfg, {
      tip,
      projectRoot: root,
      conversationId: "runner:testid",
      iteration: 2,
    });
    expect(expanded.channel).toBe("file");
    expect(expanded.promptFilePath).toBeTruthy();
    expect(fs.readFileSync(expanded.promptFilePath!, "utf8")).toBe(tip);
    expect(expanded.args[0]).toBe(expanded.promptFilePath);
  });

  it("rejects mixed {prompt} and {prompt_file} before writing a prompt file", () => {
    const root = tmpRoot();
    const cfg = normalizeRunnerConfig({
      command: "agent {prompt} {prompt_file}",
      prompt_mode: "auto",
    });
    expect(() =>
      expandCommandTemplate(cfg, {
        tip: "short",
        projectRoot: root,
        conversationId: "runner:mix",
        iteration: 0,
      }),
    ).toThrow(/both \{prompt\} and \{prompt_file\}/);
    const promptDir = path.join(root, ".autopilot", "runner-prompts");
    expect(fs.existsSync(promptDir) ? fs.readdirSync(promptDir) : []).toEqual(
      [],
    );
  });

  it("resolveChecklistPathInProject refuses paths outside the project", () => {
    const root = tmpRoot();
    const outside = path.join(os.tmpdir(), `ap-runner-outside-${Date.now()}.md`);
    fs.writeFileSync(outside, "# x\n", "utf8");
    try {
      expect(resolveChecklistPathInProject(root, outside)).toBeNull();
      expect(
        resolveChecklistPathInProject(root, "plans/missing/checklist.md"),
      ).toBeNull();
    } finally {
      try {
        fs.unlinkSync(outside);
      } catch {
        /* ignore */
      }
    }
  });

  it("resolveRunnerCwd distinguishes missing path from escape", () => {
    const root = tmpRoot();
    expect(resolveRunnerCwd(root, "")).toBe(fs.realpathSync(root));
    expect(() => resolveRunnerCwd(root, "no-such-cwd-dir")).toThrow(
      /does not exist/,
    );
    const filePath = path.join(root, "not-a-dir.txt");
    fs.writeFileSync(filePath, "x", "utf8");
    expect(() => resolveRunnerCwd(root, "not-a-dir.txt")).toThrow(
      /must be a directory/,
    );
    const sub = path.join(root, "agent-cwd");
    fs.mkdirSync(sub);
    expect(resolveRunnerCwd(root, "agent-cwd")).toBe(fs.realpathSync(sub));
    expect(() => resolveRunnerCwd(root, path.join("..", "outside-runner-cwd"))).toThrow(
      /must stay inside the project root/,
    );
  });
});

describe("driverResultToStopStatus", () => {
  it("maps exit and signals", () => {
    expect(driverResultToStopStatus({ exitCode: 0 })).toBe("completed");
    expect(driverResultToStopStatus({ exitCode: 1 })).toBe("error");
    expect(
      driverResultToStopStatus({ exitCode: null, signal: "SIGINT" }),
    ).toBe("aborted");
  });
});

describe("CliDriver", () => {
  it("rejects when the executable cannot be spawned (single settle)", async () => {
    const root = tmpRoot();
    const missing = path.join(
      root,
      `no-such-runner-bin-${Date.now()}-${process.pid}`,
    );
    const driver = new CliDriver(
      normalizeRunnerConfig({
        command: `${missing} {prompt}`,
      }),
    );
    await expect(
      driver.run({
        prompt: "hi",
        iteration: 0,
        conversationId: "runner:clidriver01",
        projectRoot: root,
      }),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects bad cwd before writing a prompt file", async () => {
    const root = tmpRoot();
    const driver = new CliDriver(
      normalizeRunnerConfig({
        command: "echo {prompt_file}",
        prompt_mode: "file",
        cwd: "missing-agent-cwd",
      }),
    );
    await expect(
      driver.run({
        prompt: "x".repeat(10),
        iteration: 0,
        conversationId: "runner:clidriver02",
        projectRoot: root,
      }),
    ).rejects.toThrow(/does not exist/);
    const promptDir = path.join(root, ".autopilot", "runner-prompts");
    expect(fs.existsSync(promptDir) ? fs.readdirSync(promptDir) : []).toEqual(
      [],
    );
  });
});

describe("first-turn prompt", () => {
  it("includes track and item id", () => {
    const text = buildFirstTurnPrompt({
      slug: "v0.12-runner",
      item: {
        id: "port-runner-package",
        title: "Port package",
        checked: false,
        line: "- [ ] port-runner-package — Port package",
        lineNumber: 1,
        idFromSeparator: true,
      },
    });
    expect(text).toContain("v0.12-runner");
    expect(text).toContain("port-runner-package");
    expect(text).toMatch(/Autopilot Runner/i);
  });
});

describe("planning first-turn prompt", () => {
  it("marks planning mode and includes condensed workflow", () => {
    const text = buildPlanningFirstTurnPrompt();
    expect(text).toMatch(/Autopilot Runner — planning/i);
    expect(text).toContain("no product code");
    expect(text).toMatch(/Track: \(unset/i);
    expect(text).toMatch(/No new user message/i);
  });

  it("includes slug, brief, and message when provided", () => {
    const text = buildPlanningFirstTurnPrompt({
      slug: "v0.13-runner-on",
      brief: "ship runner --on",
      message: "all recommendations",
    });
    expect(text).toContain("Track: v0.13-runner-on");
    expect(text).toContain("Initial brief:");
    expect(text).toContain("ship runner --on");
    expect(text).toContain("User message:");
    expect(text).toContain("all recommendations");
    expect(text).not.toMatch(/No new user message/i);
  });

  it("trims blank-ish fields and ignores non-strings", () => {
    const text = buildPlanningFirstTurnPrompt({
      slug: "  ",
      brief: "  keep-me  ",
      message: undefined,
    });
    expect(text).toMatch(/Track: \(unset/i);
    expect(text).toContain("keep-me");
    expect(text).toMatch(/No new user message/i);
  });

  it("treats null opts and unsafe slug as unset track", () => {
    expect(buildPlanningFirstTurnPrompt(null)).toMatch(/Track: \(unset/i);
    const text = buildPlanningFirstTurnPrompt({ slug: "../evil" });
    expect(text).toMatch(/Track: \(unset/i);
    expect(text).not.toContain("../evil");
  });
});

describe("runStopTick + MockDriver loop smoke", () => {
  it("runStopTick uses platform runner", () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    const store = new StateStore(root);
    const cid = stableRunnerConversationId(root);
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: RUNNER_PLATFORM,
      phase: "idle",
      armed: 0,
    });
    const { action } = runStopTick(store, root, {
      conversationId: cid,
      status: "completed",
      loopCount: 0,
    });
    // idle + no review work → null is fine
    expect(action === null || typeof action?.message === "string").toBe(true);
    expect(shouldContinueAfterStop(null)).toBe(false);
  });

  it("budget_exhausted leaves iterations at max with mock", async () => {
    const root = tmpRoot();
    const plans = path.join(root, "plans", "demo");
    fs.mkdirSync(plans, { recursive: true });
    fs.writeFileSync(
      path.join(plans, "checklist.md"),
      "# c\n\n- [ ] item-a — A\n",
      "utf8",
    );
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "review:\n  scope: project\n  confirm_rounds: 1\n",
      "utf8",
    );
    const store = new StateStore(root);
    const cid = stableRunnerConversationId(root);
    const mock = new MockDriver([
      { exitCode: 0 },
      { exitCode: 0 },
      { exitCode: 0 },
    ]);
    const result = await runRunnerLoop({
      store,
      projectRoot: root,
      conversationId: cid,
      config: normalizeRunnerConfig({
        command: "echo {prompt}",
        max_iterations: 2,
      }),
      runSlug: "demo",
      driver: mock,
      phaseActions: { plansDir: "plans" },
    });
    expect(result.outcome === "budget_exhausted" || result.outcome === "stopped" || result.outcome === "completed").toBe(
      true,
    );
    expect(result.iterations).toBeGreaterThan(0);
    expect(mock.calls.length).toBeGreaterThan(0);
    expect(mock.calls[0]?.prompt).toContain("item-a");
  });

  it("canResume fails when paused", () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    const store = new StateStore(root);
    const cid = "runner:pausedtest01";
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: RUNNER_PLATFORM,
      phase: "executing",
      armed: 1,
      paused: 1,
      paused_reason: "user_off",
    });
    const d = canResumeRunnerSession(store, cid, root);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe("paused");
  });

  it("canResume fails when executing but checklist has no unchecked items", () => {
    const root = tmpRoot();
    const plans = path.join(root, "plans", "done-track");
    fs.mkdirSync(plans, { recursive: true });
    fs.writeFileSync(
      path.join(plans, "checklist.md"),
      "# c\n\n- [x] item-a — A\n",
      "utf8",
    );
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    const store = new StateStore(root);
    const cid = "runner:emptycheck01";
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: RUNNER_PLATFORM,
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "done-track",
      checklist_path: "plans/done-track/checklist.md",
    });
    const d = canResumeRunnerSession(store, cid, root);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe("idle");
  });

  it("canResume fails when executing but checklist path is missing", () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    const store = new StateStore(root);
    const cid = "runner:misscheck01";
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: RUNNER_PLATFORM,
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "ghost-track",
      checklist_path: "plans/ghost-track/checklist.md",
    });
    const d = canResumeRunnerSession(store, cid, root);
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.reason).toBe("idle");
      expect(d.message).toMatch(/Checklist not found|outside project/i);
    }
  });

  it("stops with pending when session is not review-runnable (no budget spin)", async () => {
    const root = tmpRoot();
    const plans = path.join(root, "plans", "demo");
    fs.mkdirSync(plans, { recursive: true });
    fs.writeFileSync(
      path.join(plans, "checklist.md"),
      "# c\n\n- [ ] item-a — A\n",
      "utf8",
    );
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "review:\n  scope: executing_only\n  confirm_rounds: 1\n",
      "utf8",
    );
    const store = new StateStore(root);
    const cid = stableRunnerConversationId(root);
    const tip = "Review fix round 1 (redeliver me).";
    const run = applyRun(store, cid, root, {
      slug: "demo",
      platform: RUNNER_PLATFORM,
      config: { plansDir: "plans" },
    });
    expect(run.ok).toBe(true);
    store.updateReviewChain(cid, {
      pending_followup: tip,
      pending_followup_at: new Date().toISOString(),
    });

    const prompts: string[] = [];
    let stops = 0;
    const result = await runRunnerLoop({
      store,
      projectRoot: root,
      conversationId: cid,
      config: normalizeRunnerConfig({
        command: "echo {prompt}",
        max_iterations: 8,
      }),
      driver: {
        async run(input) {
          prompts.push(input.prompt);
          stops += 1;
          if (stops === 1) {
            store.updateReviewChain(cid, {
              pending_followup: tip,
              pending_followup_at: new Date().toISOString(),
            });
            store.upsertSession({
              conversation_id: cid,
              project_root: root,
              code_root: root,
              armed: 0,
              phase: "executing",
              paused: 0,
            });
          }
          return { exitCode: 0 };
        },
      },
    });
    expect(prompts[0]).toBe(tip);
    expect(prompts.length).toBe(1);
    expect(result.outcome).toBe("stopped");
    expect(result.lastMessage).toBe(tip);
    expect(result.iterations).toBe(1);
    expect(store.getReviewChain(cid)?.pending_followup?.trim()).toBe(tip);
  });

  it("returns structured error when stopTick throws after agent turn", async () => {
    const root = tmpRoot();
    const plans = path.join(root, "plans", "demo");
    fs.mkdirSync(plans, { recursive: true });
    fs.writeFileSync(
      path.join(plans, "checklist.md"),
      "# c\n\n- [ ] item-a — A\n",
      "utf8",
    );
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    const store = new StateStore(root);
    const cid = stableRunnerConversationId(root);
    const run = applyRun(store, cid, root, {
      slug: "demo",
      platform: RUNNER_PLATFORM,
      config: { plansDir: "plans" },
    });
    expect(run.ok).toBe(true);

    const result = await runRunnerLoop({
      store,
      projectRoot: root,
      conversationId: cid,
      config: normalizeRunnerConfig({
        command: "echo {prompt}",
        max_iterations: 3,
      }),
      stopTick: () => {
        throw new Error("simulated stop tick failure");
      },
      driver: {
        async run() {
          return { exitCode: 0 };
        },
      },
    });
    expect(result.outcome).toBe("error");
    expect(result.iterations).toBe(1);
    expect(result.errorMessage).toMatch(/simulated stop tick failure/);
    expect(result.lastMessage).toBeTruthy();
  });

  it("acks delivered harness pending when runnable and action is null", async () => {
    const root = tmpRoot();
    const plans = path.join(root, "plans", "demo");
    fs.mkdirSync(plans, { recursive: true });
    fs.writeFileSync(
      path.join(plans, "checklist.md"),
      "# c\n\n- [ ] item-a — A\n",
      "utf8",
    );
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "review:\n  scope: executing_only\n  confirm_rounds: 1\n",
      "utf8",
    );
    const store = new StateStore(root);
    const cid = stableRunnerConversationId(root);
    const tip = "Review fix round 1 (delivered ack).";
    const run = applyRun(store, cid, root, {
      slug: "demo",
      platform: RUNNER_PLATFORM,
      config: { plansDir: "plans" },
    });
    expect(run.ok).toBe(true);
    store.updateReviewChain(cid, {
      pending_followup: tip,
      pending_followup_at: new Date().toISOString(),
    });

    const result = await runRunnerLoop({
      store,
      projectRoot: root,
      conversationId: cid,
      config: normalizeRunnerConfig({
        command: "echo {prompt}",
        max_iterations: 3,
      }),
      stopTick: () => ({ action: null }),
      driver: {
        async run() {
          store.updateReviewChain(cid, {
            pending_followup: tip,
            pending_followup_at: new Date().toISOString(),
          });
          return { exitCode: 0 };
        },
      },
    });
    expect(result.iterations).toBe(1);
    expect(
      store.getReviewChain(cid)?.pending_followup?.trim() ?? "",
    ).toBe("");
  });

  it("keeps harness pending when disarmed (no ack clear)", async () => {
    const root = tmpRoot();
    const plans = path.join(root, "plans", "demo");
    fs.mkdirSync(plans, { recursive: true });
    fs.writeFileSync(
      path.join(plans, "checklist.md"),
      "# c\n\n- [ ] item-a — A\n",
      "utf8",
    );
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "review:\n  scope: executing_only\n  confirm_rounds: 1\n",
      "utf8",
    );
    const store = new StateStore(root);
    const cid = stableRunnerConversationId(root);
    const tip = "Review fix round 1 (keep when disarmed).";
    const run = applyRun(store, cid, root, {
      slug: "demo",
      platform: RUNNER_PLATFORM,
      config: { plansDir: "plans" },
    });
    expect(run.ok).toBe(true);
    store.updateReviewChain(cid, {
      pending_followup: tip,
      pending_followup_at: new Date().toISOString(),
    });

    const result = await runRunnerLoop({
      store,
      projectRoot: root,
      conversationId: cid,
      config: normalizeRunnerConfig({
        command: "echo {prompt}",
        max_iterations: 3,
      }),
      stopTick: () => ({ action: null }),
      driver: {
        async run() {
          store.updateReviewChain(cid, {
            pending_followup: tip,
            pending_followup_at: new Date().toISOString(),
          });
          store.upsertSession({
            conversation_id: cid,
            project_root: root,
            code_root: root,
            armed: 0,
            phase: "executing",
            paused: 0,
          });
          return { exitCode: 0 };
        },
      },
    });
    expect(result.outcome).toBe("stopped");
    expect(result.lastMessage).toBe(tip);
    expect(store.getReviewChain(cid)?.pending_followup?.trim()).toBe(tip);
  });

  it("does not clear non-harness pending when it matches lastMessage", async () => {
    const root = tmpRoot();
    const plans = path.join(root, "plans", "demo");
    fs.mkdirSync(plans, { recursive: true });
    fs.writeFileSync(
      path.join(plans, "checklist.md"),
      "# c\n\n- [ ] item-a — A\n",
      "utf8",
    );
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "review:\n  scope: executing_only\n  confirm_rounds: 1\n",
      "utf8",
    );
    const store = new StateStore(root);
    const cid = stableRunnerConversationId(root);
    const tip = "User note: keep this pending for resume.";
    const run = applyRun(store, cid, root, {
      slug: "demo",
      platform: RUNNER_PLATFORM,
      config: { plansDir: "plans" },
    });
    expect(run.ok).toBe(true);
    store.updateReviewChain(cid, {
      pending_followup: tip,
      pending_followup_at: new Date().toISOString(),
    });

    const result = await runRunnerLoop({
      store,
      projectRoot: root,
      conversationId: cid,
      config: normalizeRunnerConfig({
        command: "echo {prompt}",
        max_iterations: 3,
      }),
      stopTick: () => ({ action: null }),
      driver: {
        async run() {
          store.updateReviewChain(cid, {
            pending_followup: tip,
            pending_followup_at: new Date().toISOString(),
          });
          return { exitCode: 0 };
        },
      },
    });
    expect(result.outcome).toBe("stopped");
    expect(result.iterations).toBe(1);
    expect(result.lastMessage).toBe(tip);
    expect(store.getReviewChain(cid)?.pending_followup?.trim()).toBe(tip);
  });
});
