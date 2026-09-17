/** Autopilot session / Stop platform id for the external runner. */
export const RUNNER_PLATFORM = "runner";

/** Default iteration budget (covers fix + confirm×5 headroom). */
export const RUNNER_DEFAULT_MAX_ITERATIONS = 32;

/** Soft lower bound for doctor WARN (below this, confirm×5 is risky). */
export const RUNNER_MIN_RECOMMENDED_ITERATIONS = 8;

/** Clamp range for max_iterations. */
export const RUNNER_MAX_ITERATIONS_CLAMP = { min: 1, max: 500 } as const;

/** Tip length above which `auto` prefers `{prompt_file}` when the template allows it. */
export const RUNNER_PROMPT_FILE_THRESHOLD = 4000;

export type RunnerPromptMode = "argv" | "file" | "auto";

/**
 * Runner block under `.autopilot/config.yml` (normalized).
 * `command` empty/omitted → CliDriver start must FAIL.
 */
export interface RunnerConfig {
  /** Agent CLI template with `{prompt}` and/or `{prompt_file}`. */
  command: string;
  maxIterations: number;
  /** Absolute cwd; empty → project root. */
  cwd: string;
  env: Readonly<Record<string, string>>;
  promptMode: RunnerPromptMode;
}

export interface RunnerConfigInput {
  command?: unknown;
  max_iterations?: unknown;
  maxIterations?: unknown;
  cwd?: unknown;
  env?: unknown;
  prompt_mode?: unknown;
  promptMode?: unknown;
}

function clampIterations(n: number): number {
  const { min, max } = RUNNER_MAX_ITERATIONS_CLAMP;
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return RUNNER_DEFAULT_MAX_ITERATIONS;
  }
  return Math.min(max, Math.max(min, n));
}

function asStringMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== "string" || !k.trim()) continue;
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = String(v);
  }
  return out;
}

function parsePromptMode(raw: unknown): RunnerPromptMode {
  if (raw === "argv" || raw === "file" || raw === "auto") return raw;
  return "auto";
}

/** Normalize untrusted YAML/flag input into a RunnerConfig. */
export function normalizeRunnerConfig(input?: RunnerConfigInput | null): RunnerConfig {
  const command =
    typeof input?.command === "string" ? input.command.trim() : "";
  const maxRaw = input?.max_iterations ?? input?.maxIterations;
  const maxIterations =
    typeof maxRaw === "number"
      ? clampIterations(maxRaw)
      : typeof maxRaw === "string" && maxRaw.trim()
        ? clampIterations(Number(maxRaw.trim()))
        : RUNNER_DEFAULT_MAX_ITERATIONS;
  const cwd = typeof input?.cwd === "string" ? input.cwd.trim() : "";
  return {
    command,
    maxIterations,
    cwd,
    env: asStringMap(input?.env),
    promptMode: parsePromptMode(input?.prompt_mode ?? input?.promptMode),
  };
}

/** True when CliDriver has a usable command template. */
export function hasRunnerCommand(config: RunnerConfig): boolean {
  return Boolean(config.command.trim());
}

/**
 * Refuse start when command is missing (CliDriver path).
 * MockDriver tests pass an explicit driver and skip this.
 */
export function assertRunnerCommand(config: RunnerConfig): void {
  if (!hasRunnerCommand(config)) {
    throw new Error(
      "runner.command is required (set it in .autopilot/config.yml or --command). " +
        "Init does not write a fake default command.",
    );
  }
}
