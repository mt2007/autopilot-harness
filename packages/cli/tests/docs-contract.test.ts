import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { writeQuickstart } from "../src/init/wizard-helpers.js";
import os from "node:os";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-docs-contract-"));
}

/** Markers that OSS quickstart and init-generated quickstart must both carry. */
const EN_MARKERS = [
  /Self-review scope/,
  /review\.scope/,
  /executing_only/,
  /\*\*`project`\*\*/,
  /claim/,
  /unpaused/,
  /loop_limit/,
] as const;

const ZH_MARKERS = [
  /自审范围/,
  /review\.scope/,
  /executing_only/,
  /\*\*`project`\*\*/,
  /认领/,
  /未 pause/,
  /loop_limit/,
  /开启自动驾驶/,
  /开始执行/,
  /关闭自动驾驶/,
] as const;

describe("docs contract (review.scope / claim / troubleshooting)", () => {
  it("OSS English quickstart keeps review.scope + claim markers", () => {
    const body = fs.readFileSync(
      path.join(repoRoot, "docs/autopilot/quickstart.md"),
      "utf8",
    );
    for (const re of EN_MARKERS) expect(body).toMatch(re);
    expect(body).toMatch(/docs\/config\.md|Config\]\(\.\.\/config\.md\)/);
    expect(body).toMatch(/Troubleshooting/);
  });

  it("OSS Chinese quickstart keeps review.scope + claim markers", () => {
    const body = fs.readFileSync(
      path.join(repoRoot, "docs/autopilot/quickstart.zh-CN.md"),
      "utf8",
    );
    for (const re of ZH_MARKERS) expect(body).toMatch(re);
  });

  it("init writeQuickstart(en) matches OSS review.scope markers", () => {
    const root = tmpProject();
    try {
      const rel = writeQuickstart(root, "en");
      const body = fs.readFileSync(path.join(root, rel!), "utf8");
      for (const re of EN_MARKERS) expect(body).toMatch(re);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("init writeQuickstart(zh-CN) matches OSS review.scope markers", () => {
    const root = tmpProject();
    try {
      const rel = writeQuickstart(root, "zh-CN");
      const body = fs.readFileSync(path.join(root, rel!), "utf8");
      for (const re of ZH_MARKERS) expect(body).toMatch(re);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("config / troubleshooting / hosts docs exist with key anchors", () => {
    const config = fs.readFileSync(path.join(repoRoot, "docs/config.md"), "utf8");
    expect(config).toMatch(/review\.scope/);
    expect(config).toMatch(/confirm_rounds/);
    expect(config).toMatch(/\.autopilotignore/);

    const tips = fs.readFileSync(
      path.join(repoRoot, "docs/troubleshooting.md"),
      "utf8",
    );
    expect(tips).toMatch(/loop_limit/);
    expect(tips).toMatch(/double followup/i);

    const hosts = fs.readFileSync(path.join(repoRoot, "docs/hosts.md"), "utf8");
    expect(hosts).toMatch(/Cursor/);
    expect(hosts).toMatch(/Claude Code/);
    expect(hosts).toMatch(/Codex/);
  });

  it("README.zh-CN exists and points at English authority", () => {
    const body = fs.readFileSync(path.join(repoRoot, "README.zh-CN.md"), "utf8");
    expect(body).toMatch(/README\.md/);
    expect(body).toMatch(/review\.scope|自审/);
  });

  it("config documents confirm_rounds clamp and light-mode=3 only", () => {
    const config = fs.readFileSync(path.join(repoRoot, "docs/config.md"), "utf8");
    expect(config).toMatch(/1\.\.5/);
    expect(config).toMatch(/Only \*\*`3`\*\*/);
  });

  it("config does not imply require_token is enforced", () => {
    const config = fs.readFileSync(path.join(repoRoot, "docs/config.md"), "utf8");
    expect(config).toMatch(/require_token/);
    expect(config).toMatch(/not enforced/i);
  });

  it("architecture: no dangling v0.1 plan; Claude mitigations marked planned", () => {
    const body = fs.readFileSync(
      path.join(repoRoot, "docs/architecture.md"),
      "utf8",
    );
    expect(body).not.toMatch(/See the v0\.1 plan/);
    expect(body).toMatch(/ReviewEngine/);
    expect(body).toMatch(/hosts\.md/);
    expect(body).toMatch(/Claude Code[\s\S]*Planned:/);
    expect(body).not.toMatch(
      /Claude Code[\s\S]*Init writes `\.claude\/settings\.json`/,
    );
    expect(body).toMatch(/only installs Cursor/i);
    expect(body).not.toMatch(/npx autopilot-harness/);
  });
});
