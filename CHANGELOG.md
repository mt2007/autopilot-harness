# Changelog

Product front door: English [README.md](./README.md) is authoritative. Contributor guide: [CONTRIBUTING.md](./CONTRIBUTING.md).

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
