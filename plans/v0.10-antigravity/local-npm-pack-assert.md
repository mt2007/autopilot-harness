# local-npm-pack-assert — 0.10.0

- Date: 2026-09-16T21:38Z
- PACKAGE_VERSION: 0.10.0
- Pack dest: `/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.10.0-pack-8okn9_wn`
- Also: `pnpm exec vitest run packages/cli/tests/publish-workspace-deps.test.ts` → **14/14 passed**

## pnpm pack (public packages)

```
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.10.0-pack-8okn9_wn/autopilot-harness-cli-0.10.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.10.0-pack-8okn9_wn/autopilot-harness-core-0.10.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.10.0-pack-8okn9_wn/autopilot-harness-i18n-0.10.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.10.0-pack-8okn9_wn/autopilot-harness-port-antigravity-0.10.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.10.0-pack-8okn9_wn/autopilot-harness-port-claude-code-0.10.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.10.0-pack-8okn9_wn/autopilot-harness-port-codex-0.10.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.10.0-pack-8okn9_wn/autopilot-harness-port-copilot-cli-0.10.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.10.0-pack-8okn9_wn/autopilot-harness-port-cursor-0.10.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.10.0-pack-8okn9_wn/autopilot-harness-port-factory-droid-0.10.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.10.0-pack-8okn9_wn/autopilot-harness-port-gemini-cli-0.10.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.10.0-pack-8okn9_wn/autopilot-harness-port-grok-build-0.10.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.10.0-pack-8okn9_wn/autopilot-harness-port-hermes-agent-0.10.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.10.0-pack-8okn9_wn/autopilot-harness-port-kimi-code-0.10.0.tgz
```

## No workspace:* in packed package.json

- OK autopilot-harness-cli-0.10.0.tgz → @autopilot-harness/cli@0.10.0 (no workspace:*)
- OK autopilot-harness-core-0.10.0.tgz → @autopilot-harness/core@0.10.0 (no workspace:*)
- OK autopilot-harness-i18n-0.10.0.tgz → @autopilot-harness/i18n@0.10.0 (no workspace:*)
- OK autopilot-harness-port-cursor-0.10.0.tgz → @autopilot-harness/port-cursor@0.10.0 (no workspace:*)
- OK autopilot-harness-port-claude-code-0.10.0.tgz → @autopilot-harness/port-claude-code@0.10.0 (no workspace:*)
- OK autopilot-harness-port-codex-0.10.0.tgz → @autopilot-harness/port-codex@0.10.0 (no workspace:*)
- OK autopilot-harness-port-kimi-code-0.10.0.tgz → @autopilot-harness/port-kimi-code@0.10.0 (no workspace:*)
- OK autopilot-harness-port-copilot-cli-0.10.0.tgz → @autopilot-harness/port-copilot-cli@0.10.0 (no workspace:*)
- OK autopilot-harness-port-grok-build-0.10.0.tgz → @autopilot-harness/port-grok-build@0.10.0 (no workspace:*)
- OK autopilot-harness-port-gemini-cli-0.10.0.tgz → @autopilot-harness/port-gemini-cli@0.10.0 (no workspace:*)
- OK autopilot-harness-port-factory-droid-0.10.0.tgz → @autopilot-harness/port-factory-droid@0.10.0 (no workspace:*)
- OK autopilot-harness-port-hermes-agent-0.10.0.tgz → @autopilot-harness/port-hermes-agent@0.10.0 (no workspace:*)
- OK autopilot-harness-port-antigravity-0.10.0.tgz → @autopilot-harness/port-antigravity@0.10.0 (no workspace:*)

## CLI dist PACKAGE_VERSION in tarball

```
export const PACKAGE_VERSION = "0.10.0";
```

**Result: PASS** — 13 public tarballs (ten-way hosts + core/i18n/cli); no `workspace:*`; cli dist version aligned.
