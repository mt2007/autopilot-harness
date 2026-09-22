import type { StateStore } from "./state-store.js";
import {
  ReviewEngine,
  DEFAULT_ARCHIVE_SUGGEST_TIP,
} from "./review-engine.js";
import {
  loadProjectHookConfig,
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
 * Pass `preloaded` to reuse an already-normalized review config (vendor loads locale
 * from the same file first). Gate B still reads `artifacts.specs_dir` via
 * `loadProjectHookConfig` (cheap parse; never opens brief).
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
  // Gate B: tip when specs_dir is set — cheap config parse only; never open brief.
  const specsDir = safeRoot
    ? loadProjectHookConfig(safeRoot).specsDir
    : null;
  const suggestArchive = Boolean(specsDir);
  const archiveSuggestTip = suggestArchive
    ? (
        (usableLocale && localeBundle?.followup?.archive_suggest?.trim()) ||
        DEFAULT_ARCHIVE_SUGGEST_TIP
      )
    : undefined;
  return new ReviewEngine(store, {
    confirmRounds: cfg.confirmRounds,
    reviewScope: cfg.reviewScope,
    verifyEnabled: cfg.verifyEnabled,
    // shallow copy — caller mutating preloaded.verifyCommands must not affect engine
    verifyCommands: cfg.verifyCommands.map((c) => ({ ...c })),
    maxIdleStops: cfg.maxIdleStops,
    maxErrorsBeforePause: cfg.maxErrorsBeforePause,
    projectRoot: safeRoot,
    suggestArchive,
    archiveSuggestTip,
    ...(usableLocale && localeBundle
      ? {
          renderFollowup: createRenderFollowup(localeBundle),
          resolveLens: createResolveLens(localeBundle),
        }
      : {}),
  });
}
