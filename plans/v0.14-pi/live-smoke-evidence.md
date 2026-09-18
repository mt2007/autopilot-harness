# Live smoke evidence — `live-pi-smoke` (**blocked**)

## Verdict

**Not proven** (2026-09-18). Interactive TUI reached an armed executing session, then the model call failed. Continue **0×**. Edit arm **not observed**.

Ship gate: **do not release 0.14.0**. This is not a waive and not a degraded pass. A later retry needs a reachable provider, then continue ≥1× (aim ≥2×) plus an edit/`write` tool arm.

Checklist item stays `[ ]`.

## Environment

| Item | Value |
|------|-------|
| Pi | **0.85.1** on PATH |
| Surface | interactive TUI (`ctx.mode = "tui"`), `pi --approve`, **not** `pi -p` / JSON |
| Provider | `newapi` / `deepseek/deepseek-v4-flash-20260731` |
| `NEWAPI_API_KEY` | set |
| DNS | `newapi.zbjt.com` → **NXDOMAIN** (system resolver). `pi auth check --provider newapi` still prints ready (key present, host unreachable) |
| Disposable repo | `/tmp/ap-pi-live-0EzhTR` (`init --yes --platform pi`) |

## What ran

1. Rebuilt CLI so `--platform pi` is installable, then init wrote `.pi/extensions/autopilot.ts` + vendor runtime + `.agents/skills`.
2. First TUI: events fired, but `ExtensionAPI` has **no** `sessionManager` / `mode` / `cwd`. Handlers read `pi.sessionManager`, so conversation id was empty and **no session was armed**.
3. Extension now reads **`ctx.sessionManager` / `ctx.mode` / `ctx.cwd`** (research R2). Contract test updated. `packages/cli/tests/pi-contract.test.ts` — 10 passed.
4. Retry, clean line-start `Autopilot RUN live-pi-smoke`:
   - `mode=tui`, session file present
   - session `phase=executing`, `armed=1`, `track_id=live-pi-smoke`
5. Model turn: `Error: Connection error` then `Retry failed after 3 attempts`. `agent_settled` fired. No `source=extension` input. No `tool_result`. `src/hello.ts` unchanged. `chain_pending=0`, `code_edited=0`.

## Gates

| Gate | Status |
|------|--------|
| Interactive TUI (R5), not print/JSON | **Yes** |
| RUN arms Pi session | **Yes** (after ctx session-id fix) |
| continue ≥1× | **No** |
| edit arm | **No** |
| Ship 0.14.0 | **No** |

## Working tree (not committed here)

- `packages/cli/assets/pi-extension/autopilot.ts` — session/mode/cwd from event `ctx`
- `packages/cli/tests/pi-contract.test.ts` — assert no `pi.sessionManager`
- `packages/cli/dist/assets/pi-extension/autopilot.ts` — synced copy
