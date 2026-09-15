# Checklist — v0.8 Factory Droid

> `/autopilot-run v0.8-factory-droid`。流水线：实现（**先 ≤60m 挖 Stop raise/硬顶 + multi-block under `stop_hook_active`** → `research-stop-cap.md`）→ 契约/八宿主矩阵 → **全仓测绿** → 活链证 **≥2× Stop-continue（含 active=true）**（失败→degraded；**免活链→默认 degraded≤1**）→ docs → 升版 → pack → commit → **发版人闸** → push/tag → **仅 pnpm publish** → pin；**测红先修；测绿才发**。**publish 0.8 前优先完成 0.7 publish+pin**。

- [x] port-factory-package — `@autopilot-harness/port-factory-droid`：**先** ≤60m `research-stop-cap.md`（raise？硬顶？**multi under `stop_hook_active`？**）→ **`FACTORY_DROID_*`**；**UPS**（inject `hookSpecificOutput.{hookEventName:"UserPromptSubmit", additionalContext}`；fallback block+reason；ON/RUN 成功 **exit0+零字节 stdout（禁 `{}`/stringify；runner/port 出口 empty body）**；Stop 续跑若进 UPS → harness-owned）+ PostToolUse（`Create|Edit|ApplyPatch`+dirty-arm；**永不 block**）+ Stop（`decision:block`+`reason`；默认尝试 multi across `stop_hook_active`，活链证伪/waive→**degraded≤1**）；root：install-root/`FACTORY_PROJECT_DIR`/`DROID_CWD`/stdin cwd；camel/snake；Silence；fail-open；不接 PreToolUse/SubagentStop/Session*/Notification
- [x] vendor-hook-dispatch — **八路**；`handleFactory*`；Claude 同名靠 stamp；交叉 abort 副作用前；**factory-droid allow 路径 stdout 零字节**（勿抄其它 port `{}`）；bundle + PUBLIC + `workspace:*`
- [x] init-factory-hooks-merge — 仅 `.factory/hooks.json`（**顶层 event**；timeout 120；UPS/Stop 无 matcher；command `node \"$FACTORY_PROJECT_DIR\"/.autopilot/bin/…`）；sibling/空 unlink；`--add-platform`；wizard（`/hooks`+**快照/reload**）；ignore += `.factory/hooks.json`；symlink fail-closed；不钳 rounds（degraded 时 docs 荐 1）
- [x] doctor-upgrade-uninstall — FAIL 缺/残；WARN timeout、cap、`/hooks`+reload、org、Factory+Claude、legacy、`~/.factory` residual、`hooksDisabled`、**settings.json hooks 残留 Autopilot tip**
- [x] tests-factory-contract — allow **`stdout.length === 0`**；inject 形；Post 永不 block；harness-owned；merge/shape；八路+Claude 交叉；Silence；runner empty-body
- [x] matrix-eight-host — Factory↔七宿主错 stamp/payload → abort；既有不红
- [x] smoke-repo — `pnpm test` + typecheck
- [x] live-factory-smoke — **≥2** Stop-continue 且 **≥1× `stop_hook_active=true` 仍 block 成功**（否则改 degraded 叙事并留证）+ edit/dirty-arm + hook 确跑 + `$FACTORY_PROJECT_DIR` + hooks.json shape；**无 CLI waive → 发版默认 degraded≤1**（人闸另签 multi 风险才 full）；证据本 slug
- [x] docs-factory-shipped — eight-way；Shipped(/degraded)+诚实 multi-block/**waive→degraded** 结论；`$FACTORY_PROJECT_DIR`；`/hooks`+快照；next=Hermes；docs-contract；勿改 `[0.7.0]` 历史；新开 `[0.8.0]`
- [x] changelog-bump-0-8-0 — 公开包 →0.8.0
- [x] local-npm-pack-assert — pack；无 `workspace:*`
- [x] commit-local — conventional；勿 push/tag/publish
- [x] human-gate-confirm — 活链或 waive；「同意发 0.8.0」；0.7 pin 或允许叠发；**waive 时确认 degraded≤1 或签字 multi 风险**
- [x] push-tag-release — push/tag/GH Release
- [ ] npm-publish-pnpm — 仅 `pnpm publish`
- [ ] pin-upgrade-repo — pin→0.8.0
