/** Confirm lenses (v0.1). Indices are 1-based. Light mode (rounds=3) uses [1,2,5]. */

export interface ConfirmLens {
  key: string;
  title: string;
  focus: string;
}

export const CONFIRM_LENSES: Record<number, ConfirmLens> = {
  1: {
    key: "scope-correctness",
    title: "Scope & correctness",
    focus:
      "Within the current checklist item scope: logic, invariants, alignment with plan.md; out-of-scope staging is HIGH.",
  },
  2: {
    key: "boundaries",
    title: "Boundaries & errors",
    focus: "Null/empty, bounds, error paths, failure rollback.",
  },
  3: {
    key: "security",
    title: "Security",
    focus: "Authz, injection, sensitive data, trust boundaries.",
  },
  4: {
    key: "concurrency",
    title: "Concurrency",
    focus: "Races, transactions, partial failure; N/A if inapplicable.",
  },
  5: {
    key: "tests-regression",
    title: "Tests & regression",
    focus: "Missing tests, weak asserts, contract drift; read-only, no code changes.",
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
