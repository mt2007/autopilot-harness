import fs from "node:fs";
import path from "node:path";
import type { ChecklistItem } from "./checklist-md.js";
import {
  isRealpathInsideProject,
  normalizeProjectRoot,
} from "./project-path.js";

export interface VerifyCommandConfig {
  id: string;
  run?: string;
  required?: boolean;
}

export interface VerifyCommandResult {
  id: string;
  exitCode?: number;
  required?: boolean;
  stdoutTail?: string;
  stderrTail?: string;
  durationMs?: number;
}

export interface VerifyLastReport {
  itemId: string;
  checklistPath: string;
  ranAt: string;
  commands: VerifyCommandResult[];
}

export type VerifyOutcome = "pass" | "fail" | "skip";

export interface VerifyEvaluation {
  outcome: VerifyOutcome;
  reason?: string;
}

/** Cap hostile/symlink-replaced verify-last.json so stop-hook cannot OOM. */
export const MAX_VERIFY_REPORT_BYTES = 1_048_576;

export function readVerifyReport(
  reportPath: string,
  opts?: { projectRoot?: string },
): VerifyLastReport | null {
  // Untrusted project path: refuse empty/NUL/symlinks; size-cap before parse.
  if (!reportPath || reportPath.includes("\0")) return null;
  // Provided root must normalize; blank/padded/NUL → refuse (fail closed).
  let root: string | undefined;
  if (opts?.projectRoot !== undefined && opts?.projectRoot !== null) {
    const n = normalizeProjectRoot(opts.projectRoot);
    if (!n) return null;
    root = n;
  }
  try {
    const nofollow =
      typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
    if (nofollow === 0) {
      const lst = fs.lstatSync(reportPath);
      if (lst.isSymbolicLink() || !lst.isFile()) return null;
    }
    const fd = fs.openSync(reportPath, fs.constants.O_RDONLY | nofollow);
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile() || st.size > MAX_VERIFY_REPORT_BYTES) return null;
      // Bind fd to the path's current identity. Always — not only when O_NOFOLLOW
      // is missing. Otherwise an attacker can: (1) pass pre-open realpath check,
      // (2) swap an intermediate dir so open() follows to an outside file,
      // (3) swap back so post-open realpath looks in-project, then we would
      // read the outside inode via the already-open fd.
      const lst = fs.lstatSync(reportPath);
      if (lst.isSymbolicLink() || !lst.isFile()) return null;
      if (lst.ino !== st.ino || lst.dev !== st.dev) return null;
      // Re-check containment after open (O_NOFOLLOW only covers the final component).
      if (root && !isRealpathInsideProject(root, reportPath)) {
        return null;
      }
      const buf = Buffer.alloc(st.size);
      const n = fs.readSync(fd, buf, 0, st.size, 0);
      const raw = buf.subarray(0, n).toString("utf8");
      if (Buffer.byteLength(raw, "utf8") > MAX_VERIFY_REPORT_BYTES) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      return parsed as VerifyLastReport;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

export function evaluateVerifyReport(options: {
  enabled: boolean;
  commands: VerifyCommandConfig[];
  reportPath: string;
  currentItem: ChecklistItem | null;
  checklistPath: string;
  /** When set, refuse report files whose realpath escapes the project. */
  projectRoot?: string;
}): VerifyEvaluation {
  const {
    enabled,
    commands,
    reportPath,
    currentItem,
    checklistPath,
    projectRoot,
  } = options;

  if (!enabled) {
    return { outcome: "skip", reason: "verify disabled" };
  }

  const commandList = Array.isArray(commands) ? commands : [];
  const requiredCommands = commandList.filter((c) => c.required === true);
  if (requiredCommands.length === 0) {
    return { outcome: "skip", reason: "no required commands" };
  }

  // If caller supplied a projectRoot, it must normalize (trim blank/NUL).
  // Fail closed: do not skip containment; never path.resolve on padded absolute
  // roots (Node treats "  /abs  " as cwd-relative).
  let root: string | undefined;
  if (projectRoot !== undefined && projectRoot !== null) {
    const n =
      typeof projectRoot === "string"
        ? normalizeProjectRoot(projectRoot)
        : null;
    if (!n) {
      return { outcome: "fail", reason: "missing verify report" };
    }
    root = n;
  }

  // Resolve relative report paths against normalized projectRoot (not cwd).
  // Refuse NUL in reportPath before resolve — Node will otherwise embed \0 in the path.
  const resolvedReportPath =
    root &&
    typeof reportPath === "string" &&
    reportPath &&
    !reportPath.includes("\0")
      ? path.resolve(root, reportPath)
      : reportPath;

  // Existing report must stay in-project (intermediate dir symlink / poisoned path).
  // Missing path: fall through — readVerifyReport returns null → missing report.
  if (root) {
    try {
      fs.lstatSync(resolvedReportPath);
      if (!isRealpathInsideProject(root, resolvedReportPath)) {
        return { outcome: "fail", reason: "missing verify report" };
      }
    } catch {
      /* missing / unreadable — handled below */
    }
  }

  const report = readVerifyReport(resolvedReportPath, {
    projectRoot: root,
  });
  if (!report || typeof report !== "object") {
    return { outcome: "fail", reason: "missing verify report" };
  }

  if (!currentItem) {
    return { outcome: "fail", reason: "no current checklist item" };
  }

  if (typeof report.itemId !== "string" || report.itemId !== currentItem.id) {
    return { outcome: "fail", reason: "itemId mismatch" };
  }

  if (
    typeof report.checklistPath !== "string" ||
    report.checklistPath !== checklistPath
  ) {
    return { outcome: "fail", reason: "checklistPath mismatch" };
  }

  if (!Array.isArray(report.commands)) {
    return { outcome: "fail", reason: "invalid commands array" };
  }

  for (const cmd of requiredCommands) {
    const result = report.commands.find(
      (r): r is VerifyCommandResult =>
        !!r && typeof r === "object" && !Array.isArray(r) && r.id === cmd.id,
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

/**
 * Soft completion evidence for no-code checklist E0 continue when verify is
 * skipped (disabled / no required commands). Requires a readable in-project
 * report whose itemId matches the current checklist item. Optional `ok: false`
 * blocks; missing `ok` is allowed.
 *
 * When `notBefore` is set and the report includes a parseable `at` (ISO string,
 * finite epoch-ms/seconds number, or digit-only numeric string), reject reports
 * whose `at` is strictly older (stale evidence from an earlier review phase).
 * Missing `at` keeps legacy accept (need_evidence copy only requires itemId/ok);
 * a present but unparseable `at`, or an unparseable floor, is rejected when
 * `notBefore` is set (fail closed). Mid-item soft-done is also blocked by
 * fix_round>0 gates — notBefore is defense-in-depth for timestamped reports.
 */
export function hasNoCodeCompletionEvidence(options: {
  reportPath: string;
  currentItemId: string;
  projectRoot?: string;
  /** ISO timestamp — reject report.at when present and older than this. */
  notBefore?: string | null;
}): boolean {
  const { reportPath, currentItemId, projectRoot, notBefore } = options;
  if (!currentItemId || typeof currentItemId !== "string") return false;

  let root: string | undefined;
  if (projectRoot !== undefined && projectRoot !== null) {
    const n =
      typeof projectRoot === "string"
        ? normalizeProjectRoot(projectRoot)
        : null;
    if (!n) return false;
    root = n;
  }

  const resolvedReportPath =
    root &&
    typeof reportPath === "string" &&
    reportPath &&
    !reportPath.includes("\0")
      ? path.resolve(root, reportPath)
      : reportPath;

  if (root) {
    try {
      fs.lstatSync(resolvedReportPath);
      if (!isRealpathInsideProject(root, resolvedReportPath)) {
        return false;
      }
    } catch {
      return false;
    }
  }

  const report = readVerifyReport(resolvedReportPath, {
    projectRoot: root,
  });
  if (!report || typeof report !== "object") return false;
  if (typeof report.itemId !== "string" || report.itemId !== currentItemId) {
    return false;
  }
  const ok = (report as { ok?: unknown }).ok;
  // Only a boolean false rejects; other types / missing ok are allowed.
  if (ok === false) return false;

  const notBeforeRaw =
    typeof notBefore === "string" && notBefore.trim() && !notBefore.includes("\0")
      ? notBefore.trim()
      : null;
  if (notBeforeRaw) {
    const floor = Date.parse(notBeforeRaw);
    // Floor requested but unusable — fail closed (same class as unparseable `at`).
    if (Number.isNaN(floor)) return false;
    const rawAt = (report as { at?: unknown }).at;
    // Missing `at` → legacy accept (followups do not require at). Present but
    // unparseable must not skip the floor.
    if (rawAt !== undefined && rawAt !== null) {
      const atMs = parseEvidenceAtMs(rawAt);
      if (Number.isNaN(atMs) || atMs < floor) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Parse verify-last `at` to epoch ms. Accepts finite numbers, ISO strings, and
 * digit-only numeric strings. Digit-only forms use Number() first — never
 * Date.parse — because Date.parse("9") / "2026" invents legacy calendar dates.
 *
 * Integer (or near-integer) values with ≤10 digits are treated as unix seconds
 * and scaled to ms. 11+ digit values are left as ms.
 */
function parseEvidenceAtMs(rawAt: unknown): number {
  let atMs = NaN;
  if (typeof rawAt === "number" && Number.isFinite(rawAt)) {
    atMs = rawAt;
  } else if (typeof rawAt === "string" && rawAt.trim() && !rawAt.includes("\0")) {
    const trimmed = rawAt.trim();
    // Prefer numeric parse for digit-only forms. Date.parse("9") / "100" /
    // "2026" invents legacy calendar dates and can bypass notBefore.
    if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)) {
      const n = Number(trimmed);
      if (Number.isFinite(n)) atMs = n;
    } else {
      atMs = Date.parse(trimmed);
    }
  }
  if (!Number.isNaN(atMs) && atMs >= 0) {
    const whole = Math.trunc(atMs);
    // Near-integer only — do not rescale fractional ms.
    if (Math.abs(atMs - whole) < 1e-9) {
      const digits = String(Math.abs(whole)).length;
      if (digits >= 1 && digits <= 10) {
        atMs = whole * 1000;
      }
    }
  }
  return atMs;
}

export function defaultVerifyReportPath(projectRoot: string): string {
  // Prefer normalized root so padded absolutes do not become cwd-relative joins.
  const root = normalizeProjectRoot(projectRoot) ?? "";
  return path.join(root, ".autopilot", "verify-last.json");
}
