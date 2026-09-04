# Hosts

Product front door: [README.md](../README.md). Stop-loop internals: [architecture.md](./architecture.md).

Autopilot separates **core** (FSM, SQLite, checklist, review) from **ports** (host adapters). **v0.2 ships Cursor and Claude Code**; Codex / Runner remain planned.

## Status

| Host | Status | Surface | Notes |
|------|--------|---------|-------|
| **Cursor** | **Shipped** (v0.1+) | `ide` (hooks) | Skills `/autopilot-*`, Stop / submit / edit hooks, vendored `runtime.mjs`. |
| **Claude Code** | **Shipped** (v0.2) | `cli` | Official hooks are **shared across terminal + IDE** (`surface: cli` ≠ CLI-only). Stop inject = `decision: "block"` + `reason`. Init sets `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0`. |
| **Codex** | **v0.3 / v0.4 planned** | hooks (not Runner-first) | `.codex/hooks.json` + skills; require `/hooks` trust; measure long confirm chains at implement time. |
| **Runner** ports | Later | `runner` | External process loop; size `max iterations` ≥ worst-case review chain, or chunk work. |

`platforms` in `.autopilot/config.yml` lists enabled hosts (`id` + `surface`: `ide` \| `cli` \| `runner`). This build installs **Cursor and/or Claude Code** when those bindings are present; listing future ids in config does not invent a missing port. Dual-host: `init --yes --add-platform claude-code` (or `cursor`) after the first host is wired.

## Stop-loop caps (why ports matter)

Fix + multi-lens confirm needs many consecutive stop continuations. Each host has its own circuit breaker; ports must disable or raise it, or the chain stalls mid-confirm (pending followup left in DB).

| Host | Mechanism | Default | Autopilot mitigation |
|------|-----------|---------|----------------------|
| **Cursor** | `hooks.json` `loop_limit` on stop / subagentStop | `5` if omitted | `"loop_limit": null` on Autopilot stop; `doctor` WARNs if missing. |
| **Claude Code** | Stop block consecutive cap | **8** | Init / upgrade sets `env.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0` in `.claude/settings.json`; `doctor` WARNs when missing or not `0`. Project `env` may need workspace **trust** before Claude applies it. |
| **Codex** | Stop block + `reason` as next prompt; `stop_hook_active` | No documented numeric cap (2026-09 research) | **Planned** hook port + trust; measure chains when implementing. |
| **Runner** | External `max iterations` | Port-defined | Budget ≥ worst-case review chain. |

Submit / edit hooks (and Claude `UserPromptSubmit` analogues) are **not** subject to Cursor’s stop `loop_limit`.

## Not bridged (yet)

Host-native **Plan modes** (Cursor Plan Mode, Claude Code Plan mode, etc.) are separate from Autopilot grill and `review.scope`. Autopilot does not currently map those modes onto ON / RUN / review.

Design sketch and acceptance criteria for a future optional bridge: [host-plan-bridge.md](./host-plan-bridge.md).

## Related

- [Config](./config.md) — `platforms`, `review.*`, triggers, concurrency  
- [Troubleshooting](./troubleshooting.md) — missing `loop_limit` / `BLOCK_CAP`, trust, double hooks  
- [Host Plan-mode bridge](./host-plan-bridge.md) — Plan UX vs Autopilot grill  
