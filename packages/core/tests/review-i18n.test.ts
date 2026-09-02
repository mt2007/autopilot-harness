import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createRenderFollowup,
  createResolveLens,
  type FollowupLocaleBundle,
} from "../src/review-i18n.js";
import { getLens, lensNumberForRound } from "../src/review-lenses.js";

const localesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../i18n/locales",
);

const zhBundle: FollowupLocaleBundle = {
  followup: {
    review: {
      fix: "自审修复第 {round} 轮（无硬顶；确认阶段需连续 {total} 轮无改动）。",
      confirm:
        "自审确认 {n}/{total}（会话第 {sessionRound} 轮）— 角度（{lensTitle}）：{lensFocus}。",
      confirm_final:
        "自审确认 {n}/{total}（会话第 {sessionRound} 轮）— 终审（{lensTitle}）：{lensFocus}。",
    },
    advance: "推进：{nextId} — {nextTitle}",
    done: "全部完成。",
    recover: "恢复。",
    stuck: "卡住。",
    verify_fix: "校验失败（{reason}）。",
  },
  lens: {
    "scope-correctness": { title: "正确性与不变量", focus: "逻辑与不变量。" },
    boundaries: { title: "空值、边界与错误路径", focus: "空值。" },
    concurrency: { title: "并发、竞态与部分失败", focus: "竞态。" },
    security: { title: "安全与信任边界", focus: "注入。" },
    "tests-regression": { title: "测试缺口与回归", focus: "缺测。" },
  },
};

describe("review-i18n", () => {
  it("renders followups from locale templates", () => {
    const render = createRenderFollowup(zhBundle);
    expect(render("review.fix", { round: 2, total: 5 })).toContain("第 2 轮");
    expect(render("review.confirm", { n: 1, total: 5, sessionRound: 3, lensTitle: "X", lensFocus: "Y" })).toContain(
      "会话第 3 轮",
    );
    expect(render("verify_fix", { reason: "missing" })).toContain("missing");
    expect(render("advance", { nextId: "a", nextTitle: "A" })).toContain("a — A");
  });

  it("shipped zh-CN/en recover copy is neutral (no 不要推进)", () => {
    const zh = JSON.parse(
      fs.readFileSync(path.join(localesDir, "zh-CN.json"), "utf8"),
    ) as FollowupLocaleBundle;
    const en = JSON.parse(
      fs.readFileSync(path.join(localesDir, "en.json"), "utf8"),
    ) as FollowupLocaleBundle;
    const zhMsg = createRenderFollowup(zh)("recover", {});
    const enMsg = createRenderFollowup(en)("recover", {});
    expect(zhMsg).toBe("恢复：上一回合出错。继续当前任务。");
    expect(zhMsg).not.toMatch(/不要推进|checklist 项/);
    expect(enMsg).toBe(
      "Recover: the previous turn ended with an error. Continue the current task.",
    );
    expect(enMsg).not.toMatch(/without advancing/i);
  });

  it("resolves localized lenses for light mode (3 rounds → 1,2,5)", () => {
    const resolve = createResolveLens(zhBundle);
    expect(resolve(1, 3).title).toBe("正确性与不变量");
    expect(resolve(2, 3).title).toBe("空值、边界与错误路径");
    expect(resolve(3, 3).title).toBe("测试缺口与回归");
  });

  it("full mode lens order: correctness → boundaries → concurrency → security → tests", () => {
    expect(lensNumberForRound(3, 5)).toBe(3);
    expect(getLens(3, 5).key).toBe("concurrency");
    expect(getLens(4, 5).key).toBe("security");
    expect(getLens(5, 5).key).toBe("tests-regression");
    const resolve = createResolveLens(zhBundle);
    expect(resolve(3, 5).title).toBe("并发、竞态与部分失败");
    expect(resolve(4, 5).title).toBe("安全与信任边界");
  });

  it("createResolveLens falls back when lens map is missing", () => {
    const resolve = createResolveLens({
      followup: zhBundle.followup,
      lens: undefined as unknown as FollowupLocaleBundle["lens"],
    });
    expect(resolve(1, 5).key).toBe("scope-correctness");
  });
});
