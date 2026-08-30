/**
 * Transcript helpers for pending-followup redelivery / in-flight gating.
 * Stop-hook followup matching: detect prior Autopilot injects in the transcript (minus host-/product-specific prefixes).
 */
import fs from "node:fs";
import { HARNESS_FOLLOWUP_PREFIXES, isHarnessFollowupMessage } from "./trigger-parser.js";

export const TRANSCRIPT_TAIL_BYTES = 512_000;
export const TRANSCRIPT_TAIL_EVENTS = 80;
export const PENDING_REDELIVER_COOLDOWN_MS = 8_000;
export const BRIEFLY_PREFIX = "Briefly inform the user";

export type TranscriptEvent = Record<string, unknown>;

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
  const q = (query || "").trim();
  if (!q) return false;
  if (q.startsWith(BRIEFLY_PREFIX)) return true;
  if (q.startsWith("Briefly inform the user about the task result.")) return true;
  return false;
}

function isInFlightUserQuery(query: string): boolean {
  if (!query) return false;
  if (query.startsWith(BRIEFLY_PREFIX)) return true;
  return isHarnessFollowupMessage(query);
}

/** True when latest user automation/Briefly turn has no assistant reply yet. */
export function followupInFlight(events: TranscriptEvent[]): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    const role = ev.role;
    if (role === "assistant") return false;
    if (role === "user") return isInFlightUserQuery(userQueryText(ev));
  }
  return false;
}

/** True if the latest non-noise user message matches the pending followup. */
export function automationFollowupPresent(
  events: TranscriptEvent[],
  message: string,
): boolean {
  const needle = message.trim();
  if (!needle) return false;
  const prefix = needle.slice(0, 48);
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.role !== "user") continue;
    const query = userQueryText(ev);
    if (isDeliveryNoiseUserQuery(query)) continue;
    return query === needle || (Boolean(prefix) && query.startsWith(prefix));
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
