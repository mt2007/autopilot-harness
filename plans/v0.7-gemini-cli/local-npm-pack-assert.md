# local-npm-pack-assert — 0.7.0

- Date: 2026-09-14T14:33Z
- PACKAGE_VERSION: 0.7.0
- Pack dest: `/tmp/ap-0.7.0-pack-XCqNNE`

## pnpm pack (public packages)

```
/tmp/ap-0.7.0-pack-XCqNNE/autopilot-harness-cli-0.7.0.tgz
/tmp/ap-0.7.0-pack-XCqNNE/autopilot-harness-core-0.7.0.tgz
/tmp/ap-0.7.0-pack-XCqNNE/autopilot-harness-i18n-0.7.0.tgz
/tmp/ap-0.7.0-pack-XCqNNE/autopilot-harness-port-claude-code-0.7.0.tgz
/tmp/ap-0.7.0-pack-XCqNNE/autopilot-harness-port-codex-0.7.0.tgz
/tmp/ap-0.7.0-pack-XCqNNE/autopilot-harness-port-copilot-cli-0.7.0.tgz
/tmp/ap-0.7.0-pack-XCqNNE/autopilot-harness-port-cursor-0.7.0.tgz
/tmp/ap-0.7.0-pack-XCqNNE/autopilot-harness-port-gemini-cli-0.7.0.tgz
/tmp/ap-0.7.0-pack-XCqNNE/autopilot-harness-port-grok-build-0.7.0.tgz
/tmp/ap-0.7.0-pack-XCqNNE/autopilot-harness-port-kimi-code-0.7.0.tgz
```

## No workspace:* in packed package.json

- OK autopilot-harness-cli-0.7.0.tgz → @autopilot-harness/cli@0.7.0 (no workspace:*)
- OK autopilot-harness-core-0.7.0.tgz → @autopilot-harness/core@0.7.0 (no workspace:*)
- OK autopilot-harness-i18n-0.7.0.tgz → @autopilot-harness/i18n@0.7.0 (no workspace:*)
- OK autopilot-harness-port-claude-code-0.7.0.tgz → @autopilot-harness/port-claude-code@0.7.0 (no workspace:*)
- OK autopilot-harness-port-codex-0.7.0.tgz → @autopilot-harness/port-codex@0.7.0 (no workspace:*)
- OK autopilot-harness-port-copilot-cli-0.7.0.tgz → @autopilot-harness/port-copilot-cli@0.7.0 (no workspace:*)
- OK autopilot-harness-port-cursor-0.7.0.tgz → @autopilot-harness/port-cursor@0.7.0 (no workspace:*)
- OK autopilot-harness-port-gemini-cli-0.7.0.tgz → @autopilot-harness/port-gemini-cli@0.7.0 (no workspace:*)
- OK autopilot-harness-port-grok-build-0.7.0.tgz → @autopilot-harness/port-grok-build@0.7.0 (no workspace:*)
- OK autopilot-harness-port-kimi-code-0.7.0.tgz → @autopilot-harness/port-kimi-code@0.7.0 (no workspace:*)

## CLI dist PACKAGE_VERSION in tarball

```
export const PACKAGE_VERSION = "0.7.0";
```

## CLI smoke from local tarball install (`/tmp/ap-0.7.0-smoke-w4FnmQ`)

All 10 public tarballs installed together (so `@autopilot-harness/*@0.7.0` resolves from local packs, not registry).

### --help
```
Usage: autopilot-harness [options] [command]

Autopilot Harness — Planning → Executing agent harness

Options:
  -V, --version        output the version number
  -h, --help           display help for command

Commands:
  init [options]       Install Autopilot into the current project
  uninstall [options]  Remove Autopilot wiring from this project (keeps plans/;
                       config/state by default)
  upgrade [options]    Upgrade Autopilot files in this project to the current
                       CLI version
  status               Show Autopilot status for this project
  doctor [options]     Diagnose Autopilot installation
  locale               Manage project locale (skill descriptions + config)
  session              List and manage Autopilot sessions
  help [command]       display help for command
```

### version
```
0.7.0
```

### status (cwd = repo dogfood)
```
Autopilot status
  project:  /Users/zhaoqingli/workspaces/autopilot-harness
  pin:      autopilot-harness@0.6.0
  platforms: cursor(ide), claude-code(cli)
  locale:   zh-CN
  plans:    plans
  state:    state.db ok (schema 3)
  sessions: 45
  latest:   a7484806  v0.7-gemini-cli
  phase:    executing · armed
  executors:
    - a7484806  track=v0.7-gemini-cli  (Autopilot OFF in that chat, or: session purge <id>)
```

### doctor (cwd = repo dogfood)
```
OK    config.yml
OK    .autopilotignore
OK    pin.json → 0.6.0
WARN  pin 0.6.0 ≠ package 0.7.0 — consider upgrade
OK    autopilot-harness-hook.mjs
OK    hook vendor runtime
OK    hooks.json Autopilot entries
OK    .claude/settings.json Autopilot entries
OK    Node 26.3.0
OK    plans (plans/)
OK    skills (10)
OK    state.db schema_version=3
WARN  1 executing+armed session(s) — Autopilot OFF in that chat, or: session purge <id>
      - a7484806  track=v0.7-gemini-cli
WARN  37 stale session(s) (>72h) — session purge <id> or doctor --prune-stale
```

**Result: PASS** — 10 public tarballs @0.7.0 (incl. port-gemini-cli), no `workspace:*`, CLI `--help` / `--version` / `status` / `doctor` ran from local tarball install (cwd=repo).
