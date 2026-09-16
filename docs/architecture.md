# Architecture

Product front door: English [README.md](../README.md) is authoritative.

Also: [CONTRIBUTING.md](../CONTRIBUTING.md) · [CHANGELOG.md](../CHANGELOG.md) · [Config](./config.md) · [Troubleshooting](./troubleshooting.md) · [Hosts](./hosts.md) · [Plan bridge](./host-plan-bridge.md).

Autopilot Harness separates **core** (FSM, SQLite, checklist, review) from **ports** (Cursor, Claude Code, Codex, Kimi Code, GitHub Copilot CLI, Grok Build CLI, Gemini CLI, Factory Droid, Hermes Agent, Antigravity, …).

Project config (`.autopilot/config.yml`) lists enabled hosts under `platforms:`
(`id` + `surface`: `ide` | `cli` | `runner`). Primary host is the first
installable binding in that list. Deprecated top-level `platform` / `surface`
scalars are still read as a fallback when `platforms` is missing; `init` /
`upgrade` stop writing them and strip them on refresh. Config may list multiple
`platforms`; **this build installs Cursor, Claude Code, Codex, Kimi Code, Copilot CLI, Grok Build CLI, Gemini CLI, Factory Droid, Hermes Agent, and/or Antigravity** when those
bindings are present (`cursor`/`ide`, `claude-code`/`cli`, `codex`/`cli`, `kimi-code`/`cli`, `copilot-cli`/`cli`, `grok-build`/`cli`, `gemini-cli`/`cli`, `factory-droid`/`cli`, `hermes-agent`/`cli`, `antigravity`/`cli`). Other ids are
reserved for future ports. For Claude, `surface: cli` means official hooks are
**shared across terminal + IDE** — not CLI-only. Codex also uses `surface: cli`
(project `.codex/hooks.json`; trust via `/hooks`). Kimi Code uses `surface: cli`
(user-home `config.toml` `[[hooks]]`; prefer `$KIMI_CODE_HOME` / `~/.kimi-code`; never `local.toml`).
Copilot CLI uses `surface: cli` (project `.github/hooks/autopilot-harness.json`; **Restart Copilot CLI** after install/upgrade). Grok Build CLI uses `surface: cli` (project `.grok/hooks/autopilot-harness.json`; **trust** via `/hooks-trust` or `--trust`; reload / new session after install/upgrade). Gemini CLI uses `surface: cli` (project `.gemini/settings.json`; **re-trust** / `/hooks panel` / **folder trust**; AfterAgent cap ≤100 / `MAX_TURNS`; prefer CLI ≥0.31.0). Factory Droid uses `surface: cli` (project `.factory/hooks.json`; **`$FACTORY_PROJECT_DIR`**; **`/hooks` + snapshot/reload**; multi-block under `stop_hook_active` live-proved). Hermes Agent uses `surface: cli` (**`$HERMES_HOME/config.yaml`**; relative command; `pre_verify` continue live-proved; nudge ≥32; consent/non-TTY; soft min ≥0.21.3; **waive → degraded + R1 ack**). Antigravity uses `surface: cli` (project **`.agents/hooks.json`** + **`.agents/skills`**; Stop `decision:continue`; PreInvocation via transcript; **degraded until host live / human gate**).

```
packages/core               StateStore, ReviewEngine, project-config, checklist, triggers
packages/ports/cursor       beforeSubmitPrompt / afterFileEdit / stop adapters
packages/ports/claude-code  UserPromptSubmit / PostToolUse / Stop / StopFailure adapters
packages/ports/codex        UserPromptSubmit / PostToolUse / Stop adapters (aliased handleCodex*)
packages/ports/kimi-code    UserPromptSubmit / PostToolUse / Stop adapters (aliased handleKimi*; Stop = exit 2 + stderr; degraded Stop≤1/turn)
packages/ports/copilot-cli  userPromptSubmitted / userPromptTransformed / postToolUse / agentStop (aliased handleCopilot*; Stop = decision:block+reason; degraded consecutive ≤8; no preToolUse)
packages/ports/grok-build   UserPromptSubmit / PostToolUse / Stop (aliased handleGrok*; Stop = decision:block+reason only; degraded ≤8/turn; no PreToolUse)
packages/ports/gemini-cli   BeforeAgent / AfterTool / AfterAgent (aliased handleGemini*; AfterAgent = decision:deny+reason; turn cap MAX_TURNS ≤100)
packages/ports/factory-droid UserPromptSubmit / PostToolUse / Stop (aliased handleFactory*; Stop = decision:block+reason; multi-block under stop_hook_active live-proved; empty allow stdout)
packages/ports/hermes-agent  pre_llm_call / post_tool_call / pre_verify (aliased handleHermes*; pre_verify = decision:block+reason live-proved; Silence {}; edit-only + changed_paths)
packages/ports/antigravity   PreInvocation / PostToolUse / Stop (aliased handleAntigravity*; Stop = decision:continue+reason; Silence {}; fullyIdle fail-open; PreInvocation via transcriptPath)
packages/cli                @autopilot-harness/cli (bin: autopilot-harness; npm public)
packages/i18n               en + zh-CN
packages/templates          skills (*.tpl) + planning/executing workflows
```

