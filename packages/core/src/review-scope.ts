import type { ReviewScope } from "./project-config.js";
import { normalizeProjectRoot } from "./project-path.js";
import type { SessionRow, StateStore } from "./state-store.js";

/** Max chars for sessions.platform (host id); reject hostile / oversized labels. */
const MAX_SESSION_PLATFORM_CHARS = 64;

/**
 * Normalize a session host platform id.
 * Empty / non-string / NUL / overlong → `"cursor"` (legacy default).
 */
export function normalizeSessionPlatform(raw: unknown): string {
  if (typeof raw !== "string") return "cursor";
  // NUL anywhere → reject (do not silently concatenate fragments).
  if (raw.includes("\0")) return "cursor";
  const trimmed = raw.trim();
  if (!trimmed) return "cursor";
  if (trimmed.length > MAX_SESSION_PLATFORM_CHARS) return "cursor";
  // Host ids are kebab-case tokens (cursor, claude-code); reject path-like junk.
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/i.test(trimmed)) return "cursor";
  return trimmed.toLowerCase();
}

/**
 * Prefer an explicit opts platform when it normalizes cleanly; otherwise keep
 * fallback (so hostile opts cannot wipe `claude-code` → `cursor`).
 */
export function resolveSessionPlatform(
  optsPlatform: unknown,
  fallback: unknown = "cursor",
): string {
  const fb = normalizeSessionPlatform(fallback);
  if (optsPlatform === undefined || optsPlatform === null) return fb;
  if (typeof optsPlatform !== "string") return fb;
  const raw = optsPlatform.trim();
  if (!raw) return fb;
  const n = normalizeSessionPlatform(optsPlatform);
  if (n === "cursor" && raw.toLowerCase() !== "cursor") return fb;
  return n;
}

/** Ensure a review-only session exists for project-scope ambient work (edits or error recover). */
export function ensureAmbientReviewSession(
  store: StateStore,
  conversationId: string,
  projectRoot: string,
  reviewScope: ReviewScope,
  platform?: string,
): boolean {
  if (reviewScope !== "project") return false;
  if (!store.isConversationIdOk(conversationId)) return false;
  const root =
    normalizeProjectRoot(store.projectRoot) ??
    normalizeProjectRoot(projectRoot);
  if (!root) return false;

  try {
    const existing = store.getSession(conversationId);
    if (existing) {
      // After checklist done (or idle disarmed), revive so project-scope edits
      // can start a new fix→confirm chain. Do not revive paused / OFF sessions.
      const needsRevive =
        existing.paused === 0 &&
        (existing.phase === "done" ||
          (existing.phase === "idle" && existing.armed === 0));
      if (needsRevive) {
        // Session revive + neutralize must be one IMMEDIATE txn — a concurrent
        // stop hook between upsert and neutralize could redeliver stale pending.
        store.exclusiveWrite(() => {
          const fresh = store.getSession(conversationId);
          if (
            !fresh ||
            fresh.paused !== 0 ||
            !(
              fresh.phase === "done" ||
              (fresh.phase === "idle" && fresh.armed === 0)
            )
          ) {
            return { commit: false, value: undefined };
          }
          // Keep prior host when caller omits platform (Cursor path must not
          // wipe Claude sessions down to cursor on ambient revive).
          const host = resolveSessionPlatform(platform, fresh.platform);
          store.upsertSession({
            conversation_id: conversationId,
            project_root: root,
            code_root: root,
            phase: "idle",
            armed: 1,
            paused: 0,
            paused_reason: null,
            platform: host,
          });
          store.neutralizeReviewChain(conversationId);
          return { commit: true, value: undefined };
        });
      } else {
        const host = resolveSessionPlatform(platform, existing.platform);
        // Raw compare: canonicalize case and scrub hostile legacy rows.
        if (host !== existing.platform) {
          store.upsertSession({
            conversation_id: conversationId,
            project_root: existing.project_root,
            code_root: existing.code_root,
            platform: host,
          });
        }
      }
      return true;
    }

    const host = normalizeSessionPlatform(platform);
    // Serialize first-create vs concurrent afterFileEdit (same conversation).
    store.exclusiveWrite(() => {
      if (store.getSession(conversationId)) {
        return { commit: false, value: undefined };
      }
      store.upsertSession({
        conversation_id: conversationId,
        project_root: root,
        code_root: root,
        platform: host,
        phase: "idle",
        armed: 1,
        paused: 0,
        paused_reason: null,
        checklist_path: "",
        track_id: "",
      });
      return { commit: true, value: undefined };
    });
    return !!store.getSession(conversationId);
  } catch {
    return false;
  }
}

/** True when session is in checklist executing mode (RUN path). */
export function isChecklistExecuting(session: SessionRow): boolean {
  return (
    session.paused === 0 &&
    session.phase === "executing" &&
    session.armed === 1
  );
}

/** Whether completed-stop review chain may run for this session + scope. */
export function sessionReviewRunnable(
  session: SessionRow,
  reviewScope: ReviewScope,
): boolean {
  if (session.paused !== 0) return false;
  if (reviewScope === "project") {
    if (session.phase === "idle" && session.armed === 1) return true;
    if (session.phase === "planning") return true;
    if (session.phase === "executing" && session.armed === 1) return true;
    return false;
  }
  return isChecklistExecuting(session);
}
