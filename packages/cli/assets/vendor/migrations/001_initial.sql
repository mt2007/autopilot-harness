CREATE TABLE IF NOT EXISTS _schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace (
  root_path TEXT PRIMARY KEY,
  token_hash TEXT,
  platform TEXT NOT NULL,
  surface TEXT NOT NULL DEFAULT 'ide',
  integration TEXT NOT NULL DEFAULT 'hook',
  locale TEXT NOT NULL DEFAULT 'en',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  conversation_id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  session_title TEXT,
  session_title_source TEXT,
  title_updated_at TEXT,
  track_id TEXT NOT NULL DEFAULT '_pending',
  track_title TEXT,
  checklist_path TEXT NOT NULL DEFAULT '',
  phase TEXT NOT NULL DEFAULT 'idle',
  armed INTEGER NOT NULL DEFAULT 0,
  paused INTEGER NOT NULL DEFAULT 0,
  paused_reason TEXT,
  pending_action TEXT,
  track_candidates_json TEXT,
  project_root TEXT NOT NULL,
  code_root TEXT NOT NULL,
  worktree_path TEXT,
  worktree_branch TEXT,
  error_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  idle_stop_count INTEGER NOT NULL DEFAULT 0,
  cli_bound_at TEXT,
  last_active_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tracks (
  track_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  checklist_path TEXT NOT NULL,
  plan_path TEXT,
  brief_path TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_chains (
  conversation_id TEXT PRIMARY KEY,
  fix_round INTEGER NOT NULL DEFAULT 0,
  confirm_left INTEGER,
  chain_pending INTEGER NOT NULL DEFAULT 0,
  code_edited INTEGER NOT NULL DEFAULT 0,
  item_confirm_complete INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO _schema_meta (key, value) VALUES ('schema_version', '1');
