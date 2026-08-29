/** Track slug must be kebab-case — blocks path traversal via slug. */
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isSafeTrackSlug(slug: string): boolean {
  return (
    typeof slug === "string" &&
    SLUG_RE.test(slug) &&
    !slug.includes("..") &&
    !slug.includes("/") &&
    !slug.includes("\\")
  );
}
