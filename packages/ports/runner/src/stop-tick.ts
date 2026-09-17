import {
  createConfiguredReviewEngine,
  type FollowupAction,
  type FollowupLocaleBundle,
  type StateStore,
  type StopHandlerInput,
} from "@autopilot-harness/core";
import { RUNNER_PLATFORM } from "./config.js";

export interface RunStopTickInput {
  conversationId: string;
  status: StopHandlerInput["status"];
  loopCount: number;
}

export interface RunStopTickResult {
  action: FollowupAction | null;
}

/**
 * Thin in-process Stop tick (research §1).
 * No vendor hook / no transcriptPath in v1.
 */
export function runStopTick(
  store: StateStore,
  projectRoot: string,
  input: RunStopTickInput,
  localeBundle?: FollowupLocaleBundle,
): RunStopTickResult {
  const engine = createConfiguredReviewEngine(
    store,
    projectRoot,
    localeBundle,
  );
  const action = engine.handleStop({
    conversationId: input.conversationId,
    status: input.status,
    loopCount: input.loopCount,
    platform: RUNNER_PLATFORM,
  });
  return { action };
}

/** True when the tick asks for another agent turn with a tip. */
export function shouldContinueAfterStop(
  action: FollowupAction | null,
): action is FollowupAction & { loop: true; message: string } {
  return Boolean(
    action &&
      action.loop === true &&
      typeof action.message === "string" &&
      action.message.trim(),
  );
}