State lives in `.autopilot/state.db`. Progress authority is
`<plansDir>/<slug>/checklist.md` (YAML `artifacts.plans_dir`, default `plans/`).

`review.scope` in `.autopilot/config.yml`: **`project`** (init default) runs on any product-code edit without ON/RUN (idle/ambient or **planning** ends at review-complete, not checklist advance); **`executing_only`** runs fix→confirm only during Autopilot RUN. See README **When does self-review run?** and [Config](./config.md).

### Hook vendor runtime

The project Stop / submit / edit hooks load a **vendored** ESM bundle so consumer
repos do not need `@autopilot-harness/core` in `node_modules`:

1. **Source of truth (CLI package):** `packages/cli/assets/vendor/`
   - `runtime.mjs` — esbuild bundle of core + **Cursor, Claude Code, Codex, Kimi Code, Copilot CLI, Grok Build, Gemini CLI, Factory Droid, Hermes Agent, and Antigravity** ports (`pnpm bundle-vendor`; Codex/Kimi/Copilot/Grok/Gemini/Factory/Hermes/Antigravity handlers exported as `handleCodex*` / `handleKimi*` / `handleCopilot*` / `handleGrok*` / `handleGemini*` / `handleFactory*` / `handleHermes*` / `handleAntigravity*`)
   - `migrations/001_initial.sql` — schema the runtime applies on first open
2. **Installed into each project:** `.autopilot/bin/vendor/` (copied by `init` / `upgrade`)
3. **Entry:** `.autopilot/bin/autopilot-harness-hook.mjs` imports `./vendor/runtime.mjs` and dispatches by **`--platform <id>`** (when present; **ten-way** today) + host event + payload conflict resolver (cross-fire)

The vendor runtime reads `.autopilot/config.yml` on **stop** (`locale`,
`review.*`), on **edit** (`review.scope` + `artifacts.plans_dir`), and on
**submit** (built-in slash `/autopilot-on` … `/autopilot-replan`; YAML
`triggers.*` when a list has ≥1 non-blank phrase, else that key uses `DEFAULT_TRIGGERS`;
plus `artifacts.plans_dir`). Other init keys
(`concurrency.*`, `artifacts.files.*`, `security.require_token`, …) are
**not** loaded by the hook runtime yet — see [Config](./config.md) wiring table.
Commit order prefers migration then runtime so a torn
upgrade keeps a loadable (old runtime + new SQL) pair rather than the reverse.

Hostile-workspace I/O helpers live in `packages/cli/src/read-untrusted-file.ts`
(open/copy/replace) and `packages/cli/src/project-fs.ts` (mkdir / assert / package probes).

### Host followup / stop-loop caps (port gotcha)

Autopilot’s fix + multi-angle confirm routinely needs **many consecutive**
stop continuations in one streak. Each **host** enforces its own circuit
breaker; ports must disable or raise it **when possible**. If the host
**hard-caps** continuations **below a usable Autopilot review chain** (e.g. Kimi ≤1 / turn, Copilot consecutive ≤8, Grok ≤8 / turn), ship **degraded**
Autopilot (keep the stop streak short — for Kimi, recommend
`confirm_rounds: 1`; for Copilot/Grok, expect mid-chain cutoffs and recover via
pending followup / `/autopilot-resume` / human nudge) — otherwise the chain stalls mid-confirm (pending
followup left in DB). Caps that still cover worst-case fix+confirm (e.g. Gemini host **`MAX_TURNS` ≤100**) ship full Autopilot with an honest documented ceiling — not the degraded pattern.

