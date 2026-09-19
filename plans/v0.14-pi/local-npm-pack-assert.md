# local-npm-pack-assert — 0.14.0

- Date: 2026-09-19T10:49+08:00
- PACKAGE_VERSION: 0.14.0
- Pack dest: `/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.14.0-pack-gi3r2J`
- Also: `pnpm exec vitest run packages/cli/tests/publish-workspace-deps.test.ts` → **16/16 passed**

## pnpm pack (public packages)

```
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.14.0-pack-gi3r2J/autopilot-harness-cli-0.14.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.14.0-pack-gi3r2J/autopilot-harness-core-0.14.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.14.0-pack-gi3r2J/autopilot-harness-i18n-0.14.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.14.0-pack-gi3r2J/autopilot-harness-port-antigravity-0.14.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.14.0-pack-gi3r2J/autopilot-harness-port-claude-code-0.14.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.14.0-pack-gi3r2J/autopilot-harness-port-codex-0.14.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.14.0-pack-gi3r2J/autopilot-harness-port-copilot-cli-0.14.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.14.0-pack-gi3r2J/autopilot-harness-port-cursor-0.14.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.14.0-pack-gi3r2J/autopilot-harness-port-factory-droid-0.14.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.14.0-pack-gi3r2J/autopilot-harness-port-gemini-cli-0.14.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.14.0-pack-gi3r2J/autopilot-harness-port-grok-build-0.14.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.14.0-pack-gi3r2J/autopilot-harness-port-hermes-agent-0.14.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.14.0-pack-gi3r2J/autopilot-harness-port-kimi-code-0.14.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.14.0-pack-gi3r2J/autopilot-harness-port-pi-0.14.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.14.0-pack-gi3r2J/autopilot-harness-port-runner-0.14.0.tgz
```

## No workspace:* in packed package.json

- OK autopilot-harness-cli-0.14.0.tgz → @autopilot-harness/cli@0.14.0 (no workspace:*)
- OK autopilot-harness-core-0.14.0.tgz → @autopilot-harness/core@0.14.0 (no workspace:*)
- OK autopilot-harness-i18n-0.14.0.tgz → @autopilot-harness/i18n@0.14.0 (no workspace:*)
- OK autopilot-harness-port-antigravity-0.14.0.tgz → @autopilot-harness/port-antigravity@0.14.0 (no workspace:*)
- OK autopilot-harness-port-claude-code-0.14.0.tgz → @autopilot-harness/port-claude-code@0.14.0 (no workspace:*)
- OK autopilot-harness-port-codex-0.14.0.tgz → @autopilot-harness/port-codex@0.14.0 (no workspace:*)
- OK autopilot-harness-port-copilot-cli-0.14.0.tgz → @autopilot-harness/port-copilot-cli@0.14.0 (no workspace:*)
- OK autopilot-harness-port-cursor-0.14.0.tgz → @autopilot-harness/port-cursor@0.14.0 (no workspace:*)
- OK autopilot-harness-port-factory-droid-0.14.0.tgz → @autopilot-harness/port-factory-droid@0.14.0 (no workspace:*)
- OK autopilot-harness-port-gemini-cli-0.14.0.tgz → @autopilot-harness/port-gemini-cli@0.14.0 (no workspace:*)
- OK autopilot-harness-port-grok-build-0.14.0.tgz → @autopilot-harness/port-grok-build@0.14.0 (no workspace:*)
- OK autopilot-harness-port-hermes-agent-0.14.0.tgz → @autopilot-harness/port-hermes-agent@0.14.0 (no workspace:*)
- OK autopilot-harness-port-kimi-code-0.14.0.tgz → @autopilot-harness/port-kimi-code@0.14.0 (no workspace:*)
- OK autopilot-harness-port-pi-0.14.0.tgz → @autopilot-harness/port-pi@0.14.0 (no workspace:*)
- OK autopilot-harness-port-runner-0.14.0.tgz → @autopilot-harness/port-runner@0.14.0 (no workspace:*)

## CLI dist PACKAGE_VERSION in tarball

```
export const PACKAGE_VERSION = "0.14.0";
```

**Result: PASS** — 15 public tarballs (ten-way hosts + Pi + Runner meta + core/i18n/cli); no `workspace:*`; cli dist version aligned.
