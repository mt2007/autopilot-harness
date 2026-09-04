# Changelog

Product front door: English [README.md](./README.md) is authoritative. Contributor guide: [CONTRIBUTING.md](./CONTRIBUTING.md).

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `CONTRIBUTING.md` — develop/test commands, scoped Vitest examples, docs PR guidance, translation welcome notes, vendor sync after i18n/hook changes, PR expectations (focused diffs, tests, no secrets).
- Tracked English `docs/autopilot/quickstart.md` (primary cheat sheet) and `docs/autopilot/quickstart.zh-CN.md`, with portable clone/build + cwd-based CLI examples (no machine-local absolute paths).

### Changed

- `.gitignore`: track `docs/autopilot/quickstart.md` and `docs/autopilot/quickstart.zh-CN.md` for OSS while ignoring other `docs/autopilot/*` dogfood (e.g. installed workflows).
- Rewrote English `README.md` as the OSS front door: vibecoding harness positioning (grill → checklist → multi-lens review), honest non-guarantee disclaimer, author scale anecdote (Cursor / pure execution; not a benchmark/SLA), CI/License/Node badges, install-from-source while npm is unpublished.
- Quickstart linked from README is English; Chinese moved to `quickstart.zh-CN.md`.
