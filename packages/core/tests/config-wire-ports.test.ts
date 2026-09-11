/**
 * config-wire: Cursor/Claude ports load YAML triggers + plans_dir.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateStore } from "../src/index.js";
import {
  handleAfterFileEdit,
  handleBeforeSubmitPrompt,
} from "../../ports/cursor/src/index.js";
import {
  handlePostToolUse,
  handleUserPromptSubmit,
} from "../../ports/claude-code/src/index.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-config-wire-ports-"));
}

function writeConfig(root: string, body: string): void {
  fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
  fs.writeFileSync(path.join(root, ".autopilot", "config.yml"), body);
}

describe("config-wire ports (YAML triggers + plans_dir)", () => {
  let root = "";
  let store: StateStore | null = null;

  beforeEach(() => {
    root = tmpRoot();
    store = StateStore.openMemory(root);
  });
  afterEach(() => {
    try {
      store?.close();
    } catch {
      /* already closed */
    }
    store = null;
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    root = "";
  });

  function db(): StateStore {
    if (!store) throw new Error("store not opened");
    return store;
  }

  it("Cursor submit honors custom YAML ON phrase", () => {
    writeConfig(
      root,
      `
triggers:
  on:
    - Custom ON Phrase
`,
    );
    const out = handleBeforeSubmitPrompt(
      db(),
      { conversation_id: "cur-on", prompt: "Custom ON Phrase demo-track" },
      root,
    );
    expect(out).toEqual({ continue: true });
    const session = db().getSession("cur-on");
    expect(session?.phase).toBe("planning");
    expect(session?.track_id).toBe("demo-track");
  });

  it("Claude submit honors custom YAML ON phrase", () => {
    writeConfig(
      root,
      `
triggers:
  on:
    - Custom ON Phrase
`,
    );
    const out = handleUserPromptSubmit(
      db(),
      { session_id: "cla-on", prompt: "Custom ON Phrase demo-track" },
      root,
    );
    expect(out).toEqual({});
    const session = db().getSession("cla-on");
    expect(session?.phase).toBe("planning");
    expect(session?.track_id).toBe("demo-track");
    expect(session?.platform).toBe("claude-code");
  });

  it("Cursor afterFileEdit binds under YAML artifacts.plans_dir", () => {
    writeConfig(
      root,
      `
artifacts:
  plans_dir: work/plans
`,
    );
    const dir = path.join(root, "work", "plans", "alpha");
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, "checklist.md");
    fs.writeFileSync(filePath, `- [ ] a — A\n`);

    handleAfterFileEdit(
      db(),
      { conversation_id: "cur-bind", file_path: filePath },
      root,
    );
    expect(db().getSession("cur-bind")!.track_id).toBe("alpha");
  });

  it("Claude PostToolUse binds under YAML artifacts.plans_dir", () => {
    writeConfig(
      root,
      `
artifacts:
  plans_dir: work/plans
`,
    );
    const dir = path.join(root, "work", "plans", "beta");
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, "plan.md");
    fs.writeFileSync(filePath, `# beta\n`);

    handlePostToolUse(
      db(),
      {
        session_id: "cla-bind",
        tool_name: "Edit",
        tool_input: { file_path: filePath },
      },
      root,
    );
    expect(db().getSession("cla-bind")!.track_id).toBe("beta");
  });

  it("empty YAML on falls back so default Autopilot ON still works", () => {
    writeConfig(
      root,
      `
triggers:
  on: []
`,
    );
    handleBeforeSubmitPrompt(
      db(),
      { conversation_id: "cur-default", prompt: "Autopilot ON fallback" },
      root,
    );
    expect(db().getSession("cur-default")?.phase).toBe("planning");
  });

  it("Cursor RUN uses YAML plans_dir (single track → executing)", () => {
    writeConfig(
      root,
      `
artifacts:
  plans_dir: work/plans
`,
    );
    const dir = path.join(root, "work", "plans", "solo");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "plan.md"), `# solo\n`);
    fs.writeFileSync(path.join(dir, "checklist.md"), `- [ ] a — A\n`);

    const out = handleBeforeSubmitPrompt(
      db(),
      { conversation_id: "cur-run", prompt: "/autopilot-run" },
      root,
    );
    expect(out.continue).toBe(true);
    const session = db().getSession("cur-run");
    expect(session?.phase).toBe("executing");
    expect(session?.armed).toBe(1);
    expect(session?.track_id).toBe("solo");
  });

  it("explicit phaseActions.plansDir overrides YAML plans_dir", () => {
    writeConfig(
      root,
      `
artifacts:
  plans_dir: work/plans
`,
    );
    // YAML points at work/plans, but explicit override looks under alt/plans.
    const yamlDir = path.join(root, "work", "plans", "yaml-only");
    fs.mkdirSync(yamlDir, { recursive: true });
    fs.writeFileSync(path.join(yamlDir, "checklist.md"), `- [ ] y — Y\n`);
    const altDir = path.join(root, "alt", "plans", "override");
    fs.mkdirSync(altDir, { recursive: true });
    fs.writeFileSync(path.join(altDir, "plan.md"), `# override\n`);
    fs.writeFileSync(path.join(altDir, "checklist.md"), `- [ ] o — O\n`);

    const out = handleBeforeSubmitPrompt(
      db(),
      { conversation_id: "cur-override", prompt: "/autopilot-run" },
      root,
      { phaseActions: { plansDir: "alt/plans" } },
    );
    expect(out.continue).toBe(true);
    expect(db().getSession("cur-override")?.track_id).toBe("override");
    expect(db().getSession("cur-override")?.phase).toBe("executing");
  });
});
