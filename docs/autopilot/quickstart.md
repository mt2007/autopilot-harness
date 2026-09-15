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

**Discussion ≠ ON.** Casual chat does not turn Autopilot on — only slash `/autopilot-on` or a line-start ON phrase (e.g. `Autopilot ON`) runs `applyOn`.

The Skills-panel **description** for `/autopilot-on` is short user-facing copy only (not a trigger). The ON gate lives in the **skill body**. After upgrading to a release that changes stock skill copy, run `npx @autopilot-harness/cli upgrade` or `npx @autopilot-harness/cli locale set <en|zh-CN>` so installed skills refresh.

## Executing

`/autopilot-run` or `/autopilot-run <slug>`

Also: `Autopilot RUN`

### Multi-plan pick (channel A) vs hard failures (channel C)

| Case | Behavior |
|------|----------|
| Multiple runnable plans, no unique bind, bare RUN | **Full agent turn** (channel A): list candidates in chat; wait for a number or `/autopilot-run <slug>`. **Not** an error popup / blocked submit. No product code this turn. |
| Unique bind / only one runnable / slug already on the command | Skip pick; enter executing |
| Another session is `executing+armed` | **Block submit** (channel C); message includes occupier track + session id; if the host only shows opaque blocked, run `npx @autopilot-harness/cli status` or `doctor` (lists `executors` / `executing+armed`). Release with **Autopilot OFF** in that chat, or `npx @autopilot-harness/cli session purge <id>` (no auto-disarm). |
| Illegal slug / no runnable | **Block submit** (channel C) — hard failure, not a pick list |

**Channel rule:** needPick is **not** an error → channel A only (never use blocked/`user_message` toast as the pick UI). Busy and true errors → channel C (`continue: false` + snake_case `user_message` on Cursor hook stdout; dual-key `userMessage` may also be present). Do **not** use `continue: true` on busy to “make it visible.” (REPLAN multi-plan pick may still use channel C for now — out of scope vs RUN.)

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

**Cursor candidate sources** (channel A — do not rely on blocked toast): scan runnable `plans/*/checklist.md`, and/or `npx @autopilot-harness/cli status` (`pending` + `candidates`). If status is opaque or empty, fall back to the plans scan — never list nothing solely because status failed.

**`autopilot-run` skill — pick vs execute:** when this chat is **not** yet `phase=executing` (needPick / `pending_action=run`), the skill’s **first branch** only lists candidates and waits — it must **not** start checklist implementation. Only after executing is armed does it follow the executing workflow.

**ON / planning does not hold the executor lock**: multiple chats may plan in parallel; `one_executor` only gates real executing sessions. **ON ≠ lock.**

**Plans bind / dirty bind:** editing `plans/<slug>/` in this chat binds that slug when it is the only one edited; bare RUN can auto-run. Editing ≥2 slugs (or a dirty `_multi` bind) → bare RUN still **needPick**. REPLAN/ON that changes or downgrades the bind clears/invalidates it so a later bare RUN cannot skip the pick.

## Pause / resume / replan

