# Checklist — v0.6 Grok Build CLI

> `/autopilot-run v0.6-grok-build`。流水线：实现（**先挖 Stop raise**；预期无 → **degraded ≤8/turn**）→ 契约/六宿主矩阵 → **全仓测绿** → 活链证 **≥1× Stop-continue**（或免活链）→ docs（诚实上限 + trust + compat tip + **five→six-way** + 掐断恢复）→ 升版 → pack → commit → **发版人闸** → push/tag → **仅 pnpm publish** → pin；**测红先修；测绿才发**。

- [x] port-grok-package — 实现 `@autopilot-harness/port-grok-build`：**先** timebox 写 `research-stop-cap.md` → 导出 `GROK_STOP_CAP_RAISE_FOUND` + `GROK_STOP_PER_TURN_BLOCK_CAP=8`；**UPS**（triggers/FSM；ON/RUN 成功空放行）+ PostToolUse + Stop；根目录 install-root / `GROK_WORKSPACE_ROOT` / `workspaceRoot`（**不信任 cwd**）；Stop **仅** `decision:block`+`reason`（禁 Stop `additionalContext` 续跑）；stdin camelCase+snake_case；`stopHookActive`→loopCount；PostToolUse matcher 草稿 **`search_replace|Edit|Write|MultiEdit`**（活链可改）+ **dirty-arm**；busy/硬错/**needPick 降级**默认 **UPS `decision:block`+reason**（i18n；选型须重提 slug）；挖注入若有则优先；不接 PreToolUse/SubagentStop/StopFailure/StopCancelled；fail-open；Stop 优先 `end_turn`
- [x] vendor-hook-dispatch — **六路** dispatch（hook runner allowlist + Layer C + comments）；别名 `handleGrokUserPromptSubmit` / `handleGrokPostToolUse` / `handleGrokStop`；禁与 Claude/Codex/Kimi/Copilot 裸名冲突；**错 stamp abort 须在 FSM 副作用前**；**bundle-vendor** 纳入 port-grok-build；cli `workspace:*` + PUBLIC 包列表
- [x] init-grok-hooks-merge — `INSTALLABLE`+`grok-build`/`cli`；写入 **仅** `.grok/hooks/autopilot-harness.json`（**Codex 形**；`type:command`；**timeout 120 必写**；**UPS+PostToolUse+Stop**；**UPS/Stop 无 matcher**；PostToolUse 用上列草稿；sibling 保留；空文件 **unlink**）；command **默认** `node .autopilot/bin/autopilot-harness-hook.mjs --platform grok-build --event …`（仅活链证伪才改路径）；指纹 uninstall；`--add-platform`；wizard tip（trust/P0/timeout）；不写 skills/AGENTS.md；不钳 confirm_rounds；**可提交**；**core DEFAULT + templates** `.autopilotignore` += **`.grok/hooks/**`**
- [x] doctor-upgrade-uninstall — FAIL：缺/残 Autopilot hooks；WARN：timeout **省略或**&lt;120、**Stop≤8/turn**（读 port constants /raise）、confirm 中段掐断 tip、**trust tip**、**Grok+Claude 和/或 Grok+Cursor** 多指纹、**reload/新开会话**；upgrade/uninstall 只动指纹（空则 unlink）
- [x] tests-grok-contract — Vitest：I/O、Stop 单通道、UPS/needPick（inject 或 UPS-block）、busy、hooks merge（sibling + 空 unlink + 无 UPS/Stop matcher + command 路径）、ignore、doctor（含 omit timeout）、add-platform、六路+别名
- [x] matrix-six-host — 扩展五宿主矩阵：Grok↔Cursor/Claude/Codex/Kimi/Copilot 错 stamp/错 payload → abort（副作用前）；既有宿主不红
- [x] smoke-repo — `pnpm test` + typecheck；失败先修再往下
- [x] live-grok-smoke — 外部 disposable；≥1 Stop-continue + edit/dirty-arm + **证明 Autopilot hook command 确实跑到**；证据 **`plans/v0.6-grok-build/`**；无 CLI → 免活链；免活链 ≠ 发版同意
- [x] docs-grok-shipped — README(+zh-CN)/hosts/architecture/config/troubleshooting/quickstart/CHANGELOG；**five-way→six-way**；Shipped **degraded Stop ≤8/turn**（每 turn 重置；勿双通道；勿抄 consecutive）；**trust**；**compat.hooks tip**；needPick 重提 slug；pending/RESUME/nudge；多指纹 WARN；PUBLIC + port-grok-build；**docs-contract**：改 **`docs/hosts.md` 当前正文**（Grok=Shipped；**1 (next)=Gemini**；six-way）并同步测试断言；**勿改写** CHANGELOG `[0.5.0]` 历史句（当时 next=Grok / five-way，测试仍校验那段）；新开 `[0.6.0]`；不接 PreToolUse
- [ ] changelog-bump-0-6-0 — `PACKAGE_VERSION`+公开包（含 port-grok-build）→0.6.0；CHANGELOG 0.6.0；core→i18n→ports→cli
- [ ] local-npm-pack-assert — pnpm pack；无 `workspace:*`；--help / status / doctor
- [ ] commit-local — conventional commit；**勿** push/tag/publish
- [ ] human-gate-confirm — 呈活链或 waive；**另等「同意发 0.6.0」**
- [ ] push-tag-release — 人闸后：push → tag `v0.6.0` → `gh release create`
- [ ] npm-publish-pnpm — 仅 `pnpm publish` 按序 → `npm view` / `npx` 抽检
- [ ] pin-upgrade-repo — pin→0.6.0；提醒 trust + Stop ≤8/turn /raise
