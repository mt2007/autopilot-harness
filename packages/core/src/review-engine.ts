import fs from "node:fs";
import {
  countUnchecked,
  firstUnchecked,
  parseChecklist,
  type ChecklistItem,
} from "./checklist-md.js";
import { getLens } from "./review-lenses.js";
import type { Phase, ReviewChainRow, SessionRow, StateStore } from "./state-store.js";
import { isSafeTrackSlug } from "./track-slug.js";
import {
  defaultVerifyReportPath,
  evaluateVerifyReport,
  type VerifyCommandConfig,
} from "./verify-report.js";

export type FollowupKind =
  | "review.fix"
  | "review.confirm"
  | "review.confirm_final"
  | "advance"
  | "done"
  | "recover"
  | "stuck"
  | "verify_fix";

export interface FollowupAction {
  kind: FollowupKind;
  message: string;
  loop: true;
  meta?: Record<string, string | number | boolean>;
}

export interface StopHandlerInput {
  conversationId: string;
  status: "completed" | "error" | "aborted";
  loopCount: number;
}

export interface ReviewEngineConfig {
  confirmRounds: number;
  verifyEnabled: boolean;
  verifyCommands: VerifyCommandConfig[];
  maxIdleStops: number;
  projectRoot: string;
  /** Optional override for verify report path (tests). */
  verifyReportPath?: string;
  /** Render followup message; default English templates. */
  renderFollowup?: (kind: FollowupKind, vars: Record<string, string | number>) => string;
}

function defaultRender(kind: FollowupKind, vars: Record<string, string | number>): string {
  switch (kind) {
    case "review.fix":
      return `Review fix round ${vars.round}: inspect the full diff, fix CRITICAL/HIGH issues, run relevant tests. Do not commit.`;
    case "review.confirm":
      return `Review confirm ${vars.n}/${vars.total} — Lens (${vars.lensTitle}): ${vars.lensFocus}. Stay on this lens only. Do not commit.`;
    case "review.confirm_final":
      return `Review confirm ${vars.n}/${vars.total} — Lens (${vars.lensTitle}): ${vars.lensFocus}. Read-only final lens; do not change code or commit.`;
    case "advance":
      return `Advance checklist: mark current item [x], scoped conventional commit if dirty, then implement next item: ${vars.nextId ?? ""} — ${vars.nextTitle ?? ""}.`;
    case "done":
      return `All checklist items done. Mark the last item [x], scoped commit if needed, then stop. Phase is done.`;
    case "recover":
      return `Recover: the previous turn ended with an error. Continue the current checklist item without advancing.`;
    case "stuck":
      return `Stuck: no progress for several stops. Change strategy or send Autopilot RESUME after fixing.`;
    case "verify_fix":
      return `Verify failed (${vars.reason ?? "unknown"}). Fix verify commands and rewrite verify-last.json; do not advance.`;
    default:
      return "";
  }
}

export class ReviewEngine {
  constructor(
    private readonly store: StateStore,
    private readonly config: ReviewEngineConfig,
  ) {}

  private render(kind: FollowupKind, vars: Record<string, string | number>): string {
    return (this.config.renderFollowup ?? defaultRender)(kind, vars);
  }

  /** E1: afterFileEdit product code → code_edited=1 */
  onCodeEdited(conversationId: string): void {
    this.store.markCodeEdited(conversationId);
  }

  handleStop(input: StopHandlerInput): FollowupAction | null {
    const session = this.store.getSession(input.conversationId);
    if (!session) return null;

    if (input.status === "error" || input.status === "aborted") {
      return this.handleErrorStop(session, input);
    }

    // Precondition: armed + executing + paused=0 + completed
    if (session.armed !== 1 || session.phase !== "executing" || session.paused !== 0) {
      return null;
    }

    const chain = this.store.ensureReviewChain(input.conversationId);
    this.maybeResetErrorCountOnItemChange(session);

    // Order: E2 → E4 → E5 → E3 → E0
    if (chain.code_edited === 1) {
      return this.e2Fix(session, chain);
    }
    if (chain.confirm_left !== null && chain.confirm_left > 0) {
      return this.e4Confirm(session, chain);
    }
    if (
      chain.confirm_left === 0 ||
      (chain.item_confirm_complete === 1 && chain.confirm_left === null)
    ) {
      return this.e5Gate(session, chain);
    }
    const inChain = chain.chain_pending === 1 || input.loopCount > 0;
    if (
      chain.confirm_left === null &&
      chain.item_confirm_complete === 0 &&
      inChain
    ) {
      return this.e3ArmConfirm(session, chain);
    }
    // E0
    return null;
  }

