import fs from "node:fs";

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

export function parseChecklist(checklistPath: string): ChecklistMd {
  const content = fs.readFileSync(checklistPath, "utf8");
  const lines = content.split(/\r?\n/);
  const items: ChecklistItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const item = parseItemLine(lines[i]!, i + 1);
    if (item) items.push(item);
  }
  return { path: checklistPath, items };
}

export function countUnchecked(checklist: ChecklistMd): number {
  return checklist.items.filter((i) => !i.checked).length;
}

export function firstUnchecked(checklist: ChecklistMd): ChecklistItem | null {
  return checklist.items.find((i) => !i.checked) ?? null;
}

export function isLastUnchecked(checklist: ChecklistMd): boolean {
  return countUnchecked(checklist) === 1;
}

export function itemsMissingSeparatorId(checklist: ChecklistMd): ChecklistItem[] {
  return checklist.items.filter((i) => !i.idFromSeparator);
}
