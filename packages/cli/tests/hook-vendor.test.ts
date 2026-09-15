import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StateStore } from "@autopilot-harness/core";
import { installInitYes } from "../src/init/install.js";
import { runDoctor } from "../src/status-doctor.js";

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-hook-vendor-"));
}

function runBeforeSubmit(
  root: string,
  payload: Record<string, unknown>,
): { status: number | null; out: Record<string, unknown> } {
  const hook = path.join(
    root,
    ".autopilot",
    "bin",
    "autopilot-harness-hook.mjs",
  );
  const proc = spawnSync(
    process.execPath,
    [hook, "--event", "beforeSubmitPrompt"],
    {
      cwd: root,
      input: JSON.stringify(payload),
      encoding: "utf8",
      timeout: 15_000,
    },
  );
  let out: Record<string, unknown> = {};
  try {
    out = JSON.parse(proc.stdout.trim() || "{}") as Record<string, unknown>;
  } catch {
    out = { __parse_error: proc.stdout };
  }
  return { status: proc.status, out };
}

describe("hook vendor runtime", () => {
  let root: string;
  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("init copies vendor and hook runs without project node_modules", () => {
    root = tmpProject();
    const result = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(true);

    const vendor = path.join(
      root,
      ".autopilot",
      "bin",
      "vendor",
      "runtime.mjs",
    );
    const mig = path.join(
      root,
      ".autopilot",
      "bin",
      "vendor",
      "migrations",
      "001_initial.sql",
    );
    expect(fs.existsSync(vendor)).toBe(true);
    expect(fs.existsSync(mig)).toBe(true);
    // Empty consumer project: no node_modules with @autopilot-harness/*
    expect(fs.existsSync(path.join(root, "node_modules"))).toBe(false);

    const doctor = runDoctor(root);
    expect(doctor.lines.join("\n")).toMatch(/OK\s+hook vendor runtime/);

    const hook = path.join(
      root,
      ".autopilot",
      "bin",
      "autopilot-harness-hook.mjs",
    );
    const cid = "hook-vend-aaaa-bbbb-cccc-ddddeeee0001";
    const proc = spawnSync(
      process.execPath,
      [hook, "--event", "beforeSubmitPrompt"],
      {
        cwd: root,
        input: JSON.stringify({
          conversation_id: cid,
          prompt: "hello from smoke",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(proc.status).toBe(0);
    const out = JSON.parse(proc.stdout.trim() || "{}") as {
      continue?: boolean;
    };
    expect(out.continue).toBe(true);
    // Vendor path opened state.db (fail-open would not create it).
    expect(fs.existsSync(path.join(root, ".autopilot", "state.db"))).toBe(true);
  });

  it("vendor beforeSubmitPrompt busy block emits snake_case user_message", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const planDir = path.join(root, "plans", "demo");
    fs.mkdirSync(planDir, { recursive: true });
    fs.writeFileSync(path.join(planDir, "plan.md"), "# demo\n");
    fs.writeFileSync(path.join(planDir, "checklist.md"), "- [ ] a — A\n");

    const owner = "hook-busy-aaaa-bbbb-cccc-ddddeeee0001";
    const peer = "hook-busy-aaaa-bbbb-cccc-ddddeeee0002";

    const armed = runBeforeSubmit(root, {
      conversation_id: owner,
      prompt: "/autopilot-run demo",
    });
    expect(armed.status).toBe(0);
    expect(armed.out).toEqual({ continue: true });

    const busy = runBeforeSubmit(root, {
      conversation_id: peer,
      prompt: "/autopilot-run demo",
    });
    expect(busy.status).toBe(0);
    expect(busy.out.continue).toBe(false);
    expect(typeof busy.out.user_message).toBe("string");
    expect(String(busy.out.user_message)).toMatch(/already executing/i);
    expect(String(busy.out.user_message)).toMatch(/track:\s*demo/i);
    expect(String(busy.out.user_message)).toMatch(/session:/i);
    expect(String(busy.out.user_message)).toMatch(/cli status/i);
    expect(String(busy.out.user_message)).toMatch(/cli doctor/i);
    expect(busy.out.userMessage).toBe(busy.out.user_message);
    expect(Object.keys(busy.out).sort()).toEqual(
      ["continue", "userMessage", "user_message"].sort(),
    );
  });

  it("vendor UserPromptSubmit needPick injects additionalContext (no block)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "claude-code",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    for (const slug of ["alpha", "beta"] as const) {
      const planDir = path.join(root, "plans", slug);
      fs.mkdirSync(planDir, { recursive: true });
      fs.writeFileSync(path.join(planDir, "plan.md"), `# ${slug}\n`);
      fs.writeFileSync(path.join(planDir, "checklist.md"), "- [ ] a — A\n");
    }

    const hook = path.join(
      root,
      ".autopilot",
      "bin",
      "autopilot-harness-hook.mjs",
    );
    const cid = "hook-pick-aaaa-bbbb-cccc-ddddeeee0001";
    const proc = spawnSync(
      process.execPath,
      [hook, "--event", "UserPromptSubmit", "--platform", "claude-code"],
      {
        cwd: root,
        input: JSON.stringify({
          session_id: cid,
          prompt: "/autopilot-run",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(proc.status).toBe(0);
    const out = JSON.parse(proc.stdout.trim() || "{}") as {
      decision?: string;
      reason?: string;
      continue?: boolean;
      hookSpecificOutput?: {
        hookEventName?: string;
        additionalContext?: string;
      };
    };
    expect(out.decision).toBeUndefined();
    expect(out.reason).toBeUndefined();
    expect(out.continue).toBeUndefined();
    expect(Object.keys(out)).toEqual(["hookSpecificOutput"]);
    expect(out.hookSpecificOutput?.hookEventName).toBe("UserPromptSubmit");
    const ctx = out.hookSpecificOutput?.additionalContext ?? "";
    expect(ctx).toMatch(/Select a plan/i);
    expect(ctx).toMatch(/alpha/);
    expect(ctx).toMatch(/beta/);

    const store = new StateStore(root);
    const s = store.getSession(cid)!;
    // Fresh session stays idle/planning — never executing on needPick
    expect(s.phase).not.toBe("executing");
    expect(s.armed).toBe(0);
    expect(s.pending_action).toBe("run");
    expect(s.track_candidates_json).toBeTruthy();
    store.close();
  });

  it("ternary --platform codex routes to Codex handlers (not Claude)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const hook = path.join(
      root,
      ".autopilot",
      "bin",
      "autopilot-harness-hook.mjs",
    );
    const planDir = path.join(root, "plans", "codex-wire");
    fs.mkdirSync(planDir, { recursive: true });
    fs.writeFileSync(path.join(planDir, "plan.md"), "# codex-wire\n");
    fs.writeFileSync(path.join(planDir, "checklist.md"), "- [ ] a — A\n");

    const cid = "hook-codex-aaaa-bbbb-cccc-ddddeeee0001";
    const onProc = spawnSync(
      process.execPath,
      [hook, "--event", "UserPromptSubmit", "--platform", "codex"],
      {
        cwd: root,
        input: JSON.stringify({
          session_id: cid,
          prompt: "/autopilot-on codex-wire",
          permission_mode: "plan",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(onProc.status).toBe(0);
    expect(JSON.parse(onProc.stdout.trim() || "{}")).toEqual({});

    const store = new StateStore(root);
    expect(store.getSession(cid)?.platform).toBe("codex");
    expect(store.getSession(cid)?.phase).toBe("planning");
    store.close();

    // Stop with PascalCase + stop_hook_active must still honor --platform codex
    // (shape is shared with Claude; must not call Claude recover path wrongly).
    const stopProc = spawnSync(
      process.execPath,
      [hook, "--event", "Stop", "--platform", "codex"],
      {
        cwd: root,
        input: JSON.stringify({
          session_id: cid,
          hook_event_name: "Stop",
          stop_hook_active: false,
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(stopProc.status).toBe(0);
    const stopOut = JSON.parse(stopProc.stdout.trim() || "{}") as Record<
      string,
      unknown
    >;
    // Idle planning stop → allow stop (no Autopilot followup required).
    expect(stopOut.decision).toBeUndefined();
    expect(stopOut.continue).toBeUndefined();

    // Armed executing + code_edited → Codex continuing followup (block, never continue:false).
    const armedStore = new StateStore(root);
    armedStore.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: "codex",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "codex-wire",
      checklist_path: path.join(planDir, "checklist.md"),
    });
    armedStore.updateReviewChain(cid, { code_edited: 1 });
    armedStore.close();

    const armedStop = spawnSync(
      process.execPath,
      [hook, "--event", "Stop", "--platform", "codex"],
      {
        cwd: root,
        input: JSON.stringify({
          session_id: cid,
          hook_event_name: "Stop",
          stop_hook_active: false,
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(armedStop.status).toBe(0);
    const armedOut = JSON.parse(armedStop.stdout.trim() || "{}") as Record<
      string,
      unknown
    >;
    expect(armedOut.decision).toBe("block");
    expect(armedOut.reason).toBeTruthy();
    expect(armedOut.continue).toBeUndefined();
    expect(armedOut.followup_message).toBeUndefined();

    // Universal abort: Codex stamp + Cursor-shaped aborted payload → halt {}.
    const abortStop = spawnSync(
      process.execPath,
      [hook, "--event", "Stop", "--platform", "codex"],
      {
        cwd: root,
        input: JSON.stringify({
          conversation_id: cid,
          status: "aborted",
          hook_event_name: "stop",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(abortStop.status).toBe(0);
    expect(JSON.parse(abortStop.stdout.trim() || "{}")).toEqual({});

    // PostToolUse Write must arm via Codex alias (not no-op / Claude confusion).
    const cidEdit = "hook-codex-aaaa-bbbb-cccc-ddddeeee0002";
    spawnSync(
      process.execPath,
      [hook, "--event", "UserPromptSubmit", "--platform", "codex"],
      {
        cwd: root,
        input: JSON.stringify({
          session_id: cidEdit,
          prompt: "/autopilot-on codex-wire",
          permission_mode: "plan",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    const editStore = new StateStore(root);
    editStore.upsertSession({
      conversation_id: cidEdit,
      project_root: root,
      code_root: root,
      platform: "codex",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "codex-wire",
      checklist_path: path.join(planDir, "checklist.md"),
    });
    editStore.close();
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    const editProc = spawnSync(
      process.execPath,
      [hook, "--event", "PostToolUse", "--platform", "codex"],
      {
        cwd: root,
        input: JSON.stringify({
          session_id: cidEdit,
          tool_name: "Write",
          tool_input: { file_path: path.join(root, "src", "app.ts") },
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(editProc.status).toBe(0);
    const verifyEdit = new StateStore(root);
    expect(verifyEdit.getReviewChain(cidEdit)?.code_edited).toBe(1);
    expect(verifyEdit.getSession(cidEdit)?.platform).toBe("codex");
    verifyEdit.close();
  });

  it("quaternary --platform kimi-code routes exit2/stderr Stop (not Claude JSON)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const hook = path.join(
      root,
      ".autopilot",
      "bin",
      "autopilot-harness-hook.mjs",
    );
    const planDir = path.join(root, "plans", "kimi-wire");
    fs.mkdirSync(planDir, { recursive: true });
    fs.writeFileSync(path.join(planDir, "plan.md"), "# kimi-wire\n");
    fs.writeFileSync(path.join(planDir, "checklist.md"), "- [ ] a — A\n");

    const cid = "hook-kimi-aaaa-bbbb-cccc-ddddeeee0001";
    const onProc = spawnSync(
      process.execPath,
      [hook, "--event", "UserPromptSubmit", "--platform", "kimi-code"],
      {
        cwd: root,
        input: JSON.stringify({
          session_id: cid,
          prompt: "/autopilot-on kimi-wire",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(onProc.status).toBe(0);
    expect(onProc.stdout.trim()).toBe("");

    const store = new StateStore(root);
    expect(store.getSession(cid)?.platform).toBe("kimi-code");
    expect(store.getSession(cid)?.phase).toBe("planning");
    store.close();

    const armedStore = new StateStore(root);
    armedStore.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: "kimi-code",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "kimi-wire",
      checklist_path: path.join(planDir, "checklist.md"),
    });
    armedStore.updateReviewChain(cid, { code_edited: 1 });
    armedStore.close();

    const armedStop = spawnSync(
      process.execPath,
      [hook, "--event", "Stop", "--platform", "kimi-code"],
      {
        cwd: root,
        input: JSON.stringify({
          session_id: cid,
          hook_event_name: "Stop",
          stop_hook_active: false,
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(armedStop.status).toBe(2);
    expect(armedStop.stderr.trim().length).toBeGreaterThan(0);
    expect(armedStop.stdout.trim()).toBe("");
    expect(armedStop.stderr).not.toMatch(/"decision"\s*:\s*"block"/);

    // Universal abort: Kimi stamp + Cursor-shaped aborted → halt with bare
    // exit 0 (no JSON "{}" on stdout — that would pollute Kimi context).
    const abortStop = spawnSync(
      process.execPath,
      [hook, "--event", "Stop", "--platform", "kimi-code"],
      {
        cwd: root,
        input: JSON.stringify({
          conversation_id: cid,
          status: "aborted",
          hook_event_name: "stop",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(abortStop.status).toBe(0);
    expect(abortStop.stdout.trim()).toBe("");
    expect(abortStop.stderr.trim()).toBe("");

    // needPick Channel A: exit 0 + stdout context (never Claude JSON block).
    for (const slug of ["kimi-alpha", "kimi-beta"] as const) {
      const d = path.join(root, "plans", slug);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, "plan.md"), `# ${slug}\n`);
      fs.writeFileSync(path.join(d, "checklist.md"), "- [ ] a — A\n");
    }
    const pickCid = "hook-kimi-aaaa-bbbb-cccc-ddddeeee0003";
    const pickProc = spawnSync(
      process.execPath,
      [hook, "--event", "UserPromptSubmit", "--platform", "kimi-code"],
      {
        cwd: root,
        input: JSON.stringify({
          session_id: pickCid,
          prompt: "/autopilot-run",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(pickProc.status).toBe(0);
    expect(pickProc.stdout).toMatch(/kimi-alpha/);
    expect(pickProc.stdout).toMatch(/kimi-beta/);
    expect(pickProc.stdout).not.toMatch(/"decision"\s*:/);
    expect(pickProc.stderr.trim()).toBe("");
    const pickStore = new StateStore(root);
    expect(pickStore.getSession(pickCid)?.pending_action).toBe("run");
    expect(pickStore.getSession(pickCid)?.phase).not.toBe("executing");
    pickStore.close();

    // Hook clipKimiStdio stays aligned with port-kimi (≤MAX, ellipsis, no NUL).
    const hookSrc = fs.readFileSync(hook, "utf8");
    expect(hookSrc).toMatch(/KIMI_MAX_STDIO_CHARS\s*=\s*8_192/);
    expect(hookSrc).toMatch(/replaceAll\("\\0"/);
    expect(hookSrc).toMatch(/KIMI_MAX_STDIO_CHARS\s*-\s*1/);
    expect(hookSrc).toContain("…");
    // Bound-before-scrub (DoS): slice window before replaceAll.
    expect(hookSrc).toMatch(
      /truncated[\s\S]*?slice\(0,\s*KIMI_MAX_STDIO_CHARS\)[\s\S]*?replaceAll\("\\0"/,
    );
    // failOpen / outer catch must not clobber a finished Kimi exit-2 reply.
    expect(hookSrc).toMatch(
      /platform === "kimi-code"[\s\S]*?if \(replied\) return/,
    );
    expect(hookSrc).toMatch(
      /bootPlatform === "kimi-code" && process\.exitCode === 2 && replied/,
    );
    expect(hookSrc).toMatch(/if \(!ioDone\) process\.exitCode = 0/);

    const cidEdit = "hook-kimi-aaaa-bbbb-cccc-ddddeeee0002";
    spawnSync(
      process.execPath,
      [hook, "--event", "UserPromptSubmit", "--platform", "kimi-code"],
      {
        cwd: root,
        input: JSON.stringify({
          session_id: cidEdit,
          prompt: "/autopilot-on kimi-wire",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    const editStore = new StateStore(root);
    editStore.upsertSession({
      conversation_id: cidEdit,
      project_root: root,
      code_root: root,
      platform: "kimi-code",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "kimi-wire",
      checklist_path: path.join(planDir, "checklist.md"),
    });
    editStore.close();
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    const editProc = spawnSync(
      process.execPath,
      [hook, "--event", "PostToolUse", "--platform", "kimi-code"],
      {
        cwd: root,
        input: JSON.stringify({
          session_id: cidEdit,
          tool_name: "Write",
          tool_input: { file_path: path.join(root, "src", "app.ts") },
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(editProc.status).toBe(0);
    expect(editProc.stdout.trim()).toBe("");
    const verifyEdit = new StateStore(root);
    expect(verifyEdit.getReviewChain(cidEdit)?.code_edited).toBe(1);
    expect(verifyEdit.getSession(cidEdit)?.platform).toBe("kimi-code");
    verifyEdit.close();
  });

  it("five-way --platform copilot-cli routes UPS→Transform needPick (not Claude bare)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const hook = path.join(
      root,
      ".autopilot",
      "bin",
      "autopilot-harness-hook.mjs",
    );
    for (const slug of ["copilot-alpha", "copilot-beta"] as const) {
      const d = path.join(root, "plans", slug);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, "plan.md"), `# ${slug}\n`);
      fs.writeFileSync(path.join(d, "checklist.md"), "- [ ] a — A\n");
    }

    const cid = "hook-copilot-aaaa-bbbb-cccc-ddddeeee0001";
    const onProc = spawnSync(
      process.execPath,
      [
        hook,
        "--event",
        "userPromptSubmitted",
        "--platform",
        "copilot-cli",
      ],
      {
        cwd: root,
        input: JSON.stringify({
          sessionId: cid,
          prompt: "Autopilot ON",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(onProc.status).toBe(0);
    expect(onProc.stdout.trim()).toBe("{}");

    const store = new StateStore(root);
    expect(store.getSession(cid)?.platform).toBe("copilot-cli");
    expect(store.getSession(cid)?.phase).toBe("planning");
    store.close();

    const runProc = spawnSync(
      process.execPath,
      [
        hook,
        "--event",
        "userPromptSubmitted",
        "--platform",
        "copilot-cli",
      ],
      {
        cwd: root,
        input: JSON.stringify({
          sessionId: cid,
          prompt: "Autopilot RUN",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(runProc.status).toBe(0);
    expect(runProc.stdout.trim()).toBe("{}");

    const transformProc = spawnSync(
      process.execPath,
      [
        hook,
        "--event",
        "userPromptTransformed",
        "--platform",
        "copilot-cli",
      ],
      {
        cwd: root,
        input: JSON.stringify({
          sessionId: cid,
          prompt: "Autopilot RUN",
          transformedPrompt: "Autopilot RUN",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(transformProc.status).toBe(0);
    const tr = JSON.parse(transformProc.stdout.trim() || "{}") as {
      modifiedTransformedPrompt?: string;
    };
    expect(tr.modifiedTransformedPrompt).toMatch(/\[Autopilot\]/);
    expect(tr.modifiedTransformedPrompt).toMatch(/Select a plan|copilot-alpha/i);
    expect(tr.modifiedTransformedPrompt).toMatch(/Autopilot RUN/);

    // agentStop continue shape: decision:block + reason (JSON, not Kimi exit 2).
    const armed = new StateStore(root);
    armed.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: "copilot-cli",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "copilot-alpha",
      checklist_path: path.join(root, "plans", "copilot-alpha", "checklist.md"),
    });
    armed.updateReviewChain(cid, { code_edited: 1 });
    armed.close();

    const stopProc = spawnSync(
      process.execPath,
      [hook, "--event", "agentStop", "--platform", "copilot-cli"],
      {
        cwd: root,
        input: JSON.stringify({
          sessionId: cid,
          hookEventName: "agentStop",
          stopHookActive: false,
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(stopProc.status).toBe(0);
    const stopOut = JSON.parse(stopProc.stdout.trim() || "{}") as {
      decision?: string;
      reason?: string;
      continue?: boolean;
    };
    expect(stopOut.decision).toBe("block");
    expect(stopOut.reason).toBeTruthy();
    expect(stopOut.continue).toBeUndefined();
    expect(Object.keys(stopOut).sort()).toEqual(["decision", "reason"]);
  });

  it("six-way --platform grok-build routes UPS/Stop/PostToolUse (block needPick; abort; StopFailure fail-open)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const hook = path.join(
      root,
      ".autopilot",
      "bin",
      "autopilot-harness-hook.mjs",
    );
    for (const slug of ["grok-alpha", "grok-beta"] as const) {
      const d = path.join(root, "plans", slug);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, "plan.md"), `# ${slug}\n`);
      fs.writeFileSync(path.join(d, "checklist.md"), "- [ ] a — A\n");
    }

    const cid = "hook-grok-aaaa-bbbb-cccc-ddddeeee0001";
    const onProc = spawnSync(
      process.execPath,
      [hook, "--event", "UserPromptSubmit", "--platform", "grok-build"],
      {
        cwd: root,
        input: JSON.stringify({
          sessionId: cid,
          prompt: "Autopilot ON",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(onProc.status).toBe(0);
    expect(JSON.parse(onProc.stdout.trim() || "{}")).toEqual({});

    const store = new StateStore(root);
    expect(store.getSession(cid)?.platform).toBe("grok-build");
    expect(store.getSession(cid)?.phase).toBe("planning");
    store.close();

    // Grok UPS needPick → decision:block (not Claude/Codex additionalContext).
    const runProc = spawnSync(
      process.execPath,
      [hook, "--event", "UserPromptSubmit", "--platform", "grok-build"],
      {
        cwd: root,
        input: JSON.stringify({
          sessionId: cid,
          prompt: "Autopilot RUN",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(runProc.status).toBe(0);
    const runOut = JSON.parse(runProc.stdout.trim() || "{}") as {
      decision?: string;
      reason?: string;
      hookSpecificOutput?: unknown;
    };
    expect(runOut.decision).toBe("block");
    expect(runOut.reason).toMatch(/Select a plan|grok-alpha|grok-beta/i);
    expect(runOut.hookSpecificOutput).toBeUndefined();

    // Pascal Stop + stop_hook_active must honor grok-build stamp (not Claude).
    const armed = new StateStore(root);
    armed.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: "grok-build",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "grok-alpha",
      checklist_path: path.join(root, "plans", "grok-alpha", "checklist.md"),
    });
    armed.updateReviewChain(cid, { code_edited: 1 });
    armed.close();

    const armedStop = spawnSync(
      process.execPath,
      [hook, "--event", "Stop", "--platform", "grok-build"],
      {
        cwd: root,
        input: JSON.stringify({
          sessionId: cid,
          hook_event_name: "Stop",
          stop_hook_active: false,
          reason: "end_turn",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(armedStop.status).toBe(0);
    const armedOut = JSON.parse(armedStop.stdout.trim() || "{}") as {
      decision?: string;
      reason?: string;
      continue?: boolean;
      hookSpecificOutput?: unknown;
    };
    expect(armedOut.decision).toBe("block");
    expect(armedOut.reason).toBeTruthy();
    expect(armedOut.continue).toBeUndefined();
    expect(armedOut.hookSpecificOutput).toBeUndefined();
    expect(Object.keys(armedOut).sort()).toEqual(["decision", "reason"]);

    // PostToolUse Write must arm via Grok alias (not no-op / Claude confusion).
    const cidEdit = "hook-grok-aaaa-bbbb-cccc-ddddeeee0002";
    spawnSync(
      process.execPath,
      [hook, "--event", "UserPromptSubmit", "--platform", "grok-build"],
      {
        cwd: root,
        input: JSON.stringify({
          sessionId: cidEdit,
          prompt: "Autopilot ON grok-alpha",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    const editStore = new StateStore(root);
    editStore.upsertSession({
      conversation_id: cidEdit,
      project_root: root,
      code_root: root,
      platform: "grok-build",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "grok-alpha",
      checklist_path: path.join(root, "plans", "grok-alpha", "checklist.md"),
    });
    editStore.close();
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    const editProc = spawnSync(
      process.execPath,
      [hook, "--event", "PostToolUse", "--platform", "grok-build"],
      {
        cwd: root,
        input: JSON.stringify({
          sessionId: cidEdit,
          tool_name: "Write",
          tool_input: { file_path: path.join(root, "src", "app.ts") },
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(editProc.status).toBe(0);
    expect(JSON.parse(editProc.stdout.trim() || "{}")).toEqual({});
    const verifyEdit = new StateStore(root);
    expect(verifyEdit.getReviewChain(cidEdit)?.code_edited).toBe(1);
    expect(verifyEdit.getSession(cidEdit)?.platform).toBe("grok-build");
    verifyEdit.close();

    // StopFailure is not a Grok event — stamp must fail-open (not Claude recover).
    const failProc = spawnSync(
      process.execPath,
      [hook, "--event", "StopFailure", "--platform", "grok-build"],
      {
        cwd: root,
        input: JSON.stringify({
          sessionId: cid,
          hook_event_name: "StopFailure",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(failProc.status).toBe(0);
    expect(JSON.parse(failProc.stdout.trim() || "{}")).toEqual({});

    // Grok stamp must beat hostile agentStop name (not Copilot Layer C).
    // Fresh session — avoid flake from prior confirm/pending on `cid`.
    const cidHostile = "hook-grok-aaaa-bbbb-cccc-ddddeeee0003";
    const hostileStore = new StateStore(root);
    hostileStore.upsertSession({
      conversation_id: cidHostile,
      project_root: root,
      code_root: root,
      platform: "grok-build",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "grok-alpha",
      checklist_path: path.join(root, "plans", "grok-alpha", "checklist.md"),
    });
    hostileStore.updateReviewChain(cidHostile, { code_edited: 1 });
    hostileStore.close();
    const hostile = spawnSync(
      process.execPath,
      [hook, "--event", "Stop", "--platform", "grok-build"],
      {
        cwd: root,
        input: JSON.stringify({
          sessionId: cidHostile,
          hook_event_name: "agentStop",
          stop_hook_active: false,
          reason: "end_turn",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(hostile.status).toBe(0);
    const hostileOut = JSON.parse(hostile.stdout.trim() || "{}") as {
      decision?: string;
      reason?: string;
      continue?: boolean;
    };
    expect(hostileOut.decision).toBe("block");
    expect(hostileOut.reason).toBeTruthy();
    expect(hostileOut.continue).toBeUndefined();
    expect(Object.keys(hostileOut).sort()).toEqual(["decision", "reason"]);
    const hostileVerify = new StateStore(root);
    expect(hostileVerify.getSession(cidHostile)?.platform).toBe("grok-build");
    hostileVerify.close();

    // Universal abort: Grok stamp + Cursor-shaped aborted → halt {} (before Grok FSM).
    const mid = new StateStore(root);
    const beforeAbort = mid.getReviewChain(cid)?.pending_followup ?? null;
    mid.close();
    const abortStop = spawnSync(
      process.execPath,
      [hook, "--event", "Stop", "--platform", "grok-build"],
      {
        cwd: root,
        input: JSON.stringify({
          conversation_id: cid,
          status: "aborted",
          hook_event_name: "stop",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(abortStop.status).toBe(0);
    expect(JSON.parse(abortStop.stdout.trim() || "{}")).toEqual({});
    const after = new StateStore(root);
    expect(after.getSession(cid)?.platform).toBe("grok-build");
    expect(after.getReviewChain(cid)?.pending_followup ?? null).toBe(
      beforeAbort,
    );
    after.close();
  });

  it("seven-way --platform gemini-cli routes BeforeAgent/AfterTool/AfterAgent (deny needPick; wrong stamp abort; StopFailure fail-open)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const hook = path.join(
      root,
      ".autopilot",
      "bin",
      "autopilot-harness-hook.mjs",
    );
    for (const slug of ["gem-alpha", "gem-beta"] as const) {
      const d = path.join(root, "plans", slug);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, "plan.md"), `# ${slug}\n`);
      fs.writeFileSync(path.join(d, "checklist.md"), "- [ ] a — A\n");
    }

    const cid = "hook-gemini-aaaa-bbbb-cccc-ddddeeee0001";
    const onProc = spawnSync(
      process.execPath,
      [hook, "--event", "BeforeAgent", "--platform", "gemini-cli"],
      {
        cwd: root,
        input: JSON.stringify({
          sessionId: cid,
          prompt: "Autopilot ON",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(onProc.status).toBe(0);
    expect(JSON.parse(onProc.stdout.trim() || "{}")).toEqual({});

    const store = new StateStore(root);
    expect(store.getSession(cid)?.platform).toBe("gemini-cli");
    expect(store.getSession(cid)?.phase).toBe("planning");
    store.close();

    // Unstamped BeforeAgent still routes to gemini-cli (unique event name).
    const unstampedOn = spawnSync(
      process.execPath,
      [hook, "--event", "BeforeAgent"],
      {
        cwd: root,
        input: JSON.stringify({
          sessionId: "hook-gemini-aaaa-bbbb-cccc-ddddeeee0099",
          prompt: "Autopilot ON",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(unstampedOn.status).toBe(0);
    expect(JSON.parse(unstampedOn.stdout.trim() || "{}")).toEqual({});
    const unstampedStore = new StateStore(root);
    expect(
      unstampedStore.getSession("hook-gemini-aaaa-bbbb-cccc-ddddeeee0099")
        ?.platform,
    ).toBe("gemini-cli");
    unstampedStore.close();

    // Gemini BeforeAgent needPick → inject (hookEventName), not deny.
    const runProc = spawnSync(
      process.execPath,
      [hook, "--event", "BeforeAgent", "--platform", "gemini-cli"],
      {
        cwd: root,
        input: JSON.stringify({
          sessionId: cid,
          prompt: "Autopilot RUN",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(runProc.status).toBe(0);
    const runOut = JSON.parse(runProc.stdout.trim() || "{}") as {
      decision?: string;
      hookSpecificOutput?: { hookEventName?: string; additionalContext?: string };
    };
    expect(runOut.decision).toBeUndefined();
    expect(runOut.hookSpecificOutput?.hookEventName).toBe("BeforeAgent");
    expect(runOut.hookSpecificOutput?.additionalContext).toMatch(
      /Select a plan|gem-alpha|gem-beta/i,
    );

    // Wrong stamp + Gemini event → fail-open before FSM (no new session).
    // Must still emit JSON {} even when stamp is kimi-code (Kimi fail-open
    // writes no stdout; Gemini host requires a JSON object).
    const wrongStamp = spawnSync(
      process.execPath,
      [hook, "--event", "BeforeAgent", "--platform", "claude-code"],
      {
        cwd: root,
        input: JSON.stringify({
          sessionId: "hook-gemini-wrong-stamp-0001",
          prompt: "Autopilot ON",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(wrongStamp.status).toBe(0);
    expect(JSON.parse(wrongStamp.stdout.trim() || "{}")).toEqual({});
    const wrongStore = new StateStore(root);
    expect(wrongStore.getSession("hook-gemini-wrong-stamp-0001")).toBeNull();
    wrongStore.close();

    const wrongKimi = spawnSync(
      process.execPath,
      [hook, "--event", "BeforeAgent", "--platform", "kimi-code"],
      {
        cwd: root,
        input: JSON.stringify({
          sessionId: "hook-gemini-wrong-stamp-kimi-0001",
          prompt: "Autopilot ON",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(wrongKimi.status).toBe(0);
    expect(wrongKimi.stdout.trim()).toBe("{}");
    const wrongKimiStore = new StateStore(root);
    expect(
      wrongKimiStore.getSession("hook-gemini-wrong-stamp-kimi-0001"),
    ).toBeNull();
    wrongKimiStore.close();

    // AfterAgent continue = deny+reason (multi-deny capable).
    const armed = new StateStore(root);
    armed.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: "gemini-cli",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "gem-alpha",
      checklist_path: path.join(root, "plans", "gem-alpha", "checklist.md"),
    });
    armed.updateReviewChain(cid, { code_edited: 1 });
    armed.close();

    const afterAgent = spawnSync(
      process.execPath,
      [hook, "--event", "AfterAgent", "--platform", "gemini-cli"],
      {
        cwd: root,
        input: JSON.stringify({
          sessionId: cid,
          hook_event_name: "AfterAgent",
          prompt: "original user",
          prompt_response: "assistant done",
          stop_hook_active: false,
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(afterAgent.status).toBe(0);
    const stopOut = JSON.parse(afterAgent.stdout.trim() || "{}") as {
      decision?: string;
      reason?: string;
      continue?: boolean;
    };
    expect(stopOut.decision).toBe("deny");
    expect(stopOut.reason).toBeTruthy();
    expect(stopOut.continue).toBeUndefined();
    expect(JSON.stringify(stopOut)).not.toMatch(/clearContext|"block"/);

    // Gemini multi-deny: stop_hook_active must NOT silence deny (unlike Claude).
    const rearm = new StateStore(root);
    rearm.updateReviewChain(cid, { code_edited: 1 });
    rearm.close();
    const multiDeny = spawnSync(
      process.execPath,
      [hook, "--event", "AfterAgent", "--platform", "gemini-cli"],
      {
        cwd: root,
        input: JSON.stringify({
          sessionId: cid,
          hook_event_name: "AfterAgent",
          prompt: "original user",
          prompt_response: "assistant done again",
          stop_hook_active: true,
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(multiDeny.status).toBe(0);
    const multiOut = JSON.parse(multiDeny.stdout.trim() || "{}") as {
      decision?: string;
      reason?: string;
    };
    expect(multiOut.decision).toBe("deny");
    expect(multiOut.reason).toBeTruthy();
    expect(JSON.stringify(multiOut)).not.toMatch(/clearContext|"block"/);

    // AfterTool arms product edit.
    const file = path.join(root, "src", "gem.ts");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "export const g = 1;\n");
    const editCid = "hook-gemini-aaaa-bbbb-cccc-ddddeeee0002";
    const editStore = new StateStore(root);
    editStore.upsertSession({
      conversation_id: editCid,
      project_root: root,
      code_root: root,
      platform: "gemini-cli",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "gem-alpha",
      checklist_path: path.join(root, "plans", "gem-alpha", "checklist.md"),
    });
    editStore.close();
    const editProc = spawnSync(
      process.execPath,
      [hook, "--event", "AfterTool", "--platform", "gemini-cli"],
      {
        cwd: root,
        input: JSON.stringify({
          sessionId: editCid,
          tool_name: "write_file",
          tool_input: { file_path: file },
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(editProc.status).toBe(0);
    expect(JSON.parse(editProc.stdout.trim() || "{}")).toEqual({});
    const verifyEdit = new StateStore(root);
    expect(verifyEdit.getReviewChain(editCid)?.code_edited).toBe(1);
    verifyEdit.close();

    // Universal abort: Gemini stamp + Cursor-shaped aborted → halt {}
    // (must not fail-open continue on AfterAgent).
    const midGem = new StateStore(root);
    const beforeAbortGem =
      midGem.getReviewChain(cid)?.pending_followup ?? null;
    midGem.close();
    const abortAfter = spawnSync(
      process.execPath,
      [hook, "--event", "AfterAgent", "--platform", "gemini-cli"],
      {
        cwd: root,
        input: JSON.stringify({
          conversation_id: cid,
          status: "aborted",
          hook_event_name: "stop",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(abortAfter.status).toBe(0);
    expect(JSON.parse(abortAfter.stdout.trim() || "{}")).toEqual({});
    const afterGem = new StateStore(root);
    expect(afterGem.getSession(cid)?.platform).toBe("gemini-cli");
    expect(afterGem.getReviewChain(cid)?.pending_followup ?? null).toBe(
      beforeAbortGem,
    );
    afterGem.close();

    // StopFailure is not a Gemini event — fail-open.
    const stopFail = spawnSync(
      process.execPath,
      [hook, "--event", "StopFailure", "--platform", "gemini-cli"],
      {
        cwd: root,
        input: JSON.stringify({ sessionId: cid }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(stopFail.status).toBe(0);
    expect(JSON.parse(stopFail.stdout.trim() || "{}")).toEqual({});
  });

  it("factory-droid stamp + Cursor-only event fail-opens zero-byte before FSM", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const hook = path.join(
      root,
      ".autopilot",
      "bin",
      "autopilot-harness-hook.mjs",
    );
    const before = spawnSync(
      process.execPath,
      [hook, "--platform", "factory-droid", "--event", "beforeSubmitPrompt"],
      {
        cwd: root,
        input: JSON.stringify({
          conversation_id: "hook-factory-cursor-event-0001",
          prompt: "hello",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(before.status).toBe(0);
    expect(before.stdout).toBe("");
    expect(before.stderr.trim()).toBe("");
    // Early abort must not open state.db (Cursor handler would).
    expect(fs.existsSync(path.join(root, ".autopilot", "state.db"))).toBe(
      false,
    );

    const noEvent = spawnSync(
      process.execPath,
      [hook, "--platform", "factory-droid"],
      {
        cwd: root,
        input: JSON.stringify({
          conversation_id: "hook-factory-missing-event-0001",
          prompt: "hello",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(noEvent.status).toBe(0);
    expect(noEvent.stdout).toBe("");
  });

  it("nine-way --platform hermes-agent routes pre_llm_call/post_tool_call/pre_verify (context; {} never block; continue; wrong stamp abort)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const hook = path.join(
      root,
      ".autopilot",
      "bin",
      "autopilot-harness-hook.mjs",
    );
    for (const slug of ["herm-alpha", "herm-beta"] as const) {
      const d = path.join(root, "plans", slug);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, "plan.md"), `# ${slug}\n`);
      fs.writeFileSync(path.join(d, "checklist.md"), "- [ ] a — A\n");
    }

    const cid = "hook-hermes-aaaa-bbbb-cccc-ddddeeee0001";

    // pre_llm_call ON → allow {}
    const onProc = spawnSync(
      process.execPath,
      [hook, "--event", "pre_llm_call", "--platform", "hermes-agent"],
      {
        cwd: root,
        input: JSON.stringify({
          session_id: cid,
          user_message: "Autopilot ON",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(onProc.status).toBe(0);
    expect(JSON.parse(onProc.stdout.trim() || "{}")).toEqual({});

    const store = new StateStore(root);
    expect(store.getSession(cid)?.platform).toBe("hermes-agent");
    expect(store.getSession(cid)?.phase).toBe("planning");
    store.close();

    // Unstamped pre_llm_call still routes to hermes-agent (unique event).
    const unstampedOn = spawnSync(
      process.execPath,
      [hook, "--event", "pre_llm_call"],
      {
        cwd: root,
        input: JSON.stringify({
          session_id: "hook-hermes-aaaa-bbbb-cccc-ddddeeee0099",
          user_message: "Autopilot ON",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(unstampedOn.status).toBe(0);
    expect(JSON.parse(unstampedOn.stdout.trim() || "{}")).toEqual({});
    const unstampedStore = new StateStore(root);
    expect(
      unstampedStore.getSession("hook-hermes-aaaa-bbbb-cccc-ddddeeee0099")
        ?.platform,
    ).toBe("hermes-agent");
    unstampedStore.close();

    // RUN needPick → {context} (cannot discard prompt)
    const runProc = spawnSync(
      process.execPath,
      [hook, "--event", "pre_llm_call", "--platform", "hermes-agent"],
      {
        cwd: root,
        input: JSON.stringify({
          session_id: cid,
          user_message: "Autopilot RUN",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(runProc.status).toBe(0);
    const runOut = JSON.parse(runProc.stdout.trim() || "{}") as {
      context?: string;
      decision?: string;
    };
    expect(runOut.decision).toBeUndefined();
    expect(typeof runOut.context).toBe("string");
    expect(runOut.context).toMatch(/herm-alpha|herm-beta|Select a plan/i);

    // Wrong stamp + Hermes event → JSON {} before FSM (no new session).
    // Must still emit JSON {} even when stamp is kimi-code (Kimi fail-open
    // writes no stdout; Hermes host requires a JSON object).
    const wrongStamp = spawnSync(
      process.execPath,
      [hook, "--event", "pre_llm_call", "--platform", "factory-droid"],
      {
        cwd: root,
        input: JSON.stringify({
          session_id: "hook-hermes-wrong-stamp-0001",
          user_message: "Autopilot ON",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(wrongStamp.status).toBe(0);
    expect(JSON.parse(wrongStamp.stdout.trim() || "{}")).toEqual({});
    const wrongStore = new StateStore(root);
    expect(wrongStore.getSession("hook-hermes-wrong-stamp-0001")).toBeNull();
    wrongStore.close();

    const wrongKimi = spawnSync(
      process.execPath,
      [hook, "--event", "pre_llm_call", "--platform", "kimi-code"],
      {
        cwd: root,
        input: JSON.stringify({
          session_id: "hook-hermes-wrong-stamp-kimi-0001",
          user_message: "Autopilot ON",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(wrongKimi.status).toBe(0);
    expect(wrongKimi.stdout.trim()).toBe("{}");
    const wrongKimiStore = new StateStore(root);
    expect(
      wrongKimiStore.getSession("hook-hermes-wrong-stamp-kimi-0001"),
    ).toBeNull();
    wrongKimiStore.close();

    // Hermes stamp + Cursor-only event on a fresh project must abort before
    // opening state.db (Cursor beforeSubmitPrompt would create it).
    const freshRoot = tmpProject();
    try {
      expect(
        installInitYes({
          projectRoot: freshRoot,
          platform: "cursor",
          surface: "ide",
          locale: "en",
          force: false,
        }).ok,
      ).toBe(true);
      const freshHook = path.join(
        freshRoot,
        ".autopilot",
        "bin",
        "autopilot-harness-hook.mjs",
      );
      const freshAbort = spawnSync(
        process.execPath,
        [
          freshHook,
          "--platform",
          "hermes-agent",
          "--event",
          "beforeSubmitPrompt",
        ],
        {
          cwd: freshRoot,
          input: JSON.stringify({
            conversation_id: "hook-hermes-fresh-abort-0001",
            prompt: "hello",
          }),
          encoding: "utf8",
          timeout: 15_000,
        },
      );
      expect(freshAbort.status).toBe(0);
      expect(JSON.parse(freshAbort.stdout.trim() || "{}")).toEqual({});
      expect(
        fs.existsSync(path.join(freshRoot, ".autopilot", "state.db")),
      ).toBe(false);
    } finally {
      fs.rmSync(freshRoot, { recursive: true, force: true });
    }

    // Hermes stamp + Cursor-only event → {} abort before state.db side effects
    // on a fresh install would open db; assert no pending_followup mutation.
    const mid = new StateStore(root);
    const beforeAbort = mid.getReviewChain(cid)?.pending_followup ?? null;
    mid.close();
    const hermesCursor = spawnSync(
      process.execPath,
      [hook, "--platform", "hermes-agent", "--event", "beforeSubmitPrompt"],
      {
        cwd: root,
        input: JSON.stringify({
          conversation_id: cid,
          prompt: "hostile cursor shape",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(hermesCursor.status).toBe(0);
    expect(JSON.parse(hermesCursor.stdout.trim() || "{}")).toEqual({});
    const afterAbort = new StateStore(root);
    expect(afterAbort.getSession(cid)?.platform).toBe("hermes-agent");
    expect(afterAbort.getReviewChain(cid)?.pending_followup ?? null).toBe(
      beforeAbort,
    );
    afterAbort.close();

    // post_tool_call write_file → always {} (never block) + dirty-arm
    const file = path.join(root, "src", "herm.ts");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "export const h = 1;\n");
    const editCid = "hook-hermes-aaaa-bbbb-cccc-ddddeeee0002";
    const editStore = new StateStore(root);
    editStore.upsertSession({
      conversation_id: editCid,
      project_root: root,
      code_root: root,
      platform: "hermes-agent",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "herm-alpha",
      checklist_path: path.join(root, "plans", "herm-alpha", "checklist.md"),
    });
    editStore.close();
    const editProc = spawnSync(
      process.execPath,
      [hook, "--event", "post_tool_call", "--platform", "hermes-agent"],
      {
        cwd: root,
        input: JSON.stringify({
          session_id: editCid,
          tool_name: "write_file",
          tool_input: { path: file },
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(editProc.status).toBe(0);
    expect(JSON.parse(editProc.stdout.trim() || "{}")).toEqual({});
    const verifyEdit = new StateStore(root);
    expect(verifyEdit.getReviewChain(editCid)?.code_edited).toBe(1);
    verifyEdit.close();

    // pre_verify continue → decision:block+reason
    const armed = new StateStore(root);
    armed.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: "hermes-agent",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "herm-alpha",
      checklist_path: path.join(root, "plans", "herm-alpha", "checklist.md"),
      reviewing_item_id: "a",
    });
    armed.updateReviewChain(cid, { code_edited: 1 });
    armed.close();

    const verifyProc = spawnSync(
      process.execPath,
      [hook, "--event", "pre_verify", "--platform", "hermes-agent"],
      {
        cwd: root,
        input: JSON.stringify({
          session_id: cid,
          extra: { attempt: 0, coding: true, changed_paths: ["src/herm.ts"] },
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(verifyProc.status).toBe(0);
    const verifyOut = JSON.parse(verifyProc.stdout.trim() || "{}") as {
      decision?: string;
      reason?: string;
    };
    expect(verifyOut.decision).toBe("block");
    expect(verifyOut.reason).toBeTruthy();
    expect(JSON.stringify(verifyOut)).not.toMatch(/continue:false|stopReason/);

    // Foreign event under Hermes stamp already covered; StopFailure → {}
    const stopFail = spawnSync(
      process.execPath,
      [hook, "--event", "StopFailure", "--platform", "hermes-agent"],
      {
        cwd: root,
        input: JSON.stringify({ session_id: cid }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(stopFail.status).toBe(0);
    expect(JSON.parse(stopFail.stdout.trim() || "{}")).toEqual({});

    // writeHermesReply: incomplete decision:block must silence (not fall through
    // to context); native action:continue is accepted; clip before emit.
    const hookSrc = fs.readFileSync(hook, "utf8");
    expect(hookSrc).toMatch(/function writeHermesReply\(/);
    expect(hookSrc).toMatch(
      /result\.decision === "block"[\s\S]*?writeReply\("\{\}"\)[\s\S]*?return;[\s\S]*?result\.action === "continue"/,
    );
    expect(hookSrc).toMatch(
      /result\.action === "continue"[\s\S]*?writeReply\("\{\}"\)[\s\S]*?return;[\s\S]*?const context = clipHermesStdio/,
    );
    expect(hookSrc).toMatch(
      /truncated[\s\S]*?slice\(0,\s*HERMES_MAX_STDIO_CHARS\)[\s\S]*?replaceAll\("\\0"/,
    );
  });

  it("unstamped agentStop + stopHookActive routes Copilot (not Claude Layer C)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const hook = path.join(
      root,
      ".autopilot",
      "bin",
      "autopilot-harness-hook.mjs",
    );
    const planDir = path.join(root, "plans", "copilot-unstamped");
    fs.mkdirSync(planDir, { recursive: true });
    fs.writeFileSync(path.join(planDir, "plan.md"), "# copilot-unstamped\n");
    fs.writeFileSync(path.join(planDir, "checklist.md"), "- [ ] a — A\n");

    const cid = "hook-copilot-aaaa-bbbb-cccc-ddddeeee0002";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: "copilot-cli",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "copilot-unstamped",
      checklist_path: path.join(planDir, "checklist.md"),
    });
    store.updateReviewChain(cid, { code_edited: 1 });
    store.close();

    // No --platform: event name must beat stopHookActive→Claude heuristic.
    const stopProc = spawnSync(
      process.execPath,
      [hook, "--event", "agentStop"],
      {
        cwd: root,
        input: JSON.stringify({
          sessionId: cid,
          hookEventName: "agentStop",
          stopHookActive: false,
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(stopProc.status).toBe(0);
    const stopOut = JSON.parse(stopProc.stdout.trim() || "{}") as {
      decision?: string;
      reason?: string;
      continue?: boolean;
      stopReason?: string;
    };
    expect(stopOut.decision).toBe("block");
    expect(stopOut.reason).toBeTruthy();
    // Copilot hard contract: no Claude continue:false / stopReason fields.
    expect(stopOut.continue).toBeUndefined();
    expect(stopOut.stopReason).toBeUndefined();

    const verify = new StateStore(root);
    expect(verify.getSession(cid)?.platform).toBe("copilot-cli");
    verify.close();
  });

  it("cursor stamp + hostile hookEventName agentStop still Layer-C Claude (not Copilot)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const planDir = path.join(root, "plans", "demo-hostile");
    fs.mkdirSync(planDir, { recursive: true });
    fs.writeFileSync(path.join(planDir, "plan.md"), "# demo-hostile\n");
    fs.writeFileSync(path.join(planDir, "checklist.md"), "- [ ] a — A\n");

    const hook = path.join(
      root,
      ".autopilot",
      "bin",
      "autopilot-harness-hook.mjs",
    );
    const cid = "hook-xf-aaaa-bbbb-cccc-ddddeeee00aa";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "demo-hostile",
      checklist_path: path.join(planDir, "checklist.md"),
    });
    store.updateReviewChain(cid, { code_edited: 1 });
    store.close();

    const proc = spawnSync(
      process.execPath,
      [hook, "--event", "Stop", "--platform", "cursor"],
      {
        cwd: root,
        input: JSON.stringify({
          session_id: cid,
          // Hostile Copilot-looking name must not beat cursor stamp → Claude Layer C.
          hook_event_name: "agentStop",
          stop_hook_active: false,
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(proc.status).toBe(0);
    const out = JSON.parse(proc.stdout.trim() || "{}") as {
      decision?: string;
      reason?: string;
    };
    expect(out.decision).toBe("block");
    expect(out.reason).toBeTruthy();
  });

  it("copilot-cli stamp + PascalCase UserPromptSubmit still replies {} (no _stashedGate leak)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const hook = path.join(
      root,
      ".autopilot",
      "bin",
      "autopilot-harness-hook.mjs",
    );
    for (const slug of ["copilot-leak-a", "copilot-leak-b"] as const) {
      const d = path.join(root, "plans", slug);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, "plan.md"), `# ${slug}\n`);
      fs.writeFileSync(path.join(d, "checklist.md"), "- [ ] a — A\n");
    }

    const cid = "hook-copilot-aaaa-bbbb-cccc-ddddeeee00bb";
    spawnSync(
      process.execPath,
      [
        hook,
        "--event",
        "userPromptSubmitted",
        "--platform",
        "copilot-cli",
      ],
      {
        cwd: root,
        input: JSON.stringify({ sessionId: cid, prompt: "Autopilot ON" }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );

    const runProc = spawnSync(
      process.execPath,
      [hook, "--event", "UserPromptSubmit", "--platform", "copilot-cli"],
      {
        cwd: root,
        input: JSON.stringify({
          session_id: cid,
          prompt: "Autopilot RUN",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(runProc.status).toBe(0);
    expect(runProc.stdout.trim()).toBe("{}");
    expect(runProc.stdout).not.toMatch(/_stashedGate|Select a plan/);
  });

  it("Stop Layer C: cursor stamp + Pascal Stop shape still routes Claude (no regression)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const planDir = path.join(root, "plans", "demo");
    fs.mkdirSync(planDir, { recursive: true });
    fs.writeFileSync(path.join(planDir, "plan.md"), "# demo\n");
    fs.writeFileSync(path.join(planDir, "checklist.md"), "- [ ] a — A\n");

    const hook = path.join(
      root,
      ".autopilot",
      "bin",
      "autopilot-harness-hook.mjs",
    );
    const cid = "hook-xf-aaaa-bbbb-cccc-ddddeeee0001";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "demo",
      checklist_path: path.join(planDir, "checklist.md"),
    });
    store.updateReviewChain(cid, { code_edited: 1 });
    store.close();

    // Historical cross-fire: argv says cursor, payload is Claude/Codex-shaped Stop.
    const proc = spawnSync(
      process.execPath,
      [hook, "--event", "Stop", "--platform", "cursor"],
      {
        cwd: root,
        input: JSON.stringify({
          session_id: cid,
          hook_event_name: "Stop",
          stop_hook_active: false,
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(proc.status).toBe(0);
    const out = JSON.parse(proc.stdout.trim() || "{}") as {
      decision?: string;
      reason?: string;
      followup_message?: string;
      loop?: boolean;
    };
    // Claude path: decision:block + reason (not Cursor followup_message).
    expect(out.decision).toBe("block");
    expect(out.reason).toBeTruthy();
    expect(out.followup_message).toBeUndefined();
    expect(out.loop).toBeUndefined();
  });

  it("Claude UserPromptSubmit / Stop dispatch via same vendor (no Cursor regression)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const hook = path.join(
      root,
      ".autopilot",
      "bin",
      "autopilot-harness-hook.mjs",
    );
    const cid = "hook-claude-aaaa-bbbb-cccc-ddddeeee0099";

    const submit = spawnSync(
      process.execPath,
      [hook, "--event", "UserPromptSubmit"],
      {
        cwd: root,
        input: JSON.stringify({
          session_id: cid,
          prompt: "hello claude submit",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(submit.status).toBe(0);
    const submitOut = JSON.parse(submit.stdout.trim() || "{}") as {
      continue?: boolean;
      decision?: string;
    };
    // Claude fail-open / allow = {} (not Cursor { continue: true })
    expect(submitOut.continue).toBeUndefined();
    expect(submitOut.decision).toBeUndefined();

    const editPath = path.join(root, "src", "app.ts");
    fs.mkdirSync(path.dirname(editPath), { recursive: true });
    fs.writeFileSync(editPath, "export {}\n");
    fs.mkdirSync(path.join(root, "plans", "demo"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "plans", "demo", "checklist.md"),
      "- [ ] a — A\n- [ ] b — B\n",
    );

    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: "claude-code",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "demo",
      checklist_path: path.join(root, "plans", "demo", "checklist.md"),
    });
    store.close();

    const postEdit = spawnSync(
      process.execPath,
      [hook, "--event", "PostToolUse"],
      {
        cwd: root,
        input: JSON.stringify({
          session_id: cid,
          tool_name: "Edit",
          tool_input: { file_path: editPath },
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(postEdit.status).toBe(0);
    expect(JSON.parse(postEdit.stdout.trim() || "{}")).toEqual({});

    const verify = new StateStore(root);
    expect(verify.getReviewChain(cid)?.code_edited).toBe(1);
    verify.close();

    const stop = spawnSync(process.execPath, [hook, "--event", "Stop"], {
      cwd: root,
      input: JSON.stringify({
        session_id: cid,
        stop_hook_active: false,
      }),
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(stop.status).toBe(0);
    const stopOut = JSON.parse(stop.stdout.trim() || "{}") as {
      decision?: string;
      reason?: string;
      followup_message?: string;
      loop?: boolean;
    };
    expect(stopOut.decision).toBe("block");
    expect(stopOut.reason).toBeTruthy();
    // Must not emit Cursor-shaped stop stdout
    expect(stopOut.followup_message).toBeUndefined();
    expect(stopOut.loop).toBeUndefined();

    // Cursor IDE may cross-fire --event Stop with aborted status; must halt.
    const abortCid = "hook-claude-aaaa-bbbb-cccc-ddddeeee0097";
    const storeAbort = new StateStore(root);
    storeAbort.upsertSession({
      conversation_id: abortCid,
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "planning",
      armed: 0,
      paused: 0,
      track_id: "demo",
      checklist_path: path.join(root, "plans", "demo", "checklist.md"),
    });
    storeAbort.close();
    const abortStop = spawnSync(process.execPath, [hook, "--event", "Stop"], {
      cwd: root,
      input: JSON.stringify({
        conversation_id: abortCid,
        session_id: abortCid,
        status: "aborted",
        hook_event_name: "stop",
        loop_count: 0,
      }),
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(abortStop.status).toBe(0);
    expect(JSON.parse(abortStop.stdout.trim() || "{}")).toEqual({});
    const abortVerify = new StateStore(root);
    expect(abortVerify.getSession(abortCid)?.error_count ?? 0).toBe(0);
    abortVerify.close();

    const failCid = "hook-claude-aaaa-bbbb-cccc-ddddeeee0098";
    const store2 = new StateStore(root);
    store2.upsertSession({
      conversation_id: failCid,
      project_root: root,
      code_root: root,
      platform: "claude-code",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "demo",
      checklist_path: path.join(root, "plans", "demo", "checklist.md"),
    });
    store2.close();

    const stopFail = spawnSync(
      process.execPath,
      [hook, "--event", "StopFailure"],
      {
        cwd: root,
        input: JSON.stringify({
          session_id: failCid,
          stop_hook_active: false,
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(stopFail.status).toBe(0);
    const failOut = JSON.parse(stopFail.stdout.trim() || "{}") as {
      decision?: string;
      reason?: string;
      followup_message?: string;
      loop?: boolean;
    };
    // StopFailure → Claude-shaped recover (not Cursor followup_message)
    expect(failOut.followup_message).toBeUndefined();
    expect(failOut.loop).toBeUndefined();
    expect(failOut.decision).toBe("block");
    expect(failOut.reason).toMatch(/Recover|恢复/i);
  });

  it("stop hook reads confirm_rounds + locale from config.yml", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "zh-CN",
        force: false,
      }).ok,
    ).toBe(true);

    const configPath = path.join(root, ".autopilot", "config.yml");
    let config = fs.readFileSync(configPath, "utf8");
    config = config.replace(/confirm_rounds:\s*\d+/, "confirm_rounds: 3");
    fs.writeFileSync(configPath, config);

    const cid = "hook-cfg-aaaa-bbbb-cccc-ddddeeee0002";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "demo",
      checklist_path: path.join(root, "plans", "demo", "checklist.md"),
    });
    store.updateReviewChain(cid, {
      chain_pending: 1,
      code_edited: 0,
      confirm_left: null,
      item_confirm_complete: 0,
      fix_round: 0,
    });
    store.close();

    const hook = path.join(
      root,
      ".autopilot",
      "bin",
      "autopilot-harness-hook.mjs",
    );
    const proc = spawnSync(
      process.execPath,
      [hook, "--event", "stop"],
      {
        cwd: root,
        input: JSON.stringify({
          conversation_id: cid,
          status: "completed",
          loop_count: 1,
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(proc.status).toBe(0);
    const out = JSON.parse(proc.stdout.trim() || "{}") as {
      followup_message?: string;
      loop?: boolean;
    };
    expect(out.loop).toBe(true);
    expect(out.followup_message).toBeTruthy();
    expect(out.followup_message).toMatch(/1\/3/);
    expect(out.followup_message).toMatch(/自审确认|正确性与不变量/);
  });

  it("beforeSubmitPrompt ordinary chat keeps pending_followup (E8 vendor)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const cid = "hook-e8-aaaa-bbbb-cccc-ddddeeee0003";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "demo",
      checklist_path: path.join(root, "plans", "demo", "checklist.md"),
    });
    store.updateReviewChain(cid, {
      chain_pending: 1,
      confirm_left: 2,
      pending_followup: "Review confirm 3/5 undelivered vendor-e8",
      pending_followup_at: new Date().toISOString(),
    });
    store.close();

    const hook = path.join(
      root,
      ".autopilot",
      "bin",
      "autopilot-harness-hook.mjs",
    );
    const proc = spawnSync(
      process.execPath,
      [hook, "--event", "beforeSubmitPrompt"],
      {
        cwd: root,
        input: JSON.stringify({
          conversation_id: cid,
          prompt: "hello ordinary chat",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(proc.status).toBe(0);

    const store2 = new StateStore(root);
    const chain = store2.getReviewChain(cid)!;
    expect(chain.chain_pending).toBe(0);
    expect(chain.pending_followup).toBe(
      "Review confirm 3/5 undelivered vendor-e8",
    );
    expect(chain.confirm_left).toBe(2);
    store2.close();
  });

  it("shipped vendor savePendingFollowup rejects NUL pending", () => {
    const runtime = path.join(
      process.cwd(),
      "packages/cli/assets/vendor/runtime.mjs",
    );
    const src = fs.readFileSync(runtime, "utf8");
    // Cursor channel C: snake_case user_message + empty-message fallback
    expect(src).toMatch(
      /function blockSubmit\([\s\S]*?user_message:\s*\w+[\s\S]*?userMessage:\s*\w+/,
    );
    expect(src).toMatch(/Request blocked\./);
    // Claude channel A: needPick → additionalContext (never decision:block)
    expect(src).toMatch(/function allowNeedPickContext\(/);
    expect(src).toMatch(/isSafeTrackSlug\(s\)/);
    expect(src).toMatch(
      /hookEventName:\s*"UserPromptSubmit"[\s\S]*?additionalContext:/,
    );
    expect(src).toMatch(/msg\.includes\("\\0"\)/);
    expect(src).toMatch(/pending_followup\.includes\("\\0"\)/);
    // ensureReviewChain must re-read chain after session check (not stale pre-check row).
    expect(src).toMatch(
      /NOT EXISTS \(SELECT 1 FROM sessions WHERE conversation_id = \?\)[\s\S]*?let ensured = this\.getReviewChain\(conversationId\)/,
    );
    expect(src).toMatch(
      /upsertSession\(partial\) \{\s*if \(this\.isInvalidConversationId\(partial\.conversation_id\)\)/,
    );
    expect(src).toMatch(/isConversationIdOk\(input\.conversationId\)/);
    expect(src).toMatch(/msg\.includes\("No session for conversation"\)/);
    expect(src).toMatch(/msg\.includes\("Invalid conversation id"\)/);
    expect(src).toMatch(/afterFollowupCommitted/);
    // handleErrorStop: pause-threshold upsert failure → column pause + neutralize.
    expect(src).toMatch(/pauseSessionForRepeatedErrors\(/);
    expect(src).toMatch(/neutralizeReviewChain\(session\.conversation_id\)/);
    expect(src).toMatch(/disarmSession\(session\.conversation_id\)/);
    // Halt package: atomic exclusiveWrite first; per-step try only in catch fallback.
    expect(src).toMatch(
      /exclusiveWrite\(\(\) => \{\s*this\.store\.pauseSessionForRepeatedErrors/,
    );
    expect(src).toMatch(
      /paused_reason = COALESCE\(paused_reason, 'repeated_errors'\)/,
    );
    expect(src).toMatch(
      /pending_redeliver_at = \?,[\s\S]*?chain_pending = CASE[\s\S]*?ELSE 1[\s\S]*?AND pending_followup IS NOT NULL[\s\S]*?AND trim\(pending_followup\) != ''/,
    );
    expect(src).toMatch(
      /kind: "stuck",\s*message: this\.render\("stuck", \{\}\),\s*loop: false/,
    );
    expect(src).toMatch(
      /if \(!action\.loop\) \{\s*return \{ followup_message: action\.message \};/,
    );
  });

  it("doctor FAILs when vendor runtime is missing", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    fs.rmSync(path.join(root, ".autopilot", "bin", "vendor"), {
      recursive: true,
      force: true,
    });
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/hook vendor runtime missing/i);
  });

  it("doctor FAILs when vendor runtime is a symlink", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const vendor = path.join(
      root,
      ".autopilot",
      "bin",
      "vendor",
      "runtime.mjs",
    );
    const outside = path.join(root, "outside-runtime.mjs");
    fs.renameSync(vendor, outside);
    fs.symlinkSync(outside, vendor);
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/symlink|hook vendor/i);
  });

  it("doctor FAILs when hook binary is a dangling symlink (not treated as missing)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const hook = path.join(
      root,
      ".autopilot",
      "bin",
      "autopilot-harness-hook.mjs",
    );
    fs.rmSync(hook, { force: true });
    fs.symlinkSync(path.join(root, "missing-hook.mjs"), hook);
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/symlink|hook binary/i);
    expect(lines.join("\n")).not.toMatch(/hook binary missing/i);
  });

  it("init --force refuses when .autopilot/bin is a symlink", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const bin = path.join(root, ".autopilot", "bin");
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-evil-bin-"));
    try {
      const outsideBin = path.join(outside, "bin");
      fs.renameSync(bin, outsideBin);
      fs.symlinkSync(outsideBin, bin);
      const result = installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: true,
      });
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error).toMatch(/symlink|realpath/i);
      const doctor = runDoctor(root);
      expect(doctor.ok).toBe(false);
      expect(doctor.lines.join("\n")).toMatch(/hook bin|symlink|realpath/i);
      expect(doctor.lines.join("\n")).not.toMatch(
        /OK\s+autopilot-harness-hook\.mjs/,
      );
      expect(doctor.lines.join("\n")).not.toMatch(/OK\s+hook vendor runtime/);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
