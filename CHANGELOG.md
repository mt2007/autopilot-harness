# Changelog

Product front door: English [README.md](./README.md) is authoritative. Contributor guide: [CONTRIBUTING.md](./CONTRIBUTING.md).

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **docs-copilot-shipped**: GitHub Copilot CLI marked **Shipped** (**degraded Stop consecutive ≤8**; no raise found) across README(+zh-CN), hosts, architecture, config, troubleshooting, quickstart; docs-contract Next→Shipped; public package matrix includes `packages/ports/copilot-cli/package.json`; mid-cutoff recovery via **pending / RESUME / nudge**; **Restart Copilot CLI** after install/upgrade; doctor **FAIL** on missing/incomplete `.github/hooks`, **WARN** on ≤8 / Restart / **Claude+Copilot dual** (enabled or leftover); explicitly **no preToolUse**.

## [0.4.1] — 2026-09-12

### Changed

- **`autopilot-on` skill description**: Skills-panel copy is short and user-facing (`Start planning — write plans` / `开启规划 — 写 plans`). The ON gate stays in the **skill body** (slash or configured `triggers.on`, or already `phase=planning`). After upgrade, run `upgrade` or `locale set` so installed stock skills refresh ([quickstart](./docs/autopilot/quickstart.md)).

## [0.4.0] — 2026-09-12

### Added

- **Kimi Code hook port** (`@autopilot-harness/port-kimi-code`): UserPromptSubmit / PostToolUse / Stop adapters; fail-open on errors; Stop continue = **exit 2 + stderr** (not Claude JSON); needPick via UPS allow + stdout context; PostToolUse matcher aligned with current Kimi Code tool names + dirty-arm backup; no SubagentStop / StopFailure.
- **Quaternary vendor dispatch**: `--platform kimi-code` + aliased exports `handleKimiUserPromptSubmit` / `handleKimiPostToolUse` / `handleKimiStop` (no clash with Claude/Codex bare names); cross-stamp / cross-payload abort + conflict resolver across Cursor / Claude / Codex / Kimi.
- **Init / upgrade / uninstall / doctor** for Kimi Code: installable `surface:cli`; non-destructive merge of user-home `$KIMI_CODE_HOME/config.toml` `[[hooks]]` (default `~/.kimi-code`; **never** `local.toml`); Autopilot timeout ≥120s; fingerprint uninstall; `--add-platform kimi-code`; no default Autopilot skills / `AGENTS.md`; P0 line-start `triggers.on` / `triggers.run`; doctor WARNs for missing entries, timeout &lt; 120s, **Stop-continue ≤1/turn**, legacy `~/.kimi` without Kimi Code home, and `/hooks` trust/reload when offered; symlink home/`config.toml` **FAIL**.
- **`confirm_rounds` policy**: when installable `kimi-code` is enabled, init prefers `1` and the hook **clamps** effective rounds to **1 project-wide** (do not expect confirm×5 on Kimi or on other hosts in the same config).
- **docs-kimi-shipped**: Kimi Code marked **Shipped** (degraded **Stop≤1/turn**) across README(+zh-CN), hosts, architecture, config, troubleshooting, quickstart; docs-contract Next→Shipped; public package matrix includes `packages/ports/kimi-code/package.json`; stub description drops the Coming-v0.4 placeholder.
- Contract / quad-host matrix tests for Kimi I/O, exit2 Stop, toml merge, doctor, add-platform, aliases, and Cursor/Claude/Codex cross-fire.

### Changed

- **docs**: host roadmap — Copilot CLI recommended next after Kimi shipped; Grok Build / Gemini CLI / Factory Droid / Hermes / Antigravity / OpenCode / Runner / Pi / Devin listed; Codex App+CLI called out as one shipped port ([hosts.md](./docs/hosts.md)).
- **docs**: Kimi Code — host **Stop-continue hard-capped at 1/turn**; shipped as **degraded** (`confirm_rounds: 1`), not Claude-parity multi-lens streak; prefer `~/.kimi-code` over legacy `~/.kimi`.
- Prefer **`pnpm publish`** in order **core → i18n → ports (cursor, claude-code, codex, kimi-code) → cli** (and local `pnpm pack` assert: no `workspace:*`) for 0.4.0 public packages.

## [0.3.0] — 2026-09-12

### Added

