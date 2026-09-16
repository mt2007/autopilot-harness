# Checklist — v0.10 Antigravity (+ Gemini / Factory / Hermes skills)

> `/autopilot-run v0.10-antigravity`。research → port/十路 → hooks+skills 一体 → doctor → 契约/矩阵 → 测绿 → **Antigravity 活链（不过则停发 0.10）** → docs → 升版 → pack → commit → 人闸 → push/tag → publish → pin。

- [x] research-antigravity-hooks — ≤60m → `research-antigravity-hooks.md`：**① Stop continue**；**② PreInvocation 用户原文从哪来**（stdin 字段 / `transcriptPath` / 换事件——**锁死前勿当 UPS**）；具名块；injectSteps；Post matcher；timeout；cap；`fullyIdle`；CLI vs IDE；allow 空形；相对 command；`workspacePaths`；gemini-cli 边界；Factory skill frontmatter；Gemini trust；skills 路径（`.agents`；不迁 `.agent`）
- [x] port-antigravity-package — `@autopilot-harness/port-antigravity`：PreInvocation / PostToolUse / Stop；`ANTIGRAVITY_*`；continue 可证或 degraded；`fullyIdle` fail-open
- [x] vendor-hook-dispatch — **十路** + `handleAntigravityPreInvocation` / `PostToolUse` / `Stop`；交叉 abort；bundle + PUBLIC + `workspace:*`
- [ ] init-antigravity-hooks-skills — **一体**：`.agents/hooks.json` 具名块 + **`.agents/skills/autopilot-*`**；timeout 120；相对 command；symlink fail-closed；`--add-platform`；wizard（reload、IDE tip、**auto-attach ≠ ON**、slash+line-start）；**不**写 `.agent/`；ignore 含 hooks+`.agents/skills/**`
- [ ] init-skills-with-hooks-gemini-factory-hermes — **一体**：启用则写 **`.gemini/skills/autopilot-*`** / **`.factory/skills/autopilot-*`** / **`$HERMES_HOME/skills/autopilot-*`**（**不**因 Antigravity 跳过 Gemini）；共享模板；Factory frontmatter 薄适配 per research；upgrade 补装；uninstall 只剥该平台 Autopilot skills；Hermes symlink fail-closed；upgrade 补 ignore **`.gemini/skills/**`** + **`.factory/skills/**`**
- [ ] doctor-upgrade-uninstall — FAIL 缺/残 Antigravity hooks；WARN timeout/cap/IDE/dual/缺 skills（按启用平台）；Gemini `/trust`+`/skills reload`；Hermes 多仓；**auto-attach ≠ ON** tip
- [ ] tests-antigravity-contract — Antigravity I/O + merge + 十路 + `fullyIdle`
- [ ] tests-skills-coinstall — 契约：启用谁写谁；Gemini 始终 `.gemini/skills`（即使 Antigravity 也启用）；Factory/Hermes 路径；升级补/卸载剥；locale；不写 `.agent`
- [ ] matrix-ten-host — Antigravity↔九宿主错 stamp → abort；既有不红
- [ ] smoke-repo — `pnpm test` + typecheck
- [ ] live-antigravity-smoke — **待你装好 Antigravity 后由本会话活检**：Stop ≥1×（力争 ≥2×）+ edit arm；**优先能 fire 的表面**（CLI 优先，IDE 若可 fire 也记一笔）；证据写明 **CLI / IDE / 两者**；**失败 → 不发 0.10**；半残 degraded 仅人闸；不强制 G/F/H skills 活链
- [ ] docs-antigravity-shipped — ten-way Shipped（或人闸 degraded）；skills 一体路径表；双开 tip；slash；auto-attach≠ON；Gemini trust；PreInvocation 结论；`.agents`；next=OpenCode；`[0.10.0]`；docs-contract
- [ ] changelog-bump-0-10-0 — →0.10.0（Antigravity + 三家 skills）— **仅活链过关后**
- [ ] local-npm-pack-assert — pack；无 `workspace:*`
- [ ] commit-local — conventional；勿 push/tag/publish
- [ ] human-gate-confirm — 「同意发 0.10.0」；**Antigravity 未达标则停止发版**；半残须显式认 degraded
- [ ] push-tag-release — push/tag/GH Release
- [ ] npm-publish-pnpm — 仅 `pnpm publish`
- [ ] pin-upgrade-repo — pin→0.10.0
