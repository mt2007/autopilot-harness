# Changelog

Product front door: English [README.md](./README.md) is authoritative. Contributor guide: [CONTRIBUTING.md](./CONTRIBUTING.md).

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `CONTRIBUTING.md` — develop/test commands, scoped Vitest examples, docs PR guidance, translation welcome notes, vendor sync after i18n/hook changes, PR expectations (focused diffs, tests, no secrets).
- Tracked English `docs/autopilot/quickstart.md` (primary cheat sheet) and `docs/autopilot/quickstart.zh-CN.md`, with portable clone/build + cwd-based CLI examples (no machine-local absolute paths).
- `docs/config.md` — `.autopilot/config.yml` / `.autopilotignore` reference (triggers, concurrency, artifacts.files, security) with explicit **which keys hooks/CLI actually read** vs init-only / not-yet-wired.
- `docs/troubleshooting.md` — doctor WARNs, stop `loop_limit`, double hooks, claim/resume surprises.
- `docs/hosts.md` — Cursor-first host roadmap and stop-loop caps.
- `docs/host-plan-bridge.md` — design-only sketch for optional host Plan mode ↔ Autopilot grill bridge (not implemented).
- `README.zh-CN.md` — Chinese product front door (English README remains authoritative); now includes full `review.scope` notes + Today/After-npm install paths.
- Init `writeQuickstart` now includes `review.scope`, claim/resume/replan boundaries, and a short troubleshooting block (aligned with OSS quickstart themes).

### Changed

- `.gitignore`: track `docs/autopilot/quickstart.md` and `docs/autopilot/quickstart.zh-CN.md` for OSS while ignoring other `docs/autopilot/*` dogfood (e.g. installed workflows).
- Rewrote English `README.md` as the OSS front door: vibecoding harness positioning (grill → checklist → multi-lens review), honest non-guarantee disclaimer, author scale anecdote (Cursor / pure execution; not a benchmark/SLA), CI/License/Node badges, install-from-source while npm is unpublished.
- README / quickstart install: explicit **Today** (source build) vs **After npm publish** (`npx @autopilot-harness/cli`) sections; init `writeQuickstart` aligned; `resolveCliCommand` / shell alias / init TUI package label use scoped `@autopilot-harness/cli` (not bare `npx autopilot-harness`); CLI entry trust is intentionally small (`packages/cli/.../bin.js` with no `node_modules/` in the path, `node_modules/<pkg>/.../bin.js`, `node_modules/.bin` only — path match is case-insensitive; globals / non-npm layouts fall back to scoped `npx`).
- CONTRIBUTING: stronger EN↔zh-CN README sync rule for behavior-facing docs PRs.
- Quickstart linked from README is English; Chinese moved to `quickstart.zh-CN.md`.
- Documented `review.scope` (`executing_only` vs `project`): when fix→confirm runs without `/autopilot-on`, ambient review-complete vs checklist advance, and double-hook caution.
- `docs/architecture.md`: replace dangling “v0.1 plan” pointer with in-repo links to `ReviewEngine` / hosts / quickstart; clarify Claude Code / Codex stop-cap mitigations are **planned** (not shipped in the Cursor-first build).
