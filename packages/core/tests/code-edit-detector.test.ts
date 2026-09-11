import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearAutopilotIgnoreCache } from "../src/autopilot-ignore.js";
import {
  hasDirtyProductCode,
  isProductCodeEdit,
} from "../src/code-edit-detector.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-dirty-"));
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

function initRepo(root: string): void {
  git(root, ["init"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  // Default branch name varies; commit works either way.
  fs.writeFileSync(path.join(root, "README.md"), "# t\n");
  fs.mkdirSync(path.join(root, "packages"), { recursive: true });
  fs.writeFileSync(path.join(root, "packages", "ok.ts"), "export const a = 1;\n");
  fs.writeFileSync(
    path.join(root, ".autopilotignore"),
    "plans/**\n.autopilot/**\n",
  );
  git(root, ["add", "-A"]);
  git(root, ["commit", "-m", "init"]);
}

afterEach(() => {
  clearAutopilotIgnoreCache();
});

describe("hasDirtyProductCode", () => {
  it("fail-closed outside a git repo", () => {
    const root = tmpRoot();
    fs.writeFileSync(path.join(root, "x.ts"), "1");
    expect(hasDirtyProductCode(root)).toBe(false);
  });

  it("false on clean tree", () => {
    const root = tmpRoot();
    initRepo(root);
    expect(hasDirtyProductCode(root)).toBe(false);
  });

  it("true when a product file is dirty vs HEAD (shell-style write)", () => {
    const root = tmpRoot();
    initRepo(root);
    fs.writeFileSync(
      path.join(root, "packages", "ok.ts"),
      "export const a = 2;\n",
    );
    expect(
      isProductCodeEdit(path.join(root, "packages", "ok.ts"), {
        projectRoot: root,
      }),
    ).toBe(true);
    expect(hasDirtyProductCode(root)).toBe(true);
  });

  it("true for untracked product file", () => {
    const root = tmpRoot();
    initRepo(root);
    fs.writeFileSync(path.join(root, "packages", "new.ts"), "export {};\n");
    expect(hasDirtyProductCode(root)).toBe(true);
  });

  it("true when dirty product path contains a space (git -z)", () => {
    const root = tmpRoot();
    initRepo(root);
    const spaced = path.join(root, "packages", "my file.ts");
    fs.writeFileSync(spaced, "export const s = 1;\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-m", "space"]);
    fs.writeFileSync(spaced, "export const s = 2;\n");
    expect(hasDirtyProductCode(root)).toBe(true);
  });

  it("false when only autopilot-ignored paths are dirty", () => {
    const root = tmpRoot();
    initRepo(root);
    fs.mkdirSync(path.join(root, "plans", "x"), { recursive: true });
    fs.writeFileSync(path.join(root, "plans", "x", "checklist.md"), "- [ ] a\n");
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".autopilot", "verify-last.json"),
      '{"itemId":"a","ok":true}\n',
    );
    expect(hasDirtyProductCode(root)).toBe(false);
  });

  it("rejects empty / NUL project roots", () => {
    expect(hasDirtyProductCode("")).toBe(false);
    expect(hasDirtyProductCode("a\0b")).toBe(false);
  });
});
