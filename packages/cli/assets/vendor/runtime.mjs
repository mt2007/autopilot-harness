// ../i18n/locales/en.json
var en_default = {
  preferred_name: "Autopilot",
  cli: {
    help: "Autopilot Harness \u2014 Planning \u2192 Executing agent harness"
  },
  triggers: {
    on: ["Autopilot ON", "Enable autopilot"],
    run: ["Autopilot RUN", "Start execution"],
    off: ["Autopilot OFF", "Disable autopilot"],
    resume: ["Autopilot RESUME"],
    replan: ["Autopilot REPLAN"],
    resume_review: ["Resume review"]
  },
  skill: {
    autopilot_on: {
      description: "Start Planning \u2014 discuss what to build"
    },
    autopilot_run: {
      description: "Start Executing \u2014 run checklist"
    },
    autopilot_off: {
      description: "Pause Autopilot"
    },
    autopilot_resume: {
      description: "Resume this conversation"
    },
    autopilot_replan: {
      description: "Revise plan"
    }
  },
  followup: {
    review: {
      fix: "Review fix round {round}: inspect the full diff, fix CRITICAL/HIGH issues, run relevant tests. Do not commit.",
      confirm: "Review confirm {n}/{total} \u2014 Lens ({lensTitle}): {lensFocus}. Stay on this lens only. Do not commit.",
      confirm_final: "Review confirm {n}/{total} \u2014 Lens ({lensTitle}): {lensFocus}. Read-only final lens; do not change code or commit."
    },
    advance: "Advance checklist: mark current item [x], scoped conventional commit if dirty, then implement next item: {nextId} \u2014 {nextTitle}.",
    done: "All checklist items done. Mark the last item [x], scoped commit if needed, then stop.",
    recover: "Recover: the previous turn ended with an error. Continue the current checklist item without advancing.",
    stuck: "Stuck: no progress for several stops. Change strategy or send Autopilot RESUME after fixing.",
    verify_fix: "Verify failed ({reason}). Fix verify commands and rewrite verify-last.json; do not advance.",
    track_pick: "Select a plan by number or slug."
  },
  error: {
    one_executor_busy: "Another session is already executing ({track}). OFF or wait, then retry.",
    on_while_executing: "Autopilot is executing. Send Autopilot OFF, REPLAN, or RESUME before ON."
  },
  lens: {
    "scope-correctness": {
      title: "Scope & correctness",
      focus: "Within the current checklist item scope: logic, invariants, alignment with plan.md."
    },
    boundaries: {
      title: "Boundaries & errors",
      focus: "Null/empty, bounds, error paths, failure rollback."
    },
    security: {
      title: "Security",
      focus: "Authz, injection, sensitive data, trust boundaries."
    },
    concurrency: {
      title: "Concurrency",
      focus: "Races, transactions, partial failure; N/A if inapplicable."
    },
    "tests-regression": {
      title: "Tests & regression",
      focus: "Missing tests, weak asserts, contract drift; read-only."
    }
  }
};

// ../i18n/locales/zh-CN.json
var zh_CN_default = {
  preferred_name: "Autopilot",
  cli: {
    help: "Autopilot Harness \u2014 \u4E24\u9636\u6BB5 Agent \u5916\u9AA8\u9ABC\uFF1A\u89C4\u5212 \u2192 \u6267\u884C"
  },
  triggers: {
    on: ["Autopilot ON", "\u5F00\u542F\u81EA\u52A8\u9A7E\u9A76"],
    run: ["Autopilot RUN", "\u5F00\u59CB\u6267\u884C"],
    off: ["Autopilot OFF", "\u5173\u95ED\u81EA\u52A8\u9A7E\u9A76"],
    resume: ["Autopilot RESUME", "\u7EE7\u7EED\u6267\u884C"],
    replan: ["Autopilot REPLAN", "\u4FEE\u6539\u65B9\u6848"],
    resume_review: ["\u7EE7\u7EED\u81EA\u5BA1", "Resume review"]
  },
  skill: {
    autopilot_on: {
      description: "\u5F00\u59CB\u89C4\u5212 \u2014 \u8BA8\u8BBA\u8981\u505A\u4EC0\u4E48"
    },
    autopilot_run: {
      description: "\u5F00\u59CB\u6267\u884C \u2014 \u8DD1 checklist"
    },
    autopilot_off: {
      description: "\u6682\u505C Autopilot"
    },
    autopilot_resume: {
      description: "\u6062\u590D\u5F53\u524D\u4F1A\u8BDD"
    },
    autopilot_replan: {
      description: "\u4FEE\u6539\u65B9\u6848"
    }
  },
  followup: {
    review: {
      fix: "\u81EA\u5BA1\u4FEE\u590D\u7B2C {round} \u8F6E\uFF1A\u68C0\u67E5\u5B8C\u6574 diff\uFF0C\u4FEE\u590D CRITICAL/HIGH\uFF0C\u8DD1\u76F8\u5173\u6D4B\u8BD5\u3002\u4E0D\u8981 commit\u3002",
      confirm: "\u81EA\u5BA1\u786E\u8BA4 {n}/{total} \u2014 \u89D2\u5EA6\uFF08{lensTitle}\uFF09\uFF1A{lensFocus}\u3002\u53EA\u5BA1\u672C\u89D2\u3002\u4E0D\u8981 commit\u3002",
      confirm_final: "\u81EA\u5BA1\u786E\u8BA4 {n}/{total} \u2014 \u89D2\u5EA6\uFF08{lensTitle}\uFF09\uFF1A{lensFocus}\u3002\u53EA\u8BFB\u7EC8\u5BA1\uFF0C\u4E0D\u8981\u6539\u4EE3\u7801\u3001\u4E0D\u8981 commit\u3002"
    },
    advance: "\u63A8\u8FDB\u4E0B\u4E00\u9879\uFF1A\u52FE\u9009\u5F53\u524D\u9879 [x]\uFF0C\u6309\u8303\u56F4 conventional commit\uFF08\u82E5\u6709\u6539\u52A8\uFF09\uFF0C\u7136\u540E\u5B9E\u73B0\u4E0B\u4E00\u9879\uFF1A{nextId} \u2014 {nextTitle}\u3002",
    done: "\u5168\u90E8\u5B8C\u6210\u3002\u52FE\u9009\u6700\u540E\u4E00\u9879 [x]\uFF0C\u5FC5\u8981\u65F6 scoped commit\uFF0C\u7136\u540E\u505C\u6B62\u3002",
    recover: "\u6062\u590D\uFF1A\u4E0A\u4E00\u56DE\u5408\u51FA\u9519\u3002\u7EE7\u7EED\u5F53\u524D checklist \u9879\uFF0C\u4E0D\u8981\u63A8\u8FDB\u3002",
    stuck: "\u5361\u4F4F\uFF1A\u8FDE\u7EED\u591A\u8F6E\u65E0\u8FDB\u5C55\u3002\u8BF7\u6362\u7B56\u7565\uFF0C\u6216\u4FEE\u597D\u540E\u53D1\u9001 Autopilot RESUME\u3002",
    verify_fix: "\u6821\u9A8C\u5931\u8D25\uFF08{reason}\uFF09\u3002\u8BF7\u4FEE\u590D verify \u547D\u4EE4\u5E76\u91CD\u5199 verify-last.json\uFF1B\u4E0D\u8981\u63A8\u8FDB\u3002",
    track_pick: "\u8BF7\u7528\u6570\u5B57\u6216 slug \u9009\u62E9\u8981\u6267\u884C\u7684 plan\u3002"
  },
  error: {
    one_executor_busy: "\u5DF2\u6709\u5176\u4ED6\u4F1A\u8BDD\u5728\u6267\u884C\uFF08{track}\uFF09\u3002\u8BF7\u5148 OFF \u6216\u7B49\u5F85\u540E\u518D\u8BD5\u3002",
    on_while_executing: "\u5F53\u524D\u6B63\u5728\u6267\u884C\u3002\u8BF7\u5148\u53D1\u9001 Autopilot OFF\u3001REPLAN \u6216 RESUME\uFF0C\u518D ON\u3002"
  },
  lens: {
    "scope-correctness": {
      title: "\u8303\u56F4\u4E0E\u6B63\u786E\u6027",
      focus: "\u4EC5\u5728\u5F53\u524D checklist \u9879\u8303\u56F4\u5185\uFF1A\u903B\u8F91\u3001\u4E0D\u53D8\u91CF\u3001\u4E0E plan.md \u4E00\u81F4\u3002"
    },
    boundaries: {
      title: "\u8FB9\u754C\u4E0E\u9519\u8BEF\u8DEF\u5F84",
      focus: "\u7A7A\u503C\u3001\u8FB9\u754C\u3001\u9519\u8BEF\u8DEF\u5F84\u3001\u5931\u8D25\u56DE\u6EDA\u3002"
    },
    security: {
      title: "\u5B89\u5168",
      focus: "\u9274\u6743/\u8D8A\u6743\u3001\u6CE8\u5165\u3001\u654F\u611F\u6570\u636E\u3001\u4FE1\u4EFB\u8FB9\u754C\u3002"
    },
    concurrency: {
      title: "\u5E76\u53D1",
      focus: "\u7ADE\u6001\u3001\u4E8B\u52A1\u3001\u90E8\u5206\u5931\u8D25\uFF1B\u4E0D\u9002\u7528\u5219 N/A\u3002"
    },
    "tests-regression": {
      title: "\u6D4B\u8BD5\u4E0E\u56DE\u5F52",
      focus: "\u7F3A\u6D4B\u3001\u65AD\u8A00\u5F31\u3001\u5951\u7EA6\u6F02\u79FB\uFF1B\u53EA\u8BFB\u3002"
    }
  }
};

