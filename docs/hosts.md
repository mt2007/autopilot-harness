# Hosts

Product front door: [README.md](../README.md). Stop-loop internals: [architecture.md](./architecture.md).

Autopilot separates **core** (FSM, SQLite, checklist, review) from **ports** (host adapters). **This build ships Cursor, Claude Code, Codex, Kimi Code, and GitHub Copilot CLI** (CLI + App share one Codex hook surface; Kimi is **degraded Stop≤1/turn**; Copilot is **degraded Stop consecutive ≤8** — no raise/disable found). Further hosts are on the [roadmap](#roadmap-not-shipped) below.

Installed hook commands stamp **`--platform <id>`** (e.g. `cursor` / `claude-code` / `codex` / `kimi-code` / `copilot-cli`) as the primary dispatch switch (**five-way** today). Vendor runtime exports **aliased** Codex, Kimi, and Copilot handlers (`handleCodexUserPromptSubmit` / `handleCodexPostToolUse` / `handleCodexStop` / `handleKimiUserPromptSubmit` / `handleKimiPostToolUse` / `handleKimiStop` / `handleCopilotUserPromptSubmit` / `handleCopilotUserPromptTransformed` / `handleCopilotPostToolUse` / `handleCopilotStop`) so they never collide with Claude’s bare names. Runtime still applies **universal abort** and a **payload conflict resolver** so IDE cross-fire (Cursor-shaped stdin on a Claude/Codex/Kimi/Copilot-stamped command) cannot recover into `decision:block`.

## Status

| Host | Status | Surface | Notes |
|------|--------|---------|-------|
| **Cursor** | **Shipped** (v0.1+) | `ide` (hooks) | Skills `/autopilot-*`, Stop / submit / edit hooks, vendored `runtime.mjs`. |
| **Claude Code** | **Shipped** (v0.2) | `cli` | Official hooks are **shared across terminal + IDE** (`surface: cli` ≠ CLI-only). Stop inject = `decision: "block"` + `reason`. Init sets `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0`. |
| **Codex** | **Shipped** (v0.3) | `cli` (hooks) | **Codex CLI and Codex App** share one port `@autopilot-harness/port-codex` (`.codex/hooks.json`; **not** `config.toml` hooks). PostToolUse matcher `apply_patch\|Edit\|Write`; **omit timeout** (Codex default ~600s; doctor WARNs if timeout set and &lt;120s). Stop continue = `{ decision:"block", reason }` (hard-stop may use `continue:false`; never `continue:false` to keep the chain going). Trust via `/hooks` (**re-trust** after hook definition change). **P0 activation = line-start `triggers.on` / `triggers.run`** (no Autopilot skills path; no default `AGENTS.md`; typed `/autopilot-*` still parses). `apply_patch`: parse paths from `tool_input.command` **and** keep dirty-arm backup. No StopFailure / SubagentStop. |
| **Kimi Code** | **Shipped** (v0.4) | `cli` (hooks) | `@autopilot-harness/port-kimi-code` — **degraded** Autopilot. Target **Kimi Code** (`~/.kimi-code/`, not legacy kimi-cli `~/.kimi/`). Hooks: user-home `config.toml` `[[hooks]]` (timeout ≥120s; **never** `local.toml`). Stop continue = **exit 2 + stderr** (not Claude JSON). **Host hard-caps Stop-continue at ≤1/turn** — prefer `confirm_rounds: 1` (init writes `1`; hook clamps to `1`). P0 = line-start `triggers.on` / `triggers.run` (no Autopilot skills / `AGENTS.md`; typed slash still parses). No SubagentStop / StopFailure. |
| **GitHub Copilot CLI** | **Shipped** (v0.5) | `cli` (hooks) | `@autopilot-harness/port-copilot-cli` — **degraded** Autopilot (**Stop consecutive ≤8**; no raise/disable found). Hooks: project `.github/hooks/autopilot-harness.json` (camelCase events; **bash+powershell**; timeoutSec ≥120; `userPromptSubmitted` + `userPromptTransformed` + `postToolUse` + `agentStop`). Stop continue = `{ decision:"block", reason }` (hard-stop `{}`). `userPromptSubmitted` stdout is ignored by the host — needPick/busy/hard errors use **Transform** (`modifiedTransformedPrompt`). PostToolUse matcher covers current edit tools + dirty-arm; **no** `preToolUse` / SubagentStop / `postToolUseFailure`. P0 = line-start `triggers.on` / `triggers.run` (no Autopilot skills / `AGENTS.md`). **Restart Copilot CLI** after install/upgrade. Doctor WARNs Claude+Copilot dual fingerprints (both enabled or leftover hooks on disk). Does **not** clamp `confirm_rounds` (unlike Kimi). Mid-chain cutoff may leave **pending followup** — use `/autopilot-resume` / line-start RESUME / human nudge. |
| **Runner** | Later | `runner` | Stub `@autopilot-harness/port-runner`. External process loop for hosts **without** stop-continue; size `max iterations` ≥ worst-case review chain, or chunk work. |

`platforms` in `.autopilot/config.yml` lists enabled hosts (`id` + `surface`: `ide` \| `cli` \| `runner`). This build installs **Cursor**, **Claude Code**, **Codex**, **Kimi Code**, and/or **GitHub Copilot CLI** when those bindings are present; listing other future ids in config does not invent a missing port. **Runner** (and other roadmap hosts) are roadmap markers only — `init` / `--add-platform` do **not** install them yet (stubs under `packages/ports/`). Multi-host among shipped hosts: `init --yes --add-platform <id>` after the first host is wired. **Concurrency note:** enabling installable `kimi-code` **clamps `review.confirm_rounds` to 1 for the whole project** (not only Kimi turns). Copilot does **not** clamp rounds. Kimi hooks live in **user-home** `config.toml` (default `~/.kimi-code` via `$KIMI_CODE_HOME`; **never** `local.toml`; cwd-relative `.autopilot/bin/…` command) — shared across projects on that machine; `init`/`uninstall` rewrite the Autopilot fingerprint block there (**trust:** only from projects you trust; symlink home/`config.toml` is refused). Copilot hooks live in **project** `.github/hooks/autopilot-harness.json` (default `.autopilotignore` includes `.github/hooks/**`).

## Roadmap (not shipped)

Autopilot needs three capabilities on a host: **prompt/submit** (ON/RUN), **edit/post-tool** (arm review), and **stop-continue** (inject the next fix/confirm followup). Hosts with **no** usable stop-continue belong under **Runner**. Future hosts with only a **hard-capped** stop-continue may still ship as a **degraded hook port** (same pattern as shipped Kimi ≤1/turn and Copilot consecutive ≤8) — document the cap; do not claim full multi-lens streaks.

### Recommended order

| Priority | Host | Fit | Why this order |
|---------:|------|-----|----------------|
| **1 (next)** | **Grok Build CLI** | High | Stop can keep the agent working; may load Claude/Cursor hook files. **Do not** assume Claude JSON output is honored — verify Grok’s top-level `decision` contract and whether `UserPromptSubmit` can inject / block. |
| **2** | **Gemini CLI** | High | Rich agent hooks (`BeforeAgent` / `AfterAgent` with retry/halt). Different event names than Claude — more adapter work, strong product reach. |
| **3** | **Factory Droid** | Medium–High | Project/user `.factory/hooks.json` (Claude-shaped events). Confirm Stop (or equivalent) can force another turn with a reason string. |
| **4** | **Hermes Agent** | Medium | Shell/plugin hooks; `pre_verify` accepts Claude Stop shape (`decision:"block"` + `reason`) as continue, capped by `agent.max_verify_nudges` (default **3**). Verify gate is edit-triggered — map carefully onto Autopilot’s always-on stop loop. |
| **5** | **Antigravity** | Medium | `.agents/hooks.json` / `~/.gemini/config/hooks.json` with `PreToolUse` / `PostToolUse` / `Stop`. Confirm Stop can **inject continue** (not observe-only) before committing a port. |
| **6** | **OpenCode** | Medium–Low | Extensibility is **plugin**-centric; first-party Stop-continue is weaker than Claude/Codex. Community Claude-compat plugins exist but are partial — prefer waiting for a stable first-party contract or use Runner. |
| **7** | **Runner** | Meta | Catch-all for hosts that cannot stop-continue (or when we want one external loop). Stub exists; ship after at least one more native hook port **or** when targeting a no-hooks host. |
| — | **Pi** | Research | In-process JS/TS hook factories / event bus — different packaging model than shell-stdin ports. |
| — | **Devin CLI** | Research / low | Cloud/agent product surface; local hook dogfood and durable project wiring are unclear. Prefer Runner or skip until a documented local hook API exists. |

Already covered (do **not** open separate tracks):

| Name in wishlist | Autopilot status |
|------------------|------------------|
| Claude Code | **Shipped** |
| Cursor | **Shipped** |
| Codex CLI | **Shipped** (same port as App) |
| Codex App | **Shipped** (same port as CLI) |
| Kimi Code | **Shipped** (degraded Stop≤1/turn) |
| GitHub Copilot CLI | **Shipped** (degraded Stop consecutive ≤8) |

## Stop-loop caps (why ports matter)

Fix + multi-lens confirm needs many consecutive stop continuations. Each host has its own circuit breaker; ports must disable or raise it **when possible**. If the host **hard-caps** continuations (e.g. Kimi ≤1 / turn, Copilot consecutive ≤8), ship **degraded** Autopilot (keep the stop streak short — for Kimi, recommend `confirm_rounds: 1`; for Copilot, expect mid-chain cutoffs and recover via pending / RESUME / nudge) — otherwise the chain stalls mid-confirm (pending followup left in DB).

| Host | Mechanism | Default | Autopilot mitigation |
|------|-----------|---------|----------------------|
| **Cursor** | `hooks.json` `loop_limit` on stop / subagentStop | `5` if omitted | `"loop_limit": null` on Autopilot stop; `doctor` WARNs if missing. |
| **Claude Code** | Stop block consecutive cap | **8** | Init / upgrade sets `env.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0` in `.claude/settings.json`; `doctor` WARNs when missing or not `0`. Project `env` may need workspace **trust** before Claude applies it. |
| **Codex** | Stop block + `reason` as next prompt; `stop_hook_active` | No documented numeric cap (2026-09 research) | **Shipped** hook port: `.codex/hooks.json` + `/hooks` trust (re-trust after changes); omit timeout or ≥120s. Measure long chains in live smoke when Codex is available. |
| **Kimi Code** | Blockable `Stop`; **≤1 continue / turn** (hard cap in agent-core) | Default hook timeout often **30s** | **Shipped** degraded port: timeout ≥120s; doctor WARN Stop-cap + short timeout; prefer `confirm_rounds: 1` (hook clamps to `1`). |
| **GitHub Copilot CLI** | `agentStop` `decision:"block"` + `reason`; consecutive block runaway guard | **8** consecutive blocks | **Shipped** degraded port: no raise found; doctor WARN ≤8 + **Restart Copilot CLI**; mid-cutoff → pending / `/autopilot-resume` / nudge. Does not clamp `confirm_rounds`. |
| **Runner** | External `max iterations` | Port-defined | Budget ≥ worst-case review chain. |

Submit / edit hooks (and Claude/Codex/Kimi/Copilot submit analogues — `UserPromptSubmit` / `userPromptSubmitted`) are **not** subject to Cursor’s stop `loop_limit`.

## Not bridged (yet)

Host-native **Plan modes** (Cursor Plan Mode, Claude Code Plan mode, etc.) are separate from Autopilot grill and `review.scope`. Autopilot does not currently map those modes onto ON / RUN / review. Codex `permission_mode: plan` is ignored by the port.

Design sketch and acceptance criteria for a future optional bridge: [host-plan-bridge.md](./host-plan-bridge.md).

## Related

- [Config](./config.md) — `platforms`, `review.*`, triggers, concurrency  
- [Troubleshooting](./troubleshooting.md) — missing `loop_limit` / `BLOCK_CAP`, Codex trust / timeout, Kimi Stop≤1/turn, Copilot Stop≤8 / restart / dual Claude+Copilot, double hooks  
- [Host Plan-mode bridge](./host-plan-bridge.md) — Plan UX vs Autopilot grill  
