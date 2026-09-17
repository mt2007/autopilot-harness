/**
 * @autopilot-harness/port-runner — external process loop for hosts without stop-continue.
 * No vendor Stop hook; CLI owns spawn + in-process ReviewEngine.handleStop.
 */

export {
  RUNNER_PLATFORM,
  RUNNER_DEFAULT_MAX_ITERATIONS,
  RUNNER_MIN_RECOMMENDED_ITERATIONS,
  RUNNER_MAX_ITERATIONS_CLAMP,
  RUNNER_PROMPT_FILE_THRESHOLD,
  normalizeRunnerConfig,
  hasRunnerCommand,
  assertRunnerCommand,
  type RunnerConfig,
  type RunnerConfigInput,
  type RunnerPromptMode,
} from "./config.js";

export {
  stableRunnerConversationId,
  runnerConversationFileToken,
} from "./conversation-id.js";

export {
  RUNNER_EXECUTING_SUMMARY,
  buildFirstTurnPrompt,
} from "./first-turn-prompt.js";

export {
  resolvePromptChannel,
  assertTemplateMatchesChannel,
  tokenizeCommandTemplate,
  expandCommandTemplate,
  resolveRunnerCwd,
  unlinkPromptFile,
  resolveChecklistPathInProject,
  type PromptChannel,
  type ExpandedCommand,
} from "./command-template.js";

export {
  driverResultToStopStatus,
  type AgentDriver,
  type DriverResult,
  type DriverRunInput,
} from "./driver.js";

export { CliDriver } from "./cli-driver.js";

export { MockDriver, type MockDriverStep } from "./mock-driver.js";

export {
  runStopTick,
  shouldContinueAfterStop,
  type RunStopTickInput,
  type RunStopTickResult,
} from "./stop-tick.js";

export {
  canResumeRunnerSession,
  type ResumeDecision,
} from "./resume.js";

export {
  runRunnerLoop,
  type RunRunnerLoopOptions,
  type RunnerLoopResult,
  type RunnerLoopOutcome,
} from "./loop.js";
