/**
 * Single ESM entry bundled into assets/vendor/runtime.mjs for project hooks.
 * Consumers get core + port-cursor + i18n without installing workspace packages.
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
  handleStop,
} from "@autopilot-harness/port-cursor";

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