  private handleErrorStop(session: SessionRow, input: StopHandlerInput): FollowupAction | null {
    const nextCount = session.error_count + 1;
    if (nextCount >= 3) {
      this.store.upsertSession({
        conversation_id: session.conversation_id,
        project_root: session.project_root,
        code_root: session.code_root,
        error_count: nextCount,
        last_error: input.status,
        paused: 1,
        paused_reason: "repeated_errors",
        armed: 0,
      });
      return null;
    }
    this.store.upsertSession({
      conversation_id: session.conversation_id,
      project_root: session.project_root,
      code_root: session.code_root,
      error_count: nextCount,
      last_error: input.status,
    });
    if (session.armed === 1 && session.phase === "executing" && session.paused === 0) {
      return {
        kind: "recover",
        message: this.render("recover", {}),
        loop: true,
      };
    }
    return null;
  }

  /** completed stop → reset error_count */
  noteCompletedOk(session: SessionRow): void {
    if (session.error_count > 0) {
      this.store.upsertSession({
        conversation_id: session.conversation_id,
        project_root: session.project_root,
        code_root: session.code_root,
        error_count: 0,
        last_error: null,
      });
    }
  }

  private maybeResetErrorCountOnItemChange(session: SessionRow): void {
    if (!session.checklist_path || !fs.existsSync(session.checklist_path)) return;
    // error_count reset on item id change is handled by callers tracking last item;
    // E5b always zeroes error_count on advance.
  }

  private e2Fix(session: SessionRow, chain: ReviewChainRow): FollowupAction {
    const fixRound = chain.fix_round + 1;
    this.store.updateReviewChain(session.conversation_id, {
      fix_round: fixRound,
      code_edited: 0,
      confirm_left: null,
      chain_pending: 1,
      // item_confirm_complete preserved (E2 path)
    });
    this.bumpProgress(session, { fix_round: fixRound });
    this.noteCompletedOk(session);
    return {
      kind: "review.fix",
      message: this.render("review.fix", { round: fixRound }),
      loop: true,
      meta: { fixRound },
    };
  }

  private e3ArmConfirm(session: SessionRow, _chain: ReviewChainRow): FollowupAction {
    const rounds = this.config.confirmRounds;
    const lens = getLens(1, rounds);
    const left = rounds - 1; // inject 1st then set left = rounds-1
    this.store.updateReviewChain(session.conversation_id, {
      confirm_left: left,
      chain_pending: 1,
    });
    this.bumpProgress(session, { confirm_left: left });
    this.noteCompletedOk(session);
    const kind: FollowupKind = rounds === 1 ? "review.confirm_final" : "review.confirm";
    return {
      kind,
      message: this.render(kind, {
        n: 1,
        total: rounds,
        lensTitle: lens.title,
        lensFocus: lens.focus,
      }),
      loop: true,
      meta: { n: 1, total: rounds },
    };
  }

  private e4Confirm(session: SessionRow, chain: ReviewChainRow): FollowupAction {
    const rounds = this.config.confirmRounds;
    const left = chain.confirm_left!;
    // lensIndex = rounds - left + 1 (before decrement)
    const n = rounds - left + 1;
    const lens = getLens(n, rounds);
    const newLeft = left - 1;
    this.store.updateReviewChain(session.conversation_id, {
      confirm_left: newLeft,
      chain_pending: 1,
    });
    this.bumpProgress(session, { confirm_left: newLeft });
    this.noteCompletedOk(session);
    const isFinal = n === rounds;
    const kind: FollowupKind = isFinal ? "review.confirm_final" : "review.confirm";
    // MUST return — never continue to E5 same stop
    return {
      kind,
      message: this.render(kind, {
        n,
        total: rounds,
        lensTitle: lens.title,
        lensFocus: lens.focus,
      }),
      loop: true,
      meta: { n, total: rounds, confirm_left: newLeft },
    };
  }

