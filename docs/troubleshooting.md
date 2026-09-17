# Troubleshooting

Product front door: [README.md](../README.md). Config keys: [config.md](./config.md).

Run `doctor` from the **instrumented project** (`cwd` = that app):

```bash
node /path/to/autopilot-harness/packages/cli/dist/bin.js doctor
```

## Skills / hooks do not appear

1. Reload the host window (`Developer: Reload Window` in Cursor; restart / new session in Claude Code, Codex, Kimi Code, **Copilot CLI**, **Grok Build CLI**, **Gemini CLI**, **Factory Droid**, **Hermes Agent**, or **Antigravity**) or start a **new** Agent chat.
2. Confirm `init` / `upgrade` wrote hooks under the host config (e.g. `.cursor/hooks.json`, `.claude/settings.json`, `.codex/hooks.json`, Kimi Code user-home `config.toml`, Copilot `.github/hooks/autopilot-harness.json`, Grok `.grok/hooks/autopilot-harness.json`, Gemini `.gemini/settings.json`, Factory `.factory/hooks.json`, Hermes **`$HERMES_HOME/config.yaml`**, or Antigravity **`.agents/hooks.json`**) and skills under the project skills path where applicable (`.cursor/skills/` / `.claude/skills/` / **`.agents/skills/`** / **`.gemini/skills/`** / **`.factory/skills/`** / **`$HERMES_HOME/skills/`** — Codex / Kimi / Copilot / Grok have no Autopilot skills path).
3. Re-run `doctor`; fix FAIL lines before chasing WARN noise.

## Self-review stops mid-chain

Autopilot fix + multi-lens confirm needs **many consecutive** stop continuations.

### Cursor

Cursor’s default stop `loop_limit` is **5** if omitted.

- Autopilot stop entries must set `"loop_limit": null` (`init` / `upgrade` / `mergeHooksJson`).
- `doctor` WARNs when Autopilot stop is missing `loop_limit: null` — run `upgrade`.
- Typing `continue` may reset some host counters; it is **not** a substitute for correct install.

### Claude Code

Claude’s consecutive Stop **block cap** defaults to **8**.

- Autopilot init / upgrade sets `env.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0` in `.claude/settings.json`.
- `doctor` WARNs when Claude is installed but the cap is missing or not `0`.
- Project `env` may need workspace **trust** before Claude applies it — if the cap never takes effect, accept the trust dialog for the project folder, then restart Claude / open a new session.
- Dual-host: after Cursor init, `npx @autopilot-harness/cli init --yes --add-platform claude-code`.

### Codex

Codex has **no documented numeric** consecutive Stop block cap (research snapshot 2026-09). Long confirm chains still need a healthy install:

- Autopilot init / upgrade writes `.codex/hooks.json` only (**not** `config.toml` hooks); PostToolUse matcher `apply_patch|Edit|Write`; **omit timeout** (default ~600s).
- `doctor` WARNs when Codex is enabled but Autopilot entries are missing, when `timeout` is set and **&lt; 120s**, and reminds **`/hooks` trust** (re-trust after hook definition changes).
- Stop continue shape is `{ decision: "block", reason }` — hard-stop may use `continue: false`; never `continue: false` to keep the chain going.
- Dual/triple-host: `npx @autopilot-harness/cli init --yes --add-platform codex`.
- P0 activation is **line-start** `triggers.on` / `triggers.run` (no Autopilot Codex skills; no default `AGENTS.md`; typed slash still parses).

### Kimi Code

Kimi Code **hard-caps Stop-continue at ≤1/turn** — Autopilot ships a **degraded** port (do **not** expect confirm×5):