- **Codex hook port** (`@autopilot-harness/port-codex`): UserPromptSubmit / PostToolUse / Stop adapters; fail-open on errors; Stop continue = `{ decision:"block", reason }` (hard-stop may use `continue:false`; never `continue:false` to keep the chain going); needPick via `additionalContext` + slug truncation; `apply_patch` path parse from `tool_input.command` with dirty-arm backup; ignore `permission_mode:plan`; no StopFailure / SubagentStop.
- **Ternary vendor dispatch**: hook commands stamp `--platform <id>`; aliased exports `handleCodexUserPromptSubmit` / `handleCodexPostToolUse` / `handleCodexStop` (no clash with Claude bare names); cross-stamp / cross-payload abort + conflict resolver.
- **Init / upgrade / uninstall / doctor** for Codex: installable `surface:cli`; non-destructive `.codex/hooks.json` merge (does **not** edit `config.toml` hooks); PostToolUse matcher `apply_patch|Edit|Write`; omit timeout (or ≥120s); `--add-platform codex`; no default Autopilot skills / `AGENTS.md`; doctor WARNs for missing entries, timeout < 120s, and `/hooks` trust/re-trust.
- **docs-codex-shipped**: Codex marked **Shipped** across README(+zh-CN), hosts, architecture, config, troubleshooting, quickstart; docs-contract Planned→Shipped; public package matrix includes `packages/ports/codex/package.json`; P0 line-start `triggers.on` / `triggers.run` (no default skills/`AGENTS.md`; typed `/autopilot-*` still parses).
- Contract / triple-host matrix tests for Codex I/O, aliases, merge, doctor, and Cursor/Claude cross-fire.

### Fixed

- Default `.autopilotignore` includes `.codex/**` (parity with `.cursor/**` / `.claude/**`) so Codex hook installs do not open spurious self-review.
- Init/upgrade Codex outro + activation tips (and architecture P0 line) mention `triggers.run` and typed slash parse — aligned with hosts/README.
- `@autopilot-harness/cli` npm README: Codex shipped + non-slash activation path (no longer “v0.2 Cursor and Claude Code” only).
- `writeQuickstart` embeds the selected `--platform` (no longer hardcodes `cursor` after Codex/Claude init).
- Codex `writeQuickstart`: Planning/Executing prefer line-start triggers (not slash-first); drop `autopilot-run` skill wording (no Autopilot skills path).
- Codex `formatCheatSheet`: same line-start-first Planning/Executing preference.
- Dual-host cheat sheet: when Codex is included with other hosts, add Codex line-start preference notes (slash remains primary for Cursor/Claude).
- `formatCheatSheet` dedupes platform ids (duplicate/`CODEX` casing no longer flips Codex-only into slash-first dual wording).
- Init copy helpers share `uniquePlatformIds` (outro / tips / cheat sheet / plain activation lines) so duplicate hosts stay single-host wording.

### Changed

- Prefer **`pnpm publish`** in order **core → i18n → ports (cursor, claude-code, codex) → cli** (and local `pnpm pack` assert: no `workspace:*`) for 0.3.0 public packages.

## [0.2.15] — 2026-09-11

### Fixed

- **planning-global-qn**: grill frontier questions are numbered **globally across rounds** (continue from the last `Qn`; do not restart at Q1 each round), with a `### Round k` heading on each frontier.

### Changed

- Planning workflow template synced to CLI assets / docs dogfood copy; contract test locks global-Qn wording and forbids `**Q1**` in the frontier example fence.
- README / README.zh-CN Planning sections document global `Qn` + Round labels.
- Prefer **`pnpm publish`** (and local `pnpm pack` assert: no `workspace:*`) for 0.2.15 public packages.

## [0.2.14] — 2026-09-11

### Added

- **config-wire**: submit + edit hooks load YAML `triggers.*` (per-key non-empty phrase lists; empty/`[]`/whitespace-only fall back to `DEFAULT_TRIGGERS`) and `artifacts.plans_dir` (via `normalizeInProjectPlansDir`) for RUN / needPick / plans bind.
- Fresh `init` (`--yes` + TUI) defaults `review.scope` to **`project`**; CLI `--scope executing_only|project`.
- Init covers custom `plans_dir` in `.autopilotignore` (`<plansDir>/**`).
- Bilingual stock trigger phrases (en/zh-CN aligned with `DEFAULT_TRIGGERS`).

### Changed

- Docs / quickstart / architecture / config / troubleshooting: init default scope is **`project`**; missing/invalid runtime scope still fail-open to **`executing_only`**; wiring table marks triggers + `plans_dir` as loaded.
- `upgrade` fill-missing keeps historical `executing_only` and does **not** rewrite an existing `review.scope`.
- Root `pnpm typecheck` builds `@autopilot-harness/cli` workspace deps first so ports see fresh `dist` types.
- Vendor `runtime.mjs` rebuilt with hook loaders + bilingual stock; contract tests lock the matrix.
- Prefer **`pnpm publish`** (and local `pnpm pack` assert: no `workspace:*`) for 0.2.14 public packages.

