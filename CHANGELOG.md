# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `CONTRIBUTING.md` — develop/test commands, scoped Vitest examples, docs PR guidance, translation welcome notes, vendor sync after i18n/hook changes, PR expectations (focused diffs, tests, no secrets).
- Tracked `docs/autopilot/quickstart.md` (zh) with portable clone/build + cwd-based CLI examples (no machine-local absolute paths).

### Changed

- `.gitignore`: track `docs/autopilot/quickstart.md` for OSS while ignoring other `docs/autopilot/*` dogfood (e.g. installed workflows).
- Rewrote English `README.md` as the OSS front door: vibecoding harness positioning (grill → checklist → multi-lens review), honest non-guarantee disclaimer, author scale anecdote (Cursor / pure execution; not a benchmark/SLA), CI/License/Node badges, install-from-source while npm is unpublished.
