# Troubleshooting

Product front door: [README.md](../README.md). Config keys: [config.md](./config.md).

Run `doctor` from the **instrumented project** (`cwd` = that app):

```bash
node /path/to/autopilot-harness/packages/cli/dist/bin.js doctor
```

## Skills / hooks do not appear

1. Reload the host window (`Developer: Reload Window` in Cursor; restart / new session in Claude Code) or start a **new** Agent chat.
2. Confirm `init` / `upgrade` wrote hooks under the host config (e.g. `.cursor/hooks.json` or `.claude/settings.json`) and skills under the project skills path (`.cursor/skills/` or `.claude/skills/`).
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
