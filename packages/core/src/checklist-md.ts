import fs from "node:fs";
import { isRealpathInsideProject, normalizeProjectRoot } from "./project-path.js";

export interface ChecklistItem {
  id: string;
  title: string;
  checked: boolean;
  line: string;
  lineNumber: number;
  idFromSeparator: boolean;
}

export interface ChecklistMd {
  path: string;
  items: ChecklistItem[];
}

/** Hard cap — stop-hook / track listing must not OOM on hostile checklist paths. */
export const MAX_CHECKLIST_BYTES = 1_048_576;

const ITEM_RE = /^-\s*\[([ xX])\]\s*(.+)$/;
/** Prefer em/en dash; ASCII hyphen only when surrounded by spaces. */
const SEPARATOR_RE = /^(.+?)\s*(?:[—–]| - )\s*(.+)$/;
const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function parseItemLine(line: string, lineNumber: number): ChecklistItem | null {
  const m = line.match(ITEM_RE);
  if (!m) return null;
  const checked = m[1]!.toLowerCase() === "x";
  const body = m[2]!.trim();
  const sep = body.match(SEPARATOR_RE);
  if (sep) {
    const id = sep[1]!.trim();
    const title = sep[2]!.trim();
    return {
      id: KEBAB_RE.test(id) ? id : slugify(id),
      title,
      checked,
      line,
      lineNumber,
      idFromSeparator: true,
    };
  }
  return {
    id: slugify(body),
    title: body,
    checked,
    line,
    lineNumber,
    idFromSeparator: false,
  };
}

/** Parse checklist markdown text (no FS). */
export function parseChecklistMarkdown(
  content: string,
  checklistPath: string,
): ChecklistMd {
  const lines = content.split(/\r?\n/);
  const items: ChecklistItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const item = parseItemLine(lines[i]!, i + 1);
    if (item) items.push(item);
  }
  return { path: checklistPath, items };
}

/**
 * Read + parse a checklist file.
 * Refuses NUL paths, symlinks (O_NOFOLLOW / lstat), non-files, and oversized bodies.
 * When projectRoot is set, re-checks realpath containment after open (same TOCTOU
 * class as readVerifyReport: intermediate dir symlink escape).
 */
export function parseChecklist(
  checklistPath: string,
  opts?: { projectRoot?: string },
): ChecklistMd {
  if (!checklistPath || checklistPath.includes("\0")) {
    throw new Error("Invalid checklist path");
  }
  const projectRoot = opts?.projectRoot;
  if (projectRoot !== undefined && projectRoot !== null) {
    if (
      typeof projectRoot !== "string" ||
      !normalizeProjectRoot(projectRoot)
    ) {
      throw new Error("Invalid project root");
    }
  }
  const root =
    typeof projectRoot === "string"
      ? normalizeProjectRoot(projectRoot) ?? undefined
      : undefined;
  const nofollow =
    typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
  // Platforms without O_NOFOLLOW: refuse symlinks before open (still a small TOCTOU window).
  if (nofollow === 0) {
    const st = fs.lstatSync(checklistPath);
    if (st.isSymbolicLink() || !st.isFile()) {
      throw new Error("Checklist must be a regular file");
    }
  }
  const fd = fs.openSync(checklistPath, fs.constants.O_RDONLY | nofollow);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > MAX_CHECKLIST_BYTES) {
      throw new Error("Checklist unreadable or too large");
    }
    // Bind fd to the path's current identity. Always — not only when O_NOFOLLOW
    // is missing (same intermediate-dir swap-back TOCTOU as verify-report).
    const lst = fs.lstatSync(checklistPath);
    if (lst.isSymbolicLink() || !lst.isFile()) {
      throw new Error("Checklist must be a regular file");
    }
    if (lst.ino !== st.ino || lst.dev !== st.dev) {
      throw new Error("Checklist path changed during open");
    }
    if (root && !isRealpathInsideProject(root, checklistPath)) {
      throw new Error("Checklist outside project");
    }
    const buf = Buffer.alloc(st.size);
    const n = fs.readSync(fd, buf, 0, st.size, 0);
    const content = buf.subarray(0, n).toString("utf8");
    if (Buffer.byteLength(content, "utf8") > MAX_CHECKLIST_BYTES) {
      throw new Error("Checklist too large");
    }
    return parseChecklistMarkdown(content, checklistPath);
  } finally {
    fs.closeSync(fd);
  }
}

