import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearAutopilotIgnoreCache,
  DEFAULT_AUTOPILOT_IGNORE_PATTERNS,
  DEFAULT_AUTOPILOT_IGNORE_TEXT,
  isAutopilotIgnoredPath,
  loadAutopilotIgnorePatterns,
  parseAutopilotIgnore,
  toProjectRelativePath,
} from "../src/autopilot-ignore.js";
import { isProductCodeEdit } from "../src/code-edit-detector.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-ignore-"));
}

function patternLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

afterEach(() => {
  clearAutopilotIgnoreCache();
});

describe("parseAutopilotIgnore", () => {
  it("ignores comments and blank lines", () => {
    const patterns = parseAutopilotIgnore("# comment\n\nplans/**\n");
    expect(patterns).toHaveLength(1);
    expect(patterns[0]?.negated).toBe(false);
  });

  it("supports negation", () => {
    const patterns = parseAutopilotIgnore("docs/**\n!docs/feed/**/*.yml\n");
    expect(patterns).toHaveLength(2);
    expect(patterns[1]?.negated).toBe(true);
  });

  it("drops oversized pattern lines (untrusted ReDoS bound)", () => {
    const huge = `src/${"a".repeat(5_000)}.ts`;
    const patterns = parseAutopilotIgnore(`${huge}\nplans/**\n`);
    expect(patterns).toHaveLength(1);
    expect(isAutopilotIgnoredPath("plans/x.md", patterns)).toBe(true);
    expect(
      isAutopilotIgnoredPath(`src/${"a".repeat(5_000)}.ts`, patterns),
    ).toBe(false);
  });

  it("caps compiled pattern count", () => {
    const lines = Array.from({ length: 10_001 }, (_, i) => `p${i}/**`).join(
      "\n",
    );
    expect(parseAutopilotIgnore(lines)).toHaveLength(10_000);
  });

  it("DEFAULT pattern lines match packages/templates/.autopilotignore", () => {
    const templatePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../templates/.autopilotignore",
    );
    const template = fs.readFileSync(templatePath, "utf8");
    expect(patternLines(DEFAULT_AUTOPILOT_IGNORE_TEXT)).toEqual(
      patternLines(template),
    );
  });
});

describe("isAutopilotIgnoredPath", () => {
  it("matches plans/** and runtime dirs; docs/md not ignored by default", () => {
    expect(
      isAutopilotIgnoredPath("plans/foo/checklist.md", DEFAULT_AUTOPILOT_IGNORE_PATTERNS),
    ).toBe(true);
    expect(
      isAutopilotIgnoredPath(".autopilot/config.yml", DEFAULT_AUTOPILOT_IGNORE_PATTERNS),
    ).toBe(true);
    expect(
      isAutopilotIgnoredPath(".cursor/hooks.json", DEFAULT_AUTOPILOT_IGNORE_PATTERNS),
    ).toBe(true);
    expect(
      isAutopilotIgnoredPath(".claude/settings.json", DEFAULT_AUTOPILOT_IGNORE_PATTERNS),
    ).toBe(true);
    expect(
      isAutopilotIgnoredPath("docs/readme.md", DEFAULT_AUTOPILOT_IGNORE_PATTERNS),
    ).toBe(false);
    expect(
      isAutopilotIgnoredPath("docs/feed/agent.yml", DEFAULT_AUTOPILOT_IGNORE_PATTERNS),
    ).toBe(false);
    expect(
      isAutopilotIgnoredPath("src/readme.md", DEFAULT_AUTOPILOT_IGNORE_PATTERNS),
    ).toBe(false);
    expect(
      isAutopilotIgnoredPath("assets/logo.png", DEFAULT_AUTOPILOT_IGNORE_PATTERNS),
    ).toBe(true);
    expect(
      isAutopilotIgnoredPath("target/release/foo", DEFAULT_AUTOPILOT_IGNORE_PATTERNS),
    ).toBe(true);
  });

  it("last-match negation un-ignores deliverable yaml under docs/", () => {
    const patterns = parseAutopilotIgnore(`docs/**\n!docs/feed/**/*.yml\n`);
    expect(isAutopilotIgnoredPath("docs/other/x.yml", patterns)).toBe(true);
    expect(isAutopilotIgnoredPath("docs/feed/agent.yml", patterns)).toBe(false);
  });
});

describe("loadAutopilotIgnorePatterns", () => {
  it("uses built-in defaults when file missing", () => {
    const root = tmpRoot();
    const patterns = loadAutopilotIgnorePatterns(root);
    expect(patterns.length).toBe(DEFAULT_AUTOPILOT_IGNORE_PATTERNS.length);
  });

  it("loads project file when present", () => {
    const root = tmpRoot();
    fs.writeFileSync(
      path.join(root, ".autopilotignore"),
      "custom-only/**\n",
      "utf8",
    );
    const patterns = loadAutopilotIgnorePatterns(root);
    expect(patterns).toHaveLength(1);
    expect(isAutopilotIgnoredPath("custom-only/x.ts", patterns)).toBe(true);
    expect(isAutopilotIgnoredPath("src/index.ts", patterns)).toBe(false);
  });
});

