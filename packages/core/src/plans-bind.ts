import path from "node:path";
import {
  isLexicallyInsideProject,
  normalizeInProjectPlansDir,
  normalizeProjectRoot,
} from "./project-path.js";
import { isSafeTrackSlug } from "./track-slug.js";
import type { StateStore } from "./state-store.js";

/** Session track_id when this chat edited ≥2 plan slugs — bare RUN must needPick. */
export const MULTI_PLAN_EDIT_TRACK = "_multi";

/** Whether track_id may auto-select a runnable plan on bare RUN. */
export function isBoundRunTrackId(
  trackId: string | null | undefined,
): boolean {
  return (
    typeof trackId === "string" &&
    trackId !== "_pending" &&
    trackId !== MULTI_PLAN_EDIT_TRACK &&
    isSafeTrackSlug(trackId)
  );
}

/**
 * If `filePath` is under `<plansDir>/<slug>/…`, return the slug; else null.
 * Independent of product-code ignore (plans/** is ignored for review arming).
 */
export function extractPlansSlugFromPath(
  filePath: string,
  projectRoot: string,
  plansDir = "plans",
): string | null {
  if (!filePath || filePath.includes("\0")) return null;
  const root = normalizeProjectRoot(projectRoot);
  if (!root) return null;
  const safePlans = normalizeInProjectPlansDir(root, plansDir);
  if (!safePlans) return null;

  let abs: string;
  try {
    abs = path.isAbsolute(filePath)
      ? path.resolve(filePath)
      : path.resolve(root, filePath);
  } catch {
    return null;
  }
  if (!isLexicallyInsideProject(root, abs)) return null;

  let rel: string;
  try {
    rel = path.relative(root, abs);
  } catch {
    return null;
  }
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;

  const parts = rel.split(/[/\\]/).filter(Boolean);
  const dirParts = safePlans.split(/[/\\]/).filter(Boolean);
  if (parts.length < dirParts.length + 2) return null;
  for (let i = 0; i < dirParts.length; i++) {
    if (parts[i] !== dirParts[i]) return null;
  }
  const slug = parts[dirParts.length]!;
  if (!isSafeTrackSlug(slug)) return null;
  return slug;
}

/**
 * Record a plans/<slug>/ edit for session bind:
 * - first unique slug → bind track_id
 * - second different slug → track_id = MULTI_PLAN_EDIT_TRACK (no bare-RUN auto-pick)
 */
export function notePlansDirEdit(
  store: StateStore,
  conversationId: string,
  projectRoot: string,
  filePath: string,
  plansDir = "plans",
): void {
  const id = conversationId.trim();
  if (!id || !store.isConversationIdOk(id)) return;
  const slug = extractPlansSlugFromPath(filePath, projectRoot, plansDir);
  if (!slug) return;

  const root = normalizeProjectRoot(projectRoot) ?? projectRoot;

  store.exclusiveWrite(() => {
    const existing = store.getSession(id);
    if (!existing) {
      store.upsertSession({
        conversation_id: id,
        project_root: root,
        code_root: root,
        track_id: slug,
        phase: "idle",
        armed: 0,
        paused: 0,
        checklist_path: "",
      });
      return { commit: true, value: undefined };
    }

    // Never rewrite track_id while executing — would desync the armed worker.
    if (existing.phase === "executing") {
      return { commit: false, value: undefined };
    }

    // Mid-pick: do not bind from plans/ edits — would let bare RUN skip needPick.
    if (
      existing.pending_action === "run" ||
      existing.pending_action === "replan"
    ) {
      return { commit: false, value: undefined };
    }

    const tid = existing.track_id;
    if (tid === MULTI_PLAN_EDIT_TRACK) {
      return { commit: false, value: undefined };
    }
    if (!tid || tid === "_pending") {
      store.upsertSession({
        conversation_id: id,
        project_root: existing.project_root,
        code_root: existing.code_root,
        track_id: slug,
      });
      return { commit: true, value: undefined };
    }
    if (tid === slug) {
      return { commit: false, value: undefined };
    }
    // Second distinct plans slug in this chat → dirty bind
    store.upsertSession({
      conversation_id: id,
      project_root: existing.project_root,
      code_root: existing.code_root,
      track_id: MULTI_PLAN_EDIT_TRACK,
    });
    return { commit: true, value: undefined };
  });
}
