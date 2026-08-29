import fs from "node:fs";
import path from "node:path";
import {
  canEnterExecuting,
  isRunnableTrack,
  listTracks,
  type TrackSummary,
} from "./list-tracks.js";
import type { SessionRow, StateStore } from "./state-store.js";
import { isSafeTrackSlug } from "./track-slug.js";

export type ConcurrencyMode = "one_executor" | "worktree_per_session";

export interface PhaseActionConfig {
  concurrencyMode?: ConcurrencyMode;
  plansDir?: string;
}

export type PhaseActionOk = { ok: true; session: SessionRow };
export type PhaseActionFail = {
  ok: false;
  userMessage: string;
  needPick?: boolean;
  candidates?: TrackSummary[];
};

export type PhaseActionResult = PhaseActionOk | PhaseActionFail;

export { isSafeTrackSlug } from "./track-slug.js";

function nowIso(): string {
  return new Date().toISOString();
}

function checklistPathFor(
  projectRoot: string,
  slug: string,
  plansDir: string,
): string {
  return path.join(projectRoot, plansDir, slug, "checklist.md");
}

function ensureSession(
  store: StateStore,
  conversationId: string,
  projectRoot: string,
): SessionRow {
  const existing = store.getSession(conversationId);
  if (existing) return existing;
  return store.upsertSession({
    conversation_id: conversationId,
    project_root: projectRoot,
    code_root: projectRoot,
    platform: "cursor",
    phase: "idle",
    armed: 0,
    paused: 0,
    track_id: "_pending",
    checklist_path: "",
  });
}

function upsertTrack(
  store: StateStore,
  slug: string,
  checklistPath: string,
  plansDir: string,
  projectRoot: string,
): void {
  const ts = nowIso();
  const planPath = path.join(projectRoot, plansDir, slug, "plan.md");
  const briefPath = path.join(projectRoot, plansDir, slug, "brief.md");
  store.db
    .prepare(
      `INSERT INTO tracks (track_id, slug, checklist_path, plan_path, brief_path, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(track_id) DO UPDATE SET
         slug = excluded.slug,
         checklist_path = excluded.checklist_path,
         plan_path = excluded.plan_path,
         brief_path = excluded.brief_path,
         updated_at = excluded.updated_at`,
    )
    .run(
      slug,
      slug,
      checklistPath,
      fs.existsSync(planPath) ? planPath : null,
      fs.existsSync(briefPath) ? briefPath : null,
      ts,
    );
}

function candidatePayload(tracks: TrackSummary[]): string {
  return JSON.stringify(
    tracks.map((t) => ({
      slug: t.slug,
      title: t.title,
      phase: t.phase,
      progress: `${t.checklistDone}/${t.checklistTotal}`,
    })),
  );
}

function resolveRunSlug(
  store: StateStore,
  session: SessionRow,
  projectRoot: string,
  plansDir: string,
  requestedSlug?: string,
):
  | { kind: "slug"; slug: string }
  | { kind: "pick"; candidates: TrackSummary[] }
  | { kind: "none"; userMessage: string } {
  const runnable = listTracks(projectRoot, store, "runnable", plansDir).filter(
    (t) => isSafeTrackSlug(t.slug),
  );

  if (requestedSlug) {
    if (!isSafeTrackSlug(requestedSlug)) {
      return {
        kind: "none",
        userMessage: `Invalid track slug "${requestedSlug}".`,
      };
    }
    const hit = runnable.find((t) => t.slug === requestedSlug);
    if (!hit) {
      const all = listTracks(projectRoot, store, "all", plansDir);
      if (!all.some((t) => t.slug === requestedSlug)) {
        return {
          kind: "none",
          userMessage: `Track "${requestedSlug}" not found or has no unchecked checklist items.`,
        };
      }
      return {
        kind: "none",
        userMessage: `Track "${requestedSlug}" is not runnable (paused or no unchecked items).`,
      };
    }
    return { kind: "slug", slug: requestedSlug };
  }

  // Prefer this conversation's bound track if runnable
  if (session.track_id && session.track_id !== "_pending") {
    const bound = runnable.find((t) => t.slug === session.track_id);
    if (bound) {
      return { kind: "slug", slug: bound.slug };
    }
  }

  if (runnable.length === 0) {
    return {
      kind: "none",
      userMessage:
        "No runnable plan. Use /autopilot-on to plan, then finalize a checklist with unchecked items.",
    };
  }
  if (runnable.length === 1) {
    return { kind: "slug", slug: runnable[0]!.slug };
  }
  return { kind: "pick", candidates: runnable };
}