describe("isProductCodeEdit + autopilotignore", () => {
  it("excludes .autopilot/.cursor/.claude via default ignore (overridable)", () => {
    expect(isProductCodeEdit(".autopilot/config.yml")).toBe(false);
    expect(isProductCodeEdit(".cursor/hooks.json")).toBe(false);
    expect(isProductCodeEdit(".claude/settings.json")).toBe(false);

    const root = tmpRoot();
    // Empty ignore file → no patterns → runtime paths count as product.
    fs.writeFileSync(path.join(root, ".autopilotignore"), "\n", "utf8");
    expect(
      isProductCodeEdit(".autopilot/config.yml", { projectRoot: root }),
    ).toBe(true);
  });

  it("allows docs/md by default; honors docs/** + ! exception", () => {
    expect(isProductCodeEdit("docs/feed/agent.yml")).toBe(true);
    expect(isProductCodeEdit("docs/design.md")).toBe(true);
    expect(isProductCodeEdit("services/config.yaml")).toBe(true);
    expect(isProductCodeEdit("readme.md")).toBe(true);
    expect(isProductCodeEdit("logo.png")).toBe(false);

    const root = tmpRoot();
    fs.writeFileSync(
      path.join(root, ".autopilotignore"),
      `docs/**\n!docs/feed/**/*.yml\n`,
      "utf8",
    );
    expect(
      isProductCodeEdit("docs/feed/agent.yml", { projectRoot: root }),
    ).toBe(true);
    expect(
      isProductCodeEdit("docs/other/agent.yml", { projectRoot: root }),
    ).toBe(false);
  });

  it("resolves absolute paths against projectRoot", () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    const abs = path.join(root, "src", "index.ts");
    expect(isProductCodeEdit(abs, { projectRoot: root })).toBe(true);
  });

  it("canonicalizes symlinked roots (e.g. macOS /var vs /private/var)", () => {
    const root = tmpRoot();
    const alias = `${root}-alias`;
    try {
      fs.symlinkSync(root, alias);
    } catch {
      // Platform may disallow dir symlinks (e.g. Windows without privilege).
      return;
    }
    try {
      fs.mkdirSync(path.join(root, "src"), { recursive: true });
      fs.writeFileSync(path.join(root, "src", "app.ts"), "export {}\n");
      const viaAlias = path.join(alias, "src", "app.ts");

      expect(toProjectRelativePath(viaAlias, root)).toBe("src/app.ts");
      expect(toProjectRelativePath(path.join(root, "src", "app.ts"), alias)).toBe(
        "src/app.ts",
      );
      expect(isProductCodeEdit(viaAlias, { projectRoot: root })).toBe(true);
      // Missing file under an existing parent still resolves.
      expect(
        toProjectRelativePath(path.join(alias, "src", "new.ts"), root),
      ).toBe("src/new.ts");
      // Symlink that escapes the project must not count as in-repo.
      const outside = path.join(path.dirname(root), `outside-${path.basename(root)}.ts`);
      fs.writeFileSync(outside, "// x", "utf8");
      try {
        fs.symlinkSync(outside, path.join(root, "leak.ts"));
        expect(toProjectRelativePath(path.join(root, "leak.ts"), root)).toBe(
          "",
        );
        expect(
          isProductCodeEdit(path.join(root, "leak.ts"), { projectRoot: root }),
        ).toBe(false);
      } finally {
        try {
          fs.unlinkSync(path.join(root, "leak.ts"));
        } catch {
          /* ignore */
        }
        try {
          fs.unlinkSync(outside);
        } catch {
          /* ignore */
        }
      }
    } finally {
      try {
        fs.rmSync(alias, { force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("rejects paths outside projectRoot", () => {
    const root = tmpRoot();
    const outside = path.join(path.dirname(root), "outside.ts");
    fs.writeFileSync(outside, "// x", "utf8");
    try {
      expect(isProductCodeEdit(outside, { projectRoot: root })).toBe(false);
      expect(
        isProductCodeEdit("../outside.ts", { projectRoot: root }),
      ).toBe(false);
    } finally {
      fs.unlinkSync(outside);
    }
  });

  it("falls back to defaults for symlink or oversized ignore file", () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, "plans", "t"), { recursive: true });
    const ignorePath = path.join(root, ".autopilotignore");
    fs.symlinkSync("/etc/hosts", ignorePath);
    expect(
      isProductCodeEdit("plans/t/checklist.md", { projectRoot: root }),
    ).toBe(false);
    fs.unlinkSync(ignorePath);
    fs.writeFileSync(ignorePath, "x".repeat(1_000_001), "utf8");
    clearAutopilotIgnoreCache();
    expect(
      isProductCodeEdit("plans/t/checklist.md", { projectRoot: root }),
    ).toBe(false);
  });

  it("does not treat project root path as a product edit", () => {
    const root = tmpRoot();
    expect(isProductCodeEdit(root, { projectRoot: root })).toBe(false);
  });
});
