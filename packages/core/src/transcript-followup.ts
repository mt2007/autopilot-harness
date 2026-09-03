/**
 * Transcript helpers for pending-followup redelivery / in-flight gating.
 * Stop-hook followup matching: detect prior Autopilot injects in the transcript
 * (minus host-/product-specific prefixes).
 */
import fs from "node:fs";
import {
  firstSubstantiveLine,
  HARNESS_FOLLOWUP_PREFIXES,
  isHarnessFollowupMessage,
  substantivePromptBody,
} from "./trigger-parser.js";

export const TRANSCRIPT_TAIL_BYTES = 512_000;
export const TRANSCRIPT_TAIL_EVENTS = 80;
export const PENDING_REDELIVER_COOLDOWN_MS = 8_000;
/** Debounce + same-window coalesce for error-stop recover injects. */
export const RECOVER_DEBOUNCE_MS = 3_000;
export const BRIEFLY_PREFIX = "Briefly inform the user";

/** True when `at` is within the recover debounce window (same storm). */
export function inRecoverDebounceWindow(
  at: string | null | undefined,
  windowMs: number,
): boolean {
  if (!at || !(windowMs > 0)) return false;
  const t = Date.parse(at);
  if (Number.isNaN(t)) return false;
  return Date.now() - t < windowMs;
}

/** Sync sleep for stop-hook debounce (Atomics.wait; no-op when ms<=0). */
export function sleepSyncMs(ms: number): void {
  if (!(ms > 0) || !Number.isFinite(ms)) return;
  const capped = Math.min(Math.floor(ms), 60_000);
  try {
    const sab = new SharedArrayBuffer(4);
    const ia = new Int32Array(sab);
    Atomics.wait(ia, 0, 0, capped);
  } catch {
    // Do not busy-spin for seconds inside a stop hook if Atomics.wait is
    // unavailable — same-window coalesce still prevents duplicate recovers.
  }
}

export type TranscriptEvent = Record<string, unknown>;

/** True when the newest role tip is an assistant turn (session has spoken). */
export function transcriptTipIsAssistant(events: TranscriptEvent[]): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    const role = ev.role;
    if (role === "assistant") return true;
    if (role === "user") {
      const q = userQueryText(ev);
      // Bare <timestamp> rows are not a real user tip; empty stubs still count.
      if (q && !substantivePromptBody(q)) continue;
      return false;
    }
  }
  return false;
}

export function readTranscriptTail(transcriptPath: string): TranscriptEvent[] {
  // Untrusted stop-hook path: refuse empty, NUL, symlinks; prefer O_NOFOLLOW.
  if (!transcriptPath || transcriptPath.includes("\0")) return [];
  let chunk: string;
  try {
    const nofollow =
      typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
    const lst = fs.lstatSync(transcriptPath);
    if (lst.isSymbolicLink() || !lst.isFile()) return [];

    const fd = fs.openSync(transcriptPath, fs.constants.O_RDONLY | nofollow);
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile()) return [];
      // Bind fd to path identity always — not only when O_NOFOLLOW is missing
      // (leaf/intermediate swap-back TOCTOU).
      const lst2 = fs.lstatSync(transcriptPath);
      if (lst2.isSymbolicLink() || !lst2.isFile()) return [];
      if (lst2.ino !== st.ino || lst2.dev !== st.dev) return [];
      const start = Math.max(0, st.size - TRANSCRIPT_TAIL_BYTES);
      const len = st.size - start;
      if (len <= 0) return [];
      const buf = Buffer.alloc(len);
      // Use bytes actually read — file may shrink between fstat and read.
      const n = fs.readSync(fd, buf, 0, buf.length, start);
      chunk = buf.subarray(0, n).toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return [];
  }
  const events: TranscriptEvent[] = [];
  for (const line of chunk.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as TranscriptEvent);
    } catch {
      /* skip partial first line */
    }
  }
  return events.slice(-TRANSCRIPT_TAIL_EVENTS);
}

export function eventText(obj: TranscriptEvent): string {
  const msg = obj.message;
  if (!msg || typeof msg !== "object") return "";
  const content = (msg as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (
        item &&
        typeof item === "object" &&
        (item as { type?: string }).type === "text"
      ) {
        parts.push(String((item as { text?: string }).text ?? ""));
      }
    }
    return parts.join("\n");
  }
  return "";
}

export function userQueryText(obj: TranscriptEvent): string {
  const text = eventText(obj);
  const open = text.indexOf("<user_query>");
  if (open >= 0) {
    const after = text.slice(open + "<user_query>".length);
    const close = after.indexOf("</user_query>");
    return (close >= 0 ? after.slice(0, close) : after).trim();
  }
  return text.trim();
}

export function isDeliveryNoiseUserQuery(query: string): boolean {
  const line = firstSubstantiveLine(query);
  if (!line) return false;
  return line.startsWith(BRIEFLY_PREFIX);
}

/**
 * Index of the latest `turn_ended` with `status=error` that the session has
 * not moved past, or -1. See {@link latestUnresolvedTurnEndedError}.
 */
