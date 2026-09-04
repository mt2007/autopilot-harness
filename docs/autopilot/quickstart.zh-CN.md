# Autopilot 快速开始

命令速查 + 每步产物。英文入口与安装细节见仓库根目录 [README.md](../../README.md)；英文速查：[quickstart.md](./quickstart.md)。

## 推荐流程（产物）

| 步骤 | 你做什么 | Autopilot 做什么 | 产物 |
|------|----------|------------------|------|
| **1. 规划** | `/autopilot-on`（可带需求描述）；逐轮回答 grill | 写 `plans/<slug>/`（可改文档），**不写产品代码** | `plans/<slug>/brief.md`、`plan.md`、`checklist.md` |
| **2. 执行** | `/autopilot-run`（或带 `<slug>`） | 按 checklist **一项一项**：实现 → 自审修复 → 多角度确认 → 勾选推进 | 该项代码/文档；**推进/完成**时若有未提交改动则本地 commit（干净则跳过；确认轮不 commit；**默认不自动 push**） |
| **3. 完成** | — | 勾选最后一项；有未提交改动则本地 commit（干净则跳过；**默认不自动 push**）；checklist 清空后停止 | 该轨结束 |

中途可暂停 / 改方案 / 在新聊天认领旧轨（见下）。

## Planning

推荐：在 Cursor 中使用 `/autopilot-on` 或 `/autopilot-on <需求描述>`

也可：行首 `Autopilot ON` / `开启自动驾驶`

## Executing

`/autopilot-run` 或 `/autopilot-run <slug>`

也可：`Autopilot RUN` / `开始执行`

## 暂停 / 恢复 / 改方案

- 暂停：`/autopilot-off` 或行首 `Autopilot OFF` / `关闭自动驾驶`
- 恢复：`/autopilot-resume` 或 `/autopilot-resume <slug>`（新聊天可认领旧轨）；也可行首 `Autopilot RESUME` / `继续执行`
- 改方案：`/autopilot-replan` 或行首 `Autopilot REPLAN` / `修改方案`

## 终端

CLI 包为 `@autopilot-harness/cli`（bin：`autopilot-harness`），目前**尚未发布到 npm**。先克隆并构建本仓库，再在**目标项目目录**（`cwd` = 该项目）调用已构建的二进制：

```bash
# 一次性：在 autopilot-harness 克隆目录
git clone https://github.com/mt2007/autopilot-harness.git
cd autopilot-harness && pnpm install && pnpm build

# 在你要接入 Autopilot 的项目目录
cd /path/to/your-app
node /path/to/autopilot-harness/packages/cli/dist/bin.js init --platform cursor --yes
node /path/to/autopilot-harness/packages/cli/dist/bin.js status
node /path/to/autopilot-harness/packages/cli/dist/bin.js doctor
node /path/to/autopilot-harness/packages/cli/dist/bin.js upgrade --dry-run
```

若当前就在 harness 克隆根目录做 dogfood（需已 `pnpm build`），可用相对路径：

```bash
node packages/cli/dist/bin.js init --platform cursor --yes
node packages/cli/dist/bin.js status
node packages/cli/dist/bin.js doctor
node packages/cli/dist/bin.js upgrade --dry-run
```

## 安装后

- 在 Cursor 中试用 `/autopilot-on`。
- 若 skills / hooks 未出现：执行 `Developer: Reload Window`，或新开一条 Agent 对话。

## 自审范围（`review.scope`）

写在 `.autopilot/config.yml`：

| 取值 | 含义 |
|------|------|
| **`executing_only`**（默认） | 仅在 `/autopilot-run`（checklist 执行中）且改了产品代码后，才走修复 → 多角度确认 |
| **`project`** | **任意**产品代码编辑都会自审——**不需要**先 ON / RUN |

产品代码排除命中 `.autopilotignore` 的路径，以及**未跟踪且被 `.gitignore` 忽略**的路径。暂停 / OFF 期间不跑自审链，需 resume。

只开 `/autopilot-on` **不会**启动自审（规划只写方案/文档）。`project` 且**未在** checklist 执行中（含仍在 planning）时，确认链以 **自审完成** 结束（不勾选推进 checklist）；在 RUN 执行中则仍按项推进/完成。若已有全局 Cursor 自审 hook，慎与 `project` 叠用（可能双重注入）。各宿主自带的 Plan 模式与 Autopilot 无关，目前未对接。

方案与清单始终在 `plans/<slug>/`（权威进度是 `checklist.md`）。
