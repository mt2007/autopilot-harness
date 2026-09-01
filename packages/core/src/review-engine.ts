import {
  countUnchecked,
  firstUnchecked,
  parseChecklist,
  secondUnchecked,
  type ChecklistItem,
} from "./checklist-md.js";
import { isRealpathInsideProject, normalizeProjectRoot } from "./project-path.js";
import { getLens, type ConfirmLens } from "./review-lenses.js";
import {
  ensureAmbientReviewSession,
  isChecklistExecuting,
  sessionReviewRunnable,
} from "./review-scope.js";
import type { ReviewScope } from "./project-config.js";
import {
  sanitizeSessionDisplayText,
  type Phase,
  type ReviewChainRow,
  type SessionRow,
  type StateStore,
} from "./state-store.js";
import { isSafeTrackSlug } from "./track-slug.js";
import {
  automationFollowupPresent,
  followupInFlight,
  pendingRedeliverAllowed,
  readTranscriptTail,
} from "./transcript-followup.js";
import { isRecoverOrStuckFollowupMessage } from "./trigger-parser.js";
import {
  defaultVerifyReportPath,
  evaluateVerifyReport,
  hasNoCodeCompletionEvidence,
  type VerifyCommandConfig,
} from "./verify-report.js";

export type FollowupKind =
  | "review.fix"
  | "review.confirm"
  | "review.confirm_final"
  | "advance"
  | "done"
  | "review_complete"
  | "recover"
  | "recover_planning"
  | "recover_ambient"
  | "stuck"
  | "verify_fix";

export interface FollowupAction {
  kind: FollowupKind;
  message: string;
  /** false = deliver message once without requesting another agent turn. */
  loop: boolean;
  meta?: Record<string, string | number | boolean>;
}

export interface StopHandlerInput {
  conversationId: string;
  status: "completed" | "error" | "aborted";
  loopCount: number;
  /** Cursor transcript path — enables pending redelivery / in-flight gating. */
  transcriptPath?: string;
}

export interface ReviewEngineConfig {
  confirmRounds: number;
  /** When completed-stop fix→confirm may run. Default executing_only. */
  reviewScope: ReviewScope;
  verifyEnabled: boolean;
  verifyCommands: VerifyCommandConfig[];
  maxIdleStops: number;
  /** 0 = never pause on turn errors. */
  maxErrorsBeforePause: number;
  projectRoot: string;
  /** Optional override for verify report path (tests). */
  verifyReportPath?: string;
  /** Render followup message; default English templates. */
  renderFollowup?: (kind: FollowupKind, vars: Record<string, string | number>) => string;
  /** Resolve confirm lens; default English CONFIRM_LENSES. */
  resolveLens?: (roundIndex: number, confirmRounds: number) => ConfirmLens;
}

