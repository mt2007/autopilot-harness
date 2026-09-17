# local-npm-pack-assert — 0.10.1

- Date: 2026-09-17T09:45Z
- PACKAGE_VERSION: 0.10.1
- Pack dest: `/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.10.1-pack-2r24he52`
- Also: `pnpm exec vitest run packages/cli/tests/publish-workspace-deps.test.ts` → **14/14 passed**

## pnpm pack (public packages)

```
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.10.1-pack-2r24he52/autopilot-harness-cli-0.10.1.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.10.1-pack-2r24he52/autopilot-harness-core-0.10.1.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.10.1-pack-2r24he52/autopilot-harness-i18n-0.10.1.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.10.1-pack-2r24he52/autopilot-harness-port-antigravity-0.10.1.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.10.1-pack-2r24he52/autopilot-harness-port-claude-code-0.10.1.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.10.1-pack-2r24he52/autopilot-harness-port-codex-0.10.1.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.10.1-pack-2r24he52/autopilot-harness-port-copilot-cli-0.10.1.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.10.1-pack-2r24he52/autopilot-harness-port-cursor-0.10.1.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.10.1-pack-2r24he52/autopilot-harness-port-factory-droid-0.10.1.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.10.1-pack-2r24he52/autopilot-harness-port-gemini-cli-0.10.1.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.10.1-pack-2r24he52/autopilot-harness-port-grok-build-0.10.1.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.10.1-pack-2r24he52/autopilot-harness-port-hermes-agent-0.10.1.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.10.1-pack-2r24he52/autopilot-harness-port-kimi-code-0.10.1.tgz
```

## No workspace:* in packed package.json

- OK autopilot-harness-cli-0.10.1.tgz → @autopilot-harness/cli@0.10.1 (no workspace:*)
- OK autopilot-harness-core-0.10.1.tgz → @autopilot-harness/core@0.10.1 (no workspace:*)
- OK autopilot-harness-i18n-0.10.1.tgz → @autopilot-harness/i18n@0.10.1 (no workspace:*)
- OK autopilot-harness-port-antigravity-0.10.1.tgz → @autopilot-harness/port-antigravity@0.10.1 (no workspace:*)
- OK autopilot-harness-port-claude-code-0.10.1.tgz → @autopilot-harness/port-claude-code@0.10.1 (no workspace:*)
- OK autopilot-harness-port-codex-0.10.1.tgz → @autopilot-harness/port-codex@0.10.1 (no workspace:*)
- OK autopilot-harness-port-copilot-cli-0.10.1.tgz → @autopilot-harness/port-copilot-cli@0.10.1 (no workspace:*)
- OK autopilot-harness-port-cursor-0.10.1.tgz → @autopilot-harness/port-cursor@0.10.1 (no workspace:*)
- OK autopilot-harness-port-factory-droid-0.10.1.tgz → @autopilot-harness/port-factory-droid@0.10.1 (no workspace:*)
- OK autopilot-harness-port-gemini-cli-0.10.1.tgz → @autopilot-harness/port-gemini-cli@0.10.1 (no workspace:*)
- OK autopilot-harness-port-grok-build-0.10.1.tgz → @autopilot-harness/port-grok-build@0.10.1 (no workspace:*)
- OK autopilot-harness-port-hermes-agent-0.10.1.tgz → @autopilot-harness/port-hermes-agent@0.10.1 (no workspace:*)
- OK autopilot-harness-port-kimi-code-0.10.1.tgz → @autopilot-harness/port-kimi-code@0.10.1 (no workspace:*)

## CLI dist PACKAGE_VERSION in tarball

```
export const PACKAGE_VERSION = "0.10.1";
```

**Result: PASS** — 13 public tarballs (ten-way hosts + core/i18n/cli); no `workspace:*`; cli dist version aligned.
