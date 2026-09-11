# Hosts

Product front door: [README.md](../README.md). Stop-loop internals: [architecture.md](./architecture.md).

Autopilot separates **core** (FSM, SQLite, checklist, review) from **ports** (host adapters). **This build ships Cursor, Claude Code, and Codex**; Runner remains later.

Installed hook commands stamp **`--platform <id>`** (e.g. `cursor` / `claude-code` / `codex`) as the primary dispatch switch (**ternary**). Vendor runtime exports **aliased** Codex handlers (`handleCodexUserPromptSubmit` / `handleCodexPostToolUse` / `handleCodexStop`) so they never collide with Claude’s bare names. Runtime still applies **universal abort** and a **payload conflict resolver** so IDE cross-fire (Cursor-shaped stdin on a Claude/Codex-stamped command) cannot recover into `decision:block`.

## Status

| Host | Status | Surface | Notes |
|------|--------|---------|-------|
| **Cursor** | **Shipped** (v0.1+) | `ide` (hooks) | Skills `/autopilot-*`, Stop / submit / edit hooks, vendored `runtime.mjs`. |
| **Claude Code** | **Shipped** (v0.2) | `cli` | Official hooks are **shared across terminal + IDE** (`surface: cli` ≠ CLI-only). Stop inject = `decision: "block"` + `reason`. Init sets `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0`. |
| **Codex** | **Shipped** | `cli` (hooks) | Package `@autopilot-harness/port-codex`. Init: `.codex/hooks.json` only (**not** `config.toml` hooks); PostToolUse matcher `apply_patch\|Edit\|Write`; **omit timeout** (Codex default ~600s; doctor WARNs if timeout set and &lt;120s). Stop continue = `{ decision:"block", reason }` (hard-stop may use `continue:false`; never `continue:false` to keep the chain going). Trust via `/hooks` (**re-trust** after hook definition change). **P0 activation = line-start `triggers.on` / `triggers.run`** (no Autopilot skills path; no default `AGENTS.md`; typed `/autopilot-*` still parses). `apply_patch`: parse paths from `tool_input.command` **and** keep dirty-arm backup. No StopFailure / SubagentStop. |
| **Runner** ports | Later | `runner` | External process loop; size `max iterations` ≥ worst-case review chain, or chunk work. |

`platforms` in `.autopilot/config.yml` lists enabled hosts (`id` + `surface`: `ide` \| `cli` \| `runner`). This build installs **Cursor**, **Claude Code**, and/or **Codex** when those bindings are present; listing other future ids in config does not invent a missing port. Dual/triple-host: `init --yes --add-platform <id>` after the first host is wired.

## Stop-loop caps (why ports matter)

Fix + multi-lens confirm needs many consecutive stop continuations. Each host has its own circuit breaker; ports must disable or raise it, or the chain stalls mid-confirm (pending followup left in DB).

| Host | Mechanism | Default | Autopilot mitigation |
|------|-----------|---------|----------------------|
| **Cursor** | `hooks.json` `loop_limit` on stop / subagentStop | `5` if omitted | `"loop_limit": null` on Autopilot stop; `doctor` WARNs if missing. |
| **Claude Code** | Stop block consecutive cap | **8** | Init / upgrade sets `env.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0` in `.claude/settings.json`; `doctor` WARNs when missing or not `0`. Project `env` may need workspace **trust** before Claude applies it. |
| **Codex** | Stop block + `reason` as next prompt; `stop_hook_active` | No documented numeric cap (2026-09 research) | **Shipped** hook port: `.codex/hooks.json` + `/hooks` trust (re-trust after changes); omit timeout or ≥120s. Measure long chains in live smoke when Codex is available. |
| **Runner** | External `max iterations` | Port-defined | Budget ≥ worst-case review chain. |

Submit / edit hooks (and Claude/Codex `UserPromptSubmit` analogues) are **not** subject to Cursor’s stop `loop_limit`.

## Not bridged (yet)

Host-native **Plan modes** (Cursor Plan Mode, Claude Code Plan mode, etc.) are separate from Autopilot grill and `review.scope`. Autopilot does not currently map those modes onto ON / RUN / review. Codex `permission_mode: plan` is ignored by the port.

Design sketch and acceptance criteria for a future optional bridge: [host-plan-bridge.md](./host-plan-bridge.md).

## Related

- [Config](./config.md) — `platforms`, `review.*`, triggers, concurrency  
- [Troubleshooting](./troubleshooting.md) — missing `loop_limit` / `BLOCK_CAP`, Codex trust / timeout, double hooks  
- [Host Plan-mode bridge](./host-plan-bridge.md) — Plan UX vs Autopilot grill  
