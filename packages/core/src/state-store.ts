import path from "node:path";
import { migrate, getLatestSchemaVersion } from "./migrate.js";
import { openDatabase, type SqlDatabase } from "./sqlite.js";

export type Phase = "idle" | "planning" | "executing" | "done";
export type PausedReason = "stuck" | "repeated_errors" | "human_gate";

export interface SessionRow {
  conversation_id: string;
  platform: string;
  session_title: string | null;
  session_title_source: string | null;
  title_updated_at: string | null;
  track_id: string;
  track_title: string | null;
  checklist_path: string;
  phase: Phase;
  armed: number;
  paused: number;
  paused_reason: string | null;
  pending_action: string | null;
  track_candidates_json: string | null;
  project_root: string;
  code_root: string;
  worktree_path: string | null;
  worktree_branch: string | null;
  error_count: number;
  last_error: string | null;
  idle_stop_count: number;
  cli_bound_at: string | null;
  last_active_at: string;
  updated_at: string;
}

export interface ReviewChainRow {
  conversation_id: string;
  fix_round: number;
  confirm_left: number | null;
  chain_pending: number;
  code_edited: number;
  item_confirm_complete: number;
  updated_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Stable short id for CLI tables (first 8 chars of dehyphenated conversation_id). */
export function shortConversationId(conversationId: string): string {
  return conversationId.replace(/-/g, "").slice(0, 8);
}

/** Max length for user/platform session titles (characters). */
export const SESSION_TITLE_MAX_LENGTH = 200;

const TITLE_CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Normalize and validate a session title; throws on empty/too long/controls. */
export function normalizeSessionTitle(title: string): string {
  if (typeof title !== "string") {
    throw new Error("Title must be a non-empty string");
  }
  const trimmed = title.trim();
  if (!trimmed) {
    throw new Error("Title must be a non-empty string");
  }
  if (TITLE_CONTROL_CHARS.test(trimmed)) {
    throw new Error("Title must not contain control characters");
  }
  if (trimmed.length > SESSION_TITLE_MAX_LENGTH) {
    throw new Error(
      `Title exceeds ${SESSION_TITLE_MAX_LENGTH} characters`,
    );
  }
  return trimmed;
}

/** Collapse controls for single-line CLI table cells (platform titles may be dirty). */
export function sanitizeSessionDisplayText(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/ +/g, " ").trim();
}

export class StateStore {
  readonly db: SqlDatabase;
  readonly projectRoot: string;
  private writeDepth = 0;

  constructor(projectRoot: string, dbPath?: string) {
    this.projectRoot = path.resolve(projectRoot);
    const resolved = dbPath ?? path.join(this.projectRoot, ".autopilot", "state.db");
    this.db = openDatabase(resolved);
    try {
      // Wait on locks so concurrent BEGIN IMMEDIATE (one_executor) can serialize
      // instead of failing immediately with SQLITE_BUSY.
      this.db.pragma("busy_timeout = 5000");
    } catch {
      /* node:sqlite may ignore */
    }
    if (resolved !== ":memory:") {
      try {
        this.db.pragma("journal_mode = WAL");
      } catch {
        /* node:sqlite may ignore */
      }
    }
    migrate(this.db);
  }

  close(): void {
    this.db.close();
  }

  getSchemaVersion(): number {
    const row = this.db
      .prepare("SELECT value FROM _schema_meta WHERE key = 'schema_version'")
      .get() as { value: string };
    return Number.parseInt(row.value, 10);
  }

  ensureReviewChain(conversationId: string): ReviewChainRow {
    const existing = this.getReviewChain(conversationId);
    if (existing) return existing;
    const ts = nowIso();
    this.db
      .prepare(
        `INSERT INTO review_chains (conversation_id, fix_round, confirm_left, chain_pending, code_edited, item_confirm_complete, updated_at)
         VALUES (?, 0, NULL, 0, 0, 0, ?)`,
      )
      .run(conversationId, ts);
    return this.getReviewChain(conversationId)!;
  }

  getReviewChain(conversationId: string): ReviewChainRow | null {
    return (
      (this.db
        .prepare("SELECT * FROM review_chains WHERE conversation_id = ?")
        .get(conversationId) as ReviewChainRow | undefined) ?? null
    );
  }

