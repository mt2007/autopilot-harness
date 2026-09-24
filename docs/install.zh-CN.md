# 安装

Autopilot **全部已发宿主**的发现与接线说明（权威安装矩阵）。产品前门：[README.md](../README.md)（[中文 README](../README.zh-CN.md)）。宿主能力：[hosts.md](./hosts.md)。速查：[autopilot/quickstart.zh-CN.md](./autopilot/quickstart.zh-CN.md)。

**硬规则：** 宿主原生发现（plugin / marketplace / extension）可选。**真正接线必须**再跑 `npx @autopilot-harness/cli init`（或 `upgrade`），才能写好 hooks、vendor runtime 与 `.autopilot/`。仅指向 Autopilot 的薄插件 / skill **不能**代替 `init`。

需要 **Node.js 22+**。优先使用 scoped 包 `@autopilot-harness/cli`（bin：`autopilot-harness`）。命令以 **当前工作目录 = 要接入的项目** 为根。

English: [install.md](./install.md)

## 通用路径

```bash
cd /path/to/your-app
npx @autopilot-harness/cli init --yes
# 或指定宿主：
# npx @autopilot-harness/cli init --platform <id> --yes
# 首次 init 之后再加宿主：
# npx @autopilot-harness/cli init --yes --add-platform <id>
npx @autopilot-harness/cli status
npx @autopilot-harness/cli doctor
```

交互 TUI：省略 `--yes`。更多参数：`npx @autopilot-harness/cli init --help`。

## 矩阵（全部可安装 id）

| `id` | Surface | Init（必须） | 发现（Batch 1 可选） | Init 之后 |
|------|---------|--------------|----------------------|-----------|
| `cursor` | ide | `init --platform cursor --yes` | 若存在：`.cursor-plugin/marketplace.json` → `plugins/cursor/` | Reload Window；`/autopilot-on` |
| `claude-code` | cli | `init --platform claude-code --yes` | 若存在：`.claude-plugin/marketplace.json` → `plugins/claude-code/` | 新会话；`/autopilot-on` |
| `codex` | cli | `init --platform codex --yes` | 若存在：薄包 `plugins/codex/` | `/hooks` trust；行首或 skills |
| `kimi-code` | cli | `init --platform kimi-code --yes` | 本版仅文档 / `npx` | 建议 `confirm_rounds: 1`；`/skill:autopilot-on` |
| `copilot-cli` | cli | `init --platform copilot-cli --yes` | 本版仅文档 / `npx` | **重启 Copilot CLI** |
| `grok-build` | cli | `init --platform grok-build --yes` | 本版仅文档 / `npx` | `/hooks-trust` 或 `--trust` |
| `gemini-cli` | cli | `init --platform gemini-cli --yes` | 若存在：`plugins/gemini-cli/`（内含 `gemini-extension.json`） | re-trust / `/hooks panel` / folder trust |
| `factory-droid` | cli | `init --platform factory-droid --yes` | 若存在：薄包 `plugins/factory-droid/` | `$FACTORY_PROJECT_DIR`；`/hooks` + reload |
| `hermes-agent` | cli | `init --platform hermes-agent --yes` | 本版仅文档 / `npx` | consent；`hermes hooks doctor` |
| `antigravity` | cli | `init --platform antigravity --yes` | 本版仅文档 / `npx` | 挂载工作区；reload |
| `pi` | cli（进程内） | `init --platform pi --yes` | Autopilot **禁止** `pi install` | `/trust` 再 `/reload`；**仅 TUI** |
| `devin` | cli | `init --platform devin --yes` | 本版仅文档 / `npx` | `$DEVIN_PROJECT_DIR`；`/hooks`；**仅 CLI** |
| `runner` | runner | `init --yes --add-platform runner`（或首装 `init --platform runner --yes`） | **仅 npm / 文档** — 无宿主 marketplace 插件 | 配置 `runner.command`；`runner start …` |

**OpenCode** 仍在路线图 — `init` **不会**安装。请用已发宿主或 Runner，直到上游 stop-continue 就绪。

**Batch 1 发现诚实说明：** `.cursor-plugin/marketplace.json`、`.claude-plugin/marketplace.json`、`plugins/<id>/` 是本仓库的薄发现布局。若你克隆的版本里还没有这些文件，**跳过发现**，只走 **Init** — 接线从不依赖薄包。

## 分宿主

### cursor

1. **发现（可选）：** 当根目录 `.cursor-plugin/marketplace.json` 与 `plugins/cursor/` 存在时，将本仓库加为 Cursor marketplace，并按需安装薄入口。
2. **Init（必须）：** `npx @autopilot-harness/cli init --platform cursor --yes`
3. **Doctor：** `npx @autopilot-harness/cli doctor` → Reload Window → `/autopilot-on`

### claude-code

