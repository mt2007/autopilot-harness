# local-npm-pack-assert — 0.8.0

- Date: 2026-09-15T11:19Z
- PACKAGE_VERSION: 0.8.0
- Pack dest: `/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.8.0-pack-elf8avbk`
- Also: `pnpm exec vitest run packages/cli/tests/publish-workspace-deps.test.ts` → **12/12 passed**

## pnpm pack (public packages)

```
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.8.0-pack-elf8avbk/autopilot-harness-cli-0.8.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.8.0-pack-elf8avbk/autopilot-harness-core-0.8.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.8.0-pack-elf8avbk/autopilot-harness-i18n-0.8.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.8.0-pack-elf8avbk/autopilot-harness-port-claude-code-0.8.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.8.0-pack-elf8avbk/autopilot-harness-port-codex-0.8.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.8.0-pack-elf8avbk/autopilot-harness-port-copilot-cli-0.8.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.8.0-pack-elf8avbk/autopilot-harness-port-cursor-0.8.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.8.0-pack-elf8avbk/autopilot-harness-port-factory-droid-0.8.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.8.0-pack-elf8avbk/autopilot-harness-port-gemini-cli-0.8.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.8.0-pack-elf8avbk/autopilot-harness-port-grok-build-0.8.0.tgz
/var/folders/fh/jkyjdxjx12zfvq0twrsj33bw0000gn/T/ap-0.8.0-pack-elf8avbk/autopilot-harness-port-kimi-code-0.8.0.tgz
```

## No workspace:* in packed package.json

- OK autopilot-harness-cli-0.8.0.tgz → @autopilot-harness/cli@0.8.0 (no workspace:*)
- OK autopilot-harness-core-0.8.0.tgz → @autopilot-harness/core@0.8.0 (no workspace:*)
- OK autopilot-harness-i18n-0.8.0.tgz → @autopilot-harness/i18n@0.8.0 (no workspace:*)
- OK autopilot-harness-port-claude-code-0.8.0.tgz → @autopilot-harness/port-claude-code@0.8.0 (no workspace:*)
- OK autopilot-harness-port-codex-0.8.0.tgz → @autopilot-harness/port-codex@0.8.0 (no workspace:*)
- OK autopilot-harness-port-copilot-cli-0.8.0.tgz → @autopilot-harness/port-copilot-cli@0.8.0 (no workspace:*)
- OK autopilot-harness-port-cursor-0.8.0.tgz → @autopilot-harness/port-cursor@0.8.0 (no workspace:*)
- OK autopilot-harness-port-factory-droid-0.8.0.tgz → @autopilot-harness/port-factory-droid@0.8.0 (no workspace:*)
- OK autopilot-harness-port-gemini-cli-0.8.0.tgz → @autopilot-harness/port-gemini-cli@0.8.0 (no workspace:*)
- OK autopilot-harness-port-grok-build-0.8.0.tgz → @autopilot-harness/port-grok-build@0.8.0 (no workspace:*)
- OK autopilot-harness-port-kimi-code-0.8.0.tgz → @autopilot-harness/port-kimi-code@0.8.0 (no workspace:*)

## CLI dist PACKAGE_VERSION in tarball

```
export const PACKAGE_VERSION = "0.8.0";
```

**Result: PASS** — eleven public tarballs; no `workspace:*`; cli dist version aligned.