- Prefer `review.confirm_rounds: 1` (fresh init with installable `kimi-code` writes `1`; the hook **clamps** effective rounds to `1` **project-wide**, including Cursor / Claude / Codex / Copilot / Grok / Gemini / Factory / Hermes / Antigravity in the same config).
- Autopilot merges user-home `$KIMI_CODE_HOME/config.toml` (default `~/.kimi-code`; **not** legacy `~/.kimi`; **never** `local.toml`); Autopilot hook timeout **≥120s**. That file is **machine-wide** for the Kimi home — `init`/`uninstall` rewrite the Autopilot fingerprint block (cwd-relative hook command). **Trust:** only `init`/`upgrade`/`uninstall` from projects you trust — they mutate that user-home file. Treat `$KIMI_CODE_HOME` as a **trusted** path.
- Hook command is **cwd-relative** (`node .autopilot/bin/autopilot-harness-hook.mjs …`) — open/instrument the **project root** so Kimi’s cwd resolves the intended vendor binary (not another tree’s `.autopilot/`).
- `doctor` **FAIL**s when Kimi home / `config.toml` is a **symlink** or otherwise unreadable; WARNs for missing Autopilot entries, timeout &lt; 120s, Stop≤1/turn policy, and legacy `~/.kimi` without a Kimi Code home; reminds `/hooks` trust/reload when offered.
- Stop continue is **exit 2 + stderr** (not Claude JSON).
- Multi-host: `npx @autopilot-harness/cli init --yes --add-platform kimi-code` (expect confirm clamp to 1 afterward).
- P0 activation is **line-start** `triggers.on` / `triggers.run` (no Autopilot Kimi skills; no default `AGENTS.md`; typed slash still parses).

### GitHub Copilot CLI

Copilot CLI **hard-caps consecutive `agentStop` `decision:"block"` at ≤8** (no raise/disable found) — Autopilot ships a **degraded** port:

- Expect mid-chain cutoffs on long confirm streaks. When the host cuts off, Autopilot may leave a **pending followup** in DB — continue with `/autopilot-resume` (or line-start RESUME) and/or a human nudge; do not assume Cursor/Claude long-RUN parity.
- Autopilot writes project `.github/hooks/autopilot-harness.json` (camelCase events; **bash+powershell**; timeoutSec **≥120**; `userPromptSubmitted` + `userPromptTransformed` + `postToolUse` + `agentStop`). Default `.autopilotignore` includes `.github/hooks/**`.
- **`userPromptSubmitted` stdout is ignored** by the host — needPick / busy / hard errors use **`userPromptTransformed`** (`modifiedTransformedPrompt`). Stop continue = `{ decision:"block", reason }`; hard-stop `{}`.
- **Does not** clamp `confirm_rounds` (unlike Kimi). Does **not** install Autopilot skills / `AGENTS.md`. Does **not** wire `preToolUse` / SubagentStop / `postToolUseFailure`.
- **Restart Copilot CLI** after `init` / `upgrade` so hooks reload.
- `doctor` **FAIL**s when `.github/hooks/autopilot-harness.json` is missing / unreadable / invalid shape, or Autopilot events are incomplete; WARNs for timeoutSec &lt; 120 (or omitted), Stop consecutive ≤8 policy, missing `--platform copilot-cli`, **Restart Copilot CLI**, and **Claude Code + Copilot CLI** dual fingerprints (both enabled or leftover hooks on disk).
- Multi-host: `npx @autopilot-harness/cli init --yes --add-platform copilot-cli`.
- P0 activation is **line-start** `triggers.on` / `triggers.run` (typed slash still parses).

### Grok Build CLI

Grok Build CLI **hard-caps Stop-continue at ≤8/turn** (counter **resets each user turn**; no raise found) — Autopilot ships a **degraded** port (do **not** copy Copilot’s consecutive model):

