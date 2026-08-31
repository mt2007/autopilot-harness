import {
  countUnchecked,
  firstUnchecked,
  parseChecklist,
  secondUnchecked,
  type ChecklistItem,
} from "./checklist-md.js";
import { isRealpathInsideProject, normalizeProjectRoot } from "./project-path.js";
import { getLens, type ConfirmLens } from "./review-lenses.js";
import type { Phase, ReviewChainRow, SessionRow, StateStore } from "./state-store.js";
import { isSafeTrackSlug } from "./track-slug.js";
import {
  automationFollowupPresent,
  followupInFlight,
  pendingRedeliverAllowed,
  readTranscriptTail,
} from "./transcript-followup.js";
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
  | "recover_planning"
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
      // cleared). Keep E8 recovery: after clearChainPending mid-fix, fix_round>0
      // + loopCount still reaches E3.
      const inChain =
        chain.chain_pending === 1 ||
        (input.loopCount > 0 && chain.fix_round > 0);
      if (
        chain.confirm_left === null &&
        chain.item_confirm_complete === 0 &&
        inChain
      ) {
        return this.e3ArmConfirm(session, chain);
      }
      // E0
      return null;
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
    if (m.startsWith("Review fix") || m.startsWith("自审修复")) return "review.fix";
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
      this.store.savePendingFollowup(conversationId, action.message);
    } catch {
      // Hook can still deliver once; pending redelivery is best-effort.
    }
    return action;
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
      return this.emit(session.conversation_id, {
        kind: "recover",
        message: this.render(recoverKind, {}),
        loop: true,
      });
    }
    return null;
  }

  /** True when a stop may still advance the review chain (re-check under write lock). */
  private sessionRunnable(conversationId: string): boolean {
    const s = this.store.getSession(conversationId);
    return (
      !!s && s.armed === 1 && s.phase === "executing" && s.paused === 0
    );
  }

  /** Error/aborted stop may inject recover (planning or armed executing). */
  private sessionErrorRecoverable(session: SessionRow): boolean {
    if (session.paused !== 0) return false;
    if (session.phase === "planning") return true;
    return session.phase === "executing" && session.armed === 1;
  }

  private recoverKindForPhase(phase: Phase): FollowupKind {
    return phase === "planning" ? "recover_planning" : "recover";
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
          sess.armed !== 1 ||
          sess.phase !== "executing" ||
          sess.paused !== 0
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
        lockedSession.armed !== 1 ||
        lockedSession.phase !== "executing" ||
        lockedSession.paused !== 0
      ) {
        return { commit: false, value: null };
      }

      // Refresh checklist under the lock — pass-path callers may hold a stale
      // unchecked/next from before BEGIN IMMEDIATE (same class as E5c fail).
      let unchecked = checklist.unchecked;
      let next = checklist.next;
      let following: ChecklistItem | null = null;
      const path = lockedSession.checklist_path;
      if (path) {
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
      if (session.checklist_path) {
        // Containment uses store root — ignore poisoned session.project_root.
        const root = normalizeProjectRoot(store.projectRoot);
        if (root && isRealpathInsideProject(root, session.checklist_path)) {
          try {
            hasUnchecked =
              countUnchecked(
                parseChecklist(session.checklist_path, {
                  projectRoot: root,
                }),
              ) > 0;
          } catch {
            // Missing/unsafe checklist — do not re-arm (armed=0).
            hasUnchecked = false;
          }
        }
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
