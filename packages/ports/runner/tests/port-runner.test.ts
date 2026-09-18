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
  resolveInitialPrompt,
  RUNNER_RESUME_START_HINT,
  shouldContinueAfterStop,
  stableRunnerConversationId,
  tokenizeCommandTemplate,
  CliDriver,
  MockDriver,
  type ResolveInitialPromptOptions,
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

describe("resolveInitialPrompt phase branch", () => {
  it("prefers pending tip over phase", () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    const store = new StateStore(root);
    const cid = "runner:resolvepend01";
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
    store.updateReviewChain(cid, {
      pending_followup: "Review fix round 1: pending wins",
      pending_followup_at: new Date().toISOString(),
    });
    const tip = resolveInitialPrompt({
      store,
      conversationId: cid,
      projectRoot: root,
      planningBrief: "should-not-appear",
    });
    expect(tip).toContain("pending wins");
    expect(tip).not.toContain("should-not-appear");
    expect(tip).not.toMatch(/Autopilot Runner — planning/i);
  });

  it("uses planning builder when phase=planning and no pending", () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    const store = new StateStore(root);
    const cid = "runner:resolveplan01";
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
    const tip = resolveInitialPrompt({
      store,
      conversationId: cid,
      projectRoot: root,
      planningBrief: "ship --on",
      planningMessage: "Q1: yes",
    });
    expect(tip).toMatch(/Autopilot Runner — planning/i);
    expect(tip).toContain("Track: v0.13-runner-on");
    expect(tip).toContain("ship --on");
    expect(tip).toContain("Q1: yes");
  });

  it("uses executing firstUnchecked path when phase=executing", () => {
    const root = tmpRoot();
    const plans = path.join(root, "plans", "exec-track");
    fs.mkdirSync(plans, { recursive: true });
    fs.writeFileSync(
      path.join(plans, "checklist.md"),
      "# c\n\n- [ ] item-a — A\n",
      "utf8",
    );
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    const store = new StateStore(root);
    const cid = "runner:resolveexec01";
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: RUNNER_PLATFORM,
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "exec-track",
      checklist_path: "plans/exec-track/checklist.md",
    });
    const tip = resolveInitialPrompt({
      store,
      conversationId: cid,
      projectRoot: root,
    });
    expect(tip).toMatch(/Autopilot Runner — executing/i);
    expect(tip).toContain("item-a");
  });

  it("throws for idle/done without pending", () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    const store = new StateStore(root);
    const cid = "runner:resolveidle01";
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: RUNNER_PLATFORM,
      phase: "idle",
      armed: 0,
      paused: 0,
    });
    expect(() =>
      resolveInitialPrompt({
        store,
        conversationId: cid,
        projectRoot: root,
      }),
    ).toThrow(/phase is "idle"/i);
  });

  it("throws for invalid options", () => {
    expect(() =>
      resolveInitialPrompt(null as unknown as ResolveInitialPromptOptions),
    ).toThrow(/invalid resolveInitialPrompt options/i);
  });

  it("treats _pending planning track as unset slug", () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    const store = new StateStore(root);
    const cid = "runner:resolvependingtrack";
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
    const tip = resolveInitialPrompt({
      store,
      conversationId: cid,
      projectRoot: root,
    });
    expect(tip).toMatch(/Autopilot Runner — planning/i);
    expect(tip).toMatch(/Track: \(unset/i);
    expect(tip).not.toContain("_pending");
  });
});

