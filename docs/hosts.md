# Hosts

Product front door: [README.md](../README.md). Stop-loop internals: [architecture.md](./architecture.md).

Autopilot separates **core** (FSM, SQLite, checklist, review) from **ports** (host adapters). **This build ships Cursor, Claude Code, and Codex** (CLI + App share one Codex hook surface). Further hosts are on the [roadmap](#roadmap-not-shipped) below.

Installed hook commands stamp **`--platform <id>`** (e.g. `cursor` / `claude-code` / `codex`) as the primary dispatch switch (**ternary** today). Vendor runtime exports **aliased** Codex handlers (`handleCodexUserPromptSubmit` / `handleCodexPostToolUse` / `handleCodexStop`) so they never collide with Claude’s bare names. Runtime still applies **universal abort** and a **payload conflict resolver** so IDE cross-fire (Cursor-shaped stdin on a Claude/Codex-stamped command) cannot recover into `decision:block`.

## Status

| Host | Status | Surface | Notes |
|------|--------|---------|-------|
| **Cursor** | **Shipped** (v0.1+) | `ide` (hooks) | Skills `/autopilot-*`, Stop / submit / edit hooks, vendored `runtime.mjs`. |
| **Claude Code** | **Shipped** (v0.2) | `cli` | Official hooks are **shared across terminal + IDE** (`surface: cli` ≠ CLI-only). Stop inject = `decision: "block"` + `reason`. Init sets `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0`. |
| **Codex** | **Shipped** (v0.3) | `cli` (hooks) | **Codex CLI and Codex App** share one port `@autopilot-harness/port-codex` (`.codex/hooks.json`; **not** `config.toml` hooks). PostToolUse matcher `apply_patch\|Edit\|Write`; **omit timeout** (Codex default ~600s; doctor WARNs if timeout set and &lt;120s). Stop continue = `{ decision:"block", reason }` (hard-stop may use `continue:false`; never `continue:false` to keep the chain going). Trust via `/hooks` (**re-trust** after hook definition change). **P0 activation = line-start `triggers.on` / `triggers.run`** (no Autopilot skills path; no default `AGENTS.md`; typed `/autopilot-*` still parses). `apply_patch`: parse paths from `tool_input.command` **and** keep dirty-arm backup. No StopFailure / SubagentStop. |
| **Kimi Code** | **Next** (planned → v0.4) | `cli` (hooks) | Stub `@autopilot-harness/port-kimi-code`. Target **Kimi Code** (`~/.kimi-code/`, not legacy kimi-cli `~/.kimi/`). Hooks: user-home `config.toml` `[[hooks]]`. **Host hard-caps Stop-continue at 1 per turn** (agent-core) — planned Autopilot port is **degraded** (recommend `confirm_rounds: 1`; do not claim Claude-parity confirm×N). |
| **Runner** | Later | `runner` | Stub `@autopilot-harness/port-runner`. External process loop for hosts **without** stop-continue; size `max iterations` ≥ worst-case review chain, or chunk work. |

`platforms` in `.autopilot/config.yml` lists enabled hosts (`id` + `surface`: `ide` \| `cli` \| `runner`). This build installs **Cursor**, **Claude Code**, and/or **Codex** when those bindings are present; listing other future ids in config does not invent a missing port. **Kimi Code** and **Runner** rows above are roadmap markers only — `init` / `--add-platform` do **not** install them yet (stubs under `packages/ports/`). Dual/triple-host among shipped hosts: `init --yes --add-platform <id>` after the first host is wired.

## Roadmap (not shipped)

Autopilot needs three capabilities on a host: **prompt/submit** (ON/RUN), **edit/post-tool** (arm review), and **stop-continue** (inject the next fix/confirm followup). Hosts with **no** usable stop-continue belong under **Runner**. Hosts with only a **hard-capped** stop-continue (e.g. Kimi Code ≤1 / turn) may still ship as a **degraded hook port** — document the cap; do not claim full multi-lens streaks.

### Recommended order

| Priority | Host | Fit | Why this order |
|---------:|------|-----|----------------|
| **1 (next)** | **Kimi Code** | High* | Stub + Claude-like events; **\*** Stop-continue **hard-capped at 1/turn** in current Kimi Code source — ship as **degraded** port (`confirm_rounds: 1`), not full multi-lens streak. Prefer Kimi Code home `~/.kimi-code`, not legacy `~/.kimi`. |
| **2** | **GitHub Copilot CLI** | High | `agentStop` supports `{ decision:"block", reason }` + `stop_hook_active`; runaway guard ≈ **8** consecutive blocks (same class of problem as Claude `BLOCK_CAP` — need a raise/disable path or document chunking). Large audience. |
| **3** | **Grok Build CLI** | High | Stop can keep the agent working; may load Claude/Cursor hook files. **Do not** assume Claude JSON output is honored — verify Grok’s top-level `decision` contract and whether `UserPromptSubmit` can inject / block. |
| **4** | **Gemini CLI** | High | Rich agent hooks (`BeforeAgent` / `AfterAgent` with retry/halt). Different event names than Claude — more adapter work, strong product reach. |
| **5** | **Factory Droid** | Medium–High | Project/user `.factory/hooks.json` (Claude-shaped events). Confirm Stop (or equivalent) can force another turn with a reason string. |
| **6** | **Hermes Agent** | Medium | Shell/plugin hooks; `pre_verify` accepts Claude Stop shape (`decision:"block"` + `reason`) as continue, capped by `agent.max_verify_nudges` (default **3**). Verify gate is edit-triggered — map carefully onto Autopilot’s always-on stop loop. |
| **7** | **Antigravity** | Medium | `.agents/hooks.json` / `~/.gemini/config/hooks.json` with `PreToolUse` / `PostToolUse` / `Stop`. Confirm Stop can **inject continue** (not observe-only) before committing a port. |
| **8** | **OpenCode** | Medium–Low | Extensibility is **plugin**-centric; first-party Stop-continue is weaker than Claude/Codex. Community Claude-compat plugins exist but are partial — prefer waiting for a stable first-party contract or use Runner. |
| **9** | **Runner** | Meta | Catch-all for hosts that cannot stop-continue (or when we want one external loop). Stub exists; ship after at least one more native hook port **or** when targeting a no-hooks host. |
| — | **Pi** | Research | In-process JS/TS hook factories / event bus — different packaging model than shell-stdin ports. |
| — | **Devin CLI** | Research / low | Cloud/agent product surface; local hook dogfood and durable project wiring are unclear. Prefer Runner or skip until a documented local hook API exists. |

Already covered (do **not** open separate tracks):

| Name in wishlist | Autopilot status |
|------------------|------------------|
| Claude Code | **Shipped** |
| Cursor | **Shipped** |
| Codex CLI | **Shipped** (same port as App) |
| Codex App | **Shipped** (same port as CLI) |

## Stop-loop caps (why ports matter)

Fix + multi-lens confirm needs many consecutive stop continuations. Each host has its own circuit breaker; ports must disable or raise it **when possible**. If the host **hard-caps** continuations (e.g. Kimi ≤1 / turn), ship **degraded** Autopilot (keep the stop streak short — for Kimi, recommend `confirm_rounds: 1`) — otherwise the chain stalls mid-confirm (pending followup left in DB).

| Host | Mechanism | Default | Autopilot mitigation |
|------|-----------|---------|----------------------|
| **Cursor** | `hooks.json` `loop_limit` on stop / subagentStop | `5` if omitted | `"loop_limit": null` on Autopilot stop; `doctor` WARNs if missing. |
| **Claude Code** | Stop block consecutive cap | **8** | Init / upgrade sets `env.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0` in `.claude/settings.json`; `doctor` WARNs when missing or not `0`. Project `env` may need workspace **trust** before Claude applies it. |
| **Codex** | Stop block + `reason` as next prompt; `stop_hook_active` | No documented numeric cap (2026-09 research) | **Shipped** hook port: `.codex/hooks.json` + `/hooks` trust (re-trust after changes); omit timeout or ≥120s. Measure long chains in live smoke when Codex is available. |
| **Kimi Code** (planned) | Blockable `Stop`; **≤1 continue / turn** (hard cap in agent-core) | Default hook timeout often **30s** | Planned degraded port: timeout ≥120s; doctor WARN Stop-cap + short timeout; recommend `confirm_rounds: 1`. |
| **GitHub Copilot CLI** (planned) | `agentStop` `decision:"block"` + `reason` | **8** consecutive blocks | Find raise/disable or document confirm_rounds ≤ guard; use `stop_hook_active`. |
| **Runner** | External `max iterations` | Port-defined | Budget ≥ worst-case review chain. |

Submit / edit hooks (and Claude/Codex `UserPromptSubmit` analogues) are **not** subject to Cursor’s stop `loop_limit`.

## Not bridged (yet)

Host-native **Plan modes** (Cursor Plan Mode, Claude Code Plan mode, etc.) are separate from Autopilot grill and `review.scope`. Autopilot does not currently map those modes onto ON / RUN / review. Codex `permission_mode: plan` is ignored by the port.

Design sketch and acceptance criteria for a future optional bridge: [host-plan-bridge.md](./host-plan-bridge.md).

## Related

- [Config](./config.md) — `platforms`, `review.*`, triggers, concurrency  
- [Troubleshooting](./troubleshooting.md) — missing `loop_limit` / `BLOCK_CAP`, Codex trust / timeout, double hooks  
- [Host Plan-mode bridge](./host-plan-bridge.md) — Plan UX vs Autopilot grill  