/** Enter executing for a concrete track (RUN gate). */
export function applyRun(
  store: StateStore,
  conversationId: string,
  projectRoot: string,
  opts?: {
    slug?: string;
    config?: PhaseActionConfig;
  },
): PhaseActionResult {
  const plansDir = opts?.config?.plansDir ?? "plans";
  const concurrencyMode = opts?.config?.concurrencyMode ?? "one_executor";
  const session = ensureSession(store, conversationId, projectRoot);

  const resolved = resolveRunSlug(
    store,
    session,
    projectRoot,
    plansDir,
    opts?.slug,
  );

  if (resolved.kind === "none") {
    return { ok: false, userMessage: resolved.userMessage };
  }

  if (resolved.kind === "pick") {
    store.upsertSession({
      conversation_id: conversationId,
      project_root: session.project_root,
      code_root: session.code_root,
      pending_action: "run",
      track_candidates_json: candidatePayload(resolved.candidates),
      armed: 0,
      // phase unchanged — do not write executing
    });
    const lines = resolved.candidates
      .map(
        (t, i) =>
          `  ${i + 1}. ${t.slug} — ${t.title} (${t.checklistTotal - t.checklistDone}/${t.checklistTotal} left)`,
      )
      .join("\n");
    return {
      ok: false,
      needPick: true,
      candidates: resolved.candidates,
      userMessage: `Select a plan to execute:\n\n${lines}\n\nReply with a number or /autopilot-run <slug>.`,
    };
  }

  const slug = resolved.slug;
  if (!isSafeTrackSlug(slug)) {
    return {
      ok: false,
      userMessage: `Invalid track slug "${slug}".`,
    };
  }
  const checklistPath = checklistPathFor(projectRoot, slug, plansDir);
  const gate = canEnterExecuting({
    slug,
    checklistPath,
    paused: session.paused === 1,
  });
  if (!gate.ok) {
    return {
      ok: false,
      userMessage: `Cannot start executing: ${gate.reason}.`,
    };
  }

  // Atomically re-check one_executor and write track+session+chain so concurrent
  // RUNs cannot both pass the gate, and a mid-write crash does not leave a
  // half-armed executing session without a matching track/chain update.
  try {
    return store.exclusiveWrite<PhaseActionResult>(() => {
      if (concurrencyMode === "one_executor") {
        const other = store.findExecutingSession(conversationId);
        if (other) {
          return {
            commit: false,
            value: {
              ok: false,
              userMessage: `Another session is already executing (${other.track_id}). Send Autopilot OFF there or wait, then retry.`,
            },
          };
        }
      }

      upsertTrack(store, slug, checklistPath, plansDir, projectRoot);

      const updated = store.upsertSession({
        conversation_id: conversationId,
        project_root: projectRoot,
        code_root: projectRoot,
        track_id: slug,
        checklist_path: checklistPath,
        phase: "executing",
        armed: 1,
        paused: 0,
        paused_reason: null,
        pending_action: null,
        track_candidates_json: null,
        error_count: 0,
        idle_stop_count: 0,
      });

      store.ensureReviewChain(conversationId);

      return { commit: true, value: { ok: true, session: updated } };
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/busy|locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(msg)) {
      return {
        ok: false,
        userMessage:
          "State database is busy; retry Autopilot RUN in a moment.",
      };
    }
    throw err;
  }
}

/** REPLAN: back to planning; reset review chain; keep track + checklist file. */
export function applyReplan(
  store: StateStore,
  conversationId: string,
  projectRoot: string,
  opts?: { slug?: string; config?: PhaseActionConfig },
): PhaseActionResult {
  const plansDir = opts?.config?.plansDir ?? "plans";
  const session = ensureSession(store, conversationId, projectRoot);

  let slug = opts?.slug ?? session.track_id;
  if (slug && slug !== "_pending" && !isSafeTrackSlug(slug)) {
    return {
      ok: false,
      userMessage: `Invalid track slug "${slug}".`,
    };
  }
  if (!slug || slug === "_pending") {
    const all = listTracks(projectRoot, store, "all", plansDir).filter((t) =>
      isSafeTrackSlug(t.slug),
    );
    if (all.length === 1) {
      slug = all[0]!.slug;
    } else if (all.length > 1) {
      store.upsertSession({
        conversation_id: conversationId,
        project_root: session.project_root,
        code_root: session.code_root,
        pending_action: "replan",
        track_candidates_json: candidatePayload(all),
        armed: 0,
      });
      const lines = all
        .map((t, i) => `  ${i + 1}. ${t.slug} — ${t.title}`)
        .join("\n");
      return {
        ok: false,
        needPick: true,
        candidates: all,
        userMessage: `Select a plan to replan:\n\n${lines}\n\nReply with a number or /autopilot-replan <slug>.`,
      };
    } else {
      return {
        ok: false,
        userMessage: "No plan to replan. Use /autopilot-on first.",
      };
    }
  }

  const checklistPath =
    session.checklist_path && session.track_id === slug
      ? session.checklist_path
      : checklistPathFor(projectRoot, slug, plansDir);

  const updated = store.upsertSession({
    conversation_id: conversationId,
    project_root: projectRoot,
    code_root: projectRoot,
    track_id: slug,
    checklist_path: checklistPath,
    phase: "planning",
    armed: 0,
    paused: 0,
    paused_reason: null,
    pending_action: null,
    track_candidates_json: null,
  });

  store.updateReviewChain(conversationId, {
    fix_round: 0,
    confirm_left: null,
    chain_pending: 0,
    code_edited: 0,
    item_confirm_complete: 0,
  });

  return { ok: true, session: updated };
}

/** Resolve pending track pick (digit or slug) then apply run/replan. */
export function applyTrackPick(
  store: StateStore,
  conversationId: string,
  projectRoot: string,
  pick: string,
  opts?: { config?: PhaseActionConfig },
): PhaseActionResult {
  const session = store.getSession(conversationId);
  if (!session?.pending_action) {
    return {
      ok: false,
      userMessage: "No pending track selection.",
    };
  }

  const pending = session.pending_action;
  if (pending !== "run" && pending !== "replan") {
    return {
      ok: false,
      userMessage: `Unknown pending action "${pending}".`,
    };
  }

  if (!session.track_candidates_json) {
    return { ok: false, userMessage: "Invalid track candidates JSON." };
  }

  let candidates: Array<{ slug: string }> = [];
  try {
    const parsed: unknown = JSON.parse(session.track_candidates_json);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return { ok: false, userMessage: "Invalid track candidates JSON." };
    }
    const hasValidSlug = parsed.some(
      (c) =>
        !!c &&
        typeof c === "object" &&
        !Array.isArray(c) &&
        typeof (c as { slug?: string }).slug === "string" &&
        isSafeTrackSlug((c as { slug: string }).slug),
    );
    if (!hasValidSlug) {
      return { ok: false, userMessage: "Invalid track candidates JSON." };
    }
    candidates = parsed as Array<{ slug: string }>;
  } catch {
    return { ok: false, userMessage: "Invalid track candidates JSON." };
  }

  let slug: string | undefined;
  if (/^\d+$/.test(pick)) {
    const idx = Number.parseInt(pick, 10) - 1;
    const entry = candidates[idx];
    slug =
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      typeof (entry as { slug?: string }).slug === "string"
        ? (entry as { slug: string }).slug
        : undefined;
    if (!slug || !isSafeTrackSlug(slug)) {
      return {
        ok: false,
        userMessage: `Invalid selection "${pick}". Choose 1–${candidates.length}.`,
      };
    }
  } else {
    if (!isSafeTrackSlug(pick)) {
      return {
        ok: false,
        userMessage: `Invalid track slug "${pick}".`,
      };
    }
    slug = pick;
    if (
      !candidates.some(
        (c) =>
          !!c &&
          typeof c === "object" &&
          !Array.isArray(c) &&
          (c as { slug?: string }).slug === slug,
      )
    ) {
      return {
        ok: false,
        userMessage: `Unknown slug "${pick}".`,
      };
    }
  }

  // Keep pending on nested failure so the user can retry the same pick.
  // Success paths (applyRun / applyReplan) clear pending themselves.
  if (pending === "replan") {
    return applyReplan(store, conversationId, projectRoot, {
      slug,
      config: opts?.config,
    });
  }
  return applyRun(store, conversationId, projectRoot, {
    slug,
    config: opts?.config,
  });
}

export { isRunnableTrack };
