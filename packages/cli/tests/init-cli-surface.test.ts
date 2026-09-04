import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const cliBin = path.join(repoRoot, "packages/cli/dist/bin.js");

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-cli-surface-"));
}

function runInit(root: string, args: string[]) {
  return spawnSync(process.execPath, [cliBin, "init", ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

describe("init CLI host-default surface", () => {
  it("requires a built CLI dist (spawn target)", () => {
    expect(fs.existsSync(cliBin)).toBe(true);
  });

  it("init --platform claude-code --yes uses cli without requiring --surface", () => {
    const root = tmpProject();
    try {
      const r = runInit(root, [
        "--platform",
        "claude-code",
        "--yes",
        "--locale",
        "en",
      ]);
      expect(r.status, r.stderr || r.stdout).toBe(0);
      expect(`${r.stderr}\n${r.stdout}`).not.toMatch(/Unsupported platform/i);
      const config = fs.readFileSync(
        path.join(root, ".autopilot", "config.yml"),
        "utf8",
      );
      expect(config).toMatch(/claude-code/);
      expect(config).toMatch(/surface:\s*cli/);
      expect(
        fs.existsSync(path.join(root, ".claude", "settings.json")),
      ).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("init --platform cursor --yes still defaults to ide", () => {
    const root = tmpProject();
    try {
      const r = runInit(root, [
        "--platform",
        "cursor",
        "--yes",
        "--locale",
        "en",
      ]);
      expect(r.status, r.stderr || r.stdout).toBe(0);
      const config = fs.readFileSync(
        path.join(root, ".autopilot", "config.yml"),
        "utf8",
      );
      expect(config).toMatch(/cursor/);
      expect(config).toMatch(/surface:\s*ide/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("explicit --surface cli still works for claude-code", () => {
    const root = tmpProject();
    try {
      const r = runInit(root, [
        "--platform",
        "claude-code",
        "--surface",
        "cli",
        "--yes",
        "--locale",
        "en",
      ]);
      expect(r.status, r.stderr || r.stdout).toBe(0);
      const config = fs.readFileSync(
        path.join(root, ".autopilot", "config.yml"),
        "utf8",
      );
      expect(config).toMatch(/surface:\s*cli/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("explicit wrong --surface ide with claude-code still fails closed", () => {
    const root = tmpProject();
    try {
      const r = runInit(root, [
        "--platform",
        "claude-code",
        "--surface",
        "ide",
        "--yes",
        "--locale",
        "en",
      ]);
      expect(r.status).not.toBe(0);
      expect(`${r.stderr}\n${r.stdout}`).toMatch(
        /Unsupported platform "claude-code" \(surface: ide\)/i,
      );
      expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
        false,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
