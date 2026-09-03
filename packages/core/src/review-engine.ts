import {
  countUnchecked,
  effectiveReviewingItemId,
  firstUnchecked,
  parseAdvanceNextItemId,
  parseChecklist,
  resolveAdvanceTargets,
  secondUnchecked,
  type ChecklistItem,
  type ChecklistMd,
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
  BRIEFLY_PREFIX,
  followupInFlight,
  inFlightUserQuery,
  inRecoverDebounceWindow,
  PENDING_REDELIVER_COOLDOWN_MS,
  pendingRedeliverAllowed,
  RECOVER_DEBOUNCE_MS,
  sleepSyncMs,
  readTranscriptTail,
  transcriptTipIsAssistant,
} from "./transcript-followup.js";
import { isRecoverFollowupMessage, isRecoverOrStuckFollowupMessage } from "./trigger-parser.js";
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
  /**
   * Error-stop recover debounce / same-window coalesce (ms).
   * Default {@link RECOVER_DEBOUNCE_MS} (3000). Tests pass 0 to skip sleep.
   */
  recoverDebounceMs?: number;
  /** Override sync sleep used by recover debounce (tests). */
  sleepSync?: (ms: number) => void;
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
        `1) when using git diff / git status, skip paths matching .autopilotignore, and skip untracked paths ignored by .gitignore; review only the remaining paths; ` +
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
        `1) git diff / git status — no new edits vs prior turn (or only already-reviewed edits); likewise skip paths matching .autopilotignore and untracked paths ignored by .gitignore; judge only from remaining paths; ` +
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
        `1) git diff / git status — no new edits vs prior turn (or only already-reviewed edits); likewise skip paths matching .autopilotignore and untracked paths ignored by .gitignore; judge only from remaining paths; ` +
        `2) dig into this lens only; ban vague "fully rechecked, all good"; ` +
        `3) read-only: record CRITICAL/HIGH/missing tests — do not change code, add tests, or commit; if you already edited, accept returning to a fix round; never commit this turn; ` +
        `4) do not run commands that mutate the repo; ` +
        `5) close with: "Lens (${vars.lensTitle}): self-review clean" or list issues (no fixes); if clean, do not edit further. ` +
        `Do not commit/push. Handoff (commit) and next checklist item are handled by Advance/Done after the chain — not this turn.`
      );
    case "advance":
      return (
        `Advance checklist: confirm chain passed cleanly (confirm rounds do not commit). ` +
        `First mark the completed current item ${vars.currentId ?? ""} [x] in checklist.md ` +
        `(do not mark the next item yet). ` +
        `Never mark an item [x] while you are still implementing it — only this Advance/Done followup checks off the completed item. ` +
        `Then, if the working tree still has uncommitted changes for this item ` +
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
      return `Recover: the previous turn ended with an error. Continue the current task.`;
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
    checklist: ChecklistMd;
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
        checklist: cl,
      };
    } catch {
      return null;
    }
  }

  private reviewChainResetFields(): Pick<
    ReviewChainRow,
    | "confirm_left"
    | "fix_round"
    | "code_edited"
    | "item_confirm_complete"
    | "reviewing_item_id"
  > {
    return {
      confirm_left: null,
      fix_round: 0,
      code_edited: 0,
      item_confirm_complete: 0,
      reviewing_item_id: null,
    };
  }

  private renderAdvanceOrDone(targets: {
    current: ChecklistItem | null;
    next: ChecklistItem | null;
  }): FollowupAction {
    const isAdvance = targets.next != null;
    const message = isAdvance
      ? this.render("advance", {
          currentId: targets.current?.id ?? "",
          currentTitle: targets.current?.title ?? "",
          nextId: targets.next?.id ?? "",
          nextTitle: targets.next?.title ?? "",
        })
      : this.render("done", {});
    return {
      kind: isAdvance ? "advance" : "done",
      message,
      loop: true,
    };
  }

  /** Resolve sticky reviewing id from chain, or fall back to hint / firstUnchecked. */
  private resolveReviewingItemId(
    chain: ReviewChainRow | null | undefined,
    checklist: ChecklistMd | null | undefined,
    hintItemId?: string | null,
  ): string | null {
    const sticky = chain?.reviewing_item_id?.trim() || "";
    if (sticky) {
      if (!checklist) return sticky;
      const usable = effectiveReviewingItemId(checklist, sticky);
      if (usable) return usable;
      // Sticky points past an earlier open item (advance seeded next too early).
    }
    const hint = (hintItemId ?? "").trim();
    if (hint) {
      if (!checklist) return hint;
      const usableHint = effectiveReviewingItemId(checklist, hint);
      if (usableHint) return usableHint;
    }
    if (!checklist) return null;
    return firstUnchecked(checklist)?.id ?? null;
  }

  /** E1: afterFileEdit product code → code_edited=1 (+ sticky reviewing_item_id). */
  onCodeEdited(conversationId: string): void {
    // Checklist FS read stays outside the write lock; only pending/sticky arming
    // uses the live chain row under the lock (neutralize/advance TOCTOU).
    const session = this.store.getSession(conversationId);
    const parsed = session ? this.parseSessionChecklist(session) : null;
    this.store.markCodeEdited(conversationId, (chain) => {
      const fromPending = parseAdvanceNextItemId(chain.pending_followup);
      if (parsed?.checklist) {
        if (
          fromPending &&
          effectiveReviewingItemId(parsed.checklist, fromPending)
        ) {
          return fromPending;
        }
        return parsed.currentItem?.id ?? null;
      }
      return fromPending;
    });
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
        // Only clear the snapshot needle — a concurrent replace must survive.
        const cleared = this.store.clearPendingFollowupIf(
          conversationId,
          (m) => m.trim() === pending,
        );
        if (!cleared) {
          // Live pending was replaced (e.g. error-recover claim). Keep blocking
          // so stale confirm_left cannot advance and overwrite the new pending.
          const live =
            this.store.getReviewChain(conversationId)?.pending_followup?.trim() ??
            "";
          if (
            live &&
            !(events.length > 0 && automationFollowupPresent(events, live))
          ) {
            return true;
          }
        }
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
    // Recover claim arms pending_redeliver_at for ~debounceMs so completed-stop
    // cannot inject during claim sleep (would race CAS for a second recover).
    // CAS emit clears that hold → host-drop redelivery is immediate again.
    if (events.length > 0 && automationFollowupPresent(events, pending)) {
      try {
        const cleared = this.store.clearPendingFollowupIf(
          conversationId,
          (m) => m.trim() === pending,
        );
        // Snapshot looked delivered but live was replaced — fall through to the
        // locked live-row path instead of dropping the new pending.
        if (cleared) return null;
      } catch {
        /* already delivered — clearing stamp is best-effort */
      }
    }
    // Apply even after a delivered-snapshot miss (replaced live pending): do not
    // inject while another harness followup still owns the transcript tip.
    if (events.length > 0 && followupInFlight(events)) {
      return null;
    }
    // Cooldown + touch under one write lock so we never honor a stale
    // chain.pending_redeliver_at snapshot from before a concurrent recover claim.
    try {
      return this.store.exclusiveWrite(() => {
        if (!this.sessionRunnable(conversationId)) {
          return { commit: false, value: null };
        }
        const liveRow = this.store.getReviewChain(conversationId);
        const livePending = liveRow?.pending_followup?.trim() ?? "";
        if (!livePending) {
          return { commit: false, value: null };
        }
        if (!pendingRedeliverAllowed(liveRow?.pending_redeliver_at ?? null)) {
          return { commit: false, value: null };
        }
        // Live row may differ from the outer snapshot — do not re-inject a tip
        // already present on the transcript.
        if (
          events.length > 0 &&
          automationFollowupPresent(events, livePending)
        ) {
          this.store.clearPendingFollowupIf(
            conversationId,
            (m) => m.trim() === livePending,
          );
          return { commit: true, value: null };
        }
        try {
          this.store.touchPendingRedeliver(conversationId);
        } catch {
          // Still attempt redeliver — cooldown stamp is best-effort.
        }
        // Commit after touch: a nested clear/neutralize (or concurrent-looking
        // mock) must not be rolled back by commit:false, or the outer stop
        // would keep a stale confirm_left and skip-a-lens / re-emit.
        if (!this.sessionRunnable(conversationId)) {
          return { commit: true, value: null };
        }
        const after =
          this.store.getReviewChain(conversationId)?.pending_followup?.trim() ??
          "";
        if (!after) {
          return { commit: true, value: null };
        }
        if (events.length > 0 && automationFollowupPresent(events, after)) {
          this.store.clearPendingFollowupIf(
            conversationId,
            (m) => m.trim() === after,
          );
          return { commit: true, value: null };
        }
        return {
          commit: true,
          value: {
            kind: this.inferPendingKind(after),
            message: after,
            loop: true,
            meta: { redeliver: true },
          },
        };
      });
    } catch {
      return null;
    }
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
   * Clear sticky code_edited so Stop→revert→resend cannot open a phantom fix
   * chain on the next completed stop (disk may already be clean).
   * Leave fix/confirm pending alone (delivery retry still valid if inject raced).
   * Both clears share one exclusiveWrite so a mid-abort failure cannot leave
   * recover gone while code_edited sticky (or the reverse).
   */
  private handleAbortedStop(session: SessionRow): FollowupAction | null {
    try {
      const cid = session.conversation_id;
      this.store.exclusiveWrite(() => {
        this.store.clearPendingFollowupIf(cid, isRecoverOrStuckFollowupMessage);
        this.store.clearCodeEdited(cid);
        return { commit: true, value: undefined };
      });
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
      return this.debouncedErrorRecover(fresh, input);
    }
    return null;
  }

  private resolveRecoverDebounceMs(): number {
    const n = this.config.recoverDebounceMs;
    if (n === undefined) return RECOVER_DEBOUNCE_MS;
    if (!Number.isFinite(n) || n < 0) return RECOVER_DEBOUNCE_MS;
    return Math.min(Math.floor(n), 60_000);
  }

  private sleepRecoverDebounce(ms: number): void {
    try {
      (this.config.sleepSync ?? sleepSyncMs)(ms);
    } catch {
      // Sleep is best-effort; claim/coalesce still hold. Always continue to finish.
    }
  }

  /**
   * Error recover: claim under exclusiveWrite → sleep debounce → emit at most
   * once per window. Concurrent error stops in the same window coalesce to null.
   * Outside the window, if still dead, redeliver once (new window).
   * Emit ownership is CAS'd on `pending_followup_at` so claimer+redeliver
   * cannot both return followup_message after overlapping sleeps.
   */
  private debouncedErrorRecover(
    session: SessionRow,
    input: StopHandlerInput,
  ): FollowupAction | null {
    const recoverKind = this.recoverKindForPhase(session.phase);
    const message = this.render(recoverKind, {}).trim();
    // Blank/NUL must not claim: ambient soft-reset would wipe the chain with
    // nothing redeliverable (savePendingFollowup no-ops on empty/NUL).
    if (!message || message.includes("\0")) {
      return null;
    }
    const action: FollowupAction = {
      kind: "recover",
      message,
      loop: true,
    };
    const cid = session.conversation_id;
    const ambient = !isChecklistExecuting(session);
    const debounceMs = this.resolveRecoverDebounceMs();
    const transcriptPath = input.transcriptPath?.trim() || undefined;

    // Genuine error stop: always attempt recover claim. A dead non-recover
    // harness tip (fix / confirm / delivery tip) at claim time must still inject —
    // suppressing left the session stuck with no followup. Recover tip falls
    // through so coalesce/CAS can dedupe (finish suppresses double-inject when
    // recover is already the unanswered tip).
    let recoverAnsweredAtClaim = false;
    /**
     * Unanswered non-recover harness tip text at claim time (if any). Finish
     * may emit over the *same* dead tip; a *different* harness tip that landed
     * during sleep must not get a stacked recover inject.
     */
    let deadHarnessTipAtClaim: string | null = null;
    /** Claim-time tip was a fix followup (re-arm even if pending was cleared). */
    let fixTipAtClaim = false;
    if (transcriptPath) {
      const tipEvents = readTranscriptTail(transcriptPath);
      const inflightAtClaim = inFlightUserQuery(tipEvents);
      if (
        inflightAtClaim &&
        !isRecoverFollowupMessage(inflightAtClaim)
      ) {
        deadHarnessTipAtClaim = inflightAtClaim;
        if (this.isFixFollowupMessage(inflightAtClaim)) {
          fixTipAtClaim = true;
        }
      }
      // Snapshot before claim: historical Recover+assistant must not be treated
      // as "became alive during sleep" for a brand-new error (same template text).
      recoverAnsweredAtClaim =
        tipEvents.length > 0 &&
        transcriptTipIsAssistant(tipEvents) &&
        automationFollowupPresent(tipEvents, message);
    }

    const claim = this.tryClaimErrorRecoverWindow(
      cid,
      message,
      debounceMs,
      ambient,
      recoverAnsweredAtClaim,
      fixTipAtClaim,
    );
    if (claim.role === "coalesced") {
      return null;
    }
    if (claim.role === "failed") {
      // Claim txn failed. Compensate like legacy handleErrorStop, but never wipe
      // an existing recover pending (unlocked neutralize would race a claimer).
      return this.compensateFailedErrorRecoverClaim(cid, message, action, ambient);
    }

    this.sleepRecoverDebounce(debounceMs);
    return this.finishErrorRecoverAfterDebounce(
      cid,
      message,
      transcriptPath,
      claim.stamp,
      recoverAnsweredAtClaim,
      deadHarnessTipAtClaim,
    );
  }

  /**
   * Claim the recover inject slot for this error storm.
   * - coalesced: another stop already owns the window → do not emit
   * - claimer/redeliver: pending written; `stamp` is pending_followup_at for CAS emit
   * - failed: exclusiveWrite threw
   */
  private tryClaimErrorRecoverWindow(
    conversationId: string,
    message: string,
    debounceMs: number,
    ambient: boolean,
    recoverAnsweredAtClaim = false,
    fixTipAtClaim = false,
  ):
    | { role: "coalesced" }
    | { role: "claimer" | "redeliver"; stamp: string }
    | { role: "failed" } {
    type RecoverClaim =
      | { role: "coalesced" }
      | { role: "claimer" | "redeliver"; stamp: string }
      | { role: "failed" };
    try {
      return this.store.exclusiveWrite<RecoverClaim>(() => {
        const session = this.store.getSession(conversationId);
        if (!session || !this.sessionErrorRecoverable(session)) {
          return { commit: false, value: { role: "failed" as const } };
        }
        this.store.ensureReviewChain(conversationId);
        const chain = this.store.getReviewChain(conversationId);
        let pending = chain?.pending_followup?.trim() ?? "";
        const inWindow =
          isRecoverFollowupMessage(pending) &&
          inRecoverDebounceWindow(chain?.pending_followup_at, debounceMs);
        // Stale recover pending after the agent already answered that recover:
        // drop only when outside the window, then fall through to fresh-claim
        // for this new error. Never wipe an in-window claimer, and never
        // coalesce-return after the drop (that swallowed the new storm).
        if (
          recoverAnsweredAtClaim &&
          isRecoverFollowupMessage(pending) &&
          !inWindow
        ) {
          this.store.clearPendingFollowupIf(conversationId, (m) =>
            isRecoverFollowupMessage(m),
          );
          pending = "";
        }
        if (inWindow) {
          return { commit: true, value: { role: "coalesced" as const } };
        }
        if (isRecoverFollowupMessage(pending)) {
          // Outside window, still dead — refresh stamp so peers coalesce.
          this.store.savePendingFollowup(conversationId, message, {
            armChain: false,
          });
          const stamp =
            this.store.getReviewChain(conversationId)?.pending_followup_at ?? "";
          if (!stamp) {
            return { commit: false, value: { role: "failed" as const } };
          }
          // Recover must not keep a leftover fix chain_pending (phantom E3).
          this.store.clearChainPending(conversationId);
          // Hold completed-stop redeliver through claim sleep; CAS clears it.
          this.armRecoverClaimRedeliverHold(conversationId, debounceMs);
          return {
            commit: true,
            value: { role: "redeliver" as const, stamp },
          };
        }
        if (ambient) {
          this.applySoftResetAmbientChainForErrorRecover(conversationId);
          // Soft-reset already chose code_edited for pending/chain. Only force
          // when the dead transcript tip was fix but pending was empty/desynced —
          // and never during mid-confirm / E5 (would phantom-arm E2 over E4/E5).
          const live = this.store.getReviewChain(conversationId);
          if (
            fixTipAtClaim &&
            live &&
            !this.isMidConfirmOrE5(live)
          ) {
            this.store.updateReviewChain(conversationId, { code_edited: 1 });
          }
        } else {
          // Executing skips ambient soft-reset; re-arm fix for dead fix tip /
          // pending, but not while confirm_left says mid-confirm or E5-ready.
          const resumeFix =
            !this.isMidConfirmOrE5(chain) &&
            (this.isFixFollowupMessage(pending) ||
              chain?.code_edited === 1 ||
              fixTipAtClaim);
          if (resumeFix) {
            this.store.updateReviewChain(conversationId, { code_edited: 1 });
          }
        }
        this.store.savePendingFollowup(conversationId, message, {
          armChain: false,
        });
        const stamp =
          this.store.getReviewChain(conversationId)?.pending_followup_at ?? "";
        if (!stamp) {
          return { commit: false, value: { role: "failed" as const } };
        }
        // Executing claim skips ambient soft-reset — still disarm chain_pending.
        // Ambient soft-reset already cleared chain_pending; clear again is idempotent.
        this.store.clearChainPending(conversationId);
        this.armRecoverClaimRedeliverHold(conversationId, debounceMs);
        return {
          commit: true,
          value: { role: "claimer" as const, stamp },
        };
      });
    } catch {
      return { role: "failed" };
    }
  }

  /**
   * After debounce: skip inject if the session already revived or recover is
   * already in-flight on the transcript; otherwise CAS-emit on claim stamp.
   */
  private finishErrorRecoverAfterDebounce(
    conversationId: string,
    message: string,
    transcriptPath: string | undefined,
    expectedStamp: string,
    recoverAnsweredAtClaim = false,
    deadHarnessTipAtClaim: string | null = null,
  ): FollowupAction | null {
    if (!expectedStamp) {
      return null;
    }
    const fresh = this.store.getSession(conversationId);
    if (!fresh || !this.sessionErrorRecoverable(fresh)) {
      this.clearRecoverPendingBestEffort(conversationId);
      return null;
    }
    const live =
      this.store.getReviewChain(conversationId)?.pending_followup?.trim() ?? "";
    if (!isRecoverFollowupMessage(live)) {
      return null;
    }
    const needle = live || message;
    const events = transcriptPath ? readTranscriptTail(transcriptPath) : [];
    if (events.length > 0) {
      const inflight = inFlightUserQuery(events);
      if (inflight && isRecoverFollowupMessage(inflight)) {
        // Keep recover pending for host-drop / later redeliver, but drop THIS
        // stop's claim hold only (stamp-matched). Sleep may have been no-op;
        // an uncleared hold would block redelivery for the full debounceMs.
        // Must not wipe a peer redeliver's newly armed hold after the window.
        try {
          this.store.clearPendingRedeliverHoldIfStamp(
            conversationId,
            expectedStamp,
          );
        } catch {
          /* best-effort */
        }
        return null;
      }
      // Tip race during sleep: a *new* non-recover harness landed after claim.
      // Do not stack a recover inject on top — keep pending for redelivery.
      // Exception: finish tip is still the same dead harness tip from claim
      // (this error killed that turn) → must emit recover or the session stays stuck.
      if (
        inflight &&
        !isRecoverFollowupMessage(inflight) &&
        !this.isSameDeadHarnessTip(deadHarnessTipAtClaim, inflight)
      ) {
        try {
          this.store.clearPendingRedeliverHoldIfStamp(
            conversationId,
            expectedStamp,
          );
        } catch {
          /* best-effort */
        }
        return null;
      }
      if (
        !recoverAnsweredAtClaim &&
        transcriptTipIsAssistant(events) &&
        automationFollowupPresent(events, needle)
      ) {
        // Became answered during debounce sleep — do not double-emit.
        // If Recover+assistant was already true at claim time, this is a new
        // error after a prior revive (same template); fall through to CAS.
        this.clearRecoverPendingBestEffort(conversationId);
        return null;
      }
      // Tip is unanswered user text, same dead harness from claim, or prior
      // assistant without our recover — still dead; emit recover.
    }
    const emitted = this.tryCasRecoverEmit(
      conversationId,
      expectedStamp,
      needle,
    );
    if (!emitted) return null;
    // Pause may land after CAS commit — drop inject + clear recover pending.
    return this.recoverActionIfStillRunnable(conversationId, emitted);
  }

  /**
   * True when finish-time inflight is the same dead harness tip snapped at claim.
   * Requires the same harness kind first (fix vs confirm must not match), then
   * exact match. Only fix tips allow finish starting with claim's 48-char prefix
   * (round digits appear early in en/zh). Confirm is exact-only: English confirm
   * puts {lensTitle} after ~100 chars, so a 48-prefix would treat different
   * lenses as the same tip. Advance/Hook/Briefly stay exact-only for the same
   * shared-lead-in reason.
   */
  private isSameDeadHarnessTip(
    claimTip: string | null,
    finishTip: string,
  ): boolean {
    if (!claimTip) return false;
    const a = claimTip.trim();
    const b = finishTip.trim();
    if (!a || !b) return false;
    const kind = this.harnessFollowupKind(a);
    if (kind !== this.harnessFollowupKind(b)) return false;
    if (a === b) return true;
    // Prefix matching only for fix (round index diverges within 48 chars).
    if (kind !== "fix") {
      return false;
    }
    const prefix = a.slice(0, 48);
    if (prefix && b.startsWith(prefix)) return true;
    // Truncated re-read of the same tip (finish shorter than claim prefix).
    if (b.length < prefix.length && a.startsWith(b)) return true;
    return false;
  }

  /** Coarse kind bucket so fix/confirm/advance tips cannot share a prefix match. */
  private harnessFollowupKind(m: string): string {
    if (this.isFixFollowupMessage(m)) return "fix";
    if (m.startsWith("Review confirm") || m.startsWith("自审确认")) {
      return "confirm";
    }
    if (m.startsWith("Advance checklist") || m.startsWith("推进下一项")) {
      return "advance";
    }
    if (m.startsWith("Briefly inform the user about the task result.")) return "hook";
    if (m.startsWith(BRIEFLY_PREFIX)) return "briefly";
    if (m.startsWith("Stuck:") || m.startsWith("卡住：") || m.startsWith("卡住:")) {
      return "stuck";
    }
    if (m.startsWith("Verify failed") || m.startsWith("校验失败")) {
      return "verify";
    }
    if (
      m.startsWith("All checklist") ||
      m.startsWith("全部完成") ||
      m.startsWith("Review complete") ||
      m.startsWith("自审完成")
    ) {
      return "terminal";
    }
    return "other";
  }

  /**
   * Atomically take emit ownership: only the stop whose claim stamp still
   * matches may return followup. Winner bumps pending_followup_at so a racing
   * redeliver lands in-window and coalesces instead of double-injecting.
   */
  private tryCasRecoverEmit(
    conversationId: string,
    expectedStamp: string,
    fallbackMessage: string,
  ): FollowupAction | null {
    try {
      return this.store.exclusiveWrite(() => {
        const chain = this.store.getReviewChain(conversationId);
        const live = chain?.pending_followup?.trim() ?? "";
        if (!isRecoverFollowupMessage(live)) {
          return { commit: false, value: null };
        }
        if (chain?.pending_followup_at !== expectedStamp) {
          return { commit: false, value: null };
        }
        const session = this.store.getSession(conversationId);
        if (!session || !this.sessionErrorRecoverable(session)) {
          this.store.clearPendingFollowupIf(conversationId, (m) =>
            isRecoverFollowupMessage(m),
          );
          return { commit: true, value: null };
        }
        // True CAS: only one stop bumps the stamp; savePending no-op cannot
        // leave two winners with the same expectedStamp.
        if (!this.store.casBumpPendingFollowupAt(conversationId, expectedStamp)) {
          return { commit: false, value: null };
        }
        // Defense: recover emit must not leave chain_pending armed.
        this.store.clearChainPending(conversationId);
        return {
          commit: true,
          value: {
            kind: "recover" as const,
            message: live || fallbackMessage,
            loop: true,
          },
        };
      });
    } catch {
      return null;
    }
  }

  private clearRecoverPendingBestEffort(conversationId: string): void {
    try {
      this.store.clearPendingFollowupIf(conversationId, (m) =>
        isRecoverFollowupMessage(m),
      );
    } catch {
      /* best-effort */
    }
  }

  /**
   * Block completed-stop recover redelivery for ~holdMs using pending_redeliver_at
   * against {@link PENDING_REDELIVER_COOLDOWN_MS}. CAS emit nulls the hold so a
   * host-dropped inject can redeliver immediately (unlike gating on
   * pending_followup_at, which CAS refreshes and would extend the block).
   *
   * When holdMs > cooldown, `at` is in the future so
   * {@link pendingRedeliverAllowed} stays false until ~holdMs elapses — do not
   * clamp hold to cooldown (that would unblock mid-sleep for long debounce).
   */
  private armRecoverClaimRedeliverHold(
    conversationId: string,
    holdMs: number,
  ): void {
    if (!(holdMs > 0) || !Number.isFinite(holdMs)) return;
    const cooldown = PENDING_REDELIVER_COOLDOWN_MS;
    // Match resolveRecoverDebounceMs cap — keep hold covering the full sleep.
    const hold = Math.min(Math.floor(holdMs), 60_000);
    if (!(hold > 0)) return;
    const at = new Date(Date.now() - (cooldown - hold)).toISOString();
    // Column-only: merge updateReviewChain would rewrite confirm_left/pending.
    this.store.setPendingRedeliverHold(conversationId, at);
  }

  /**
   * Last-resort when tryClaimErrorRecoverWindow's exclusiveWrite failed.
   * Retries ambient soft-reset+pending up to 3×; then column-only disarm +
   * emitRecover (never unlocked neutralize/soft-reset, never full-neutralize
   * after transient lock failures — that wiped mid-confirm confirm_left).
   * Skip wipe/emit when recover pending already exists.
   */
  private compensateFailedErrorRecoverClaim(
    conversationId: string,
    message: string,
    action: FollowupAction,
    ambient: boolean,
  ): FollowupAction | null {
    const recoverPending = (): boolean => {
      try {
        const pending =
          this.store.getReviewChain(conversationId)?.pending_followup?.trim() ??
          "";
        return isRecoverFollowupMessage(pending);
      } catch {
        return false;
      }
    };

    // Paused/disarmed after claim failure — do not inject recover.
    if (!this.sessionStillErrorRecoverable(conversationId)) {
      return null;
    }

    // Peer already owns recover — coalesce; do not neutralize or double-emit.
    if (recoverPending()) {
      return null;
    }

    if (ambient) {
      for (let i = 0; i < 3; i++) {
        const committed = this.tryCommitAmbientErrorRecover(
          conversationId,
          message,
        );
        if (committed === "ok") {
          return this.recoverActionIfStillRunnable(conversationId, action);
        }
        if (committed === "exists") return null;
      }
      // tryCommit may have observed a concurrent pause — do not unlock-wipe
      // mid-confirm/fix state on an already-halted session.
      if (!this.sessionStillErrorRecoverable(conversationId)) {
        return null;
      }
      if (recoverPending()) {
        return null;
      }
      // Soft-reset txns failed (lock or stamp). Never full-neutralize — that wiped
      // mid-confirm confirm_left after transient tryCommit lock failures.
      // Column-only disarm so leftover chain_pending cannot phantom-E3.
      try {
        this.store.clearChainPending(conversationId);
      } catch {
        /* fall through to emit */
      }
    }

    if (!this.sessionStillErrorRecoverable(conversationId)) {
      return null;
    }

    // Peer may have claimed recover during unlocked disarm — do not emit over it.
    const emitted = this.emitRecoverAfterFailedClaim(conversationId, action, {
      ambientSoftReset: ambient,
    });
    if (!emitted) return null;
    // Match tryCommit: drop stamped recover if pause won after the write.
    return this.recoverActionIfStillRunnable(conversationId, emitted);
  }

  /** After a successful compensate write, drop recover if session paused mid-flight. */
  private recoverActionIfStillRunnable(
    conversationId: string,
    action: FollowupAction,
  ): FollowupAction | null {
    if (this.sessionStillErrorRecoverable(conversationId)) {
      return action;
    }
    this.clearRecoverPendingBestEffort(conversationId);
    return null;
  }

  private sessionStillErrorRecoverable(conversationId: string): boolean {
    try {
      const s = this.store.getSession(conversationId);
      return !!s && this.sessionErrorRecoverable(s);
    } catch {
      return false;
    }
  }

  /**
   * Compensating emit after claim failure: never overwrite a peer recover pending.
   * Ambient: soft-reset under the same lock before stamp (resume mid-fix /
   * preserve mid-confirm). Never unlocked soft-reset on the legacy fallback.
   * If exclusiveWrite is unavailable, fall back to legacy {@link emit} only when
   * no recover pending is visible and a recover row was stamped.
   */
  private emitRecoverAfterFailedClaim(
    conversationId: string,
    action: FollowupAction,
    opts?: { ambientSoftReset?: boolean },
  ): FollowupAction | null {
    const ambientSoftReset = opts?.ambientSoftReset === true;
    try {
      return this.store.exclusiveWrite(() => {
        const session = this.store.getSession(conversationId);
        if (!session || !this.sessionErrorRecoverable(session)) {
          return { commit: false, value: null };
        }
        const pending =
          this.store.getReviewChain(conversationId)?.pending_followup?.trim() ??
          "";
        if (isRecoverFollowupMessage(pending)) {
          return { commit: false, value: null };
        }
        if (ambientSoftReset) {
          this.applySoftResetAmbientChainForErrorRecover(conversationId);
        }
        this.store.savePendingFollowup(conversationId, action.message, {
          armChain: false,
        });
        const live =
          this.store.getReviewChain(conversationId)?.pending_followup?.trim() ??
          "";
        // Under lock, require a stamped recover row — silent savePending no-op
        // must not return action (two compensators could both "win").
        if (!isRecoverFollowupMessage(live)) {
          return { commit: false, value: null };
        }
        // armChain=false does not clear a leftover fix chain_pending=1 → phantom E3.
        this.store.clearChainPending(conversationId);
        return { commit: true, value: action };
      });
    } catch {
      if (!this.sessionStillErrorRecoverable(conversationId)) {
        return null;
      }
      try {
        const pending =
          this.store.getReviewChain(conversationId)?.pending_followup?.trim() ??
          "";
        if (isRecoverFollowupMessage(pending)) {
          return null;
        }
      } catch {
        /* fall through to legacy emit */
      }
      // Legacy path: never unlocked soft-reset (confirm/fix pending desync).
      this.emit(conversationId, action);
      try {
        this.store.clearChainPending(conversationId);
      } catch {
        /* best-effort */
      }
      // Must own a stamped recover row. Returning action after a failed
      // savePending (lock storm) double-injects with a claimer that still
      // holds the window and will CAS-emit after debounce.
      try {
        const live =
          this.store.getReviewChain(conversationId)?.pending_followup?.trim() ??
          "";
        if (isRecoverFollowupMessage(live)) {
          return action;
        }
      } catch {
        /* ignore */
      }
      return null;
    }
  }

  /**
   * Ambient error recover write: soft-reset + recover pending under one
   * exclusiveWrite. "exists" = peer already claimed recover (do not overwrite).
   */
  private tryCommitAmbientErrorRecover(
    conversationId: string,
    message: string,
  ): "ok" | "exists" | "failed" {
    try {
      return this.store.exclusiveWrite(() => {
        const session = this.store.getSession(conversationId);
        if (!session || !this.sessionErrorRecoverable(session)) {
          return { commit: false, value: "failed" as const };
        }
        const pending =
          this.store.getReviewChain(conversationId)?.pending_followup?.trim() ??
          "";
        if (isRecoverFollowupMessage(pending)) {
          return { commit: false, value: "exists" as const };
        }
        this.applySoftResetAmbientChainForErrorRecover(conversationId);
        this.store.savePendingFollowup(conversationId, message, {
          armChain: false,
        });
        // savePending may no-op (missing session / blank). Do not report ok or
        // commit a soft-reset that left nothing redeliverable.
        const live =
          this.store.getReviewChain(conversationId)?.pending_followup?.trim() ??
          "";
        const stamp =
          this.store.getReviewChain(conversationId)?.pending_followup_at ?? "";
        if (!stamp || !isRecoverFollowupMessage(live)) {
          return { commit: false, value: "failed" as const };
        }
        return { commit: true, value: "ok" as const };
      });
    } catch {
      return "failed";
    }
  }

  /**
   * Ambient/planning error recover: drop confirm/pending arming so recover
   * (armChain=false) cannot leave chain_pending=1 → phantom E3.
   *
   * Call only under exclusiveWrite (with savePendingFollowup). Compensate must
   * not call this unlocked: clearing undelivered confirm/fix pending while
   * confirm_left is already post-decrement desyncs the next E4 lens.
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
    // Never clear a live recover claim (unlocked compensate / TOCTOU defense).
    if (isRecoverFollowupMessage(chain.pending_followup?.trim() ?? "")) {
      return;
    }
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
    this.store.softResetAmbientChainUnlessRecover(conversationId, {
      confirm_left: atE5 || midConfirm
        ? chain.confirm_left
        : readyForE3 && rounds > 0
          ? rounds
          : null,
      item_confirm_complete: atE5 ? chain.item_confirm_complete : 0,
      chain_pending: 0,
      // Preserve an in-flight edit marker (E2 wins over E4); else force only for mid-fix.
      code_edited: resumeFix || chain.code_edited === 1 ? 1 : 0,
    });
  }

  /** Shared with inferPendingKind — locale templates must keep these prefixes. */
  private isFixFollowupMessage(message: string): boolean {
    const m = message.trim();
    return m.startsWith("Review fix") || m.startsWith("自审修复");
  }

  /** Mid-confirm or E5-ready — must not phantom-arm code_edited over E4/E5. */
  private isMidConfirmOrE5(
    chain: { confirm_left: number | null; item_confirm_complete: number } | null | undefined,
  ): boolean {
    if (!chain) return false;
    if (chain.confirm_left !== null && chain.confirm_left > 0) return true;
    return (
      chain.confirm_left === 0 ||
      (chain.item_confirm_complete === 1 && chain.confirm_left === null)
    );
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
    if (!parsed?.checklist) return null;
    const reviewingId = this.resolveReviewingItemId(chain, parsed.checklist);
    const currentItem =
      (reviewingId &&
        parsed.checklist.items.find((i) => i.id === reviewingId)) ||
      parsed.currentItem;
    if (!currentItem) return null;

    const trustRoot = this.trustedProjectRoot();
    const reportPath =
      this.config.verifyReportPath ??
      defaultVerifyReportPath(trustRoot ?? "");
    const checklistPath = session.checklist_path || "";
    const evalResult = evaluateVerifyReport({
      enabled: this.config.verifyEnabled,
      commands: this.config.verifyCommands,
      reportPath,
      currentItem,
      checklistPath,
      projectRoot: trustRoot ?? undefined,
    });

    if (evalResult.outcome === "skip") {
      // Soft evidence + advance/done in one write — never arm E5 first.
      return this.e0DirectAdvance(session, reportPath, currentItem.id, {
        kind: "soft",
      });
    }

    if (evalResult.outcome === "pass") {
      // Required verify already passed — advance in one write. Do NOT arm at-E5
      // first: a crash between arm and e5Gate would leave stranded at-E5, and a
      // later skip-configured stop could advance without soft evidence.
      return this.e0DirectAdvance(session, reportPath, currentItem.id, {
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
    // E5b advance keeps chain_pending=0; clear stray pending if any (fail→fixed→pass).
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
      if (!refreshed?.checklist) {
        return { commit: false, value: null };
      }
      const reviewingId = this.resolveReviewingItemId(
        fresh,
        refreshed.checklist,
        expectedItemId,
      );
      const targets = resolveAdvanceTargets(refreshed.checklist, reviewingId);
      // Soft/verified E0 still requires the expected item to be the one we advance.
      if (!targets.current || targets.current.id !== expectedItemId) {
        return { commit: false, value: null };
      }
      if (evidence.kind === "soft") {
        if (
          !hasNoCodeCompletionEvidence({
            reportPath,
            currentItemId: targets.current.id,
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
          currentItem: targets.current,
          checklistPath: lockedChecklistPath,
          projectRoot: trustRoot ?? undefined,
        });
        if (lockedEval.outcome !== "pass") {
          return { commit: false, value: null };
        }
      }

      if (targets.unchecked <= 0 && !targets.current) {
        return { commit: false, value: null };
      }
      const out = this.renderAdvanceOrDone(targets);
      const isAdvance = out.kind === "advance";
      const chainReset = this.reviewChainResetFields();

      if (isAdvance) {
        this.store.upsertSession({
          conversation_id: cid,
          project_root: lockedSession.project_root,
          code_root: lockedSession.code_root,
          error_count: 0,
          idle_stop_count: 0,
          last_error: null,
        });
        // chain_pending stays 0 (same as E5b advance). Soft/verified E0
        // advance has no product diff to confirm; leaving pending=1 would force
        // E3 on the next no-code item and skip E0 soft evidence.
        this.store.updateReviewChain(cid, {
          ...chainReset,
          // Stick the *next* item immediately so premature `[x]` before the
          // first product edit cannot retarget via firstUnchecked.
          reviewing_item_id: targets.next?.id ?? null,
          pending_followup: out.message,
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
          pending_followup: out.message,
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

  private e5Gate(session: SessionRow, chain: ReviewChainRow): FollowupAction | null {
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
      const checklistMd = parsed.checklist;
      const reviewingId = this.resolveReviewingItemId(chain, checklistMd);
      currentItem =
        (reviewingId &&
          checklistMd.items.find((i) => i.id === reviewingId)) ||
        parsed.currentItem;
    }

    // No open unchecked rows: still allow done via sticky reviewing item when present.
    // Otherwise verifyEnabled + required cmds treat currentItem=null as fail and
    // loop verify_fix forever instead of emitting done.
    if (unchecked === 0) {
      return this.e5bAdvance(session, {
        unchecked: 0,
        next: currentItem,
        verifiedPass: false,
      });
    }
    // Defensive: countUnchecked>0 must yield a resolvable item (first or sticky).
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
            // Do not require empty sticky: orphan/stale reviewing_item_id must
            // not keep E5c fail looping when the checklist is fully checked.
            return { commit: false, value: null };
          }
          const reviewingId = this.resolveReviewingItemId(
            fresh,
            locked.checklist,
          );
          const nextItem =
            (reviewingId &&
              locked.checklist?.items.find((i) => i.id === reviewingId)) ||
            locked.currentItem;
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
    const chainReset = this.reviewChainResetFields();

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
      let targets: ReturnType<typeof resolveAdvanceTargets> | null = null;
      const path = lockedSession.checklist_path?.trim() ?? "";
      const onChecklistPath =
        isChecklistExecuting(lockedSession) && path.length > 0;
      if (onChecklistPath) {
        const refreshed = this.parseSessionChecklist(lockedSession);
        if (!refreshed?.checklist) {
          return { commit: false, value: null };
        }
        const reviewingId = this.resolveReviewingItemId(
          fresh,
          refreshed.checklist,
          checklist.next?.id,
        );
        targets = resolveAdvanceTargets(refreshed.checklist, reviewingId);
        unchecked = targets.unchecked;
        next = targets.current;
      } else {
        unchecked = 0;
        next = null;
        targets = null;
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
        // verifiedPass foresaw checklist.next (sticky reviewing from e5Gate).
        const foresawId = checklist.next?.id;
        const activeId = targets?.current?.id ?? next?.id;
        if (
          checklist.verifiedPass &&
          foresawId &&
          activeId !== foresawId
        ) {
          return { commit: false, value: null };
        }
      }

      const resolved =
        targets ??
        ({
          current: next,
          next: null as ChecklistItem | null,
          unchecked,
        } as const);
      // nextId/Title = item after the reviewing item (sticky), not bare secondUnchecked.
      const action = this.renderAdvanceOrDone(resolved);
      const isAdvance = action.kind === "advance";

      if (isAdvance) {
        this.store.upsertSession({
          conversation_id: cid,
          project_root: session.project_root,
          code_root: session.code_root,
          error_count: 0,
          idle_stop_count: 0,
          last_error: null,
        });
        // chain_pending=0 (same as E0 soft advance): product edits on the next
        // item still arm via afterFileEdit → code_edited. Leaving pending=1
        // forced E3 confirm on docs-only / ignore-only turns (phantom confirm).
        this.store.updateReviewChain(cid, {
          ...chainReset,
          // Stick the *next* item immediately so premature `[x]` before the
          // first product edit cannot retarget via firstUnchecked.
          reviewing_item_id: resolved.next?.id ?? null,
          pending_followup: action.message,
          pending_followup_at: new Date().toISOString(),
          pending_redeliver_at: null,
          chain_pending: 0,
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
          pending_followup: action.message,
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
