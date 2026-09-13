# Autopilot 快速开始

命令速查 + 每步产物。产品前门：[README.md](../../README.md)（[中文 README](../../README.zh-CN.md)）。英文速查：[quickstart.md](./quickstart.md)。

另见：[配置说明](../config.md) · [排障](../troubleshooting.md) · [宿主说明](../hosts.md) · [Plan 桥接](../host-plan-bridge.md)。

## 推荐流程（产物）

| 步骤 | 你做什么 | Autopilot 做什么 | 产物 |
|------|----------|------------------|------|
| **1. 规划** | `/autopilot-on`（可带需求描述）；逐轮回答 grill | 写 `plans/<slug>/`（可改文档），**不写产品代码** | `plans/<slug>/brief.md`、`plan.md`、`checklist.md` |
| **2. 执行** | `/autopilot-run`（或带 `<slug>`） | 一项一项：实现 → 自审修复 → 多角度确认 → 勾选推进 | 该项代码/文档；推进/完成时 dirty 则本地 commit（干净则跳过；确认轮不 commit；默认**不**自动 push） |
| **3. 完成** | — | 勾选最后一项；dirty 则本地 commit（干净则跳过；默认**不**自动 push）；checklist 清空后停止 | 该轨结束 |

暂停、改方案，或从新聊天认领旧轨（见下）。

## Planning

推荐：`/autopilot-on` 或 `/autopilot-on <需求描述>`（Cursor 或 Claude Code）

也可：行首 `Autopilot ON` / `开启自动驾驶`

**讨论 ≠ ON。** 普通闲聊不会开启 Autopilot；只有 slash `/autopilot-on` 或行首 ON 触发语（如 `Autopilot ON`、`开启自动驾驶`）才会 `applyOn`。

Skills 面板上 `/autopilot-on` 的 **description** 只是短展示文案（**不是**触发条件）；门闩在 **skill 正文**。升到会改 stock skill 文案的版本后，请跑 `npx @autopilot-harness/cli upgrade` 或 `npx @autopilot-harness/cli locale set <en|zh-CN>` 刷新已安装 skill。

## Executing

`/autopilot-run` 或 `/autopilot-run <slug>`

也可：`Autopilot RUN` / `开始执行`

### 多 plan 选型（通道 A）vs 硬错误（通道 C）

| 情况 | 行为 |
|------|------|
| 多个可执行 plan、未唯一绑定、裸 RUN | **完整 agent 回合**（通道 A）：对话里列出候选，等数字或 `/autopilot-run <slug>`。**不是**错误弹窗 / blocked。本回合不写产品代码。 |
| 已绑唯一 plan / 全局仅 1 个 runnable / 命令已带 slug | 跳过选型，直接执行 |
| 另一会话正在 `executing+armed` | **拦截提交**（通道 C）；文案含占用 track + 会话线索；若宿主只显示 opaque blocked，跑 `npx @autopilot-harness/cli status` 或 `doctor`（会列出 `executors` / `executing+armed`）。释放：在占用聊里 **Autopilot OFF**，或 `npx @autopilot-harness/cli session purge <id>`（无自动 disarm）。 |
| 非法 slug / 无 runnable | **拦截提交**（通道 C）— 真错误，不是选型列表 |

**通道规则：** needPick **不是**错误 → 只用通道 A（禁止把 blocked/`user_message` 弹窗当选型 UI）。busy 与真错误 → 通道 C（`continue: false` + Cursor hook stdout 的 snake_case `user_message`；也可同时带 `userMessage`）。**禁止**为可见而对 busy 使用 `continue: true`。（REPLAN 多 plan 选型暂仍可能走通道 C — 相对 RUN 的 A 为 OOS。）

**示例脚本（裸 RUN，N≥2 runnable，无唯一绑定）：**

```
用户:   /autopilot-run
Hook:   needPick → pending_action=run + candidates；phase 非 executing
        Cursor: continue true（无拦截弹窗）| Claude: 放行 + additionalContext
Agent:  编号列出 plan；请回复数字或 /autopilot-run <slug>；停止（不写产品代码）
用户:   1   或   /autopilot-run foo
Hook:   track_pick / RUN+slug → phase=executing
下一回合: 真正执行 checklist
```

