import fs from "node:fs";
import path from "node:path";
import {
  normalizeSessionTitle,
  sanitizeSessionDisplayText,
  shortConversationId,
  StateStore,
  type SessionRow,
} from "@autopilot-harness/core";
import { assertNotSymlink } from "./init/wizard-helpers.js";

export { shortConversationId as shortSessionId };

export type SessionCmdOk = { ok: true };
export type SessionCmdFail = { ok: false; error: string };
export type SessionCmdResult = SessionCmdOk | SessionCmdFail;

export type SessionListOk = { ok: true; lines: string[] };
export type SessionListResult = SessionListOk | SessionCmdFail;

const DEFAULT_STALE_HOURS = 72;

function resolveProjectRoot(
  projectRoot: string,
): { ok: true; root: string } | SessionCmdFail {
  if (typeof projectRoot !== "string" || projectRoot.trim() === "") {
    return { ok: false, error: "projectRoot must be a non-empty string" };
  }
  return { ok: true, root: path.resolve(projectRoot.trim()) };
}

function assertInitialized(projectRoot: string): SessionCmdFail | null {
  const configPath = path.join(projectRoot, ".autopilot", "config.yml");
  if (!fs.existsSync(configPath)) {
    return {
      ok: false,
      error:
        "Project is not initialized (.autopilot/config.yml missing). Run init first.",
    };
  }
  return null;
}

function openStore(projectRoot: string): StateStore | SessionCmdFail {
  const resolved = resolveProjectRoot(projectRoot);
  if (!resolved.ok) return resolved;
  const root = resolved.root;
  const initErr = assertInitialized(root);
  if (initErr) return initErr;
  const dbPath = path.join(root, ".autopilot", "state.db");
  if (!fs.existsSync(dbPath)) {
    return { ok: false, error: "No state.db yet (no sessions)." };
  }
  try {
    assertNotSymlink(path.join(root, ".autopilot"), ".autopilot/");
    assertNotSymlink(dbPath, ".autopilot/state.db");
    return new StateStore(root);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Cannot open state.db: ${msg}` };
  }
}

function asStoreFail(
  value: StateStore | SessionCmdFail,
): value is SessionCmdFail {
  return !(value instanceof StateStore);
}

export function formatSessionDisplayName(row: {
  track_title: string | null;
  session_title: string | null;
  track_id: string;
}): string {
  const track = sanitizeSessionDisplayText(
    row.track_title?.trim() ||
      (row.track_id && row.track_id !== "_pending" ? row.track_id : "") ||
      "",
  );
  const session = sanitizeSessionDisplayText(row.session_title?.trim() || "");
  if (track && session) return `${track} · ${session}`;
  if (track) return track;
  if (session) return session;
  return "(untitled)";
}

function formatPhase(row: SessionRow): string {
  if (row.paused === 1) {
    return `${row.phase} (paused)`;
  }
  return row.phase;
}

function formatRelativeAge(iso: string, nowMs = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const sec = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

function isStale(row: SessionRow, staleAfterHours: number, nowMs = Date.now()): boolean {
  if (!(staleAfterHours > 0)) return false;
  const t = Date.parse(row.last_active_at);
  if (Number.isNaN(t)) return false;
  return nowMs - t > staleAfterHours * 3600 * 1000;
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + " ".repeat(n - s.length);
}

export function formatSessionList(opts: {
  projectRoot: string;
  staleAfterHours?: number;
}): SessionListResult {
  const storeOrErr = openStore(opts.projectRoot);
  if (asStoreFail(storeOrErr)) return storeOrErr;
  const store = storeOrErr;
  try {
    const rows = store.listSessions();
    if (rows.length === 0) {
      return { ok: true, lines: ["(no sessions)"] };
    }
    const staleH = opts.staleAfterHours ?? DEFAULT_STALE_HOURS;
    const header =
      pad("ID", 10) +
      pad("Title", 36) +
      pad("Track", 16) +
      pad("Phase", 22) +
      "Last active";
    const lines = [header];
    for (const row of rows) {
      const short = shortConversationId(row.conversation_id);
      const title = formatSessionDisplayName(row);
      const track = sanitizeSessionDisplayText(
        row.track_id === "_pending" ? "(pending)" : row.track_id,
      );
      const phase = formatPhase(row);
      const age = formatRelativeAge(row.last_active_at);
      const stale = isStale(row, staleH) ? "  ← stale" : "";
      lines.push(
        pad(short, 10) +
          pad(title, 36) +
          pad(track, 16) +
          pad(phase, 22) +
          age +
          stale,
      );
    }
    return { ok: true, lines };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Do not prefix here — bin.ts adds "session list failed:".
    return { ok: false, error: msg };
  } finally {
    store.close();
  }
}

function withResolvedSession(
  projectRoot: string,
  idQuery: string,
  fn: (store: StateStore, id: string) => SessionCmdResult,
): SessionCmdResult {
  if (typeof idQuery !== "string" || idQuery.trim() === "") {
    return { ok: false, error: "Session id required" };
  }
  const storeOrErr = openStore(projectRoot);
  if (asStoreFail(storeOrErr)) return storeOrErr;
  const store = storeOrErr;
  try {
    const resolved = store.resolveSessionId(idQuery);
    if (!resolved.ok) return resolved;
    return fn(store, resolved.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  } finally {
    store.close();
  }
}

export function renameProjectSession(opts: {
  projectRoot: string;
  id: string;
  title: string;
}): SessionCmdResult {
  if (typeof opts.title !== "string") {
    return { ok: false, error: "Title must be a non-empty string" };
  }
  let title: string;
  try {
    title = normalizeSessionTitle(opts.title);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
  return withResolvedSession(opts.projectRoot, opts.id, (store, id) => {
    try {
      const row = store.renameSession(id, title);
      if (!row) return { ok: false, error: `No session matching "${opts.id}"` };
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  });
}

export function purgeProjectSession(opts: {
  projectRoot: string;
  id: string;
}): SessionCmdResult {
  return withResolvedSession(opts.projectRoot, opts.id, (store, id) => {
    if (!store.purgeSession(id)) {
      return { ok: false, error: `No session matching "${opts.id}"` };
    }
    return { ok: true };
  });
}

export function resetProjectSessionReview(opts: {
  projectRoot: string;
  id: string;
}): SessionCmdResult {
  return withResolvedSession(opts.projectRoot, opts.id, (store, id) => {
    if (!store.resetReviewChain(id)) {
      return { ok: false, error: `No session matching "${opts.id}"` };
    }
    return { ok: true };
  });
}
