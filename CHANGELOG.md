# Changelog

Product front door: English [README.md](./README.md) is authoritative. Contributor guide: [CONTRIBUTING.md](./CONTRIBUTING.md).

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `CONTRIBUTING.md` — develop/test commands, scoped Vitest examples, docs PR guidance, translation welcome notes, vendor sync after i18n/hook changes, PR expectations (focused diffs, tests, no secrets).
- Tracked English `docs/autopilot/quickstart.md` (primary cheat sheet) and `docs/autopilot/quickstart.zh-CN.md`, with portable clone/build + cwd-based CLI examples (no machine-local absolute paths).
- `docs/config.md` — `.autopilot/config.yml` / `.autopilotignore` reference.
- `docs/troubleshooting.md` — doctor WARNs, stop `loop_limit`, double hooks, claim/resume surprises.
- `docs/hosts.md` — Cursor-first host roadmap and stop-loop caps.
- `README.zh-CN.md` — Chinese product front door (English README remains authoritative).
- Init `writeQuickstart` now includes `review.scope`, claim/resume/replan boundaries, and a short troubleshooting block (aligned with OSS quickstart themes).

### Changed

- `.gitignore`: track `docs/autopilot/quickstart.md` and `docs/autopilot/quickstart.zh-CN.md` for OSS while ignoring other `docs/autopilot/*` dogfood (e.g. installed workflows).
- Rewrote English `README.md` as the OSS front door: vibecoding harness positioning (grill → checklist → multi-lens review), honest non-guarantee disclaimer, author scale anecdote (Cursor / pure execution; not a benchmark/SLA), CI/License/Node badges, install-from-source while npm is unpublished.
- Quickstart linked from README is English; Chinese moved to `quickstart.zh-CN.md`.
- Documented `review.scope` (`executing_only` vs `project`): when fix→confirm runs without `/autopilot-on`, ambient review-complete vs checklist advance, and double-hook caution.
- `docs/architecture.md`: replace dangling “v0.1 plan” pointer with in-repo links to `ReviewEngine` / hosts / quickstart; clarify Claude Code / Codex stop-cap mitigations are **planned** (not shipped in the Cursor-first build).
