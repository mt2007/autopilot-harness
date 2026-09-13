# npm-publish-pnpm — 0.6.0

- Date: 2026-09-13T16:27Z
- Order: core → i18n → ports (cursor, claude-code, codex, kimi-code, copilot-cli, grok-build) → cli
- Method: **only** `pnpm publish --access public --no-git-checks` (no `npm publish` from package dirs)

## pnpm publish

- published `@autopilot-harness/core@0.6.0`
- published `@autopilot-harness/i18n@0.6.0`
- published `@autopilot-harness/port-cursor@0.6.0`
- published `@autopilot-harness/port-claude-code@0.6.0`
- published `@autopilot-harness/port-codex@0.6.0`
- published `@autopilot-harness/port-kimi-code@0.6.0`
- published `@autopilot-harness/port-copilot-cli@0.6.0`
- published `@autopilot-harness/port-grok-build@0.6.0` (first public release of this package; registry GET lagged ~5m after PUT)
- published `@autopilot-harness/cli@0.6.0`

## npm view

```
@autopilot-harness/core → 0.6.0
@autopilot-harness/i18n → 0.6.0
@autopilot-harness/port-cursor → 0.6.0
@autopilot-harness/port-claude-code → 0.6.0
@autopilot-harness/port-codex → 0.6.0
@autopilot-harness/port-kimi-code → 0.6.0
@autopilot-harness/port-copilot-cli → 0.6.0
@autopilot-harness/port-grok-build → 0.6.0
@autopilot-harness/cli → 0.6.0
```

## npx smoke

```
$ npx --yes @autopilot-harness/cli@0.6.0 --version
0.6.0

$ npx --yes @autopilot-harness/cli@0.6.0 --help
Usage: autopilot-harness [options] [command]
…
```

**Result: PASS**
