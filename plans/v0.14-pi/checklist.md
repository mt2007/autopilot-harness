# Checklist — v0.14 Pi

> `/autopilot-run v0.14-pi`。**research 闸优先** → env → decide → port 或 **defer-closeout**。活链不过不发 0.14；已接线失败 → 留代码不 bump/publish。

- [x] research-pi-hooks — ≤60m → `plans/v0.14-pi/research-pi-hooks.md`：软下限；submit/edit/stop **真名**；continue 主路径；**R2 稳定 session id**；**R1 无 pending 不注入**；install 根 + trust；in-process vs subprocess + **vendor 加载**；是否进 `KNOWN_PLATFORMS`；**R3** skills 是否读 `.agents/skills`；硬 cap；≥1× continue 预检或明确 defer 理由；禁默认 shell stamp；禁消费者装 core
- [x] human-env-confirm — 规划已确认本机已装 Pi（**0.85.1**）；RUN 时落证据；无环境才 defer
- [x] decide-shape — `defer` **或** `port × (in-process|subprocess) × (full|degraded)`。「只标 degraded、不接线」非法。无稳定 continue → **defer**
- [x] defer-closeout — **仅 decide=defer**：后续 port/发版项标 **cancelled**；hosts 记 Pi research/等；可选 docs+research commit；**无** 0.14 bump/publish
- [x] port-pi-package — `@autopilot-harness/port-pi`：`handlePi*`；Submit/Edit/Stop 按 research；**R1：无 pending 不注入**；**R8：settle dirty-tree arm**；**R9：continue 禁阻塞 UI**；fail-open；harness-owned 续跑不当 ON/RUN；session id 用 research 锁死值
- [x] vendor-platform-wire — init 下发扩展 + vendor 入口；`INSTALLABLE_BINDINGS`；**R7：默认不进** shell `KNOWN_PLATFORMS`（矩阵「十路 shell + Pi 扩展」；仅 subprocess stamp 才 eleven-way）；交叉 abort；bundle；禁 `workspace:*` 进 publish
- [x] init-doctor-upgrade-uninstall — **R6** 直接写 `.pi/extensions/autopilot*.ts`（**不** `pi install`）；**R4** 盖文件不要求 PATH 有 `pi`；**R3** 共用 `.agents/skills/autopilot-*`、**不**写 Antigravity hooks；trust/`/reload` wizard；symlink fail-closed；窄 ignore；doctor FAIL 缺指纹 / WARN 无 pi·版本·trust·双开·skills·one_executor·**R10 print/JSON**；`--add-platform pi`
- [x] tests-pi-contract — 扩展 I/O + continue + **无 pending 不注入** + dirty-arm + harness-owned + merge/指纹
- [x] matrix-host — **R7**「十路 shell + Pi 扩展」：Pi↔既有宿主串台 → abort；既有不红（subprocess stamp 例外才扩 eleven-way）
- [x] smoke-repo — `pnpm test` + typecheck（测红先修）
- [ ] live-pi-smoke — **R5** 可弃仓 **交互 TUI**（非 `pi -p`）：continue **≥1×**（力争 **≥2×**）+ edit arm；证据入本轨；**失败 → 不发 0.14**；半残 degraded 仅人闸
- [ ] docs-pi-shipped — Pi Shipped(/degraded)；next=**OpenCode（等上游）**；路径/trust/soft min；**R10** 不支持 print/JSON；docs-contract；勿改旧 CHANGELOG 节
- [ ] changelog-bump-0-14-0 — 公开包 **0.14.0**（**仅活链/人闸过关后**）
- [ ] local-npm-pack-assert — pack；无 `workspace:*`
- [ ] commit-local — conventional；勿 push/tag/publish
- [ ] human-gate-confirm — 「同意发 0.14.0」；未达标停发；半残须显式认 degraded
- [ ] push-tag-release — push/tag/GH Release `v0.14.0`
- [ ] npm-publish-pnpm — 仅 `pnpm publish`
- [ ] pin-upgrade-repo — pin → 0.14.0
