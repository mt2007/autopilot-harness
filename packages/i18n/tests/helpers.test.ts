import { describe, expect, it } from "vitest";
import {
  isLocaleCode,
  sameStringList,
  skillDescription,
  stockTriggers,
} from "../src/index.js";

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

  it("skillDescription returns locale-specific text", () => {
    const en = skillDescription("en", "autopilot-on");
    const zh = skillDescription("zh-CN", "autopilot-on");
    expect(en.length).toBeGreaterThan(0);
    expect(zh.length).toBeGreaterThan(0);
    expect(en).not.toBe(zh);
  });
});
