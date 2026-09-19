# npm-publish-pnpm — 0.15.0

- Date: 2026-09-19T20:05+08:00
- Order: core → i18n → ports (cursor, claude-code, codex, kimi-code, copilot-cli, grok-build, gemini-cli, factory-droid, hermes-agent, antigravity, pi, **devin**, runner) → cli
- Method: **only** `pnpm publish --access public --no-git-checks` from each package dir (no `npm publish` from package dirs)
- Rebuild: public package `build` before publish

## pnpm publish

- published `@autopilot-harness/core@0.15.0`
- published `@autopilot-harness/i18n@0.15.0`
- published `@autopilot-harness/port-cursor@0.15.0`
- published `@autopilot-harness/port-claude-code@0.15.0`
- published `@autopilot-harness/port-codex@0.15.0`
- published `@autopilot-harness/port-kimi-code@0.15.0`
- published `@autopilot-harness/port-copilot-cli@0.15.0`
- published `@autopilot-harness/port-grok-build@0.15.0`
- published `@autopilot-harness/port-gemini-cli@0.15.0`
- published `@autopilot-harness/port-factory-droid@0.15.0`
- published `@autopilot-harness/port-hermes-agent@0.15.0`
- published `@autopilot-harness/port-antigravity@0.15.0`
- published `@autopilot-harness/port-pi@0.15.0`
- published `@autopilot-harness/port-devin@0.15.0`
- published `@autopilot-harness/port-runner@0.15.0`
- published `@autopilot-harness/cli@0.15.0`

## npm view

```
@autopilot-harness/core@0.15.0 → 0.15.0
@autopilot-harness/i18n@0.15.0 → 0.15.0
@autopilot-harness/port-cursor@0.15.0 → 0.15.0
@autopilot-harness/port-claude-code@0.15.0 → 0.15.0
@autopilot-harness/port-codex@0.15.0 → 0.15.0
@autopilot-harness/port-kimi-code@0.15.0 → 0.15.0
@autopilot-harness/port-copilot-cli@0.15.0 → 0.15.0
@autopilot-harness/port-grok-build@0.15.0 → 0.15.0
@autopilot-harness/port-gemini-cli@0.15.0 → 0.15.0
@autopilot-harness/port-factory-droid@0.15.0 → 0.15.0
@autopilot-harness/port-hermes-agent@0.15.0 → 0.15.0
@autopilot-harness/port-antigravity@0.15.0 → 0.15.0
@autopilot-harness/port-pi@0.15.0 → 0.15.0
@autopilot-harness/port-devin@0.15.0 → 0.15.0
@autopilot-harness/port-runner@0.15.0 → 0.15.0
@autopilot-harness/cli@0.15.0 → 0.15.0
```

Published cli deps use concrete `0.15.0` (no `workspace:*`), including `@autopilot-harness/port-devin`.

## npx smoke

```
$ npx --yes @autopilot-harness/cli@0.15.0 --version
0.15.0
```

**Result: PASS**
