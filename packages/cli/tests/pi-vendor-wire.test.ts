/**
 * v0.14 vendor-platform-wire — INSTALLABLE pi/cli; vendor exports; R7 ten-way
 * shell (no pi in KNOWN_PLATFORMS); non-shell stamp abort; extension asset;
 * workspace:* publish list includes port-pi.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  INSTALLABLE_BINDINGS,
  defaultSurfaceFor,
  formatBindingOptionLabel,
  isInstallableBinding,
  normalizeBinding,
} from "../src/init/platforms.js";
import { PI_PLATFORM } from "@autopilot-harness/port-pi";

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(cliRoot, "../..");
const HOOK_ASSET = path.join(cliRoot, "assets/autopilot-harness-hook.mjs");
const PI_EXT = path.join(cliRoot, "assets/pi-extension/autopilot.ts");
const VENDOR_ENTRY = path.join(cliRoot, "src/vendor-entry.ts");
const BUNDLE_SCRIPT = path.join(cliRoot, "scripts/bundle-vendor.mjs");

describe("vendor-platform-wire (pi)", () => {
  it("INSTALLABLE_BINDINGS includes pi/cli", () => {
    expect(
      INSTALLABLE_BINDINGS.some((b) => b.id === "pi" && b.surface === "cli"),
    ).toBe(true);
    expect(defaultSurfaceFor("pi")).toBe("cli");
    expect(isInstallableBinding({ id: "pi", surface: "cli" })).toBe(true);
    expect(normalizeBinding("pi")).toEqual({ id: "pi", surface: "cli" });
    expect(formatBindingOptionLabel({ id: "pi", surface: "cli" })).toMatch(/Pi/i);
    expect(PI_PLATFORM).toBe("pi");
  });

  it("R7: shell KNOWN_PLATFORMS stays ten-way without pi", () => {
    const src = fs.readFileSync(HOOK_ASSET, "utf8");
    const known = src.match(
      /KNOWN_PLATFORMS\s*=\s*new Set\(\[([\s\S]*?)\]\)/,
    );
    expect(known).toBeTruthy();
    const ids = [...(known?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(10);
    expect(ids).not.toContain("pi");
    expect(ids).not.toContain("runner");
    expect(src).toMatch(/NON_SHELL_PLATFORMS/);
    expect(src).toMatch(/"pi"/);
  });

  it("shell hook --platform pi|runner aborts before FSM (cross stamp)", () => {
    expect(fs.existsSync(HOOK_ASSET)).toBe(true);
    for (const platform of ["pi", "runner"] as const) {
      const r = spawnSync(
        process.execPath,
        [HOOK_ASSET, "--event", "beforeSubmitPrompt", "--platform", platform],
        {
          input: JSON.stringify({ prompt: "hello" }),
          encoding: "utf8",
          timeout: 15_000,
        },
      );
      expect(r.status, platform).toBe(0);
      expect((r.stdout ?? "").trim(), platform).toBe("{}");
    }
  });

  it("ships Pi extension template + vendor-entry exports port-pi", () => {
    expect(fs.existsSync(PI_EXT)).toBe(true);
    const ext = fs.readFileSync(PI_EXT, "utf8");
    expect(ext).toMatch(/agent_settled/);
    expect(ext).toMatch(/handlePiAgentSettled|PI_CONTINUE_DELIVER/);
    expect(ext).toMatch(/\.autopilot\/bin\/vendor\/runtime\.mjs/);
    expect(ext).toMatch(/runtimePromise/);
    expect(ext).toMatch(/store\?\.close/);
    expect(ext).not.toMatch(/pi install/i);

    const entry = fs.readFileSync(VENDOR_ENTRY, "utf8");
    expect(entry).toMatch(/@autopilot-harness\/port-pi/);
    expect(entry).toMatch(/handlePiAgentSettled/);
    expect(entry).toMatch(/handlePiBeforeAgentStart/);
    expect(entry).toMatch(/handlePiToolResult/);

    const bundle = fs.readFileSync(BUNDLE_SCRIPT, "utf8");
    expect(bundle).toMatch(/port-pi/);
  });

  it("cli depends on port-pi workspace and public package list includes it", () => {
    const cliPkg = JSON.parse(
      fs.readFileSync(path.join(cliRoot, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(cliPkg.dependencies?.["@autopilot-harness/port-pi"]).toBe(
      "workspace:*",
    );
    const publicList = fs.readFileSync(
      path.join(cliRoot, "tests/public-npm-packages.ts"),
      "utf8",
    );
    expect(publicList).toMatch(/packages\/ports\/pi\/package\.json/);
    expect(
      fs.existsSync(path.join(repoRoot, "packages/ports/pi/package.json")),
    ).toBe(true);
  });
});
