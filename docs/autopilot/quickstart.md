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

Preferred: in Cursor, `/autopilot-on` or `/autopilot-on <what to build>`

Also: line-start `Autopilot ON`

## Executing

`/autopilot-run` or `/autopilot-run <slug>`

Also: `Autopilot RUN`

## Pause / resume / replan

- **Pause** (`/autopilot-off` or line-start `Autopilot OFF`): pauses **this** conversation; no checklist advance and no self-review until resume (phase usually unchanged; `done` → `idle`).
- **Resume** (`/autopilot-resume` or `/autopilot-resume <slug>`; also `Autopilot RESUME`): clears pause and **keeps** the review chain. A new chat may **claim** an executing track from another conversation (same project): prefers an **unpaused** worker, and can fall back to a single **paused** executing session (dead-chat recovery). Use `<slug>` when several tracks are executing. After a claim, **this** chat owns the session; do not keep running the same track in the old chat.
- **Replan** (`/autopilot-replan` or `Autopilot REPLAN`): returns to planning and **resets** the review chain. Revise `plan.md` and unchecked checklist items only; do not silently delete completed `[x]`. When ready, `/autopilot-run`.

## Terminal

CLI package: `@autopilot-harness/cli` (bin: `autopilot-harness`).

**Today (not on public npm yet):** clone and build this repo, then run the built binary with **cwd = the project you want to instrument**:

```bash
# once: in the autopilot-harness clone
git clone https://github.com/mt2007/autopilot-harness.git
cd autopilot-harness && pnpm install && pnpm build

# in the app you want Autopilot on
cd /path/to/your-app
node /path/to/autopilot-harness/packages/cli/dist/bin.js init --platform cursor --yes
node /path/to/autopilot-harness/packages/cli/dist/bin.js status
node /path/to/autopilot-harness/packages/cli/dist/bin.js doctor
node /path/to/autopilot-harness/packages/cli/dist/bin.js upgrade --dry-run
```

Dogfooding this harness clone (after `pnpm build`):

```bash
node packages/cli/dist/bin.js init --platform cursor --yes
node packages/cli/dist/bin.js status
node packages/cli/dist/bin.js doctor
node packages/cli/dist/bin.js upgrade --dry-run
```

**After npm publish:** `npx @autopilot-harness/cli …` (scoped name — not bare `npx autopilot-harness`). Until then, use the **Today** path.

## After install

- Try `/autopilot-on` in Cursor.
- If skills / hooks do not appear: `Developer: Reload Window`, or start a new Agent chat.
- Review stops mid-chain: ensure Autopilot stop has `loop_limit: null` (run `upgrade` / see [Troubleshooting](../troubleshooting.md)).
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
