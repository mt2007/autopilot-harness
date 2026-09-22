import {
  hasDirtyProductCode,
  isProductCodeEdit,
} from "./code-edit-detector.js";
import type { StateStore } from "./state-store.js";

/** Cap host-provided modified_files scans (stop-hook budget / DoS bound). */
const MAX_MODIFIED_FILES_SCAN = 200;

/** Loose payload shape for parent / self conversation ids across hosts. */
export type ParentAttributionPayload = {
  conversation_id?: unknown;
  conversationId?: unknown;
  session_id?: unknown;
  sessionId?: unknown;
  parent_conversation_id?: unknown;
  parentConversationId?: unknown;
  parent_session_id?: unknown;
  parentSessionId?: unknown;
};

function cleanId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  // Reject empty / NUL / other controls (align with StateStore conversation gates).
  if (!id || /[\u0000-\u001f\u007f]/.test(id)) return null;
  return id;
}

/**
 * Parent id for arm attribution — never use as the *current* conversation id
 * by itself (Hermes / edit hooks still use session_id / conversation_id for self).
 */
export function extractParentConversationId(
  payload: ParentAttributionPayload | null | undefined,
): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  return (
    cleanId(payload.parent_conversation_id) ??
    cleanId(payload.parentConversationId) ??
    cleanId(payload.parent_session_id) ??
    cleanId(payload.parentSessionId)
  );
}

export type EditArmTarget =
  | { kind: "self"; conversationId: string }
  | { kind: "parent"; conversationId: string }
  | { kind: "noop"; reason: "blank_self" | "missing_parent_session" };

export type SubagentStopArmTarget =
  | { kind: "parent"; conversationId: string }
  | {
      kind: "noop";
      reason: "missing_parent" | "missing_parent_session" | "not_product_dirty";
    };

/**
 * Edit hook arm target (afterFileEdit / PostToolUse):
 * - no parent field, or parent === self → today's self cid (ambient allowed)
 * - distinct parent + existing session → that parent (exist-only; no invent)
 * - distinct parent + missing session → noop
 * - blank self + distinct existing parent → parent (exist-only)
 */
export function resolveEditArmTarget(
  store: Pick<StateStore, "getSession">,
  opts: {
    conversationId: string;
    parentConversationId?: string | null;
  },
): EditArmTarget {
  const self = cleanId(opts.conversationId);
  const parent = cleanId(opts.parentConversationId ?? null);

  // Hosts often echo parent_conversation_id === conversation_id in the parent
  // context — that is not a cross-session parent link.
  if (parent && self && parent !== self) {
    if (!store.getSession(parent)) {
      return { kind: "noop", reason: "missing_parent_session" };
    }
    return { kind: "parent", conversationId: parent };
  }

  if (!self) {
    if (!parent) return { kind: "noop", reason: "blank_self" };
    if (!store.getSession(parent)) {
      return { kind: "noop", reason: "missing_parent_session" };
    }
    return { kind: "parent", conversationId: parent };
  }
  return { kind: "self", conversationId: self };
}

/**
 * Product dirty for subagent stop: product paths ∩ (modified_files ∪ git dirty).
 * Empty `modified_files` does **not** short-circuit — still probes git.
 */
export function hasProductDirtyFromFilesOrGit(
  projectRoot: string,
  modifiedFiles?: readonly string[] | null,
): boolean {
  const root = typeof projectRoot === "string" ? projectRoot.trim() : "";
  if (!root || root.includes("\0")) return false;

  const files = Array.isArray(modifiedFiles) ? modifiedFiles : [];
  // Bound by index so non-string entries cannot bypass the scan cap.
  const limit = Math.min(files.length, MAX_MODIFIED_FILES_SCAN);
  for (let i = 0; i < limit; i++) {
    const raw = files[i];
    if (typeof raw !== "string") continue;
    const filePath = raw.trim();
    if (!filePath || filePath.includes("\0")) continue;
    if (isProductCodeEdit(filePath, { projectRoot: root })) {
      return true;
    }
  }

  try {
    return hasDirtyProductCode(root);
  } catch {
    return false;
  }
}

/**
 * Subagent stop arm target (Cursor subagentStop / Claude SubagentStop):
 * - missing parent → noop
 * - parent session missing → noop (never invent)
 * - not product dirty → noop
 * - else → parent (caller may markCodeEdited even when paused — sticky;
 *   parent === conversation_id is OK when the host fires in parent context)
 */
export function resolveSubagentStopArmTarget(
  store: Pick<StateStore, "getSession">,
  opts: {
    conversationId?: string | null;
    parentConversationId?: string | null;
    projectRoot: string;
    modifiedFiles?: readonly string[] | null;
  },
): SubagentStopArmTarget {
  const parent = cleanId(opts.parentConversationId ?? null);
  if (!parent) {
    return { kind: "noop", reason: "missing_parent" };
  }
  if (!store.getSession(parent)) {
    return { kind: "noop", reason: "missing_parent_session" };
  }
  if (!hasProductDirtyFromFilesOrGit(opts.projectRoot, opts.modifiedFiles)) {
    return { kind: "noop", reason: "not_product_dirty" };
  }
  return { kind: "parent", conversationId: parent };
}