**Cursor 候选来源**（通道 A — 不依赖拦截 toast）：扫描 runnable `plans/*/checklist.md`，和/或 `npx @autopilot-harness/cli status`（`pending` + `candidates`）。若 status 不透明或为空，回退扫盘 — 禁止只因 status 失败就列不出候选。

**`autopilot-run` skill — 选型 vs 执行：** 本会话**尚未** `phase=executing`（needPick / `pending_action=run`）时，skill **首分支**只列候选并等待——**禁止**开始跑 checklist。只有进入 executing 后才走执行工作流。

**ON / planning 不占执行锁**：多聊可同时规划；`one_executor` 只约束真正执行中的会话。**ON ≠ 锁。**

**Plans 绑定 / 脏 bind：** 本聊编辑 `plans/<slug>/` 时，仅编辑过 1 个 slug 则绑定该轨，裸 RUN 可直跑；编辑 ≥2 个（或脏 `_multi`）→ 裸 RUN 仍 **needPick**。REPLAN/ON 换轨或降级绑定时会清/失效 bind，避免之后裸 RUN 跳过选型。

## 暂停 / 恢复 / 改方案

- **暂停**（`/autopilot-off` 或行首 `Autopilot OFF` / `关闭自动驾驶`）：暂停**本**会话；不推进 checklist，也不跑自审，直到 resume（phase 通常不变；`done` → `idle`）。若僵死/卡住的 `executing+armed` 挡了其它聊：在占用聊 OFF，或先用 `status` / `doctor` 确认后 `npx @autopilot-harness/cli session purge <id>`。
- **恢复**（`/autopilot-resume` 或 `/autopilot-resume <slug>`；也可行首 `Autopilot RESUME` / `继续执行`）：清 pause，**保留**自审链。新聊天可从另一会话**认领**正在执行的轨（同项目）：优先**未 pause** 的执行会话，也可回退到唯一一条**已 pause** 的执行轨（旧聊天已死时恢复）。多轨时用 `<slug>` 指定。认领后以**本聊天**为执行会话；勿在旧聊天继续跑同一轨。
- **改方案**（`/autopilot-replan` 或行首 `Autopilot REPLAN` / `修改方案`）：回到 planning，并**重置**自审链。只改 `plan.md` 与未勾选项；勿静默删除已完成的 `[x]`。改完再 `/autopilot-run`。

## 终端

CLI 包：`@autopilot-harness/cli`（bin：`autopilot-harness`）。

**安装**用 scoped 包名（不要用不存在的裸 `npx autopilot-harness`）。**cwd = 要接入 Autopilot 的项目**：

```bash
cd /path/to/your-app
# Cursor（IDE hooks）
npx @autopilot-harness/cli init --platform cursor --yes
# 或 Claude Code（hooks 在终端与 IDE 共用；surface: cli ≠ 仅 CLI）
npx @autopilot-harness/cli init --platform claude-code --yes
# 或 Codex（`.codex/hooks.json`；`/hooks` trust；P0 = 行首 triggers）
npx @autopilot-harness/cli init --platform codex --yes
# 或 Kimi Code（`~/.kimi-code/config.toml`；Stop≤1/turn 降级；推荐 confirm_rounds: 1）
npx @autopilot-harness/cli init --platform kimi-code --yes
# 或 GitHub Copilot CLI（`.github/hooks/autopilot-harness.json`；Stop consecutive ≤8 降级；安装后重启 CLI）
npx @autopilot-harness/cli init --platform copilot-cli --yes
# 或 Grok Build CLI（`.grok/hooks/autopilot-harness.json`；Stop ≤8/turn 降级；需 `/hooks-trust` 或 `--trust`）
npx @autopilot-harness/cli init --platform grok-build --yes
# 第一个宿主装好后再加：
# npx @autopilot-harness/cli init --yes --add-platform claude-code
# npx @autopilot-harness/cli init --yes --add-platform codex
# npx @autopilot-harness/cli init --yes --add-platform kimi-code
# npx @autopilot-harness/cli init --yes --add-platform copilot-cli
# npx @autopilot-harness/cli init --yes --add-platform grok-build
npx @autopilot-harness/cli status
npx @autopilot-harness/cli doctor
npx @autopilot-harness/cli upgrade --dry-run
```