### Fixed

- Status/doctor `plans_dir` normalization shares core `normalizeInProjectPlansDir` (no divergent invalid-path behavior).

## [0.2.13] — 2026-09-11

### Fixed

- **shell-dirty-stuck**: on completed stop, git-dirty product paths (vs HEAD / untracked product files) arm `code_edited` even when the host never fired `afterFileEdit` (e.g. Shell writes), using the same `.autopilotignore` / untracked-gitignore filters.
- Soft `need_evidence` idle that hits `review.stuck.max_idle_stops` injects a stuck nudge (`stuck_soft` copy) **without** hard-pausing or disarming the track; required verify failures at the same threshold still hard-stuck pause.

### Changed

- Contract tests lock dirty-arm, soft stuck tip ownership, and soft stuck vs E5c hard stuck; docs/config + troubleshooting note shell dirty arm and soft stuck without hard pause.
- Prefer **`pnpm publish`** (and local `pnpm pack` assert: no `workspace:*`) for 0.2.13 public packages.

## [0.2.12] — 2026-09-11

### Fixed

- **done-on-pending**: Autopilot ON (`applyOn`) clears terminal done / review-complete `pending_followup`, so a same-chat ghost tip (`All checklist…` / `全部完成…`) is not redelivered on a later stop when the latest user message is ON (not the prior Done).

### Changed

- Contract test locks done pending → ON → stop no longer injects the completion tip.
- Prefer **`pnpm publish`** (and local `pnpm pack` assert: no `workspace:*`) for 0.2.12 public packages; do not use bare `npm publish`.

## [0.2.11] — 2026-09-11

### Fixed

- Republish public packages with `pnpm publish` so `workspace:*` dependencies are rewritten to concrete `0.2.11` versions. npm-published `@autopilot-harness/cli` / `port-cursor` / `port-claude-code@0.2.10` were uninstallable (`EUNSUPPORTEDPROTOCOL workspace:*`); prefer **0.2.11**.

## [0.2.10] — 2026-09-11

### Fixed

- **on-skill-gate**: `autopilot-on` skill description no longer matches casual “discuss / 讨论” chat; only slash `/autopilot-on` or configured ON phrases (e.g. `Autopilot ON` / project `triggers.on`) should attach the skill.
- Skill body gates planning: write `plans/` only after a real ON trigger this turn **or** when the session is already `phase=planning`; otherwise do not pretend Autopilot is ON.
- Docs/quickstart: discussion ≠ Autopilot ON (slash / `triggers.on` only apply ON).

### Changed

- Contract tests lock description + skill-gate copy; vendor runtime rebuilt with tightened ON descriptions; CLI skill templates synced.

### Known issue

- npm `0.2.10` tarballs for `cli` / `port-cursor` / `port-claude-code` kept raw `workspace:*` deps (published via `npm publish` instead of `pnpm publish`). Use **0.2.11**.

## [0.2.9] — 2026-09-10

### Added

- **run-pick-ux**: multi-runnable bare `/autopilot-run` uses channel A (needPick) — Cursor `continue:true` (no toast fields); Claude `additionalContext` with candidates (never `decision:block`).
- `autopilot-run` skill pick-vs-execute branch: when `pending_action=run` / not executing, only list candidates; do not start checklist work.
- CLI `status` surfaces pending pick candidates; `status` / `doctor` list executing+armed occupiers (OFF / purge guidance).
- Plans bind: afterFileEdit dedicated `plans/<slug>/` path — single slug auto-binds track; dirty multi-slug (`_multi`) keeps bare RUN on needPick.

### Fixed

- Busy / hard-fail RUN stays channel C (Cursor `continue:false` + snake_case `user_message`; Claude `decision:block` + `reason`); busy messages include track/session and status/doctor hints.
- REPLAN / ON track change or 1→≥2 plan edits clear or downgrade bind (`checklist_path` / `track_id`) so stale locks cannot skip needPick.
- CLI suppresses Node `node:sqlite` ExperimentalWarning on bin entry.

### Changed

- Docs/quickstart: channel A vs C scripts; ON≠lock; pick skill branch; candidate sources; `user_message`; plans bind / dirty bind. (`on-skill-gate` is a separate track — not in this release.)

## [0.2.8] — 2026-09-08

### Fixed

- `@autopilot-harness/core` npm pack now ships `migrations/*.sql` (package `files` previously only included `dist`), so published CLI `upgrade` / `doctor` can migrate `state.db` instead of failing with `No migration SQL found`.

## [0.2.7] — 2026-09-08

### Fixed

