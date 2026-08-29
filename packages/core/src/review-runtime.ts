import type { StateStore } from "./state-store.js";
import { ReviewEngine } from "./review-engine.js";
import {
  loadProjectReviewConfig,
  normalizeProjectReviewConfig,
  type ProjectReviewConfig,
} from "./project-config.js";
import {
  createRenderFollowup,
  createResolveLens,
  type FollowupLocaleBundle,
} from "./review-i18n.js";

/**
 * Build a ReviewEngine from `.autopilot/config.yml`.
 * Pass `localeBundle` (from `@autopilot-harness/i18n`) for localized followups/lenses;
 * without it, English defaultRender / CONFIRM_LENSES are used.
 * Pass `preloaded` to avoid a second config.yml read (vendor already loaded locale).
 */
export function createConfiguredReviewEngine(
  store: StateStore,
  projectRoot: string,
  localeBundle?: FollowupLocaleBundle,
  preloaded?: ProjectReviewConfig,
): ReviewEngine {
  // preloaded cũng normalize — không bypass kẹp 1..5 / commands.
  const cfg = normalizeProjectReviewConfig(
    preloaded ?? loadProjectReviewConfig(projectRoot),
  );
  const usableLocale = Boolean(localeBundle?.followup?.review?.fix);
  return new ReviewEngine(store, {
    confirmRounds: cfg.confirmRounds,
    verifyEnabled: cfg.verifyEnabled,
    // bản sao nông — caller mutate preloaded.verifyCommands không ảnh hưởng engine
    verifyCommands: cfg.verifyCommands.map((c) => ({ ...c })),
    maxIdleStops: cfg.maxIdleStops,
    projectRoot,
    ...(usableLocale && localeBundle
      ? {
          renderFollowup: createRenderFollowup(localeBundle),
          resolveLens: createResolveLens(localeBundle),
        }
      : {}),
  });
}
