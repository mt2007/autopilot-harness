import fs from "node:fs";
import path from "node:path";
import {
  countUnchecked,
  parseChecklist,
} from "./checklist-md.js";
import {
  isRealpathInsideProject,
  normalizeInProjectPlansDir,
  normalizeProjectRoot,
} from "./project-path.js";
import type { Phase, StateStore } from "./state-store.js";
import { isSafeTrackSlug } from "./track-slug.js";

export {
  isLexicallyInsideProject,
  isRealpathInsideProject,
  normalizeInProjectPlansDir,
  normalizeProjectRoot,
} from "./project-path.js";

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
  // Refuse symlink / escaped plansDir — open(path.join(root, plans, …)) follows
  // intermediate directory symlinks and would otherwise read files outside the project.
  // root must already be normalizeProjectRoot'd by listTracks.
  if (
    typeof plansDir !== "string" ||
    !root ||
    root.includes("\0") ||
    plansDir.includes("\0")
  ) {
    return [];
  }
  const dir = path.join(root, plansDir);
  try {
    const lst = fs.lstatSync(dir);
    if (lst.isSymbolicLink() || !lst.isDirectory()) return [];
    if (!isRealpathInsideProject(root, dir)) return [];
  } catch {
    return [];
  }
  const names = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(
      (d) =>
        d.isDirectory() &&
        !d.isSymbolicLink() &&
        isSafeTrackSlug(d.name),
    )
    .map((d) => d.name);
  // Re-check after readdir — TOCTOU if plans was swapped for an escaping symlink.
  try {
    const lst = fs.lstatSync(dir);
    if (lst.isSymbolicLink() || !lst.isDirectory()) return [];
    if (!isRealpathInsideProject(root, dir)) return [];
  } catch {
    return [];
  }
  return names;
}

function titleFromPlan(
  planPath: string,
  slug: string,
  projectRoot: string,
): string {
  // Untrusted plans/*/plan.md — refuse symlink follow / oversized read (listing OOM).
  if (!planPath || planPath.includes("\0")) return slug;
  const root = normalizeProjectRoot(projectRoot);
  if (!root) return slug;
  const maxBytes = 65_536;
  try {
    const nofollow =
      typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
    if (nofollow === 0) {
      const lst = fs.lstatSync(planPath);
      if (lst.isSymbolicLink() || !lst.isFile()) return slug;
    }
    const fd = fs.openSync(planPath, fs.constants.O_RDONLY | nofollow);
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile() || st.size <= 0) return slug;
      // Bind fd to path identity always (not only when O_NOFOLLOW is missing).
      const lst = fs.lstatSync(planPath);
      if (lst.isSymbolicLink() || !lst.isFile()) return slug;
      if (lst.ino !== st.ino || lst.dev !== st.dev) return slug;
      // Re-check containment after open (same intermediate-dir TOCTOU as checklist).
      if (!isRealpathInsideProject(root, planPath)) return slug;
      const len = Math.min(st.size, maxBytes);
      const buf = Buffer.alloc(len);
      const n = fs.readSync(fd, buf, 0, len, 0);
      const first = buf.subarray(0, n).toString("utf8").split(/\r?\n/)[0] ?? "";
      const m = first.match(/^#\s+(.+)/);
      return m?.[1]?.trim() ?? slug;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return slug;
  }
}

export function listTracks(
  root: string,
  store?: StateStore,
  filter: "runnable" | "planning" | "all" = "all",
  plansDir = "plans",
): TrackSummary[] {
  // Trim before join/resolve — padded absolute roots become cwd-relative otherwise.
  const normalized = normalizeProjectRoot(root);
  if (!normalized) return [];
  root = normalized;
  const safePlans = normalizeInProjectPlansDir(root, plansDir);
  if (!safePlans) return [];
  plansDir = safePlans;
  const slugs = readPlansDir(root, plansDir);
  const tracks: TrackSummary[] = [];

  for (const slug of slugs) {
    const trackDir = path.join(root, plansDir, slug);
    // Slug dir must stay a real in-project directory (not swapped for a symlink).
    try {
      const lst = fs.lstatSync(trackDir);
      if (lst.isSymbolicLink() || !lst.isDirectory()) continue;
      if (!isRealpathInsideProject(root, trackDir)) continue;
    } catch {
      continue;
    }
    const planPath = path.join(trackDir, "plan.md");
    const checklistPath = path.join(trackDir, "checklist.md");
    let checklistTotal = 0;
    let checklistDone = 0;
    const checklistInProject = isRealpathInsideProject(root, checklistPath);
    const planInProject = isRealpathInsideProject(root, planPath);
    if (checklistInProject) {
      try {
        const cl = parseChecklist(checklistPath, { projectRoot: root });
        checklistTotal = cl.items.length;
        checklistDone = cl.items.filter((i) => i.checked).length;
      } catch {
        // Symlink / unreadable checklist — list track without item counts.
      }
    } else if (!planInProject) {
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
        } else if (checklistTotal - checklistDone > 0 && planInProject) {
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
      title: planInProject ? titleFromPlan(planPath, slug, root) : slug,
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

/** RUN gate: need concrete slug, in-project checklist with ≥1 unchecked, not paused. */
export function canEnterExecuting(options: {
  slug: string | undefined;
  checklistPath: string;
  paused: boolean;
  /** Required — refuse checklist paths whose realpath escapes the project. */
  projectRoot: string;
}): { ok: true } | { ok: false; reason: string } {
  const { slug, checklistPath, paused, projectRoot } = options;
  if (!slug || slug === "_pending") {
    return { ok: false, reason: "no track slug" };
  }
  const root = normalizeProjectRoot(projectRoot);
  if (!root) {
    return { ok: false, reason: "invalid project root" };
  }
  if (!checklistPath || !fs.existsSync(checklistPath)) {
    return { ok: false, reason: "checklist missing" };
  }
  if (!isRealpathInsideProject(root, checklistPath)) {
    return { ok: false, reason: "checklist outside project" };
  }
  let unchecked = 0;
  try {
    unchecked = countUnchecked(
      parseChecklist(checklistPath, { projectRoot: root }),
    );
  } catch {
    return { ok: false, reason: "checklist unreadable" };
  }
  if (unchecked < 1) {
    return { ok: false, reason: "no unchecked items" };
  }
  if (paused) {
    return { ok: false, reason: "session paused" };
  }
  return { ok: true };
}
