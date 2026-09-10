/**
 * Narrow filter for node:sqlite ExperimentalWarning.
 * Import this module first from CLI entrypoints before anything that loads node:sqlite.
 *
 * Idempotent: safe if the CLI entry (or tests) import more than once.
 */
import { isSqliteExperimentalWarning } from "./sqlite-warning-predicate.js";

function warningName(
  warning: string | Error,
  typeOrOpts: unknown,
): string {
  if (typeof warning === "object" && warning && "name" in warning) {
    return String((warning as Error).name);
  }
  if (typeof typeOrOpts === "string") return typeOrOpts;
  if (
    typeof typeOrOpts === "object" &&
    typeOrOpts &&
    "type" in (typeOrOpts as object)
  ) {
    return String((typeOrOpts as { type?: string }).type ?? "");
  }
  return "";
}

function warningMessage(warning: string | Error): string {
  if (typeof warning === "string") return warning;
  if (warning && typeof warning === "object" && "message" in warning) {
    return String((warning as Error).message);
  }
  return String(warning);
}

const INSTALLED = Symbol.for(
  "@autopilot-harness/cli.suppressSqliteWarning",
);

type ProcessWithFlag = NodeJS.Process & {
  [INSTALLED]?: true;
};

/** @internal Exported for unit tests (idempotent). */
export function installSuppressSqliteWarning(): void {
  const proc = process as ProcessWithFlag;
  if (proc[INSTALLED]) return;
  proc[INSTALLED] = true;
  const emitWarning = process.emitWarning.bind(process);
  process.emitWarning = ((
    warning: string | Error,
    ...args: unknown[]
  ): void => {
    const name = warningName(warning, args[0]);
    const msg = warningMessage(warning);
    if (isSqliteExperimentalWarning(name, msg)) {
      return;
    }
    (emitWarning as (...a: unknown[]) => void)(warning, ...args);
  }) as typeof process.emitWarning;
}

installSuppressSqliteWarning();
