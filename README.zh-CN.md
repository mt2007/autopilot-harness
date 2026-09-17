# Autopilot

**autopilot-harness** — 把开放式 Agent 对话收成 **结构化规划 → checklist 执行 → 多角度自审** 的 vibecoding harness。

行为以英文 [README.md](./README.md) 为准；本文是中文前门。行为变更时请与英文 README **同一 PR** 更新（见 [CONTRIBUTING.md](./CONTRIBUTING.md)）。

[![CI](https://github.com/mt2007/autopilot-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/mt2007/autopilot-harness/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522-brightgreen.svg)](https://nodejs.org/)

<p align="center">
  <img src="./docs/assets/autopilot-harness-cover.jpg" alt="Autopilot Harness — State the goal. Autopilot the rest." width="900" />
</p>

## 为什么

Vibe coding 很快，但范围漂移、验收含糊、「看起来做完了」却跳过难审的角度。Autopilot 把工作钉在可持久的轨上：

1. **先烤问方案**，再写产品代码  
2. **按 checklist 执行**（`plans/<slug>/`）  
3. **多角度自审通过后**再勾选完成  

它**不是**通用聊天 Agent，**不是**替代你的 CI/测试框架，**也不是** Jira/看板产品（checklist + 执行 FSM，没有看板 UI）。**本仓已接入 Cursor、Claude Code、Codex、Kimi Code、GitHub Copilot CLI、Grok Build CLI、Gemini CLI、Factory Droid、Hermes Agent 与 Antigravity**（CLI 与 App 共用同一 Codex port；**Kimi Code** 为 **Stop≤1/turn 降级**；**Copilot CLI** 为 **Stop consecutive ≤8 降级**；**Grok Build** 为 **Stop ≤8/turn 降级** — 每 turn 重置；**Gemini CLI** 已 **Shipped**，诚实上限 **AfterAgent turn cap ≤100** / `MAX_TURNS`，软建议 CLI **≥0.31.0**；**Factory Droid** 已 **Shipped**，**`stop_hook_active` 下 multi-block 活链已证** — 无 raise；**免活链 → 默认 degraded≤1**；**Hermes Agent** 已 **Shipped**，**shell `pre_verify` continue 活链已证** — nudge ≥32；edit-only；软下限 **≥0.21.3**；**免活链 → degraded + 人闸认 R1**；**Antigravity** 已 **Shipped**（**宿主 Stop continue 活链已证**，**0.10.1**）— `NO_TOOL_CALL` + `transcript_full.jsonl` + **`.agents/bin` shim**；CLI 须挂 workspace）。OpenCode / Runner 等见 [宿主说明](./docs/hosts.md) 路线图。

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

默认自审为 **`review.scope: project`**（闲聊改产品代码也会自审）。只要 RUN 中才审，设 `review.scope: executing_only` — 见下方专节与英文 README。

暂停 / 改方案 / 恢复：`/autopilot-off`、`/autopilot-replan`、`/autopilot-resume`（细节见 [快速开始](./docs/autopilot/quickstart.zh-CN.md)）。

### 作者侧写（规模）

作者在 **Cursor** 上跑过一条轨：`/autopilot-run` 之后约 **351** 个 Agent 回合、约 **13.9 小时纯执行时间**。这是轶事，说明大体量 checklist 可以长时间留在结构化循环里——**不是**基准或 SLA。

### 规划（grill）

`/autopilot-on` 启动设计树烤问：每轮问当前决策**前沿**（并给推荐答），等你回复再下一轮。问题序号**跨轮全局递增**（`Q1`、`Q2`…，勿每轮从 Q1 重计），并标注当前 **Round**。规划可改 `plans/**` 与文档 — **直到** `/autopilot-run` 才写产品代码。

产物在 `plans/<slug>/brief.md`、`plan.md`、`checklist.md`。烤问灵感来自 **grill-me / grilling** 设计树技能。

### 多角度自审

在 **产品代码** 编辑之后，Autopilot 驱动 **修复**，再 **确认** 轮。每轮镜头不同（不是同一清单复读）。Cursor / Claude Code / Codex / Copilot CLI / Grok Build / Gemini CLI / Factory Droid / Hermes Agent / Antigravity 默认 `review.confirm_rounds: 5`；启用可安装的 **Kimi Code** 时用 **`confirm_rounds: 1`**（宿主 Stop-continue 硬顶 ≤1/turn，不要指望 confirm×5；init 写 `1`，hook 也会把**整个项目**钳到 `1`，同 `platforms` 里的其他宿主一并受影响）。**Copilot CLI** 不钳 `confirm_rounds`，但是 **Stop consecutive ≤8 降级**（中途掐断可能留下 pending，用 `/autopilot-resume` / nudge 恢复）。**Grok Build** 同样不钳轮次，但是 **Stop ≤8/turn 降级**（每 turn 重置；中途掐断 → pending / RESUME / nudge）。**Gemini CLI** 不钳轮次；AfterAgent deny→retry 与宿主 **`MAX_TURNS` ≤100** 共用预算（无 raise；建议 CLI **≥0.31.0**）。**Factory Droid** 不钳轮次；`stop_hook_active` 下 multi-block **活链已证**（无 raise；**免活链 → degraded≤1**）。**Hermes Agent** 不钳轮次；shell `pre_verify` continue **活链已证**（nudge ≥32；edit-only；nudge 仍为 **3** / 中途耗尽 → pending / RESUME / nudge；**免活链 → degraded + 人闸认 R1**；软下限 **≥0.21.3**）。**Antigravity** 不钳轮次；Stop continue = `decision:continue`（**0.10.1 活链已证**）。`3` 为轻量（镜头 **1 → 2 → 5**，跳过并发与安全）。

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
| **`project`**（默认） | 项目内**任意**产品代码编辑——**不需要**先 ON / RUN | 闲聊改代码仍要多角度压测 + 错误恢复 |
| **`executing_only`** | 仅在 Autopilot **RUN**（checklist 执行中）且改了产品代码 | 结构化轨：`/autopilot-on` → `/autopilot-run` → 按项自审 |

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
# 或 Codex（`.codex/hooks.json`；`/hooks` trust；P0 = 行首 triggers）
npx @autopilot-harness/cli init --platform codex --yes
# 或 Kimi Code（用户目录 `~/.kimi-code/config.toml`；Stop≤1/turn 降级；推荐 confirm_rounds: 1）
npx @autopilot-harness/cli init --platform kimi-code --yes
# 或 GitHub Copilot CLI（`.github/hooks/autopilot-harness.json`；Stop consecutive ≤8 降级；安装后重启 CLI）
npx @autopilot-harness/cli init --platform copilot-cli --yes
# 或 Grok Build CLI（`.grok/hooks/autopilot-harness.json`；Stop ≤8/turn 降级；需 `/hooks-trust` 或 `--trust`）
npx @autopilot-harness/cli init --platform grok-build --yes
# 或 Gemini CLI（`.gemini/settings.json`；AfterAgent cap ≤100 / MAX_TURNS；建议 CLI ≥0.31.0；需 re-trust / `/hooks panel` / folder trust）
npx @autopilot-harness/cli init --platform gemini-cli --yes
# 或 Factory Droid（`.factory/hooks.json`；multi-block 活链已证；`$FACTORY_PROJECT_DIR`；`/hooks`+快照/reload）
npx @autopilot-harness/cli init --platform factory-droid --yes
# 或 Hermes Agent（`$HERMES_HOME/config.yaml`；pre_verify continue 活链已证；相对 command；consent/`hermes hooks doctor`）
npx @autopilot-harness/cli init --platform hermes-agent --yes
# 或 Antigravity（`.agents/hooks.json` + `.agents/skills` + `.agents/bin` shim；Stop `decision:continue`；0.10.1 活链已证）
npx @autopilot-harness/cli init --platform antigravity --yes
# 多宿主：第一个 init 之后再加（不必整仓重装）
# npx @autopilot-harness/cli init --yes --add-platform claude-code
# npx @autopilot-harness/cli init --yes --add-platform codex
# npx @autopilot-harness/cli init --yes --add-platform kimi-code
# npx @autopilot-harness/cli init --yes --add-platform copilot-cli
# npx @autopilot-harness/cli init --yes --add-platform grok-build
# npx @autopilot-harness/cli init --yes --add-platform gemini-cli
# npx @autopilot-harness/cli init --yes --add-platform factory-droid
# npx @autopilot-harness/cli init --yes --add-platform hermes-agent
# npx @autopilot-harness/cli init --yes --add-platform antigravity
npx @autopilot-harness/cli status
npx @autopilot-harness/cli doctor
```

交互 TUI：省略 `--yes`（platform 仍默认 cursor）。更多参数：`npx @autopilot-harness/cli init --help`。

从本仓库克隆开发或 dogfood：见 [Contributing](./CONTRIBUTING.md)。

重载宿主窗口（Cursor：Reload Window；Claude Code / Codex / Kimi Code / Copilot CLI / Grok Build / Gemini CLI / Factory Droid / Hermes Agent / Antigravity：重启 / 新开会话），然后：

1. 规划 — Cursor/Claude：`/autopilot-on`；Codex：行首 `triggers.on`（如 `开启自动驾驶`；无 Autopilot skills UI；手打 slash 仍可解析；需 `/hooks` trust）；Kimi / Copilot / Grok：同行首路径；Gemini / Factory / Hermes / Antigravity：宿主 skills **且** 行首（Gemini **re-trust / `/hooks panel` / folder trust**，AfterAgent **≤100**；Factory **`$FACTORY_PROJECT_DIR`** + **`/hooks` 快照/reload**；Hermes **`$HERMES_HOME`** + consent/`hermes hooks doctor`；Antigravity **`.agents`**，`decision:continue`，活链已证 / CLI 挂 workspace）→ grill → `plans/<slug>/`  
2. 执行 — Cursor/Claude：`/autopilot-run`；Codex：行首 `triggers.run`（如 `开始执行`）；Kimi / Copilot / Grok：同行首路径；Gemini / Factory / Hermes / Antigravity：宿主 skills **且** 行首  

更多命令：[docs/autopilot/quickstart.zh-CN.md](./docs/autopilot/quickstart.zh-CN.md)（[English](./docs/autopilot/quickstart.md)）。

`init` 会写入 `.autopilot/`、合并宿主 hooks，并在支持的宿主安装 skills/workflows。Claude Code 还会合并 `.claude/settings.json`（hooks + `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0`）与 `.claude/skills/autopilot-*`。Codex 合并 `.codex/hooks.json`（省略 timeout；matcher `apply_patch|Edit|Write`）— 默认不写 `AGENTS.md`。**Kimi Code** 合并用户目录 `$KIMI_CODE_HOME/config.toml`（默认 `~/.kimi-code`；timeout ≥120s；**Stop≤1/turn 降级**自审；推荐 `confirm_rounds: 1`）— 不写 Autopilot skills / `AGENTS.md`。**GitHub Copilot CLI** 写入 `.github/hooks/autopilot-harness.json`（bash+powershell；timeoutSec ≥120；`userPromptSubmitted`+`userPromptTransformed`+postToolUse+agentStop；**Stop consecutive ≤8 降级**；安装/升级后**重启 Copilot CLI**）— 不写 Autopilot skills / `AGENTS.md`；不接 `preToolUse`。**Grok Build CLI** 写入 `.grok/hooks/autopilot-harness.json`（Codex 形；timeout 120；UPS+PostToolUse+Stop；**Stop ≤8/turn 降级**；**trust** `/hooks-trust` 或 `--trust`；needPick 须重提 slug；中途掐断 → pending / RESUME / nudge）— 不写 Autopilot skills / `AGENTS.md`；不接 PreToolUse。**Gemini CLI** 写入 `.gemini/settings.json`（nested matcher groups；timeout 120000ms；BeforeAgent+AfterTool+AfterAgent；**AfterAgent turn cap ≤100** / `MAX_TURNS`；建议 CLI **≥0.31.0**；安装后 **re-trust hooks**、`/hooks panel`、**folder trust**；needPick 用 BeforeAgent deny+reason；不改写 `hooksConfig`）**并**写 **`.gemini/skills/autopilot-*`**（`/trust` + `/skills reload`）。**Factory Droid** 写入 `.factory/hooks.json`（顶层 event；timeout 120；UPS+PostToolUse+Stop；命令用 **`$FACTORY_PROJECT_DIR`**；**`stop_hook_active` 下 multi-block 活链已证**；安装后查 **`/hooks`** 再 reload/新开会话刷新快照；**免活链 → degraded≤1**）**并**写 **`.factory/skills/autopilot-*`**。**Hermes Agent** 合并 **`$HERMES_HOME/config.yaml`**（默认 `~/.hermes`；**从不** `cli-config.yaml`；timeout 120；相对 `node .autopilot/bin/…`；**`agent.max_verify_nudges` ≥32**；**pre_verify continue 活链已证**；edit-only；consent/`--accept-hooks`/`HERMES_ACCEPT_HOOKS`；安装后 reload + **`hermes hooks doctor`**；软下限 **≥0.21.3**；**免活链 → degraded + 人闸认 R1**）**并**写 **`$HERMES_HOME/skills/autopilot-*`**。**Antigravity** 写入 **`.agents/hooks.json`**（具名 `autopilot-harness`；PreInvocation+PostToolUse+Stop；timeout 120；相对 command；Stop **`decision:continue`**；**不写 `.agent/`**）**并**写 **`.agents/skills/autopilot-*`**（**Shipped** — 宿主 Stop continue **活链已证**（0.10.1）；**`.agents/bin` shim**；**auto-attach ≠ Autopilot ON**）。与自审相关的配置键包括 `locale`、`review.scope`（`executing_only` | `project`）、`review.confirm_rounds`，以及可选的 `review.verify.*`（见 [配置说明](./docs/config.md)、[Architecture](./docs/architecture.md)，以及上方 **何时跑自审**）。

## 文档

- [Architecture](./docs/architecture.md)  
- [配置说明](./docs/config.md)  
- [排障](./docs/troubleshooting.md) — doctor WARN、双重 hook、Claude `BLOCK_CAP`、Codex trust/timeout、Kimi Stop≤1/turn、Copilot Stop≤8 / 重启 / 双装、Grok Stop≤8/turn / trust / 多指纹、Gemini AfterAgent cap ≤100 / min-CLI / re-trust / folder trust / `hooksConfig`、Factory multi-block / `$FACTORY_PROJECT_DIR` / `/hooks` 快照、Hermes `$HERMES_HOME` / 相对 command / consent / `hermes hooks doctor`、Antigravity `.agents` / `decision:continue` / PreInvocation transcript / CLI workspace / 活链已证  
- [宿主说明](./docs/hosts.md)（Cursor / Claude Code / Codex / Kimi Code / Copilot CLI / Grok Build / Gemini CLI / Factory Droid / Hermes Agent / Antigravity 已支持；Kimi 为 **Stop≤1/turn 降级**；Copilot 为 **Stop consecutive ≤8 降级**；Grok 为 **Stop ≤8/turn 降级**；Gemini **AfterAgent ≤100** / min-CLI **≥0.31.0**；Factory **multi-block 活链已证**；Hermes **pre_verify continue 活链已证**；Antigravity **活链已证** Stop continue（0.10.1）；next=OpenCode；完整扩宿主路线图）  
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
