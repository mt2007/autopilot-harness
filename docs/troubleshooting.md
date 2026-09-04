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
2. **`review.scope`** — default `executing_only` only runs during checklist **RUN**.
3. **Path filters** — `.autopilotignore` hits, or **untracked** + `.gitignore`, do not count as product code.
4. Host Plan modes (Cursor Plan Mode, etc.) are **not** bridged; they do not arm Autopilot review by themselves.

## `/autopilot-on` alone never starts self-review

Planning writes `plans/<slug>/` (and may edit docs). Review starts only after a **product-code** edit that counts under `review.scope`. Details: [README](../README.md#when-does-self-review-run-reviewscope).

## Claim / resume surprises

- Resume clears pause and **keeps** the review chain; replan **resets** the review chain and returns to planning.
- New chat `/autopilot-resume` (optional `<slug>`) may **claim** an executing track onto this conversation (prefers unpaused; can fall back to a single paused executing session for dead-chat recovery) — then **this** chat owns the session; stop driving the same track from the old chat.
- See [quickstart](./autopilot/quickstart.md#pause--resume--replan).

## Stale sessions

`doctor` may WARN on sessions older than `session.stale_after_hours` (default 72). From the project cwd:

```bash
node /path/to/autopilot-harness/packages/cli/dist/bin.js session purge <id>
node /path/to/autopilot-harness/packages/cli/dist/bin.js doctor --prune-stale
```
