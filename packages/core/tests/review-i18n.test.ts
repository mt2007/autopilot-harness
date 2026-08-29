import { describe, expect, it } from "vitest";
import {
  createRenderFollowup,
  createResolveLens,
  type FollowupLocaleBundle,
} from "../src/review-i18n.js";

const zhBundle: FollowupLocaleBundle = {
  followup: {
    review: {
      fix: "自审修复第 {round} 轮：检查完整 diff。",
      confirm: "自审确认 {n}/{total} — 角度（{lensTitle}）：{lensFocus}。",
      confirm_final: "自审确认 {n}/{total} — 终审（{lensTitle}）：{lensFocus}。",
    },
    advance: "推进：{nextId} — {nextTitle}",
    done: "全部完成。",
    recover: "恢复。",
    stuck: "卡住。",
    verify_fix: "校验失败（{reason}）。",
  },
  lens: {
    "scope-correctness": { title: "范围与正确性", focus: "逻辑与不变量。" },
    boundaries: { title: "边界", focus: "空值。" },
    security: { title: "安全", focus: "注入。" },
    concurrency: { title: "并发", focus: "竞态。" },
    "tests-regression": { title: "测试", focus: "缺测。" },
  },
};

describe("review-i18n", () => {
  it("renders followups from locale templates", () => {
    const render = createRenderFollowup(zhBundle);
    expect(render("review.fix", { round: 2 })).toContain("第 2 轮");
    expect(render("verify_fix", { reason: "missing" })).toContain("missing");
    expect(render("advance", { nextId: "a", nextTitle: "A" })).toContain("a — A");
  });

  it("resolves localized lenses for light mode (3 rounds → 1,2,5)", () => {
    const resolve = createResolveLens(zhBundle);
    expect(resolve(1, 3).title).toBe("范围与正确性");
    expect(resolve(2, 3).title).toBe("边界");
    expect(resolve(3, 3).title).toBe("测试");
  });

  it("createResolveLens falls back when lens map is missing", () => {
    const resolve = createResolveLens({
      followup: zhBundle.followup,
      lens: undefined as unknown as FollowupLocaleBundle["lens"],
    });
    expect(resolve(1, 5).key).toBe("scope-correctness");
  });
});