  private e5Gate(session: SessionRow, chain: ReviewChainRow): FollowupAction | null {
    // E5c first
    const checklistPath = session.checklist_path;
    let currentItem: ChecklistItem | null = null;
    if (checklistPath && fs.existsSync(checklistPath)) {
      const cl = parseChecklist(checklistPath);
      currentItem = firstUnchecked(cl);
    }

    const reportPath =
      this.config.verifyReportPath ?? defaultVerifyReportPath(this.config.projectRoot);
    const evalResult = evaluateVerifyReport({
      enabled: this.config.verifyEnabled,
      commands: this.config.verifyCommands,
      reportPath,
      currentItem,
      checklistPath: checklistPath || "",
    });

    if (evalResult.outcome === "fail") {
      // E5c: skip E5a; set confirm_left=0, item_confirm_complete=1
      this.store.updateReviewChain(session.conversation_id, {
        confirm_left: 0,
        item_confirm_complete: 1,
        chain_pending: 1,
      });
      this.incrementIdle(session);
      const after = this.store.getSession(session.conversation_id);
      if (after?.paused === 1 && after.paused_reason === "stuck") {
        return {
          kind: "stuck",
          message: this.render("stuck", {}),
          loop: true,
          meta: { reason: evalResult.reason ?? "fail" },
        };
      }
      return {
        kind: "verify_fix",
        message: this.render("verify_fix", { reason: evalResult.reason ?? "fail" }),
        loop: true,
        meta: { reason: evalResult.reason ?? "fail" },
      };
    }

    // E5a
    this.store.updateReviewChain(session.conversation_id, {
      confirm_left: null,
      fix_round: 0,
      code_edited: 0,
      chain_pending: 0,
      item_confirm_complete: 0,
    });

    // E5b advance gate
    return this.e5bAdvance(session);
  }

  private e5bAdvance(session: SessionRow): FollowupAction {
    this.store.upsertSession({
      conversation_id: session.conversation_id,
      project_root: session.project_root,
      code_root: session.code_root,
      error_count: 0,
      idle_stop_count: 0,
      last_error: null,
    });

    let unchecked = 0;
    let next: ChecklistItem | null = null;
    if (session.checklist_path && fs.existsSync(session.checklist_path)) {
      const cl = parseChecklist(session.checklist_path);
      unchecked = countUnchecked(cl);
      next = firstUnchecked(cl);
    }

    if (unchecked > 1) {
      return {
        kind: "advance",
        message: this.render("advance", {
          nextId: next?.id ?? "",
          nextTitle: next?.title ?? "",
        }),
        loop: true,
      };
    }

    // ===1 or ===0 → done
    this.store.upsertSession({
      conversation_id: session.conversation_id,
      project_root: session.project_root,
      code_root: session.code_root,
      phase: "done" as Phase,
      armed: 0,
      error_count: 0,
      idle_stop_count: 0,
    });
    return {
      kind: "done",
      message: this.render("done", {}),
      loop: true,
    };
  }

  private bumpProgress(
    session: SessionRow,
    _changed: { confirm_left?: number | null; fix_round?: number },
  ): void {
    if (session.idle_stop_count > 0) {
      this.store.upsertSession({
        conversation_id: session.conversation_id,
        project_root: session.project_root,
        code_root: session.code_root,
        idle_stop_count: 0,
      });
    }
  }

  private incrementIdle(session: SessionRow): void {
    const next = session.idle_stop_count + 1;
    if (next >= this.config.maxIdleStops) {
      this.store.upsertSession({
        conversation_id: session.conversation_id,
        project_root: session.project_root,
        code_root: session.code_root,
        idle_stop_count: next,
        paused: 1,
        paused_reason: "stuck",
        armed: 0,
      });
      // Same stop inject stuck once — caller gets verify_fix first in E5c;
      // for pure idle stuck, expose via checkStuckAfterStop
    } else {
      this.store.upsertSession({
        conversation_id: session.conversation_id,
        project_root: session.project_root,
        code_root: session.code_root,
        idle_stop_count: next,
      });
    }
  }