// ../i18n/src/index.ts
var LOCALES = {
  en: en_default,
  "zh-CN": zh_CN_default
};
function isLocaleCode(code) {
  return code === "en" || code === "zh-CN";
}
function loadLocale(code) {
  if (isLocaleCode(code)) {
    return LOCALES[code];
  }
  return LOCALES.en;
}

// ../core/src/checklist-md.ts
import fs from "node:fs";
var ITEM_RE = /^-\s*\[([ xX])\]\s*(.+)$/;
var SEPARATOR_RE = /^(.+?)\s*(?:[—–]| - )\s*(.+)$/;
var KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
function slugify(text) {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}
function parseItemLine(line, lineNumber) {
  const m = line.match(ITEM_RE);
  if (!m) return null;
  const checked = m[1].toLowerCase() === "x";
  const body = m[2].trim();
  const sep = body.match(SEPARATOR_RE);
  if (sep) {
    const id = sep[1].trim();
    const title = sep[2].trim();
    return {
      id: KEBAB_RE.test(id) ? id : slugify(id),
      title,
      checked,
      line,
      lineNumber,
      idFromSeparator: true
    };
  }
  return {
    id: slugify(body),
    title: body,
    checked,
    line,
    lineNumber,
    idFromSeparator: false
  };
}
function parseChecklist(checklistPath) {
  const content = fs.readFileSync(checklistPath, "utf8");
  const lines = content.split(/\r?\n/);
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const item = parseItemLine(lines[i], i + 1);
    if (item) items.push(item);
  }
  return { path: checklistPath, items };
}
function countUnchecked(checklist) {
  return checklist.items.filter((i) => !i.checked).length;
}
function firstUnchecked(checklist) {
  return checklist.items.find((i) => !i.checked) ?? null;
}

