# changelog-bump-0-15-0 — evidence

**Date:** 2026-09-19  
**Version:** public packages **0.15.0** (`PACKAGE_VERSION` + root + publishable package.json).

## Changes

- `packages/cli/src/init/types.ts` → `PACKAGE_VERSION = "0.15.0"`
- Root + all public package.json under `PUBLIC_PACKAGE_JSON_PATHS` (includes **`port-devin`**) → `0.15.0`
- Root + `@autopilot-harness/cli` descriptions now list **Devin** among shipped hosts; CLI keywords include **`devin`**
- `docs-contract` PACKAGE_VERSION / description / keywords pins updated for **0.15.0** + Devin
- `CHANGELOG.md` **`[0.15.0]`** section already landed in `docs-devin-shipped` (Devin full Shipped; OpenCode **1 (next)** wait upstream; eleven-way publish order with `devin`); older sections untouched

## Not in this item

- `pnpm pack` / publish / tag / pin / human gate — later checklist rows
