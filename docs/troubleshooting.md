# Troubleshooting

Product front door: [README.md](../README.md). Config keys: [config.md](./config.md).

Run `doctor` from the **instrumented project** (`cwd` = that app):

```bash
node /path/to/autopilot-harness/packages/cli/dist/bin.js doctor
```

## Skills / hooks do not appear

1. Reload the host window (`Developer: Reload Window` in Cursor; restart / new session in Claude Code, Codex, Kimi Code, **Copilot CLI**, **Grok Build CLI**, **Gemini CLI**, **Factory Droid**, **Hermes Agent**, **Antigravity**, or **Pi**) or start a **new** Agent chat.
2. Confirm `init` / `upgrade` wrote hooks under the host config (e.g. `.cursor/hooks.json`, `.claude/settings.json`, `.codex/hooks.json`, Kimi Code user-home `config.toml`, Copilot `.github/hooks/autopilot-harness.json`, Grok `.grok/hooks/autopilot-harness.json`, Gemini `.gemini/settings.json`, Factory `.factory/hooks.json`, Hermes **`$HERMES_HOME/config.yaml`**, Antigravity **`.agents/hooks.json`**, or Pi **`.pi/extensions/autopilot.ts`**) and skills under the project skills path (`.cursor/skills/` / `.claude/skills/` / **`.agents/skills/`** for Codex/Kimi/Antigravity/Pi / **`.github/skills/`** for Copilot / **`.grok/skills/`** for Grok / **`.gemini/skills/`** / **`.factory/skills/`** / **`$HERMES_HOME/skills/`**).
3. Re-run `doctor`; fix FAIL lines before chasing WARN noise.

## Self-review stops mid-chain

Autopilot fix + multi-lens confirm needs **many consecutive** stop continuations.

### Cursor

Cursor’s default stop / `subagentStop` `loop_limit` is **5** if omitted.

