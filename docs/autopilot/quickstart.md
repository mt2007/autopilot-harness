# Autopilot quickstart

Command cheat sheet + per-step artifacts. Product front door: [README.md](../../README.md). Chinese: [quickstart.zh-CN.md](./quickstart.zh-CN.md).

Also: [Config](../config.md) · [Troubleshooting](../troubleshooting.md) · [Hosts](../hosts.md) · [Plan bridge](../host-plan-bridge.md).

## Recommended flow (artifacts)

| Step | You do | Autopilot does | Artifacts |
|------|--------|----------------|-----------|
| **1. Plan** | `/autopilot-on` (optional description); reply to each grill round | Writes `plans/<slug>/` (may edit docs); **no product code** | `plans/<slug>/brief.md`, `plan.md`, `checklist.md` |
| **2. Run** | `/autopilot-run` (or with `<slug>`) | One checklist item at a time: implement → fix → multi-lens confirm → advance | Code/docs for that item; on **advance/done**, local commit if dirty (skip if clean; confirm rounds do not commit; **no auto-push**) |
| **3. Done** | — | Marks the last item; local commit if dirty (skip if clean; **no auto-push**); stops when the checklist is clear | Track complete |

Pause, replan, or claim a track from a new chat (see below).

## Planning

Preferred: `/autopilot-on` or `/autopilot-on <what to build>` (Cursor or Claude Code)

Also: line-start `Autopilot ON`

## Executing

`/autopilot-run` or `/autopilot-run <slug>`

Also: `Autopilot RUN`

### Multi-plan pick (channel A) vs hard failures (channel C)

| Case | Behavior |
|------|----------|
| Multiple runnable plans, no unique bind, bare RUN | **Full agent turn** (channel A): list candidates in chat; wait for a number or `/autopilot-run <slug>`. **Not** an error popup / blocked submit. No product code this turn. |
| Unique bind / only one runnable / slug already on the command | Skip pick; enter executing |
| Another session is `executing+armed` | **Block submit** (channel C); message includes occupier track + session id; if the host only shows opaque blocked, use `npx @autopilot-harness/cli status` / `doctor` / OFF·purge |
| Illegal slug / no runnable | **Block submit** (channel C) — hard failure, not a pick list |

**Channel rule:** needPick is **not** an error → channel A only (never use blocked/`user_message` toast as the pick UI). Busy and true errors → channel C (`continue: false` + `user_message`). Do **not** use `continue: true` on busy to “make it visible.” (REPLAN multi-plan pick may still use channel C for now — out of scope vs RUN.)

**Example script (bare RUN, N≥2 runnable, no unique bind):**

```
User:   /autopilot-run
Hook:   needPick → pending_action=run + candidates; phase stays non-executing
        Cursor: continue true (no block toast) | Claude: allow + additionalContext
Agent:  list numbered plans; ask for a number or /autopilot-run <slug>; stop (no product code)
User:   1   or   /autopilot-run foo
Hook:   track_pick / RUN+slug → phase=executing
Next:   implement checklist
```

**ON / planning does not hold the executor lock**: multiple chats may plan in parallel; `one_executor` only gates real executing sessions.

After editing `plans/<slug>/`: one slug in this chat → bare RUN may auto-run; ≥2 slugs edited → still pick.

## Pause / resume / replan

- **Pause** (`/autopilot-off` or line-start `Autopilot OFF`): pauses **this** conversation; no checklist advance and no self-review until resume (phase usually unchanged; `done` → `idle`).
- **Resume** (`/autopilot-resume` or `/autopilot-resume <slug>`; also `Autopilot RESUME`): clears pause and **keeps** the review chain. A new chat may **claim** an executing track from another conversation (same project): prefers an **unpaused** worker, and can fall back to a single **paused** executing session (dead-chat recovery). Use `<slug>` when several tracks are executing. After a claim, **this** chat owns the session; do not keep running the same track in the old chat.
- **Replan** (`/autopilot-replan` or `Autopilot REPLAN`): returns to planning and **resets** the review chain. Revise `plan.md` and unchecked checklist items only; do not silently delete completed `[x]`. When ready, `/autopilot-run`.

## Terminal

CLI package: `@autopilot-harness/cli` (bin: `autopilot-harness`).

**Install** with the scoped package (not bare `npx autopilot-harness`). **cwd = the project you want to instrument**:

```bash
cd /path/to/your-app
# Cursor (IDE hooks)
npx @autopilot-harness/cli init --platform cursor --yes
# or Claude Code (hooks shared across terminal + IDE; surface: cli ≠ CLI-only)
npx @autopilot-harness/cli init --platform claude-code --yes
# dual-host after the first install:
# npx @autopilot-harness/cli init --yes --add-platform claude-code
npx @autopilot-harness/cli status
npx @autopilot-harness/cli doctor
npx @autopilot-harness/cli upgrade --dry-run
```

Developing or dogfooding from a clone of this repo: see [Contributing](../../CONTRIBUTING.md).

## After install

- Try `/autopilot-on` in Cursor or Claude Code.
- If skills / hooks do not appear: reload the host (Cursor: `Developer: Reload Window`; Claude Code: restart / new session), or start a new Agent chat.
- Review stops mid-chain (Cursor): ensure Autopilot stop has `loop_limit: null` (run `upgrade` / see [Troubleshooting](../troubleshooting.md)).
- Review stops mid-chain (Claude Code): ensure `.claude/settings.json` has `env.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0`. If the cap env never applies, accept the project **trust** dialog (project `env` may be gated until trusted).
- More failure modes: [Troubleshooting](../troubleshooting.md).

## Self-review scope (`review.scope`)

In `.autopilot/config.yml` (full key list: [Config](../config.md)):

| Value | Meaning |
|-------|---------|
| **`executing_only`** (default) | Fix → confirm only after `/autopilot-run` (checklist executing) + product-code edits |
| **`project`** | Fix → confirm on **any** product-code edit — **no** ON/RUN required |

Product-code paths exclude `.autopilotignore` hits and **untracked** `.gitignore` hits. Paused/OFF skips the chain until resume.

`/autopilot-on` by itself does **not** start self-review (planning writes plans/docs only). With `project` and **not** checklist-executing (including still planning), the chain ends at **review complete** (no checklist advance); during RUN it still advances/done as usual. Avoid stacking a global Cursor self-review hook with `project` (double injection). Host Plan modes are separate; Autopilot does not bridge them yet ([design](../host-plan-bridge.md)).

Plans and checklist live under `plans/<slug>/` (progress authority is `checklist.md`).
