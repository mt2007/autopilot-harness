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

export class StateStore {
  readonly db: SqlDatabase;
  readonly projectRoot: string;

  constructor(projectRoot: string, dbPath?: string) {
    this.projectRoot = path.resolve(projectRoot);
    const resolved = dbPath ?? path.join(this.projectRoot, ".autopilot", "state.db");
    this.db = openDatabase(resolved);
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
      this.db
        .prepare(
          `INSERT INTO sessions (
            conversation_id, platform, track_id, checklist_path, phase, armed, paused,
            project_root, code_root, last_active_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          partial.conversation_id,
          partial.platform ?? "cursor",
          partial.track_id ?? "_pending",
          partial.checklist_path ?? "",
          partial.phase ?? "idle",
          partial.armed ?? 0,
          partial.paused ?? 0,
          partial.project_root,
          partial.code_root,
          ts,
          ts,
        );
    } else {
      const merged = { ...existing, ...partial, updated_at: ts, last_active_at: ts };
      this.db
        .prepare(
          `UPDATE sessions SET
            platform = ?, session_title = ?, track_id = ?, track_title = ?, checklist_path = ?,
            phase = ?, armed = ?, paused = ?, paused_reason = ?, pending_action = ?,
            track_candidates_json = ?, project_root = ?, code_root = ?,
            error_count = ?, idle_stop_count = ?, last_active_at = ?, updated_at = ?
           WHERE conversation_id = ?`,
        )
        .run(
          merged.platform,
          merged.session_title,
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

  static openMemory(projectRoot: string): StateStore {
    return new StateStore(projectRoot, ":memory:");
  }
}

export { getLatestSchemaVersion };
