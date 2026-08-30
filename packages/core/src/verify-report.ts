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

export function defaultVerifyReportPath(projectRoot: string): string {
  // Prefer normalized root so padded absolutes do not become cwd-relative joins.
  const root = normalizeProjectRoot(projectRoot) ?? "";
  return path.join(root, ".autopilot", "verify-last.json");
}
