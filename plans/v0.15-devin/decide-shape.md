# decide-shape — 2026-09-19

## Decision

```text
decide-shape = port × subprocess × full
```

**Not** `defer`.  
**Not** in-process.  
**Not** “degraded without wiring” (illegal).

## Inputs

| Source | Fact |
|--------|------|
| `research-devin-hooks.md` | Devin CLI **3000.10.31** — Stop continue is documented: stdout `{"decision":"block","reason":"…"}`. Submit = `UserPromptSubmit.prompt`. Edit arm = anchored PostToolUse matcher plus `exec` dirty-arm. PostToolUse never blocks |
| Hard Stop cap | **None documented** (no BLOCK_CAP). Docs only warn that a blocking Stop can loop → tier **full** now. Live fail or waive later → **degraded + human gate**, keep the wiring |
| Process | Command hooks in `.devin/hooks.v1.json`. **Subprocess** `node "$DEVIN_PROJECT_DIR"/.autopilot/bin/…`. **Not** an in-process extension |
| Soft min | **≥3000.10.31**. Below → doctor WARN. Unparseable version → 「以活链 CLI 为准」 |
| Session id | stdin `session_id` only. If a subagent Stop shares that id, handle only the current `session_id`. Sharing itself is **unproven** |
| `human-env-confirm.md` | CLI **3000.10.31** on PATH, logged in, free plan → **not** env-defer. No Desktop gate |
| Scope | CLI only. Desktop, cloud Devin, and Cascade stay untested and unclaimed |

## Why not defer

- Autopilot capability **#3 stop-continue** has a documented stdout contract on this host (`decision:block` + `reason`). OpenCode deferred because that contract was missing. Devin’s is present.
- Env is present. A free-plan quota limit can shorten the later live smoke; it does not block wiring.
- Live continue is still the **ship** gate (`live-devin-smoke`). It is not a reason to skip the port.

## Why not in-process / degraded (now)

- Devin loads hooks as subprocess commands. There is no in-process vendor-load path to prefer.
- No documented hard continue cap → do **not** pre-label degraded. Half-broken after wire → human-gate degraded only, and still ship the code. No 0.15 bump if live fails.

## Still unproven (do not treat as defer gates)

| Unknown | Lock |
|---------|------|
| `-p` / print | Interactive CLI is the official surface. Whether hooks fire under `-p` stays unproven. Live smoke does not use `-p` unless later proof says they fire |
| `--sandbox` | Isolates the **exec tool**. Whether the hook child is sandboxed is unproven. Not a decide-defer |
| Subagent Stop `session_id` | Unproven. Bind only to the current stdin `session_id` |

## Implications for later checklist items

| Item | Action |
|------|--------|
| `defer-closeout` | **Skip / N/A** (only when decide=defer). Do **not** cancel port or release items. Do **not** drop the docs flip |
| `port-devin-package` … `pin-upgrade-repo` | Proceed in order. **live-devin-smoke** gates the 0.15 bump |

## Next checklist item

**`defer-closeout`** is a no-op skip, then **`port-devin-package`** — `@autopilot-harness/port-devin` + `handleDevin*` per the research locks. Do not reuse the Claude port fingerprint.
