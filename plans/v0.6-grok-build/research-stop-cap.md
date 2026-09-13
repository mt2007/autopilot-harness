# Research — Grok Build Stop continuation cap (v0.6)

**Date:** 2026-09-13  
**Sources:** [grok-build hooks guide](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/10-hooks.md); [docs.x.ai/build/features/hooks](https://docs.x.ai/build/features/hooks); [docs.x.ai settings reference](https://docs.x.ai/build/settings/reference); [x.ai/build/changelog](https://x.ai/build/changelog).

## Finding

| Item | Result |
|------|--------|
| Cap | **8** Stop/SubagentStop continuations **per turn** (blocks **or** non-error `additionalContext` each count) |
| After 8 | Host force-ends; hooks **not** consulted for that final stop |
| Reset | Next **user prompt** starts a fresh counter |
| Raise / disable knob | **Not found** in hooks guide, public env reference, or changelog (no `GROK_STOP_*` raise) |
| Related | `stopHookActive` for in-chain detection; `continue:false` forces stop early |

## Port decision

```ts
export const GROK_STOP_CAP_RAISE_FOUND = false;
export const GROK_STOP_PER_TURN_BLOCK_CAP = 8;
```

Ship **degraded** Autopilot: document ≤8/turn + nudge/RESUME recovery; do not claim unlimited Stop-continue; do not emit Stop `additionalContext` continue (would double-burn the 8).