  getSession(conversationId: string): SessionRow | null {
    return (
      (this.db
        .prepare("SELECT * FROM sessions WHERE conversation_id = ?")
        .get(conversationId) as SessionRow | undefined) ?? null
    );
  }

  listSessions(): SessionRow[] {
    return this.db
      .prepare(
        "SELECT * FROM sessions ORDER BY last_active_at DESC, conversation_id ASC",
      )
      .all() as SessionRow[];
  }

  /**
   * Resolve a full conversation_id or a unique prefix / short id (first 8 hex-ish chars).
   */
  resolveSessionId(
    query: string,
  ): { ok: true; id: string } | { ok: false; error: string } {
    const q = query.trim();
    if (!q) {
      return { ok: false, error: "Session id required" };
    }
    if (/[\u0000-\u001f\u007f]/.test(q)) {
      return {
        ok: false,
        error: "Session id must not contain control characters",
      };
    }
    if (this.getSession(q)) {
      return { ok: true, id: q };
    }
    const matches = this.listSessions().filter((s) => {
      const id = s.conversation_id;
      return id.startsWith(q) || shortConversationId(id) === q;
    });
    if (matches.length === 1) {
      return { ok: true, id: matches[0]!.conversation_id };
    }
    if (matches.length === 0) {
      return { ok: false, error: `No session matching "${q}"` };
    }
    return {
      ok: false,
      error: `Ambiguous id "${q}" matches ${matches.length} sessions; use a longer prefix`,
    };
  }

  renameSession(conversationId: string, title: string): SessionRow | null {
    const trimmed = normalizeSessionTitle(title);
    return this.exclusiveWrite(() => {
      if (!this.getSession(conversationId)) {
        return { commit: false, value: null };
      }
      const ts = nowIso();
      this.db
        .prepare(
          `UPDATE sessions SET
            session_title = ?, session_title_source = 'user', title_updated_at = ?,
            updated_at = ?
           WHERE conversation_id = ?`,
        )
        .run(trimmed, ts, ts, conversationId);
      return { commit: true, value: this.getSession(conversationId) };
    });
  }

  /** Delete session row and its review_chains row (atomic). */
  purgeSession(conversationId: string): boolean {
    return this.exclusiveWrite(() => {
      if (!this.getSession(conversationId)) {
        return { commit: false, value: false };
      }
      this.db
        .prepare("DELETE FROM review_chains WHERE conversation_id = ?")
        .run(conversationId);
      this.db
        .prepare("DELETE FROM sessions WHERE conversation_id = ?")
        .run(conversationId);
      return { commit: true, value: true };
    });
  }

  /**
   * Reset review chain fields (same as REPLAN review reset). Session row kept.
   * Atomic: refuses to create an orphan review_chains row if the session was purged.
   */
  resetReviewChain(conversationId: string): boolean {
    return this.exclusiveWrite(() => {
      if (!this.getSession(conversationId)) {
        return { commit: false, value: false };
      }
      this.updateReviewChain(conversationId, {
        fix_round: 0,
        confirm_left: null,
        chain_pending: 0,
        code_edited: 0,
        item_confirm_complete: 0,
      });
      return { commit: true, value: true };
    });
  }

