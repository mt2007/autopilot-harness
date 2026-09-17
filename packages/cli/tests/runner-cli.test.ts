import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StateStore, applyRun } from "@autopilot-harness/core";
import {
  RUNNER_PLATFORM,
  MockDriver,
  stableRunnerConversationId,
} from "@autopilot-harness/port-runner";
import {
  formatRunnerStatus,
  loadProjectRunnerSettings,
  resolveRunnerConfigForStart,
  startRunner,
} from "../src/runner-cli.js";

const tmpDirs: string[] = [];

function tmpRoot(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ap-cli-runner-"));
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

function writeMinimalConfig(
  root: string,
  runnerBlock = "runner:\n  command: echo {prompt}\n  max_iterations: 4\n",
): void {
  fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".autopilot", "config.yml"),
    `locale: en\nartifacts:\n  plans_dir: plans\nreview:\n  scope: executing_only\n  confirm_rounds: 1\n${runnerBlock}`,
    "utf8",
  );
}

describe("cli runner-cli helpers", () => {
  it("loads runner: from config and lets flags override", () => {
    const root = tmpRoot();
    writeMinimalConfig(
      root,
      "runner:\n  command: from-yaml {prompt}\n  max_iterations: 10\n",
    );
    const loaded = loadProjectRunnerSettings(root);
    expect(loaded.fromYaml.command).toBe("from-yaml {prompt}");
    expect(loaded.plansDir).toBe("plans");

    const resolved = resolveRunnerConfigForStart(root, {
      command: "from-flag {prompt}",
      maxIterations: 3,
    });
    expect(resolved.config.command).toBe("from-flag {prompt}");
    expect(resolved.config.maxIterations).toBe(3);
  });

  it("start without --run fails when nothing is resumable", async () => {
    const root = tmpRoot();
    writeMinimalConfig(root);
    const dbPath = path.join(root, ".autopilot", "state.db");
    expect(fs.existsSync(dbPath)).toBe(false);
    const outcome = await startRunner({
      projectRoot: root,
      // no runSlug → resume path
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toMatch(/No runner session|Nothing to resume|--run/i);
    }
    // Failed resume must not create an empty state.db.
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it("start --run binds track and runs at least one mockable loop turn", async () => {
    const root = tmpRoot();
    writeMinimalConfig(root);
    const plans = path.join(root, "plans", "demo");
    fs.mkdirSync(plans, { recursive: true });
    fs.writeFileSync(
      path.join(plans, "checklist.md"),
      "# c\n\n- [ ] item-a — A\n",
      "utf8",
    );

    const mock = new MockDriver([{ exitCode: 0 }, { exitCode: 0 }]);
    const outcome = await startRunner({
      projectRoot: root,
      runSlug: "demo",
      flags: {
        command: "echo {prompt}",
        maxIterations: 2,
      },
      driver: mock,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.iterations).toBeGreaterThan(0);
      expect(outcome.conversationId).toMatch(/^runner:/);
      expect(mock.calls[0]?.prompt).toContain("item-a");
    }
  });

  it("status reports empty session and resume hint", () => {
    const root = tmpRoot();
    writeMinimalConfig(root, "runner:\n  command: \n");
    const st = formatRunnerStatus({ projectRoot: root });
    expect(st.ok).toBe(true);
    if (st.ok) {
      expect(st.lines.join("\n")).toMatch(/session: \(none\)/);
      expect(st.lines.join("\n")).toMatch(/runner\.command: \(empty/);
    }
  });

  it("status shows can_resume when pending exists", () => {
    const root = tmpRoot();
    writeMinimalConfig(root);
    const plans = path.join(root, "plans", "demo");
    fs.mkdirSync(plans, { recursive: true });
    fs.writeFileSync(
      path.join(plans, "checklist.md"),
      "# c\n\n- [ ] item-a — A\n",
      "utf8",
    );
    const store = new StateStore(root);
    const cid = stableRunnerConversationId(root);
    const run = applyRun(store, cid, root, {
      slug: "demo",
      platform: RUNNER_PLATFORM,
      config: { plansDir: "plans" },
    });
    expect(run.ok).toBe(true);
    store.updateReviewChain(cid, {
      pending_followup: "Review fix round 1 (cli status).",
      pending_followup_at: new Date().toISOString(),
    });
    store.close();

    const st = formatRunnerStatus({ projectRoot: root, conversationId: cid });
    expect(st.ok).toBe(true);
    if (st.ok) {
      expect(st.lines.join("\n")).toMatch(/can_resume: yes \(pending\)/);
    }
  });

  it("start fails early when runner.command is empty and no driver", async () => {
    const root = tmpRoot();
    writeMinimalConfig(root, "runner:\n  command: \n");
    const outcome = await startRunner({
      projectRoot: root,
      runSlug: "demo",
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.exitCode).toBe(1);
      expect(outcome.error).toMatch(/runner\.command is required/i);
    }
  });

  it("start --run without unique track maps needPick to exit 2", async () => {
    const root = tmpRoot();
    writeMinimalConfig(root);
    for (const slug of ["a", "b"]) {
      const plans = path.join(root, "plans", slug);
      fs.mkdirSync(plans, { recursive: true });
      fs.writeFileSync(
        path.join(plans, "checklist.md"),
        `# c\n\n- [ ] item-${slug} — X\n`,
        "utf8",
      );
    }
    const outcome = await startRunner({
      projectRoot: root,
      runSlug: "", // bare --run → needPick when multiple runnable
      flags: { command: "echo {prompt}", maxIterations: 1 },
      driver: new MockDriver([{ exitCode: 0 }]),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.exitCode).toBe(2);
      expect(outcome.error.length).toBeGreaterThan(0);
    }
  });

  it("start --run with whitespace-only slug is bare --run (needPick), not invalid slug", async () => {
    const root = tmpRoot();
    writeMinimalConfig(root);
    for (const slug of ["a", "b"]) {
      const plans = path.join(root, "plans", slug);
      fs.mkdirSync(plans, { recursive: true });
      fs.writeFileSync(
        path.join(plans, "checklist.md"),
        `# c\n\n- [ ] item-${slug} — X\n`,
        "utf8",
      );
    }
    const outcome = await startRunner({
      projectRoot: root,
      runSlug: "  \t  ",
      flags: { command: "echo {prompt}", maxIterations: 1 },
      driver: new MockDriver([{ exitCode: 0 }]),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.exitCode).toBe(2);
      expect(outcome.error).toMatch(/Select a plan to execute/i);
      expect(outcome.error).not.toMatch(/Invalid track slug/i);
    }
  });

  it("start --run trims padded slug before bind", async () => {
    const root = tmpRoot();
    writeMinimalConfig(root);
    const plans = path.join(root, "plans", "demo");
    fs.mkdirSync(plans, { recursive: true });
    fs.writeFileSync(
      path.join(plans, "checklist.md"),
      "# c\n\n- [ ] item-a — A\n",
      "utf8",
    );
    const mock = new MockDriver([{ exitCode: 0 }]);
    const outcome = await startRunner({
      projectRoot: root,
      runSlug: "  demo  ",
      flags: { command: "echo {prompt}", maxIterations: 1 },
      driver: mock,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(mock.calls[0]?.prompt).toContain("item-a");
    const after = new StateStore(root);
    expect(after.getSession(outcome.conversationId)?.track_id).toBe("demo");
    after.close();
  });

  it("refuses symlink .autopilot/config.yml", async () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    const target = path.join(root, "evil.yml");
    fs.writeFileSync(target, "locale: en\n", "utf8");
    fs.symlinkSync(target, path.join(root, ".autopilot", "config.yml"));

    const outcome = await startRunner({
      projectRoot: root,
      runSlug: "demo",
      flags: { command: "echo {prompt}" },
      driver: new MockDriver([{ exitCode: 0 }]),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toMatch(/symlink/i);
    }

    const st = formatRunnerStatus({ projectRoot: root });
    expect(st.ok).toBe(false);
    if (!st.ok) {
      expect(st.error).toMatch(/symlink/i);
    }
  });

  it("status does not create state.db as a side effect", () => {
    const root = tmpRoot();
    writeMinimalConfig(root);
    const dbPath = path.join(root, ".autopilot", "state.db");
    expect(fs.existsSync(dbPath)).toBe(false);

    const st = formatRunnerStatus({ projectRoot: root });
    expect(st.ok).toBe(true);
    if (st.ok) {
      expect(st.lines.join("\n")).toMatch(/session: \(none\)/);
    }
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it("start without --run resumes when pending exists", async () => {
    const root = tmpRoot();
    writeMinimalConfig(root);
    const plans = path.join(root, "plans", "demo");
    fs.mkdirSync(plans, { recursive: true });
    fs.writeFileSync(
      path.join(plans, "checklist.md"),
      "# c\n\n- [ ] item-a — A\n",
      "utf8",
    );
    const store = new StateStore(root);
    const cid = stableRunnerConversationId(root);
    expect(
      applyRun(store, cid, root, {
        slug: "demo",
        platform: RUNNER_PLATFORM,
        config: { plansDir: "plans" },
      }).ok,
    ).toBe(true);
    store.updateReviewChain(cid, {
      pending_followup: "Review fix round 2 (cli resume).",
      pending_followup_at: new Date().toISOString(),
    });
    store.close();

    const mock = new MockDriver([{ exitCode: 0 }]);
    const outcome = await startRunner({
      projectRoot: root,
      conversationId: cid,
      // no runSlug → resume
      flags: { command: "echo {prompt}", maxIterations: 1 },
      driver: mock,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(mock.calls[0]?.prompt).toContain("Review fix round 2");
    }
  });

  it("rejects invalid --prompt-mode", async () => {
    const root = tmpRoot();
    writeMinimalConfig(root);
    const outcome = await startRunner({
      projectRoot: root,
      runSlug: "demo",
      flags: { command: "echo {prompt}", promptMode: "shell" },
      driver: new MockDriver([{ exitCode: 0 }]),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toMatch(/prompt-mode/i);
    }
  });

  it("refuses symlink .autopilot/ directory", async () => {
    const root = tmpRoot();
    const real = path.join(root, "real-ap");
    fs.mkdirSync(real, { recursive: true });
    fs.writeFileSync(
      path.join(real, "config.yml"),
      "locale: en\nrunner:\n  command: echo {prompt}\n",
      "utf8",
    );
    fs.symlinkSync(real, path.join(root, ".autopilot"));

    const outcome = await startRunner({
      projectRoot: root,
      runSlug: "demo",
      flags: { command: "echo {prompt}" },
      driver: new MockDriver([{ exitCode: 0 }]),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toMatch(/symlink/i);
    }
  });

  it("budget_exhausted maps to non-zero exitCode while still ok", async () => {
    const root = tmpRoot();
    writeMinimalConfig(root);
    const plans = path.join(root, "plans", "demo");
    fs.mkdirSync(plans, { recursive: true });
    fs.writeFileSync(
      path.join(plans, "checklist.md"),
      "# c\n\n- [ ] item-a — A\n- [ ] item-b — B\n",
      "utf8",
    );
    // One turn then budget end — leave work unfinished.
    const mock = new MockDriver([{ exitCode: 0 }]);
    const outcome = await startRunner({
      projectRoot: root,
      runSlug: "demo",
      flags: { command: "echo {prompt}", maxIterations: 1 },
      driver: mock,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.outcome).toBe("budget_exhausted");
      expect(outcome.exitCode).toBe(1);
    }
  });

  it("rejects bad --cwd before binding a track", async () => {
    const root = tmpRoot();
    writeMinimalConfig(root);
    const plans = path.join(root, "plans", "demo");
    fs.mkdirSync(plans, { recursive: true });
    fs.writeFileSync(
      path.join(plans, "checklist.md"),
      "# c\n\n- [ ] item-a — A\n",
      "utf8",
    );
    const dbPath = path.join(root, ".autopilot", "state.db");
    const outcome = await startRunner({
      projectRoot: root,
      runSlug: "demo",
      flags: {
        command: "echo {prompt}",
        cwd: path.join("..", "outside-runner-cwd"),
      },
      driver: new MockDriver([{ exitCode: 0 }]),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toMatch(/cwd|project root/i);
    }
    // Must fail before StateStore/applyRun side effects.
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it("rejects non-integer --max-iterations", async () => {
    const root = tmpRoot();
    writeMinimalConfig(root);
    const outcome = await startRunner({
      projectRoot: root,
      runSlug: "demo",
      flags: { command: "echo {prompt}", maxIterations: 2.5 },
      driver: new MockDriver([{ exitCode: 0 }]),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toMatch(/max-iterations/i);
    }
  });

  it("rejects invalid artifacts.plans_dir from config", async () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "locale: en\nartifacts:\n  plans_dir: ../escape\nrunner:\n  command: echo {prompt}\n",
      "utf8",
    );
    expect(() => loadProjectRunnerSettings(root)).toThrow(/plans_dir/i);
    const outcome = await startRunner({
      projectRoot: root,
      runSlug: "demo",
      flags: { command: "echo {prompt}" },
      driver: new MockDriver([{ exitCode: 0 }]),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toMatch(/plans_dir/i);
    }
  });

  it("start without --run resumes executing with unchecked items", async () => {
    const root = tmpRoot();
    writeMinimalConfig(root);
    const plans = path.join(root, "plans", "demo");
    fs.mkdirSync(plans, { recursive: true });
    fs.writeFileSync(
      path.join(plans, "checklist.md"),
      "# c\n\n- [ ] item-a — A\n",
      "utf8",
    );
    const store = new StateStore(root);
    const cid = stableRunnerConversationId(root);
    expect(
      applyRun(store, cid, root, {
        slug: "demo",
        platform: RUNNER_PLATFORM,
        config: { plansDir: "plans" },
      }).ok,
    ).toBe(true);
    store.close();

    const mock = new MockDriver([{ exitCode: 0 }]);
    const outcome = await startRunner({
      projectRoot: root,
      conversationId: cid,
      flags: { command: "echo {prompt}", maxIterations: 1 },
      driver: mock,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(mock.calls[0]?.prompt).toContain("item-a");
    }
  });

  it("start without --run fails when session is paused", async () => {
    const root = tmpRoot();
    writeMinimalConfig(root);
    const plans = path.join(root, "plans", "demo");
    fs.mkdirSync(plans, { recursive: true });
    fs.writeFileSync(
      path.join(plans, "checklist.md"),
      "# c\n\n- [ ] item-a — A\n",
      "utf8",
    );
    const store = new StateStore(root);
    const cid = stableRunnerConversationId(root);
    expect(
      applyRun(store, cid, root, {
        slug: "demo",
        platform: RUNNER_PLATFORM,
        config: { plansDir: "plans" },
      }).ok,
    ).toBe(true);
    const session = store.getSession(cid);
    expect(session).toBeTruthy();
    if (session) {
      store.upsertSession({
        conversation_id: cid,
        project_root: session.project_root,
        code_root: session.code_root,
        track_id: session.track_id,
        checklist_path: session.checklist_path,
        phase: session.phase,
        armed: session.armed,
        paused: 1,
        paused_reason: "human_gate",
      });
    }
    store.close();

    const outcome = await startRunner({
      projectRoot: root,
      conversationId: cid,
      flags: { command: "echo {prompt}" },
      driver: new MockDriver([{ exitCode: 0 }]),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toMatch(/paused/i);
    }
    const afterBare = new StateStore(root);
    expect(afterBare.getSession(cid)?.paused).toBe(1);
    afterBare.close();
  });

  it("start --run fails when session is paused (does not clear pause)", async () => {
    const root = tmpRoot();
    writeMinimalConfig(root);
    const plans = path.join(root, "plans", "demo");
    fs.mkdirSync(plans, { recursive: true });
    fs.writeFileSync(
      path.join(plans, "checklist.md"),
      "# c\n\n- [ ] item-a — A\n",
      "utf8",
    );
    const store = new StateStore(root);
    const cid = stableRunnerConversationId(root);
    expect(
      applyRun(store, cid, root, {
        slug: "demo",
        platform: RUNNER_PLATFORM,
        config: { plansDir: "plans" },
      }).ok,
    ).toBe(true);
    const session = store.getSession(cid);
    expect(session).toBeTruthy();
    if (session) {
      store.upsertSession({
        conversation_id: cid,
        project_root: session.project_root,
        code_root: session.code_root,
        track_id: session.track_id,
        checklist_path: session.checklist_path,
        phase: session.phase,
        armed: session.armed,
        paused: 1,
        paused_reason: "human_gate",
      });
    }
    store.close();

    const outcome = await startRunner({
      projectRoot: root,
      conversationId: cid,
      runSlug: "demo",
      flags: { command: "echo {prompt}" },
      driver: new MockDriver([{ exitCode: 0 }]),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      // Early paused gate (before resolveRunSlug / needPick).
      expect(outcome.error).toMatch(/session paused/i);
    }
    // Still paused — --run must not clear pause on the failed path.
    const after = new StateStore(root);
    expect(after.getSession(cid)?.paused).toBe(1);
    after.close();
  });

  it("bare --run on paused session is exit 1 paused (not needPick)", async () => {
    const root = tmpRoot();
    writeMinimalConfig(root);
    for (const slug of ["a", "b"]) {
      const plans = path.join(root, "plans", slug);
      fs.mkdirSync(plans, { recursive: true });
      fs.writeFileSync(
        path.join(plans, "checklist.md"),
        `# c\n\n- [ ] item-${slug} — X\n`,
        "utf8",
      );
    }
    const store = new StateStore(root);
    const cid = "runner:paused-multi";
    expect(
      applyRun(store, cid, root, {
        slug: "a",
        platform: RUNNER_PLATFORM,
        config: { plansDir: "plans" },
      }).ok,
    ).toBe(true);
    const session = store.getSession(cid);
    expect(session).toBeTruthy();
    if (session) {
      store.upsertSession({
        conversation_id: cid,
        project_root: session.project_root,
        code_root: session.code_root,
        track_id: session.track_id,
        checklist_path: session.checklist_path,
        phase: session.phase,
        armed: session.armed,
        paused: 1,
        paused_reason: "human_gate",
      });
    }
    store.close();

    const outcome = await startRunner({
      projectRoot: root,
      conversationId: cid,
      runSlug: "", // bare --run — must not become needPick while paused
      flags: { command: "echo {prompt}" },
      driver: new MockDriver([{ exitCode: 0 }]),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.exitCode).toBe(1);
      expect(outcome.exitCode).not.toBe(2);
      expect(outcome.error).toMatch(/session paused/i);
      expect(outcome.error).not.toMatch(/Select a plan to execute/i);
    }
    const after = new StateStore(root);
    expect(after.getSession(cid)?.paused).toBe(1);
    after.close();
  });

  it("start --run hits one_executor busy as exit 1 (not needPick)", async () => {
    const root = tmpRoot();
    writeMinimalConfig(root);
    const plans = path.join(root, "plans", "demo");
    fs.mkdirSync(plans, { recursive: true });
    fs.writeFileSync(
      path.join(plans, "checklist.md"),
      "# c\n\n- [ ] item-a — A\n",
      "utf8",
    );
    const store = new StateStore(root);
    const holder = "runner:holder-session";
    expect(
      applyRun(store, holder, root, {
        slug: "demo",
        platform: RUNNER_PLATFORM,
        config: { plansDir: "plans" },
      }).ok,
    ).toBe(true);
    const held = store.getSession(holder);
    expect(held?.phase).toBe("executing");
    expect(held?.armed).toBe(1);
    expect(held?.paused).toBe(0);
    store.close();

    const mock = new MockDriver([{ exitCode: 0 }]);
    const outcome = await startRunner({
      projectRoot: root,
      conversationId: "runner:challenger-session",
      runSlug: "demo",
      flags: { command: "echo {prompt}" },
      driver: mock,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.exitCode).toBe(1);
      expect(outcome.exitCode).not.toBe(2);
      expect(outcome.error).toMatch(/already executing|Another session/i);
      // Real needPick copy (not the flag name) — must not appear on busy.
      expect(outcome.error).not.toMatch(
        /Select a plan to execute|Reply with a number|\/autopilot-run/i,
      );
    }
    expect(mock.calls.length).toBe(0);
    // Challenger may be ensureSession'd idle, but must not take the executor lock;
    // holder must still own it.
    const after = new StateStore(root);
    const challenger = after.getSession("runner:challenger-session");
    expect(challenger).toBeTruthy();
    expect(challenger!.armed).toBe(0);
    expect(challenger!.phase).toBe("idle");
    const stillHeld = after.getSession(holder);
    expect(stillHeld).toBeTruthy();
    expect(stillHeld!.phase).toBe("executing");
    expect(stillHeld!.armed).toBe(1);
    expect(stillHeld!.paused).toBe(0);
    expect(
      after.findExecutingSession("runner:challenger-session")?.conversation_id,
    ).toBe(holder);
    after.close();
  });

  it("rejects control-bearing --conversation before creating state.db", async () => {
    const root = tmpRoot();
    writeMinimalConfig(root);
    const dbPath = path.join(root, ".autopilot", "state.db");
    const outcome = await startRunner({
      projectRoot: root,
      runSlug: "demo",
      conversationId: "runner:\nbad",
      flags: { command: "echo {prompt}" },
      driver: new MockDriver([{ exitCode: 0 }]),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toMatch(/conversation/i);
    }
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it("status rejects control-bearing --conversation without a state.db", () => {
    const root = tmpRoot();
    writeMinimalConfig(root);
    const st = formatRunnerStatus({
      projectRoot: root,
      conversationId: "runner:\nbad",
    });
    expect(st.ok).toBe(false);
    if (!st.ok) {
      expect(st.error).toMatch(/conversation/i);
    }
    expect(fs.existsSync(path.join(root, ".autopilot", "state.db"))).toBe(
      false,
    );
  });

  it("rejects --max-iterations below 1", async () => {
    const root = tmpRoot();
    writeMinimalConfig(root);
    const outcome = await startRunner({
      projectRoot: root,
      runSlug: "demo",
      flags: { command: "echo {prompt}", maxIterations: 0 },
      driver: new MockDriver([{ exitCode: 0 }]),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toMatch(/max-iterations/i);
    }
  });

  it("fails closed when config.yml is corrupt YAML", async () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "locale: en\nrunner: [\n  broken",
      "utf8",
    );
    expect(() => loadProjectRunnerSettings(root)).toThrow(/YAML|mapping/i);
    const outcome = await startRunner({
      projectRoot: root,
      runSlug: "demo",
      flags: { command: "echo {prompt}" },
      driver: new MockDriver([{ exitCode: 0 }]),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toMatch(/YAML|mapping/i);
    }
  });

  it("fails closed when config.yml root is not a mapping", async () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "- just\n- a\n- list\n",
      "utf8",
    );
    expect(() => loadProjectRunnerSettings(root)).toThrow(/mapping/i);
  });

  it("fails closed on unsupported locale in config.yml", async () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "locale: zh_CN\nrunner:\n  command: echo {prompt}\n",
      "utf8",
    );
    expect(() => loadProjectRunnerSettings(root)).toThrow(/locale/i);
    const outcome = await startRunner({
      projectRoot: root,
      runSlug: "demo",
      flags: { command: "echo {prompt}" },
      driver: new MockDriver([{ exitCode: 0 }]),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toMatch(/locale/i);
    }
  });

  it("strips unsafe keys from runner.env before normalize", () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "locale: en\nrunner:\n  command: echo {prompt}\n  env:\n    SAFE: ok\n    __proto__: evil\n    constructor: nope\n",
      "utf8",
    );
    const resolved = resolveRunnerConfigForStart(root);
    expect(resolved.config.env.SAFE).toBe("ok");
    expect(
      Object.prototype.hasOwnProperty.call(resolved.config.env, "__proto__"),
    ).toBe(false);
    expect(
      Object.prototype.hasOwnProperty.call(resolved.config.env, "constructor"),
    ).toBe(false);
  });

  it("fails closed on invalid runner.prompt_mode in config.yml", async () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "locale: en\nrunner:\n  command: echo {prompt}\n  prompt_mode: shell\n",
      "utf8",
    );
    expect(() => loadProjectRunnerSettings(root)).toThrow(/prompt_mode/i);
    const outcome = await startRunner({
      projectRoot: root,
      runSlug: "demo",
      flags: { command: "echo {prompt}" },
      driver: new MockDriver([{ exitCode: 0 }]),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toMatch(/prompt_mode/i);
    }
  });

  it("fails closed on runner.max_iterations below 1 in config.yml", async () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "locale: en\nrunner:\n  command: echo {prompt}\n  max_iterations: 0\n",
      "utf8",
    );
    expect(() => loadProjectRunnerSettings(root)).toThrow(/max_iterations/i);
    const outcome = await startRunner({
      projectRoot: root,
      runSlug: "demo",
      flags: { command: "echo {prompt}" },
      driver: new MockDriver([{ exitCode: 0 }]),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toMatch(/max_iterations/i);
    }
  });
});
