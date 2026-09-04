# Autopilot

**autopilot-harness** — 把开放式 Agent 对话收成 **结构化规划 → checklist 执行 → 多角度自审** 的 vibecoding harness。

行为以英文 [README.md](./README.md) 为准；本文是中文前门。行为变更时请与英文 README **同一 PR** 更新（见 [CONTRIBUTING.md](./CONTRIBUTING.md)）。

[![CI](https://github.com/mt2007/autopilot-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/mt2007/autopilot-harness/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522-brightgreen.svg)](https://nodejs.org/)

## 为什么

Vibe coding 很快，但范围漂移、验收含糊、「看起来做完了」却跳过难审的角度。Autopilot 把工作钉在可持久的轨上：

1. **先烤问方案**，再写产品代码  
2. **按 checklist 执行**（`plans/<slug>/`）  
3. **多角度自审通过后**再勾选完成  

它**不是**通用聊天 Agent，**不是**替代你的 CI/测试框架，**也不是** Jira/看板产品（checklist + 执行 FSM，没有看板 UI）。**v0.2 已支持 Cursor 与 Claude Code**；Codex / Runner 见 [宿主说明](./docs/hosts.md)。

Autopilot **不保证**无缺陷软件。它提高的是：工作经过规划、落在 checklist 范围内、并在多种审查镜头下压测过，再宣称某一项完成。

## 怎么工作

```text
/autopilot-on  →  grill 轮次  →  brief / plan / checklist
       ↓
/autopilot-run →  每项：实现 → 修复 → 确认×N → 推进
       ↓
完成（checklist 清空）
```

| 步骤 | 你做什么 | Autopilot 做什么 | 产物 |
|------|----------|------------------|------|
| **规划** | 开 `/autopilot-on`；逐轮回答 grill | 写 `plans/<slug>/`（可改文档）；**不写产品代码** | `brief.md`、`plan.md`、`checklist.md` |
| **执行** | 开 `/autopilot-run` | 实现 **一项** checklist | 该项代码/文档 |
| **自审** | （通常不用管 — stop followup 驱动） | 修复 → 旋转镜头确认 | 确认轮通过前该项保持打开 |
| **推进** | — | 勾选 `[x]`；dirty 则本地 commit（干净跳过；**不**自动 push），然后下一项 | 更新 `checklist.md` |
| **完成** | — | 勾选最后一项；dirty 则本地 commit（**不**自动 push）；清单清空后停止 | 该轨结束 |

默认自审在 **RUN 中**（`review.scope: executing_only`）。想在闲聊改代码时也自审，设 `review.scope: project` — 见下方专节与英文 README。

暂停 / 改方案 / 恢复：`/autopilot-off`、`/autopilot-replan`、`/autopilot-resume`（细节见 [快速开始](./docs/autopilot/quickstart.zh-CN.md)）。

### 作者侧写（规模）

作者在 **Cursor** 上跑过一条轨：`/autopilot-run` 之后约 **351** 个 Agent 回合、约 **13.9 小时纯执行时间**。这是轶事，说明大体量 checklist 可以长时间留在结构化循环里——**不是**基准或 SLA。

### 规划（grill）

`/autopilot-on` 启动设计树烤问：每轮问当前决策**前沿**（并给推荐答），等你回复再下一轮。规划可改 `plans/**` 与文档 — **直到** `/autopilot-run` 才写产品代码。

产物在 `plans/<slug>/brief.md`、`plan.md`、`checklist.md`。烤问灵感来自 **grill-me / grilling** 设计树技能。

### 多角度自审

在 **产品代码** 编辑之后，Autopilot 驱动 **修复**，再 **确认** 轮。每轮镜头不同（不是同一清单复读）。默认 `review.confirm_rounds: 5`；`3` 为轻量（镜头 **1 → 2 → 5**，跳过并发与安全）。

产品代码路径：排除 `.autopilotignore`，以及**未跟踪且被 `.gitignore` 忽略**的路径。**暂停 / OFF** 会话在 resume 前不跑链。

| 轮次（默认 5） | 镜头 |
|------:|------|
| 1 | 正确性与不变量 |
| 2 | 空值、边界与错误路径 |
| 3 | 并发、竞态与部分失败 |
| 4 | 安全与信任边界 |
| 5 | 测试缺口与回归（只读记录缺口，本轮不补测） |

#### 何时跑自审（`review.scope`）

写在 `.autopilot/config.yml`（`init` 可选，之后可改）：

| `review.scope` | 何时走修复 → 确认 | 典型用途 |
|----------------|-------------------|----------|
| **`executing_only`**（默认） | 仅在 Autopilot **RUN**（checklist 执行中）且改了产品代码 | 结构化轨：`/autopilot-on` → `/autopilot-run` → 按项自审 |
| **`project`** | 项目内**任意**产品代码编辑——**不需要**先 ON / RUN | 闲聊改代码仍要多角度压测 + 错误恢复 |

要点：

- 只开 `/autopilot-on` **不会**启动自审（规划只写方案/文档）。
- `executing_only` 下，非 RUN 改代码**不会**打开 Autopilot 自审链。
- `project` 且**未在** checklist 执行中（含仍在 planning）时，确认链以 **自审完成** 结束（不勾选推进）；RUN 执行中仍按项推进/完成。
- 暂停 / OFF 期间不跑链（即使 `project`），需 resume。
- 慎与全局 Cursor 自审 hook 叠用（双重注入）。
- 宿主自带 Plan 模式与 Autopilot **未对接**（设计草案：[host-plan-bridge.md](./docs/host-plan-bridge.md)）。

完整键表见 [docs/config.md](./docs/config.md)。英文权威专节：[When does self-review run?](./README.md#when-does-self-review-run-reviewscope)。

## 快速开始

需要 **Node.js 22+**。CLI 包 `@autopilot-harness/cli`（bin：`autopilot-harness`）。

### 安装

优先用 scoped 包名（不要用不存在的裸 `npx autopilot-harness`）。命令以 **当前工作目录** 为项目根：

```bash
cd /path/to/your-app
# Cursor（IDE hooks）
npx @autopilot-harness/cli init --platform cursor --yes
# 或 Claude Code（hooks 在终端与 IDE 共用）
npx @autopilot-harness/cli init --platform claude-code --yes
# 双宿主：Cursor init 之后再加 Claude（不必整仓重装）
# npx @autopilot-harness/cli init --yes --add-platform claude-code
npx @autopilot-harness/cli status
npx @autopilot-harness/cli doctor
```

交互 TUI：省略 `--yes`（platform 仍默认 cursor）。更多参数：`npx @autopilot-harness/cli init --help`。

从本仓库克隆开发或 dogfood：见 [Contributing](./CONTRIBUTING.md)。

重载宿主窗口（Cursor：Reload Window；Claude Code：重启 / 新开会话），然后：

1. `/autopilot-on` — 规划  
2. `/autopilot-run` — 执行 checklist  

更多命令：[docs/autopilot/quickstart.zh-CN.md](./docs/autopilot/quickstart.zh-CN.md)（[English](./docs/autopilot/quickstart.md)）。

`init` 会写入 `.autopilot/`、合并宿主 hooks，并安装 skills/workflows。Claude Code 还会合并 `.claude/settings.json`（hooks + `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0`）与 `.claude/skills/autopilot-*`。与自审相关的配置键包括 `locale`、`review.scope`（`executing_only` | `project`）、`review.confirm_rounds`，以及可选的 `review.verify.*`（见 [配置说明](./docs/config.md)、[Architecture](./docs/architecture.md)，以及上方 **何时跑自审**）。

## 文档

- [Architecture](./docs/architecture.md)  
- [配置说明](./docs/config.md)  
- [排障](./docs/troubleshooting.md)  
- [宿主说明](./docs/hosts.md)（Cursor / Claude Code 已支持）  
- [宿主 Plan 桥接（设计）](./docs/host-plan-bridge.md)  
- [快速开始（中文）](./docs/autopilot/quickstart.zh-CN.md)  
- [Contributing](./CONTRIBUTING.md)  
- [Changelog](./CHANGELOG.md)  
- [English README](./README.md)（行为权威）  

## 开发

```bash
pnpm install
pnpm test
pnpm bundle-vendor
pnpm build
```

见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## License

MIT — 见 [LICENSE](./LICENSE)。
