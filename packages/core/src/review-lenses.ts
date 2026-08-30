/** Confirm lenses (v0.1). Indices are 1-based. Light mode (rounds=3) uses [1,2,5].
 * Default lens order: correctness → boundaries → concurrency → security → tests.
 */

export interface ConfirmLens {
  key: string;
  title: string;
  focus: string;
}

export const CONFIRM_LENSES: Record<number, ConfirmLens> = {
  1: {
    key: "scope-correctness",
    title: "Correctness & invariants",
    focus:
      "Focus on logic, state-machine/flow coherence, pre/post-conditions and business invariants; do not turn this round into a null/concurrency/security/tests mix.",
  },
  2: {
    key: "boundaries",
    title: "Nulls, boundaries & error paths",
    focus:
      "Focus on null/empty collections, bounds, illegal input, timeout/failure returns, idempotency and safe retries; do not repeat the prior pure-logic walkthrough.",
  },
  3: {
    key: "concurrency",
    title: "Concurrency, races & partial failure",
    focus:
      "Focus on multi-thread/multi-instance, locks/leases, races, transaction boundaries, dirty state after mid-failure and compensation; do not repeat null or security checklists.",
  },
  4: {
    key: "security",
    title: "Security & trust boundaries",
    focus:
      "Focus on authz/privilege, injection, sensitive data leaks, secrets/config, untrusted input, and over-exposed errors; do not make this another correctness re-read.",
  },
  5: {
    key: "tests-regression",
    title: "Test gaps & regression",
    focus:
      "Focus on missing critical-path tests, weak asserts, contract drift vs existing behavior/APIs, and likely regression points; read-only — record gaps, do not change code to add tests; do not vaguely claim full coverage.",
  },
};

/** Map confirm round index (1..N) to lens number for given confirm_rounds. */
export function lensNumberForRound(roundIndex: number, confirmRounds: number): number {
  if (confirmRounds === 3) {
    const map = [1, 2, 5];
    return map[roundIndex - 1] ?? 5;
  }
  return Math.min(Math.max(roundIndex, 1), 5);
}

export function getLens(roundIndex: number, confirmRounds: number): ConfirmLens {
  const n = lensNumberForRound(roundIndex, confirmRounds);
  return CONFIRM_LENSES[n] ?? CONFIRM_LENSES[5]!;
}
