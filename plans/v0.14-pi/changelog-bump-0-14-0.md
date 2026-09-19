# changelog-bump-0-14-0 — evidence

**Date:** 2026-09-19  
**Version:** public packages **0.14.0** (`PACKAGE_VERSION` + root + publishable package.json).

## Changes

- `packages/cli/src/init/types.ts` → `PACKAGE_VERSION = "0.14.0"`
- Root + all public package.json under `PUBLIC_PACKAGE_JSON_PATHS` (includes **`port-pi`**) → `0.14.0`
- `CHANGELOG.md`: new **`[0.14.0]`** section (Pi port + docs-pi-shipped full Shipped; OpenCode remains **1 (next)** wait upstream); older sections untouched
- `packages/cli/tests/docs-contract.test.ts`: pin `0.14.0` section + keep Unreleased free of `docs-pi-shipped` / `handlePi`

## Not in this item

- `pnpm pack` / publish / tag / pin / human gate — later checklist rows
