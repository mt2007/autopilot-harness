import { describe, expect, it } from "vitest";
import {
  isLocaleCode,
  loadLocale,
  sameStringList,
  skillDescription,
  stockTriggers,
} from "../src/index.js";

/** Advance/done: mark [x] must appear before the commit instruction. */
function markComesBeforeCommit(text: string): boolean {
  const markIdx = text.search(
    /First mark the current item \[x\]|先勾选当前项 \[x\]|Mark the last item \[x\]|勾选最后一项 \[x\]/i,
  );
  const commitIdx = text.search(/conventional commit|本地 commit/i);
  return markIdx >= 0 && commitIdx > markIdx;
}

describe("i18n helpers", () => {
  it("isLocaleCode accepts only en and zh-CN", () => {
    expect(isLocaleCode("en")).toBe(true);
    expect(isLocaleCode("zh-CN")).toBe(true);
    expect(isLocaleCode("zh")).toBe(false);
    expect(isLocaleCode("en-US")).toBe(false);
    expect(isLocaleCode("")).toBe(false);
  });

  it("sameStringList is order-sensitive and type-strict", () => {
    expect(sameStringList(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameStringList(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameStringList(["a"], ["a", "b"])).toBe(false);
    expect(sameStringList("a", ["a"])).toBe(false);
    expect(sameStringList(null, [])).toBe(false);
  });

  it("stockTriggers returns defensive copies", () => {
    const a = stockTriggers("en");
    const b = stockTriggers("en");
    expect(a.on).toEqual(b.on);
    a.on.push("MUTATED");
    expect(b.on).not.toContain("MUTATED");
    expect(stockTriggers("en").on).not.toContain("MUTATED");
  });

  it("advance/done instruct mark [x] before commit (same scoped commit as implementation)", () => {
    for (const code of ["en", "zh-CN"] as const) {
      const f = loadLocale(code).followup;
      expect(markComesBeforeCommit(f.advance), `${code} advance`).toBe(true);
      expect(markComesBeforeCommit(f.done), `${code} done`).toBe(true);
      // Old inverted advance wording must stay gone.
      expect(f.advance).not.toMatch(/Then mark current item \[x\]|然后勾选当前项 \[x\]/);
    }
  });

  it("skillDescription returns locale-specific text", () => {
    const en = skillDescription("en", "autopilot-on");
    const zh = skillDescription("zh-CN", "autopilot-on");
    expect(en.length).toBeGreaterThan(0);
    expect(zh.length).toBeGreaterThan(0);
    expect(en).not.toBe(zh);
  });
});
