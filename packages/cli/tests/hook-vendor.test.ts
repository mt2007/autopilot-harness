import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installInitYes } from "../src/init/install.js";
import { runDoctor } from "../src/status-doctor.js";

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-hook-vendor-"));
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
