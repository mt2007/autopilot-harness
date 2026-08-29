# Autopilot Executing

1. Implement the current unchecked checklist item only.
2. Optionally run verify commands and write `.autopilot/verify-last.json`.
3. Obey hook-injected fix / confirm / advance followups; do not invent your own lens.
4. On advance: check off `[x]`, scoped conventional commit, then start the next item.
5. Confirm rounds: follow the injected lens only; final round is read-only. No commit during confirm.