describe("canResumeRunnerSession planning", () => {
  it("succeeds for phase=planning when unpaused", () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    const store = new StateStore(root);
    const cid = "runner:resumeplan01";
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
    const d = canResumeRunnerSession(store, cid, root);
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.reason).toBe("planning");
  });

  it("fails for paused planning session", () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    const store = new StateStore(root);
    const cid = "runner:resumeplanpaused";
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: RUNNER_PLATFORM,
      phase: "planning",
      armed: 0,
      paused: 1,
      paused_reason: "user_off",
    });
    const d = canResumeRunnerSession(store, cid, root);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe("paused");
  });

  it("prefers pending tip over planning reason", () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    const store = new StateStore(root);
    const cid = "runner:resumeplanpend";
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
    store.updateReviewChain(cid, {
      pending_followup: "Review fix round 1: pending wins resume",
      pending_followup_at: new Date().toISOString(),
    });
    const d = canResumeRunnerSession(store, cid, root);
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.reason).toBe("pending");
  });

  it("idle/missing hints mention --on / --message / --brief and keep --run", () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    const store = new StateStore(root);
    const missing = canResumeRunnerSession(store, "runner:nosession99", root);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.reason).toBe("missing");
      expect(missing.message).toContain(RUNNER_RESUME_START_HINT);
      expect(missing.message).toContain("--on");
      expect(missing.message).toContain("--message");
      expect(missing.message).toContain("--brief");
      expect(missing.message).toContain("--run");
    }

    const cid = "runner:resumeidle01";
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: RUNNER_PLATFORM,
      phase: "idle",
      armed: 0,
      paused: 0,
    });
    const idle = canResumeRunnerSession(store, cid, root);
    expect(idle.ok).toBe(false);
    if (!idle.ok) {
      expect(idle.reason).toBe("idle");
      expect(idle.message).toContain(RUNNER_RESUME_START_HINT);
      expect(idle.message).toContain("--on");
      expect(idle.message).toContain("--message");
      expect(idle.message).toContain("--brief");
      expect(idle.message).toContain("--run");
    }
  });
});

describe("runRunnerLoop planning-on path", () => {
  it("loop source never imports or calls applyOn (CLI-only --on)", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../src/loop.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/\bapplyOn\s*\(/);
    expect(src).not.toMatch(/import\s*\{[^}]*\bapplyOn\b/);
    expect(src).toMatch(/\bapplyRun\b/);
    expect(src).toMatch(/planningBrief/);
    expect(src).toMatch(/planningMessage/);
  });

  it("enters loop with planningBrief/message and always stop-ticks", async () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "review:\n  scope: executing_only\n  confirm_rounds: 1\n",
      "utf8",
    );
    const store = new StateStore(root);
    const cid = "runner:looponplan01";
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
    const mock = new MockDriver([{ exitCode: 0 }]);
    let stopTicks = 0;
    const result = await runRunnerLoop({
      store,
      projectRoot: root,
      conversationId: cid,
      config: normalizeRunnerConfig({
        command: "echo {prompt}",
        max_iterations: 2,
      }),
      // No runSlug — CLI already applied --on; resume planning.
      planningBrief: "ship runner --on",
      planningMessage: "Q1: yes",
      driver: mock,
      stopTick: (s, r, payload, locale) => {
        stopTicks += 1;
        return runStopTick(s, r, payload, locale);
      },
    });
    expect(result.outcome).toBe("stopped");
    expect(result.iterations).toBe(1);
    expect(stopTicks).toBe(1);
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.prompt).toMatch(/Autopilot Runner — planning/i);
    expect(mock.calls[0]?.prompt).toContain("Track: v0.13-runner-on");
    expect(mock.calls[0]?.prompt).toContain("ship runner --on");
    expect(mock.calls[0]?.prompt).toContain("Q1: yes");
    expect(store.getSession(cid)?.phase).toBe("planning");
  });

  it("--run path ignores planningBrief/message (executing prompt unchanged)", async () => {
    const root = tmpRoot();
    const plans = path.join(root, "plans", "loop-run-reg");
    fs.mkdirSync(plans, { recursive: true });
    fs.writeFileSync(
      path.join(plans, "checklist.md"),
      "# c\n\n- [ ] item-run — R\n",
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
    const mock = new MockDriver([{ exitCode: 0 }]);
    const result = await runRunnerLoop({
      store,
      projectRoot: root,
      conversationId: cid,
      config: normalizeRunnerConfig({
        command: "echo {prompt}",
        max_iterations: 1,
      }),
      runSlug: "loop-run-reg",
      planningBrief: "MUST-NOT-APPEAR-BRIEF",
      planningMessage: "MUST-NOT-APPEAR-MSG",
      driver: mock,
      phaseActions: { plansDir: "plans" },
    });
    expect(["stopped", "budget_exhausted", "completed"]).toContain(
      result.outcome,
    );
    expect(result.iterations).toBeGreaterThan(0);
    expect(mock.calls[0]?.prompt).toMatch(/Autopilot Runner — executing/i);
    expect(mock.calls[0]?.prompt).toContain("item-run");
    expect(mock.calls[0]?.prompt).not.toContain("MUST-NOT-APPEAR-BRIEF");
    expect(mock.calls[0]?.prompt).not.toContain("MUST-NOT-APPEAR-MSG");
    expect(mock.calls[0]?.prompt).not.toMatch(/Autopilot Runner — planning/i);
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
