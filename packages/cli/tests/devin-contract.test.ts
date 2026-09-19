/**
 * v0.15 tests-devin-contract — I/O, continue, loopCount, dirty-arm,
 * harness-owned, merge sibling, fingerprint, skills path.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ReviewEngine, StateStore } from "@autopilot-harness/core";
import {
  DEVIN_PLATFORM,
  DEVIN_POST_TOOL_USE_MATCHER,
  devinHookCommandLine,
  handleDevinPostToolUse,
  handleDevinStop,
  handleDevinUserPromptSubmit,
  isDevinHookFingerprint,
} from "@autopilot-harness/port-devin";
import {
  DEVIN_AUTOPILOT_EVENTS,
  DEVIN_HOOK_TIMEOUT_SEC,
  DEVIN_HOOKS_REL_PATH,
  devinHooksContainAutopilot,
  installInitYes,
  mergeDevinHooks,
  runDoctor,
  stripAutopilotDevinHooks,
  uninstallProject,
} from "../src/index.js";
import { AUTOPILOT_SKILL_NAMES } from "../src/init/install.js";

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-devin-contract-"));
}

function writeChecklist(root: string, slug: string, body: string): string {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plan.md"), `# ${slug}\n`);
  const checklist = path.join(dir, "checklist.md");
  fs.writeFileSync(checklist, body);
  return checklist;
}

function gitRepo(root: string): void {
  const git = (args: string[]) => {
    execFileSync("git", args, { cwd: root, stdio: "ignore" });
  };
  git(["init"]);
  git(["config", "user.email", "devin-contract@example.com"]);
  git(["config", "user.name", "devin-contract"]);
  fs.writeFileSync(path.join(root, "README.md"), "init\n");
  git(["add", "README.md"]);
  git(["commit", "-m", "init"]);
}

function spawnDevinHook(
  root: string,
  event: string,
  payload: Record<string, unknown>,
): { status: number; stdout: string } {
  const hook = path.join(
    root,
    ".autopilot",
    "bin",
    "autopilot-harness-hook.mjs",
  );
  const proc = spawnSync(
    process.execPath,
    [hook, "--platform", "devin", "--event", event],
    {
      cwd: root,
      input: JSON.stringify(payload),
      encoding: "utf8",
      timeout: 20_000,
      env: { ...process.env, DEVIN_PROJECT_DIR: root },
    },
  );
  if (proc.error) throw proc.error;
  if (proc.status == null) {
    throw new Error(
      `devin hook spawn killed: event=${event} signal=${proc.signal}`,
    );
  }
  return { status: proc.status, stdout: proc.stdout ?? "" };
}

describe("tests-devin-contract (v0.15)", () => {
  let root: string;

  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("I/O: empty allow, needPick inject, Post never blocks, Stop is block+reason", () => {
    root = tmpProject();
    const installed = installInitYes({
      projectRoot: root,
      platforms: [{ id: "devin", surface: "cli" }],
      locale: "en",
      force: false,
    });
    expect(installed.ok, installed.ok ? "" : installed.error).toBe(true);
    const checklist = writeChecklist(
      root,
      "alpha",
      "# Checklist\n\n- [ ] a — A\n",
    );
    writeChecklist(root, "beta", "# Checklist\n\n- [ ] b — B\n");

    const cid = "devin-contract-io";
    const on = spawnDevinHook(root, "UserPromptSubmit", {
      session_id: cid,
      prompt: "Autopilot ON",
    });
    expect(on.status).toBe(0);
    expect(on.stdout).toBe("");
    const onStore = new StateStore(root);
    expect(onStore.getSession(cid)?.phase).toBe("planning");
    expect(onStore.getSession(cid)?.platform).toBe(DEVIN_PLATFORM);
    onStore.close();

    const pick = spawnDevinHook(root, "UserPromptSubmit", {
      session_id: cid,
      prompt: "Autopilot RUN",
    });
    expect(pick.status).toBe(0);
    const pickOut = JSON.parse(pick.stdout.trim()) as {
      hookSpecificOutput?: {
        hookEventName?: string;
        additionalContext?: string;
      };
      decision?: string;
    };
    expect(pickOut.hookSpecificOutput?.hookEventName).toBe("UserPromptSubmit");
    expect(pickOut.hookSpecificOutput?.additionalContext).toMatch(/\balpha\b/);
    expect(pickOut.hookSpecificOutput?.additionalContext).toMatch(/\bbeta\b/);
    expect(pickOut.decision).toBeUndefined();
    expect(Object.keys(pickOut).sort()).toEqual(["hookSpecificOutput"]);

    const armed = new StateStore(root);
    armed.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: DEVIN_PLATFORM,
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "alpha",
      checklist_path: checklist,
    });
    armed.close();

    const execPost = spawnDevinHook(root, "PostToolUse", {
      session_id: cid,
      tool_name: "exec",
      tool_input: { command: "touch src/from-exec.ts" },
    });
    expect(execPost.status).toBe(0);
    expect(execPost.stdout).toBe("");
    const afterExec = new StateStore(root);
    expect(afterExec.getReviewChain(cid)?.code_edited ?? 0).toBe(0);
    afterExec.close();

    const plansPost = spawnDevinHook(root, "PostToolUse", {
      session_id: cid,
      tool_name: "write",
      tool_input: { path: path.join(root, "plans", "alpha", "plan.md") },
    });
    expect(plansPost.status).toBe(0);
    expect(plansPost.stdout).toBe("");
    const afterPlans = new StateStore(root);
    expect(afterPlans.getReviewChain(cid)?.code_edited ?? 0).toBe(0);
    afterPlans.close();

    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    const editFile = path.join(root, "src", "contract.ts");
    fs.writeFileSync(editFile, "export const n = 1;\n");
    const post = spawnDevinHook(root, "PostToolUse", {
      session_id: cid,
      tool_name: "edit",
      tool_input: { file_path: editFile },
    });
    expect(post.status).toBe(0);
    expect(post.stdout).toBe("");
    expect(post.stdout.trim()).not.toBe("{}");
    const postStore = new StateStore(root);
    expect(postStore.getReviewChain(cid)?.code_edited).toBe(1);
    postStore.close();

    const stop = spawnDevinHook(root, "Stop", {
      session_id: cid,
      stop_hook_active: false,
    });
    expect(stop.status).toBe(0);
    const stopOut = JSON.parse(stop.stdout.trim()) as {
      decision?: string;
      reason?: string;
      continue?: boolean;
    };
    expect(stopOut.decision).toBe("block");
    expect(stopOut.reason).toMatch(/^Review fix/);
    expect(stopOut.continue).toBeUndefined();
    expect(Object.keys(stopOut).sort()).toEqual(["decision", "reason"]);
    const afterStop = new StateStore(root);
    expect(afterStop.getReviewChain(cid)?.chain_pending).toBe(1);
    expect(afterStop.getReviewChain(cid)?.pending_followup).toBe(stopOut.reason);
    afterStop.close();

    const owned = spawnDevinHook(root, "UserPromptSubmit", {
      session_id: cid,
      prompt: `${stopOut.reason} Autopilot ON Autopilot RUN`,
    });
    expect(owned.status).toBe(0);
    expect(owned.stdout).toBe("");
    const afterOwned = new StateStore(root);
    expect(afterOwned.getSession(cid)?.phase).toBe("executing");
    expect(afterOwned.getReviewChain(cid)?.chain_pending).toBe(1);
    expect(afterOwned.getReviewChain(cid)?.pending_followup).toBe(
      stopOut.reason,
    );
    afterOwned.updateReviewChain(cid, { code_edited: 1 });
    afterOwned.close();

    const looped = spawnDevinHook(root, "Stop", {
      session_id: cid,
      stop_hook_active: true,
    });
    expect(looped.status).toBe(0);
    const loopedOut = JSON.parse(looped.stdout.trim()) as {
      decision?: string;
      reason?: string;
      continue?: boolean;
    };
    expect(loopedOut.decision).toBe("block");
    expect(loopedOut.reason).toMatch(/^Review fix/);
    expect(loopedOut.continue).toBeUndefined();
    expect(Object.keys(loopedOut).sort()).toEqual(["decision", "reason"]);
    const afterLoop = new StateStore(root);
    expect(afterLoop.getReviewChain(cid)?.chain_pending).toBe(1);
    expect(afterLoop.getReviewChain(cid)?.pending_followup).toBe(
      loopedOut.reason,
    );
    afterLoop.close();
  });

  it("loopCount maps stop_hook_active; deliver-once is not decision:block", () => {
    const looping = {
      handleStop(input: { loopCount: number; platform?: string }) {
        expect(input.loopCount).toBe(1);
        expect(input.platform).toBe(DEVIN_PLATFORM);
        return { kind: "fix", message: "Review fix round 1", loop: true };
      },
    } as unknown as ReviewEngine;
    expect(
      handleDevinStop(looping, {
        session_id: "devin-loop",
        stop_hook_active: true,
      }),
    ).toEqual({ decision: "block", reason: "Review fix round 1" });

    const once = {
      handleStop(input: { loopCount: number }) {
        expect(input.loopCount).toBe(0);
        return { kind: "stuck", message: "Stuck: wait", loop: false };
      },
    } as unknown as ReviewEngine;
    expect(
      handleDevinStop(once, {
        session_id: "devin-once",
        stop_hook_active: false,
      }),
    ).toEqual({ continue: false, stopReason: "Stuck: wait" });

    const camel = {
      handleStop(input: { loopCount: number }) {
        expect(input.loopCount).toBe(1);
        return { kind: "fix", message: "Review fix round 1", loop: true };
      },
    } as unknown as ReviewEngine;
    expect(
      handleDevinStop(camel, {
        session_id: "devin-camel",
        stop_hook_active: false,
        stopHookActive: true,
      }),
    ).toEqual({ decision: "block", reason: "Review fix round 1" });

    const unparsed = {
      handleStop(input: { loopCount: number }) {
        expect(input.loopCount).toBe(0);
        return { kind: "fix", message: "Review fix round 1", loop: true };
      },
    } as unknown as ReviewEngine;
    expect(
      handleDevinStop(unparsed, {
        session_id: "devin-unparsed",
        stop_hook_active: "true" as unknown as boolean,
      }),
    ).toEqual({ decision: "block", reason: "Review fix round 1" });
  });

  it("dirty-arm: exec and plans do not arm; git dirty product Stop continues", () => {
    root = tmpProject();
    gitRepo(root);
    const checklist = writeChecklist(
      root,
      "trk",
      "# Checklist\n\n- [ ] item-a — A\n",
    );
    const cleanList = writeChecklist(
      root,
      "clean",
      "# Checklist\n\n- [ ] item-clean — C\n",
    );
    const store = new StateStore(root);
    const cid = "devin-dirty";
    const engine = new ReviewEngine(store, {
      projectRoot: root,
      verifyEnabled: false,
      verifyCommands: [],
      recoverDebounceMs: 0,
    });
    try {
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      phase: "executing",
      armed: 1,
      paused: 0,
      checklist_path: checklist,
      track_id: "trk",
      platform: DEVIN_PLATFORM,
    });
    store.upsertSession({
      conversation_id: "devin-clean",
      project_root: root,
      code_root: root,
      phase: "executing",
      armed: 1,
      paused: 0,
      checklist_path: cleanList,
      track_id: "clean",
      platform: DEVIN_PLATFORM,
    });

    const clean = handleDevinStop(engine, {
      session_id: "devin-clean",
      stop_hook_active: false,
    });
    expect(clean.decision).toBe("block");
    expect(clean.reason).toMatch(/^(Need evidence:|Advance checklist)/);
    expect(clean.reason ?? "").not.toMatch(/^Review fix/);

    handleDevinPostToolUse(
      store,
      {
        session_id: cid,
        tool_name: "exec",
        tool_input: { command: "touch src/from-exec.ts" },
      },
      root,
    );
    expect(store.getReviewChain(cid)?.code_edited ?? 0).toBe(0);

    handleDevinPostToolUse(
      store,
      {
        session_id: cid,
        tool_name: "write",
        tool_input: { path: path.join(root, "plans", "trk", "notes.md") },
      },
      root,
    );
    expect(store.getReviewChain(cid)?.code_edited ?? 0).toBe(0);

    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "dirty.ts"), "export const n = 1;\n");
    expect(store.getReviewChain(cid)?.code_edited ?? 0).toBe(0);

    const cont = handleDevinStop(engine, {
      session_id: cid,
      stop_hook_active: false,
    });
    expect(cont.decision).toBe("block");
    expect(cont.reason).toMatch(/^Review fix/);
    expect(cont).not.toHaveProperty("continue");
    expect(Object.keys(cont).sort()).toEqual(["decision", "reason"]);
    expect(store.getReviewChain(cid)?.chain_pending).toBe(1);
    expect(store.getReviewChain(cid)?.pending_followup).toBe(cont.reason);
    } finally {
      store.close();
    }
  });

  it("harness-owned followup is not ON/RUN and keeps chain_pending", () => {
    root = tmpProject();
    const store = StateStore.openMemory(root);
    const cid = "devin-owned";
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      phase: "executing",
      armed: 1,
      track_id: "trk",
      checklist_path: path.join(root, "plans", "trk", "checklist.md"),
      platform: DEVIN_PLATFORM,
    });
    store.updateReviewChain(cid, {
      chain_pending: 1,
      pending_followup: "Review fix round 1",
    });

    const owned = handleDevinUserPromptSubmit(
      store,
      {
        session_id: cid,
        prompt: "Review fix round 1 — Autopilot ON Autopilot RUN",
      },
      root,
    );
    expect(owned).toEqual({});
    expect(store.getSession(cid)?.phase).toBe("executing");
    expect(store.getReviewChain(cid)?.chain_pending).toBe(1);
    expect(store.getReviewChain(cid)?.pending_followup).toBe(
      "Review fix round 1",
    );

    const zh = handleDevinUserPromptSubmit(
      store,
      {
        session_id: cid,
        prompt: "推进下一项：Autopilot RUN v0.15-devin",
      },
      root,
    );
    expect(zh).toEqual({});
    expect(store.getSession(cid)?.phase).toBe("executing");
    expect(store.getReviewChain(cid)?.chain_pending).toBe(1);
    expect(store.getReviewChain(cid)?.pending_followup).toBe(
      "Review fix round 1",
    );

    const ordinary = handleDevinUserPromptSubmit(
      store,
      { session_id: cid, prompt: "ordinary user chat" },
      root,
    );
    expect(ordinary).toEqual({});
    expect(store.getSession(cid)?.phase).toBe("executing");
    expect(store.getReviewChain(cid)?.chain_pending ?? 0).toBe(0);
    expect(store.getReviewChain(cid)?.pending_followup).toBe(
      "Review fix round 1",
    );
    store.close();
  });

  it("merge keeps sibling events and strips only Autopilot commands", () => {
    const merged = mergeDevinHooks({
      description: "keep-me",
      PreToolUse: [
        {
          hooks: [{ type: "command", command: "echo sibling", timeout: 9 }],
        },
      ],
      Stop: [
        {
          hooks: [
            {
              type: "command",
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --platform claude-code --event Stop",
            },
          ],
        },
      ],
    });
    expect(merged.description).toBe("keep-me");
    const preGroups = merged.PreToolUse as Array<{
      hooks?: Array<{ command?: string; timeout?: number }>;
    }>;
    expect(preGroups).toHaveLength(1);
    expect(preGroups[0]?.hooks).toHaveLength(1);
    expect(preGroups[0]?.hooks?.[0]?.command).toBe("echo sibling");
    expect(preGroups[0]?.hooks?.[0]?.timeout).toBe(9);
    expect(JSON.stringify(merged.PreToolUse)).not.toMatch(
      /autopilot-harness-hook/,
    );
    expect(JSON.stringify(merged)).not.toMatch(/claude-code/);
    for (const event of DEVIN_AUTOPILOT_EVENTS) {
      const groups = merged[event] as Array<{
        matcher?: string;
        hooks?: Array<{ command?: string; timeout?: number }>;
      }>;
      expect(groups).toHaveLength(1);
      expect(groups[0]?.hooks).toHaveLength(1);
      const handler = groups[0]?.hooks?.[0];
      expect(handler?.command).toBe(devinHookCommandLine(event));
      expect(handler?.timeout).toBe(DEVIN_HOOK_TIMEOUT_SEC);
      expect(isDevinHookFingerprint(handler?.command)).toBe(true);
      if (event === "PostToolUse") {
        expect(groups[0]?.matcher).toBe(DEVIN_POST_TOOL_USE_MATCHER);
      } else {
        expect(groups[0]?.matcher).toBeUndefined();
      }
    }

    const stripped = stripAutopilotDevinHooks(merged);
    expect(devinHooksContainAutopilot(stripped)).toBe(false);
    for (const event of DEVIN_AUTOPILOT_EVENTS) {
      expect(stripped[event]).toBeUndefined();
    }
    const keptGroups = stripped.PreToolUse as Array<{
      hooks?: Array<{ command?: string; timeout?: number }>;
    }>;
    expect(keptGroups).toHaveLength(1);
    expect(keptGroups[0]?.hooks).toHaveLength(1);
    expect(keptGroups[0]?.hooks?.[0]?.command).toBe("echo sibling");
    expect(keptGroups[0]?.hooks?.[0]?.timeout).toBe(9);
    expect(stripped.description).toBe("keep-me");
  });

  it("fingerprint is independent; skills live only under .devin/skills", () => {
    root = tmpProject();
    const installed = installInitYes({
      projectRoot: root,
      platforms: [{ id: "devin", surface: "cli" }],
      locale: "en",
      force: false,
    });
    expect(installed.ok, installed.ok ? "" : installed.error).toBe(true);

    const line = devinHookCommandLine("Stop");
    expect(isDevinHookFingerprint(line)).toBe(true);
    expect(
      isDevinHookFingerprint(
        "node .autopilot/bin/autopilot-harness-hook.mjs --platform claude-code --event Stop",
      ),
    ).toBe(false);

    const hooksPath = path.join(root, ".devin", "hooks.v1.json");
    const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as Record<
      string,
      | Array<{
          matcher?: string;
          hooks?: Array<{ command?: string; timeout?: number }>;
        }>
      | undefined
    >;
    for (const event of DEVIN_AUTOPILOT_EVENTS) {
      const groups = hooks[event];
      expect(groups).toHaveLength(1);
      expect(groups?.[0]?.hooks).toHaveLength(1);
      const handler = groups?.[0]?.hooks?.[0];
      expect(handler?.command).toBe(devinHookCommandLine(event));
      expect(handler?.timeout).toBe(DEVIN_HOOK_TIMEOUT_SEC);
      expect(isDevinHookFingerprint(handler?.command)).toBe(true);
      if (event === "PostToolUse") {
        expect(groups?.[0]?.matcher).toBe(DEVIN_POST_TOOL_USE_MATCHER);
      } else {
        expect(groups?.[0]?.matcher).toBeUndefined();
      }
    }
    expect(fs.existsSync(path.join(root, ".devin", "config.json"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(root, ".agents", "skills"))).toBe(false);
    const skillNames = fs
      .readdirSync(path.join(root, ".devin", "skills"))
      .sort();
    expect(skillNames).toEqual([...AUTOPILOT_SKILL_NAMES].sort());

    for (const name of skillNames) {
      const skill = path.join(root, ".devin", "skills", name, "SKILL.md");
      expect(fs.existsSync(skill), skill).toBe(true);
      const body = fs.readFileSync(skill, "utf8");
      const triggerLines = body
        .split(/\r?\n/)
        .filter((line) => line.startsWith("triggers:"));
      expect(triggerLines).toEqual(["triggers: [user]"]);
      expect(
        fs.existsSync(path.join(root, ".agents", "skills", name, "SKILL.md")),
      ).toBe(false);
    }

    fs.unlinkSync(hooksPath);
    const missing = runDoctor(root);
    expect(missing.ok).toBe(false);
    expect(missing.lines.join("\n")).toMatch(
      new RegExp(`FAIL\\s+${DEVIN_HOOKS_REL_PATH.replace(/\./g, "\\.")} missing`),
    );
  });

  it("uninstall strips the fingerprint and keeps sibling events", () => {
    root = tmpProject();
    const installed = installInitYes({
      projectRoot: root,
      platforms: [{ id: "devin", surface: "cli" }],
      locale: "en",
      force: false,
    });
    expect(installed.ok, installed.ok ? "" : installed.error).toBe(true);
    const hooksPath = path.join(root, ".devin", "hooks.v1.json");
    const before = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as Record<
      string,
      unknown
    >;
    before.PreToolUse = [
      { hooks: [{ type: "command", command: "echo sibling" }] },
    ];
    fs.writeFileSync(hooksPath, JSON.stringify(before, null, 2) + "\n");
    const configPath = path.join(root, ".devin", "config.json");
    fs.writeFileSync(configPath, '{"keep":true}\n', "utf8");

    const un = uninstallProject({ projectRoot: root, dryRun: false });
    expect(un.ok, un.ok ? "" : un.error).toBe(true);
    expect(fs.readFileSync(configPath, "utf8")).toBe('{"keep":true}\n');
    const after = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(devinHooksContainAutopilot(after)).toBe(false);
    for (const event of DEVIN_AUTOPILOT_EVENTS) {
      expect(after[event]).toBeUndefined();
    }
    const keptGroups = after.PreToolUse as Array<{
      hooks?: Array<{ command?: string }>;
    }>;
    expect(keptGroups).toHaveLength(1);
    expect(keptGroups[0]?.hooks).toHaveLength(1);
    expect(keptGroups[0]?.hooks?.[0]?.command).toBe("echo sibling");
    expect(JSON.stringify(after)).not.toMatch(/autopilot-harness-hook/);
    const skillsRoot = path.join(root, ".devin", "skills");
    if (fs.existsSync(skillsRoot)) {
      for (const name of fs.readdirSync(skillsRoot)) {
        expect(
          fs.existsSync(path.join(skillsRoot, name, "SKILL.md")),
          name,
        ).toBe(false);
      }
    }
  });
});
