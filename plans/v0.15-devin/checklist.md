# Checklist — v0.15 Devin CLI

> `/autopilot-run v0.15-devin`。**先 docs 翻盘** → research → decide → port 或 defer。**只做 CLI**。发版硬闸 = CLI 活链 ≥1× + edit arm。Desktop / 云端 / Cascade 不测、不标已支持。冲突时以 brief「docs 复核 + 补钉 2 + 补钉 3」为准。

- [x] docs-roadmap-flip — OpenCode→**Parked/skip**；Devin→**`1 (next)`**（Fit **Medium–High**；可 port；活链闸；勿 Claude 指纹）；去掉「无本地 hook / Research-low」；README(+zh-CN)/hosts；**docs-contract**；**仍写 ten-way**（eleven-way 留给 shipped）；勿改旧 CHANGELOG 节
- [x] research-devin-hooks — ≤60m → `research-devin-hooks.md`：软下限（已见 **3000.10.31**）；UPS `prompt`；锚定 matcher + exec dirty-arm；continue=`decision:block`+`reason`；allow 形态；`session_id`；`stop_hook_active`→loopCount；合并 sibling；双载；skills；`$DEVIN_PROJECT_DIR`；timeout；`-p`；**sandbox 是否拦 hook**；**子 agent Stop 是否共用**（共用则只处理当前 `session_id`）；排除 Desktop 活链 / 云端 / Cascade
- [x] human-env-confirm — **已满足**：`devin 3000.10.31`、已登录、免费额度。RUN 落证据。无 CLI 才 defer。不做 Desktop 环境闸
- [x] decide-shape — `defer` **或** `port × (subprocess|in-process) × (full|degraded)`。「只标 degraded、不接线」非法。无稳定 continue → **defer**
- [x] defer-closeout — **仅 decide=defer**：后续 port/发版 **cancelled**；保留 docs 翻盘；**无** 0.15 bump
- [x] port-devin-package — `handleDevin*`；UPS+Post+Stop；Stop `block`+`reason`；`stop_hook_active`→loopCount；Post 锚定 matcher+dirty-arm **永不 block**；harness-owned 不当 ON/RUN；fail-open **exit 0**；独立 fingerprint
- [ ] vendor-platform-wire — hooks + `.devin/skills`；vendor；`INSTALLABLE_BINDINGS`；**eleven-way**（仅本项及之后）；交叉 abort；bundle；禁 `workspace:*`
- [ ] init-doctor-upgrade-uninstall — 合并 `.devin/hooks.v1.json`；不写 `config.json` hooks；skills 只 `.devin/skills`；ignore hooks+skills；timeout 120；`$DEVIN_PROJECT_DIR`；symlink fail-closed；doctor FAIL 缺指纹 / WARN timeout·cap·`/hooks`·Devin+Claude·残留·无 CLI·one_executor·skills 双开·`-p`；`--add-platform devin`。**不**把 Desktop 提示当 FAIL
- [ ] tests-devin-contract — I/O + continue + loopCount + dirty-arm + harness-owned + **merge sibling** + 指纹 + skills 路径
- [ ] matrix-host — eleven-way：Devin↔既有串台 → abort；既有不红
- [ ] smoke-repo — `pnpm test` + typecheck
- [ ] live-devin-smoke — 可弃仓、无 Claude hooks、交互 CLI（非 `-p`，除非 research 证明能跑）。**≥1× + edit arm = 发版硬闸**。失败不发；半残 → degraded+人闸。免费额度只做短链。不测 Desktop
- [ ] docs-devin-shipped — **CLI** Shipped 或 degraded；**不写 Desktop 已支持**；此时才写 **eleven-way**；路径/cap/`DEVIN_PROJECT_DIR`/skills；docs-contract；CHANGELOG **`[0.15.0]`**
- [ ] changelog-bump-0-15-0 — 公开包 **0.15.0**（仅过关后）
- [ ] local-npm-pack-assert — pack；无 `workspace:*`
- [ ] commit-local — conventional；勿 push/tag/publish
- [ ] human-gate-confirm — 「同意发 0.15.0」；半残须显式认 degraded
- [ ] push-tag-release — push/tag/GH Release `v0.15.0`
- [ ] npm-publish-pnpm — 仅 `pnpm publish`
- [ ] pin-upgrade-repo — pin → 0.15.0
