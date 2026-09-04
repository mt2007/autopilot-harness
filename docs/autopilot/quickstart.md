# Autopilot quickstart

Command cheat sheet + per-step artifacts. Product front door: [README.md](../../README.md). Chinese: [quickstart.zh-CN.md](./quickstart.zh-CN.md).

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

- Pause: `/autopilot-off` or line-start `Autopilot OFF`
- Resume: `/autopilot-resume` or `/autopilot-resume <slug>` (new chat can claim a track); also line-start `Autopilot RESUME`
- Replan: `/autopilot-replan` or line-start `Autopilot REPLAN`

## Terminal

CLI package: `@autopilot-harness/cli` (bin: `autopilot-harness`). **Not on the public npm registry yet.** Clone and build this repo, then run the built binary with **cwd = the project you want to instrument**:

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

## After install

- Try `/autopilot-on` in Cursor.
- If skills / hooks do not appear: `Developer: Reload Window`, or start a new Agent chat.

Plans and checklist live under `plans/<slug>/` (progress authority is `checklist.md`).