export function latestUnresolvedTurnEndedErrorIndex(
  events: TranscriptEvent[],
): number {
  let errIdx = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.type === "turn_ended" && isTurnEndedErrorStatus(ev.status)) {
      errIdx = i;
      break;
    }
  }
  if (errIdx < 0) return -1;

  for (let i = errIdx + 1; i < events.length; i++) {
    const ev = events[i]!;
    if (ev.type === "turn_ended") {
      // A later turn boundary means the session moved on from this error.
      if (!isTurnEndedErrorStatus(ev.status)) {
        return -1;
      }
      continue;
    }
    if (ev.role === "assistant") {
      return -1;
    }
    if (ev.role === "user") {
      const q = userQueryText(ev);
      if (!q) continue;
      // Cursor often inserts timestamp-only user rows; not real progress.
      if (!substantivePromptBody(q)) continue;
      if (isDeliveryNoiseUserQuery(q) || isHarnessFollowupMessage(q)) {
        continue;
      }
      return -1;
    }
  }
  return errIdx;
}

/**
 * Latest `turn_ended` with `status=error` that the session has not moved past.
 * Used when the host wrote an error into the transcript but delivered stop as
 * `completed` (no `status=error` hook) — Autopilot can still salvage recover.
 *
 * Resolved when anything after that error shows progress: assistant reply,
 * non-harness user message, or any later turn_ended that is not another error
 * (success / aborted / completed / failed / …). Unanswered harness / recover /
 * Briefly user tips after the error do not resolve.
 */
export function latestUnresolvedTurnEndedError(
  events: TranscriptEvent[],
): TranscriptEvent | null {
  const errIdx = latestUnresolvedTurnEndedErrorIndex(events);
  return errIdx < 0 ? null : events[errIdx]!;
}

/** Host status strings may vary in case/whitespace; only `error` is an orphan signal. */
function isTurnEndedErrorStatus(status: unknown): boolean {
  return String(status ?? "").trim().toLowerCase() === "error";
}

export function transcriptHasUnresolvedTurnEndedError(
  events: TranscriptEvent[],
): boolean {
  return latestUnresolvedTurnEndedErrorIndex(events) >= 0;
}

function isInFlightUserQuery(query: string): boolean {
  if (!query) return false;
  const line = firstSubstantiveLine(query);
  if (line.startsWith(BRIEFLY_PREFIX)) return true;
  return isHarnessFollowupMessage(query);
}

/** True when latest user automation/Briefly turn has no assistant reply yet. */
export function followupInFlight(events: TranscriptEvent[]): boolean {
  return inFlightUserQuery(events) !== null;
}

/**
 * Latest in-flight automation/Briefly user query, or null if tip is assistant /
 * ordinary user / empty / turn already ended.
 *
 * `turn_ended` closes the prior user tip: it is no longer in-flight. That keeps
 * orphan salvage able to re-emit recover after a newer error lands on top of an
 * unanswered recover tip from an earlier failure.
 */
export function inFlightUserQuery(events: TranscriptEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.type === "turn_ended") return null;
    const role = ev.role;
    if (role === "assistant") return null;
    if (role === "user") {
      const q = userQueryText(ev);
      if (!q) continue;
      // Skip markup-only rows (e.g. bare <timestamp>) so a real tip below still counts.
      if (!substantivePromptBody(q)) continue;
      return isInFlightUserQuery(q) ? q : null;
    }
  }
  return null;
}

/**
 * Like {@link inFlightUserQuery}, but ignores trailing *error* `turn_ended` rows
 * so an error-stop claim can still see the harness tip that the failing turn
 * killed. Does **not** peek past success/aborted/failed boundaries — those
 * close prior tips for good (plain {@link inFlightUserQuery} already returns
 * null on any `turn_ended`).
 */
export function harnessTipBeforeTrailingTurnEnded(
  events: TranscriptEvent[],
): string | null {
  let i = events.length - 1;
  while (
    i >= 0 &&
    events[i]!.type === "turn_ended" &&
    isTurnEndedErrorStatus(events[i]!.status)
  ) {
    i--;
  }
  for (; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.type === "turn_ended") return null;
    if (ev.role === "assistant") return null;
    if (ev.role === "user") {
      const q = userQueryText(ev);
      if (!q) continue;
      if (!substantivePromptBody(q)) continue;
      return isInFlightUserQuery(q) ? q : null;
    }
  }
  return null;
}

/** True if the latest non-noise user message matches the pending followup. */
export function automationFollowupPresent(
  events: TranscriptEvent[],
  message: string,
): boolean {
  const needle = substantivePromptBody(message);
  if (!needle) return false;
  const prefix = needle.slice(0, 48);
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.role !== "user") continue;
    const query = userQueryText(ev);
    if (isDeliveryNoiseUserQuery(query)) continue;
    // Host may put <timestamp> inside <user_query>; compare stripped bodies.
    const body = substantivePromptBody(query);
    if (!body) continue;
    return body === needle || (Boolean(prefix) && body.startsWith(prefix));
  }
  return false;
}

export function pendingRedeliverAllowed(lastRedeliverAt: string | null): boolean {
  if (!lastRedeliverAt) return true;
  const t = Date.parse(lastRedeliverAt);
  if (Number.isNaN(t)) return true;
  return Date.now() - t >= PENDING_REDELIVER_COOLDOWN_MS;
}

/** Export for tests: harness prefixes used by in-flight detection. */
export function harnessPrefixesForInFlight(): readonly string[] {
  return HARNESS_FOLLOWUP_PREFIXES;
}
