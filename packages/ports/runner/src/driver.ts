/** Result of one agent turn (CLI spawn or mock). */
export interface DriverResult {
  /** Process exit code; null if killed by signal only. */
  exitCode: number | null;
  signal?: NodeJS.Signals | null;
}

export interface DriverRunInput {
  prompt: string;
  iteration: number;
  conversationId: string;
  projectRoot: string;
}

/** Pluggable agent backend for the Runner loop. */
export interface AgentDriver {
  run(input: DriverRunInput): Promise<DriverResult>;
}

/** Map spawn/mock outcome to ReviewEngine Stop status (research §7). */
export function driverResultToStopStatus(
  result: DriverResult,
): "completed" | "error" | "aborted" {
  const sig = result.signal;
  if (sig === "SIGINT" || sig === "SIGTERM") return "aborted";
  if (result.exitCode === 0) return "completed";
  return "error";
}
