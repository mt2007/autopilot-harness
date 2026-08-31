import fs from "node:fs";
import path from "node:path";
import { migrate, getLatestSchemaVersion, parseSchemaVersionValue } from "./migrate.js";
import {
  isLexicallyInsideProject,
  isRealpathInsideProject,
  normalizeProjectRoot,
} from "./project-path.js";
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
  pending_followup: string | null;
  pending_followup_at: string | null;
  pending_redeliver_at: string | null;
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
    // Trim before resolve — padded absolute roots become cwd-relative otherwise.
    const root = normalizeProjectRoot(projectRoot);
    if (!root) {
      throw new Error("Invalid project root");
    }
    this.projectRoot = path.resolve(root);
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
      .get() as { value: string } | undefined;
    return parseSchemaVersionValue(row?.value);
  }

  ensureReviewChain(conversationId: string): ReviewChainRow {
    if (this.isInvalidConversationId(conversationId)) {
      throw new Error("Invalid conversation id");
    }
    const ts = nowIso();
    // INSERT OR IGNORE + EXISTS: refuse orphans without a session; concurrent
    // creators are idempotent (plain INSERT would UNIQUE-fail on the PK).
    this.insertReviewChainIfSession(conversationId, ts);

    // Covers: no session, purge race after insert, and stale orphan chain rows.
    if (!this.getSession(conversationId)) {
      // Only delete while still session-less (avoids wiping a concurrent recreate).
      this.db
        .prepare(
          `DELETE FROM review_chains
           WHERE conversation_id = ?
             AND NOT EXISTS (SELECT 1 FROM sessions WHERE conversation_id = ?)`,
        )
        .run(conversationId, conversationId);
      throw new Error("No session for conversation");
    }
    // Re-read after session check so a concurrent INSERT is not missed.
    let ensured = this.getReviewChain(conversationId);
    if (!ensured) {
      // Session present but chain gone (e.g. purge deleted chain first) — retry once.
      this.insertReviewChainIfSession(conversationId, ts);
      ensured = this.getReviewChain(conversationId);
    }
    if (!ensured) {
      throw new Error("No session for conversation");
    }
    return ensured;
  }

  /** Reject blank, padded, or control-bearing conversation ids (align resolveSessionId). */
  private isInvalidConversationId(conversationId: unknown): boolean {
    return (
      typeof conversationId !== "string" ||
      !conversationId.trim() ||
      conversationId !== conversationId.trim() ||
      /[\u0000-\u001f\u007f]/.test(conversationId)
    );
  }

  /** Public gate for hooks / stop handlers (fail-soft before any mutation). */
  isConversationIdOk(conversationId: unknown): boolean {
    return !this.isInvalidConversationId(conversationId);
  }

  private insertReviewChainIfSession(
    conversationId: string,
    ts: string,
  ): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO review_chains (conversation_id, fix_round, confirm_left, chain_pending, code_edited, item_confirm_complete, updated_at)
         SELECT ?, 0, NULL, 0, 0, 0, ?
         WHERE EXISTS (SELECT 1 FROM sessions WHERE conversation_id = ?)`,
      )
      .run(conversationId, ts, conversationId);
  }

  getReviewChain(conversationId: string): ReviewChainRow | null {
    const row = this.db
      .prepare("SELECT * FROM review_chains WHERE conversation_id = ?")
      .get(conversationId) as ReviewChainRow | undefined;
    if (!row) return null;
    return {
      ...row,
      pending_followup: row.pending_followup ?? null,
      pending_followup_at: row.pending_followup_at ?? null,
      pending_redeliver_at: row.pending_redeliver_at ?? null,
    };
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
    if (this.isInvalidConversationId(conversationId)) {
      return null;
    }
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
  purgeSession(
    conversationId: string,
    /**
     * Optional guard evaluated inside the write transaction (re-check after races).
     * Return false to skip delete without error.
     */
    ifRow?: (row: SessionRow) => boolean,
  ): boolean {
    return this.exclusiveWrite(() => {
      const row = this.getSession(conversationId);
      if (!row) {
        return { commit: false, value: false };
      }
      if (ifRow && !ifRow(row)) {
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
   * Reset review chain fields (same as REPLAN / fresh applyRun review reset).
   * Clears pending_followup* so a later stop cannot redeliver a stale prompt and
   * resurrect chain_pending after the caller believed the chain was wiped.
   * Session row kept. Atomic: refuses orphan review_chains if session was purged.
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
        pending_followup: null,
        pending_followup_at: null,
        pending_redeliver_at: null,
      });
      return { commit: true, value: true };
    });
  }

  /**
   * Pin untrusted session roots to this store's projectRoot.
   * Otherwise a caller could write project_root=/evil and later containment
   * checks that trust session.project_root would pass for outside files.
   * code_root may be a descendant (future worktree); project_root must match.
   * Relative paths resolve against the store root (not process.cwd()).
   */
  private sanitizeSessionRoot(
    raw: string,
    opts?: { allowDescendant?: boolean },
  ): string {
    const n = normalizeProjectRoot(raw);
    if (!n) return this.projectRoot;
    const resolved = path.isAbsolute(n)
      ? path.resolve(n)
      : path.resolve(this.projectRoot, n);
    if (resolved === this.projectRoot) return this.projectRoot;
    if (
      opts?.allowDescendant &&
      isLexicallyInsideProject(this.projectRoot, resolved)
    ) {
      return resolved;
    }
    return this.projectRoot;
  }

  /**
   * Refuse checklist_path that escapes the store project (absolute outside or
   * relative that resolves outside). Missing paths kept only if lexically inside.
   * Relative inputs stay relative when allowed (callers/tests rely on that form).
   */
  private sanitizeChecklistPath(raw: string | undefined | null): string {
    if (typeof raw !== "string" || !raw || raw.includes("\0")) return "";
    if (path.isAbsolute(raw)) {
      const abs = path.resolve(raw);
      try {
        fs.lstatSync(abs);
        return isRealpathInsideProject(this.projectRoot, abs) ? abs : "";
      } catch {
        return isLexicallyInsideProject(this.projectRoot, abs) ? abs : "";
      }
    }
    const abs = path.resolve(this.projectRoot, raw);
    try {
      fs.lstatSync(abs);
      return isRealpathInsideProject(this.projectRoot, abs) ? raw : "";
    } catch {
      return isLexicallyInsideProject(this.projectRoot, abs) ? raw : "";
    }
  }

  upsertSession(
    partial: Partial<SessionRow> & {
      conversation_id: string;
      project_root: string;
      code_root: string;
    },
  ): SessionRow {
    if (this.isInvalidConversationId(partial.conversation_id)) {
      throw new Error("Invalid conversation id");
    }
    const ts = nowIso();
    // Heal padded/NUL + refuse roots that escape this store's project.
    const projectRoot = this.sanitizeSessionRoot(partial.project_root);
    const codeRoot = this.sanitizeSessionRoot(partial.code_root, {
      allowDescendant: true,
    });
    const checklistPath =
      partial.checklist_path !== undefined
        ? this.sanitizeChecklistPath(partial.checklist_path)
        : undefined;
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
          checklistPath ?? "",
          partial.phase ?? "idle",
          partial.armed ?? 0,
          partial.paused ?? 0,
          partial.paused_reason ?? null,
          partial.pending_action ?? null,
          partial.track_candidates_json ?? null,
          projectRoot,
          codeRoot,
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
      const nextProjectRoot = this.sanitizeSessionRoot(merged.project_root);
      const nextCodeRoot = this.sanitizeSessionRoot(merged.code_root, {
        allowDescendant: true,
      });
      const nextChecklistPath = this.sanitizeChecklistPath(merged.checklist_path);
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
          nextChecklistPath,
          merged.phase,
          merged.armed,
          merged.paused,
          merged.paused_reason,
          merged.pending_action,
          merged.track_candidates_json,
          nextProjectRoot,
          nextCodeRoot,
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
    // Use ensure's return — avoids a second read that can race to null mid-purge.
    const current = this.ensureReviewChain(conversationId);
    const merged = { ...current, ...patch, updated_at: nowIso() };
    // Align with savePendingFollowup: blank/NUL must not stay redeliverable.
    // Also drop chain_pending so a rejected pending cannot leave the review loop armed.
    if (
      typeof merged.pending_followup === "string" &&
      (!merged.pending_followup.trim() || merged.pending_followup.includes("\0"))
    ) {
      merged.pending_followup = null;
      merged.pending_followup_at = null;
      merged.pending_redeliver_at = null;
      merged.chain_pending = 0;
    }
    const result = this.db
      .prepare(
        `UPDATE review_chains SET
          fix_round = ?, confirm_left = ?, chain_pending = ?, code_edited = ?,
          item_confirm_complete = ?,
          pending_followup = ?, pending_followup_at = ?, pending_redeliver_at = ?,
          updated_at = ?
         WHERE conversation_id = ?
           AND EXISTS (SELECT 1 FROM sessions WHERE conversation_id = ?)`,
      )
      .run(
        merged.fix_round,
        merged.confirm_left,
        merged.chain_pending,
        merged.code_edited,
        merged.item_confirm_complete,
        merged.pending_followup,
        merged.pending_followup_at,
        merged.pending_redeliver_at,
        merged.updated_at,
        conversationId,
        conversationId,
      );
    // Purge race after ensure: do not leave a silently-updated orphan chain.
    if (result.changes === 0) {
      throw new Error("No session for conversation");
    }
    const updated = this.getReviewChain(conversationId);
    if (!updated) {
      throw new Error("No session for conversation");
    }
    return updated;
  }

  markCodeEdited(conversationId: string): void {
    this.withSessionChainWrite(conversationId, () => {
      this.ensureReviewChain(conversationId);
      // Column-only update — avoid read-merge-write clobbering concurrent E4/pending.
      this.db
        .prepare(
          `UPDATE review_chains SET code_edited = 1, updated_at = ?
           WHERE conversation_id = ?
             AND EXISTS (SELECT 1 FROM sessions WHERE conversation_id = ?)`,
        )
        .run(nowIso(), conversationId, conversationId);
    });
  }

  /**
   * E8: user ordinary chat clears the in-chain flag only.
   * Do NOT wipe pending_followup* — undelivered automation must still redeliver;
   * clearing pending here would let the next stop advance confirm_left (skip a lens).
   * Column-only UPDATE (no ensure/merge): missing chain → no-op; concurrent stop
   * cannot lose confirm_left/pending via stale read-merge-write.
   */
  clearChainPending(conversationId: string): void {
    if (this.isInvalidConversationId(conversationId)) {
      return;
    }
    this.db
      .prepare(
        `UPDATE review_chains SET chain_pending = 0, updated_at = ? WHERE conversation_id = ?`,
      )
      .run(nowIso(), conversationId);
  }

  setChainPending(conversationId: string): void {
    this.withSessionChainWrite(conversationId, () => {
      this.ensureReviewChain(conversationId);
      this.db
        .prepare(
          `UPDATE review_chains SET chain_pending = 1, updated_at = ?
           WHERE conversation_id = ?
             AND EXISTS (SELECT 1 FROM sessions WHERE conversation_id = ?)`,
        )
        .run(nowIso(), conversationId, conversationId);
    });
  }

  savePendingFollowup(
    conversationId: string,
    message: string,
    opts?: { armChain?: boolean },
  ): void {
    const msg = typeof message === "string" ? message.trim() : "";
    // Blank or NUL-poisoned text must not become a redeliverable pending.
    if (!msg || msg.includes("\0")) return;
    const armChain = opts?.armChain !== false;
    this.withSessionChainWrite(conversationId, () => {
      this.ensureReviewChain(conversationId);
      const ts = nowIso();
      const sql = armChain
        ? `UPDATE review_chains SET
          pending_followup = ?, pending_followup_at = ?, pending_redeliver_at = NULL,
          chain_pending = 1, updated_at = ?
         WHERE conversation_id = ?
           AND EXISTS (SELECT 1 FROM sessions WHERE conversation_id = ?)`
        : `UPDATE review_chains SET
          pending_followup = ?, pending_followup_at = ?, pending_redeliver_at = NULL,
          updated_at = ?
         WHERE conversation_id = ?
           AND EXISTS (SELECT 1 FROM sessions WHERE conversation_id = ?)`;
      this.db.prepare(sql).run(msg, ts, ts, conversationId, conversationId);
    });
  }

  clearPendingFollowup(conversationId: string): void {
    if (this.isInvalidConversationId(conversationId)) {
      return;
    }
    this.db
      .prepare(
        `UPDATE review_chains SET
          pending_followup = NULL, pending_followup_at = NULL, pending_redeliver_at = NULL,
          updated_at = ?
         WHERE conversation_id = ?`,
      )
      .run(nowIso(), conversationId);
  }

  /**
   * Atomically clear pending only when the live row still matches `pred`.
   * Avoids read-then-clear TOCTOU: a concurrent stop may replace recover with
   * fix/confirm between getReviewChain and clearPendingFollowup.
   * Safe inside an open exclusiveWrite (runs inline; no nest).
   */
  clearPendingFollowupIf(
    conversationId: string,
    pred: (message: string) => boolean,
  ): boolean {
    if (this.isInvalidConversationId(conversationId)) {
      return false;
    }
    if (typeof pred !== "function") {
      return false;
    }
    const run = (): boolean => {
      const pending =
        this.getReviewChain(conversationId)?.pending_followup?.trim() ?? "";
      if (!pending) {
        return false;
      }
      let matched = false;
      try {
        const raw = pred(pending);
        // Refuse thenables — async preds must not clear under a write lock.
        if (
          raw !== null &&
          typeof raw === "object" &&
          typeof (raw as { then?: unknown }).then === "function"
        ) {
          return false;
        }
        matched = Boolean(raw);
      } catch {
        return false;
      }
      if (!matched) {
        return false;
      }
      this.db
        .prepare(
          `UPDATE review_chains SET
            pending_followup = NULL, pending_followup_at = NULL, pending_redeliver_at = NULL,
            updated_at = ?
           WHERE conversation_id = ?`,
        )
        .run(nowIso(), conversationId);
      return true;
    };
    if (this.writeDepth > 0) {
      return run();
    }
    return this.exclusiveWrite(() => {
      const ok = run();
      return { commit: ok, value: ok };
    });
  }

  /**
   * Column-only: neutralize fix/confirm/pending re-entry without ensure/session.
   * Used when pause-threshold upsert failed but the session is still armed — a
   * later completed stop must not resume the review loop via code_edited/pending
   * or loopCount>0→E3 (fix_round cleared so bare loopCount cannot re-arm).
   */
  neutralizeReviewChain(conversationId: string): void {
    if (this.isInvalidConversationId(conversationId)) {
      return;
    }
    this.db
      .prepare(
        `UPDATE review_chains SET
          code_edited = 0,
          confirm_left = NULL,
          chain_pending = 0,
          item_confirm_complete = 0,
          fix_round = 0,
          pending_followup = NULL,
          pending_followup_at = NULL,
          pending_redeliver_at = NULL,
          updated_at = ?
         WHERE conversation_id = ?`,
      )
      .run(nowIso(), conversationId);
  }

  /**
   * Column-only pause/disarm when the full upsertSession pause write failed.
   * Without this, loopCount>0 completed stops can still hit E3 while armed.
   */
  pauseSessionForRepeatedErrors(
    conversationId: string,
    errorCount: number,
    lastError: string | null,
  ): void {
    if (this.isInvalidConversationId(conversationId)) {
      return;
    }
    const count =
      typeof errorCount === "number" && Number.isFinite(errorCount)
        ? Math.max(0, Math.floor(errorCount))
        : 0;
    const err =
      typeof lastError === "string" && !lastError.includes("\0")
        ? lastError
        : null;
    const ts = nowIso();
    this.db
      .prepare(
        `UPDATE sessions SET
          armed = 0,
          paused = 1,
          paused_reason = 'repeated_errors',
          error_count = ?,
          last_error = ?,
          last_active_at = ?,
          updated_at = ?
         WHERE conversation_id = ?`,
      )
      .run(count, err, ts, ts, conversationId);
  }

  /**
   * Fallback halt when richer pause UPDATE threw/no-op'd.
   * Always drops armed; ensures paused=1. Preserves an existing paused_reason
   * (e.g. concurrent stuck/human_gate, or richer pause already wrote) via
   * COALESCE — only fills repeated_errors when reason was null.
   * Leaves error_count/last_error to the richer pause path.
   */
  disarmSession(conversationId: string): void {
    if (this.isInvalidConversationId(conversationId)) {
      return;
    }
    this.db
      .prepare(
        `UPDATE sessions SET
          armed = 0,
          paused = 1,
          paused_reason = COALESCE(paused_reason, 'repeated_errors'),
          updated_at = ?
         WHERE conversation_id = ?`,
      )
      .run(nowIso(), conversationId);
  }

  touchPendingRedeliver(conversationId: string): void {
    this.withSessionChainWrite(conversationId, () => {
      this.ensureReviewChain(conversationId);
      const ts = nowIso();
      // Require live pending — after neutralize/clear, must not resurrect
      // chain_pending=1 (would E3 on RESUME with no undelivered message).
      this.db
        .prepare(
          `UPDATE review_chains SET
          pending_redeliver_at = ?, chain_pending = 1, updated_at = ?
         WHERE conversation_id = ?
           AND pending_followup IS NOT NULL
           AND trim(pending_followup) != ''
           AND EXISTS (SELECT 1 FROM sessions WHERE conversation_id = ?)`,
        )
        .run(ts, ts, conversationId, conversationId);
    });
  }

  /**
   * Run fn only when session exists. Uses exclusiveWrite when not already in one
   * (serialize vs purge); if already nested in a write txn, runs inline — nesting
   * exclusiveWrite would throw.
   */
  private withSessionChainWrite(
    conversationId: string,
    fn: () => void,
  ): void {
    if (this.isInvalidConversationId(conversationId)) {
      return;
    }
    const run = (): boolean => {
      if (!this.getSession(conversationId)) return false;
      fn();
      return true;
    };
    if (this.writeDepth > 0) {
      run();
      return;
    }
    this.exclusiveWrite(() => {
      const ok = run();
      return { commit: ok, value: undefined };
    });
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
