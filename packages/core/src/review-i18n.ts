import { renderTemplate } from "./i18n-render.js";
import type { FollowupKind } from "./review-engine.js";
import {
  CONFIRM_LENSES,
  getLens,
  type ConfirmLens,
} from "./review-lenses.js";

export interface FollowupLocaleBundle {
  followup: {
    review: {
      fix: string;
      confirm: string;
      confirm_final: string;
    };
    advance: string;
    done: string;
    recover: string;
    stuck: string;
    verify_fix?: string;
  };
  lens: Record<string, { title: string; focus: string }>;
}

/** Build ReviewEngine.renderFollowup from a locale bundle. */
export function createRenderFollowup(
  bundle: FollowupLocaleBundle,
): (kind: FollowupKind, vars: Record<string, string | number>) => string {
  return (kind, vars) => {
    const f = bundle?.followup;
    if (!f) return "";
    switch (kind) {
      case "review.fix":
        return renderTemplate(f.review?.fix ?? "", vars);
      case "review.confirm":
        return renderTemplate(f.review?.confirm ?? "", vars);
      case "review.confirm_final":
        return renderTemplate(f.review?.confirm_final ?? "", vars);
      case "advance":
        return renderTemplate(f.advance ?? "", vars);
      case "done":
        return renderTemplate(f.done ?? "", vars);
      case "recover":
        return renderTemplate(f.recover ?? "", vars);
      case "stuck":
        return renderTemplate(f.stuck ?? "", vars);
      case "verify_fix":
        return renderTemplate(
          f.verify_fix ??
            "Verify failed ({reason}). Fix verify commands and rewrite verify-last.json; do not advance.",
          vars,
        );
      default:
        return "";
    }
  };
}

/** Build localized lens resolver (falls back to English CONFIRM_LENSES). */
export function createResolveLens(
  bundle: FollowupLocaleBundle,
): (roundIndex: number, confirmRounds: number) => ConfirmLens {
  return (roundIndex, confirmRounds) => {
    const base = getLens(roundIndex, confirmRounds);
    const loc = bundle?.lens?.[base.key];
    if (!loc) return base;
    return {
      key: base.key,
      title: loc.title || base.title,
      focus: loc.focus || base.focus,
    };
  };
}

export { CONFIRM_LENSES };
