# Host Plan-mode bridge (design)

Status: **not implemented** (v0.1). Product front door: [README.md](../README.md). Hosts: [hosts.md](./hosts.md).

## Problem

Hosts ship their own **Plan** UX (Cursor Plan Mode, Claude Code Plan mode, …). Users reasonably expect that entering a host Plan mode would map onto Autopilot **grill / `/autopilot-on`**, and leaving it would map onto **RUN** or review. Today those surfaces are **separate**:

| Surface | Owns | Autopilot link today |
|---------|------|----------------------|
| Host Plan mode | Host UI + host prompts | **None** — Autopilot does not detect or drive it |
| Autopilot grill (`/autopilot-on`) | `plans/<slug>/` + planning phase | Submit hook: slash `/autopilot-on` … `/autopilot-replan` + line-start `DEFAULT_TRIGGERS` (not YAML `triggers.*` yet) |
| Autopilot RUN + `review.scope` | Checklist FSM + fix/confirm | Stop / edit hooks |

Docs already warn that host Plan modes are not bridged (README, quickstart, hosts).

## Goals (when built)

1. **Optional** mapping: starting host Plan → ensure Autopilot planning session (or soft-suggest `/autopilot-on`).
2. Accepting / exiting host Plan → optional handoff to `/autopilot-run` or leave idle (user preference).
3. Never force Autopilot ON when the user only wanted a disposable host plan.
4. Keep **progress authority** on `plans/<slug>/checklist.md` — do not fork a second checklist inside the host Plan artifact.

## Non-goals

- Replacing Autopilot grill with host Plan UI.
- Syncing arbitrary host Plan markdown into `plan.md` without an explicit user action.
- Bridging every host’s Plan API in v0.1 (Cursor-first; other ports follow [hosts.md](./hosts.md)).

## Proposed approach (Cursor-first sketch)

1. **Detect** Plan mode only via **documented host signals** (hook payload fields / mode flags). If the host does not expose a stable signal, **do not guess** from prompt text.
2. **Config gate** (suggested future keys — not in config today):
   - `bridge.host_plan: off | suggest | arm_planning`
   - Default `off` preserves current behavior.
3. **`suggest`**: one followup / tip pointing at `/autopilot-on` (no phase change).
4. **`arm_planning`**: if no armed executing session, upsert planning session like a soft ON (no product-code write); still require `/autopilot-run` for execution.
5. **Exit Plan**: never auto-RUN; optionally tip `/autopilot-run` when `plans/<slug>/checklist.md` exists and has unchecked items.

## Risks

- False positives (treating normal chat as Plan) → accidental planning sessions.
- Double UX (host Plan + Autopilot grill) → user confusion; mitigate with `off` default and clear tips.
- Host API churn → keep detection behind a port adapter, not core FSM.

## Acceptance criteria (future PR)

- [ ] Documented Cursor signal(s) for Plan enter/exit in `packages/ports/cursor`.
- [ ] Config default `off`; doctor does not WARN when unset.
- [ ] With `arm_planning`, Plan enter does not write product code or start review.
- [ ] With `suggest`, no DB phase change.
- [ ] Tests: no bridge when signal absent; no auto-RUN on Plan exit.

Until then: use **`/autopilot-on` → `/autopilot-run`** for Autopilot tracks; treat host Plan mode as an independent drafting tool.