从本仓库克隆开发或 dogfood：见 [Contributing](../../CONTRIBUTING.md)。

## 安装后

- 在 Cursor 或 Claude Code 中试用 `/autopilot-on`（Codex / Kimi Code / Copilot CLI / Grok Build：行首 `triggers.on` / `triggers.run` — 无 Autopilot skills 路径；手打 slash 仍可解析）。
- 若 skills / hooks 未出现：重载宿主（Cursor：`Developer: Reload Window`；Claude Code / Codex / Kimi Code / Copilot CLI / Grok Build：重启 / 新开会话），或新开一条 Agent 对话。Codex：执行 `/hooks` trust（upgrade 后需 re-trust）。**Copilot CLI：安装/升级后重启 CLI**。**Grok Build：trust** `/hooks-trust` 或 `--trust`。
- 自审中途停住（Cursor）：确认 Autopilot stop 带 `loop_limit: null`（可 `upgrade`；详见 [排障](../troubleshooting.md)）。
- 自审中途停住（Claude Code）：确认 `.claude/settings.json` 有 `env.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0`。若 cap 环境变量不生效，接受项目 **trust** 对话框（项目 `env` 可能在信任前被拦住）。
- Codex hooks 无效 / 中途卡住：确认 `.codex/hooks.json` 有 Autopilot 条目、省略 timeout 或 ≥120s，且 `/hooks` 已信任。
- Kimi Code 为 **Stop≤1/turn 降级** — 推荐 `confirm_rounds: 1`；确认 `~/.kimi-code/config.toml` 有 Autopilot 条目且 timeout ≥120s（见 [排障](../troubleshooting.md)）。
- Copilot CLI 为 **Stop consecutive ≤8 降级** — 中途掐断用 pending / `/autopilot-resume` / nudge 恢复；doctor 会 WARN Claude+Copilot 双装；不接 `preToolUse`（见 [排障](../troubleshooting.md)）。
- Grok Build 为 **Stop ≤8/turn 降级**（每 turn 重置；非 consecutive）— 中途掐断 → pending / RESUME / nudge；needPick 须重提 slug；doctor 会 WARN ≤8/turn + trust + Grok+Claude/Cursor 多指纹（已启用或磁盘残留）；不接 PreToolUse（见 [排障](../troubleshooting.md)）。
- 更多故障模式见 [排障](../troubleshooting.md)。

## 自审范围（`review.scope`）

写在 `.autopilot/config.yml`（完整键表见 [配置说明](../config.md)）：

| 取值 | 含义 |
|------|------|
| **`project`**（默认） | **任意**产品代码编辑都会自审——**不需要**先 ON / RUN |
| **`executing_only`** | 仅在 `/autopilot-run`（checklist 执行中）且改了产品代码后，才走修复 → 多角度确认 |

产品代码排除命中 `.autopilotignore` 的路径，以及**未跟踪且被 `.gitignore` 忽略**的路径。暂停 / OFF 期间不跑自审链，需 resume。

只开 `/autopilot-on` **不会**启动自审（规划只写方案/文档）。`project` 且**未在** checklist 执行中（含仍在 planning）时，确认链以 **自审完成** 结束（不勾选推进 checklist）；在 RUN 执行中则仍按项推进/完成。若已有全局 Cursor 自审 hook，慎与 `project` 叠用（可能双重注入）。各宿主自带的 Plan 模式与 Autopilot 无关，目前未对接（[设计草案](../host-plan-bridge.md)）。

方案与清单始终在 `plans/<slug>/`（权威进度是 `checklist.md`）。