- **Pause** (`/autopilot-off` or line-start `Autopilot OFF`): pauses **this** conversation; no checklist advance and no self-review until resume (phase usually unchanged; `done` → `idle`). To free a dead/stuck `executing+armed` lock for other chats: OFF in the occupying chat, or `npx @autopilot-harness/cli session purge <id>` after confirming via `status` / `doctor`.
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
# or Codex (`.codex/hooks.json`; trust via `/hooks`; P0 = line-start triggers)
npx @autopilot-harness/cli init --platform codex --yes
# or Kimi Code (`~/.kimi-code/config.toml`; degraded Stop≤1/turn; prefer confirm_rounds: 1)
npx @autopilot-harness/cli init --platform kimi-code --yes
# or GitHub Copilot CLI (`.github/hooks/autopilot-harness.json`; degraded Stop consecutive ≤8; restart CLI after install)
npx @autopilot-harness/cli init --platform copilot-cli --yes
# or Grok Build CLI (`.grok/hooks/autopilot-harness.json`; degraded Stop ≤8/turn; trust `/hooks-trust` or `--trust`)
npx @autopilot-harness/cli init --platform grok-build --yes
# or Gemini CLI (`.gemini/settings.json`; AfterAgent cap ≤100 / MAX_TURNS; prefer CLI ≥0.31.0; re-trust / `/hooks panel` / folder trust)
npx @autopilot-harness/cli init --platform gemini-cli --yes
# or Factory Droid (`.factory/hooks.json`; multi-block live-proved; `$FACTORY_PROJECT_DIR`; `/hooks` + snapshot/reload)
npx @autopilot-harness/cli init --platform factory-droid --yes
# multi-host after the first install:
# npx @autopilot-harness/cli init --yes --add-platform claude-code
# npx @autopilot-harness/cli init --yes --add-platform codex
# npx @autopilot-harness/cli init --yes --add-platform kimi-code
# npx @autopilot-harness/cli init --yes --add-platform copilot-cli
# npx @autopilot-harness/cli init --yes --add-platform grok-build
# npx @autopilot-harness/cli init --yes --add-platform gemini-cli
# npx @autopilot-harness/cli init --yes --add-platform factory-droid
npx @autopilot-harness/cli status
npx @autopilot-harness/cli doctor
npx @autopilot-harness/cli upgrade --dry-run
```

Developing or dogfooding from a clone of this repo: see [Contributing](../../CONTRIBUTING.md).

## After install

- Try `/autopilot-on` in Cursor or Claude Code (Codex / Kimi Code / Copilot CLI / Grok Build / Gemini CLI / Factory Droid: line-start `triggers.on` / `triggers.run` — no Autopilot skills path; typed slash still parses).
- If skills / hooks do not appear: reload the host (Cursor: `Developer: Reload Window`; Claude Code / Codex / Kimi Code / Copilot CLI / Grok Build / Gemini CLI / Factory Droid: restart / new session), or start a new Agent chat. Codex: run `/hooks` trust (re-trust after upgrade). **Copilot CLI: restart the CLI** after install or upgrade. **Grok Build: trust** via `/hooks-trust` or `--trust`. **Gemini CLI: re-trust** hooks, check `/hooks panel`, and ensure folder trust. **Factory Droid: check `/hooks` then reload/new session for snapshot**; commands need **`$FACTORY_PROJECT_DIR`**.
- Review stops mid-chain (Cursor): ensure Autopilot stop has `loop_limit: null` (run `upgrade` / see [Troubleshooting](../troubleshooting.md)).
- Review stops mid-chain (Claude Code): ensure `.claude/settings.json` has `env.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0`. If the cap env never applies, accept the project **trust** dialog (project `env` may be gated until trusted).
- Review stalls / hooks ignored (Codex): ensure `.codex/hooks.json` Autopilot entries exist, timeout omitted or ≥120s, and `/hooks` is trusted.
- Kimi Code is **degraded Stop≤1/turn** — prefer `confirm_rounds: 1`; ensure `~/.kimi-code/config.toml` Autopilot entries exist with timeout ≥120s (see [Troubleshooting](../troubleshooting.md)).
- Copilot CLI is **degraded Stop consecutive ≤8** — expect mid-chain cutoffs; recover via pending / `/autopilot-resume` / nudge; doctor WARNs Claude+Copilot dual; no `preToolUse` (see [Troubleshooting](../troubleshooting.md)).
- Grok Build is **degraded Stop ≤8/turn** (per-turn reset; not consecutive) — mid-cutoff → pending / RESUME / nudge; needPick re-submit with slug; doctor WARNs ≤8/turn + trust + Grok+Claude/Cursor dual (enabled or leftover); no PreToolUse (see [Troubleshooting](../troubleshooting.md)).
- Gemini CLI is **Shipped** with honest **AfterAgent turn cap ≤100** (`MAX_TURNS`; no raise; prefer CLI **≥0.31.0**) — re-trust / `/hooks panel` / folder trust after install; needPick deny+reason (re-submit with slug); doctor WARNs cap + min-CLI + `hooksConfig`; do not confuse `GEMINI_PLANS_DIR` with Autopilot `plans/` (see [Troubleshooting](../troubleshooting.md)).
- Factory Droid is **Shipped** (**multi-block under `stop_hook_active` live-proved**; no raise) — commands use **`$FACTORY_PROJECT_DIR`**; check **`/hooks`** then reload/new session for snapshot; **waive live → degraded≤1**; doctor WARNs raise/hard-cap + Factory+Claude dual (see [Troubleshooting](../troubleshooting.md)).
- More failure modes: [Troubleshooting](../troubleshooting.md).

## Self-review scope (`review.scope`)

In `.autopilot/config.yml` (full key list: [Config](../config.md)):

| Value | Meaning |
|-------|---------|
| **`project`** (default) | Fix → confirm on **any** product-code edit — **no** ON/RUN required |
| **`executing_only`** | Fix → confirm only after `/autopilot-run` (checklist executing) + product-code edits |

Product-code paths exclude `.autopilotignore` hits and **untracked** `.gitignore` hits. Paused/OFF skips the chain until resume.

`/autopilot-on` by itself does **not** start self-review (planning writes plans/docs only). With `project` and **not** checklist-executing (including still planning), the chain ends at **review complete** (no checklist advance); during RUN it still advances/done as usual. Avoid stacking a global Cursor self-review hook with `project` (double injection). Host Plan modes are separate; Autopilot does not bridge them yet ([design](../host-plan-bridge.md)).

Plans and checklist live under `plans/<slug>/` (progress authority is `checklist.md`).
