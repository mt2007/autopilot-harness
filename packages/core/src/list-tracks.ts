import fs from "node:fs";
import path from "node:path";
import {
  countUnchecked,
  parseChecklist,
} from "./checklist-md.js";
import type { Phase, StateStore } from "./state-store.js";

export interface TrackSummary {
  slug: string;
  title: string;
  phase: Phase;
  paused: boolean;
  pausedReason?: "stuck" | "repeated_errors" | "human_gate";
  checklistTotal: number;
  checklistDone: number;
  planPath: string;
  updatedAt: string;
}

export function isRunnableTrack(t: TrackSummary): boolean {
  if (t.paused) return false;
  const unchecked = t.checklistTotal - t.checklistDone;
  if (unchecked <= 0) return false;
  return (
    t.phase === "planning" ||
    t.phase === "executing" ||
    t.phase === "idle" ||
    t.phase === "done"
  );
}

function readPlansDir(root: string, plansDir = "plans"): string[] {
  const dir = path.join(root, plansDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

function titleFromPlan(planPath: string, slug: string): string {
  if (!fs.existsSync(planPath)) return slug;
  const first = fs.readFileSync(planPath, "utf8").split(/\r?\n/)[0] ?? "";
  const m = first.match(/^#\s+(.+)/);
  return m?.[1]?.trim() ?? slug;
}

export function listTracks(
  root: string,
  store?: StateStore,
  filter: "runnable" | "planning" | "all" = "all",
  plansDir = "plans",
): TrackSummary[] {
  const slugs = readPlansDir(root, plansDir);
  const tracks: TrackSummary[] = [];

  for (const slug of slugs) {
    const planPath = path.join(root, plansDir, slug, "plan.md");
    const checklistPath = path.join(root, plansDir, slug, "checklist.md");
    let checklistTotal = 0;
    let checklistDone = 0;
    if (fs.existsSync(checklistPath)) {
      const cl = parseChecklist(checklistPath);
      checklistTotal = cl.items.length;
      checklistDone = cl.items.filter((i) => i.checked).length;
    } else if (!fs.existsSync(planPath)) {
      continue;
    }

    let phase: Phase = "idle";
    let paused = false;
    let pausedReason: TrackSummary["pausedReason"];
    let updatedAt = new Date(0).toISOString();

    if (store) {
      const sessions = store.db
        .prepare(
          `SELECT * FROM sessions WHERE track_id = ? ORDER BY last_active_at DESC LIMIT 1`,
        )
        .all(slug) as Array<{
        phase: Phase;
        paused: number;
        paused_reason: string | null;
        last_active_at: string;
      }>;
      const latest = sessions[0];
      if (latest) {
        phase = latest.phase;
        paused = latest.paused === 1;
        if (
          latest.paused_reason === "stuck" ||
          latest.paused_reason === "repeated_errors" ||
          latest.paused_reason === "human_gate"
        ) {
          pausedReason = latest.paused_reason;
        }
        updatedAt = latest.last_active_at;
      } else {
        if (checklistTotal > 0 && checklistDone === checklistTotal) {
          phase = "done";
        } else if (checklistTotal - checklistDone > 0 && fs.existsSync(planPath)) {
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
      updatedAt,
    });
  }

  if (filter === "all") return tracks;
  if (filter === "planning") {
    return tracks.filter((t) => t.phase === "planning");
  }
  return tracks.filter(isRunnableTrack);
}

/** RUN gate: need concrete slug, checklist with ≥1 unchecked, not paused. */
export function canEnterExecuting(options: {
  slug: string | undefined;
  checklistPath: string;
  paused: boolean;
}): { ok: true } | { ok: false; reason: string } {
  const { slug, checklistPath, paused } = options;
  if (!slug || slug === "_pending") {
    return { ok: false, reason: "no track slug" };
  }
  if (!checklistPath || !fs.existsSync(checklistPath)) {
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