1. **发现（可选）：** 当 `.claude-plugin/marketplace.json` 与 `plugins/claude-code/` 存在时，`/plugin marketplace add mt2007/autopilot-harness`（或 git URL），再安装列出的 Autopilot 插件。
2. **Init（必须）：** `npx @autopilot-harness/cli init --platform claude-code --yes`
3. **Doctor：** `doctor` → 新会话 → `/autopilot-on`

### codex

1. **发现（可选）：** 当 `plugins/codex/` 存在时，按 Codex 文档安装 / 链接该薄包（不能代替 hooks）。
2. **Init（必须）：** `npx @autopilot-harness/cli init --platform codex --yes`
3. **Doctor：** `/hooks` trust（变更后需 re-trust）→ 行首 `Autopilot ON` 或 `.agents/skills`

### kimi-code

1. **发现：** 本版用 `npx`（无 Batch-1 薄包）。
2. **Init：** `npx @autopilot-harness/cli init --platform kimi-code --yes`（写用户目录 hooks；建议 `confirm_rounds: 1`）。
3. **Doctor：** `doctor` → `/skill:autopilot-on` 与/或行首触发。

### copilot-cli

1. **发现：** 本版仅 `npx`。
2. **Init：** `npx @autopilot-harness/cli init --platform copilot-cli --yes`
3. **Doctor：** **重启 Copilot CLI** → `doctor`。

### grok-build

1. **发现：** 本版仅 `npx`。
2. **Init：** `npx @autopilot-harness/cli init --platform grok-build --yes`
3. **Doctor：** `/hooks-trust` 或 `--trust` → reload/新会话 → `doctor`。

### gemini-cli

1. **发现（可选）：** 当 `plugins/gemini-cli/gemini-extension.json` 存在时，将 Gemini extensions 指到该目录 — **不要**把 monorepo 根目录当成扩展。
2. **Init（必须）：** `npx @autopilot-harness/cli init --platform gemini-cli --yes`
3. **Doctor：** re-trust、`/hooks panel`、folder trust → `doctor`。

### factory-droid

1. **发现（可选）：** 当 `plugins/factory-droid/` 存在时，按 Droid 文档从该目录添加 / 安装。
2. **Init（必须）：** `npx @autopilot-harness/cli init --platform factory-droid --yes`
3. **Doctor：** `$FACTORY_PROJECT_DIR` 指向已接入项目根；`/hooks` 后 reload → `doctor`。

### hermes-agent

1. **发现：** 本版仅 `npx`（Autopilot 走 `$HERMES_HOME/config.yaml` shell hooks，不是 Hermes plugin 替代品）。
2. **Init：** `npx @autopilot-harness/cli init --platform hermes-agent --yes`
3. **Doctor：** consent / `--accept-hooks`；`hermes hooks doctor` → `doctor`。

### antigravity

1. **发现：** 本版仅 `npx`。
2. **Init：** `npx @autopilot-harness/cli init --platform antigravity --yes`
3. **Doctor：** CLI 必须挂载项目工作区；reload → `doctor`。Auto-attach ≠ Autopilot ON。

### pi

1. **发现：** Autopilot **不要**用 `pi install`（R6）。Init **直接写入** `.pi/extensions/autopilot.ts`。
2. **Init：** `npx @autopilot-harness/cli init --platform pi --yes`
3. **Doctor：** `/trust` 再 `/reload` → 仅交互 **TUI**（不支持 `pi -p` / JSON / print）。

### devin

1. **发现：** 本版仅 `npx`。
2. **Init：** `npx @autopilot-harness/cli init --platform devin --yes`
3. **Doctor：** `$DEVIN_PROJECT_DIR` = 已接入根；`/hooks` + 新会话。**仅 CLI** — 非 Desktop / 云 Devin / Cascade。

### runner

1. **发现：** 仅 npm / 文档 — 无宿主 marketplace 插件。
2. **Init：** 首装 `npx @autopilot-harness/cli init --platform runner --yes`，或已有其他宿主后 `init --yes --add-platform runner`；设置可信的 **`runner.command`**。
3. **Doctor / 运行：** `npx @autopilot-harness/cli doctor`；再 `npx @autopilot-harness/cli runner start --on …` / `--run <slug>` / resume。见 [hosts.md](./hosts.md) Runner 行与 [config.md](./config.md)。

## 多宿主

首次 `init` 之后用 `--add-platform <id>` 追加可安装宿主（不会发明 OpenCode）。启用 `kimi-code` 会把整个项目的 `review.confirm_rounds` **钳到 1**。

## 相关

- [宿主说明](./hosts.md) — 上限、skills 路径、路线图  
- [配置](./config.md) — `.autopilot/config.yml`、`review.scope`、triggers  
- [排障](./troubleshooting.md) — doctor WARN  
- [快速开始](./autopilot/quickstart.zh-CN.md) · [English](./autopilot/quickstart.md)  
- [CLI 包 README](../packages/cli/README.md)