  /** After a no-progress stop that didn't inject, check stuck threshold. */
  checkStuck(session: SessionRow): FollowupAction | null {
    const fresh = this.store.getSession(session.conversation_id);
    if (!fresh) return null;
    if (fresh.paused === 1 && fresh.paused_reason === "stuck") {
      return {
        kind: "stuck",
        message: this.render("stuck", {}),
        loop: true,
      };
    }
    return null;
  }
}

/** Apply OFF trigger side effects (v0.1). */
export function applyOff(store: StateStore, conversationId: string): SessionRow | null {
  const session = store.getSession(conversationId);
  if (!session) return null;

  if (session.phase === "done") {
    return store.upsertSession({
      conversation_id: conversationId,
      project_root: session.project_root,
      code_root: session.code_root,
      phase: "idle",
      armed: 0,
      paused: 0,
      paused_reason: null,
    });
  }

  if (session.phase === "planning" || session.phase === "executing") {
    const wasPaused = session.paused === 1;
    let pausedReason = session.paused_reason;
    if (!wasPaused) {
      pausedReason = session.phase === "executing" ? "human_gate" : null;
    }
    // already paused → keep original paused_reason
    return store.upsertSession({
      conversation_id: conversationId,
      project_root: session.project_root,
      code_root: session.code_root,
      armed: 0,
      paused: 1,
      paused_reason: pausedReason,
      // phase unchanged; review chain untouched
    });
  }

  return session;
}

/** Apply ON trigger side effects (v0.1). */
export function applyOn(
  store: StateStore,
  conversationId: string,
  projectRoot: string,
  opts?: { initialBrief?: string; slug?: string },
): { ok: true; session: SessionRow } | { ok: false; userMessage: string } {
  const session = store.getSession(conversationId);
  if (session?.phase === "executing") {
    return {
      ok: false,
      userMessage:
        "Autopilot is executing. Send Autopilot OFF, REPLAN, or RESUME before ON.",
    };
  }

  if (opts?.slug && !isSafeTrackSlug(opts.slug)) {
    return {
      ok: false,
      userMessage: `Invalid track slug "${opts.slug}".`,
    };
  }

  const trackId = opts?.slug ?? session?.track_id ?? "_pending";

  if (session?.phase === "done") {
    const s = store.upsertSession({
      conversation_id: conversationId,
      project_root: projectRoot,
      code_root: projectRoot,
      phase: "planning",
      armed: 0,
      paused: 0,
      paused_reason: null,
      track_id: opts?.slug ?? session.track_id,
      platform: session.platform,
    });
    return { ok: true, session: s };
  }

  const s = store.upsertSession({
    conversation_id: conversationId,
    project_root: projectRoot,
    code_root: projectRoot,
    platform: session?.platform ?? "cursor",
    phase: "planning",
    armed: 0,
    paused: 0,
    paused_reason: null,
    track_id: trackId,
    checklist_path: session?.checklist_path ?? "",
  });
  return { ok: true, session: s };
}

/** Apply RESUME side effects. */
export function applyResume(store: StateStore, conversationId: string): SessionRow | null {
  const session = store.getSession(conversationId);
  if (!session) return null;

  const patch: Partial<SessionRow> & {
    conversation_id: string;
    project_root: string;
    code_root: string;
  } = {
    conversation_id: conversationId,
    project_root: session.project_root,
    code_root: session.code_root,
  };

  if (session.paused === 1) {
    patch.paused = 0;
    patch.paused_reason = null;
    patch.error_count = 0;
    patch.idle_stop_count = 0;
    if (session.phase === "executing") {
      // re-arm if checklist still has unchecked
      let hasUnchecked = false;
      if (session.checklist_path && fs.existsSync(session.checklist_path)) {
        hasUnchecked = countUnchecked(parseChecklist(session.checklist_path)) > 0;
      }
      patch.armed = hasUnchecked ? 1 : 0;
    }
  }

  if (session.phase === "planning") {
    patch.armed = 0;
  }

  return store.upsertSession(patch);
}

/** resume_review: only chain_pending=1 */
export function applyResumeReview(store: StateStore, conversationId: string): void {
  store.setChainPending(conversationId);
}
