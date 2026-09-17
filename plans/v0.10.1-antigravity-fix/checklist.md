# Checklist — v0.10.1 Antigravity live-fix

> `/autopilot-run v0.10.1-antigravity-fix`。修 Autopilot 侧 Antigravity 活链缺陷 → 测绿 → CLI 活链 continue ≥1× → 发 **0.10.1**。  
> **Host continue 不过 → 不发。**  
> **不管**：本机网络出口/环境变量代理、Google OAuth/Eligibility、`/tmp`↔`/private/tmp` 自测噪声、默认 `*.txt` ignore。

- [x] fix-no-tool-call-completion — `isAntigravityStopCompletionReason` 认 `NO_TOOL_CALL`（+单测）；Stop 在已 arm 时可 `decision:continue`
- [x] fix-transcript-full-sanitize — `sanitizeAntigravityTranscriptPath` 接受 `…/logs/transcript_full.jsonl`（+单测）
- [x] fix-antigravity-hook-shim — `.agents/bin/` cwd-agnostic shim → `../../.autopilot/bin/…`；init/upgrade **改写**旧 `node .autopilot/bin/…`；doctor 认 shim；契约/tip 文案对齐（**不**依赖裸 `../.autopilot`）
- [x] docs-cli-workspace-tip — doctor/docs：Antigravity CLI 须挂项目 workspace（如 `--add-dir`），否则 hooks 可能不加载
- [x] tests-bundle-green — port 单测 + antigravity-contract + docs-contract；`pnpm bundle-vendor`；`pnpm test` + typecheck
- [ ] live-cli-stop-continue — `$HOME` 临时仓 + 挂 workspace + 改非 ignore 文件；host Stop continue ≥1×；证据写入本 slug（**无本机网络叙事**）；**不过则停发 0.10.1**
- [ ] changelog-bump-0-10-1 — CHANGELOG + 全包 → **0.10.1**
- [ ] local-npm-pack-assert — pack；无 `workspace:*`
- [ ] commit-local — conventional；勿 push/tag/publish
- [ ] human-gate-confirm — 「同意发 0.10.1」（仅活链已过后）
- [ ] push-tag-release — push/tag/GH Release `v0.10.1`
- [ ] npm-publish-pnpm — `pnpm publish`
- [ ] pin-upgrade-repo — pin → 0.10.1