// ../core/src/verify-report.ts
import fs2 from "node:fs";
import path from "node:path";
function readVerifyReport(reportPath) {
  if (!fs2.existsSync(reportPath)) return null;
  try {
    const raw = fs2.readFileSync(reportPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
function evaluateVerifyReport(options) {
  const { enabled, commands, reportPath, currentItem, checklistPath } = options;
  if (!enabled) {
    return { outcome: "skip", reason: "verify disabled" };
  }
  const commandList = Array.isArray(commands) ? commands : [];
  const requiredCommands = commandList.filter((c) => c.required === true);
  if (requiredCommands.length === 0) {
    return { outcome: "skip", reason: "no required commands" };
  }
  const report = readVerifyReport(reportPath);
  if (!report || typeof report !== "object") {
    return { outcome: "fail", reason: "missing verify report" };
  }
  if (!currentItem) {
    return { outcome: "fail", reason: "no current checklist item" };
  }
  if (typeof report.itemId !== "string" || report.itemId !== currentItem.id) {
    return { outcome: "fail", reason: "itemId mismatch" };
  }
  if (typeof report.checklistPath !== "string" || report.checklistPath !== checklistPath) {
    return { outcome: "fail", reason: "checklistPath mismatch" };
  }
  if (!Array.isArray(report.commands)) {
    return { outcome: "fail", reason: "invalid commands array" };
  }
  for (const cmd of requiredCommands) {
    const result = report.commands.find(
      (r) => !!r && typeof r === "object" && !Array.isArray(r) && r.id === cmd.id
    );
    if (!result) {
      return { outcome: "fail", reason: `missing result for ${cmd.id}` };
    }
    if (typeof result.exitCode !== "number" || !Number.isFinite(result.exitCode)) {
      return { outcome: "fail", reason: `missing exitCode for ${cmd.id}` };
    }
    if (result.exitCode !== 0) {
      return { outcome: "fail", reason: `${cmd.id} exit ${result.exitCode}` };
    }
  }
  return { outcome: "pass" };
}
function defaultVerifyReportPath(projectRoot) {
  return path.join(projectRoot, ".autopilot", "verify-last.json");
}

// ../core/src/state-store.ts
import path3 from "node:path";

// ../core/src/migrate.ts
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
var __dirname = dirname(fileURLToPath(import.meta.url));
function getLatestSchemaVersion() {
  return 1;
}
function readMigrationSql(version) {
  const filename = `${String(version).padStart(3, "0")}_initial.sql`;
  const candidates = [
    join(__dirname, "..", "migrations", filename),
    join(__dirname, "migrations", filename)
  ];
  for (const p of candidates) {
    if (existsSync(p)) return readFileSync(p, "utf8");
  }
  throw new Error(`Missing migration SQL: ${filename}`);
}
function getCurrentSchemaVersion(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  const row = db.prepare("SELECT value FROM _schema_meta WHERE key = 'schema_version'").get();
  return row ? Number.parseInt(row.value, 10) : 0;
}
function migrate(db) {
  const current = getCurrentSchemaVersion(db);
  const latest = getLatestSchemaVersion();
  if (current >= latest) {
    return current;
  }
  for (let v = current + 1; v <= latest; v++) {
    const sql = readMigrationSql(v);
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare(
        "INSERT OR REPLACE INTO _schema_meta (key, value) VALUES ('schema_version', ?)"
      ).run(String(v));
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  return latest;
}

// ../core/src/sqlite.ts
import fs3 from "node:fs";
import { createRequire } from "node:module";
import path2 from "node:path";
var require2 = createRequire(import.meta.url);
function openDatabase(filename) {
  if (filename !== ":memory:") {
    fs3.mkdirSync(path2.dirname(filename), { recursive: true });
  }
  const { DatabaseSync } = require2("node:sqlite");
  const db = new DatabaseSync(filename);
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        run: (...params) => {
          const r = stmt.run(...params);
          return { changes: r.changes ?? 0 };
        },
        get: (...params) => stmt.get(...params),
        all: (...params) => stmt.all(...params)
      };
    },
    exec: (sql) => {
      db.exec(sql);
    },
    pragma: (source) => {
      db.exec(`PRAGMA ${source}`);
      return void 0;
    },
    close: () => db.close()
  };
}

// ../core/src/state-store.ts
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function shortConversationId(conversationId) {
  return conversationId.replace(/-/g, "").slice(0, 8);
}
var SESSION_TITLE_MAX_LENGTH = 200;
var TITLE_CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
function normalizeSessionTitle(title) {
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
      `Title exceeds ${SESSION_TITLE_MAX_LENGTH} characters`
    );
  }
  return trimmed;
}
var StateStore = class _StateStore {
  db;
  projectRoot;
  writeDepth = 0;
  constructor(projectRoot, dbPath) {
    this.projectRoot = path3.resolve(projectRoot);
    const resolved = dbPath ?? path3.join(this.projectRoot, ".autopilot", "state.db");
    this.db = openDatabase(resolved);
    try {
      this.db.pragma("busy_timeout = 5000");
    } catch {
    }
    if (resolved !== ":memory:") {
      try {
        this.db.pragma("journal_mode = WAL");
      } catch {
      }
    }
    migrate(this.db);
  }
  close() {
    this.db.close();
  }
  getSchemaVersion() {
    const row = this.db.prepare("SELECT value FROM _schema_meta WHERE key = 'schema_version'").get();
    return Number.parseInt(row.value, 10);
  }
  ensureReviewChain(conversationId) {
    const existing = this.getReviewChain(conversationId);
    if (existing) return existing;
    const ts = nowIso();
    this.db.prepare(
      `INSERT INTO review_chains (conversation_id, fix_round, confirm_left, chain_pending, code_edited, item_confirm_complete, updated_at)
         VALUES (?, 0, NULL, 0, 0, 0, ?)`
    ).run(conversationId, ts);
    return this.getReviewChain(conversationId);
  }
  getReviewChain(conversationId) {
    return this.db.prepare("SELECT * FROM review_chains WHERE conversation_id = ?").get(conversationId) ?? null;
  }
  getSession(conversationId) {
    return this.db.prepare("SELECT * FROM sessions WHERE conversation_id = ?").get(conversationId) ?? null;
  }
  listSessions() {
    return this.db.prepare(
      "SELECT * FROM sessions ORDER BY last_active_at DESC, conversation_id ASC"
    ).all();
  }
  /**
   * Resolve a full conversation_id or a unique prefix / short id (first 8 hex-ish chars).
   */
  resolveSessionId(query) {
    const q = query.trim();
    if (!q) {
      return { ok: false, error: "Session id required" };
    }
    if (/[\u0000-\u001f\u007f]/.test(q)) {
      return {
        ok: false,
        error: "Session id must not contain control characters"
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
      return { ok: true, id: matches[0].conversation_id };
    }
    if (matches.length === 0) {
      return { ok: false, error: `No session matching "${q}"` };
    }
    return {
      ok: false,
      error: `Ambiguous id "${q}" matches ${matches.length} sessions; use a longer prefix`
    };
  }
  renameSession(conversationId, title) {
    const trimmed = normalizeSessionTitle(title);
    return this.exclusiveWrite(() => {
      if (!this.getSession(conversationId)) {
        return { commit: false, value: null };
      }
      const ts = nowIso();
      this.db.prepare(
        `UPDATE sessions SET
            session_title = ?, session_title_source = 'user', title_updated_at = ?,
            updated_at = ?
           WHERE conversation_id = ?`
      ).run(trimmed, ts, ts, conversationId);
      return { commit: true, value: this.getSession(conversationId) };
    });
  }
  /** Delete session row and its review_chains row (atomic). */
  purgeSession(conversationId, ifRow) {
    return this.exclusiveWrite(() => {
      const row = this.getSession(conversationId);
      if (!row) {
        return { commit: false, value: false };
      }
      if (ifRow && !ifRow(row)) {
        return { commit: false, value: false };
      }
      this.db.prepare("DELETE FROM review_chains WHERE conversation_id = ?").run(conversationId);
      this.db.prepare("DELETE FROM sessions WHERE conversation_id = ?").run(conversationId);
      return { commit: true, value: true };
    });
  }
  /**
   * Reset review chain fields (same as REPLAN review reset). Session row kept.
   * Atomic: refuses to create an orphan review_chains row if the session was purged.
   */
  resetReviewChain(conversationId) {
    return this.exclusiveWrite(() => {
      if (!this.getSession(conversationId)) {
        return { commit: false, value: false };
      }
      this.updateReviewChain(conversationId, {
        fix_round: 0,
        confirm_left: null,
        chain_pending: 0,
        code_edited: 0,
        item_confirm_complete: 0
      });
      return { commit: true, value: true };
    });
  }
  upsertSession(partial) {
    const ts = nowIso();
    const existing = this.getSession(partial.conversation_id);
    if (!existing) {
      const insertSource = partial.session_title_source === "user" ? "platform" : partial.session_title_source ?? null;
      this.db.prepare(
        `INSERT INTO sessions (
            conversation_id, platform, session_title, session_title_source, title_updated_at,
            track_id, track_title, checklist_path, phase, armed, paused,
            paused_reason, pending_action, track_candidates_json,
            project_root, code_root, last_active_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
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
        ts
      );
    } else {
      const merged = { ...existing, ...partial, updated_at: ts, last_active_at: ts };
      const upsertSource = merged.session_title_source === "user" ? "platform" : merged.session_title_source;
      this.db.prepare(
        `UPDATE sessions SET
            platform = ?,
            session_title = CASE WHEN session_title_source = 'user' THEN session_title ELSE ? END,
            session_title_source = CASE WHEN session_title_source = 'user' THEN session_title_source ELSE ? END,
            title_updated_at = CASE WHEN session_title_source = 'user' THEN title_updated_at ELSE ? END,
            track_id = ?, track_title = ?, checklist_path = ?,
            phase = ?, armed = ?, paused = ?, paused_reason = ?, pending_action = ?,
            track_candidates_json = ?, project_root = ?, code_root = ?,
            error_count = ?, idle_stop_count = ?, last_active_at = ?, updated_at = ?
           WHERE conversation_id = ?`
      ).run(
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
        partial.conversation_id
      );
    }
    return this.getSession(partial.conversation_id);
  }
  updateReviewChain(conversationId, patch) {
    this.ensureReviewChain(conversationId);
    const current = this.getReviewChain(conversationId);
    const merged = { ...current, ...patch, updated_at: nowIso() };
    this.db.prepare(
      `UPDATE review_chains SET
          fix_round = ?, confirm_left = ?, chain_pending = ?, code_edited = ?,
          item_confirm_complete = ?, updated_at = ?
         WHERE conversation_id = ?`
    ).run(
      merged.fix_round,
      merged.confirm_left,
      merged.chain_pending,
      merged.code_edited,
      merged.item_confirm_complete,
      merged.updated_at,
      conversationId
    );
    return this.getReviewChain(conversationId);
  }
  markCodeEdited(conversationId) {
    this.ensureReviewChain(conversationId);
    this.updateReviewChain(conversationId, { code_edited: 1 });
  }
  clearChainPending(conversationId) {
    this.ensureReviewChain(conversationId);
    this.updateReviewChain(conversationId, { chain_pending: 0 });
  }
  setChainPending(conversationId) {
    this.ensureReviewChain(conversationId);
    this.updateReviewChain(conversationId, { chain_pending: 1 });
  }
  findExecutingSession(excludeConversationId) {
    return this.db.prepare(
      `SELECT * FROM sessions
           WHERE phase = 'executing' AND armed = 1 AND paused = 0
             AND conversation_id != ?
           LIMIT 1`
    ).get(excludeConversationId) ?? null;
  }
  /**
   * Serialize writers with BEGIN IMMEDIATE so check-then-act (e.g. one_executor)
   * and multi-statement enters stay atomic. Callback chooses commit vs rollback.
   */
  exclusiveWrite(fn) {
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
      }
      throw err;
    } finally {
      this.writeDepth -= 1;
    }
  }
  static openMemory(projectRoot) {
    return new _StateStore(projectRoot, ":memory:");
  }
};

// ../core/src/review-engine.ts
import fs4 from "node:fs";

// ../core/src/review-lenses.ts
var CONFIRM_LENSES = {
  1: {
    key: "scope-correctness",
    title: "Scope & correctness",
    focus: "Within the current checklist item scope: logic, invariants, alignment with plan.md; out-of-scope staging is HIGH."
  },
  2: {
    key: "boundaries",
    title: "Boundaries & errors",
    focus: "Null/empty, bounds, error paths, failure rollback."
  },
  3: {
    key: "security",
    title: "Security",
    focus: "Authz, injection, sensitive data, trust boundaries."
  },
  4: {
    key: "concurrency",
    title: "Concurrency",
    focus: "Races, transactions, partial failure; N/A if inapplicable."
  },
  5: {
    key: "tests-regression",
    title: "Tests & regression",
    focus: "Missing tests, weak asserts, contract drift; read-only, no code changes."
  }
};
function lensNumberForRound(roundIndex, confirmRounds) {
  if (confirmRounds === 3) {
    const map = [1, 2, 5];
    return map[roundIndex - 1] ?? 5;
  }
  return Math.min(Math.max(roundIndex, 1), 5);
}
function getLens(roundIndex, confirmRounds) {
  const n = lensNumberForRound(roundIndex, confirmRounds);
  return CONFIRM_LENSES[n] ?? CONFIRM_LENSES[5];
}

// ../core/src/track-slug.ts
var SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
function isSafeTrackSlug(slug) {
  return typeof slug === "string" && SLUG_RE.test(slug) && !slug.includes("..") && !slug.includes("/") && !slug.includes("\\");
}

// ../core/src/review-engine.ts
function defaultRender(kind, vars) {
  switch (kind) {
    case "review.fix":
      return `Review fix round ${vars.round}: inspect the full diff, fix CRITICAL/HIGH issues, run relevant tests. Do not commit.`;
    case "review.confirm":
      return `Review confirm ${vars.n}/${vars.total} \u2014 Lens (${vars.lensTitle}): ${vars.lensFocus}. Stay on this lens only. Do not commit.`;
    case "review.confirm_final":
      return `Review confirm ${vars.n}/${vars.total} \u2014 Lens (${vars.lensTitle}): ${vars.lensFocus}. Read-only final lens; do not change code or commit.`;
    case "advance":
      return `Advance checklist: mark current item [x], scoped conventional commit if dirty, then implement next item: ${vars.nextId ?? ""} \u2014 ${vars.nextTitle ?? ""}.`;
    case "done":
      return `All checklist items done. Mark the last item [x], scoped commit if needed, then stop. Phase is done.`;
    case "recover":
      return `Recover: the previous turn ended with an error. Continue the current checklist item without advancing.`;
    case "stuck":
      return `Stuck: no progress for several stops. Change strategy or send Autopilot RESUME after fixing.`;
    case "verify_fix":
      return `Verify failed (${vars.reason ?? "unknown"}). Fix verify commands and rewrite verify-last.json; do not advance.`;
    default:
      return "";
  }
}
var ReviewEngine = class {
  constructor(store, config) {
    this.store = store;
    this.config = config;
  }
  render(kind, vars) {
    return (this.config.renderFollowup ?? defaultRender)(kind, vars);
  }
  lens(roundIndex) {
    const rounds = this.config.confirmRounds;
    return (this.config.resolveLens ?? getLens)(roundIndex, rounds);
  }
  /** E1: afterFileEdit product code → code_edited=1 */
  onCodeEdited(conversationId) {
    this.store.markCodeEdited(conversationId);
  }
  handleStop(input) {
    const session = this.store.getSession(input.conversationId);
    if (!session) return null;
    if (input.status === "error" || input.status === "aborted") {
      return this.handleErrorStop(session, input);
    }
    if (session.armed !== 1 || session.phase !== "executing" || session.paused !== 0) {
      return null;
    }
    const chain = this.store.ensureReviewChain(input.conversationId);
    this.maybeResetErrorCountOnItemChange(session);
    if (chain.code_edited === 1) {
      return this.e2Fix(session, chain);
    }
    if (chain.confirm_left !== null && chain.confirm_left > 0) {
      return this.e4Confirm(session, chain);
    }
    if (chain.confirm_left === 0 || chain.item_confirm_complete === 1 && chain.confirm_left === null) {
      return this.e5Gate(session, chain);
    }
    const inChain = chain.chain_pending === 1 || input.loopCount > 0;
    if (chain.confirm_left === null && chain.item_confirm_complete === 0 && inChain) {
      return this.e3ArmConfirm(session, chain);
    }
    return null;
  }
  handleErrorStop(session, input) {
    const nextCount = session.error_count + 1;
    if (nextCount >= 3) {
      this.store.upsertSession({
        conversation_id: session.conversation_id,
        project_root: session.project_root,
        code_root: session.code_root,
        error_count: nextCount,
        last_error: input.status,
        paused: 1,
        paused_reason: "repeated_errors",
        armed: 0
      });
      return null;
    }
    this.store.upsertSession({
      conversation_id: session.conversation_id,
      project_root: session.project_root,
      code_root: session.code_root,
      error_count: nextCount,
      last_error: input.status
    });
    if (session.armed === 1 && session.phase === "executing" && session.paused === 0) {
      return {
        kind: "recover",
        message: this.render("recover", {}),
        loop: true
      };
    }
    return null;
  }
  /** completed stop → reset error_count */
  noteCompletedOk(session) {
    if (session.error_count > 0) {
      this.store.upsertSession({
        conversation_id: session.conversation_id,
        project_root: session.project_root,
        code_root: session.code_root,
        error_count: 0,
        last_error: null
      });
    }
  }
  maybeResetErrorCountOnItemChange(session) {
    if (!session.checklist_path || !fs4.existsSync(session.checklist_path)) return;
  }
  e2Fix(session, chain) {
    const fixRound = chain.fix_round + 1;
    this.store.updateReviewChain(session.conversation_id, {
      fix_round: fixRound,
      code_edited: 0,
      confirm_left: null,
      chain_pending: 1
      // item_confirm_complete preserved (E2 path)
    });
    this.bumpProgress(session, { fix_round: fixRound });
    this.noteCompletedOk(session);
    return {
      kind: "review.fix",
      message: this.render("review.fix", { round: fixRound }),
      loop: true,
      meta: { fixRound }
    };
  }
  e3ArmConfirm(session, _chain) {
    const rounds = this.config.confirmRounds;
    const lens = this.lens(1);
    const left = rounds - 1;
    this.store.updateReviewChain(session.conversation_id, {
      confirm_left: left,
      chain_pending: 1
    });
    this.bumpProgress(session, { confirm_left: left });
    this.noteCompletedOk(session);
    const kind = rounds === 1 ? "review.confirm_final" : "review.confirm";
    return {
      kind,
      message: this.render(kind, {
        n: 1,
        total: rounds,
        lensTitle: lens.title,
        lensFocus: lens.focus
      }),
      loop: true,
      meta: { n: 1, total: rounds }
    };
  }
  e4Confirm(session, chain) {
    const rounds = this.config.confirmRounds;
    const left = chain.confirm_left;
    const n = rounds - left + 1;
    const lens = this.lens(n);
    const newLeft = left - 1;
    this.store.updateReviewChain(session.conversation_id, {
      confirm_left: newLeft,
      chain_pending: 1
    });
    this.bumpProgress(session, { confirm_left: newLeft });
    this.noteCompletedOk(session);
    const isFinal = n === rounds;
    const kind = isFinal ? "review.confirm_final" : "review.confirm";
    return {
      kind,
      message: this.render(kind, {
        n,
        total: rounds,
        lensTitle: lens.title,
        lensFocus: lens.focus
      }),
      loop: true,
      meta: { n, total: rounds, confirm_left: newLeft }
    };
  }
  e5Gate(session, chain) {
    const checklistPath = session.checklist_path;
    let currentItem = null;
    if (checklistPath && fs4.existsSync(checklistPath)) {
      const cl = parseChecklist(checklistPath);
      currentItem = firstUnchecked(cl);
    }
    const reportPath = this.config.verifyReportPath ?? defaultVerifyReportPath(this.config.projectRoot);
    const evalResult = evaluateVerifyReport({
      enabled: this.config.verifyEnabled,
      commands: this.config.verifyCommands,
      reportPath,
      currentItem,
      checklistPath: checklistPath || ""
    });
    if (evalResult.outcome === "fail") {
      this.store.updateReviewChain(session.conversation_id, {
        confirm_left: 0,
        item_confirm_complete: 1,
        chain_pending: 1
      });
      this.incrementIdle(session);
      const after = this.store.getSession(session.conversation_id);
      if (after?.paused === 1 && after.paused_reason === "stuck") {
        return {
          kind: "stuck",
          message: this.render("stuck", {}),
          loop: true,
          meta: { reason: evalResult.reason ?? "fail" }
        };
      }
      return {
        kind: "verify_fix",
        message: this.render("verify_fix", { reason: evalResult.reason ?? "fail" }),
        loop: true,
        meta: { reason: evalResult.reason ?? "fail" }
      };
    }
    this.store.updateReviewChain(session.conversation_id, {
      confirm_left: null,
      fix_round: 0,
      code_edited: 0,
      chain_pending: 0,
      item_confirm_complete: 0
    });
    return this.e5bAdvance(session);
  }
  e5bAdvance(session) {
    this.store.upsertSession({
      conversation_id: session.conversation_id,
      project_root: session.project_root,
      code_root: session.code_root,
      error_count: 0,
      idle_stop_count: 0,
      last_error: null
    });
    let unchecked = 0;
    let next = null;
    if (session.checklist_path && fs4.existsSync(session.checklist_path)) {
      const cl = parseChecklist(session.checklist_path);
      unchecked = countUnchecked(cl);
      next = firstUnchecked(cl);
    }
    if (unchecked > 1) {
      return {
        kind: "advance",
        message: this.render("advance", {
          nextId: next?.id ?? "",
          nextTitle: next?.title ?? ""
        }),
        loop: true
      };
    }
    this.store.upsertSession({
      conversation_id: session.conversation_id,
      project_root: session.project_root,
      code_root: session.code_root,
      phase: "done",
      armed: 0,
      error_count: 0,
      idle_stop_count: 0
    });
    return {
      kind: "done",
      message: this.render("done", {}),
      loop: true
    };
  }
  bumpProgress(session, _changed) {
    if (session.idle_stop_count > 0) {
      this.store.upsertSession({
        conversation_id: session.conversation_id,
        project_root: session.project_root,
        code_root: session.code_root,
        idle_stop_count: 0
      });
    }
  }
  incrementIdle(session) {
    const next = session.idle_stop_count + 1;
    if (next >= this.config.maxIdleStops) {
      this.store.upsertSession({
        conversation_id: session.conversation_id,
        project_root: session.project_root,
        code_root: session.code_root,
        idle_stop_count: next,
        paused: 1,
        paused_reason: "stuck",
        armed: 0
      });
    } else {
      this.store.upsertSession({
        conversation_id: session.conversation_id,
        project_root: session.project_root,
        code_root: session.code_root,
        idle_stop_count: next
      });
    }
  }
  /** After a no-progress stop that didn't inject, check stuck threshold. */
  checkStuck(session) {
    const fresh = this.store.getSession(session.conversation_id);
    if (!fresh) return null;
    if (fresh.paused === 1 && fresh.paused_reason === "stuck") {
      return {
        kind: "stuck",
        message: this.render("stuck", {}),
        loop: true
      };
    }
    return null;
  }
};
function applyOff(store, conversationId) {
  const session = store.getSession(conversationId);
  if (!session) return null;
  if (session.phase === "done") {
    return store.upsertSession({
      conversation_id: conversationId,
      project_root: session.project_root,
      code_root: session.code_root,
      phase: "idle",
      armed: 0,
      paused: 0,
      paused_reason: null
    });
  }
  if (session.phase === "planning" || session.phase === "executing") {
    const wasPaused = session.paused === 1;
    let pausedReason = session.paused_reason;
    if (!wasPaused) {
      pausedReason = session.phase === "executing" ? "human_gate" : null;
    }
    return store.upsertSession({
      conversation_id: conversationId,
      project_root: session.project_root,
      code_root: session.code_root,
      armed: 0,
      paused: 1,
      paused_reason: pausedReason
      // phase unchanged; review chain untouched
    });
  }
  return session;
}
function applyOn(store, conversationId, projectRoot, opts) {
  const session = store.getSession(conversationId);
  if (session?.phase === "executing") {
    return {
      ok: false,
      userMessage: "Autopilot is executing. Send Autopilot OFF, REPLAN, or RESUME before ON."
    };
  }
  if (opts?.slug && !isSafeTrackSlug(opts.slug)) {
    return {
      ok: false,
      userMessage: `Invalid track slug "${opts.slug}".`
    };
  }
  const trackId = opts?.slug ?? session?.track_id ?? "_pending";
  if (session?.phase === "done") {
    const s2 = store.upsertSession({
      conversation_id: conversationId,
      project_root: projectRoot,
      code_root: projectRoot,
      phase: "planning",
      armed: 0,
      paused: 0,
      paused_reason: null,
      track_id: opts?.slug ?? session.track_id,
      platform: session.platform
    });
    return { ok: true, session: s2 };
  }
  const s = store.upsertSession({
    conversation_id: conversationId,
    project_root: projectRoot,
    code_root: projectRoot,
    platform: session?.platform ?? "cursor",
    phase: "planning",
    armed: 0,
    paused: 0,
    paused_reason: null,
    track_id: trackId,
    checklist_path: session?.checklist_path ?? ""
  });
  return { ok: true, session: s };
}
function applyResume(store, conversationId) {
  const session = store.getSession(conversationId);
  if (!session) return null;
  const patch = {
    conversation_id: conversationId,
    project_root: session.project_root,
    code_root: session.code_root
  };
  if (session.paused === 1) {
    patch.paused = 0;
    patch.paused_reason = null;
    patch.error_count = 0;
    patch.idle_stop_count = 0;
    if (session.phase === "executing") {
      let hasUnchecked = false;
      if (session.checklist_path && fs4.existsSync(session.checklist_path)) {
        hasUnchecked = countUnchecked(parseChecklist(session.checklist_path)) > 0;
      }
      patch.armed = hasUnchecked ? 1 : 0;
    }
  }
  if (session.phase === "planning") {
    patch.armed = 0;
  }
  return store.upsertSession(patch);
}
function applyResumeReview(store, conversationId) {
  store.setChainPending(conversationId);
}

// ../core/src/project-config.ts
import fs5 from "node:fs";
import path4 from "node:path";
var MAX_CONFIG_BYTES = 1e6;
var DEFAULT_PROJECT_REVIEW_CONFIG = {
  confirmRounds: 5,
  verifyEnabled: false,
  // freeze: chặn mutate hằng số mặc định làm bẩn mọi clone sau này
  verifyCommands: Object.freeze([]),
  maxIdleStops: 5,
  locale: "en"
};
function cloneDefaultProjectReviewConfig() {
  return {
    confirmRounds: DEFAULT_PROJECT_REVIEW_CONFIG.confirmRounds,
    verifyEnabled: DEFAULT_PROJECT_REVIEW_CONFIG.verifyEnabled,
    verifyCommands: [],
    maxIdleStops: DEFAULT_PROJECT_REVIEW_CONFIG.maxIdleStops,
    locale: DEFAULT_PROJECT_REVIEW_CONFIG.locale
  };
}
function coerceIntInRange(raw, min, max, fallback) {
  if (raw == null || !raw.trim()) return fallback;
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}
function unquote(value) {
  const v = value.trim();
  if (v.startsWith('"') && v.endsWith('"') || v.startsWith("'") && v.endsWith("'")) {
    return v.slice(1, -1);
  }
  return v;
}
function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.prototype.toString.call(value) === "[object Object]";
}
function isUnsafeKey(key) {
  return key === "__proto__" || key === "prototype" || key === "constructor";
}
function coerceScalar(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  return unquote(value);
}
function lineIndent(line) {
  let n = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === " ") n += 1;
    else if (ch === "	") n += 2;
    else break;
  }
  return n;
}
function parseSimpleYaml(raw) {
  const root = {};
  const stack = [{ indent: -1, obj: root }];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = lineIndent(line);
    const trimmed = line.trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const frame = stack[stack.length - 1];
    if (trimmed.startsWith("- ")) {
      const itemRaw = trimmed.slice(2).trim();
      if (!frame.openKey) continue;
      let list = frame.obj[frame.openKey];
      if (!Array.isArray(list)) {
        list = [];
        frame.obj[frame.openKey] = list;
      }
      if (itemRaw.includes(":") && !itemRaw.startsWith("{")) {
        const item = {};
        list.push(item);
        const m = itemRaw.match(/^([^:#]+):\s*(.*)$/);
        if (m) {
          const k = m[1].trim();
          const v = m[2].trim();
          if (!isUnsafeKey(k)) {
            item[k] = v === "" ? null : coerceScalar(v);
          }
          stack.push({ indent, obj: item });
        }
      } else {
        list.push(coerceScalar(itemRaw));
      }
      continue;
    }
    const kv = trimmed.match(/^([^:#]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].trim();
    const value = kv[2].trim();
    if (isUnsafeKey(key)) continue;
    if (frame.openKey && frame.openKeyIndent != null && indent > frame.openKeyIndent) {
      let child = frame.obj[frame.openKey];
      if (!isPlainObject(child) || Array.isArray(child)) {
        child = {};
        frame.obj[frame.openKey] = child;
      }
      const childObj = child;
      const childIndent = frame.openKeyIndent;
      frame.openKey = void 0;
      frame.openKeyIndent = void 0;
      stack.push({ indent: childIndent, obj: childObj });
      const childFrame = stack[stack.length - 1];
      if (value === "" || value === "|" || value === ">") {
        childFrame.openKey = key;
        childFrame.openKeyIndent = indent;
      } else {
        childObj[key] = coerceScalar(value);
      }
      continue;
    }
    if (value === "" || value === "|" || value === ">") {
      frame.openKey = key;
      frame.openKeyIndent = indent;
      continue;
    }
    frame.openKey = void 0;
    frame.openKeyIndent = void 0;
    frame.obj[key] = coerceScalar(value);
  }
  return root;
}
function coerceBool(raw) {
  if (raw === true || raw === "true") return true;
  if (raw === false || raw === "false") return false;
  return void 0;
}
function parseVerifyCommands(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue;
    if (typeof entry.id !== "string" || !entry.id.trim()) continue;
    const cmd = { id: entry.id.trim() };
    if (typeof entry.run === "string") cmd.run = entry.run;
    const required = coerceBool(entry.required);
    if (required !== void 0) cmd.required = required;
    out.push(cmd);
  }
  return out;
}
function loadProjectReviewConfig(projectRoot) {
  const configPath = path4.join(projectRoot, ".autopilot", "config.yml");
  try {
    const nofollow = typeof fs5.constants.O_NOFOLLOW === "number" ? fs5.constants.O_NOFOLLOW : 0;
    if (nofollow === 0) {
      if (!fs5.existsSync(configPath)) return cloneDefaultProjectReviewConfig();
      if (fs5.lstatSync(configPath).isSymbolicLink()) {
        return cloneDefaultProjectReviewConfig();
      }
    }
    let fd;
    try {
      fd = fs5.openSync(configPath, fs5.constants.O_RDONLY | nofollow);
    } catch {
      return cloneDefaultProjectReviewConfig();
    }
    let raw;
    try {
      const st = fs5.fstatSync(fd);
      if (!st.isFile() || st.size > MAX_CONFIG_BYTES) {
        return cloneDefaultProjectReviewConfig();
      }
      const buf = Buffer.alloc(st.size);
      const n = fs5.readSync(fd, buf, 0, st.size, 0);
      raw = buf.subarray(0, n).toString("utf8");
    } finally {
      fs5.closeSync(fd);
    }
    if (Buffer.byteLength(raw, "utf8") > MAX_CONFIG_BYTES) {
      return cloneDefaultProjectReviewConfig();
    }
    const text = raw.charCodeAt(0) === 65279 ? raw.slice(1) : raw;
    const parsed = parseSimpleYaml(text);
    if (!isPlainObject(parsed)) return cloneDefaultProjectReviewConfig();
    const review = isPlainObject(parsed.review) ? parsed.review : {};
    const verify = isPlainObject(review.verify) ? review.verify : {};
    const stuck = isPlainObject(review.stuck) ? review.stuck : {};
    return normalizeProjectReviewConfig({
      confirmRounds: review.confirm_rounds,
      verifyEnabled: verify.enabled,
      verifyCommands: verify.commands,
      maxIdleStops: stuck.max_idle_stops,
      locale: parsed.locale
    });
  } catch {
    return cloneDefaultProjectReviewConfig();
  }
}
function normalizeProjectReviewConfig(raw) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return cloneDefaultProjectReviewConfig();
  }
  const o = raw;
  return {
    confirmRounds: coerceIntInRange(
      o.confirmRounds != null ? String(o.confirmRounds) : void 0,
      1,
      5,
      DEFAULT_PROJECT_REVIEW_CONFIG.confirmRounds
    ),
    verifyEnabled: coerceBool(o.verifyEnabled) === true,
    verifyCommands: parseVerifyCommands(o.verifyCommands),
    maxIdleStops: coerceIntInRange(
      o.maxIdleStops != null ? String(o.maxIdleStops) : void 0,
      1,
      100,
      DEFAULT_PROJECT_REVIEW_CONFIG.maxIdleStops
    ),
    locale: typeof o.locale === "string" && o.locale.trim() ? o.locale.trim() : DEFAULT_PROJECT_REVIEW_CONFIG.locale
  };
}

// ../core/src/i18n-render.ts
function renderTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = vars[key];
    return v === void 0 || v === null ? "" : String(v);
  });
}

// ../core/src/review-i18n.ts
function createRenderFollowup(bundle) {
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
          f.verify_fix ?? "Verify failed ({reason}). Fix verify commands and rewrite verify-last.json; do not advance.",
          vars
        );
      default:
        return "";
    }
  };
}
function createResolveLens(bundle) {
  return (roundIndex, confirmRounds) => {
    const base = getLens(roundIndex, confirmRounds);
    const loc = bundle?.lens?.[base.key];
    if (!loc) return base;
    return {
      key: base.key,
      title: loc.title || base.title,
      focus: loc.focus || base.focus
    };
  };
}

// ../core/src/review-runtime.ts
function createConfiguredReviewEngine(store, projectRoot, localeBundle, preloaded) {
  const cfg = normalizeProjectReviewConfig(
    preloaded ?? loadProjectReviewConfig(projectRoot)
  );
  const usableLocale = Boolean(localeBundle?.followup?.review?.fix);
  return new ReviewEngine(store, {
    confirmRounds: cfg.confirmRounds,
    verifyEnabled: cfg.verifyEnabled,
    // bản sao nông — caller mutate preloaded.verifyCommands không ảnh hưởng engine
    verifyCommands: cfg.verifyCommands.map((c) => ({ ...c })),
    maxIdleStops: cfg.maxIdleStops,
    projectRoot,
    ...usableLocale && localeBundle ? {
      renderFollowup: createRenderFollowup(localeBundle),
      resolveLens: createResolveLens(localeBundle)
    } : {}
  });
}

// ../core/src/phase-actions.ts
import fs7 from "node:fs";
import path6 from "node:path";

// ../core/src/list-tracks.ts
import fs6 from "node:fs";
import path5 from "node:path";
function isRunnableTrack(t) {
  if (t.paused) return false;
  const unchecked = t.checklistTotal - t.checklistDone;
  if (unchecked <= 0) return false;
  return t.phase === "planning" || t.phase === "executing" || t.phase === "idle" || t.phase === "done";
}
function readPlansDir(root, plansDir = "plans") {
  const dir = path5.join(root, plansDir);
  if (!fs6.existsSync(dir)) return [];
  return fs6.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
}
function titleFromPlan(planPath, slug) {
  if (!fs6.existsSync(planPath)) return slug;
  const first = fs6.readFileSync(planPath, "utf8").split(/\r?\n/)[0] ?? "";
  const m = first.match(/^#\s+(.+)/);
  return m?.[1]?.trim() ?? slug;
}
function listTracks(root, store, filter = "all", plansDir = "plans") {
  const slugs = readPlansDir(root, plansDir);
  const tracks = [];
  for (const slug of slugs) {
    const planPath = path5.join(root, plansDir, slug, "plan.md");
    const checklistPath = path5.join(root, plansDir, slug, "checklist.md");
    let checklistTotal = 0;
    let checklistDone = 0;
    if (fs6.existsSync(checklistPath)) {
      const cl = parseChecklist(checklistPath);
      checklistTotal = cl.items.length;
      checklistDone = cl.items.filter((i) => i.checked).length;
    } else if (!fs6.existsSync(planPath)) {
      continue;
    }
    let phase = "idle";
    let paused = false;
    let pausedReason;
    let updatedAt = (/* @__PURE__ */ new Date(0)).toISOString();
    if (store) {
      const sessions = store.db.prepare(
        `SELECT * FROM sessions WHERE track_id = ? ORDER BY last_active_at DESC LIMIT 1`
      ).all(slug);
      const latest = sessions[0];
      if (latest) {
        phase = latest.phase;
        paused = latest.paused === 1;
        if (latest.paused_reason === "stuck" || latest.paused_reason === "repeated_errors" || latest.paused_reason === "human_gate") {
          pausedReason = latest.paused_reason;
        }
        updatedAt = latest.last_active_at;
      } else {
        if (checklistTotal > 0 && checklistDone === checklistTotal) {
          phase = "done";
        } else if (checklistTotal - checklistDone > 0 && fs6.existsSync(planPath)) {
          phase = "idle";
        }
      }
    } else {
      if (checklistTotal > 0 && checklistDone === checklistTotal) {
        phase = "done";
      } else if (checklistTotal - checklistDone > 0) {
        phase = "idle";
      }
    }
    tracks.push({
      slug,
      title: titleFromPlan(planPath, slug),
      phase,
      paused,
      pausedReason,
      checklistTotal,
      checklistDone,
      planPath,
      updatedAt
    });
  }
  if (filter === "all") return tracks;
  if (filter === "planning") {
    return tracks.filter((t) => t.phase === "planning");
  }
  return tracks.filter(isRunnableTrack);
}
function canEnterExecuting(options) {
  const { slug, checklistPath, paused } = options;
  if (!slug || slug === "_pending") {
    return { ok: false, reason: "no track slug" };
  }
  if (!checklistPath || !fs6.existsSync(checklistPath)) {
    return { ok: false, reason: "checklist missing" };
  }
  if (countUnchecked(parseChecklist(checklistPath)) < 1) {
    return { ok: false, reason: "no unchecked items" };
  }
  if (paused) {
    return { ok: false, reason: "session paused" };
  }
  return { ok: true };
}

// ../core/src/phase-actions.ts
function nowIso2() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function checklistPathFor(projectRoot, slug, plansDir) {
  return path6.join(projectRoot, plansDir, slug, "checklist.md");
}
function ensureSession(store, conversationId, projectRoot) {
  const existing = store.getSession(conversationId);
  if (existing) return existing;
  return store.upsertSession({
    conversation_id: conversationId,
    project_root: projectRoot,
    code_root: projectRoot,
    platform: "cursor",
    phase: "idle",
    armed: 0,
    paused: 0,
    track_id: "_pending",
    checklist_path: ""
  });
}
function upsertTrack(store, slug, checklistPath, plansDir, projectRoot) {
  const ts = nowIso2();
  const planPath = path6.join(projectRoot, plansDir, slug, "plan.md");
  const briefPath = path6.join(projectRoot, plansDir, slug, "brief.md");
  store.db.prepare(
    `INSERT INTO tracks (track_id, slug, checklist_path, plan_path, brief_path, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(track_id) DO UPDATE SET
         slug = excluded.slug,
         checklist_path = excluded.checklist_path,
         plan_path = excluded.plan_path,
         brief_path = excluded.brief_path,
         updated_at = excluded.updated_at`
  ).run(
    slug,
    slug,
    checklistPath,
    fs7.existsSync(planPath) ? planPath : null,
    fs7.existsSync(briefPath) ? briefPath : null,
    ts
  );
}
function candidatePayload(tracks) {
  return JSON.stringify(
    tracks.map((t) => ({
      slug: t.slug,
      title: t.title,
      phase: t.phase,
      progress: `${t.checklistDone}/${t.checklistTotal}`
    }))
  );
}
function resolveRunSlug(store, session, projectRoot, plansDir, requestedSlug) {
  const runnable = listTracks(projectRoot, store, "runnable", plansDir).filter(
    (t) => isSafeTrackSlug(t.slug)
  );
  if (requestedSlug) {
    if (!isSafeTrackSlug(requestedSlug)) {
      return {
        kind: "none",
        userMessage: `Invalid track slug "${requestedSlug}".`
      };
    }
    const hit = runnable.find((t) => t.slug === requestedSlug);
    if (!hit) {
      const all = listTracks(projectRoot, store, "all", plansDir);
      if (!all.some((t) => t.slug === requestedSlug)) {
        return {
          kind: "none",
          userMessage: `Track "${requestedSlug}" not found or has no unchecked checklist items.`
        };
      }
      return {
        kind: "none",
        userMessage: `Track "${requestedSlug}" is not runnable (paused or no unchecked items).`
      };
    }
    return { kind: "slug", slug: requestedSlug };
  }
  if (session.track_id && session.track_id !== "_pending") {
    const bound = runnable.find((t) => t.slug === session.track_id);
    if (bound) {
      return { kind: "slug", slug: bound.slug };
    }
  }
  if (runnable.length === 0) {
    return {
      kind: "none",
      userMessage: "No runnable plan. Use /autopilot-on to plan, then finalize a checklist with unchecked items."
    };
  }
  if (runnable.length === 1) {
    return { kind: "slug", slug: runnable[0].slug };
  }
  return { kind: "pick", candidates: runnable };
}
function applyRun(store, conversationId, projectRoot, opts) {
  const plansDir = opts?.config?.plansDir ?? "plans";
  const concurrencyMode = opts?.config?.concurrencyMode ?? "one_executor";
  const session = ensureSession(store, conversationId, projectRoot);
  const resolved = resolveRunSlug(
    store,
    session,
    projectRoot,
    plansDir,
    opts?.slug
  );
  if (resolved.kind === "none") {
    return { ok: false, userMessage: resolved.userMessage };
  }
  if (resolved.kind === "pick") {
    store.upsertSession({
      conversation_id: conversationId,
      project_root: session.project_root,
      code_root: session.code_root,
      pending_action: "run",
      track_candidates_json: candidatePayload(resolved.candidates),
      armed: 0
      // phase unchanged — do not write executing
    });
    const lines = resolved.candidates.map(
      (t, i) => `  ${i + 1}. ${t.slug} \u2014 ${t.title} (${t.checklistTotal - t.checklistDone}/${t.checklistTotal} left)`
    ).join("\n");
    return {
      ok: false,
      needPick: true,
      candidates: resolved.candidates,
      userMessage: `Select a plan to execute:

${lines}

Reply with a number or /autopilot-run <slug>.`
    };
  }
  const slug = resolved.slug;
  if (!isSafeTrackSlug(slug)) {
    return {
      ok: false,
      userMessage: `Invalid track slug "${slug}".`
    };
  }
  const checklistPath = checklistPathFor(projectRoot, slug, plansDir);
  const gate = canEnterExecuting({
    slug,
    checklistPath,
    paused: session.paused === 1
  });
  if (!gate.ok) {
    return {
      ok: false,
      userMessage: `Cannot start executing: ${gate.reason}.`
    };
  }
  try {
    return store.exclusiveWrite(() => {
      if (concurrencyMode === "one_executor") {
        const other = store.findExecutingSession(conversationId);
        if (other) {
          return {
            commit: false,
            value: {
              ok: false,
              userMessage: `Another session is already executing (${other.track_id}). Send Autopilot OFF there or wait, then retry.`
            }
          };
        }
      }
      upsertTrack(store, slug, checklistPath, plansDir, projectRoot);
      const updated = store.upsertSession({
        conversation_id: conversationId,
        project_root: projectRoot,
        code_root: projectRoot,
        track_id: slug,
        checklist_path: checklistPath,
        phase: "executing",
        armed: 1,
        paused: 0,
        paused_reason: null,
        pending_action: null,
        track_candidates_json: null,
        error_count: 0,
        idle_stop_count: 0
      });
      store.ensureReviewChain(conversationId);
      return { commit: true, value: { ok: true, session: updated } };
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/busy|locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(msg)) {
      return {
        ok: false,
        userMessage: "State database is busy; retry Autopilot RUN in a moment."
      };
    }
    throw err;
  }
}
function applyReplan(store, conversationId, projectRoot, opts) {
  const plansDir = opts?.config?.plansDir ?? "plans";
  const session = ensureSession(store, conversationId, projectRoot);
  let slug = opts?.slug ?? session.track_id;
  if (slug && slug !== "_pending" && !isSafeTrackSlug(slug)) {
    return {
      ok: false,
      userMessage: `Invalid track slug "${slug}".`
    };
  }
  if (!slug || slug === "_pending") {
    const all = listTracks(projectRoot, store, "all", plansDir).filter(
      (t) => isSafeTrackSlug(t.slug)
    );
    if (all.length === 1) {
      slug = all[0].slug;
    } else if (all.length > 1) {
      store.upsertSession({
        conversation_id: conversationId,
        project_root: session.project_root,
        code_root: session.code_root,
        pending_action: "replan",
        track_candidates_json: candidatePayload(all),
        armed: 0
      });
      const lines = all.map((t, i) => `  ${i + 1}. ${t.slug} \u2014 ${t.title}`).join("\n");
      return {
        ok: false,
        needPick: true,
        candidates: all,
        userMessage: `Select a plan to replan:

${lines}

Reply with a number or /autopilot-replan <slug>.`
      };
    } else {
      return {
        ok: false,
        userMessage: "No plan to replan. Use /autopilot-on first."
      };
    }
  }
  const checklistPath = session.checklist_path && session.track_id === slug ? session.checklist_path : checklistPathFor(projectRoot, slug, plansDir);
  const updated = store.upsertSession({
    conversation_id: conversationId,
    project_root: projectRoot,
    code_root: projectRoot,
    track_id: slug,
    checklist_path: checklistPath,
    phase: "planning",
    armed: 0,
    paused: 0,
    paused_reason: null,
    pending_action: null,
    track_candidates_json: null
  });
  store.updateReviewChain(conversationId, {
    fix_round: 0,
    confirm_left: null,
    chain_pending: 0,
    code_edited: 0,
    item_confirm_complete: 0
  });
  return { ok: true, session: updated };
}
function applyTrackPick(store, conversationId, projectRoot, pick, opts) {
  const session = store.getSession(conversationId);
  if (!session?.pending_action) {
    return {
      ok: false,
      userMessage: "No pending track selection."
    };
  }
  const pending = session.pending_action;
  if (pending !== "run" && pending !== "replan") {
    return {
      ok: false,
      userMessage: `Unknown pending action "${pending}".`
    };
  }
  if (!session.track_candidates_json) {
    return { ok: false, userMessage: "Invalid track candidates JSON." };
  }
  let candidates = [];
  try {
    const parsed = JSON.parse(session.track_candidates_json);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return { ok: false, userMessage: "Invalid track candidates JSON." };
    }
    const hasValidSlug = parsed.some(
      (c) => !!c && typeof c === "object" && !Array.isArray(c) && typeof c.slug === "string" && isSafeTrackSlug(c.slug)
    );
    if (!hasValidSlug) {
      return { ok: false, userMessage: "Invalid track candidates JSON." };
    }
    candidates = parsed;
  } catch {
    return { ok: false, userMessage: "Invalid track candidates JSON." };
  }
  let slug;
  if (/^\d+$/.test(pick)) {
    const idx = Number.parseInt(pick, 10) - 1;
    const entry = candidates[idx];
    slug = entry && typeof entry === "object" && !Array.isArray(entry) && typeof entry.slug === "string" ? entry.slug : void 0;
    if (!slug || !isSafeTrackSlug(slug)) {
      return {
        ok: false,
        userMessage: `Invalid selection "${pick}". Choose 1\u2013${candidates.length}.`
      };
    }
  } else {
    if (!isSafeTrackSlug(pick)) {
      return {
        ok: false,
        userMessage: `Invalid track slug "${pick}".`
      };
    }
    slug = pick;
    if (!candidates.some(
      (c) => !!c && typeof c === "object" && !Array.isArray(c) && c.slug === slug
    )) {
      return {
        ok: false,
        userMessage: `Unknown slug "${pick}".`
      };
    }
  }
  if (pending === "replan") {
    return applyReplan(store, conversationId, projectRoot, {
      slug,
      config: opts?.config
    });
  }
  return applyRun(store, conversationId, projectRoot, {
    slug,
    config: opts?.config
  });
}

// ../core/src/code-edit-detector.ts
import path7 from "node:path";
var CODE_EXTENSIONS = /* @__PURE__ */ new Set([
  // JS / TS
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  // Web
  ".vue",
  ".svelte",
  ".astro",
  ".css",
  ".scss",
  ".sass",
  ".less",
  // Systems / native
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".cxx",
  ".hpp",
  ".hh",
  ".m",
  ".mm",
  ".rs",
  ".go",
  ".zig",
  ".nim",
  ".v",
  // JVM / .NET
  ".java",
  ".kt",
  ".kts",
  ".scala",
  ".groovy",
  ".cs",
  ".fs",
  ".fsx",
  ".vb",
  // Mobile / UI
  ".swift",
  ".dart",
  // Scripting
  ".py",
  ".rb",
  ".php",
  ".pl",
  ".pm",
  ".lua",
  ".r",
  ".jl",
  ".ex",
  ".exs",
  ".erl",
  ".hrl",
  ".clj",
  ".cljs",
  ".cljc",
  ".edn",
  ".hs",
  ".lhs",
  ".ml",
  ".mli",
  ".elm",
  // Shell
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".bat",
  ".cmd",
  // Data / IDL / infra
  ".sql",
  ".graphql",
  ".gql",
  ".proto",
  ".tf",
  ".toml",
  ".yaml",
  ".yml",
  ".json",
  ".jsonc",
  ".xml",
  ".prisma"
]);
var ROOT_CONFIG_NAMES = /* @__PURE__ */ new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "pnpm-workspace.yaml",
  "Cargo.toml",
  "Cargo.lock",
  "go.mod",
  "go.sum",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "docker-compose.yml",
  "docker-compose.yaml",
  "Dockerfile",
  "Makefile",
  "makefile",
  "CMakeLists.txt",
  "pyproject.toml",
  "Pipfile",
  "requirements.txt",
  "Gemfile",
  "composer.json",
  "tsconfig.json",
  "jsconfig.json",
  "deno.json",
  "deno.jsonc"
]);
function normalizePosix(filePath) {
  return filePath.replace(/\\/g, "/");
}
function isProductCodeEdit(filePath) {
  const posix = normalizePosix(filePath);
  const base = path7.posix.basename(posix);
  const lower = posix.toLowerCase();
  if (lower.includes("/docs/") || lower.startsWith("docs/") || lower.includes("/plans/") || lower.startsWith("plans/") || lower.includes("/.autopilot/") || lower.startsWith(".autopilot/") || lower.includes("/.cursor/") || lower.startsWith(".cursor/") || lower.endsWith(".md") || lower.endsWith(".mdx")) {
    return false;
  }
  if (/\/\.cursor\/hooks\/\./.test(lower) || /^\.cursor\/hooks\/\./.test(lower)) {
    return false;
  }
  const ext = path7.posix.extname(posix).toLowerCase();
  if (CODE_EXTENSIONS.has(ext)) return true;
  if (ROOT_CONFIG_NAMES.has(base)) return true;
  return false;
}

// ../core/src/trigger-parser.ts
var DEFAULT_TRIGGERS = {
  match: "line_start",
  on: ["Autopilot ON", "Enable autopilot", "\u5F00\u542F\u81EA\u52A8\u9A7E\u9A76"],
  run: ["Autopilot RUN", "Start execution", "\u5F00\u59CB\u6267\u884C"],
  off: ["Autopilot OFF", "Disable autopilot", "\u5173\u95ED\u81EA\u52A8\u9A7E\u9A76"],
  resume: ["Autopilot RESUME", "\u7EE7\u7EED\u6267\u884C"],
  replan: ["Autopilot REPLAN", "\u4FEE\u6539\u65B9\u6848"],
  resume_review: ["Resume review", "\u7EE7\u7EED\u81EA\u5BA1"]
};
var SLASH_MAP = {
  "autopilot-on": "on",
  "autopilot-run": "run",
  "autopilot-off": "off",
  "autopilot-resume": "resume",
  "autopilot-replan": "replan"
};
var HARNESS_FOLLOWUP_PREFIXES = [
  "Review fix round",
  "Review confirm",
  "Advance checklist",
  "All checklist items done",
  "Stuck:",
  "Recover:",
  "\u81EA\u5BA1\u4FEE\u590D",
  "\u81EA\u5BA1\u786E\u8BA4",
  "\u63A8\u8FDB\u4E0B\u4E00\u9879",
  "\u5168\u90E8\u5B8C\u6210"
];
function isHarnessFollowupMessage(text) {
  const line = text.trim().split(/\r?\n/)[0] ?? "";
  return HARNESS_FOLLOWUP_PREFIXES.some((p) => line.startsWith(p));
}
function stripUserQuery(prompt) {
  const m = prompt.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i);
  return (m?.[1] ?? prompt).trim();
}
function firstLine(text) {
  return text.trim().split(/\r?\n/)[0]?.trim() ?? "";
}
function matchTextTrigger(line, phrases) {
  for (const phrase of phrases) {
    if (line === phrase || line.startsWith(phrase + " ") || line.startsWith(phrase + "\xB7") || line.startsWith(phrase + " \xB7")) {
      let rest = line.slice(phrase.length).trim();
      rest = rest.replace(/^[·•]\s*/, "").trim();
      return { matched: phrase, rest };
    }
  }
  return null;
}
function parseSlugAndBrief(rest) {
  if (!rest) return {};
  const parts = rest.split(/\s*·\s*/);
  if (parts.length >= 2) {
    const maybeSlug = parts[1].trim();
    if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(maybeSlug)) {
      return { slug: maybeSlug, initialBrief: parts.slice(2).join(" \xB7 ").trim() || void 0 };
    }
  }
  if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(rest)) {
    return { slug: rest };
  }
  return { initialBrief: rest };
}
function parseTrigger(options) {
  const {
    conversationId,
    projectRoot,
    triggers = DEFAULT_TRIGGERS,
    pendingAction
  } = options;
  const text = stripUserQuery(options.prompt);
  const line = firstLine(text);
  const slash = line.match(/^\/?(autopilot-(?:on|run|off|resume|replan))(?:\s+(.*))?$/i);
  if (slash) {
    const command = slash[1].toLowerCase();
    const kind = SLASH_MAP[command];
    if (!kind) return null;
    const rest = (slash[2] ?? "").trim();
    const event = {
      kind,
      source: "slash",
      command,
      conversationId,
      projectRoot
    };
    if (kind === "on") {
      const { slug, initialBrief } = parseSlugAndBrief(rest);
      if (slug) event.slug = slug;
      if (initialBrief || !slug && rest) event.initialBrief = initialBrief ?? rest;
    } else if (kind === "run" || kind === "replan") {
      const { slug, initialBrief } = parseSlugAndBrief(rest);
      if (slug) event.slug = slug;
      else if (rest) event.slug = rest.split(/\s+/)[0];
      if (initialBrief) event.initialBrief = initialBrief;
    }
    return event;
  }
  const cfg = { ...DEFAULT_TRIGGERS, ...triggers };
  const kinds = [
    { kind: "on", phrases: cfg.on },
    { kind: "run", phrases: cfg.run },
    { kind: "off", phrases: cfg.off },
    { kind: "resume", phrases: cfg.resume },
    { kind: "replan", phrases: cfg.replan },
    { kind: "resume_review", phrases: cfg.resume_review }
  ];
  for (const { kind, phrases } of kinds) {
    const hit = matchTextTrigger(line, phrases);
    if (!hit) continue;
    const event = {
      kind,
      source: "text",
      conversationId,
      projectRoot
    };
    if (kind === "on") {
      const { slug, initialBrief } = parseSlugAndBrief(hit.rest);
      if (slug) event.slug = slug;
      if (initialBrief || !slug && hit.rest) event.initialBrief = initialBrief ?? hit.rest;
    } else if (kind === "run" || kind === "replan") {
      const { slug } = parseSlugAndBrief(hit.rest);
      if (slug) event.slug = slug;
      else if (hit.rest) event.slug = hit.rest.split(/\s+/)[0];
    }
    return event;
  }
  if (pendingAction === "run" || pendingAction === "replan") {
    if (/^\d+$/.test(line) || /^[a-z0-9]+(-[a-z0-9]+)*$/.test(line)) {
      return {
        kind: "track_pick",
        source: "text",
        trackPick: line,
        conversationId,
        projectRoot
      };
    }
  }
  return null;
}

// ../ports/cursor/src/index.ts
function cid(p) {
  return (p.conversation_id ?? p.conversationId ?? "").trim();
}
function handleBeforeSubmitPrompt(store, payload, projectRoot, portConfig) {
  const conversationId = cid(payload);
  if (!conversationId) return { continue: true };
  const prompt = payload.prompt ?? payload.content ?? "";
  const session = store.getSession(conversationId);
  const trigger = parseTrigger({
    prompt,
    conversationId,
    projectRoot,
    pendingAction: session?.pending_action
  });
  const actionConfig = portConfig?.phaseActions;
  if (trigger) {
    if (trigger.kind === "off") {
      applyOff(store, conversationId);
      return { continue: true };
    }
    if (trigger.kind === "on") {
      const result = applyOn(store, conversationId, projectRoot, {
        initialBrief: trigger.initialBrief,
        slug: trigger.slug
      });
      if (!result.ok) {
        return { continue: false, userMessage: result.userMessage };
      }
      return { continue: true };
    }
    if (trigger.kind === "resume") {
      applyResume(store, conversationId);
      return { continue: true };
    }
    if (trigger.kind === "resume_review") {
      applyResumeReview(store, conversationId);
      return { continue: true };
    }
    if (trigger.kind === "run") {
      const result = applyRun(store, conversationId, projectRoot, {
        slug: trigger.slug,
        config: actionConfig
      });
      if (!result.ok) {
        return { continue: false, userMessage: result.userMessage };
      }
      return { continue: true };
    }
    if (trigger.kind === "replan") {
      const result = applyReplan(store, conversationId, projectRoot, {
        slug: trigger.slug,
        config: actionConfig
      });
      if (!result.ok) {
        return { continue: false, userMessage: result.userMessage };
      }
      return { continue: true };
    }
    if (trigger.kind === "track_pick" && trigger.trackPick) {
      const result = applyTrackPick(
        store,
        conversationId,
        projectRoot,
        trigger.trackPick,
        { config: actionConfig }
      );
      if (!result.ok) {
        return { continue: false, userMessage: result.userMessage };
      }
      return { continue: true };
    }
    return { continue: true };
  }
  if (!isHarnessFollowupMessage(prompt)) {
    store.clearChainPending(conversationId);
  }
  return { continue: true };
}
function handleAfterFileEdit(store, payload) {
  const conversationId = cid(payload);
  const filePath = payload.file_path ?? payload.filePath ?? "";
  if (!conversationId || !filePath) return;
  if (isProductCodeEdit(filePath)) {
    store.markCodeEdited(conversationId);
  }
}
function handleStop(engine, payload) {
  const conversationId = cid(payload);
  if (!conversationId) return {};
  const statusRaw = payload.status ?? "completed";
  const status = statusRaw === "error" || statusRaw === "aborted" ? statusRaw : "completed";
  const loopCount = payload.loop_count ?? payload.loopCount ?? 0;
  const action = engine.handleStop({
    conversationId,
    status,
    loopCount
  });
  if (!action) return {};
  return { followup_message: action.message, loop: true };
}

// src/vendor-entry.ts
function createConfiguredReviewEngine2(store, projectRoot) {
  const cfg = loadProjectReviewConfig(projectRoot);
  const bundle = loadLocale(cfg.locale);
  return createConfiguredReviewEngine(store, projectRoot, bundle, cfg);
}
export {
  ReviewEngine,
  StateStore,
  createConfiguredReviewEngine2 as createConfiguredReviewEngine,
  getLatestSchemaVersion,
  handleAfterFileEdit,
  handleBeforeSubmitPrompt,
  handleStop,
  loadProjectReviewConfig
};
