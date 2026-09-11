# Changelog

Product front door: English [README.md](./README.md) is authoritative. Contributor guide: [CONTRIBUTING.md](./CONTRIBUTING.md).

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