function defaultRender(kind: FollowupKind, vars: Record<string, string | number>): string {
  switch (kind) {
    case "review.fix":
      return (
        `Review fix round ${vars.round} (no hard cap; confirm needs ${vars.total} consecutive no-edit rounds). ` +
        `Code changed this turn. Defect-first self-review and fix now: ` +
        `1) inspect full diff via git diff / git status; ` +
        `2) check correctness, null/boundaries, concurrency, security, regression, missing tests; ` +
        `3) CRITICAL/HIGH must fix, MEDIUM preferably; ` +
        `4) run relevant tests; ` +
        `5) briefly state what you reviewed and changed (or "self-review clean"). ` +
        `Do not commit/push. If no further code changes, next stop enters multi-lens confirm.`
      );
    case "review.confirm":
      return (
        `Review confirm ${vars.n}/${vars.total} (session round ${vars.sessionRound}; consecutive no-edit confirms, counted on the fix-round counter). ` +
        `Lens 【${vars.lensTitle}】 (multi-lens confirm, not the same checklist again). ${vars.lensFocus} ` +
        `Previous turn had no further code edits. Recheck under this lens only: ` +
        `1) git diff / git status — no new edits vs prior turn (or only already-reviewed edits); ` +
        `2) dig into this lens only; ban vague "fully rechecked, all good"; ` +
        `3) CRITICAL/HIGH under this lens must fix; MEDIUM preferably; ` +
        `4) if you edit, fix and run related tests; ` +
        `5) close with: "Lens (${vars.lensTitle}): self-review clean" or a short list of fixes; if clean, do not edit further. ` +
        `Do not commit/push.`
      );
    case "review.confirm_final":
      return (
        `Review confirm ${vars.n}/${vars.total} (session round ${vars.sessionRound}; consecutive no-edit confirms, counted on the fix-round counter). ` +
        `Lens 【${vars.lensTitle}】 (multi-lens confirm, not the same checklist again). ${vars.lensFocus} ` +
        `Previous turn had no further code edits. Recheck under this lens only: ` +
        `1) git diff / git status — no new edits vs prior turn (or only already-reviewed edits); ` +
        `2) dig into this lens only; ban vague "fully rechecked, all good"; ` +
        `3) read-only: record CRITICAL/HIGH/missing tests — do not change code, add tests, or commit; if you already edited, accept returning to a fix round; never commit this turn; ` +
        `4) do not run commands that mutate the repo; ` +
        `5) close with: "Lens (${vars.lensTitle}): self-review clean" or list issues (no fixes); if clean, do not edit further. ` +
        `Do not commit/push. Handoff (commit) and next checklist item are handled by Advance/Done after the chain — not this turn.`
      );
    case "advance":
      return (
        `Advance checklist: confirm chain passed cleanly (confirm rounds do not commit). ` +
        `First mark the current item [x] in checklist.md. Then, if the working tree still has uncommitted changes for this item ` +
        `(including checklist.md when plans/ is committed), local conventional commit only: ` +
        `git status/diff → stage only this checklist item's paths; never git add -A, never stage .env/secrets/.autopilot runtime; ` +
        `one conventional commit; no push/--no-verify/amend/force unless the user explicitly asks. ` +
        `If already clean after marking, skip commit. Then implement next: ${vars.nextId ?? ""} — ${vars.nextTitle ?? ""}.`
      );
    case "done":
      return (
        `All checklist items done. Confirm chain passed (confirm rounds do not commit). ` +
        `Mark the last item [x]. If the working tree still has uncommitted changes for this item ` +
        `(including checklist.md when plans/ is committed), local conventional commit only ` +
        `(never stage .env/secrets/.autopilot runtime; no push unless the user asks); if clean, just confirm briefly. Phase is done.`
      );
    case "recover":
      return `Recover: the previous turn ended with an error. Continue the current checklist item without advancing.`;
    case "recover_planning":
      return `Recover: the previous turn ended with an error. Continue planning; do not RUN or write product code.`;
    case "recover_ambient":
      return `Recover: the previous turn ended with an error. Continue your current work; Autopilot RUN is not active.`;
    case "review_complete":
      return (
        `Review complete. All ${vars.total ?? 5} confirm rounds passed; the review chain has ended. ` +
        `If the working tree still has uncommitted changes from this session, ` +
        `local commit only per the safe checklist (never stage .env/secrets/.autopilot runtime; ` +
        `no push unless the user asks); if clean, briefly confirm only.`
      );
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

  private lens(roundIndex: number): ConfirmLens {
    const rounds = this.config.confirmRounds;
    return (this.config.resolveLens ?? getLens)(roundIndex, rounds);
  }

  /**
   * FS trust root: StateStore is authoritative.
   * config.projectRoot must not widen the boundary (mismatched/evil config).
   */
  private trustedProjectRoot(): string | null {
    return (
      normalizeProjectRoot(this.store.projectRoot) ??
      normalizeProjectRoot(this.config.projectRoot)
    );
  }

  /**
   * Parse session checklist only when realpath stays under the project root.
   * O_NOFOLLOW alone cannot stop intermediate directory symlink escapes or a
   * poisoned absolute checklist_path in the session row.
   */
  private parseSessionChecklist(session: SessionRow): {
    unchecked: number;
    currentItem: ChecklistItem | null;
    /** Following unchecked item (after current); used by advance followup text. */
    followingItem: ChecklistItem | null;
  } | null {
    const checklistPath = session.checklist_path;
    if (!checklistPath) return null;
    // Trust store root only — never let config or session.project_root
    // redefine the containment boundary.
    const root = this.trustedProjectRoot();
    if (!root || !isRealpathInsideProject(root, checklistPath)) {
      return null;
    }
    try {
      const cl = parseChecklist(checklistPath, { projectRoot: root });
      return {
        unchecked: countUnchecked(cl),
        currentItem: firstUnchecked(cl),
        followingItem: secondUnchecked(cl),
      };
    } catch {
      return null;
    }
  }

  /** E1: afterFileEdit product code → code_edited=1 */
  onCodeEdited(conversationId: string): void {
    this.store.markCodeEdited(conversationId);
  }

  handleStop(input: StopHandlerInput): FollowupAction | null {
    // Corrupt/legacy ids must not reach error-stop upserts (or ensure).
    if (!this.store.isConversationIdOk(input.conversationId)) {
      return null;
    }
    try {
      let session = this.store.getSession(input.conversationId);
      // User Stop / host abort must not bootstrap ambient sessions or recover.
      // Only genuine `error` turns may ensure + inject recover.
      if (
        !session &&
        input.status === "error" &&
        this.config.reviewScope === "project"
      ) {
        ensureAmbientReviewSession(
          this.store,
          input.conversationId,
          this.config.projectRoot,
          this.config.reviewScope,
        );
        session = this.store.getSession(input.conversationId);
      }
      if (!session) return null;

      if (input.status === "aborted") {
        return this.handleAbortedStop(session);
      }
      if (input.status === "error") {
        return this.handleErrorStop(session, input);
      }

      // Precondition: review chain may run (executing_only → RUN; project → ambient/planning/executing)
      if (!sessionReviewRunnable(session, this.config.reviewScope)) {
        return null;
      }

      const chain = this.store.ensureReviewChain(input.conversationId);
      this.maybeResetErrorCountOnItemChange(session);

      const transcriptPath = input.transcriptPath?.trim() || undefined;
      const events = transcriptPath ? readTranscriptTail(transcriptPath) : [];

      // Code-edit fix wins over pending redelivery (marker-before-pending).
      if (chain.code_edited === 1) {
        return this.e2Fix(session, chain);
      }

      // Pending redelivery / in-flight: never advance confirm_left while prior undelivered.
      const redelivered = this.tryRedeliverPending(
        session.conversation_id,
        chain,
        events,
        transcriptPath,
      );
      if (redelivered) return redelivered;

      if (events.length > 0 && followupInFlight(events)) {
        return null;
      }
      if (
        this.pendingBlocksAdvance(
          session.conversation_id,
          chain,
          events,
          transcriptPath,
        )
      ) {
        return null;
      }

      // Order: E4 → E5 → E3 → E0 (E2 handled above)
      if (chain.confirm_left !== null && chain.confirm_left > 0) {
        return this.e4Confirm(session, chain);
      }
      if (
        chain.confirm_left === 0 ||
        (chain.item_confirm_complete === 1 && chain.confirm_left === null)
      ) {
        return this.e5Gate(session, chain);
      }
      // loopCount alone must not re-arm after a hard halt neutralize (fix_round
      // cleared). Keep E8 recovery for checklist executing only: after
      // clearChainPending mid-fix, fix_round>0 + loopCount still reaches E3.
      // Do NOT use that path for ambient/planning — leftover fix_round after an
      // error recover (armChain=false) would otherwise open a phantom confirm
      // chain with no new code_edited (seen with project-scope ambient).
      const inChain =
        chain.chain_pending === 1 ||
        (input.loopCount > 0 &&
          chain.fix_round > 0 &&
          isChecklistExecuting(session));
      if (
        chain.confirm_left === null &&
        chain.item_confirm_complete === 0 &&
        inChain
      ) {
        return this.e3ArmConfirm(session, chain);
      }
      // E0': no product-code edit — checklist continue via verify / soft evidence.
      return this.e0NoCodeContinue(session, chain);
    } catch (err) {
      // Purge races / late id throws from upsert|updateReviewChain must not crash the hook.
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("No session for conversation") ||
        msg.includes("Invalid conversation id")
      ) {
        return null;
      }
      throw err;
    }
  }

  private pendingBlocksAdvance(
    conversationId: string,
    chain: ReviewChainRow,
    events: ReturnType<typeof readTranscriptTail>,
    transcriptPath: string | undefined,
  ): boolean {
    const pending = chain.pending_followup?.trim();
    if (!pending) return false;
    if (events.length > 0 && automationFollowupPresent(events, pending)) {
      try {
        this.store.clearPendingFollowup(conversationId);
      } catch {
        /* already delivered — clearing stamp is best-effort */
      }
      return false;
    }
    // No transcript_path → unit tests / older ports: fail-open.
    if (!transcriptPath) return false;
    // Path provided: undelivered pending always blocks (even if transcript empty).
    return true;
  }

  private tryRedeliverPending(
    conversationId: string,
    chain: ReviewChainRow,
    events: ReturnType<typeof readTranscriptTail>,
    transcriptPath: string | undefined,
  ): FollowupAction | null {
    const pending = chain.pending_followup?.trim();
    if (!pending) return null;
    // Without transcript_path, skip redelivery (avoid duplicate spam in unit tests).
    if (!transcriptPath) return null;
    if (events.length > 0 && automationFollowupPresent(events, pending)) {
      try {
        this.store.clearPendingFollowup(conversationId);
      } catch {
        /* already delivered — clearing stamp is best-effort */
      }
      return null;
    }
    if (events.length > 0 && followupInFlight(events)) {
      return null;
    }
    if (!pendingRedeliverAllowed(chain.pending_redeliver_at)) {
      return null;
    }
    // Concurrent error-halt may have paused after the outer armed check.
    if (!this.sessionRunnable(conversationId)) {
      return null;
    }
    try {
      this.store.touchPendingRedeliver(conversationId);
    } catch {
      // Still attempt redeliver — cooldown stamp is best-effort.
    }
    // Re-check after touch: halt may have won, or pending was cleared (touch
    // no-ops without pending) — never redeliver a stale in-memory message.
    if (!this.sessionRunnable(conversationId)) {
      return null;
    }
    const live = this.store.getReviewChain(conversationId)?.pending_followup?.trim();
    if (!live) {
      return null;
    }
    return {
      kind: this.inferPendingKind(live),
      message: live,
      loop: true,
      meta: { redeliver: true },
    };
  }

  private inferPendingKind(message: string): FollowupKind {
    const m = message.trim();
    if (this.isFixFollowupMessage(m)) return "review.fix";
    if (
      (m.startsWith("Review confirm") || m.startsWith("自审确认")) &&
      (m.includes(`/${this.config.confirmRounds}`) || m.includes("终审") || m.includes("Read-only") || m.includes("只读"))
    ) {
      // Prefer final when n===total appears as N/N and N is last — heuristic via confirmRounds.
      const finalRe = new RegExp(
        `(?:Review confirm|自审确认)\\s*${this.config.confirmRounds}/${this.config.confirmRounds}`,
      );
      if (finalRe.test(m) || m.includes("read-only") || m.includes("Read-only") || m.includes("只读终审") || m.includes("本轮只读")) {
        return "review.confirm_final";
      }
    }
    if (m.startsWith("Review confirm") || m.startsWith("自审确认")) return "review.confirm";
    if (m.startsWith("Advance") || m.startsWith("推进")) return "advance";
    if (m.startsWith("Review complete") || m.startsWith("自审完成")) return "review_complete";
    if (m.startsWith("All checklist") || m.startsWith("全部完成")) return "done";
    if (m.startsWith("Recover") || m.startsWith("恢复")) return "recover";
    if (m.startsWith("Stuck") || m.startsWith("卡住")) return "stuck";
    if (m.startsWith("Verify failed") || m.startsWith("校验失败")) return "verify_fix";
    return "review.confirm";
  }

  private emit(
    conversationId: string,
    action: FollowupAction,
  ): FollowupAction {
    try {
      const armChain =
        action.kind !== "recover" &&
        action.kind !== "recover_planning" &&
        action.kind !== "recover_ambient";
      this.store.savePendingFollowup(conversationId, action.message, { armChain });
    } catch {
      // Hook can still deliver once; pending redelivery is best-effort.
    }
    return action;
  }

  /**
   * Cursor Stop button (and similar host interrupts) arrive as status=aborted.
   * Do not inject recover — that fights the user and loops with loop_limit:null.
   * Drop recover/stuck pending so transcript revert cannot redeliver them later.
   * Leave fix/confirm pending alone (delivery retry still valid if inject raced).
   */
  private handleAbortedStop(session: SessionRow): FollowupAction | null {
    try {
      this.store.clearPendingFollowupIf(
        session.conversation_id,
        isRecoverOrStuckFollowupMessage,
      );
    } catch {
      /* best-effort */
    }
    return null;
  }

  private handleErrorStop(session: SessionRow, input: StopHandlerInput): FollowupAction | null {
    const nextCount = session.error_count + 1;
    const maxErrors = this.config.maxErrorsBeforePause;
    // maxErrors <= 0 → unlimited: never pause for repeated_errors
    const shouldPause = maxErrors > 0 && nextCount >= maxErrors;
    try {
      if (shouldPause) {
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
    } catch {
      // Count/pause bookkeeping is best-effort.
      if (shouldPause) {
        // Pause row write failed but threshold was hit — do not silently keep
        // looping armed; surface stuck so the hook can halt the agent.
        if (
          session.armed === 1 &&
          session.phase === "executing" &&
          session.paused === 0
        ) {
          // One-shot halt text — do NOT savePendingFollowup (emit): a later
          // redeliver path always uses loop:true and would spin while still armed.
          // Prefer one IMMEDIATE txn for pause+neutralize+disarm (no partial dirty
          // state). Do NOT catch per-step inside the txn — a failed statement
          // poisons SQLite's open transaction. On any failure, ROLLBACK then
          // fall back to independent best-effort writes.
          try {
            this.store.exclusiveWrite(() => {
              this.store.pauseSessionForRepeatedErrors(
                session.conversation_id,
                nextCount,
                input.status,
              );
              this.store.neutralizeReviewChain(session.conversation_id);
              this.store.disarmSession(session.conversation_id);
              return { commit: true, value: undefined };
            });
          } catch {
            try {
              this.store.pauseSessionForRepeatedErrors(
                session.conversation_id,
                nextCount,
                input.status,
              );
            } catch {
              /* best-effort */
            }
            try {
              this.store.neutralizeReviewChain(session.conversation_id);
            } catch {
              /* best-effort */
            }
            try {
              this.store.disarmSession(session.conversation_id);
            } catch {
              /* best-effort */
            }
          }
          return {
            kind: "stuck",
            message: this.render("stuck", {}),
            loop: false,
          };
        }
        return null;
      }
    }
    // Re-read: concurrent halt may have paused after our snapshot was taken.
    const fresh = this.store.getSession(session.conversation_id);
    if (fresh && this.sessionErrorRecoverable(fresh)) {
      const recoverKind = this.recoverKindForPhase(fresh.phase);
      const message = this.render(recoverKind, {});
      const action: FollowupAction = {
        kind: "recover",
        message,
        loop: true,
      };
      // Ambient/planning: soft-reset + recover pending in ONE txn so a
      // concurrent completed stop cannot re-arm chain_pending after soft-reset
      // and before emit (armChain=false would keep it → phantom E3).
      // Mid-fix → code_edited; ready-for-E3 → confirm_left=rounds (forward);
      // mid-confirm/E5 preserved. Checklist executing: leave chain alone.
      if (!isChecklistExecuting(fresh)) {
        const cid = fresh.conversation_id;
        if (this.tryCommitAmbientErrorRecover(cid, message)) {
          return action;
        }
        // First attempt failed — one retry for transient SQLITE_BUSY / lock.
        if (this.tryCommitAmbientErrorRecover(cid, message)) {
          return action;
        }
        // Hard failure: prefer neutralize (no phantom). If neutralize fails,
        // last-resort soft-reset may still arm mid-fix resume, then disarm.
        let neutralized = false;
        try {
          this.store.neutralizeReviewChain(cid);
          neutralized = true;
        } catch {
          /* continue compensation */
        }
        if (!neutralized) {
          if (this.tryCommitAmbientErrorRecover(cid, message)) {
            return action;
          }
          try {
            this.applySoftResetAmbientChainForErrorRecover(cid);
          } catch {
            /* ignore */
          }
          try {
            this.store.updateReviewChain(cid, { chain_pending: 0 });
          } catch {
            /* fall through to emit */
          }
        }
      }
      return this.emit(session.conversation_id, action);
    }
    return null;
  }

  /**
   * Ambient error recover write: soft-reset + recover pending under one
   * exclusiveWrite. Returns false if the txn throws (caller may retry / fall back).
   */
  private tryCommitAmbientErrorRecover(
    conversationId: string,
    message: string,
  ): boolean {
    try {
      this.store.exclusiveWrite(() => {
        this.applySoftResetAmbientChainForErrorRecover(conversationId);
        this.store.savePendingFollowup(conversationId, message, {
          armChain: false,
        });
        return { commit: true, value: null };
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ambient/planning error recover: drop confirm/pending arming so recover
   * (armChain=false) cannot leave chain_pending=1 → phantom E3.
   *
   * Prefer calling under exclusiveWrite (with savePendingFollowup). May run
   * unlocked only as last-resort compensation after txn failures.
   *
   * Preserve mid-confirm / E5-ready counters so the completed stop after
   * recover continues E4/E5. Ready-for-E3 (fix done, chain_pending only)
   * advances into confirm via confirm_left=confirmRounds (E4 emits 1/N) —
   * do not regress to another fix. Ready-for-E3 requires empty pending (not
   * merely !fixPending). Force code_edited only for an active fix
   * (code_edited / undelivered fix pending / chain_pending with pending still
   * set). Bare leftover fix_round is ignored (ambient phantom residue).
   */
  private applySoftResetAmbientChainForErrorRecover(
    conversationId: string,
  ): void {
    this.store.ensureReviewChain(conversationId);
    const chain = this.store.getReviewChain(conversationId);
    if (!chain) return;
    const atE5 =
      chain.confirm_left === 0 ||
      (chain.item_confirm_complete === 1 && chain.confirm_left === null);
    const midConfirm =
      chain.confirm_left !== null && chain.confirm_left > 0;
    const pending = chain.pending_followup?.trim() ?? "";
    const fixPending = this.isFixFollowupMessage(pending);
    // Ready-for-E3 only when there is no undelivered followup left. Using
    // !fixPending alone is too wide: a non-prefix/custom pending would look
    // "ready" and skip an in-flight fix into confirm.
    const readyForE3 =
      !atE5 &&
      !midConfirm &&
      chain.chain_pending === 1 &&
      chain.code_edited === 0 &&
      pending.length === 0;
    const resumeFix =
      !atE5 &&
      !midConfirm &&
      !readyForE3 &&
      (chain.chain_pending === 1 ||
        chain.code_edited === 1 ||
        fixPending);
    const rounds = this.config.confirmRounds;
    this.store.updateReviewChain(conversationId, {
      confirm_left: atE5 || midConfirm
        ? chain.confirm_left
        : readyForE3 && rounds > 0
          ? rounds
          : null,
      item_confirm_complete: atE5 ? chain.item_confirm_complete : 0,
      chain_pending: 0,
      // Preserve an in-flight edit marker (E2 wins over E4); else force only for mid-fix.
      code_edited: resumeFix || chain.code_edited === 1 ? 1 : 0,
      // keep fix_round — next E2/E4 bumps the session round
      pending_followup: null,
      pending_followup_at: null,
      pending_redeliver_at: null,
    });
  }

  /** Shared with inferPendingKind — locale templates must keep these prefixes. */
  private isFixFollowupMessage(message: string): boolean {
    const m = message.trim();
    return m.startsWith("Review fix") || m.startsWith("自审修复");
  }

  /** True when a stop may still advance the review chain (re-check under write lock). */
  private sessionRunnable(conversationId: string): boolean {
    const s = this.store.getSession(conversationId);
    return !!s && sessionReviewRunnable(s, this.config.reviewScope);
  }

  /** Genuine error stop may inject recover (planning, project ambient, or armed executing). */
  private sessionErrorRecoverable(session: SessionRow): boolean {
    if (session.paused !== 0) return false;
    if (session.phase === "planning") return true;
    if (
      session.phase === "idle" &&
      session.armed === 1 &&
      this.config.reviewScope === "project"
    ) {
      return true;
    }
    return session.phase === "executing" && session.armed === 1;
  }

  private recoverKindForPhase(phase: Phase): FollowupKind {
    if (phase === "planning") return "recover_planning";
    if (phase === "idle") return "recover_ambient";
    return "recover";
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

  private maybeResetErrorCountOnItemChange(_session: SessionRow): void {
    // error_count reset on item id change is handled by callers tracking last item;
    // E5b always zeroes error_count on advance. Do not existsSync untrusted
    // checklist_path here (symlink / outside probe).
  }

  /**
   * E0': checklist executing, not in fix/confirm — skip lenses when there is no
   * product code edit. Soft/verified success advances in one IMMEDIATE txn with
   * evidence re-check (never arm at-E5 first). Only required-verify *fail*
   * arms at-E5 to reuse E5c verify_fix / stuck.
   */
  private e0NoCodeContinue(
    session: SessionRow,
    chain: ReviewChainRow,
  ): FollowupAction | null {
    if (!isChecklistExecuting(session)) return null;
    if (
      chain.code_edited === 1 ||
      chain.confirm_left !== null ||
      chain.item_confirm_complete === 1 ||
      chain.chain_pending === 1
    ) {
      return null;
    }

    const parsed = this.parseSessionChecklist(session);
    if (!parsed?.currentItem) return null;

    const trustRoot = this.trustedProjectRoot();
    const reportPath =
      this.config.verifyReportPath ??
      defaultVerifyReportPath(trustRoot ?? "");
    const checklistPath = session.checklist_path || "";
    const evalResult = evaluateVerifyReport({
      enabled: this.config.verifyEnabled,
      commands: this.config.verifyCommands,
      reportPath,
      currentItem: parsed.currentItem,
      checklistPath,
      projectRoot: trustRoot ?? undefined,
    });

    if (evalResult.outcome === "skip") {
      // Soft evidence + advance/done in one write — never arm E5 first.
      return this.e0DirectAdvance(session, reportPath, parsed.currentItem.id, {
        kind: "soft",
      });
    }

    if (evalResult.outcome === "pass") {
      // Required verify already passed — advance in one write. Do NOT arm at-E5
      // first: a crash between arm and e5Gate would leave stranded at-E5, and a
      // later skip-configured stop could advance without soft evidence.
      return this.e0DirectAdvance(session, reportPath, parsed.currentItem.id, {
        kind: "verified",
        checklistPath,
      });
    }

    // fail (required verify armed): arm at-E5 and reuse E5c verify_fix / stuck.
    if (!this.armAtE5ForNoCode(session.conversation_id)) return null;
    const fresh = this.store.getReviewChain(session.conversation_id);
    const sess = this.store.getSession(session.conversation_id);
    if (!fresh || !sess) {
      this.disarmE5NoCode(session.conversation_id);
      return null;
    }
    const action = this.e5Gate(sess, fresh);
    if (!action) {
      // Do not leave a stranded at-E5 state that would skip soft evidence next stop.
      this.disarmE5NoCode(session.conversation_id);
      return null;
    }
    // E5b advance sets chain_pending=1; clear for consecutive E0 (fail→fixed→pass).
    if (action.kind === "advance") {
      const cid = session.conversation_id;
      try {
        this.store.exclusiveWrite(() => {
          const live = this.store.getReviewChain(cid);
          if (
            !live ||
            live.chain_pending !== 1 ||
            live.code_edited === 1 ||
            live.confirm_left !== null ||
            live.item_confirm_complete !== 0
          ) {
            return { commit: false, value: undefined };
          }
          this.store.updateReviewChain(cid, { chain_pending: 0 });
          return { commit: true, value: undefined };
        });
      } catch {
        /* best-effort */
      }
    }
    return action;
  }

  /**
   * E0 direct advance/done: re-check soft or verified evidence under one
   * IMMEDIATE write — never enters the confirm/E5 state machine.
   */
  private e0DirectAdvance(
    session: SessionRow,
    reportPath: string,
    expectedItemId: string,
    evidence:
      | { kind: "soft" }
      | { kind: "verified"; checklistPath: string },
  ): FollowupAction | null {
    const cid = session.conversation_id;
    const trustRoot = this.trustedProjectRoot();
    const action = this.store.exclusiveWrite(() => {
      if (!this.sessionRunnable(cid)) {
        return { commit: false, value: null };
      }
      const lockedSession = this.store.getSession(cid);
      if (!lockedSession || !isChecklistExecuting(lockedSession)) {
        return { commit: false, value: null };
      }
      const fresh = this.store.getReviewChain(cid);
      if (
        !fresh ||
        fresh.code_edited === 1 ||
        fresh.confirm_left !== null ||
        fresh.item_confirm_complete === 1 ||
        fresh.chain_pending === 1
      ) {
        return { commit: false, value: null };
      }

      const refreshed = this.parseSessionChecklist(lockedSession);
      if (!refreshed?.currentItem || refreshed.currentItem.id !== expectedItemId) {
        return { commit: false, value: null };
      }
      if (evidence.kind === "soft") {
        if (
          !hasNoCodeCompletionEvidence({
            reportPath,
            currentItemId: refreshed.currentItem.id,
            projectRoot: trustRoot ?? undefined,
          })
        ) {
          return { commit: false, value: null };
        }
      } else {
        // Prefer checklist path from the locked session row (not the pre-lock snapshot).
        const lockedChecklistPath =
          lockedSession.checklist_path?.trim() || evidence.checklistPath;
        const lockedEval = evaluateVerifyReport({
          enabled: this.config.verifyEnabled,
          commands: this.config.verifyCommands,
          reportPath,
          currentItem: refreshed.currentItem,
          checklistPath: lockedChecklistPath,
          projectRoot: trustRoot ?? undefined,
        });
        if (lockedEval.outcome !== "pass") {
          return { commit: false, value: null };
        }
      }

      const unchecked = refreshed.unchecked;
      const following = refreshed.followingItem;
      if (unchecked <= 0) {
        return { commit: false, value: null };
      }
      const isAdvance = unchecked > 1;
      if (isAdvance && !following) {
        return { commit: false, value: null };
      }

      const message = isAdvance
        ? this.render("advance", {
            nextId: following?.id ?? "",
            nextTitle: following?.title ?? "",
          })
        : this.render("done", {});
      const out: FollowupAction = {
        kind: isAdvance ? "advance" : "done",
        message,
        loop: true,
      };
      const chainReset = {
        confirm_left: null as null,
        fix_round: 0,
        code_edited: 0,
        item_confirm_complete: 0,
      };

      if (isAdvance) {
        this.store.upsertSession({
          conversation_id: cid,
          project_root: lockedSession.project_root,
          code_root: lockedSession.code_root,
          error_count: 0,
          idle_stop_count: 0,
          last_error: null,
        });
        // chain_pending stays 0 — unlike E5b after confirm. Soft/verified E0
        // advance has no product diff to confirm; leaving pending=1 would force
        // E3 on the next no-code item and skip E0 soft evidence.
        this.store.updateReviewChain(cid, {
          ...chainReset,
          pending_followup: message,
          pending_followup_at: new Date().toISOString(),
          pending_redeliver_at: null,
          chain_pending: 0,
        });
      } else {
        this.store.upsertSession({
          conversation_id: cid,
          project_root: lockedSession.project_root,
          code_root: lockedSession.code_root,
          phase: "done" as Phase,
          armed: 0,
          error_count: 0,
          idle_stop_count: 0,
          last_error: null,
        });
        this.store.updateReviewChain(cid, {
          ...chainReset,
          pending_followup: message,
          pending_followup_at: new Date().toISOString(),
          pending_redeliver_at: null,
          chain_pending: 0,
        });
      }
      return { commit: true, value: out };
    });
    if (action) {
      this.afterFollowupCommitted(session, {});
    }
    return action;
  }

  /** Arm confirm_left=0 + ICC=1 only when still idle on the no-code path. */
  private armAtE5ForNoCode(conversationId: string): boolean {
    return (
      this.store.exclusiveWrite(() => {
        if (!this.sessionRunnable(conversationId)) {
          return { commit: false, value: false };
        }
        const sess = this.store.getSession(conversationId);
        if (!sess || !isChecklistExecuting(sess)) {
          return { commit: false, value: false };
        }
        const fresh = this.store.getReviewChain(conversationId);
        if (
          !fresh ||
          fresh.code_edited === 1 ||
          fresh.confirm_left !== null ||
          fresh.item_confirm_complete === 1 ||
          fresh.chain_pending === 1
        ) {
          return { commit: false, value: false };
        }
        this.store.updateReviewChain(conversationId, {
          confirm_left: 0,
          item_confirm_complete: 1,
          chain_pending: 0,
        });
        return { commit: true, value: true };
      }) === true
    );
  }

  /** Undo a failed arm so the next stop cannot skip soft evidence via E5. */
  private disarmE5NoCode(conversationId: string): void {
    try {
      this.store.exclusiveWrite(() => {
        const fresh = this.store.getReviewChain(conversationId);
        if (
          !fresh ||
          fresh.code_edited === 1 ||
          fresh.confirm_left !== 0 ||
          fresh.item_confirm_complete !== 1
        ) {
          return { commit: false, value: undefined };
        }
        // Only clear a pristine post-arm state (no pending followup yet).
        if (fresh.pending_followup?.trim()) {
          return { commit: false, value: undefined };
        }
        this.store.updateReviewChain(conversationId, {
          confirm_left: null,
          item_confirm_complete: 0,
          chain_pending: 0,
        });
        return { commit: true, value: undefined };
      });
    } catch {
      /* best-effort */
    }
  }

  /** Session-monotonic round counter (fix + confirm share fix_round; no hard cap). */
  private nextSessionRound(chain: ReviewChainRow): number {
    return chain.fix_round + 1;
  }

  private e2Fix(session: SessionRow, _chain: ReviewChainRow): FollowupAction | null {
    const rounds = this.config.confirmRounds;
    const cid = session.conversation_id;
    // Chain counters + pending in one IMMEDIATE txn — crash must not leave
    // "code_edited cleared / round bumped" without the fix message to redeliver.
    const action = this.store.exclusiveWrite(() => {
      // Concurrent error-halt may have paused/disarmed after the outer check.
      if (!this.sessionRunnable(cid)) {
        return { commit: false, value: null };
      }
      const fresh = this.store.getReviewChain(cid);
      if (!fresh || fresh.code_edited !== 1) {
        return { commit: false, value: null };
      }
      const fixRound = this.nextSessionRound(fresh);
      const message = this.render("review.fix", { round: fixRound, total: rounds });
      const out: FollowupAction = {
        kind: "review.fix",
        message,
        loop: true,
        meta: { fixRound },
      };
      this.store.updateReviewChain(cid, {
        fix_round: fixRound,
        code_edited: 0,
        confirm_left: null,
        chain_pending: 1,
        // item_confirm_complete preserved (E2 path)
        pending_followup: message,
        pending_followup_at: new Date().toISOString(),
        pending_redeliver_at: null,
      });
      return { commit: true, value: out };
    });
    if (action) {
      this.afterFollowupCommitted(session, {});
    }
    return action;
  }

  private e3ArmConfirm(session: SessionRow, _chain: ReviewChainRow): FollowupAction | null {
    const rounds = this.config.confirmRounds;
    const lens = this.lens(1);
    const left = rounds - 1; // inject 1st then set left = rounds-1
    const kind: FollowupKind = rounds === 1 ? "review.confirm_final" : "review.confirm";
    const cid = session.conversation_id;
    const action = this.store.exclusiveWrite(() => {
      if (!this.sessionRunnable(cid)) {
        return { commit: false, value: null };
      }
      const fresh = this.store.getReviewChain(cid);
      // Lost the race to another stop (already confirming, at E5, or code edit).
      if (
        !fresh ||
        fresh.code_edited === 1 ||
        fresh.confirm_left !== null ||
        fresh.item_confirm_complete === 1
      ) {
        return { commit: false, value: null };
      }
      const sessionRound = this.nextSessionRound(fresh);
      const message = this.render(kind, {
        n: 1,
        total: rounds,
        sessionRound,
        lensTitle: lens.title,
        lensFocus: lens.focus,
      });
      const out: FollowupAction = {
        kind,
        message,
        loop: true,
        meta: { n: 1, total: rounds, sessionRound },
      };
      this.store.updateReviewChain(cid, {
        confirm_left: left,
        chain_pending: 1,
        fix_round: sessionRound,
        pending_followup: message,
        pending_followup_at: new Date().toISOString(),
        pending_redeliver_at: null,
      });
      return { commit: true, value: out };
    });
    if (action) {
      this.afterFollowupCommitted(session, { confirm_left: left });
    }
    return action;
  }

  private e4Confirm(session: SessionRow, chain: ReviewChainRow): FollowupAction | null {
    const rounds = this.config.confirmRounds;
    const expectedLeft = chain.confirm_left;
    if (expectedLeft === null || expectedLeft <= 0) return null;
    // lensIndex = rounds - left + 1 (before decrement)
    const n = rounds - expectedLeft + 1;
    const lens = this.lens(n);
    const newLeft = expectedLeft - 1;
    const isFinal = n === rounds;
    const kind: FollowupKind = isFinal ? "review.confirm_final" : "review.confirm";
    const cid = session.conversation_id;
    // MUST return from handleStop after this — never continue to E5 same stop.
    // Atomic confirm_left decrement + pending avoids skip-a-lens on crash/concurrent stop.
    const action = this.store.exclusiveWrite(() => {
      if (!this.sessionRunnable(cid)) {
        return { commit: false, value: null };
      }
      const fresh = this.store.getReviewChain(cid);
      if (!fresh || fresh.code_edited === 1 || fresh.confirm_left !== expectedLeft) {
        return { commit: false, value: null };
      }
      const sessionRound = this.nextSessionRound(fresh);
      const message = this.render(kind, {
        n,
        total: rounds,
        sessionRound,
        lensTitle: lens.title,
        lensFocus: lens.focus,
      });
      const out: FollowupAction = {
        kind,
        message,
        loop: true,
        meta: { n, total: rounds, confirm_left: newLeft, sessionRound },
      };
      this.store.updateReviewChain(cid, {
        confirm_left: newLeft,
        chain_pending: 1,
        fix_round: sessionRound,
        pending_followup: message,
        pending_followup_at: new Date().toISOString(),
        pending_redeliver_at: null,
      });
      return { commit: true, value: out };
    });
    if (action) {
      this.afterFollowupCommitted(session, { confirm_left: newLeft });
    }
    return action;
  }

  private e5Gate(session: SessionRow, _chain: ReviewChainRow): FollowupAction | null {
    // Project-scope ambient/planning: never verify/advance checklist — end with review_complete.
    // Otherwise a leftover checklist_path (e.g. after ON) + verify fail / unreadable path
    // would return null and stall the chain forever.
    if (
      this.config.reviewScope === "project" &&
      !isChecklistExecuting(session)
    ) {
      return this.e5bAdvance(session, {
        unchecked: 0,
        next: null,
        verifiedPass: false,
      });
    }

    // E5c first
    const checklistPath = session.checklist_path;
    let currentItem: ChecklistItem | null = null;
    // Single checklist read for verify + advance/done — avoids TOCTOU between
    // e5Gate and e5bAdvance, and keeps FS I/O outside the write lock.
    let unchecked = 0;
    if (checklistPath) {
      const parsed = this.parseSessionChecklist(session);
      if (!parsed) {
        // Unreadable / missing / unsafe checklist — do not advance/done or verify-fail spuriously.
        return null;
      }
      unchecked = parsed.unchecked;
      currentItem = parsed.currentItem;
    }

    // No open item (empty path, empty file, or all checked): skip verify.
    // Otherwise verifyEnabled + required cmds treat currentItem=null as fail and
    // loop verify_fix forever instead of emitting done.
    if (unchecked === 0) {
      return this.e5bAdvance(session, {
        unchecked: 0,
        next: null,
        verifiedPass: false,
      });
    }
    // Defensive: countUnchecked>0 must yield a firstUnchecked item.
    if (!currentItem) {
      return null;
    }

    const trustRoot = this.trustedProjectRoot();
    const reportPath =
      this.config.verifyReportPath ??
      defaultVerifyReportPath(trustRoot ?? "");
    const evalResult = evaluateVerifyReport({
      enabled: this.config.verifyEnabled,
      commands: this.config.verifyCommands,
      reportPath,
      currentItem,
      checklistPath: checklistPath || "",
      projectRoot: trustRoot ?? undefined,
    });

    if (evalResult.outcome === "fail") {
      // E5c: ICC + confirm_left + pending (+ idle/stuck) in one IMMEDIATE txn so a
      // crash cannot leave "at E5 with ICC" and no redeliverable verify_fix/stuck.
      const reason = evalResult.reason ?? "fail";
      const cid = session.conversation_id;
      return this.store.exclusiveWrite(() => {
        const fresh = this.store.getReviewChain(cid);
        const atE5 =
          !!fresh &&
          (fresh.confirm_left === 0 ||
            (fresh.item_confirm_complete === 1 && fresh.confirm_left === null));
        if (!atE5) {
          return { commit: false, value: null };
        }
        const sess = this.store.getSession(cid);
        if (
          !sess ||
          !isChecklistExecuting(sess)
        ) {
          return { commit: false, value: null };
        }
        // Refresh checklist + verify under the write lock — concurrent edits or a
        // flipped report must not ICC against a stale open item.
        let lockedItem = currentItem;
        const lockedPath = checklistPath || "";
        if (checklistPath) {
          const locked = this.parseSessionChecklist(sess);
          if (!locked) {
            return { commit: false, value: null };
          }
          if (locked.unchecked === 0) {
            // Nothing left to verify — let the next stop take the done path.
            return { commit: false, value: null };
          }
          const nextItem = locked.currentItem;
          if (!nextItem) {
            return { commit: false, value: null };
          }
          lockedItem = nextItem;
        }
        const lockedEval = evaluateVerifyReport({
          enabled: this.config.verifyEnabled,
          commands: this.config.verifyCommands,
          reportPath,
          currentItem: lockedItem,
          checklistPath: lockedPath,
          projectRoot: this.trustedProjectRoot() ?? undefined,
        });
        if (lockedEval.outcome !== "fail") {
          return { commit: false, value: null };
        }
        const failReason = lockedEval.reason ?? reason;
        const nextIdle = sess.idle_stop_count + 1;
        const nowStuck = nextIdle >= this.config.maxIdleStops;
        if (nowStuck) {
          this.store.upsertSession({
            conversation_id: cid,
            project_root: sess.project_root,
            code_root: sess.code_root,
            idle_stop_count: nextIdle,
            paused: 1,
            paused_reason: "stuck",
            armed: 0,
          });
        } else {
          this.store.upsertSession({
            conversation_id: cid,
            project_root: sess.project_root,
            code_root: sess.code_root,
            idle_stop_count: nextIdle,
          });
        }
        const kind: FollowupKind = nowStuck ? "stuck" : "verify_fix";
        const message = this.render(kind, nowStuck ? {} : { reason: failReason });
        this.store.updateReviewChain(cid, {
          confirm_left: 0,
          item_confirm_complete: 1,
          chain_pending: 1,
          pending_followup: message,
          pending_followup_at: new Date().toISOString(),
          pending_redeliver_at: null,
        });
        const out: FollowupAction = {
          kind,
          message,
          loop: true,
          meta: { reason: failReason },
        };
        return { commit: true, value: out };
      });
    }

    // E5a+E5b: reset chain and persist advance/done pending in one write txn
    // so a crash cannot leave "reset, no pending" (would re-arm confirm or stall).
    return this.e5bAdvance(session, {
      unchecked,
      next: currentItem,
      verifiedPass: evalResult.outcome === "pass",
    });
  }

  private e5bAdvance(
    session: SessionRow,
    checklist: {
      unchecked: number;
      next: ChecklistItem | null;
      /** True only when evaluateVerifyReport returned pass for checklist.next. */
      verifiedPass: boolean;
    },
  ): FollowupAction | null {
    const cid = session.conversation_id;
    const chainReset = {
      confirm_left: null as null,
      fix_round: 0,
      code_edited: 0,
      item_confirm_complete: 0,
    };

    return this.store.exclusiveWrite(() => {
      // Re-check E5 gate under the write lock — a concurrent stop may have
      // already advanced/reset the chain (confirm_left null, ICC 0).
      const fresh = this.store.getReviewChain(cid);
      const atE5 =
        !!fresh &&
        (fresh.confirm_left === 0 ||
          (fresh.item_confirm_complete === 1 && fresh.confirm_left === null));
      if (!atE5) {
        return { commit: false, value: null };
      }

      const lockedSession = this.store.getSession(cid);
      if (
        !lockedSession ||
        !sessionReviewRunnable(lockedSession, this.config.reviewScope)
      ) {
        return { commit: false, value: null };
      }

      // Refresh checklist under the lock — pass-path callers may hold a stale
      // unchecked/next from before BEGIN IMMEDIATE (same class as E5c fail).
      let unchecked = checklist.unchecked;
      let next = checklist.next;
      let following: ChecklistItem | null = null;
      const path = lockedSession.checklist_path?.trim() ?? "";
      const onChecklistPath =
        isChecklistExecuting(lockedSession) && path.length > 0;
      if (onChecklistPath) {
        const refreshed = this.parseSessionChecklist(lockedSession);
        if (!refreshed) {
          return { commit: false, value: null };
        }
        unchecked = refreshed.unchecked;
        next = refreshed.currentItem;
        following = refreshed.followingItem;
      } else {
        unchecked = 0;
        next = null;
        following = null;
      }

      // Project-scope ambient/planning: end chain without checklist advance/done.
      if (!onChecklistPath) {
        if (isChecklistExecuting(lockedSession)) {
          // Executing with empty/missing checklist — legacy done path below.
        } else if (this.config.reviewScope === "project") {
          const completeMsg = this.render("review_complete", {
            total: this.config.confirmRounds,
          });
          const completeAction: FollowupAction = {
            kind: "review_complete",
            message: completeMsg,
            loop: true,
          };
          this.store.upsertSession({
            conversation_id: cid,
            project_root: lockedSession.project_root,
            code_root: lockedSession.code_root,
            error_count: 0,
            idle_stop_count: 0,
            last_error: null,
          });
          this.store.updateReviewChain(cid, {
            ...chainReset,
            pending_followup: completeMsg,
            pending_followup_at: new Date().toISOString(),
            pending_redeliver_at: null,
            chain_pending: 0,
          });
          return { commit: true, value: completeAction };
        } else {
          return { commit: false, value: null };
        }
      }

      // When verify is armed (enabled + required cmds):
      // - foresaw done but items reappeared → abort (must re-enter e5Gate)
      // - verifiedPass for a specific item that changed/vanished → abort
      // Skip/disabled verify may freely refresh counts under the lock.
      const verifyArmed =
        this.config.verifyEnabled &&
        this.config.verifyCommands.some((c) => c.required === true);
      if (verifyArmed) {
        const foresawDone = checklist.unchecked === 0;
        if (foresawDone && unchecked > 0) {
          return { commit: false, value: null };
        }
        if (
          checklist.verifiedPass &&
          checklist.next != null &&
          (unchecked === 0 || next?.id !== checklist.next.id)
        ) {
          return { commit: false, value: null };
        }
      }

      const isAdvance = unchecked > 1;
      // Invariant: >1 unchecked ⇒ secondUnchecked exists; abort rather than
      // emit advance pointing at the item about to be marked [x].
      if (isAdvance && !following) {
        return { commit: false, value: null };
      }
      // nextId/Title = item after marking current [x], not firstUnchecked.
      const message = isAdvance
        ? this.render("advance", {
            nextId: following?.id ?? "",
            nextTitle: following?.title ?? "",
          })
        : this.render("done", {});
      const action: FollowupAction = {
        kind: isAdvance ? "advance" : "done",
        message,
        loop: true,
      };

      if (isAdvance) {
        this.store.upsertSession({
          conversation_id: cid,
          project_root: session.project_root,
          code_root: session.code_root,
          error_count: 0,
          idle_stop_count: 0,
          last_error: null,
        });
        this.store.updateReviewChain(cid, {
          ...chainReset,
          pending_followup: message,
          pending_followup_at: new Date().toISOString(),
          pending_redeliver_at: null,
          chain_pending: 1,
        });
      } else {
        this.store.upsertSession({
          conversation_id: cid,
          project_root: session.project_root,
          code_root: session.code_root,
          phase: "done" as Phase,
          armed: 0,
          error_count: 0,
          idle_stop_count: 0,
          last_error: null,
        });
        // pending kept for first-delivery / diagnostics; chain_pending must stay 0
        // so a later path cannot treat the chain as still active.
        this.store.updateReviewChain(cid, {
          ...chainReset,
          pending_followup: message,
          pending_followup_at: new Date().toISOString(),
          pending_redeliver_at: null,
          chain_pending: 0,
        });
      }
      return { commit: true, value: action };
    });
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

  /**
   * Best-effort session bookkeeping after a followup was already committed
   * (pending_followup in exclusiveWrite). Must not throw into handleStop's
   * soft-fail catch — that would drop the committed action from the hook reply.
   */
  private afterFollowupCommitted(
    session: SessionRow,
    changed: { confirm_left?: number | null; fix_round?: number },
  ): void {
    try {
      this.bumpProgress(session, changed);
      this.noteCompletedOk(session);
    } catch {
      /* keep committed followup deliverable */
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

  // planning / executing checklist, or project-scope ambient (idle+armed)
  const ambientArmed =
    session.phase === "idle" && session.armed === 1 && session.paused === 0;
  if (
    session.phase === "planning" ||
    session.phase === "executing" ||
    ambientArmed
  ) {
    const wasPaused = session.paused === 1;
    let pausedReason = session.paused_reason;
    if (!wasPaused) {
      pausedReason =
        session.phase === "executing" || session.phase === "idle"
          ? "human_gate"
          : null;
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
  const root =
    normalizeProjectRoot(store.projectRoot) ??
    normalizeProjectRoot(projectRoot);
  if (!root) {
    return { ok: false, userMessage: "Invalid project root." };
  }
  projectRoot = root;
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

export type ApplyResumeResult =
  | { ok: true; session: SessionRow | null }
  | { ok: false; userMessage: string };

function finishLocalResume(
  store: StateStore,
  conversationId: string,
  session: SessionRow,
): SessionRow | null {
  // Speculative read + checklist I/O outside the write lock (never block other
  // writers on disk). Re-check live row under IMMEDIATE before applying.
  const snap = store.getSession(conversationId);
  if (!snap) {
    return null;
  }

  let armedOnUnpauseExecuting: number | undefined;
  if (snap.paused === 1 && snap.phase === "executing") {
    armedOnUnpauseExecuting = 0;
    if (snap.checklist_path) {
      const root = normalizeProjectRoot(store.projectRoot);
      if (root && isRealpathInsideProject(root, snap.checklist_path)) {
        try {
          armedOnUnpauseExecuting =
            countUnchecked(
              parseChecklist(snap.checklist_path, {
                projectRoot: root,
              }),
            ) > 0
              ? 1
              : 0;
        } catch {
          armedOnUnpauseExecuting = 0;
        }
      }
    }
  }

  return store.exclusiveWrite(() => {
    const live = store.getSession(conversationId);
    if (!live) {
      return { commit: false, value: null };
    }

    const patch: Partial<SessionRow> & {
      conversation_id: string;
      project_root: string;
      code_root: string;
    } = {
      conversation_id: conversationId,
      project_root: live.project_root || session.project_root,
      code_root: live.code_root || session.code_root,
    };

    const phase = live.phase;
    const paused = live.paused;

    if (paused === 1) {
      patch.paused = 0;
      patch.paused_reason = null;
      patch.error_count = 0;
      patch.idle_stop_count = 0;
      if (phase === "executing") {
        // Use precomputed armed only when phase/checklist still match the snap;
        // otherwise fail closed (armed=0) rather than parsing under the lock.
        if (
          armedOnUnpauseExecuting !== undefined &&
          snap.phase === "executing" &&
          snap.checklist_path === live.checklist_path
        ) {
          patch.armed = armedOnUnpauseExecuting;
        } else {
          patch.armed = 0;
        }
      }
      if (phase === "idle") {
        patch.armed = 1;
      }
    }

    if (phase === "planning") {
      patch.armed = 0;
    }

    const updated = store.upsertSession(patch);
    try {
      store.clearPendingFollowupIf(
        conversationId,
        isRecoverOrStuckFollowupMessage,
      );
    } catch {
      /* best-effort */
    }
    return { commit: true, value: updated };
  });
}

/**
 * Apply RESUME: unpause local session, or claim another conversation's track
 * onto this conversation_id (preserving review_chains).
 */
export function applyResume(
  store: StateStore,
  conversationId: string,
  opts?: { slug?: string },
): ApplyResumeResult {
  if (!store.isConversationIdOk(conversationId)) {
    return { ok: false, userMessage: "Invalid conversation id." };
  }

  let session = store.getSession(conversationId);
  const slug = opts?.slug?.trim() || undefined;
  // Fail closed on illegal slug before localMatches / claim (idempotent retry-safe).
  if (slug && !isSafeTrackSlug(slug)) {
    return {
      ok: false,
      userMessage: `Invalid track slug "${sanitizeSessionDisplayText(slug).slice(0, 64)}".`,
    };
  }

  // Only planning/executing "own" the conversation for local resume.
  // idle (incl. ambient revive with a stale track_id) and done go through
  // claimSessionInto so a foreign executing session for the same slug can win.
  const localMatches =
    !!session &&
    (session.phase === "executing" || session.phase === "planning") &&
    (!slug || session.track_id === slug);

  if (!localMatches) {
    const claimed = store.claimSessionInto(conversationId, { slug });
    if (!claimed.ok) return claimed;
    session = claimed.session;
  }

  if (!session) {
    return { ok: true, session: null };
  }

  const updated = finishLocalResume(store, conversationId, session);
  if (!updated) {
    return {
      ok: false,
      userMessage: "Session moved concurrently; retry Autopilot RESUME.",
    };
  }

  return {
    ok: true,
    session: updated,
  };
}

/** resume_review: only chain_pending=1 */
export function applyResumeReview(store: StateStore, conversationId: string): void {
  store.setChainPending(conversationId);
}
