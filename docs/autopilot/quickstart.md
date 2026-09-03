# Autopilot 快速开始

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

更多安装说明见仓库根目录 [README.md](../../README.md)。

## 安装后

- 在 Cursor 中试用 `/autopilot-on`。
- 若 skills / hooks 未出现：执行 `Developer: Reload Window`，或新开一条 Agent 对话。

方案与清单在 `plans/<slug>/`。