export function countUnchecked(checklist: ChecklistMd): number {
  return checklist.items.filter((i) => !i.checked).length;
}

export function firstUnchecked(checklist: ChecklistMd): ChecklistItem | null {
  return checklist.items.find((i) => !i.checked) ?? null;
}

/** Second unchecked item — the one to implement after marking current [x]. */
export function secondUnchecked(checklist: ChecklistMd): ChecklistItem | null {
  let seen = 0;
  for (const item of checklist.items) {
    if (item.checked) continue;
    seen += 1;
    if (seen === 2) return item;
  }
  return null;
}

/**
 * First unchecked item that appears *after* `afterItemId` in checklist order.
 * Used when advance must follow the item under review (not bare secondUnchecked),
 * so a premature `[x]` on the reviewing item cannot skip the true next row.
 */
export function uncheckedAfter(
  checklist: ChecklistMd,
  afterItemId: string,
): ChecklistItem | null {
  const id = afterItemId.trim();
  if (!id) return null;
  let seen = false;
  for (const item of checklist.items) {
    if (!seen) {
      if (item.id === id) seen = true;
      continue;
    }
    if (!item.checked) return item;
  }
  return null;
}

/**
 * Sticky reviewing id is usable only when the row exists and every earlier
 * checklist item is already checked. Otherwise advance may have seeded the
 * *next* id before the agent checked off the completed current item — honoring
 * sticky then would skip the still-open predecessor.
 */
export function effectiveReviewingItemId(
  checklist: ChecklistMd,
  reviewingItemId?: string | null,
): string | null {
  const rid = (reviewingItemId ?? "").trim();
  if (!rid) return null;
  const idx = checklist.items.findIndex((i) => i.id === rid);
  if (idx < 0) return null;
  for (let i = 0; i < idx; i++) {
    if (!checklist.items[i]!.checked) return null;
  }
  return rid;
}

/**
 * Resolve which item advance/done should mark, and which to implement next.
 * When `reviewingItemId` is set (sticky from first product edit), prefer it over
 * firstUnchecked so premature checklist checks cannot rename "current".
 */
export function resolveAdvanceTargets(
  checklist: ChecklistMd,
  reviewingItemId?: string | null,
): {
  current: ChecklistItem | null;
  next: ChecklistItem | null;
  unchecked: number;
} {
  const unchecked = countUnchecked(checklist);
  const rid = effectiveReviewingItemId(checklist, reviewingItemId);
  if (rid) {
    const current = checklist.items.find((i) => i.id === rid) ?? null;
    if (current) {
      return {
        current,
        next: uncheckedAfter(checklist, rid),
        unchecked,
      };
    }
  }
  return {
    current: firstUnchecked(checklist),
    next: secondUnchecked(checklist),
    unchecked,
  };
}

/**
 * Extract the "implement next" item id from an Advance followup body.
 * Used when arming sticky reviewing_item_id so a premature `[x]` before the
 * first product edit cannot retarget via firstUnchecked.
 */
export function parseAdvanceNextItemId(
  pendingFollowup: string | null | undefined,
): string | null {
  const text = (pendingFollowup ?? "").trim();
  if (!text || text.includes("\0")) return null;
  const m = text.match(
    /(?:Then implement next|然后实现下一项)\s*[:：]\s*([A-Za-z0-9][\w.-]*)/,
  );
  const id = m?.[1]?.trim() ?? "";
  if (!id || id.includes("\0")) return null;
  return id;
}

export function isLastUnchecked(checklist: ChecklistMd): boolean {
  return countUnchecked(checklist) === 1;
}

export function itemsMissingSeparatorId(checklist: ChecklistMd): ChecklistItem[] {
  return checklist.items.filter((i) => !i.idFromSeparator);
}
