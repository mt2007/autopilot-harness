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
});