- Expect mid-chain cutoffs on long confirm streaks. When the host cuts off, Autopilot may leave a **pending followup** — continue with `/autopilot-resume` (or line-start RESUME) and/or a human nudge.
- Autopilot writes project `.grok/hooks/autopilot-harness.json` only (Codex-shaped; **timeout 120** always; UPS + PostToolUse + Stop; **omit matcher** on UPS/Stop). Default `.autopilotignore` includes `.grok/hooks/**`.
- Stop continue = **`{ decision:"block", reason }` only** (no Stop `additionalContext` continue — would double-burn the 8). UPS allowing stdout is discarded — needPick / busy / hard errors use **UPS `decision:block` + reason** (re-submit with slug).
- **Does not** clamp `confirm_rounds`. Does **not** install Autopilot skills / `AGENTS.md`. Does **not** wire PreToolUse / SubagentStop / StopFailure.
- **Trust** via `/hooks-trust` or `--trust` after `init` / `upgrade`; **reload / new session** after hook changes.
- Optional tip: if Grok also loads Claude/Cursor hooks via `compat.*.hooks`, set those to `false` in user config (Autopilot does **not** auto-edit `~/.grok/config.toml`).
- `doctor` **FAIL**s when `.grok/hooks/autopilot-harness.json` is missing / unreadable / invalid / incomplete; WARNs for timeout omitted or &lt; 120, **Stop ≤8/turn**, missing `--platform grok-build`, **trust**, reload/new session, and **Grok+Claude and/or Grok+Cursor** multi-fingerprints (both enabled or leftover hooks on disk).
- Multi-host: `npx @autopilot-harness/cli init --yes --add-platform grok-build`.
- P0 activation is **line-start** `triggers.on` / `triggers.run` (typed slash still parses).

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

`one_executor` refuses a second **armed executing** session (`phase=executing`, `armed=1`, `paused=0`). Planning chats do **not** hold this lock.

1. Run `npx @autopilot-harness/cli status` — look for `executors:` (track + short session id).
2. In that chat: `/autopilot-off`, or from cwd: `npx @autopilot-harness/cli session purge <id>` (see `session list`).
3. Retry `/autopilot-run`.

Cursor may show only opaque “Submission blocked”; the `user_message` body (track + session) is the intended reason when the host surfaces it.

## Stale sessions

`doctor` may WARN on sessions older than `session.stale_after_hours` (default 72). From the project cwd:

```bash
node /path/to/autopilot-harness/packages/cli/dist/bin.js session purge <id>
node /path/to/autopilot-harness/packages/cli/dist/bin.js doctor --prune-stale
```

### Antigravity

Antigravity Stop continue uses **`{ decision:"continue", reason }`** (**not** Claude `block`). **`fullyIdle !== true` → fail-open**. Host live Stop-continue is **unproven** on the v0.10 dogfood machine (CLI OAuth-blocked) — Autopilot marks Antigravity **Shipped (degraded)** until a firing surface proves ≥1× continue + edit arm, **or** human gate explicitly accepts degraded before publishing **0.10**:

- Hooks: project **`.agents/hooks.json`** named `autopilot-harness` (PreInvocation + PostToolUse edit matcher + Stop; timeout **120**; **`.agents/bin` shim** → `../../.autopilot/bin/…` via `import.meta.url` — **not** bare `../.autopilot`). Skills: **`.agents/skills/autopilot-*`** (**does not write `.agent/`**). **Auto-attach ≠ Autopilot ON**.
- PreInvocation **has no prompt field** — triggers parse **`transcriptPath`** with a stateful cursor.
- After install/upgrade: **reload Antigravity / new session** (IDE hooks may stay silent until reload; prefer **CLI**).
- **CLI workspace:** mount the instrumented project (e.g. **`--add-dir`** / open the folder) or hooks may **not load** (`loaded 0`) — product tip, not a network/proxy issue.
- Gemini skills (if enabled): always **`.gemini/skills/autopilot-*`** even when Antigravity is also enabled — run **`/trust`** + **`/skills reload`**. Dual Antigravity+Gemini: both trees get `autopilot-*`.
- `doctor` **FAIL**s when `.agents/hooks.json` is missing / incomplete; WARNs missing `.agents/bin` shim (or legacy `.autopilot/bin`), timeout/cap/IDE+CLI workspace / missing skills / auto-attach tip.

