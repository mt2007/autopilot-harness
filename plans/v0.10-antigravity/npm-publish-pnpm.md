# npm-publish-pnpm — 0.10.0

- Date: 2026-09-16T21:54Z
- Order: core → i18n → ports (cursor, claude-code, codex, kimi-code, copilot-cli, grok-build, gemini-cli, factory-droid, hermes-agent, antigravity) → cli
- Method: **only** `pnpm publish --access public --no-git-checks` (no `npm publish` from package dirs)
- Rebuild: `pnpm -r run build` before publish

## pnpm publish

- published `@autopilot-harness/core@0.10.0`
- published `@autopilot-harness/i18n@0.10.0`
- published `@autopilot-harness/port-cursor@0.10.0`
- published `@autopilot-harness/port-claude-code@0.10.0`
- published `@autopilot-harness/port-codex@0.10.0`
- published `@autopilot-harness/port-kimi-code@0.10.0`
- published `@autopilot-harness/port-copilot-cli@0.10.0`
- published `@autopilot-harness/port-grok-build@0.10.0`
- published `@autopilot-harness/port-gemini-cli@0.10.0`
- published `@autopilot-harness/port-factory-droid@0.10.0`
- published `@autopilot-harness/port-hermes-agent@0.10.0`
- published `@autopilot-harness/port-antigravity@0.10.0` (first public release of this package)
- published `@autopilot-harness/cli@0.10.0`

## npm view

```
@autopilot-harness/core → 0.10.0
@autopilot-harness/i18n → 0.10.0
@autopilot-harness/port-cursor → 0.10.0
@autopilot-harness/port-claude-code → 0.10.0
@autopilot-harness/port-codex → 0.10.0
@autopilot-harness/port-kimi-code → 0.10.0
@autopilot-harness/port-copilot-cli → 0.10.0
@autopilot-harness/port-grok-build → 0.10.0
@autopilot-harness/port-gemini-cli → 0.10.0
@autopilot-harness/port-factory-droid → 0.10.0
@autopilot-harness/port-hermes-agent → 0.10.0
@autopilot-harness/port-antigravity → 0.10.0
@autopilot-harness/cli → 0.10.0
```

Published cli deps use concrete `0.10.0` (no `workspace:*`).

## npx smoke

```
$ npx --yes @autopilot-harness/cli@0.10.0 --version
0.10.0

$ npx --yes @autopilot-harness/cli@0.10.0 --help
Usage: autopilot-harness [options] [command]
…
```

**Result: PASS**
