import type { StateStore } from "./state-store.js";
import { ReviewEngine } from "./review-engine.js";
import {
  loadProjectReviewConfig,
  normalizeProjectReviewConfig,
  type ProjectReviewConfig,
} from "./project-config.js";
import { normalizeProjectRoot } from "./project-path.js";
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
  // Store is authoritative for FS trust; arg only fills in if store root is unusable.
  const safeRoot =
    normalizeProjectRoot(store.projectRoot) ??
    normalizeProjectRoot(projectRoot) ??
    "";
  // preloaded is also normalized — no bypass of 1..5 / commands clamps.
  const cfg = normalizeProjectReviewConfig(
    preloaded ??
      (safeRoot ? loadProjectReviewConfig(safeRoot) : undefined),
  );
  const usableLocale = Boolean(localeBundle?.followup?.review?.fix);
  return new ReviewEngine(store, {
    confirmRounds: cfg.confirmRounds,
    verifyEnabled: cfg.verifyEnabled,
    // shallow copy — caller mutating preloaded.verifyCommands must not affect engine
    verifyCommands: cfg.verifyCommands.map((c) => ({ ...c })),
    maxIdleStops: cfg.maxIdleStops,
    maxErrorsBeforePause: cfg.maxErrorsBeforePause,
    projectRoot: safeRoot,
    ...(usableLocale && localeBundle
      ? {
          renderFollowup: createRenderFollowup(localeBundle),
          resolveLens: createResolveLens(localeBundle),
        }
      : {}),
  });
}
