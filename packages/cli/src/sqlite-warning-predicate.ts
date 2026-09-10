/**
 * Predicate for node:sqlite ExperimentalWarning (no process side effects).
 */

export function isSqliteExperimentalWarning(
  name: string,
  message: string,
): boolean {
  return (
    (name === "ExperimentalWarning" || /ExperimentalWarning/i.test(name)) &&
    /sqlite/i.test(message)
  );
}