- Autopilot **stop** entries must set `"loop_limit": null` (`init` / `upgrade` / `mergeHooksJson`).
- `doctor` WARNs when Autopilot **stop** is missing `loop_limit: null` — run `upgrade`.
- **0.17+:** Autopilot **`subagentStop`** also uses `"loop_limit": null`; `doctor` WARNs when that entry is missing null.
- Autopilot does **not** tell agents to open or avoid subagents. **0.17+ Tier-S:** if a subagent edits product code, `subagentStop` (when it fires) only **arms the parent** conversation; review still continues on **parent stop**. Background subagents may never emit `subagentStop` — parent stop **dirty-arm** is the fallback (see [hosts.md — Subagents](./hosts.md#subagents-neutral-policy--tiers)).
- Typing `continue` may reset some host counters; it is **not** a substitute for correct install.

### Claude Code

Claude’s consecutive Stop **block cap** defaults to **8**.

- Autopilot init / upgrade sets `env.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0` in `.claude/settings.json`.
- `doctor` WARNs when Claude is installed but the cap is missing or not `0`.
- **0.17+:** also installs **`SubagentStop`** (arm parent only; no continue); `doctor` WARNs when the Autopilot **`SubagentStop`** fingerprint is missing.
- Same **neutral** subagent policy as Cursor (Tier-S from **0.17**): host/agent decides; Autopilot keeps parent review coherent when events fire.
- Project `env` may need workspace **trust** before Claude applies it — if the cap never takes effect, accept the trust dialog for the project folder, then restart Claude / open a new session.
- Dual-host: after Cursor init, `npx @autopilot-harness/cli init --yes --add-platform claude-code`.

### Codex

Codex has **no documented numeric** consecutive Stop block cap (research snapshot 2026-09). Long confirm chains still need a healthy install:

- Autopilot init / upgrade writes `.codex/hooks.json` only (**not** `config.toml` hooks); PostToolUse matcher `apply_patch|Edit|Write`; **omit timeout** (default ~600s).
- `doctor` WARNs when Codex is enabled but Autopilot entries are missing, when `timeout` is set and **&lt; 120s**, and reminds **`/hooks` trust** (re-trust after hook definition changes).
- Stop continue shape is `{ decision: "block", reason }` — hard-stop may use `continue: false`; never `continue: false` to keep the chain going.
- Dual/triple-host: `npx @autopilot-harness/cli init --yes --add-platform codex`.
- P0 activation is **slash `/autopilot-*` or line-start** `triggers.on` / `triggers.run` (skills under **`.agents/skills/autopilot-*`**; no default `AGENTS.md`; typed slash still parses).

### Kimi Code

Kimi Code **hard-caps Stop-continue at ≤1/turn** — Autopilot ships a **degraded** port (do **not** expect confirm×5):

- Prefer `review.confirm_rounds: 1` (fresh init with installable `kimi-code` writes `1`; the hook **clamps** effective rounds to `1` **project-wide**, including Cursor / Claude / Codex / Copilot / Grok / Gemini / Factory / Hermes / Antigravity / Devin / Pi / Runner in the same config).
- Autopilot merges user-home `$KIMI_CODE_HOME/config.toml` (default `~/.kimi-code`; **not** legacy `~/.kimi`; **never** `local.toml`); Autopilot hook timeout **≥120s**. That file is **machine-wide** for the Kimi home — `init`/`uninstall` rewrite the Autopilot fingerprint block (cwd-relative hook command). **Trust:** only `init`/`upgrade`/`uninstall` from projects you trust — they mutate that user-home file. Treat `$KIMI_CODE_HOME` as a **trusted** path.
- Hook command is **cwd-relative** (`node .autopilot/bin/autopilot-harness-hook.mjs …`) — open/instrument the **project root** so Kimi’s cwd resolves the intended vendor binary (not another tree’s `.autopilot/`).
- `doctor` **FAIL**s when Kimi home / `config.toml` is a **symlink** or otherwise unreadable; WARNs for missing Autopilot entries, timeout &lt; 120s, Stop≤1/turn policy, and legacy `~/.kimi` without a Kimi Code home; reminds `/hooks` trust/reload when offered.
- Stop continue is **exit 2 + stderr** (not Claude JSON).
- Multi-host: `npx @autopilot-harness/cli init --yes --add-platform kimi-code` (expect confirm clamp to 1 afterward).
- P0 activation is **`/skill:autopilot-on`** (and sibling `/skill:autopilot-*`) **or line-start** `triggers.on` / `triggers.run` (skills under **`.agents/skills/autopilot-*`**; no default `AGENTS.md`; typed slash still parses via the submit hook).

### GitHub Copilot CLI

Copilot CLI **hard-caps consecutive `agentStop` `decision:"block"` at ≤8** (no raise/disable found) — Autopilot ships a **degraded** port:

- Expect mid-chain cutoffs on long confirm streaks. When the host cuts off, Autopilot may leave a **pending followup** in DB — continue with `/autopilot-resume` (or line-start RESUME) and/or a human nudge; do not assume Cursor/Claude long-RUN parity.
- Autopilot writes project `.github/hooks/autopilot-harness.json` (camelCase events; **bash+powershell**; timeoutSec **≥120**; `userPromptSubmitted` + `userPromptTransformed` + `postToolUse` + `agentStop`). Default `.autopilotignore` includes `.github/hooks/**` + `.github/skills/**`.
- **`userPromptSubmitted` stdout is ignored** by the host — needPick / busy / hard errors use **`userPromptTransformed`** (`modifiedTransformedPrompt`). Stop continue = `{ decision:"block", reason }`; hard-stop `{}`.
- **Does not** clamp `confirm_rounds` (unlike Kimi). Installs Autopilot skills under **`.github/skills/autopilot-*`** (no default `AGENTS.md`). Does **not** wire `preToolUse` / SubagentStop / `postToolUseFailure`.
- **Restart Copilot CLI** after `init` / `upgrade` so hooks reload.
- `doctor` **FAIL**s when `.github/hooks/autopilot-harness.json` is missing / unreadable / invalid shape, or Autopilot events are incomplete; WARNs for timeoutSec &lt; 120 (or omitted), Stop consecutive ≤8 policy, missing `--platform copilot-cli`, **Restart Copilot CLI**, and **Claude Code + Copilot CLI** dual fingerprints (both enabled or leftover hooks on disk).
- Multi-host: `npx @autopilot-harness/cli init --yes --add-platform copilot-cli`.
- P0 activation is **slash `/autopilot-*` or line-start** `triggers.on` / `triggers.run` (skills under **`.github/skills/autopilot-*`**; typed slash still parses).

### Grok Build CLI

Grok Build CLI **hard-caps Stop-continue at ≤8/turn** (counter **resets each user turn**; no raise found) — Autopilot ships a **degraded** port (do **not** copy Copilot’s consecutive model):

- Expect mid-chain cutoffs on long confirm streaks. When the host cuts off, Autopilot may leave a **pending followup** — continue with `/autopilot-resume` (or line-start RESUME) and/or a human nudge.
- Autopilot writes project `.grok/hooks/autopilot-harness.json` only (Codex-shaped; **timeout 120** always; UPS + PostToolUse + Stop; **omit matcher** on UPS/Stop). Default `.autopilotignore` includes `.grok/hooks/**` + `.grok/skills/**`.
- Stop continue = **`{ decision:"block", reason }` only** (no Stop `additionalContext` continue — would double-burn the 8). UPS allowing stdout is discarded — needPick / busy / hard errors use **UPS `decision:block` + reason** (re-submit with slug).
- **Does not** clamp `confirm_rounds`. Installs Autopilot skills under **`.grok/skills/autopilot-*`** (no default `AGENTS.md`). Does **not** wire PreToolUse / SubagentStop / StopFailure.
- **Trust** via `/hooks-trust` or `--trust` after `init` / `upgrade`; **reload / new session** after hook changes.
- Optional tip: if Grok also loads Claude/Cursor hooks via `compat.*.hooks`, set those to `false` in user config (Autopilot does **not** auto-edit `~/.grok/config.toml`).
- `doctor` **FAIL**s when `.grok/hooks/autopilot-harness.json` is missing / unreadable / invalid / incomplete; WARNs for timeout omitted or &lt; 120, **Stop ≤8/turn**, missing `--platform grok-build`, **trust**, reload/new session, and **Grok+Claude and/or Grok+Cursor** multi-fingerprints (both enabled or leftover hooks on disk).
- Multi-host: `npx @autopilot-harness/cli init --yes --add-platform grok-build`.
- P0 activation is **slash `/autopilot-*` or line-start** `triggers.on` / `triggers.run` (skills under **`.grok/skills/autopilot-*`**; typed slash still parses).

### Gemini CLI

Gemini CLI **hard-caps agent turns at host `MAX_TURNS` ≤100** (AfterAgent deny→retry shares that budget; no raise found) — Autopilot ships Gemini CLI with that honest ceiling (**Shipped**; not unlimited; prefer CLI **≥0.31.0** so retry still fires with `stop_hook_active`):

- AfterAgent continue = `{ decision:"deny", reason }` (multi-deny across `stop_hook_active`; hard-stop `continue:false` + optional `stopReason`; **never** `clearContext`). needPick / busy / hard errors use BeforeAgent **deny+reason** (re-submit with slug).
- Autopilot writes project **`.gemini/settings.json`** only (Claude-settings-merge style; **nested** matcher groups; timeout **120000** ms; BeforeAgent + AfterTool `write_file|replace` + AfterAgent). Default `.autopilotignore` includes **`.gemini/settings.json`**. Autopilot does **not** rewrite `hooksConfig`.
- **Does not** clamp `confirm_rounds`. Does **not** install Autopilot skills / `AGENTS.md`. Does **not** wire BeforeTool / BeforeModel / AfterModel / Session* / Notification / PreCompress.
- After `init` / `upgrade`: **re-trust** hooks, check **`/hooks panel`**, and ensure **folder trust**; **reload / new session**.
- `doctor` **FAIL**s when `.gemini/settings.json` is missing / unreadable / invalid / incomplete; WARNs for timeout omitted or &lt; 120000, AfterAgent cap ≤100, min-CLI ≥0.31.0, missing `--platform gemini-cli`, re-trust / `/hooks panel` / folder trust, reload/new session, `hooksConfig.enabled===false`, Autopilot names in `hooksConfig.disabled`, and **Gemini+Claude** dual fingerprints (both enabled or leftover on disk).
- Do **not** confuse host env **`GEMINI_PLANS_DIR`** with Autopilot `artifacts.plans_dir` / `plans/`.
- Multi-host: `npx @autopilot-harness/cli init --yes --add-platform gemini-cli`.
- P0 activation is **line-start** `triggers.on` / `triggers.run` (typed slash still parses).

### Factory Droid

Factory Droid has **no documented numeric Stop-continue cap / raise knob** (2026-09 research). Autopilot ships Factory with **multi-block under `stop_hook_active` live-proved** (**Shipped**). If live is **waived** or multi fails, flip to **degraded≤1** (ALLOW=false) and prefer short confirm chains:

- Stop continue = `{ decision:"block", reason }` (multi across `stop_hook_active`; hard-stop `continue:false` + `stopReason`; allow path **zero-byte stdout** — never `{}`).
- Autopilot writes project **`.factory/hooks.json` only** (**top-level** events; timeout **120**; UPS + PostToolUse `Create|Edit|ApplyPatch` + Stop). Commands use **`node "$FACTORY_PROJECT_DIR"/.autopilot/bin/…`**. **`$FACTORY_PROJECT_DIR` must be the instrumented project root** (host cwd ≠ repo root) — a wrong or hostile value runs another tree’s vendor binary; treat it as **trusted** project wiring. Default `.autopilotignore` includes **`.factory/hooks.json`**.
- **Does not** clamp `confirm_rounds` (when degraded≤1, docs recommend `confirm_rounds: 1`). Does **not** install Autopilot skills / `AGENTS.md`. Does **not** wire PreToolUse / SubagentStop / Session* / Notification.
- After `init` / `upgrade`: check **`/hooks`**, then **reload / new session** so the hooks **snapshot** refreshes.
- `init` / `upgrade` **refuse symlink** `.factory/` or `.factory/hooks.json` (**fail-closed**). `doctor` **FAIL**s when `.factory/hooks.json` is missing / incomplete / unreadable (incl. symlink); WARNs for no raise/hard-cap (live-proved multi-block), `/hooks`+snapshot/reload, missing `--platform factory-droid` or **`$FACTORY_PROJECT_DIR`** in commands, timeout omit/&lt;120, Factory+Claude dual fingerprints, `~/.factory` residual / `settings.json` hooks leftover, and `hooksDisabled` / `allowManagedHooksOnly`.
- Multi-host: `npx @autopilot-harness/cli init --yes --add-platform factory-droid`.
- P0 activation is **line-start** `triggers.on` / `triggers.run` (typed slash still parses).

### Hermes Agent

Hermes Agent shell `pre_verify` continue is **live-proved** (**Shipped**; soft min Hermes **≥0.21.3**). Autopilot uses Claude Stop shape `{ decision:"block", reason }` (Hermes maps to wire `action:continue`). Host default `agent.max_verify_nudges` is **3**; init raises to **≥32** (does not lower a higher user value). **`pre_verify` is edit-only** — no product edit that turn → pending / RESUME (`changed_paths` can still arm). If live is **waived**, ship **degraded** and the human gate must **explicitly acknowledge R1 unproven**:

- If nudge is still **3** (or the remaining budget is exhausted mid-confirm), or a **plugin-first** verify path burns nudges, the host may cut the Autopilot chain — expect a **pending followup** and recover with `/autopilot-resume` (or line-start RESUME) and/or a human nudge; do not assume Cursor/Claude long-RUN parity.
- Hooks live in **`$HERMES_HOME/config.yaml` only** (default `~/.hermes`; **never** `cli-config.yaml`; Autopilot stamps timeout **120** — **not** Codex-style “omit OK”; host default **60s** if omitted). Events: `pre_llm_call` + `post_tool_call` `write_file|patch` + `pre_verify`. That file is **machine-wide** for the Hermes home — `init`/`uninstall` rewrite the Autopilot fingerprint block (cwd-relative hook command; multi-repo). **Trust:** only `init`/`upgrade`/`uninstall` from projects you trust — they mutate that user-home file. Treat `$HERMES_HOME` as a **trusted** path. Stock **relative command**: `node .autopilot/bin/… --platform hermes-agent --event …` — open/instrument the **project root** so Hermes’s cwd resolves the intended vendor binary (not another tree’s `.autopilot/`).
- Allow / hard-stop = **`{}`** or empty stdout. Does **not** clamp `confirm_rounds`. Does **not** install Autopilot skills / `AGENTS.md`. Does **not** wire `pre_tool_call` / subagent* / session*.
- Consent: approve at TTY, or **`--accept-hooks` / `HERMES_ACCEPT_HOOKS`**; non-TTY unapproved hooks **skip silently**. After `init` / `upgrade`: reload Hermes and run **`hermes hooks doctor`**.
- `init` / `upgrade` **refuse symlink** `$HERMES_HOME` / `config.yaml` (**fail-closed**). `doctor` **FAIL**s on missing/incomplete fingerprint; WARNs timeout omit/&lt;120 (host default 60s), nudge missing/still **3**/&lt;32, consent/non-TTY, `HERMES_HOME`/multi-repo, Hermes+Claude dual fingerprints, edit-only, plugin-first, and `hermes hooks doctor`.
- Multi-host: `npx @autopilot-harness/cli init --yes --add-platform hermes-agent`.
- P0 activation is **line-start** `triggers.on` / `triggers.run` (typed slash still parses).

See [architecture.md](./architecture.md) (host stop-loop caps) and [hosts.md](./hosts.md).

## Double followup injection

If `review.scope` is **`project`** and you also run a **global** Cursor self-review hook (`~/.cursor`, e.g. `run-global-self-review`), both may inject on the same stop.

- Prefer **one** system: Autopilot alone, or disable the global hook.
- `doctor` WARNs when global self-review hooks are detected; init TUI warns when choosing `project`.

## Edited code but no self-review

Check in order:

1. **Paused / OFF** — `/autopilot-resume` (even with `project` scope).
2. **`review.scope`** — check `.autopilot/config.yml`. Fresh `init` writes **`project`** (any product-code edit). If the key is **missing / invalid**, runtime still loads **`executing_only`** (only during checklist **RUN**). Explicit `executing_only` is the same RUN-only gate.
3. **Path filters** — `.autopilotignore` hits, or **untracked** + `.gitignore`, do not count as product code.
4. **Shell / out-of-band writes** — if the host skipped `afterFileEdit`, stop still arms fix→confirm from **git-dirty product paths** (same filters as above). Dirt only under `.autopilotignore` / untracked-gitignore paths does **not** arm fix→confirm (soft evidence / `need_evidence` may still apply).
5. Host Plan modes (Cursor Plan Mode, etc.) are **not** bridged; they do not arm Autopilot review by themselves.

Soft missing-evidence idle may inject a **stuck** nudge after `review.stuck.max_idle_stops` while the session stays **armed** (no hard pause). Required verify failures that hit the same threshold still hard-pause (`paused_reason=stuck`); use `/autopilot-resume` (or line-start `Autopilot RESUME`) only when the session is actually paused.

## `/autopilot-on` alone never starts self-review

Planning writes `plans/<slug>/` (and may edit docs). Review starts only after a **product-code** edit that counts under `review.scope`. Details: [README](../README.md#when-does-self-review-run-reviewscope).

## Claim / resume surprises

- Resume clears pause and **keeps** the review chain; replan **resets** the review chain and returns to planning.
- New chat `/autopilot-resume` (optional `<slug>`) may **claim** an executing track onto this conversation (prefers unpaused; can fall back to a single paused executing session for dead-chat recovery) — then **this** chat owns the session; stop driving the same track from the old chat.
- See [quickstart](./autopilot/quickstart.md#pause--resume--replan).

## RUN blocked: another session executing

`one_executor` refuses a second **armed executing** session (`phase=executing`, `armed=1`, `paused=0`) — including a **Runner** conversation. A hook-host RUN and a Runner `start --run` **mutually block** under the same gate. Planning chats do **not** hold this lock.

1. Run `npx @autopilot-harness/cli status` — look for `executors:` (track + short session id).
2. In that chat: `/autopilot-off`, or from cwd: `npx @autopilot-harness/cli session purge <id>` (see `session list`). For Runner-only: stop the CLI loop / purge the `runner:…` session.
3. Retry `/autopilot-run` or `runner start`.

Cursor may show only opaque “Submission blocked”; the `user_message` body (track + session) is the intended reason when the host surfaces it.

## Stale sessions

`doctor` may WARN on sessions older than `session.stale_after_hours` (default 72). From the project cwd:

```bash
node /path/to/autopilot-harness/packages/cli/dist/bin.js session purge <id>
node /path/to/autopilot-harness/packages/cli/dist/bin.js doctor --prune-stale
```

### Antigravity

Antigravity Stop continue uses **`{ decision:"continue", reason }`** (**not** Claude `block`). **`fullyIdle !== true` → fail-open**. Host Stop continue is **live-proved** in **0.10.1** (`NO_TOOL_CALL` + `transcript_full.jsonl` + **`.agents/bin` shim**). Prefer a firing surface (CLI with project workspace mounted, e.g. `--add-dir`):

- Hooks: project **`.agents/hooks.json`** named `autopilot-harness` (PreInvocation + PostToolUse edit matcher + Stop; timeout **120**; **`.agents/bin` shim** → `../../.autopilot/bin/…` via `import.meta.url` — **not** bare `../.autopilot`). Skills: **`.agents/skills/autopilot-*`** (**does not write `.agent/`**). **Auto-attach ≠ Autopilot ON**.
- PreInvocation **has no prompt field** — triggers parse **`transcriptPath`** with a stateful cursor.
- After install/upgrade: **reload Antigravity / new session** (IDE hooks may stay silent until reload; prefer **CLI**).
- **CLI workspace:** mount the instrumented project (e.g. **`--add-dir`** / open the folder) or hooks may **not load** (`loaded 0`) — product tip, not a network/proxy issue.
- Gemini skills (if enabled): always **`.gemini/skills/autopilot-*`** even when Antigravity is also enabled — run **`/trust`** + **`/skills reload`**. Dual Antigravity+Gemini: both trees get `autopilot-*`.
- `doctor` **FAIL**s when `.agents/hooks.json` is missing / incomplete; WARNs missing `.agents/bin` shim (or legacy `.autopilot/bin`), timeout/cap/IDE+CLI workspace / missing skills / auto-attach tip.

### Devin CLI

**Devin CLI** is **Shipped** (**interactive CLI live Stop-continue ≥1× proved** + edit arm). **CLI only** — **do not** claim Desktop / cloud Devin / Cascade supported.

- Hooks: project **`.devin/hooks.v1.json` only** (top-level events; timeout **120**; **UserPromptSubmit** + **PostToolUse** + **Stop**); **does not write `.devin/config.json` hooks**.
- Stock command: `node "$DEVIN_PROJECT_DIR"/.autopilot/bin/autopilot-harness-hook.mjs --platform devin --event …` (**`$DEVIN_PROJECT_DIR` required** — host cwd ≠ repo root; **must be the instrumented project root** — wrong/hostile env runs another tree).
- Stop continue = **`{ decision:"block", reason }`** (allow path **zero-byte stdout**; fail-open **exit 0**). `stop_hook_active` / `stopHookActive` boolean `true` → `loopCount ≥ 1`.
- PostToolUse: anchored matcher `^(write|edit|apply_patch|notebook_edit)$` arms review; Post **ignores** `exec` (never blocks); **`exec` edits via Stop dirty-arm**.
- Skills: **`.devin/skills/autopilot-*`** (`triggers: [user]`; always write here; doctor WARNs dual with `.agents/skills`).
- Soft min Devin **≥3000.10.31** (doctor WARN when missing/below).
- After install/upgrade: check **`/hooks`**, then open a **new session**.
- Init/upgrade **refuse symlink** `.devin/` / hooks (**fail-closed**). Independent fingerprint — **do not** reuse Claude.
- Doctor **FAIL**s missing/incomplete fingerprint; WARNs timeout omit/&lt;120, no documented Stop raise/hard-cap, `/hooks`+reload, missing `$DEVIN_PROJECT_DIR`, Devin+Claude dual fingerprints, skills dual-open, **`-p` unproven** (interactive CLI is the formal surface), Desktop tip (not FAIL); WARNs leftover `.devin/hooks.v1.json` fingerprint when `devin` is not in `platforms`.
- Live: interactive CLI continue **≥1×** proved + edit arm yes (`plans/v0.15-devin/live-smoke-evidence.md`); aim ≥2× optional; **not** Desktop.

### Pi

**Pi** is **Shipped** (**interactive TUI live Stop-continue ≥1× proved**). Autopilot is an **in-process** TypeScript extension (not a shell `--platform pi` stamp — dispatch stays **eleven-way shell + Pi extension**).

- Extension: project **`.pi/extensions/autopilot.ts`** (init **direct-writes**; **never** `pi install`; PATH `pi` not required to write) loading **`.autopilot/bin/vendor/runtime.mjs`**.
- Events: **`input`** / **`before_agent_start`** (ON/RUN) / **`tool_result`** (`write`\|`edit` + dirty-arm) / **`agent_settled`** continue via **`sendMessage` + `followUp` + `triggerTurn`** (**R1:** inject only when pending followup).
- Skills: **shares `.agents/skills/autopilot-*`** with Antigravity (**does not** write Antigravity `hooks.json`).
- Soft min Pi **≥0.85.1** (doctor WARN when missing/below).
- After install/upgrade: **`/trust` then `/reload`**.
- **R10:** Autopilot surface = **interactive TUI only** — **`pi -p` / JSON / print unsupported**.
- Under **`one_executor`**, Pi + Runner cannot both hold an armed executing session.
- `doctor` **FAIL**s when the extension fingerprint is missing/incomplete (symlink / non-file → FAIL); WARNs soft min / trust+reload / R10; WARNs shared-skills dual when Pi+Antigravity; WARNs leftover `.pi/extensions/autopilot.ts` fingerprint when `pi` is not in `platforms`; Runner+Pi dual under **`one_executor`** uses the same Runner+hook-host WARN.
- Live: interactive TUI continue **≥1×** proved (`custom_message` / `autopilot-harness`) + edit arm yes (`plans/v0.14-pi/live-smoke-evidence.md`); aim ≥2× optional.

### Runner

**Runner** is **Shipped (meta)** — external CLI loop (`npx @autopilot-harness/cli runner start|status`), outside the eleven-way `--platform` hook stamp set (dispatch stays **eleven-way**). Planning-in-runner: **`runner start --on`** (optional **`--brief`** / **`--message`**); full oral grill is still better on a **hook** host.

- Set **`runner.command`** in `.autopilot/config.yml` (template may use `{prompt}` / `{prompt_file}`). **`{prompt_file}`** expands to a **file path** (CLI must read it); for `codex exec` / similar “PROMPT is text” CLIs use **`{prompt}`**. Treat command + `runner.env` as **trusted project config** (spawn with `shell: false`; `cwd` must stay in-project). Init writes **no** fake default — blank → `runner start` **FAIL**; `doctor` **WARN**s (not FAIL).
- **`--on` / `--brief` / `--message`:** `--brief` requires `--on`; `--on`∧`--run` and `--message`∧`--run` **FAIL**; empty `--message` **FAIL** (C4); `--message` only in planning (C2) and not while a pending tip is set (C5); re-`--on` clears leftover tip (C9). **`--brief`** text is **not** stored in session DB (first-turn prompt only). **C6:** planning `stopped` → exit **0**; `--run`/executing `stopped` → non-zero.
- Bare `runner start` with no pending/executing/**planning** session → start **FAIL** (pass `--on` or `--run [slug]`); doctor does **not** emit a line for that case.
- **`--run <slug>` says not runnable (paused)** while the checklist still has unchecked items: another session may still be **paused** on that track — **Autopilot RESUME** in *that* chat, or `session purge <id>`, then retry (a paused binding makes the track summary `paused` / non-runnable).
- **Paused** Runner session → `runner start` **FAIL**s (bare **and** `--run`, including bare `--run` with several other runnable tracks) even if a pending tip exists — unpause via Autopilot OFF/RESUME or session tools first; doctor does **not** emit a line for that case. (Paused is checked **before** needPick — exit **1**, not exit **2**.)
- Bad **`runner.cwd`** (outside project / missing / not a dir) or invalid **`runner.prompt_mode`** → start **FAIL** before bind (no dedicated doctor line). Explicit **`max_iterations` &lt;1** / non-integer → start **FAIL**; doctor may still **WARN** when the declared value is **&lt;8**.
- Bare `--run` (no slug) when **several** tracks are runnable → **needPick** (**exit 2** + candidate list); then pass `--run <slug>`. (A `--run` attempt opens `state.db` / may write a pending pick session — expected; **`armed=0`**, so it does **not** hold the **`one_executor`** lock.)
- Failed **resume without `--run`** (no session) and config/cwd/`prompt_mode`/`max_iterations` failures **before** the store opens do **not** create an empty `state.db` as a side effect. **`--on`** / **`--run`** open the store first — executing → `--on` **FAIL** does not spawn, but the db may already exist.
- `doctor` also **WARN**s when Runner + a hook host are both enabled under **`one_executor`** (dual armed executing cannot both hold the lock). A peer RUN / `runner start --run` that hits the live gate fails with the already-executing / **busy** message (**exit 1**), not needPick.
- Resume: with pending/executing/**planning** and **not paused**, `runner start` without `--run` continues (use `--message` for grill answers in planning); idle/nothing-to-resume → pass `--on` or `--run [slug]`; if **paused**, unpause first (then bare resume or `--run`).
- Under **`review.scope: project`**, planning edits to product code may still arm review (same lenses; not checklist advance until RUN).
- Live agent smoke may be **waived**; MockDriver / contract tests remain the hard ship gate. See [Hosts — Runner](./hosts.md#status) and [Config — Runner](./config.md#runner-external-loop).

