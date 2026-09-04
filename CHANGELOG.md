# Changelog

Product front door: English [README.md](./README.md) is authoritative. Contributor guide: [CONTRIBUTING.md](./CONTRIBUTING.md).

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
