import fs from "node:fs";
import path from "node:path";
import type { ChecklistItem } from "./checklist-md.js";

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

export function readVerifyReport(reportPath: string): VerifyLastReport | null {
  if (!fs.existsSync(reportPath)) return null;
  try {
    const raw = fs.readFileSync(reportPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as VerifyLastReport;
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
}): VerifyEvaluation {
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
  return path.join(projectRoot, ".autopilot", "verify-last.json");
}
