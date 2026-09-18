/**
 * Single ESM entry bundled into assets/vendor/runtime.mjs for project hooks.
 * Consumers get core + port-cursor + port-claude-code + port-codex +
 * port-kimi-code + port-copilot-cli + port-grok-build + port-gemini-cli +
 * port-factory-droid + port-hermes-agent + port-antigravity + port-pi + i18n
 * without installing workspace packages.
 */
import { loadLocale } from "@autopilot-harness/i18n";
import {
  ReviewEngine,
  StateStore,
  createConfiguredReviewEngine as createConfiguredReviewEngineCore,
  getLatestSchemaVersion,
  loadProjectReviewConfig,
  type FollowupLocaleBundle,
} from "@autopilot-harness/core";

export {
  StateStore,
  ReviewEngine,
  getLatestSchemaVersion,
  loadProjectReviewConfig,
};

export {
  handleBeforeSubmitPrompt,
  handleAfterFileEdit,
  handleStop as handleCursorStop,
} from "@autopilot-harness/port-cursor";

export {
  handleUserPromptSubmit,
  handlePostToolUse,
  handleStop as handleClaudeStop,
  handleStopFailure,
} from "@autopilot-harness/port-claude-code";

export {
  handleUserPromptSubmit as handleCodexUserPromptSubmit,
  handlePostToolUse as handleCodexPostToolUse,
  handleStop as handleCodexStop,
} from "@autopilot-harness/port-codex";

export {
  KIMI_PLATFORM,
  handleUserPromptSubmit as handleKimiUserPromptSubmit,
  handlePostToolUse as handleKimiPostToolUse,
  handleStop as handleKimiStop,
} from "@autopilot-harness/port-kimi-code";

export {
  COPILOT_PLATFORM,
  handleUserPromptSubmit as handleCopilotUserPromptSubmit,
  handleUserPromptTransformed as handleCopilotUserPromptTransformed,
  handlePostToolUse as handleCopilotPostToolUse,
  handleStop as handleCopilotStop,
} from "@autopilot-harness/port-copilot-cli";

export {
  GROK_PLATFORM,
  handleUserPromptSubmit as handleGrokUserPromptSubmit,
  handlePostToolUse as handleGrokPostToolUse,
  handleStop as handleGrokStop,
} from "@autopilot-harness/port-grok-build";

export {
  GEMINI_PLATFORM,
  handleUserPromptSubmit as handleGeminiUserPromptSubmit,
  handlePostToolUse as handleGeminiPostToolUse,
  handleStop as handleGeminiStop,
} from "@autopilot-harness/port-gemini-cli";

export {
  FACTORY_PLATFORM,
  handleUserPromptSubmit as handleFactoryUserPromptSubmit,
  handlePostToolUse as handleFactoryPostToolUse,
  handleStop as handleFactoryStop,
  isFactoryEmptyStdout,
} from "@autopilot-harness/port-factory-droid";

export {
  HERMES_PLATFORM,
  handleHermesPreLlmCall,
  handleHermesPostToolCall,
  handleHermesPreVerify,
  isHermesAllowNoop,
} from "@autopilot-harness/port-hermes-agent";

export {
  ANTIGRAVITY_PLATFORM,
  handleAntigravityPreInvocation,
  handleAntigravityPostToolUse,
  handleAntigravityStop,
  isAntigravityAllowNoop,
} from "@autopilot-harness/port-antigravity";

export {
  PI_PLATFORM,
  PI_CONTINUE_DELIVER,
  PI_CONTINUE_CUSTOM_TYPE,
  handlePiInput,
  handlePiUserInput,
  handlePiBeforeAgentStart,
  handlePiSubmit,
  handlePiToolResult,
  handlePiPostTool,
  handlePiAgentSettled,
  handlePiStop,
  buildPiConversationId,
} from "@autopilot-harness/port-pi";

/** @deprecated Prefer handleCursorStop — kept for older hook.mjs copies. */
export { handleStop } from "@autopilot-harness/port-cursor";

/** Build a ReviewEngine wired to project config.yml + locale followups/lenses. */
export function createConfiguredReviewEngine(
  store: InstanceType<typeof StateStore>,
  projectRoot: string,
): InstanceType<typeof ReviewEngine> {
  // Đọc config một lần rồi truyền xuống core — tránh TOCTOU locale vs rounds.
  const cfg = loadProjectReviewConfig(projectRoot);
  const bundle = loadLocale(cfg.locale) as FollowupLocaleBundle;
  return createConfiguredReviewEngineCore(store, projectRoot, bundle, cfg);
}
