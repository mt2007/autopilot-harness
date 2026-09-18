# Live smoke evidence — `live-pi-smoke` (**proven ≥1**)

## Verdict

**Proven** (2026-09-18 retry). Interactive TUI, model reachable. Edit arm **yes**. Host continue **1×** (`custom_message` `customType: autopilot-harness`, text starts `Review fix round 1`). Aim **≥2× not reached** — driver stopped during that first review turn, before a second settle.

Prior attempt the same day was **blocked** (provider NXDOMAIN, continue 0×). This retry replaces that ship block for the continue/edit gates.

## Environment

| Item | Value |
|------|-------|
| Pi | **0.85.1** |
| Surface | interactive TUI (`pi --approve`), **not** `pi -p` / JSON |
| Provider | `newapi` / `deepseek/deepseek-v4-flash-20260731` |
| DNS | `newapi.zbjt.com` resolves (was NXDOMAIN on the blocked run) |
| Disposable repo | `/tmp/ap-pi-live-GHVik9` (`init --yes --platform pi`) |
| Session file | `/tmp/ap-pi-live-evidence/sessions2/2026-09-18T15-13-20-176Z_01a0b514-472f-70d2-87d5-ec6e1cab9977.jsonl` |

## What ran

1. Fresh disposable init wrote `.pi/extensions/autopilot.ts` (ctx session id) + vendor runtime.
2. One TUI prompt started with `Autopilot RUN live-pi-smoke` plus the edit instruction on the same line.
3. Model used the **edit** tool. `src/hello.ts` gained `// live-smoke`.
4. After `agent_settled`, the session contains **one** `custom_message` / `autopilot-harness` whose content is the harness fix-round followup. The next assistant turn treats that text as the user request.
5. SQLite session stayed `phase=idle`, `track_id=_pending` (slug did not bind — extra sentence after the RUN phrase). Review still armed under `review.scope: project`. Continue path is the same `agent_settled` → `sendMessage(followUp, triggerTurn)`.

## Gates

| Gate | Status |
|------|--------|
| Interactive TUI (R5), not print/JSON | **Yes** |
| Edit arm (`edit` tool + file change) | **Yes** |
| continue ≥1× | **Yes** (1× custom message) |
| continue ≥2× (aim) | **No** |
| RUN binds `track_id=live-pi-smoke` / `phase=executing` | **No** this retry (prompt shape). Prior blocked run did arm executing. |
| Ship 0.14.0 | **Not yet** — docs/bump still unchecked; aim-2 and clean RUN bind not repeated |

## Prior blocked run

See git history of this file (2026-09-18 earlier): TUI armed `phase=executing` `track_id=live-pi-smoke`, then `Connection error` / continue **0×**.
