# Autopilot 快速开始

命令速查 + 每步产物。产品前门：[README.md](../../README.md)（[中文 README](../../README.zh-CN.md)）。英文速查：[quickstart.md](./quickstart.md)。

另见：[配置说明](../config.md) · [排障](../troubleshooting.md) · [宿主路线图](../hosts.md) · [Plan 桥接](../host-plan-bridge.md)。

## 推荐流程（产物）

| 步骤 | 你做什么 | Autopilot 做什么 | 产物 |
|------|----------|------------------|------|
| **1. 规划** | `/autopilot-on`（可带需求描述）；逐轮回答 grill | 写 `plans/<slug>/`（可改文档），**不写产品代码** | `plans/<slug>/brief.md`、`plan.md`、`checklist.md` |
| **2. 执行** | `/autopilot-run`（或带 `<slug>`） | 一项一项：实现 → 自审修复 → 多角度确认 → 勾选推进 | 该项代码/文档；推进/完成时 dirty 则本地 commit（干净则跳过；确认轮不 commit；默认**不**自动 push） |
| **3. 完成** | — | 勾选最后一项；dirty 则本地 commit（干净则跳过；默认**不**自动 push）；checklist 清空后停止 | 该轨结束 |

暂停、改方案，或从新聊天认领旧轨（见下）。

## Planning

推荐：在 Cursor 中使用 `/autopilot-on` 或 `/autopilot-on <需求描述>`

也可：行首 `Autopilot ON` / `开启自动驾驶`

## Executing

`/autopilot-run` 或 `/autopilot-run <slug>`

也可：`Autopilot RUN` / `开始执行`

## 暂停 / 恢复 / 改方案

- **暂停**（`/autopilot-off` 或行首 `Autopilot OFF` / `关闭自动驾驶`）：暂停**本**会话；不推进 checklist，也不跑自审，直到 resume（phase 通常不变；`done` → `idle`）。
- **恢复**（`/autopilot-resume` 或 `/autopilot-resume <slug>`；也可行首 `Autopilot RESUME` / `继续执行`）：清 pause，**保留**自审链。新聊天可从另一会话**认领**正在执行的轨（同项目）：优先**未 pause** 的执行会话，也可回退到唯一一条**已 pause** 的执行轨（旧聊天已死时恢复）。多轨时用 `<slug>` 指定。认领后以**本聊天**为执行会话；勿在旧聊天继续跑同一轨。
- **改方案**（`/autopilot-replan` 或行首 `Autopilot REPLAN` / `修改方案`）：回到 planning，并**重置**自审链。只改 `plan.md` 与未勾选项；勿静默删除已完成的 `[x]`。改完再 `/autopilot-run`。

## 终端

CLI 包：`@autopilot-harness/cli`（bin：`autopilot-harness`）。

**今天（尚未上公共 npm）：** 先克隆并构建本仓库，再用**已构建二进制**；**cwd = 要接入 Autopilot 的项目**：

```bash
# 一次性：在 autopilot-harness 克隆里
git clone https://github.com/mt2007/autopilot-harness.git
cd autopilot-harness && pnpm install && pnpm build

# 在目标应用里
cd /path/to/your-app
node /path/to/autopilot-harness/packages/cli/dist/bin.js init --platform cursor --yes
node /path/to/autopilot-harness/packages/cli/dist/bin.js status
node /path/to/autopilot-harness/packages/cli/dist/bin.js doctor
node /path/to/autopilot-harness/packages/cli/dist/bin.js upgrade --dry-run
```

在本 harness 克隆里 dogfood（`pnpm build` 之后）：

```bash
node packages/cli/dist/bin.js init --platform cursor --yes
node packages/cli/dist/bin.js status
node packages/cli/dist/bin.js doctor
node packages/cli/dist/bin.js upgrade --dry-run
```

**发布到 npm 之后：** `npx @autopilot-harness/cli …`（scoped 包名——不要用不存在的裸 `npx autopilot-harness`）。未上架前用「今天」路径。

## 安装后

- 在 Cursor 中试用 `/autopilot-on`。
- 若 skills / hooks 未出现：执行 `Developer: Reload Window`，或新开一条 Agent 对话。
- 自审中途停住：确认 Autopilot stop 带 `loop_limit: null`（可 `upgrade`；详见 [排障](../troubleshooting.md)）。
- 更多故障模式见 [排障](../troubleshooting.md)。

## 自审范围（`review.scope`）

写在 `.autopilot/config.yml`（完整键表见 [配置说明](../config.md)）：

| 取值 | 含义 |
|------|------|
| **`executing_only`**（默认） | 仅在 `/autopilot-run`（checklist 执行中）且改了产品代码后，才走修复 → 多角度确认 |
| **`project`** | **任意**产品代码编辑都会自审——**不需要**先 ON / RUN |

产品代码排除命中 `.autopilotignore` 的路径，以及**未跟踪且被 `.gitignore` 忽略**的路径。暂停 / OFF 期间不跑自审链，需 resume。

只开 `/autopilot-on` **不会**启动自审（规划只写方案/文档）。`project` 且**未在** checklist 执行中（含仍在 planning）时，确认链以 **自审完成** 结束（不勾选推进 checklist）；在 RUN 执行中则仍按项推进/完成。若已有全局 Cursor 自审 hook，慎与 `project` 叠用（可能双重注入）。各宿主自带的 Plan 模式与 Autopilot 无关，目前未对接（[设计草案](../host-plan-bridge.md)）。

方案与清单始终在 `plans/<slug>/`（权威进度是 `checklist.md`）。
