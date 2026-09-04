# Host roadmap

Product front door: [README.md](../README.md). Stop-loop internals: [architecture.md](./architecture.md).

Autopilot separates **core** (FSM, SQLite, checklist, review) from **ports** (host adapters). **v0.1 is Cursor-first**; other hosts are planned.

## Status

| Host | Status | Surface | Notes |
|------|--------|---------|-------|
| **Cursor** | **v0.1 shipped** | `ide` (hooks) | Skills `/autopilot-*`, Stop / submit / edit hooks, vendored `runtime.mjs`. |
| **Claude Code** | **v0.2 planned** | `ide` / CLI hooks | Stop `decision: "block"` consecutive **block cap** (default 8); init intended to set `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0`. |
| **Codex** | **v0.3 / v0.4 planned** | hooks (not Runner-first) | `.codex/hooks.json` + skills; require `/hooks` trust; measure long confirm chains at implement time. |
| **Runner** ports | Later | `runner` | External process loop; size `max iterations` ≥ worst-case review chain, or chunk work. |

`platforms` in `.autopilot/config.yml` lists enabled hosts (`id` + `surface`: `ide` \| `cli` \| `runner`). This build **only installs Cursor** wiring; listing future ids in config does not invent a missing port.

## Stop-loop caps (why ports matter)

Fix + multi-lens confirm needs many consecutive stop continuations. Each host has its own circuit breaker; ports must disable or raise it, or the chain stalls mid-confirm (pending followup left in DB).

| Host | Mechanism | Default | Autopilot mitigation |
|------|-----------|---------|----------------------|
| **Cursor** | `hooks.json` `loop_limit` on stop / subagentStop | `5` if omitted | `"loop_limit": null` on Autopilot stop; `doctor` WARNs if missing. |
| **Claude Code** | Stop block consecutive cap | **8** | `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0` (planned init). |
| **Codex** | Stop block + `reason` as next prompt; `stop_hook_active` | No documented numeric cap (2026-09 research) | **Planned** hook port + trust; measure chains when implementing. |
| **Runner** | External `max iterations` | Port-defined | Budget ≥ worst-case review chain. |

Submit / edit hooks (and Claude `UserPromptSubmit` analogues) are **not** subject to Cursor’s stop `loop_limit`.

## Not bridged (yet)

Host-native **Plan modes** (Cursor Plan Mode, Claude Code Plan mode, etc.) are separate from Autopilot grill and `review.scope`. Autopilot does not currently map those modes onto ON / RUN / review.

Design sketch and acceptance criteria for a future optional bridge: [host-plan-bridge.md](./host-plan-bridge.md).

## Related

- [Config](./config.md) — `platforms`, `review.*`, triggers, concurrency  
- [Troubleshooting](./troubleshooting.md) — missing `loop_limit`, double hooks  
- [Host Plan-mode bridge](./host-plan-bridge.md) — Plan UX vs Autopilot grill  
