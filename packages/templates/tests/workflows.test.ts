import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../templates/workflows",
);

describe("P1 workflow templates", () => {
  it("planning contains frontier markers and no-product-code gate", () => {
    const text = fs.readFileSync(
      path.join(root, "autopilot-planning.md"),
      "utf8",
    );
    expect(text).toContain("❓");
    expect(text).toContain("➡️");
    expect(text).toMatch(/\/autopilot-run/);
    expect(text.toLowerCase()).toMatch(/no product code|禁.*产品代码|do \*\*not\*\* write product code/);
    expect(text).toMatch(/## Behavior deltas/);
    expect(text).toMatch(/\/autopilot-archive/);
    expect(text).toMatch(/artifacts\.specs_dir/);
    expect(text).toMatch(/not\*\* required|\*\*not\*\* required|not required/i);
  });

  it("planning locks global Qn across rounds (no per-round Q1 example)", () => {
    const text = fs.readFileSync(
      path.join(root, "autopilot-planning.md"),
      "utf8",
    );
    expect(text).toMatch(/globally across rounds/i);
    expect(text).toMatch(/do not restart at Q1/i);

    const fenceMatch = text.match(/```markdown\r?\n([\s\S]*?)```/);
    expect(fenceMatch?.[1], "frontier example fence").toBeTruthy();
    const fence = fenceMatch![1]!;
    expect(fence).toMatch(/### Round k/);
    expect(fence).toContain("❓ **Qn**");
    expect(fence).not.toContain("**Q1**");
  });

  it("executing requires checkoff before next item and obeys lenses", () => {
    const text = fs.readFileSync(
      path.join(root, "autopilot-executing.md"),
      "utf8",
    );
    expect(text).toMatch(/Mark the \*\*current\*\* item|checkoff|\[x\]/i);
    expect(text).toMatch(/review\.verify\.commands/);
    expect(text).not.toMatch(/No subagents for review/i);
  });

  it("planning and executing soft-suggest Paths / Done when / Verify work orders", () => {
    const planning = fs.readFileSync(
      path.join(root, "autopilot-planning.md"),
      "utf8",
    );
    const executing = fs.readFileSync(
      path.join(root, "autopilot-executing.md"),
      "utf8",
    );
    for (const [label, text] of [
      ["planning", planning],
      ["executing", executing],
    ] as const) {
      expect(text, label).toMatch(/\*\*Paths:\*\*/);
      expect(text, label).toMatch(/\*\*Done when:\*\*/);
      expect(text, label).toMatch(/\*\*Verify:\*\*/);
      expect(text, label).toMatch(/soft/i);
      expect(text, label).toMatch(/Never|never/);
      expect(text, label).toMatch(/ITEM_RE|line-start|top-level/);
    }
    expect(planning).toMatch(/Checklist work orders/);
    expect(executing).toMatch(/Checklist supplements/);
    expect(planning).toMatch(/Never\*\* put `- \[ \]|Never.*`- \[ \]/);
    expect(executing).toMatch(/Do \*\*not\*\* put `- \[ \]/);
  });

  it("keeps cli bundled workflow copies identical to packages/templates", () => {
    const cliRoot = path.resolve(root, "../../cli/assets/templates/workflows");
    for (const name of ["autopilot-planning.md", "autopilot-executing.md"]) {
      const src = fs.readFileSync(path.join(root, name), "utf8");
      const bundled = fs.readFileSync(path.join(cliRoot, name), "utf8");
      expect(bundled, name).toBe(src);
    }
  });
});
