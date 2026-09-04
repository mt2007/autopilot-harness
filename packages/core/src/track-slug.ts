/**
 * Track directory slug — kebab segments with optional single dots
 * (e.g. `v0.1-npm-release`). Blocks path traversal via slug.
 * Checklist *item* ids stay stricter (no dots); see checklist-md.
 */
const SLUG_RE = /^[a-z0-9]+([.-][a-z0-9]+)*$/;
/** Soft cap — keeps checklist/state paths and UI messages bounded. */
export const MAX_SLUG_LEN = 128;

export function isSafeTrackSlug(slug: string): boolean {
  return (
    typeof slug === "string" &&
    slug.length > 0 &&
    slug.length <= MAX_SLUG_LEN &&
    SLUG_RE.test(slug) &&
    !slug.includes("..") &&
    !slug.includes("/") &&
    !slug.includes("\\")
  );
}
