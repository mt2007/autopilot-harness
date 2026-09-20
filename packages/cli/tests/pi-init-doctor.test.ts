/**
 * init / doctor / upgrade / uninstall / --add-platform for Pi (in-process).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  INSTALLABLE_BINDINGS,
  PI_EXTENSION_FINGERPRINTS,
  PI_EXTENSION_REL_PATH,
  PI_SOFT_MIN_VERSION,
  defaultSurfaceFor,
  installInitYes,
  installPiExtension,
  isInstallableBinding,
  isPiVersionBelowSoftMin,
  normalizeBinding,
  piExtensionContainsAutopilot,
  probePiCliVersion,
  runDoctor,
  uninstallProject,
  upgradeProject,
} from "../src/index.js";

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-pi-init-"));
}

describe("pi installable binding", () => {
  it("INSTALLABLE_BINDINGS includes pi/cli", () => {
    expect(
      INSTALLABLE_BINDINGS.some((b) => b.id === "pi" && b.surface === "cli"),
    ).toBe(true);
    expect(defaultSurfaceFor("pi")).toBe("cli");
    expect(isInstallableBinding({ id: "pi", surface: "cli" })).toBe(true);
    expect(normalizeBinding("pi")).toEqual({ id: "pi", surface: "cli" });
  });

  it("isPiVersionBelowSoftMin treats missing as older", () => {
    expect(isPiVersionBelowSoftMin(null)).toBe(true);
    expect(isPiVersionBelowSoftMin("0.1.0")).toBe(true);
    expect(isPiVersionBelowSoftMin(PI_SOFT_MIN_VERSION)).toBe(false);
    expect(isPiVersionBelowSoftMin("9.9.9")).toBe(false);
  });

  it("probePiCliVersion accepts injectable runner", () => {
    expect(probePiCliVersion(() => "pi 0.85.1\n")).toBe("0.85.1");
    expect(
      probePiCliVersion(() => `${"banner ".repeat(40)}0.85.1\n`),
    ).toBe("0.85.1");
    expect(probePiCliVersion(() => "no-version-here")).toBe("no-version-here");
    expect(probePiCliVersion(() => "x".repeat(200))).toHaveLength(80);
    expect(probePiCliVersion(() => {
      throw new Error("missing");
    })).toBeNull();
  });

  it("installPiExtension unlinks dest when post-write fingerprint fails", () => {
    const root = tmpProject();
    const fakeCli = fs.mkdtempSync(path.join(os.tmpdir(), "ap-pi-cli-"));
    try {
      const tplDir = path.join(fakeCli, "assets", "pi-extension");
      fs.mkdirSync(tplDir, { recursive: true });
      fs.writeFileSync(
        path.join(tplDir, "autopilot.ts"),
        "// not an Autopilot Pi extension\n",
        "utf8",
      );
      expect(() => installPiExtension(root, fakeCli)).toThrow(/fingerprint/i);
      expect(
        fs.existsSync(path.join(root, ".pi", "extensions", "autopilot.ts")),
      ).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(fakeCli, { recursive: true, force: true });
    }
  });
});

describe("pi init / add-platform / doctor / uninstall", () => {
  let root = "";

  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    root = "";
  });

  it("init pi-only writes extension + .agents skills, not Antigravity hooks", () => {
    root = tmpProject();
    const result = installInitYes({
      projectRoot: root,
      platforms: [{ id: "pi", surface: "cli" }],
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const extPath = path.join(root, ".pi", "extensions", "autopilot.ts");
    expect(fs.existsSync(extPath)).toBe(true);
    const ext = fs.readFileSync(extPath, "utf8");
    expect(piExtensionContainsAutopilot(ext)).toBe(true);
    for (const fp of PI_EXTENSION_FINGERPRINTS) {
      expect(ext).toContain(fp);
    }

    expect(
      fs.existsSync(
        path.join(root, ".agents", "skills", "autopilot-on", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      fs.readFileSync(
        path.join(root, ".agents", "skills", "autopilot-on", "SKILL.md"),
        "utf8",
      ),
    ).toMatch(/^disable-model-invocation:\s*true$/m);
    expect(fs.existsSync(path.join(root, ".agents", "hooks.json"))).toBe(
      false,
    );

    const ignore = fs.readFileSync(path.join(root, ".autopilotignore"), "utf8");
    expect(ignore).toMatch(/\.pi\/extensions\/autopilot\*/);

    const cfg = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(cfg).toMatch(/id: pi/);
    expect(cfg).toMatch(/surface: cli/);
  });

  it("init does not require pi on PATH (R4)", () => {
    root = tmpProject();
    const prev = process.env.PATH;
    try {
      process.env.PATH = "/nonexistent-pi-bin-dir";
      const result = installInitYes({
        projectRoot: root,
        platforms: [{ id: "pi", surface: "cli" }],
        locale: "en",
        force: false,
      });
      expect(result.ok).toBe(true);
      expect(
        fs.existsSync(path.join(root, ".pi", "extensions", "autopilot.ts")),
      ).toBe(true);
    } finally {
      process.env.PATH = prev;
    }
  });

  it("add-platform pi keeps Cursor hooks and writes extension", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        force: false,
        locale: "en",
      }).ok,
    ).toBe(true);

    const add = installInitYes({
      projectRoot: root,
      platforms: [{ id: "pi", surface: "cli" }],
      locale: "en",
      force: true,
      mergePlatforms: true,
    });
    expect(add.ok).toBe(true);

    const cfg = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(cfg).toMatch(/id: cursor/);
    expect(cfg).toMatch(/id: pi/);
    expect(fs.existsSync(path.join(root, ".cursor", "hooks.json"))).toBe(true);
    expect(
      fs.existsSync(path.join(root, ".pi", "extensions", "autopilot.ts")),
    ).toBe(true);
    expect(fs.existsSync(path.join(root, ".agents", "hooks.json"))).toBe(
      false,
    );
  });

  it("doctor FAILs missing fingerprint and WARNs R10/trust", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [{ id: "pi", surface: "cli" }],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const okDoc = runDoctor(root);
    const okText = okDoc.lines.join("\n");
    expect(okText).toMatch(
      new RegExp(`OK\\s+${PI_EXTENSION_REL_PATH.replace(/\./g, "\\.")}`),
    );
    expect(okText).toMatch(/WARN\s+Pi tip:.*\/trust/i);
    expect(okText).toMatch(/WARN\s+Pi tip \(R10\)/i);

    fs.unlinkSync(path.join(root, ".pi", "extensions", "autopilot.ts"));
    const failDoc = runDoctor(root);
    expect(failDoc.ok).toBe(false);
    expect(failDoc.lines.join("\n")).toMatch(
      new RegExp(`FAIL\\s+${PI_EXTENSION_REL_PATH.replace(/\./g, "\\.")} missing`),
    );
  });

  it("symlink .pi/extensions/autopilot.ts fail-closed on init", () => {
    root = tmpProject();
    const piDir = path.join(root, ".pi", "extensions");
    fs.mkdirSync(piDir, { recursive: true });
    const dest = path.join(piDir, "autopilot.ts");
    const outside = path.join(root, "outside.ts");
    fs.writeFileSync(outside, "x\n", "utf8");
    fs.symlinkSync(outside, dest);

    const result = installInitYes({
      projectRoot: root,
      platforms: [{ id: "pi", surface: "cli" }],
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/symlink/i);
  });

  it("upgrade refreshes pi extension", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [{ id: "pi", surface: "cli" }],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const extPath = path.join(root, ".pi", "extensions", "autopilot.ts");
    fs.writeFileSync(extPath, "// stale\n", "utf8");

    const up = upgradeProject({ projectRoot: root, dryRun: false });
    expect(up.ok).toBe(true);
    if (!up.ok) return;
    expect(up.actions.some((a) => a.includes(".pi/extensions/autopilot.ts"))).toBe(
      true,
    );
    const ext = fs.readFileSync(extPath, "utf8");
    expect(piExtensionContainsAutopilot(ext)).toBe(true);
  });

  it("uninstall removes extension and shared agents skills", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [{ id: "pi", surface: "cli" }],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const un = uninstallProject({ projectRoot: root, dryRun: false });
    expect(un.ok).toBe(true);
    if (!un.ok) return;
    expect(
      fs.existsSync(path.join(root, ".pi", "extensions", "autopilot.ts")),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(root, ".agents", "skills", "autopilot-on", "SKILL.md"),
      ),
    ).toBe(false);
  });

  it("uninstall dry-run does not claim unlink when extension already missing", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [{ id: "pi", surface: "cli" }],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    fs.unlinkSync(path.join(root, ".pi", "extensions", "autopilot.ts"));

    const un = uninstallProject({ projectRoot: root, dryRun: true });
    expect(un.ok).toBe(true);
    if (!un.ok) return;
    expect(un.actions.some((a) => a.includes(`unlink ${PI_EXTENSION_REL_PATH}`))).toBe(
      false,
    );
  });

  it("uninstall fail-closed on pi extension symlink surfaces outer catch", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [{ id: "pi", surface: "cli" }],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const dest = path.join(root, ".pi", "extensions", "autopilot.ts");
    const outside = path.join(root, "outside-ext.ts");
    fs.writeFileSync(outside, "x\n", "utf8");
    fs.unlinkSync(dest);
    fs.symlinkSync(outside, dest);

    const un = uninstallProject({ projectRoot: root, dryRun: false });
    expect(un.ok).toBe(false);
    if (un.ok) return;
    expect(un.error).toMatch(/symlink/i);
  });
});