- Ambient/project-scope review no longer stalls after user Stop (abort) or error recover: mid-fix handoff keeps `chain_pending` with sticky edit, abort freezes into confirm instead of bare `fix_round`, and delivered fix tips clear atomically with re-arm so recover/E2 races cannot clobber undelivered tips or orphan the chain.

## [0.2.6] — 2026-09-08

### Fixed

- Mid-fix error recover no longer soft-advances/`done` on a stale `.autopilot/verify-last.json`: executing residue re-arms fix (or ready-for-E3 confirm), and soft evidence with `at` older than the review chain `updated_at` is rejected.

## [0.2.5] — 2026-09-06

### Changed

- `.autopilot/config.yml` no longer writes top-level `platform` / `surface`; host list is only under `platforms` (primary = first installable). `upgrade` and `init --force` strip the deprecated scalars while still reading them as a fallback.

## [0.2.4] — 2026-09-05

### Added

- npm `keywords` and `author` on public packages for better discoverability.

### Fixed

- CLI publish layout is `files: ["dist"]` only; build syncs `assets/` into `dist/assets/` so the tarball no longer ships a duplicate root `assets/` tree.

## [0.2.3] — 2026-09-05

### Fixed

- Ship skill/workflow templates inside `@autopilot-harness/cli` (`assets/templates`) so `npx @autopilot-harness/cli init|upgrade` works without a separate `@autopilot-harness/templates` package.

## [0.2.2] — 2026-09-05

### Fixed

- Default `.autopilotignore` / built-in defaults also exclude `.claude/**` (parity with `.cursor/**`); vendored hook runtime rebuilt.

## [0.2.1] — 2026-09-05

### Added

- Installed Autopilot hook commands stamp `--platform <id>` (`cursor` / `claude-code`); hook entry parses it as primary dispatch with payload conflict resolver retained.
- `doctor` WARN when Autopilot hooks lack the platform stamp (run `upgrade`).
- Dual-host matrix covers stamped install + `--platform claude-code` Stop cross-fire.

## [0.2.0] — 2026-09-05

### Added

- Claude Code host port: `@autopilot-harness/port-claude-code` (UserPromptSubmit / PostToolUse / Stop / StopFailure).
- Dual-port vendored `runtime.mjs` (Cursor + Claude Code); `hook.mjs` host dispatch + Claude fail-open.
- Init / upgrade / uninstall for `.claude/settings.json` (hooks + `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0`) and `.claude/skills/autopilot-*`.
- `--add-platform` for dual-host installs; `doctor` WARN when Claude `BLOCK_CAP` is missing or not `0`.
- Docs: Claude Code **shipped**; `surface: cli` = hooks shared across terminal + IDE (not CLI-only); troubleshooting trust + `BLOCK_CAP`.
- Dual-host matrix tests (`dual-host-matrix.test.ts`) for Cursor↔Claude cross-fire / lifecycle / platform stamp.

### Changed

- Sessions can record `platform: claude-code` (no longer defaulting Claude chats to Cursor).
- Host / architecture / config / quickstart / README (+ zh-CN) describe Cursor **and** Claude Code installs.
- `init --platform claude-code` omits `--surface` → defaults to `cli` (not illegal `ide`).

### Fixed

- Cursor abort no longer fights Claude-project Stop cross-fire (`decision:block` recover spam); route Cursor-shaped Stop payloads to the Cursor handler and normalize Claude abort status.

## [0.1.0] — 2026-09-04

### Added

- First public npm release: `@autopilot-harness/core`, `@autopilot-harness/i18n`, `@autopilot-harness/port-cursor`, `@autopilot-harness/cli` (`0.1.0`).
- Per-package npm READMEs and docs-contract checks for install entrypoints.
- `CONTRIBUTING.md` — develop/test commands, source-build dogfood, docs PR guidance, translation notes, vendor sync.
- Tracked English `docs/autopilot/quickstart.md` and `docs/autopilot/quickstart.zh-CN.md`.
- `docs/config.md`, `docs/troubleshooting.md`, `docs/hosts.md`, `docs/host-plan-bridge.md`.
- `README.zh-CN.md` — Chinese product front door (English README remains authoritative).
- Init `writeQuickstart` includes `review.scope`, claim/resume/replan boundaries, and troubleshooting themes.

### Changed

- User-facing install docs use a single **Install** path: scoped `npx @autopilot-harness/cli` (removed Today / After-npm dual headings); source-build dogfood lives in CONTRIBUTING.
- Documented `review.scope` (`executing_only` vs `project`).
- CLI entry trust + scoped package naming (`@autopilot-harness/cli`, bin `autopilot-harness`).

[0.1.0]: https://github.com/mt2007/autopilot-harness/releases/tag/v0.1.0