| Host | Mechanism | Default | Autopilot mitigation |
| --- | --- | --- | --- |
| **Cursor** (shipped) | `hooks.json` `loop_limit` on **stop** / **subagentStop** | `5` if omitted | Write `"loop_limit": null` on Autopilot stop (`mergeHooksJson` / init / upgrade). `doctor` WARNs if missing. |
| **Claude Code** (v0.2 shipped) | Stop `decision: "block"` consecutive **block cap** | **8**; `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` (`0` disables) | Init writes `.claude/settings.json` hooks + `env.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0`; `doctor` WARNs when missing or not `0`. Workspace **trust** may gate project `env`. |
| **Codex** (shipped) | Stop `decision: "block"` + `reason` as next user prompt; `stop_hook_active` | No documented numeric block cap (2026-09 research) | **Shipped** hook port: `.codex/hooks.json` (omit timeout or ≥120s); `/hooks` trust + re-trust; P0 line-start `triggers.on` / `triggers.run` (no default skills/`AGENTS.md`; typed `/autopilot-*` still parses). |
| **Kimi Code** (shipped, degraded) | Blockable `Stop` → **≤1 continuation / turn** (host hard cap); continue via **exit 2 + stderr** | Hook timeout default often **30s** | **Shipped** `@autopilot-harness/port-kimi-code` as **degraded** Autopilot (prefer `confirm_rounds: 1`; hook clamps to `1`). Raise timeout ≥120s. Roadmap hosts: [hosts.md](./hosts.md#roadmap-not-shipped). |
| **GitHub Copilot CLI** (shipped, degraded) | `agentStop` `decision:"block"` + `reason`; consecutive runaway guard | **8** consecutive blocks | **Shipped** `@autopilot-harness/port-copilot-cli` as **degraded** (no raise found). `userPromptSubmitted` stdout ignored — Transform carries needPick/busy. No `preToolUse`. Doctor WARN ≤8 + Restart CLI + Claude+Copilot dual (enabled or leftover). Mid-cutoff → pending / RESUME / nudge. |
| **Grok Build CLI** (shipped, degraded) | `Stop` `decision:"block"` + `reason` only; **≤8/turn** (per-turn reset; not consecutive) | **8** / turn | **Shipped** `@autopilot-harness/port-grok-build` as **degraded** (no raise found). No Stop `additionalContext` continue. UPS needPick/busy via UPS block. Doctor WARN ≤8/turn + trust + Grok+Claude/Cursor dual (enabled or leftover). Mid-cutoff → pending / RESUME / nudge. No PreToolUse. |
| **Gemini CLI** (shipped) | AfterAgent `decision:"deny"` + `reason`; host **`MAX_TURNS`** | **100** turns | **Shipped** `@autopilot-harness/port-gemini-cli` with honest ceiling (no raise). Prefer CLI **≥0.31.0**. Re-trust / `/hooks panel` / folder trust. Doctor WARN cap + min-CLI + `hooksConfig`. Does not clamp `confirm_rounds`. No BeforeTool / Session*. |
| **Factory Droid** (shipped) | Stop `decision:"block"` + `reason`; `stop_hook_active` | No documented numeric cap (2026-09 research); multi under active **live-proved** | **Shipped** `@autopilot-harness/port-factory-droid` multi-block (no raise). Commands use **`$FACTORY_PROJECT_DIR`**. **`/hooks` + snapshot/reload**. Doctor WARN no raise/hard-cap + Factory+Claude dual. **Waive live → degraded≤1**. Does not clamp `confirm_rounds`. No PreToolUse / Session*. |
| **Hermes Agent** (shipped) | Shell `pre_verify` `decision:"block"` + `reason` | Default nudge **3**; init **≥32** | **Shipped** `@autopilot-harness/port-hermes-agent` R1 live-proved. **`$HERMES_HOME/config.yaml`**; relative command; edit-only + `changed_paths`; consent/non-TTY; soft min **≥0.21.3**. If nudge still **3** / exhausted (or plugin-first) → mid-cutoff → pending / RESUME / nudge. **Waive → degraded + R1 ack**. Does not clamp `confirm_rounds`. No `pre_tool_call`. |
| **Antigravity** (shipped, degraded) | Stop `decision:"continue"` + `reason`; `fullyIdle` gate | No documented numeric cap | **Shipped (degraded)** `@autopilot-harness/port-antigravity` until host live prove. **`.agents/hooks.json`** + **`.agents/skills`**; PreInvocation via transcript; IDE may stay silent. **Human gate / re-live before 0.10**. Does not clamp `confirm_rounds`. |
| **Runner** (later) | External process loop `max iterations` | Port-defined | Size the runner budget ≥ worst-case review chain, or chunk work. For hosts without stop continuation only. |

`beforeSubmitPrompt` / `afterFileEdit` (and Claude/Codex/Kimi/Copilot/Grok/Gemini/Factory/Hermes/Antigravity submit analogues —
`UserPromptSubmit` / `userPromptSubmitted` / `BeforeAgent` / `pre_llm_call` / `PreInvocation`)
are **not** subject to Cursor’s stop `loop_limit`; they do not emit Autopilot
followup loops.

A human nudge (e.g. typing `continue`) may reset some host counters but is **not** a
substitute for correct port install. Global Cursor self-review hooks that inject
on every stop typically use `loop_limit: null` for this reason.

Review-chain FSM (fix → confirm lenses → advance/done, OFF/ON/RESUME/REPLAN side effects) lives in `packages/core` (`ReviewEngine`). Host port status and stop-loop caps: [hosts.md](./hosts.md). User-facing triggers: [quickstart](./autopilot/quickstart.md).
