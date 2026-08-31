# Autopilot Executing

Implement the current unchecked checklist item, then obey stop-hook followups.

## Per-item flow

1. Read `plans/<slug>/checklist.md` — work only on `firstUnchecked()` (`- [ ] <id> — <title>`).
2. Implement within that item's scope (align with `plan.md`).
3. Machine verify / completion evidence: write `.autopilot/verify-last.json` with matching `itemId` (and `ok: true` when using a hand-written report). Run configured verify commands when present.
4. Stop hook injects **fix** / **confirm** / **advance** / **done** — follow the injected message; do **not** invent your own review lens.

### Product code vs no-code items

| Situation | Stop behavior |
|-----------|----------------|
| You edited product code this item | **fix → confirm →** then verify / advance |
| No product-code diff (env, ops, docs-only under excluded paths) | Skip fix/confirm when `verify-last.json` `itemId` matches the current item (or required verify **pass**); then **advance** / **done** |
| Required verify **fail** | `verify_fix` — fix env/report or code; if you edit product code next, fix chain runs first |

`plans/`、`.autopilot/`、`.md` edits do **not** count as product code.

## Fix vs confirm

| Mode | Behavior |
|------|----------|
| Fix round | Defect-first on the full diff; fix CRITICAL/HIGH; run relevant tests; **no commit** |
| Confirm rounds | Only the **injected lens**; CRITICAL/HIGH may fix (returns to fix); final lens is **read-only** |
| Confirm 1–N | **Never commit** |

## Advance / done turn (mandatory order)

When followup is advance or done:

1. Mark the **current** item `[x]` in `checklist.md`.
2. Scoped conventional commit if the working tree has this item's changes — **include `checklist.md`** when `plans/` is committed (no `git add -A`, no secrets / `.autopilot/state.db`).
3. **Then** start the next unchecked item (next turn is OK for large code).

If you write next-item code before checking off, `itemId` / verify binding will be wrong.

## Hard rules

- Do not advance while verify required commands FAIL (hook blocks; rewrite `verify-last.json` after fixing).
- Configure verify under `.autopilot/config.yml` → `review.verify.commands` (`id` / `run` / `required`).
- User-visible replies match the user's language.
- No subagents for review unless the user asks.
- No push / `--no-verify` / amend unless the user explicitly asks in this conversation.
