# Live smoke evidence — `live-grok-smoke` (waived)

## Verdict

**Waived** — no Grok Build CLI on this machine.  
**Waive ≠ publish OK** (see `human-gate-confirm`; still needs explicit「同意发 0.6.0」).

## Detection (2026-09-13T15:18:50Z)

| Check | Result |
|-------|--------|
| `command -v grok` | not found |
| `command -v grok-build` | not found |
| `command -v xai` | not found |
| `~/.grok/` | absent |
| `~/.config/grok/` | absent |
| `/Applications` / `~/Applications` name match `*grok*` | none |
| npm `@xai/grok-cli` | 404 (not on registry) |

Target product remains **Grok Build CLI** (project hooks in `.grok/hooks/autopilot-harness.json`; trust via `/hooks-trust` or `--trust`) — not third-party harness adapters.

## What a non-waived live would prove

On an **external disposable** repo with Autopilot `init --platform grok-build`:

1. Product edit → PostToolUse dirty-arm (`code_edited`)
2. ≥1 Stop-continue → UPS/Stop channel **`decision:block` + `reason` only** (no Stop `additionalContext`; hard-stop may use `continue:false`)
3. **Proof Autopilot hook command actually ran** (e.g. invocation log / probe wrapping `node .autopilot/bin/autopilot-harness-hook.mjs --platform grok-build`)
4. Doctor honesty: Stop-continue **≤8/turn** (degraded; per-turn reset; not Copilot consecutive)

## Machine-readable

See `live-smoke-evidence.json` (`waived: true`, `itemId: live-grok-smoke`).