  upsertSession(
    partial: Partial<SessionRow> & {
      conversation_id: string;
      project_root: string;
      code_root: string;
    },
  ): SessionRow {
    const ts = nowIso();
    const existing = this.getSession(partial.conversation_id);
    if (!existing) {
      // Only renameSession may grant source=user (validated title). Upsert must not.
      const insertSource =
        partial.session_title_source === "user"
          ? "platform"
          : (partial.session_title_source ?? null);
      this.db
        .prepare(
          `INSERT INTO sessions (
            conversation_id, platform, session_title, session_title_source, title_updated_at,
            track_id, track_title, checklist_path, phase, armed, paused,
            paused_reason, pending_action, track_candidates_json,
            project_root, code_root, last_active_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          partial.conversation_id,
          partial.platform ?? "cursor",
          partial.session_title ?? null,
          insertSource,
          partial.title_updated_at ?? null,
          partial.track_id ?? "_pending",
          partial.track_title ?? null,
          partial.checklist_path ?? "",
          partial.phase ?? "idle",
          partial.armed ?? 0,
          partial.paused ?? 0,
          partial.paused_reason ?? null,
          partial.pending_action ?? null,
          partial.track_candidates_json ?? null,
          partial.project_root,
          partial.code_root,
          ts,
          ts,
        );
    } else {
      const merged = { ...existing, ...partial, updated_at: ts, last_active_at: ts };
      // Preserve user titles at UPDATE time (not via a stale in-memory read):
      // concurrent renameSession can flip source to 'user' between getSession and
      // this write; CASE keeps the row's current user title fields atomically.
      // Upsert must not elevate source to 'user' either (ELSE bind coerced).
      const upsertSource =
        merged.session_title_source === "user"
          ? "platform"
          : merged.session_title_source;
      this.db
        .prepare(
          `UPDATE sessions SET
            platform = ?,
            session_title = CASE WHEN session_title_source = 'user' THEN session_title ELSE ? END,
            session_title_source = CASE WHEN session_title_source = 'user' THEN session_title_source ELSE ? END,
            title_updated_at = CASE WHEN session_title_source = 'user' THEN title_updated_at ELSE ? END,
            track_id = ?, track_title = ?, checklist_path = ?,
            phase = ?, armed = ?, paused = ?, paused_reason = ?, pending_action = ?,
            track_candidates_json = ?, project_root = ?, code_root = ?,
            error_count = ?, idle_stop_count = ?, last_active_at = ?, updated_at = ?
           WHERE conversation_id = ?`,
        )
        .run(
          merged.platform,
          merged.session_title,
          upsertSource,
          merged.title_updated_at,
          merged.track_id,
          merged.track_title,
          merged.checklist_path,
          merged.phase,
          merged.armed,
          merged.paused,
          merged.paused_reason,
          merged.pending_action,
          merged.track_candidates_json,
          merged.project_root,
          merged.code_root,
          merged.error_count,
          merged.idle_stop_count,
          merged.last_active_at,
          merged.updated_at,
          partial.conversation_id,
        );
    }
    return this.getSession(partial.conversation_id)!;
  }

  updateReviewChain(conversationId: string, patch: Partial<ReviewChainRow>): ReviewChainRow {
    this.ensureReviewChain(conversationId);
    const current = this.getReviewChain(conversationId)!;
    const merged = { ...current, ...patch, updated_at: nowIso() };
    this.db
      .prepare(
        `UPDATE review_chains SET
          fix_round = ?, confirm_left = ?, chain_pending = ?, code_edited = ?,
          item_confirm_complete = ?, updated_at = ?
         WHERE conversation_id = ?`,
      )
      .run(
        merged.fix_round,
        merged.confirm_left,
        merged.chain_pending,
        merged.code_edited,
        merged.item_confirm_complete,
        merged.updated_at,
        conversationId,
      );
    return this.getReviewChain(conversationId)!;
  }

  markCodeEdited(conversationId: string): void {
    this.ensureReviewChain(conversationId);
    this.updateReviewChain(conversationId, { code_edited: 1 });
  }

  clearChainPending(conversationId: string): void {
    this.ensureReviewChain(conversationId);
    this.updateReviewChain(conversationId, { chain_pending: 0 });
  }

  setChainPending(conversationId: string): void {
    this.ensureReviewChain(conversationId);
    this.updateReviewChain(conversationId, { chain_pending: 1 });
  }

  findExecutingSession(excludeConversationId: string): SessionRow | null {
    return (
      (this.db
        .prepare(
          `SELECT * FROM sessions
           WHERE phase = 'executing' AND armed = 1 AND paused = 0
             AND conversation_id != ?
           LIMIT 1`,
        )
        .get(excludeConversationId) as SessionRow | undefined) ?? null
    );
  }

  /**
   * Serialize writers with BEGIN IMMEDIATE so check-then-act (e.g. one_executor)
   * and multi-statement enters stay atomic. Callback chooses commit vs rollback.
   */
  exclusiveWrite<T>(fn: () => { commit: boolean; value: T }): T {
    if (this.writeDepth > 0) {
      throw new Error("exclusiveWrite does not support nesting");
    }
    this.writeDepth += 1;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const { commit, value } = fn();
      this.db.exec(commit ? "COMMIT" : "ROLLBACK");
      return value;
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* ignore rollback errors after primary failure */
      }
      throw err;
    } finally {
      this.writeDepth -= 1;
    }
  }

  static openMemory(projectRoot: string): StateStore {
    return new StateStore(projectRoot, ":memory:");
  }
}

export { getLatestSchemaVersion };
