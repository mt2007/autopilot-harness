// ../i18n/locales/en.json
var en_default = {
  preferred_name: "Autopilot",
  cli: {
    help: "Autopilot Harness \u2014 Planning \u2192 Executing agent harness"
  },
  triggers: {
    on: ["Autopilot ON", "Enable autopilot"],
    run: ["Autopilot RUN", "Start execution"],
    off: ["Autopilot OFF", "Disable autopilot"],
    resume: ["Autopilot RESUME"],
    replan: ["Autopilot REPLAN"],
    resume_review: ["Resume review"]
  },
  skill: {
    autopilot_on: {
      description: "Start Planning \u2014 discuss what to build"
    },
    autopilot_run: {
      description: "Start Executing \u2014 run checklist"
    },
    autopilot_off: {
      description: "Pause Autopilot"
    },
    autopilot_resume: {
      description: "Resume session (can claim a track into this chat)"
    },
    autopilot_replan: {
      description: "Change the plan"
    }
  },
  followup: {
    review: {
      fix: 'Review fix round {round} (no hard cap; confirm needs {total} consecutive no-edit rounds). Code changed this turn. Defect-first self-review and fix now: 1) inspect full diff via git diff / git status; 2) check correctness, null/boundaries, concurrency, security, regression, missing tests; 3) CRITICAL/HIGH must fix, MEDIUM preferably; 4) run relevant tests; 5) briefly state what you reviewed and changed (or "self-review clean"). Do not commit/push. If no further code changes, next stop enters multi-lens confirm.',
      confirm: 'Review confirm {n}/{total} (session round {sessionRound}; consecutive no-edit confirms, counted on the fix-round counter). Lens \u3010{lensTitle}\u3011 (multi-lens confirm, not the same checklist again). {lensFocus} Previous turn had no further code edits. Recheck under this lens only: 1) git diff / git status \u2014 no new edits vs prior turn (or only already-reviewed edits); 2) dig into this lens only; ban vague "fully rechecked, all good"; 3) CRITICAL/HIGH under this lens must fix; MEDIUM preferably; 4) if you edit, fix and run related tests; 5) close with: "Lens ({lensTitle}): self-review clean" or a short list of fixes; if clean, do not edit further. Do not commit/push.',
      confirm_final: 'Review confirm {n}/{total} (session round {sessionRound}; consecutive no-edit confirms, counted on the fix-round counter). Lens \u3010{lensTitle}\u3011 (multi-lens confirm, not the same checklist again). {lensFocus} Previous turn had no further code edits. Recheck under this lens only: 1) git diff / git status \u2014 no new edits vs prior turn (or only already-reviewed edits); 2) dig into this lens only; ban vague "fully rechecked, all good"; 3) read-only: record CRITICAL/HIGH/missing tests \u2014 do not change code, add tests, or commit; if you already edited, accept returning to a fix round; never commit this turn; 4) do not run commands that mutate the repo; 5) close with: "Lens ({lensTitle}): self-review clean" or list issues (no fixes); if clean, do not edit further. Do not commit/push. Handoff (commit) and next checklist item are handled by Advance/Done after the chain \u2014 not this turn.'
    },
    advance: "Advance checklist: confirm chain passed cleanly (confirm rounds do not commit). First mark the current item [x] in checklist.md. Then, if the working tree still has uncommitted changes for this item (including checklist.md when plans/ is committed), local conventional commit only: git status/diff \u2192 stage only this checklist item's paths; never git add -A, never stage .env/secrets/.autopilot runtime; one conventional commit; no push/--no-verify/amend/force unless the user explicitly asks. If already clean after marking, skip commit. Then implement next: {nextId} \u2014 {nextTitle}.",
    done: "All checklist items done. Confirm chain passed (confirm rounds do not commit). Mark the last item [x]. If the working tree still has uncommitted changes for this item (including checklist.md when plans/ is committed), local conventional commit only (never stage .env/secrets/.autopilot runtime; no push unless the user asks); if clean, just confirm briefly. Phase is done.",
    recover: "Recover: the previous turn ended with an error. Continue the current task.",
    recover_planning: "Recover: the previous turn ended with an error. Continue planning; do not RUN or write product code.",
    recover_ambient: "Recover: the previous turn ended with an error. Continue your current work; Autopilot RUN is not active.",
    review_complete: "Review complete. All {total} confirm rounds passed; the review chain has ended. If the working tree still has uncommitted changes from this session, local commit only per the safe checklist (never stage .env/secrets/.autopilot runtime; no push unless the user asks); if clean, briefly confirm only.",
    stuck: "Stuck: no progress for several stops. Change strategy or send Autopilot RESUME after fixing.",
    verify_fix: "Verify failed ({reason}). Fix verify commands and rewrite verify-last.json; do not advance.",
    track_pick: "Select a plan by number or slug."
  },
  error: {
    one_executor_busy: "Another session is already executing ({track}). OFF or wait, then retry.",
    on_while_executing: "Autopilot is executing. Send Autopilot OFF, REPLAN, or RESUME before ON."
  },
  lens: {
    "scope-correctness": {
      title: "Correctness & invariants",
      focus: "Focus on logic, state-machine/flow coherence, pre/post-conditions and business invariants; do not turn this round into a null/concurrency/security/tests mix."
    },
    boundaries: {
      title: "Nulls, boundaries & error paths",
      focus: "Focus on null/empty collections, bounds, illegal input, timeout/failure returns, idempotency and safe retries; do not repeat the prior pure-logic walkthrough."
    },
    concurrency: {
      title: "Concurrency, races & partial failure",
      focus: "Focus on multi-thread/multi-instance, locks/leases, races, transaction boundaries, dirty state after mid-failure and compensation; do not repeat null or security checklists."
    },
    security: {
      title: "Security & trust boundaries",
      focus: "Focus on authz/privilege, injection, sensitive data leaks, secrets/config, untrusted input, and over-exposed errors; do not make this another correctness re-read."
    },
    "tests-regression": {
      title: "Test gaps & regression",
      focus: "Focus on missing critical-path tests, weak asserts, contract drift vs existing behavior/APIs, and likely regression points; read-only \u2014 record gaps, do not change code to add tests; do not vaguely claim full coverage."
    }
  }
};

// ../i18n/locales/zh-CN.json
var zh_CN_default = {
  preferred_name: "Autopilot",
  cli: {
    help: "Autopilot Harness \u2014 \u4E24\u9636\u6BB5 Agent \u5916\u9AA8\u9ABC\uFF1A\u89C4\u5212 \u2192 \u6267\u884C"
  },
  triggers: {
    on: ["Autopilot ON", "\u5F00\u542F\u81EA\u52A8\u9A7E\u9A76"],
    run: ["Autopilot RUN", "\u5F00\u59CB\u6267\u884C"],
    off: ["Autopilot OFF", "\u5173\u95ED\u81EA\u52A8\u9A7E\u9A76"],
    resume: ["Autopilot RESUME", "\u7EE7\u7EED\u6267\u884C"],
    replan: ["Autopilot REPLAN", "\u4FEE\u6539\u65B9\u6848"],
    resume_review: ["\u7EE7\u7EED\u81EA\u5BA1", "Resume review"]
  },
  skill: {
    autopilot_on: {
      description: "\u5F00\u59CB\u89C4\u5212 \u2014 \u8BA8\u8BBA\u8981\u505A\u4EC0\u4E48"
    },
    autopilot_run: {
      description: "\u5F00\u59CB\u6267\u884C \u2014 \u8DD1 checklist"
    },
    autopilot_off: {
      description: "\u6682\u505C Autopilot"
    },
    autopilot_resume: {
      description: "\u6062\u590D\u4F1A\u8BDD\uFF08\u53EF\u8DE8\u804A\u5929\u8BA4\u9886 track\uFF09"
    },
    autopilot_replan: {
      description: "\u4FEE\u6539\u65B9\u6848"
    }
  },
  followup: {
    review: {
      fix: "\u81EA\u5BA1\u4FEE\u590D\u7B2C {round} \u8F6E\uFF08\u65E0\u786C\u9876\uFF1B\u786E\u8BA4\u9636\u6BB5\u9700\u8FDE\u7EED {total} \u8F6E\u65E0\u6539\u52A8\uFF09\u3002\u672C\u8F6E\u6539\u8FC7\u4EE3\u7801\u3002\u8BF7\u7ACB\u523B\u5BF9\u672C\u8F6E diff \u505A\u7F3A\u9677\u4F18\u5148\u81EA\u5BA1\u5E76\u76F4\u63A5\u4FEE\u590D\uFF1A1) \u7528 git diff / git status \u770B\u5B8C\u6574\u6539\u52A8\uFF1B2) \u67E5\u6B63\u786E\u6027\u3001\u7A7A\u503C/\u8FB9\u754C\u3001\u5E76\u53D1\u3001\u5B89\u5168\u3001\u56DE\u5F52\u3001\u7F3A\u6D4B\uFF1B3) CRITICAL/HIGH \u5FC5\u987B\u6539\uFF0CMEDIUM \u5C3D\u91CF\u6539\uFF1B4) \u8DD1\u76F8\u5173\u6D4B\u8BD5\uFF1B5) \u4FEE\u5B8C\u540E\u7B80\u77ED\u8BF4\u660E\u5BA1\u4E86\u4EC0\u4E48\u3001\u6539\u4E86\u4EC0\u4E48\uFF08\u6216\u300C\u81EA\u5BA1\u65E0\u95EE\u9898\u300D\uFF09\u3002\u4E0D\u8981 commit/push\u3002\u82E5\u672C\u8F6E\u672A\u518D\u6539\u4EE3\u7801\uFF0C\u4E0B\u4E00\u8F6E\u4F1A\u8FDB\u5165\u786E\u8BA4\u5BA1\u67E5\uFF08\u6BCF\u8F6E\u4E0D\u540C\u5BA1\u67E5\u89D2\u5EA6\uFF09\u3002",
      confirm: "\u81EA\u5BA1\u786E\u8BA4 {n}/{total}\uFF08\u4F1A\u8BDD\u7B2C {sessionRound} \u8F6E\uFF1B\u8FDE\u7EED\u65E0\u6539\u52A8\u786E\u8BA4\uFF0C\u8BA1\u5165\u4FEE\u590D\u8F6E\u8BA1\u6570\uFF09\u3002\u672C\u8F6E\u5BA1\u67E5\u89D2\u5EA6\uFF1A\u3010{lensTitle}\u3011\uFF08\u901A\u7528\u591A\u89D2\u5EA6\u786E\u8BA4\uFF0C\u975E\u540C\u4E00\u6E05\u5355\u590D\u8BFB\uFF09\u3002{lensFocus} \u4E0A\u4E00\u8F6E\u672A\u518D\u6539\u4EE3\u7801\u3002\u8BF7\u6309\u672C\u89D2\u5EA6\u590D\u6838\uFF1A1) \u7528 git diff / git status \u786E\u8BA4\u76F8\u5BF9\u4E0A\u4E00\u8F6E\u65E0\u65B0\u6539\u52A8\u6216\u4EC5\u6709\u5DF2\u5BA1\u6539\u52A8\uFF1B2) \u53EA\u6DF1\u6316\u672C\u89D2\u5EA6\uFF1B\u7981\u6B62\u7528\u300C\u5168\u9762\u590D\u6838\u65E0\u95EE\u9898\u300D\u6577\u884D\uFF1B3) \u672C\u89D2\u5EA6\u82E5\u6709 CRITICAL/HIGH \u5FC5\u987B\u6539\uFF1BMEDIUM \u5C3D\u91CF\u6539\uFF1B4) \u6709\u6539\u52A8\u5219\u76F4\u63A5\u4FEE\u590D\u5E76\u8DD1\u76F8\u5173\u6D4B\u8BD5\uFF1B5) \u7ED3\u5C3E\u5199\uFF1A\u300C\u672C\u89D2\u5EA6\uFF08{lensTitle}\uFF09\uFF1A\u81EA\u5BA1\u65E0\u95EE\u9898\u300D\u6216\u7B80\u8FF0\u5DF2\u4FEE\u9879\uFF1B\u65E0\u95EE\u9898\u5219\u4E0D\u8981\u518D\u6539\u4EE3\u7801\u3002\u4E0D\u8981 commit/push\u3002",
      confirm_final: "\u81EA\u5BA1\u786E\u8BA4 {n}/{total}\uFF08\u4F1A\u8BDD\u7B2C {sessionRound} \u8F6E\uFF1B\u8FDE\u7EED\u65E0\u6539\u52A8\u786E\u8BA4\uFF0C\u8BA1\u5165\u4FEE\u590D\u8F6E\u8BA1\u6570\uFF09\u3002\u672C\u8F6E\u5BA1\u67E5\u89D2\u5EA6\uFF1A\u3010{lensTitle}\u3011\uFF08\u901A\u7528\u591A\u89D2\u5EA6\u786E\u8BA4\uFF0C\u975E\u540C\u4E00\u6E05\u5355\u590D\u8BFB\uFF09\u3002{lensFocus} \u4E0A\u4E00\u8F6E\u672A\u518D\u6539\u4EE3\u7801\u3002\u8BF7\u6309\u672C\u89D2\u5EA6\u590D\u6838\uFF1A1) \u7528 git diff / git status \u786E\u8BA4\u76F8\u5BF9\u4E0A\u4E00\u8F6E\u65E0\u65B0\u6539\u52A8\u6216\u4EC5\u6709\u5DF2\u5BA1\u6539\u52A8\uFF1B2) \u53EA\u6DF1\u6316\u672C\u89D2\u5EA6\uFF1B\u7981\u6B62\u7528\u300C\u5168\u9762\u590D\u6838\u65E0\u95EE\u9898\u300D\u6577\u884D\uFF1B3) \u672C\u8F6E\u53EA\u8BFB\uFF1A\u53D1\u73B0 CRITICAL/HIGH/\u7F3A\u6D4B\u53EA\u8BB0\u5F55\uFF0C\u4E0D\u8981\u6539\u4EE3\u7801\u3001\u4E0D\u8981\u8865\u6D4B\u3001\u4E0D\u8981 commit\uFF1B\u82E5\u5DF2\u7ECF\u6539\u4E86\u6587\u4EF6\uFF0C\u63A5\u53D7\u56DE\u5230\u4FEE\u590D\u8F6E\uFF0C\u672C\u8F6E\u7EDD\u4E0D commit\uFF1B4) \u4E0D\u8981\u8DD1\u4F1A\u6539\u52A8\u4ED3\u5E93\u7684\u547D\u4EE4\uFF1B5) \u7ED3\u5C3E\u5199\uFF1A\u300C\u672C\u89D2\u5EA6\uFF08{lensTitle}\uFF09\uFF1A\u81EA\u5BA1\u65E0\u95EE\u9898\u300D\u6216\u5217\u51FA\u95EE\u9898\uFF08\u4E0D\u4FEE\u590D\uFF09\uFF1B\u65E0\u95EE\u9898\u5219\u4E0D\u8981\u518D\u6539\u4EE3\u7801\u3002\u4E0D\u8981 commit/push\u3002\u4EA4\u5377\uFF08commit\uFF09\u4E0E\u4E0B\u4E00\u9879\u7531\u94FE\u7ED3\u675F\u540E\u7684\u63A8\u8FDB/\u5B8C\u6210\u5904\u7406\uFF0C\u672C\u8F6E\u4E0D\u505A\u3002"
    },
    advance: "\u63A8\u8FDB\u4E0B\u4E00\u9879\uFF1A\u81EA\u5BA1\u786E\u8BA4\u5DF2\u5E72\u51C0\u901A\u8FC7\uFF08\u786E\u8BA4\u8F6E\u4E0D commit\uFF09\u3002\u5148\u52FE\u9009\u5F53\u524D\u9879 [x]\u3002\u82E5 working tree \u4ECD\u6709\u672C\u9879\u672A\u63D0\u4EA4\u6539\u52A8\uFF08\u542B checklist.md\uFF0C\u4E14 plans/ \u7EB3\u5165\u63D0\u4EA4\u65F6\u4E00\u5E76 stage\uFF09\uFF0C\u6309\u5B89\u5168\u6E05\u5355\u672C\u5730 commit\uFF08\u65E0\u6539\u52A8\u5219\u8DF3\u8FC7\uFF09\uFF1Agit status/diff \u2192 \u53EA stage \u672C checklist \u9879\u76F8\u5173\u8DEF\u5F84\uFF1B\u7981\u6B62 git add -A\u3001stage .env/\u5BC6\u94A5/.autopilot \u8FD0\u884C\u65F6\uFF1B\u4E00\u6B21 conventional commit\uFF1B\u7981\u6B62 push/--no-verify/amend/force\uFF08\u4EC5\u7528\u6237\u660E\u786E\u8981\u6C42\u624D\u53EF push\uFF09\u3002\u52FE\u9009\u540E\u5DF2\u5E72\u51C0\u5219\u8DF3\u8FC7 commit\u3002\u7136\u540E\u5B9E\u73B0\u4E0B\u4E00\u9879\uFF1A{nextId} \u2014 {nextTitle}\u3002",
    done: "\u5168\u90E8\u5B8C\u6210\u3002\u81EA\u5BA1\u786E\u8BA4\u5DF2\u5E72\u51C0\u901A\u8FC7\uFF08\u786E\u8BA4\u8F6E\u4E0D commit\uFF09\u3002\u52FE\u9009\u6700\u540E\u4E00\u9879 [x]\u3002\u82E5 working tree \u4ECD\u6709\u672C\u9879\u672A\u63D0\u4EA4\u6539\u52A8\uFF08\u542B checklist.md\uFF0C\u4E14 plans/ \u7EB3\u5165\u63D0\u4EA4\u65F6\u4E00\u5E76 stage\uFF09\uFF0C\u6309\u5B89\u5168\u6E05\u5355\u672C\u5730 commit\uFF08\u52FF stage .env/\u5BC6\u94A5/.autopilot \u8FD0\u884C\u65F6\uFF1B\u52FF push\uFF0C\u9664\u975E\u7528\u6237\u660E\u786E\u8981\u6C42\uFF09\uFF1B\u5DF2\u5E72\u51C0\u5219\u53EA\u7B80\u77ED\u786E\u8BA4\u5373\u53EF\u3002\u7136\u540E\u505C\u6B62\u3002",
    recover: "\u6062\u590D\uFF1A\u4E0A\u4E00\u56DE\u5408\u51FA\u9519\u3002\u7EE7\u7EED\u5F53\u524D\u4EFB\u52A1\u3002",
    recover_planning: "\u6062\u590D\uFF1A\u4E0A\u4E00\u56DE\u5408\u51FA\u9519\u3002\u7EE7\u7EED\u5F53\u524D\u89C4\u5212\uFF0C\u4E0D\u8981 RUN \u6216\u5199\u4EA7\u54C1\u4EE3\u7801\u3002",
    recover_ambient: "\u6062\u590D\uFF1A\u4E0A\u4E00\u56DE\u5408\u51FA\u9519\u3002\u7EE7\u7EED\u5F53\u524D\u4EFB\u52A1\uFF08\u672A\u5728\u6267\u884C checklist\uFF09\u3002",
    review_complete: "\u81EA\u5BA1\u5B8C\u6210\u3002\u8FDE\u7EED {total} \u8F6E\u786E\u8BA4\u5DF2\u901A\u8FC7\uFF0C\u81EA\u5BA1\u94FE\u5DF2\u7ED3\u675F\u3002\u82E5\u5DE5\u4F5C\u533A\u4ECD\u6709\u672C\u4F1A\u8BDD\u672A\u63D0\u4EA4\u6539\u52A8\uFF0C\u6309\u5B89\u5168\u6E05\u5355\u672C\u5730 commit\uFF08\u52FF stage .env/\u5BC6\u94A5/.autopilot \u8FD0\u884C\u65F6\uFF1B\u52FF push\uFF0C\u9664\u975E\u7528\u6237\u660E\u786E\u8981\u6C42\uFF09\uFF1B\u5DF2\u5E72\u51C0\u5219\u53EA\u7B80\u77ED\u786E\u8BA4\u5373\u53EF\u3002",
    stuck: "\u5361\u4F4F\uFF1A\u8FDE\u7EED\u591A\u8F6E\u65E0\u8FDB\u5C55\u3002\u8BF7\u6362\u7B56\u7565\uFF0C\u6216\u4FEE\u597D\u540E\u53D1\u9001 Autopilot RESUME\u3002",
    verify_fix: "\u6821\u9A8C\u5931\u8D25\uFF08{reason}\uFF09\u3002\u8BF7\u4FEE\u590D verify \u547D\u4EE4\u5E76\u91CD\u5199 verify-last.json\uFF1B\u4E0D\u8981\u63A8\u8FDB\u3002",
    track_pick: "\u8BF7\u7528\u6570\u5B57\u6216 slug \u9009\u62E9\u8981\u6267\u884C\u7684 plan\u3002"
  },
  error: {
    one_executor_busy: "\u5DF2\u6709\u5176\u4ED6\u4F1A\u8BDD\u5728\u6267\u884C\uFF08{track}\uFF09\u3002\u8BF7\u5148 OFF \u6216\u7B49\u5F85\u540E\u518D\u8BD5\u3002",
    on_while_executing: "\u5F53\u524D\u6B63\u5728\u6267\u884C\u3002\u8BF7\u5148\u53D1\u9001 Autopilot OFF\u3001REPLAN \u6216 RESUME\uFF0C\u518D ON\u3002"
  },
  lens: {
    "scope-correctness": {
      title: "\u6B63\u786E\u6027\u4E0E\u4E0D\u53D8\u91CF",
      focus: "\u805A\u7126\u903B\u8F91\u5BF9\u9519\u3001\u72B6\u6001\u673A/\u6D41\u7A0B\u662F\u5426\u81EA\u6D3D\u3001\u524D\u540E\u6761\u4EF6\u4E0E\u4E1A\u52A1\u4E0D\u53D8\u91CF\u662F\u5426\u88AB\u7834\u574F\uFF1B\u4E0D\u8981\u628A\u672C\u8F6E\u505A\u6210\u7A7A\u503C/\u5E76\u53D1/\u5B89\u5168/\u6D4B\u8BD5\u7684\u5927\u6742\u70E9\u3002"
    },
    boundaries: {
      title: "\u7A7A\u503C\u3001\u8FB9\u754C\u4E0E\u9519\u8BEF\u8DEF\u5F84",
      focus: "\u805A\u7126 null/\u7A7A\u96C6\u5408\u3001\u4E0A\u4E0B\u754C\u3001\u975E\u6CD5\u8F93\u5165\u3001\u8D85\u65F6/\u5931\u8D25\u8FD4\u56DE\u3001\u5E42\u7B49\u4E0E\u91CD\u8BD5\u662F\u5426\u5B89\u5168\uFF1B\u4E0D\u8981\u91CD\u590D\u4E0A\u4E00\u8F6E\u7684\u7EAF\u903B\u8F91\u8D70\u67E5\u3002"
    },
    concurrency: {
      title: "\u5E76\u53D1\u3001\u7ADE\u6001\u4E0E\u90E8\u5206\u5931\u8D25",
      focus: "\u805A\u7126\u591A\u7EBF\u7A0B/\u591A\u5B9E\u4F8B\u3001\u9501\u4E0E\u79DF\u7EA6\u3001\u7ADE\u6001\u3001\u4E8B\u52A1\u8FB9\u754C\u3001\u4E2D\u9014\u5931\u8D25\u7559\u4E0B\u7684\u810F\u72B6\u6001\u4E0E\u8865\u507F\uFF1B\u4E0D\u8981\u91CD\u590D\u7A7A\u503C\u6E05\u5355\u6216\u5B89\u5168\u6E05\u5355\u3002"
    },
    security: {
      title: "\u5B89\u5168\u4E0E\u4FE1\u4EFB\u8FB9\u754C",
      focus: "\u805A\u7126\u9274\u6743/\u8D8A\u6743\u3001\u6CE8\u5165\u3001\u654F\u611F\u6570\u636E\u6CC4\u9732\u3001\u5BC6\u94A5\u4E0E\u914D\u7F6E\u3001\u4E0D\u53EF\u4FE1\u8F93\u5165\u3001\u9519\u8BEF\u4FE1\u606F\u662F\u5426\u8FC7\u66DD\uFF1B\u4E0D\u8981\u505A\u6210\u53C8\u4E00\u8F6E\u6B63\u786E\u6027\u590D\u8BFB\u3002"
    },
    "tests-regression": {
      title: "\u6D4B\u8BD5\u7F3A\u53E3\u4E0E\u56DE\u5F52",
      focus: "\u805A\u7126\u5173\u952E\u8DEF\u5F84\u662F\u5426\u7F3A\u6D4B\u3001\u65AD\u8A00\u662F\u5426\u8584\u5F31\u3001\u4E0E\u65E2\u6709\u884C\u4E3A/\u63A5\u53E3\u5951\u7EA6\u662F\u5426\u6F02\u79FB\u3001\u6700\u53EF\u80FD\u7684\u56DE\u5F52\u70B9\uFF1B\u672C\u8F6E\u53EA\u8BFB\u8BB0\u5F55\u7F3A\u53E3\uFF0C\u4E0D\u8981\u4E3A\u8865\u6D4B\u6539\u4EE3\u7801\uFF1B\u4E0D\u8981\u7A7A\u6CDB\u8BF4\u300C\u5DF2\u5168\u9762\u8986\u76D6\u300D\u3002"
    }
  }
};

// ../i18n/src/index.ts
var LOCALES = {
  en: en_default,
  "zh-CN": zh_CN_default
};
function isLocaleCode(code) {
  return code === "en" || code === "zh-CN";
}
function loadLocale(code) {
  if (isLocaleCode(code)) {
    return LOCALES[code];
  }
  return LOCALES.en;
}

// ../core/src/checklist-md.ts
import fs2 from "node:fs";

// ../core/src/project-path.ts
import fs from "node:fs";
import path from "node:path";
function normalizeProjectRoot(projectRoot) {
  if (typeof projectRoot !== "string" || projectRoot.includes("\0")) {
    return null;
  }
  const root = projectRoot.trim();
  return root || null;
}
function isRealpathInsideRoot(realRoot, realTarget) {
  if (realTarget === realRoot) return true;
  const rel = path.relative(realRoot, realTarget);
  return !(rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel));
}
function isRealpathInsideProject(projectRoot, targetPath) {
  if (typeof targetPath !== "string" || targetPath.includes("\0") || !targetPath.trim()) {
    return false;
  }
  const root = normalizeProjectRoot(projectRoot);
  if (!root) return false;
  try {
    const realRoot = fs.realpathSync(root);
    const realTarget = fs.realpathSync(path.resolve(root, targetPath));
    return isRealpathInsideRoot(realRoot, realTarget);
  } catch {
    return false;
  }
}
function isLexicallyInsideProject(projectRoot, targetPath) {
  if (typeof targetPath !== "string" || targetPath.includes("\0") || !targetPath.trim()) {
    return false;
  }
  const root = normalizeProjectRoot(projectRoot);
  if (!root) return false;
  try {
    const absRoot = path.resolve(root);
    const abs = path.resolve(root, targetPath);
    return isRealpathInsideRoot(absRoot, abs);
  } catch {
    return false;
  }
}
var PLANS_DIR_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
function normalizeInProjectPlansDir(projectRoot, plansDir) {
  const root = normalizeProjectRoot(projectRoot);
  if (!root) return null;
  let raw = typeof plansDir === "string" && plansDir.trim() ? plansDir.trim() : "plans";
  raw = raw.replace(/\/+$/, "") || "plans";
  if (path.isAbsolute(raw) || raw.startsWith("~") || raw.includes("\0") || raw.includes("\n") || raw.includes("\r") || raw.includes("\\")) {
    return null;
  }
  const parts = raw.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return null;
  const rel = parts.join("/");
  if (!PLANS_DIR_RE.test(rel)) return null;
  const abs = path.resolve(root, rel);
  if (!isLexicallyInsideProject(root, abs)) return null;
  return rel;
}

// ../core/src/checklist-md.ts
var MAX_CHECKLIST_BYTES = 1048576;
var ITEM_RE = /^-\s*\[([ xX])\]\s*(.+)$/;
var SEPARATOR_RE = /^(.+?)\s*(?:[—–]| - )\s*(.+)$/;
var KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
function slugify(text) {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}
function parseItemLine(line, lineNumber) {
  const m = line.match(ITEM_RE);
  if (!m) return null;
  const checked = m[1].toLowerCase() === "x";
  const body = m[2].trim();
  const sep = body.match(SEPARATOR_RE);
  if (sep) {
    const id = sep[1].trim();
    const title = sep[2].trim();
    return {
      id: KEBAB_RE.test(id) ? id : slugify(id),
      title,
      checked,
      line,
      lineNumber,
      idFromSeparator: true
    };
  }
  return {
    id: slugify(body),
    title: body,
    checked,
    line,
    lineNumber,
    idFromSeparator: false
  };
}
function parseChecklistMarkdown(content, checklistPath) {
  const lines = content.split(/\r?\n/);
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const item = parseItemLine(lines[i], i + 1);
    if (item) items.push(item);
  }
  return { path: checklistPath, items };
}
function parseChecklist(checklistPath, opts) {
  if (!checklistPath || checklistPath.includes("\0")) {
    throw new Error("Invalid checklist path");
  }
  const projectRoot = opts?.projectRoot;
  if (projectRoot !== void 0 && projectRoot !== null) {
    if (typeof projectRoot !== "string" || !normalizeProjectRoot(projectRoot)) {
      throw new Error("Invalid project root");
    }
  }
  const root = typeof projectRoot === "string" ? normalizeProjectRoot(projectRoot) ?? void 0 : void 0;
  const nofollow = typeof fs2.constants.O_NOFOLLOW === "number" ? fs2.constants.O_NOFOLLOW : 0;
  if (nofollow === 0) {
    const st = fs2.lstatSync(checklistPath);
    if (st.isSymbolicLink() || !st.isFile()) {
      throw new Error("Checklist must be a regular file");
    }
  }
  const fd = fs2.openSync(checklistPath, fs2.constants.O_RDONLY | nofollow);
  try {
    const st = fs2.fstatSync(fd);
    if (!st.isFile() || st.size > MAX_CHECKLIST_BYTES) {
      throw new Error("Checklist unreadable or too large");
    }
    const lst = fs2.lstatSync(checklistPath);
    if (lst.isSymbolicLink() || !lst.isFile()) {
      throw new Error("Checklist must be a regular file");
    }
    if (lst.ino !== st.ino || lst.dev !== st.dev) {
      throw new Error("Checklist path changed during open");
    }
    if (root && !isRealpathInsideProject(root, checklistPath)) {
      throw new Error("Checklist outside project");
    }
    const buf = Buffer.alloc(st.size);
    const n = fs2.readSync(fd, buf, 0, st.size, 0);
    const content = buf.subarray(0, n).toString("utf8");
    if (Buffer.byteLength(content, "utf8") > MAX_CHECKLIST_BYTES) {
      throw new Error("Checklist too large");
    }
    return parseChecklistMarkdown(content, checklistPath);
  } finally {
    fs2.closeSync(fd);
  }
}
function countUnchecked(checklist) {
  return checklist.items.filter((i) => !i.checked).length;
}
function firstUnchecked(checklist) {
  return checklist.items.find((i) => !i.checked) ?? null;
}
function secondUnchecked(checklist) {
  let seen = 0;
  for (const item of checklist.items) {
    if (item.checked) continue;
    seen += 1;
    if (seen === 2) return item;
  }
  return null;
}

// ../core/src/verify-report.ts
import fs3 from "node:fs";
import path2 from "node:path";
var MAX_VERIFY_REPORT_BYTES = 1048576;
function readVerifyReport(reportPath, opts) {
  if (!reportPath || reportPath.includes("\0")) return null;
  let root;
  if (opts?.projectRoot !== void 0 && opts?.projectRoot !== null) {
    const n = normalizeProjectRoot(opts.projectRoot);
    if (!n) return null;
    root = n;
  }
  try {
    const nofollow = typeof fs3.constants.O_NOFOLLOW === "number" ? fs3.constants.O_NOFOLLOW : 0;
    if (nofollow === 0) {
      const lst = fs3.lstatSync(reportPath);
      if (lst.isSymbolicLink() || !lst.isFile()) return null;
    }
    const fd = fs3.openSync(reportPath, fs3.constants.O_RDONLY | nofollow);
    try {
      const st = fs3.fstatSync(fd);
      if (!st.isFile() || st.size > MAX_VERIFY_REPORT_BYTES) return null;
      const lst = fs3.lstatSync(reportPath);
      if (lst.isSymbolicLink() || !lst.isFile()) return null;
      if (lst.ino !== st.ino || lst.dev !== st.dev) return null;
      if (root && !isRealpathInsideProject(root, reportPath)) {
        return null;
      }
      const buf = Buffer.alloc(st.size);
      const n = fs3.readSync(fd, buf, 0, st.size, 0);
      const raw = buf.subarray(0, n).toString("utf8");
      if (Buffer.byteLength(raw, "utf8") > MAX_VERIFY_REPORT_BYTES) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      return parsed;
    } finally {
      fs3.closeSync(fd);
    }
  } catch {
    return null;
  }
}
function evaluateVerifyReport(options) {
  const {
    enabled,
    commands,
    reportPath,
    currentItem,
    checklistPath,
    projectRoot
  } = options;
  if (!enabled) {
    return { outcome: "skip", reason: "verify disabled" };
  }
  const commandList = Array.isArray(commands) ? commands : [];
  const requiredCommands = commandList.filter((c) => c.required === true);
  if (requiredCommands.length === 0) {
    return { outcome: "skip", reason: "no required commands" };
  }
  let root;
  if (projectRoot !== void 0 && projectRoot !== null) {
    const n = typeof projectRoot === "string" ? normalizeProjectRoot(projectRoot) : null;
    if (!n) {
      return { outcome: "fail", reason: "missing verify report" };
    }
    root = n;
  }
  const resolvedReportPath = root && typeof reportPath === "string" && reportPath && !reportPath.includes("\0") ? path2.resolve(root, reportPath) : reportPath;
  if (root) {
    try {
      fs3.lstatSync(resolvedReportPath);
      if (!isRealpathInsideProject(root, resolvedReportPath)) {
        return { outcome: "fail", reason: "missing verify report" };
      }
    } catch {
    }
  }
  const report = readVerifyReport(resolvedReportPath, {
    projectRoot: root
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
  if (typeof report.checklistPath !== "string" || report.checklistPath !== checklistPath) {
    return { outcome: "fail", reason: "checklistPath mismatch" };
  }
  if (!Array.isArray(report.commands)) {
    return { outcome: "fail", reason: "invalid commands array" };
  }
  for (const cmd of requiredCommands) {
    const result = report.commands.find(
      (r) => !!r && typeof r === "object" && !Array.isArray(r) && r.id === cmd.id
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
function hasNoCodeCompletionEvidence(options) {
  const { reportPath, currentItemId, projectRoot } = options;
  if (!currentItemId || typeof currentItemId !== "string") return false;
  let root;
  if (projectRoot !== void 0 && projectRoot !== null) {
    const n = typeof projectRoot === "string" ? normalizeProjectRoot(projectRoot) : null;
    if (!n) return false;
    root = n;
  }
  const resolvedReportPath = root && typeof reportPath === "string" && reportPath && !reportPath.includes("\0") ? path2.resolve(root, reportPath) : reportPath;
  if (root) {
    try {
      fs3.lstatSync(resolvedReportPath);
      if (!isRealpathInsideProject(root, resolvedReportPath)) {
        return false;
      }
    } catch {
      return false;
    }
  }
  const report = readVerifyReport(resolvedReportPath, {
    projectRoot: root
  });
  if (!report || typeof report !== "object") return false;
  if (typeof report.itemId !== "string" || report.itemId !== currentItemId) {
    return false;
  }
  const ok = report.ok;
  if (ok === false) return false;
  return true;
}
function defaultVerifyReportPath(projectRoot) {
  const root = normalizeProjectRoot(projectRoot) ?? "";
  return path2.join(root, ".autopilot", "verify-last.json");
}

// ../core/src/state-store.ts
import fs5 from "node:fs";
import path4 from "node:path";

// ../core/src/migrate.ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
var __dirname = dirname(fileURLToPath(import.meta.url));
function getLatestSchemaVersion() {
  return 2;
}
function migrationDirs() {
  return [
    join(__dirname, "..", "migrations"),
    join(__dirname, "migrations")
  ];
}
function readMigrationSql(version) {
  const prefix = `${String(version).padStart(3, "0")}_`;
  for (const dir of migrationDirs()) {
    if (!existsSync(dir)) continue;
    const matches = readdirSync(dir).filter(
      (f) => f.startsWith(prefix) && f.endsWith(".sql")
    );
    if (matches.length === 1) {
      return readFileSync(join(dir, matches[0]), "utf8");
    }
    if (matches.length > 1) {
      throw new Error(
        `Ambiguous migration SQL for version ${version}: ${matches.join(", ")}`
      );
    }
  }
  throw new Error(`Missing migration SQL for version ${version}`);
}
function parseSchemaVersionValue(raw) {
  if (raw == null) return 0;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return 0;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n)) return 0;
  return n;
}
function getCurrentSchemaVersion(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  const row = db.prepare("SELECT value FROM _schema_meta WHERE key = 'schema_version'").get();
  return parseSchemaVersionValue(row?.value);
}
function migrate(db) {
  const current = getCurrentSchemaVersion(db);
  const latest = getLatestSchemaVersion();
  if (current >= latest) {
    return current;
  }
  for (let v = current + 1; v <= latest; v++) {
    const sql = readMigrationSql(v);
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare(
        "INSERT OR REPLACE INTO _schema_meta (key, value) VALUES ('schema_version', ?)"
      ).run(String(v));
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  return latest;
}

// ../core/src/sqlite.ts
import fs4 from "node:fs";
import { createRequire } from "node:module";
import path3 from "node:path";
var require2 = createRequire(import.meta.url);
function openDatabase(filename) {
  if (filename !== ":memory:") {
    fs4.mkdirSync(path3.dirname(filename), { recursive: true });
  }
  const { DatabaseSync } = require2("node:sqlite");
  const db = new DatabaseSync(filename);
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        run: (...params) => {
          const r = stmt.run(...params);
          return { changes: r.changes ?? 0 };
        },
        get: (...params) => stmt.get(...params),
        all: (...params) => stmt.all(...params)
      };
    },
    exec: (sql) => {
      db.exec(sql);
    },
    pragma: (source) => {
      db.exec(`PRAGMA ${source}`);
      return void 0;
    },
    close: () => db.close()
  };
}

// ../core/src/track-slug.ts
var SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
function isSafeTrackSlug(slug) {
  return typeof slug === "string" && SLUG_RE.test(slug) && !slug.includes("..") && !slug.includes("/") && !slug.includes("\\");
}

// ../core/src/state-store.ts
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function nextFollowupTimestamp(previousAt) {
  let ts = nowIso();
  const prev = previousAt ?? "";
  if (prev && ts === prev) {
    const t = Date.parse(prev);
    ts = new Date((Number.isNaN(t) ? Date.now() : t) + 1).toISOString();
  }
  return ts;
}
function shortConversationId(conversationId) {
  return conversationId.replace(/-/g, "").slice(0, 8);
}
var SESSION_TITLE_MAX_LENGTH = 200;
var TITLE_CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
function normalizeSessionTitle(title) {
  if (typeof title !== "string") {
    throw new Error("Title must be a non-empty string");
  }
  const trimmed = title.trim();
  if (!trimmed) {
    throw new Error("Title must be a non-empty string");
  }
  if (TITLE_CONTROL_CHARS.test(trimmed)) {
    throw new Error("Title must not contain control characters");
  }
  if (trimmed.length > SESSION_TITLE_MAX_LENGTH) {
    throw new Error(
      `Title exceeds ${SESSION_TITLE_MAX_LENGTH} characters`
    );
  }
  return trimmed;
}
function sanitizeSessionDisplayText(text) {
  return text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/ +/g, " ").trim();
}
var StateStore = class _StateStore {
  db;
  projectRoot;
  writeDepth = 0;
  constructor(projectRoot, dbPath) {
    const root = normalizeProjectRoot(projectRoot);
    if (!root) {
      throw new Error("Invalid project root");
    }
    this.projectRoot = path4.resolve(root);
    const resolved = dbPath ?? path4.join(this.projectRoot, ".autopilot", "state.db");
    this.db = openDatabase(resolved);
    try {
      this.db.pragma("busy_timeout = 5000");
    } catch {
    }
    if (resolved !== ":memory:") {
      try {
        this.db.pragma("journal_mode = WAL");
      } catch {
      }
    }
    migrate(this.db);
  }
  close() {
    this.db.close();
  }
  getSchemaVersion() {
    const row = this.db.prepare("SELECT value FROM _schema_meta WHERE key = 'schema_version'").get();
    return parseSchemaVersionValue(row?.value);
  }
  ensureReviewChain(conversationId) {
    if (this.isInvalidConversationId(conversationId)) {
      throw new Error("Invalid conversation id");
    }
    const ts = nowIso();
    this.insertReviewChainIfSession(conversationId, ts);
    if (!this.getSession(conversationId)) {
      this.db.prepare(
        `DELETE FROM review_chains
           WHERE conversation_id = ?
             AND NOT EXISTS (SELECT 1 FROM sessions WHERE conversation_id = ?)`
      ).run(conversationId, conversationId);
      throw new Error("No session for conversation");
    }
    let ensured = this.getReviewChain(conversationId);
    if (!ensured) {
      this.insertReviewChainIfSession(conversationId, ts);
      ensured = this.getReviewChain(conversationId);
    }
    if (!ensured) {
      throw new Error("No session for conversation");
    }
    return ensured;
  }
  /** Reject blank, padded, or control-bearing conversation ids (align resolveSessionId). */
  isInvalidConversationId(conversationId) {
    return typeof conversationId !== "string" || !conversationId.trim() || conversationId !== conversationId.trim() || /[\u0000-\u001f\u007f]/.test(conversationId);
  }
  /** Public gate for hooks / stop handlers (fail-soft before any mutation). */
  isConversationIdOk(conversationId) {
    return !this.isInvalidConversationId(conversationId);
  }
  insertReviewChainIfSession(conversationId, ts) {
    this.db.prepare(
      `INSERT OR IGNORE INTO review_chains (conversation_id, fix_round, confirm_left, chain_pending, code_edited, item_confirm_complete, updated_at)
         SELECT ?, 0, NULL, 0, 0, 0, ?
         WHERE EXISTS (SELECT 1 FROM sessions WHERE conversation_id = ?)`
    ).run(conversationId, ts, conversationId);
  }
  getReviewChain(conversationId) {
    const row = this.db.prepare("SELECT * FROM review_chains WHERE conversation_id = ?").get(conversationId);
    if (!row) return null;
    return {
      ...row,
      pending_followup: row.pending_followup ?? null,
      pending_followup_at: row.pending_followup_at ?? null,
      pending_redeliver_at: row.pending_redeliver_at ?? null
    };
  }
  getSession(conversationId) {
    return this.db.prepare("SELECT * FROM sessions WHERE conversation_id = ?").get(conversationId) ?? null;
  }
  listSessions() {
    return this.db.prepare(
      "SELECT * FROM sessions ORDER BY last_active_at DESC, conversation_id ASC"
    ).all();
  }
  /**
   * Resolve a full conversation_id or a unique prefix / short id (first 8 hex-ish chars).
   */
  resolveSessionId(query) {
    const q = query.trim();
    if (!q) {
      return { ok: false, error: "Session id required" };
    }
    if (/[\u0000-\u001f\u007f]/.test(q)) {
      return {
        ok: false,
        error: "Session id must not contain control characters"
      };
    }
    if (this.getSession(q)) {
      return { ok: true, id: q };
    }
    const matches = this.listSessions().filter((s) => {
      const id = s.conversation_id;
      return id.startsWith(q) || shortConversationId(id) === q;
    });
    if (matches.length === 1) {
      return { ok: true, id: matches[0].conversation_id };
    }
    if (matches.length === 0) {
      return { ok: false, error: `No session matching "${q}"` };
    }
    return {
      ok: false,
      error: `Ambiguous id "${q}" matches ${matches.length} sessions; use a longer prefix`
    };
  }
  renameSession(conversationId, title) {
    if (this.isInvalidConversationId(conversationId)) {
      return null;
    }
    const trimmed = normalizeSessionTitle(title);
    return this.exclusiveWrite(() => {
      if (!this.getSession(conversationId)) {
        return { commit: false, value: null };
      }
      const ts = nowIso();
      this.db.prepare(
        `UPDATE sessions SET
            session_title = ?, session_title_source = 'user', title_updated_at = ?,
            updated_at = ?
           WHERE conversation_id = ?`
      ).run(trimmed, ts, ts, conversationId);
      return { commit: true, value: this.getSession(conversationId) };
    });
  }
  /** Delete session row and its review_chains row (atomic). */
  purgeSession(conversationId, ifRow) {
    return this.exclusiveWrite(() => {
      const row = this.getSession(conversationId);
      if (!row) {
        return { commit: false, value: false };
      }
      if (ifRow && !ifRow(row)) {
        return { commit: false, value: false };
      }
      this.db.prepare("DELETE FROM review_chains WHERE conversation_id = ?").run(conversationId);
      this.db.prepare("DELETE FROM sessions WHERE conversation_id = ?").run(conversationId);
      return { commit: true, value: true };
    });
  }
  /**
   * Reset review chain fields (same as REPLAN / fresh applyRun review reset).
   * Clears pending_followup* so a later stop cannot redeliver a stale prompt and
   * resurrect chain_pending after the caller believed the chain was wiped.
   * Session row kept. Atomic: refuses orphan review_chains if session was purged.
   */
  resetReviewChain(conversationId) {
    return this.exclusiveWrite(() => {
      if (!this.getSession(conversationId)) {
        return { commit: false, value: false };
      }
      this.updateReviewChain(conversationId, {
        fix_round: 0,
        confirm_left: null,
        chain_pending: 0,
        code_edited: 0,
        item_confirm_complete: 0,
        pending_followup: null,
        pending_followup_at: null,
        pending_redeliver_at: null
      });
      return { commit: true, value: true };
    });
  }
  /**
   * Pin untrusted session roots to this store's projectRoot.
   * Otherwise a caller could write project_root=/evil and later containment
   * checks that trust session.project_root would pass for outside files.
   * code_root may be a descendant (future worktree); project_root must match.
   * Relative paths resolve against the store root (not process.cwd()).
   */
  sanitizeSessionRoot(raw, opts) {
    const n = normalizeProjectRoot(raw);
    if (!n) return this.projectRoot;
    const resolved = path4.isAbsolute(n) ? path4.resolve(n) : path4.resolve(this.projectRoot, n);
    if (resolved === this.projectRoot) return this.projectRoot;
    if (opts?.allowDescendant && isLexicallyInsideProject(this.projectRoot, resolved)) {
      return resolved;
    }
    return this.projectRoot;
  }
  /**
   * Refuse checklist_path that escapes the store project (absolute outside or
   * relative that resolves outside). Missing paths kept only if lexically inside.
   * Relative inputs stay relative when allowed (callers/tests rely on that form).
   */
  sanitizeChecklistPath(raw) {
    if (typeof raw !== "string" || !raw || raw.includes("\0")) return "";
    if (path4.isAbsolute(raw)) {
      const abs2 = path4.resolve(raw);
      try {
        fs5.lstatSync(abs2);
        return isRealpathInsideProject(this.projectRoot, abs2) ? abs2 : "";
      } catch {
        return isLexicallyInsideProject(this.projectRoot, abs2) ? abs2 : "";
      }
    }
    const abs = path4.resolve(this.projectRoot, raw);
    try {
      fs5.lstatSync(abs);
      return isRealpathInsideProject(this.projectRoot, abs) ? raw : "";
    } catch {
      return isLexicallyInsideProject(this.projectRoot, abs) ? raw : "";
    }
  }
  upsertSession(partial) {
    if (this.isInvalidConversationId(partial.conversation_id)) {
      throw new Error("Invalid conversation id");
    }
    const ts = nowIso();
    const projectRoot = this.sanitizeSessionRoot(partial.project_root);
    const codeRoot = this.sanitizeSessionRoot(partial.code_root, {
      allowDescendant: true
    });
    const checklistPath = partial.checklist_path !== void 0 ? this.sanitizeChecklistPath(partial.checklist_path) : void 0;
    const existing = this.getSession(partial.conversation_id);
    if (!existing) {
      const insertSource = partial.session_title_source === "user" ? "platform" : partial.session_title_source ?? null;
      this.db.prepare(
        `INSERT INTO sessions (
            conversation_id, platform, session_title, session_title_source, title_updated_at,
            track_id, track_title, checklist_path, phase, armed, paused,
            paused_reason, pending_action, track_candidates_json,
            project_root, code_root, last_active_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        partial.conversation_id,
        partial.platform ?? "cursor",
        partial.session_title ?? null,
        insertSource,
        partial.title_updated_at ?? null,
        partial.track_id ?? "_pending",
        partial.track_title ?? null,
        checklistPath ?? "",
        partial.phase ?? "idle",
        partial.armed ?? 0,
        partial.paused ?? 0,
        partial.paused_reason ?? null,
        partial.pending_action ?? null,
        partial.track_candidates_json ?? null,
        projectRoot,
        codeRoot,
        ts,
        ts
      );
    } else {
      const merged = { ...existing, ...partial, updated_at: ts, last_active_at: ts };
      const upsertSource = merged.session_title_source === "user" ? "platform" : merged.session_title_source;
      const nextProjectRoot = this.sanitizeSessionRoot(merged.project_root);
      const nextCodeRoot = this.sanitizeSessionRoot(merged.code_root, {
        allowDescendant: true
      });
      const nextChecklistPath = this.sanitizeChecklistPath(merged.checklist_path);
      this.db.prepare(
        `UPDATE sessions SET
            platform = ?,
            session_title = CASE WHEN session_title_source = 'user' THEN session_title ELSE ? END,
            session_title_source = CASE WHEN session_title_source = 'user' THEN session_title_source ELSE ? END,
            title_updated_at = CASE WHEN session_title_source = 'user' THEN title_updated_at ELSE ? END,
            track_id = ?, track_title = ?, checklist_path = ?,
            phase = ?, armed = ?, paused = ?, paused_reason = ?, pending_action = ?,
            track_candidates_json = ?, project_root = ?, code_root = ?,
            error_count = ?, idle_stop_count = ?, last_active_at = ?, updated_at = ?
           WHERE conversation_id = ?`
      ).run(
        merged.platform,
        merged.session_title,
        upsertSource,
        merged.title_updated_at,
        merged.track_id,
        merged.track_title,
        nextChecklistPath,
        merged.phase,
        merged.armed,
        merged.paused,
        merged.paused_reason,
        merged.pending_action,
        merged.track_candidates_json,
        nextProjectRoot,
        nextCodeRoot,
        merged.error_count,
        merged.idle_stop_count,
        merged.last_active_at,
        merged.updated_at,
        partial.conversation_id
      );
    }
    return this.getSession(partial.conversation_id);
  }
  updateReviewChain(conversationId, patch) {
    const current = this.ensureReviewChain(conversationId);
    const merged = { ...current, ...patch, updated_at: nowIso() };
    if (typeof merged.pending_followup === "string" && (!merged.pending_followup.trim() || merged.pending_followup.includes("\0"))) {
      merged.pending_followup = null;
      merged.pending_followup_at = null;
      merged.pending_redeliver_at = null;
      merged.chain_pending = 0;
    }
    const result = this.db.prepare(
      `UPDATE review_chains SET
          fix_round = ?, confirm_left = ?, chain_pending = ?, code_edited = ?,
          item_confirm_complete = ?,
          pending_followup = ?, pending_followup_at = ?, pending_redeliver_at = ?,
          updated_at = ?
         WHERE conversation_id = ?
           AND EXISTS (SELECT 1 FROM sessions WHERE conversation_id = ?)`
    ).run(
      merged.fix_round,
      merged.confirm_left,
      merged.chain_pending,
      merged.code_edited,
      merged.item_confirm_complete,
      merged.pending_followup,
      merged.pending_followup_at,
      merged.pending_redeliver_at,
      merged.updated_at,
      conversationId,
      conversationId
    );
    if (result.changes === 0) {
      throw new Error("No session for conversation");
    }
    const updated = this.getReviewChain(conversationId);
    if (!updated) {
      throw new Error("No session for conversation");
    }
    return updated;
  }
  markCodeEdited(conversationId) {
    this.withSessionChainWrite(conversationId, () => {
      this.ensureReviewChain(conversationId);
      this.db.prepare(
        `UPDATE review_chains SET code_edited = 1, updated_at = ?
           WHERE conversation_id = ?
             AND EXISTS (SELECT 1 FROM sessions WHERE conversation_id = ?)`
      ).run(nowIso(), conversationId, conversationId);
    });
  }
  /**
   * Drop sticky code_edited without touching pending/confirm (Stop/abort path).
   * Column-only like clearChainPending — no ensure/merge; missing chain → no-op.
   */
  clearCodeEdited(conversationId) {
    if (this.isInvalidConversationId(conversationId)) {
      return;
    }
    this.db.prepare(
      `UPDATE review_chains SET code_edited = 0, updated_at = ?
         WHERE conversation_id = ?`
    ).run(nowIso(), conversationId);
  }
  /**
   * E8: user ordinary chat clears the in-chain flag only.
   * Do NOT wipe pending_followup* — undelivered automation must still redeliver;
   * clearing pending here would let the next stop advance confirm_left (skip a lens).
   * Column-only UPDATE (no ensure/merge): missing chain → no-op; concurrent stop
   * cannot lose confirm_left/pending via stale read-merge-write.
   */
  clearChainPending(conversationId) {
    if (this.isInvalidConversationId(conversationId)) {
      return;
    }
    this.db.prepare(
      `UPDATE review_chains SET chain_pending = 0, updated_at = ? WHERE conversation_id = ?`
    ).run(nowIso(), conversationId);
  }
  /**
   * Column-only redeliver hold (recover claim sleep). Also clears chain_pending so
   * armChain=false recover cannot leave a phantom E3 arm. Avoids updateReviewChain
   * read-merge-write clobbering confirm_left / pending under concurrency.
   */
  setPendingRedeliverHold(conversationId, at) {
    if (this.isInvalidConversationId(conversationId)) {
      return;
    }
    const stamp = typeof at === "string" ? at.trim() : "";
    if (!stamp || stamp.includes("\0")) {
      return;
    }
    this.db.prepare(
      `UPDATE review_chains SET
          pending_redeliver_at = ?, chain_pending = 0, updated_at = ?
         WHERE conversation_id = ?`
    ).run(stamp, nowIso(), conversationId);
  }
  /**
   * Column-only: drop claim redeliver hold without touching pending / confirm.
   * Used when finish skips CAS (e.g. another followup in flight) but sleep was
   * no-op — leaving the hold would block host-drop redelivery for debounceMs.
   */
  clearPendingRedeliverHold(conversationId) {
    if (this.isInvalidConversationId(conversationId)) {
      return;
    }
    this.db.prepare(
      `UPDATE review_chains SET pending_redeliver_at = NULL, updated_at = ?
         WHERE conversation_id = ?`
    ).run(nowIso(), conversationId);
  }
  /**
   * Drop redeliver hold only while `pending_followup_at` still equals this stop's
   * claim stamp (and pending is recover). Prevents wiping a peer redeliver's
   * newly armed hold after the debounce window.
   */
  clearPendingRedeliverHoldIfStamp(conversationId, expectedAt) {
    if (this.isInvalidConversationId(conversationId)) {
      return false;
    }
    if (!expectedAt || expectedAt.includes("\0")) {
      return false;
    }
    const result = this.db.prepare(
      `UPDATE review_chains SET pending_redeliver_at = NULL, updated_at = ?
         WHERE conversation_id = ?
           AND pending_followup_at = ?
           AND pending_followup IS NOT NULL
           AND trim(pending_followup) != ''
           AND ${_StateStore.SQL_PENDING_IS_RECOVER}`
    ).run(nowIso(), conversationId, expectedAt);
    return result.changes > 0;
  }
  setChainPending(conversationId) {
    this.withSessionChainWrite(conversationId, () => {
      this.ensureReviewChain(conversationId);
      this.db.prepare(
        `UPDATE review_chains SET chain_pending = 1, updated_at = ?
           WHERE conversation_id = ?
             AND EXISTS (SELECT 1 FROM sessions WHERE conversation_id = ?)`
      ).run(nowIso(), conversationId, conversationId);
    });
  }
  savePendingFollowup(conversationId, message, opts) {
    const msg = typeof message === "string" ? message.trim() : "";
    if (!msg || msg.includes("\0")) return;
    const armChain = opts?.armChain !== false;
    this.withSessionChainWrite(conversationId, () => {
      this.ensureReviewChain(conversationId);
      const ts = nextFollowupTimestamp(
        this.getReviewChain(conversationId)?.pending_followup_at
      );
      const sql = armChain ? `UPDATE review_chains SET
          pending_followup = ?, pending_followup_at = ?, pending_redeliver_at = NULL,
          chain_pending = 1, updated_at = ?
         WHERE conversation_id = ?
           AND EXISTS (SELECT 1 FROM sessions WHERE conversation_id = ?)` : `UPDATE review_chains SET
          pending_followup = ?, pending_followup_at = ?, pending_redeliver_at = NULL,
          updated_at = ?
         WHERE conversation_id = ?
           AND EXISTS (SELECT 1 FROM sessions WHERE conversation_id = ?)`;
      this.db.prepare(sql).run(msg, ts, ts, conversationId, conversationId);
    });
  }
  /**
   * SQL: pending looks like a recover automation prompt.
   * Keep in sync with `isRecoverFollowupMessage` prefixes.
   */
  static SQL_PENDING_IS_RECOVER = `(
    trim(pending_followup) GLOB 'Recover:*'
    OR trim(pending_followup) GLOB '\u6062\u590D\uFF1A*'
    OR trim(pending_followup) GLOB '\u6062\u590D:*'
  )`;
  /**
   * SQL: pending kinds that must stay chain_pending=0 on redeliver.
   * Matches recover/stuck (armChain=false) and terminal done/review_complete
   * rows that intentionally leave the chain disarmed. Keep prefixes in sync
   * with emit/updateReviewChain sites and `isRecoverOrStuckFollowupMessage`.
   * Do NOT include Advance — E5 advance arms chain_pending=1; E0 soft advance
   * shares the same prefix but is rarer than breaking E5 redelivery.
   */
  static SQL_PENDING_REDELIVER_KEEP_DISARMED = `(
    trim(pending_followup) GLOB 'Recover:*'
    OR trim(pending_followup) GLOB '\u6062\u590D\uFF1A*'
    OR trim(pending_followup) GLOB '\u6062\u590D:*'
    OR trim(pending_followup) GLOB 'Stuck:*'
    OR trim(pending_followup) GLOB '\u5361\u4F4F\uFF1A*'
    OR trim(pending_followup) GLOB '\u5361\u4F4F:*'
    OR trim(pending_followup) GLOB 'All checklist*'
    OR trim(pending_followup) GLOB '\u5168\u90E8\u5B8C\u6210*'
    OR trim(pending_followup) GLOB 'Review complete*'
    OR trim(pending_followup) GLOB '\u81EA\u5BA1\u5B8C\u6210*'
  )`;
  /**
   * SQL predicate: pending is absent or not a recover automation prompt.
   * Keep in sync with `isRecoverFollowupMessage` prefixes.
   */
  static SQL_PENDING_NOT_RECOVER = `(
    pending_followup IS NULL
    OR (
      trim(pending_followup) NOT GLOB 'Recover:*'
      AND trim(pending_followup) NOT GLOB '\u6062\u590D\uFF1A*'
      AND trim(pending_followup) NOT GLOB '\u6062\u590D:*'
    )
  )`;
  /**
   * Atomic emit-ownership bump: succeeds only when `pending_followup_at` still
   * equals `expectedAt` and pending is a recover prompt. Returns the new stamp,
   * or null if the race was lost / row missing. Advances by ≥1ms when `nowIso()`
   * collides with `expectedAt`.
   */
  casBumpPendingFollowupAt(conversationId, expectedAt) {
    if (this.isInvalidConversationId(conversationId)) return null;
    if (!expectedAt || expectedAt.includes("\0")) return null;
    const ts = nextFollowupTimestamp(expectedAt);
    const result = this.db.prepare(
      `UPDATE review_chains SET
          pending_followup_at = ?, pending_redeliver_at = NULL, updated_at = ?
         WHERE conversation_id = ?
           AND pending_followup_at = ?
           AND pending_followup IS NOT NULL
           AND trim(pending_followup) != ''
           AND ${_StateStore.SQL_PENDING_IS_RECOVER}`
    ).run(ts, ts, conversationId, expectedAt);
    return result.changes > 0 ? ts : null;
  }
  clearPendingFollowup(conversationId) {
    if (this.isInvalidConversationId(conversationId)) {
      return;
    }
    this.db.prepare(
      `UPDATE review_chains SET
          pending_followup = NULL, pending_followup_at = NULL, pending_redeliver_at = NULL,
          updated_at = ?
         WHERE conversation_id = ?`
    ).run(nowIso(), conversationId);
  }
  /**
   * Atomically clear pending only when the live row still matches `pred`.
   * Avoids read-then-clear TOCTOU: a concurrent stop may replace recover with
   * fix/confirm between getReviewChain and clearPendingFollowup.
   * Safe inside an open exclusiveWrite (runs inline; no nest).
   */
  clearPendingFollowupIf(conversationId, pred) {
    if (this.isInvalidConversationId(conversationId)) {
      return false;
    }
    if (typeof pred !== "function") {
      return false;
    }
    const run = () => {
      const pending = this.getReviewChain(conversationId)?.pending_followup?.trim() ?? "";
      if (!pending) {
        return false;
      }
      let matched = false;
      try {
        const raw = pred(pending);
        if (raw !== null && typeof raw === "object" && typeof raw.then === "function") {
          return false;
        }
        matched = Boolean(raw);
      } catch {
        return false;
      }
      if (!matched) {
        return false;
      }
      this.db.prepare(
        `UPDATE review_chains SET
            pending_followup = NULL, pending_followup_at = NULL, pending_redeliver_at = NULL,
            updated_at = ?
           WHERE conversation_id = ?`
      ).run(nowIso(), conversationId);
      return true;
    };
    if (this.writeDepth > 0) {
      return run();
    }
    return this.exclusiveWrite(() => {
      const ok = run();
      return { commit: ok, value: ok };
    });
  }
  /**
   * Column-only: neutralize fix/confirm/pending re-entry without ensure/session.
   * Used when pause-threshold upsert failed but the session is still armed — a
   * later completed stop must not resume the review loop via code_edited/pending
   * or loopCount>0→E3 (fix_round cleared so bare loopCount cannot re-arm).
   */
  neutralizeReviewChain(conversationId) {
    if (this.isInvalidConversationId(conversationId)) {
      return;
    }
    this.db.prepare(
      `UPDATE review_chains SET
          code_edited = 0,
          confirm_left = NULL,
          chain_pending = 0,
          item_confirm_complete = 0,
          fix_round = 0,
          pending_followup = NULL,
          pending_followup_at = NULL,
          pending_redeliver_at = NULL,
          updated_at = ?
         WHERE conversation_id = ?`
    ).run(nowIso(), conversationId);
  }
  /**
   * Like {@link neutralizeReviewChain}, but refuse to wipe an in-flight recover
   * pending (error-storm claimer). Returns true when a row was updated.
   */
  neutralizeReviewChainUnlessRecover(conversationId) {
    if (this.isInvalidConversationId(conversationId)) {
      return false;
    }
    const result = this.db.prepare(
      `UPDATE review_chains SET
          code_edited = 0,
          confirm_left = NULL,
          chain_pending = 0,
          item_confirm_complete = 0,
          fix_round = 0,
          pending_followup = NULL,
          pending_followup_at = NULL,
          pending_redeliver_at = NULL,
          updated_at = ?
         WHERE conversation_id = ?
           AND ${_StateStore.SQL_PENDING_NOT_RECOVER}`
    ).run(nowIso(), conversationId);
    return result.changes > 0;
  }
  /**
   * Ambient error-recover soft-reset columns + clear pending, but refuse when
   * pending is already recover (unlocked compensate TOCTOU defense).
   * Returns true when a row was updated.
   */
  softResetAmbientChainUnlessRecover(conversationId, fields) {
    if (this.isInvalidConversationId(conversationId)) {
      return false;
    }
    const result = this.db.prepare(
      `UPDATE review_chains SET
          confirm_left = ?,
          item_confirm_complete = ?,
          chain_pending = ?,
          code_edited = ?,
          pending_followup = NULL,
          pending_followup_at = NULL,
          pending_redeliver_at = NULL,
          updated_at = ?
         WHERE conversation_id = ?
           AND EXISTS (SELECT 1 FROM sessions WHERE conversation_id = ?)
           AND ${_StateStore.SQL_PENDING_NOT_RECOVER}`
    ).run(
      fields.confirm_left,
      fields.item_confirm_complete,
      fields.chain_pending,
      fields.code_edited,
      nowIso(),
      conversationId,
      conversationId
    );
    return result.changes > 0;
  }
  /**
   * Column-only pause/disarm when the full upsertSession pause write failed.
   * Without this, loopCount>0 completed stops can still hit E3 while armed.
   */
  pauseSessionForRepeatedErrors(conversationId, errorCount, lastError) {
    if (this.isInvalidConversationId(conversationId)) {
      return;
    }
    const count = typeof errorCount === "number" && Number.isFinite(errorCount) ? Math.max(0, Math.floor(errorCount)) : 0;
    const err = typeof lastError === "string" && !lastError.includes("\0") ? lastError : null;
    const ts = nowIso();
    this.db.prepare(
      `UPDATE sessions SET
          armed = 0,
          paused = 1,
          paused_reason = 'repeated_errors',
          error_count = ?,
          last_error = ?,
          last_active_at = ?,
          updated_at = ?
         WHERE conversation_id = ?`
    ).run(count, err, ts, ts, conversationId);
  }
  /**
   * Fallback halt when richer pause UPDATE threw/no-op'd.
   * Always drops armed; ensures paused=1. Preserves an existing paused_reason
   * (e.g. concurrent stuck/human_gate, or richer pause already wrote) via
   * COALESCE — only fills repeated_errors when reason was null.
   * Leaves error_count/last_error to the richer pause path.
   */
  disarmSession(conversationId) {
    if (this.isInvalidConversationId(conversationId)) {
      return;
    }
    this.db.prepare(
      `UPDATE sessions SET
          armed = 0,
          paused = 1,
          paused_reason = COALESCE(paused_reason, 'repeated_errors'),
          updated_at = ?
         WHERE conversation_id = ?`
    ).run(nowIso(), conversationId);
  }
  touchPendingRedeliver(conversationId) {
    this.withSessionChainWrite(conversationId, () => {
      this.ensureReviewChain(conversationId);
      const ts = nowIso();
      this.db.prepare(
        `UPDATE review_chains SET
          pending_redeliver_at = ?,
          chain_pending = CASE
            WHEN ${_StateStore.SQL_PENDING_REDELIVER_KEEP_DISARMED} THEN 0
            ELSE 1
          END,
          updated_at = ?
         WHERE conversation_id = ?
           AND pending_followup IS NOT NULL
           AND trim(pending_followup) != ''
           AND EXISTS (SELECT 1 FROM sessions WHERE conversation_id = ?)`
      ).run(ts, ts, conversationId, conversationId);
    });
  }
  /**
   * Run fn only when session exists. Uses exclusiveWrite when not already in one
   * (serialize vs purge); if already nested in a write txn, runs inline — nesting
   * exclusiveWrite would throw.
   */
  withSessionChainWrite(conversationId, fn) {
    if (this.isInvalidConversationId(conversationId)) {
      return;
    }
    const run = () => {
      if (!this.getSession(conversationId)) return false;
      fn();
      return true;
    };
    if (this.writeDepth > 0) {
      run();
      return;
    }
    this.exclusiveWrite(() => {
      const ok = run();
      return { commit: ok, value: void 0 };
    });
  }
  findExecutingSession(excludeConversationId) {
    return this.db.prepare(
      `SELECT * FROM sessions
           WHERE phase = 'executing' AND armed = 1 AND paused = 0
             AND conversation_id != ?
           LIMIT 1`
    ).get(excludeConversationId) ?? null;
  }
  /**
   * Move session + review_chain rows from `fromId` → `toId` (PK rebind).
   * Replaces disposable destinations (idle — incl. stale track_id — or done).
   * Refuses planning or executing destinations (paused or armed).
   */
  rebindConversation(fromId, toId) {
    if (this.isInvalidConversationId(fromId) || this.isInvalidConversationId(toId)) {
      return { ok: false, reason: "invalid_id" };
    }
    if (fromId === toId) {
      const self = this.getSession(toId);
      if (!self) return { ok: false, reason: "missing_source" };
      return { ok: true, session: self };
    }
    if (this.writeDepth > 0) {
      return this.rebindConversationInTxn(fromId, toId);
    }
    return this.exclusiveWrite(() => {
      const result = this.rebindConversationInTxn(fromId, toId);
      return { commit: result.ok, value: result };
    });
  }
  isDisposableResumeDest(dest) {
    return dest.phase === "done" || dest.phase === "idle";
  }
  rebindConversationInTxn(fromId, toId) {
    const source = this.getSession(fromId);
    if (!source) {
      return { ok: false, reason: "missing_source" };
    }
    const dest = this.getSession(toId);
    if (dest) {
      if (!this.isDisposableResumeDest(dest)) {
        return { ok: false, reason: "dest_busy" };
      }
      this.db.prepare("DELETE FROM review_chains WHERE conversation_id = ?").run(toId);
      this.db.prepare("DELETE FROM sessions WHERE conversation_id = ?").run(toId);
    }
    const ts = nowIso();
    this.db.prepare(
      `UPDATE sessions SET conversation_id = ?, updated_at = ?, last_active_at = ?
           WHERE conversation_id = ?`
    ).run(toId, ts, ts, fromId);
    this.db.prepare(
      `UPDATE review_chains SET conversation_id = ?, updated_at = ?
           WHERE conversation_id = ?`
    ).run(toId, ts, fromId);
    const moved = this.getSession(toId);
    if (!moved) {
      return { ok: false, reason: "missing_source" };
    }
    return { ok: true, session: moved };
  }
  /**
   * Atomically pick a foreign session (by slug or unique executing) and rebind
   * it onto `toId`. No-op (ok + current dest) when nothing to claim.
   */
  claimSessionInto(toId, opts) {
    if (this.isInvalidConversationId(toId)) {
      return { ok: false, userMessage: "Invalid conversation id." };
    }
    const slug = opts?.slug?.trim() || void 0;
    if (slug && !isSafeTrackSlug(slug)) {
      return {
        ok: false,
        userMessage: `Invalid track slug "${sanitizeSessionDisplayText(slug).slice(0, 64)}".`
      };
    }
    return this.exclusiveWrite(() => {
      const dest = this.getSession(toId);
      if (dest && !this.isDisposableResumeDest(dest)) {
        return {
          commit: false,
          value: {
            ok: false,
            userMessage: `This conversation already has track "${sanitizeSessionDisplayText(dest.track_id)}" (${sanitizeSessionDisplayText(String(dest.phase))}). Claim from a new chat with /autopilot-resume <slug> \u2014 planning/executing here cannot be replaced (OFF only pauses).`
          }
        };
      }
      const others = this.listSessions().filter(
        (s) => s.conversation_id !== toId
      );
      const pickExecuting = (pool) => {
        const active = pool.filter(
          (s) => s.phase === "executing" && s.paused === 0
        );
        if (active.length > 1) {
          const allSame = active.every(
            (s) => s.track_id === active[0].track_id
          );
          return {
            ok: false,
            userMessage: allSame ? `Multiple executing sessions for "${sanitizeSessionDisplayText(active[0].track_id)}". Send Autopilot OFF on extras, then retry.` : `Multiple executing sessions (${active.map((s) => sanitizeSessionDisplayText(s.track_id)).join(", ")}). Send Autopilot OFF on extras, then retry \u2014 or use /autopilot-resume <slug>.`
          };
        }
        if (active.length === 1) {
          return { ok: true, session: active[0] };
        }
        const paused = pool.filter(
          (s) => s.phase === "executing" && s.paused === 1
        );
        if (paused.length > 1) {
          const allSame = paused.every(
            (s) => s.track_id === paused[0].track_id
          );
          return {
            ok: false,
            userMessage: allSame ? `Multiple paused executing sessions for "${sanitizeSessionDisplayText(paused[0].track_id)}". Leave only one source, then retry.` : `Multiple paused executing sessions (${paused.map((s) => sanitizeSessionDisplayText(s.track_id)).join(", ")}). Use /autopilot-resume <slug>.`
          };
        }
        return { ok: true, session: paused[0] ?? null };
      };
      let source = null;
      if (slug) {
        const hits = others.filter((s) => s.track_id === slug);
        const picked = pickExecuting(hits);
        if (!picked.ok) {
          return { commit: false, value: picked };
        }
        const preferred = picked.session ?? hits.find((s) => s.phase === "planning") ?? null;
        if (!preferred) {
          const onlyDone = hits.some((s) => s.phase === "done");
          return {
            commit: false,
            value: {
              ok: false,
              userMessage: onlyDone ? `Track "${slug}" is already done. Use /autopilot-run ${slug} to start again.` : `No session found for track "${slug}".`
            }
          };
        }
        source = preferred;
      } else {
        const picked = pickExecuting(others);
        if (!picked.ok) {
          return { commit: false, value: picked };
        }
        source = picked.session;
      }
      if (!source) {
        return {
          commit: true,
          value: { ok: true, session: dest ?? null }
        };
      }
      const rebound = this.rebindConversationInTxn(
        source.conversation_id,
        toId
      );
      if (!rebound.ok) {
        if (rebound.reason === "dest_busy") {
          return {
            commit: false,
            value: {
              ok: false,
              userMessage: "This conversation already has an active session. Claim from a new chat with /autopilot-resume <slug> \u2014 planning/executing here cannot be replaced (OFF only pauses)."
            }
          };
        }
        return {
          commit: false,
          value: {
            ok: false,
            userMessage: `Failed to claim session for track "${sanitizeSessionDisplayText(source.track_id)}".`
          }
        };
      }
      return {
        commit: true,
        value: { ok: true, session: rebound.session }
      };
    });
  }
  /**
   * Serialize writers with BEGIN IMMEDIATE so check-then-act (e.g. one_executor)
   * and multi-statement enters stay atomic. Callback chooses commit vs rollback.
   */
  exclusiveWrite(fn) {
    if (this.writeDepth > 0) {
      throw new Error("exclusiveWrite does not support nesting");
    }
    this.writeDepth += 1;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const { commit, value } = fn();
      this.db.exec(commit ? "COMMIT" : "ROLLBACK");
      return value;
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
      }
      throw err;
    } finally {
      this.writeDepth -= 1;
    }
  }
  static openMemory(projectRoot) {
    return new _StateStore(projectRoot, ":memory:");
  }
};

// ../core/src/review-lenses.ts
var CONFIRM_LENSES = {
  1: {
    key: "scope-correctness",
    title: "Correctness & invariants",
    focus: "Focus on logic, state-machine/flow coherence, pre/post-conditions and business invariants; do not turn this round into a null/concurrency/security/tests mix."
  },
  2: {
    key: "boundaries",
    title: "Nulls, boundaries & error paths",
    focus: "Focus on null/empty collections, bounds, illegal input, timeout/failure returns, idempotency and safe retries; do not repeat the prior pure-logic walkthrough."
  },
  3: {
    key: "concurrency",
    title: "Concurrency, races & partial failure",
    focus: "Focus on multi-thread/multi-instance, locks/leases, races, transaction boundaries, dirty state after mid-failure and compensation; do not repeat null or security checklists."
  },
  4: {
    key: "security",
    title: "Security & trust boundaries",
    focus: "Focus on authz/privilege, injection, sensitive data leaks, secrets/config, untrusted input, and over-exposed errors; do not make this another correctness re-read."
  },
  5: {
    key: "tests-regression",
    title: "Test gaps & regression",
    focus: "Focus on missing critical-path tests, weak asserts, contract drift vs existing behavior/APIs, and likely regression points; read-only \u2014 record gaps, do not change code to add tests; do not vaguely claim full coverage."
  }
};
function lensNumberForRound(roundIndex, confirmRounds) {
  if (confirmRounds === 3) {
    const map = [1, 2, 5];
    return map[roundIndex - 1] ?? 5;
  }
  return Math.min(Math.max(roundIndex, 1), 5);
}
function getLens(roundIndex, confirmRounds) {
  const n = lensNumberForRound(roundIndex, confirmRounds);
  return CONFIRM_LENSES[n] ?? CONFIRM_LENSES[5];
}

// ../core/src/review-scope.ts
function ensureAmbientReviewSession(store, conversationId, projectRoot, reviewScope) {
  if (reviewScope !== "project") return false;
  if (!store.isConversationIdOk(conversationId)) return false;
  const root = normalizeProjectRoot(store.projectRoot) ?? normalizeProjectRoot(projectRoot);
  if (!root) return false;
  try {
    const existing = store.getSession(conversationId);
    if (existing) {
      const needsRevive = existing.paused === 0 && (existing.phase === "done" || existing.phase === "idle" && existing.armed === 0);
      if (needsRevive) {
        store.exclusiveWrite(() => {
          const fresh = store.getSession(conversationId);
          if (!fresh || fresh.paused !== 0 || !(fresh.phase === "done" || fresh.phase === "idle" && fresh.armed === 0)) {
            return { commit: false, value: void 0 };
          }
          store.upsertSession({
            conversation_id: conversationId,
            project_root: root,
            code_root: root,
            phase: "idle",
            armed: 1,
            paused: 0,
            paused_reason: null
          });
          store.neutralizeReviewChain(conversationId);
          return { commit: true, value: void 0 };
        });
      }
      return true;
    }
    store.exclusiveWrite(() => {
      if (store.getSession(conversationId)) {
        return { commit: false, value: void 0 };
      }
      store.upsertSession({
        conversation_id: conversationId,
        project_root: root,
        code_root: root,
        platform: "cursor",
        phase: "idle",
        armed: 1,
        paused: 0,
        paused_reason: null,
        checklist_path: "",
        track_id: ""
      });
      return { commit: true, value: void 0 };
    });
    return !!store.getSession(conversationId);
  } catch {
    return false;
  }
}
function isChecklistExecuting(session) {
  return session.paused === 0 && session.phase === "executing" && session.armed === 1;
}
function sessionReviewRunnable(session, reviewScope) {
  if (session.paused !== 0) return false;
  if (reviewScope === "project") {
    if (session.phase === "idle" && session.armed === 1) return true;
    if (session.phase === "planning") return true;
    if (session.phase === "executing" && session.armed === 1) return true;
    return false;
  }
  return isChecklistExecuting(session);
}

// ../core/src/transcript-followup.ts
import fs6 from "node:fs";

// ../core/src/trigger-parser.ts
var DEFAULT_TRIGGERS = {
  match: "line_start",
  on: ["Autopilot ON", "Enable autopilot", "\u5F00\u542F\u81EA\u52A8\u9A7E\u9A76"],
  run: ["Autopilot RUN", "Start execution", "\u5F00\u59CB\u6267\u884C"],
  off: ["Autopilot OFF", "Disable autopilot", "\u5173\u95ED\u81EA\u52A8\u9A7E\u9A76"],
  resume: ["Autopilot RESUME", "\u7EE7\u7EED\u6267\u884C"],
  replan: ["Autopilot REPLAN", "\u4FEE\u6539\u65B9\u6848"],
  resume_review: ["Resume review", "\u7EE7\u7EED\u81EA\u5BA1"]
};
var SLASH_MAP = {
  "autopilot-on": "on",
  "autopilot-run": "run",
  "autopilot-off": "off",
  "autopilot-resume": "resume",
  "autopilot-replan": "replan"
};
var HARNESS_FOLLOWUP_PREFIXES = [
  "Review fix round",
  "Review confirm",
  "Advance checklist",
  "All checklist items done",
  "Stuck:",
  "Recover:",
  "Review complete",
  "Verify failed",
  "\u81EA\u5BA1\u4FEE\u590D",
  "\u81EA\u5BA1\u786E\u8BA4",
  "\u81EA\u5BA1\u5B8C\u6210",
  "\u63A8\u8FDB\u4E0B\u4E00\u9879",
  "\u5168\u90E8\u5B8C\u6210",
  "\u6821\u9A8C\u5931\u8D25",
  // Match zh recover/stuck templates (fullwidth colon) — bare「恢复」is too broad.
  "\u6062\u590D\uFF1A",
  "\u5361\u4F4F\uFF1A",
  // Halfwidth colon variants (same as isRecoverOrStuckFollowupMessage).
  "\u6062\u590D:",
  "\u5361\u4F4F:",
  // External usage-limit continue (account-pool); must not clear Autopilot chain.
  "\u3010Hook\xB7\u7EED\u8DD1\u3011"
];
function stripUserQuery(prompt) {
  const m = prompt.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i);
  return (m?.[1] ?? prompt).trim();
}
function isHarnessFollowupMessage(text) {
  const body = stripUserQuery(text);
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("<") && line.includes(">")) continue;
    return HARNESS_FOLLOWUP_PREFIXES.some((p) => line.startsWith(p));
  }
  return false;
}
function isRecoverFollowupMessage(text) {
  const m = (text || "").trim();
  if (!m) return false;
  return m.startsWith("Recover:") || m.startsWith("\u6062\u590D\uFF1A") || m.startsWith("\u6062\u590D:");
}
function isRecoverOrStuckFollowupMessage(text) {
  const m = (text || "").trim();
  if (!m) return false;
  return isRecoverFollowupMessage(m) || m.startsWith("Stuck:") || m.startsWith("\u5361\u4F4F\uFF1A") || m.startsWith("\u5361\u4F4F:");
}
var USER_ABORT_MARKERS = [
  "user aborted",
  "interrupted manually",
  "aborted/interrupted"
];
function isUserAbortText(text) {
  const low = (text || "").toLowerCase();
  if (!low.trim()) return false;
  return USER_ABORT_MARKERS.some((m) => low.includes(m));
}
function firstLine(text) {
  return text.trim().split(/\r?\n/)[0]?.trim() ?? "";
}
function matchTextTrigger(line, phrases) {
  for (const phrase of phrases) {
    if (line === phrase || line.startsWith(phrase + " ") || line.startsWith(phrase + "\xB7") || line.startsWith(phrase + " \xB7")) {
      let rest = line.slice(phrase.length).trim();
      rest = rest.replace(/^[·•]\s*/, "").trim();
      return { matched: phrase, rest };
    }
  }
  return null;
}
function parseSlugAndBrief(rest) {
  if (!rest) return {};
  const parts = rest.split(/\s*·\s*/);
  if (parts.length >= 2) {
    const maybeSlug = parts[1].trim();
    if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(maybeSlug)) {
      return { slug: maybeSlug, initialBrief: parts.slice(2).join(" \xB7 ").trim() || void 0 };
    }
  }
  if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(rest)) {
    return { slug: rest };
  }
  return { initialBrief: rest };
}
function parseTrigger(options) {
  const {
    conversationId,
    projectRoot,
    triggers = DEFAULT_TRIGGERS,
    pendingAction
  } = options;
  const text = stripUserQuery(options.prompt);
  const line = firstLine(text);
  const slash = line.match(/^\/?(autopilot-(?:on|run|off|resume|replan))(?:\s+(.*))?$/i);
  if (slash) {
    const command = slash[1].toLowerCase();
    const kind = SLASH_MAP[command];
    if (!kind) return null;
    const rest = (slash[2] ?? "").trim();
    const event = {
      kind,
      source: "slash",
      command,
      conversationId,
      projectRoot
    };
    if (kind === "on") {
      const { slug, initialBrief } = parseSlugAndBrief(rest);
      if (slug) event.slug = slug;
      if (initialBrief || !slug && rest) event.initialBrief = initialBrief ?? rest;
    } else if (kind === "run" || kind === "replan" || kind === "resume") {
      const { slug, initialBrief } = parseSlugAndBrief(rest);
      if (slug) event.slug = slug;
      else if (rest && kind !== "resume") {
        event.slug = rest.split(/\s+/)[0];
      } else if (rest && kind === "resume") {
        const token = rest.split(/\s+/)[0];
        if (token === rest) event.slug = token;
      }
      if (initialBrief && kind !== "resume") event.initialBrief = initialBrief;
    }
    return event;
  }
  const cfg = { ...DEFAULT_TRIGGERS, ...triggers };
  const kinds = [
    { kind: "on", phrases: cfg.on },
    { kind: "run", phrases: cfg.run },
    { kind: "off", phrases: cfg.off },
    { kind: "resume", phrases: cfg.resume },
    { kind: "replan", phrases: cfg.replan },
    { kind: "resume_review", phrases: cfg.resume_review }
  ];
  for (const { kind, phrases } of kinds) {
    const hit = matchTextTrigger(line, phrases);
    if (!hit) continue;
    const event = {
      kind,
      source: "text",
      conversationId,
      projectRoot
    };
    if (kind === "on") {
      const { slug, initialBrief } = parseSlugAndBrief(hit.rest);
      if (slug) event.slug = slug;
      if (initialBrief || !slug && hit.rest) event.initialBrief = initialBrief ?? hit.rest;
    } else if (kind === "run" || kind === "replan" || kind === "resume") {
      const { slug } = parseSlugAndBrief(hit.rest);
      if (slug) event.slug = slug;
      else if (hit.rest && kind !== "resume") {
        event.slug = hit.rest.split(/\s+/)[0];
      } else if (hit.rest && kind === "resume") {
        const token = hit.rest.split(/\s+/)[0];
        if (token === hit.rest) event.slug = token;
      }
    }
    return event;
  }
  if (pendingAction === "run" || pendingAction === "replan") {
    if (/^\d+$/.test(line) || /^[a-z0-9]+(-[a-z0-9]+)*$/.test(line)) {
      return {
        kind: "track_pick",
        source: "text",
        trackPick: line,
        conversationId,
        projectRoot
      };
    }
  }
  return null;
}

// ../core/src/transcript-followup.ts
var TRANSCRIPT_TAIL_BYTES = 512e3;
var TRANSCRIPT_TAIL_EVENTS = 80;
var PENDING_REDELIVER_COOLDOWN_MS = 8e3;
var RECOVER_DEBOUNCE_MS = 3e3;
var BRIEFLY_PREFIX = "Briefly inform the user";
function inRecoverDebounceWindow(at, windowMs) {
  if (!at || !(windowMs > 0)) return false;
  const t = Date.parse(at);
  if (Number.isNaN(t)) return false;
  return Date.now() - t < windowMs;
}
function sleepSyncMs(ms) {
  if (!(ms > 0) || !Number.isFinite(ms)) return;
  const capped = Math.min(Math.floor(ms), 6e4);
  try {
    const sab = new SharedArrayBuffer(4);
    const ia = new Int32Array(sab);
    Atomics.wait(ia, 0, 0, capped);
  } catch {
  }
}
function transcriptTipIsAssistant(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const role = events[i].role;
    if (role === "assistant") return true;
    if (role === "user") return false;
  }
  return false;
}
function readTranscriptTail(transcriptPath) {
  if (!transcriptPath || transcriptPath.includes("\0")) return [];
  let chunk;
  try {
    const nofollow = typeof fs6.constants.O_NOFOLLOW === "number" ? fs6.constants.O_NOFOLLOW : 0;
    const lst = fs6.lstatSync(transcriptPath);
    if (lst.isSymbolicLink() || !lst.isFile()) return [];
    const fd = fs6.openSync(transcriptPath, fs6.constants.O_RDONLY | nofollow);
    try {
      const st = fs6.fstatSync(fd);
      if (!st.isFile()) return [];
      const lst2 = fs6.lstatSync(transcriptPath);
      if (lst2.isSymbolicLink() || !lst2.isFile()) return [];
      if (lst2.ino !== st.ino || lst2.dev !== st.dev) return [];
      const start = Math.max(0, st.size - TRANSCRIPT_TAIL_BYTES);
      const len = st.size - start;
      if (len <= 0) return [];
      const buf = Buffer.alloc(len);
      const n = fs6.readSync(fd, buf, 0, buf.length, start);
      chunk = buf.subarray(0, n).toString("utf8");
    } finally {
      fs6.closeSync(fd);
    }
  } catch {
    return [];
  }
  const events = [];
  for (const line of chunk.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
    }
  }
  return events.slice(-TRANSCRIPT_TAIL_EVENTS);
}
function eventText(obj) {
  const msg = obj.message;
  if (!msg || typeof msg !== "object") return "";
  const content = msg.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = [];
    for (const item of content) {
      if (item && typeof item === "object" && item.type === "text") {
        parts.push(String(item.text ?? ""));
      }
    }
    return parts.join("\n");
  }
  return "";
}
function userQueryText(obj) {
  const text = eventText(obj);
  const open = text.indexOf("<user_query>");
  if (open >= 0) {
    const after = text.slice(open + "<user_query>".length);
    const close = after.indexOf("</user_query>");
    return (close >= 0 ? after.slice(0, close) : after).trim();
  }
  return text.trim();
}
function isDeliveryNoiseUserQuery(query) {
  const q = (query || "").trim();
  if (!q) return false;
  if (q.startsWith(BRIEFLY_PREFIX)) return true;
  if (q.startsWith("\u3010Hook\xB7\u7EED\u8DD1\u3011")) return true;
  return false;
}
function isInFlightUserQuery(query) {
  if (!query) return false;
  if (query.startsWith(BRIEFLY_PREFIX)) return true;
  return isHarnessFollowupMessage(query);
}
function followupInFlight(events) {
  return inFlightUserQuery(events) !== null;
}
function inFlightUserQuery(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    const role = ev.role;
    if (role === "assistant") return null;
    if (role === "user") {
      const q = userQueryText(ev);
      return isInFlightUserQuery(q) ? q : null;
    }
  }
  return null;
}
function automationFollowupPresent(events, message) {
  const needle = message.trim();
  if (!needle) return false;
  const prefix = needle.slice(0, 48);
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.role !== "user") continue;
    const query = userQueryText(ev);
    if (isDeliveryNoiseUserQuery(query)) continue;
    return query === needle || Boolean(prefix) && query.startsWith(prefix);
  }
  return false;
}
function pendingRedeliverAllowed(lastRedeliverAt) {
  if (!lastRedeliverAt) return true;
  const t = Date.parse(lastRedeliverAt);
  if (Number.isNaN(t)) return true;
  return Date.now() - t >= PENDING_REDELIVER_COOLDOWN_MS;
}

// ../core/src/review-engine.ts
function defaultRender(kind, vars) {
  switch (kind) {
    case "review.fix":
      return `Review fix round ${vars.round} (no hard cap; confirm needs ${vars.total} consecutive no-edit rounds). Code changed this turn. Defect-first self-review and fix now: 1) inspect full diff via git diff / git status; 2) check correctness, null/boundaries, concurrency, security, regression, missing tests; 3) CRITICAL/HIGH must fix, MEDIUM preferably; 4) run relevant tests; 5) briefly state what you reviewed and changed (or "self-review clean"). Do not commit/push. If no further code changes, next stop enters multi-lens confirm.`;
    case "review.confirm":
      return `Review confirm ${vars.n}/${vars.total} (session round ${vars.sessionRound}; consecutive no-edit confirms, counted on the fix-round counter). Lens \u3010${vars.lensTitle}\u3011 (multi-lens confirm, not the same checklist again). ${vars.lensFocus} Previous turn had no further code edits. Recheck under this lens only: 1) git diff / git status \u2014 no new edits vs prior turn (or only already-reviewed edits); 2) dig into this lens only; ban vague "fully rechecked, all good"; 3) CRITICAL/HIGH under this lens must fix; MEDIUM preferably; 4) if you edit, fix and run related tests; 5) close with: "Lens (${vars.lensTitle}): self-review clean" or a short list of fixes; if clean, do not edit further. Do not commit/push.`;
    case "review.confirm_final":
      return `Review confirm ${vars.n}/${vars.total} (session round ${vars.sessionRound}; consecutive no-edit confirms, counted on the fix-round counter). Lens \u3010${vars.lensTitle}\u3011 (multi-lens confirm, not the same checklist again). ${vars.lensFocus} Previous turn had no further code edits. Recheck under this lens only: 1) git diff / git status \u2014 no new edits vs prior turn (or only already-reviewed edits); 2) dig into this lens only; ban vague "fully rechecked, all good"; 3) read-only: record CRITICAL/HIGH/missing tests \u2014 do not change code, add tests, or commit; if you already edited, accept returning to a fix round; never commit this turn; 4) do not run commands that mutate the repo; 5) close with: "Lens (${vars.lensTitle}): self-review clean" or list issues (no fixes); if clean, do not edit further. Do not commit/push. Handoff (commit) and next checklist item are handled by Advance/Done after the chain \u2014 not this turn.`;
    case "advance":
      return `Advance checklist: confirm chain passed cleanly (confirm rounds do not commit). First mark the current item [x] in checklist.md. Then, if the working tree still has uncommitted changes for this item (including checklist.md when plans/ is committed), local conventional commit only: git status/diff \u2192 stage only this checklist item's paths; never git add -A, never stage .env/secrets/.autopilot runtime; one conventional commit; no push/--no-verify/amend/force unless the user explicitly asks. If already clean after marking, skip commit. Then implement next: ${vars.nextId ?? ""} \u2014 ${vars.nextTitle ?? ""}.`;
    case "done":
      return `All checklist items done. Confirm chain passed (confirm rounds do not commit). Mark the last item [x]. If the working tree still has uncommitted changes for this item (including checklist.md when plans/ is committed), local conventional commit only (never stage .env/secrets/.autopilot runtime; no push unless the user asks); if clean, just confirm briefly. Phase is done.`;
    case "recover":
      return `Recover: the previous turn ended with an error. Continue the current task.`;
    case "recover_planning":
      return `Recover: the previous turn ended with an error. Continue planning; do not RUN or write product code.`;
    case "recover_ambient":
      return `Recover: the previous turn ended with an error. Continue your current work; Autopilot RUN is not active.`;
    case "review_complete":
      return `Review complete. All ${vars.total ?? 5} confirm rounds passed; the review chain has ended. If the working tree still has uncommitted changes from this session, local commit only per the safe checklist (never stage .env/secrets/.autopilot runtime; no push unless the user asks); if clean, briefly confirm only.`;
    case "stuck":
      return `Stuck: no progress for several stops. Change strategy or send Autopilot RESUME after fixing.`;
    case "verify_fix":
      return `Verify failed (${vars.reason ?? "unknown"}). Fix verify commands and rewrite verify-last.json; do not advance.`;
    default:
      return "";
  }
}
var ReviewEngine = class {
  constructor(store, config) {
    this.store = store;
    this.config = config;
  }
  render(kind, vars) {
    return (this.config.renderFollowup ?? defaultRender)(kind, vars);
  }
  lens(roundIndex) {
    const rounds = this.config.confirmRounds;
    return (this.config.resolveLens ?? getLens)(roundIndex, rounds);
  }
  /**
   * FS trust root: StateStore is authoritative.
   * config.projectRoot must not widen the boundary (mismatched/evil config).
   */
  trustedProjectRoot() {
    return normalizeProjectRoot(this.store.projectRoot) ?? normalizeProjectRoot(this.config.projectRoot);
  }
  /**
   * Parse session checklist only when realpath stays under the project root.
   * O_NOFOLLOW alone cannot stop intermediate directory symlink escapes or a
   * poisoned absolute checklist_path in the session row.
   */
  parseSessionChecklist(session) {
    const checklistPath = session.checklist_path;
    if (!checklistPath) return null;
    const root = this.trustedProjectRoot();
    if (!root || !isRealpathInsideProject(root, checklistPath)) {
      return null;
    }
    try {
      const cl = parseChecklist(checklistPath, { projectRoot: root });
      return {
        unchecked: countUnchecked(cl),
        currentItem: firstUnchecked(cl),
        followingItem: secondUnchecked(cl)
      };
    } catch {
      return null;
    }
  }
  /** E1: afterFileEdit product code → code_edited=1 */
  onCodeEdited(conversationId) {
    this.store.markCodeEdited(conversationId);
  }
  handleStop(input) {
    if (!this.store.isConversationIdOk(input.conversationId)) {
      return null;
    }
    try {
      let session = this.store.getSession(input.conversationId);
      if (!session && input.status === "error" && this.config.reviewScope === "project") {
        ensureAmbientReviewSession(
          this.store,
          input.conversationId,
          this.config.projectRoot,
          this.config.reviewScope
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
      if (!sessionReviewRunnable(session, this.config.reviewScope)) {
        return null;
      }
      const chain = this.store.ensureReviewChain(input.conversationId);
      this.maybeResetErrorCountOnItemChange(session);
      const transcriptPath = input.transcriptPath?.trim() || void 0;
      const events = transcriptPath ? readTranscriptTail(transcriptPath) : [];
      if (chain.code_edited === 1) {
        return this.e2Fix(session, chain);
      }
      const redelivered = this.tryRedeliverPending(
        session.conversation_id,
        chain,
        events,
        transcriptPath
      );
      if (redelivered) return redelivered;
      if (events.length > 0 && followupInFlight(events)) {
        return null;
      }
      if (this.pendingBlocksAdvance(
        session.conversation_id,
        chain,
        events,
        transcriptPath
      )) {
        return null;
      }
      if (chain.confirm_left !== null && chain.confirm_left > 0) {
        return this.e4Confirm(session, chain);
      }
      if (chain.confirm_left === 0 || chain.item_confirm_complete === 1 && chain.confirm_left === null) {
        return this.e5Gate(session, chain);
      }
      const inChain = chain.chain_pending === 1 || input.loopCount > 0 && chain.fix_round > 0 && isChecklistExecuting(session);
      if (chain.confirm_left === null && chain.item_confirm_complete === 0 && inChain) {
        return this.e3ArmConfirm(session, chain);
      }
      return this.e0NoCodeContinue(session, chain);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("No session for conversation") || msg.includes("Invalid conversation id")) {
        return null;
      }
      throw err;
    }
  }
  pendingBlocksAdvance(conversationId, chain, events, transcriptPath) {
    const pending = chain.pending_followup?.trim();
    if (!pending) return false;
    if (events.length > 0 && automationFollowupPresent(events, pending)) {
      try {
        const cleared = this.store.clearPendingFollowupIf(
          conversationId,
          (m) => m.trim() === pending
        );
        if (!cleared) {
          const live = this.store.getReviewChain(conversationId)?.pending_followup?.trim() ?? "";
          if (live && !(events.length > 0 && automationFollowupPresent(events, live))) {
            return true;
          }
        }
      } catch {
      }
      return false;
    }
    if (!transcriptPath) return false;
    return true;
  }
  tryRedeliverPending(conversationId, chain, events, transcriptPath) {
    const pending = chain.pending_followup?.trim();
    if (!pending) return null;
    if (!transcriptPath) return null;
    if (events.length > 0 && automationFollowupPresent(events, pending)) {
      try {
        const cleared = this.store.clearPendingFollowupIf(
          conversationId,
          (m) => m.trim() === pending
        );
        if (cleared) return null;
      } catch {
      }
    }
    if (events.length > 0 && followupInFlight(events)) {
      return null;
    }
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
        if (events.length > 0 && automationFollowupPresent(events, livePending)) {
          this.store.clearPendingFollowupIf(
            conversationId,
            (m) => m.trim() === livePending
          );
          return { commit: true, value: null };
        }
        try {
          this.store.touchPendingRedeliver(conversationId);
        } catch {
        }
        if (!this.sessionRunnable(conversationId)) {
          return { commit: true, value: null };
        }
        const after = this.store.getReviewChain(conversationId)?.pending_followup?.trim() ?? "";
        if (!after) {
          return { commit: true, value: null };
        }
        if (events.length > 0 && automationFollowupPresent(events, after)) {
          this.store.clearPendingFollowupIf(
            conversationId,
            (m) => m.trim() === after
          );
          return { commit: true, value: null };
        }
        return {
          commit: true,
          value: {
            kind: this.inferPendingKind(after),
            message: after,
            loop: true,
            meta: { redeliver: true }
          }
        };
      });
    } catch {
      return null;
    }
  }
  inferPendingKind(message) {
    const m = message.trim();
    if (this.isFixFollowupMessage(m)) return "review.fix";
    if ((m.startsWith("Review confirm") || m.startsWith("\u81EA\u5BA1\u786E\u8BA4")) && (m.includes(`/${this.config.confirmRounds}`) || m.includes("\u7EC8\u5BA1") || m.includes("Read-only") || m.includes("\u53EA\u8BFB"))) {
      const finalRe = new RegExp(
        `(?:Review confirm|\u81EA\u5BA1\u786E\u8BA4)\\s*${this.config.confirmRounds}/${this.config.confirmRounds}`
      );
      if (finalRe.test(m) || m.includes("read-only") || m.includes("Read-only") || m.includes("\u53EA\u8BFB\u7EC8\u5BA1") || m.includes("\u672C\u8F6E\u53EA\u8BFB")) {
        return "review.confirm_final";
      }
    }
    if (m.startsWith("Review confirm") || m.startsWith("\u81EA\u5BA1\u786E\u8BA4")) return "review.confirm";
    if (m.startsWith("Advance") || m.startsWith("\u63A8\u8FDB")) return "advance";
    if (m.startsWith("Review complete") || m.startsWith("\u81EA\u5BA1\u5B8C\u6210")) return "review_complete";
    if (m.startsWith("All checklist") || m.startsWith("\u5168\u90E8\u5B8C\u6210")) return "done";
    if (m.startsWith("Recover") || m.startsWith("\u6062\u590D")) return "recover";
    if (m.startsWith("Stuck") || m.startsWith("\u5361\u4F4F")) return "stuck";
    if (m.startsWith("Verify failed") || m.startsWith("\u6821\u9A8C\u5931\u8D25")) return "verify_fix";
    return "review.confirm";
  }
  emit(conversationId, action) {
    try {
      const armChain = action.kind !== "recover" && action.kind !== "recover_planning" && action.kind !== "recover_ambient";
      this.store.savePendingFollowup(conversationId, action.message, { armChain });
    } catch {
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
  handleAbortedStop(session) {
    try {
      const cid2 = session.conversation_id;
      this.store.exclusiveWrite(() => {
        this.store.clearPendingFollowupIf(cid2, isRecoverOrStuckFollowupMessage);
        this.store.clearCodeEdited(cid2);
        return { commit: true, value: void 0 };
      });
    } catch {
    }
    return null;
  }
  handleErrorStop(session, input) {
    const nextCount = session.error_count + 1;
    const maxErrors = this.config.maxErrorsBeforePause;
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
          armed: 0
        });
        return null;
      }
      this.store.upsertSession({
        conversation_id: session.conversation_id,
        project_root: session.project_root,
        code_root: session.code_root,
        error_count: nextCount,
        last_error: input.status
      });
    } catch {
      if (shouldPause) {
        if (session.armed === 1 && session.phase === "executing" && session.paused === 0) {
          try {
            this.store.exclusiveWrite(() => {
              this.store.pauseSessionForRepeatedErrors(
                session.conversation_id,
                nextCount,
                input.status
              );
              this.store.neutralizeReviewChain(session.conversation_id);
              this.store.disarmSession(session.conversation_id);
              return { commit: true, value: void 0 };
            });
          } catch {
            try {
              this.store.pauseSessionForRepeatedErrors(
                session.conversation_id,
                nextCount,
                input.status
              );
            } catch {
            }
            try {
              this.store.neutralizeReviewChain(session.conversation_id);
            } catch {
            }
            try {
              this.store.disarmSession(session.conversation_id);
            } catch {
            }
          }
          return {
            kind: "stuck",
            message: this.render("stuck", {}),
            loop: false
          };
        }
        return null;
      }
    }
    const fresh = this.store.getSession(session.conversation_id);
    if (fresh && this.sessionErrorRecoverable(fresh)) {
      return this.debouncedErrorRecover(fresh, input);
    }
    return null;
  }
  resolveRecoverDebounceMs() {
    const n = this.config.recoverDebounceMs;
    if (n === void 0) return RECOVER_DEBOUNCE_MS;
    if (!Number.isFinite(n) || n < 0) return RECOVER_DEBOUNCE_MS;
    return Math.min(Math.floor(n), 6e4);
  }
  sleepRecoverDebounce(ms) {
    try {
      (this.config.sleepSync ?? sleepSyncMs)(ms);
    } catch {
    }
  }
  /**
   * Error recover: claim under exclusiveWrite → sleep debounce → emit at most
   * once per window. Concurrent error stops in the same window coalesce to null.
   * Outside the window, if still dead, redeliver once (new window).
   * Emit ownership is CAS'd on `pending_followup_at` so claimer+redeliver
   * cannot both return followup_message after overlapping sleeps.
   */
  debouncedErrorRecover(session, input) {
    const recoverKind = this.recoverKindForPhase(session.phase);
    const message = this.render(recoverKind, {}).trim();
    if (!message || message.includes("\0")) {
      return null;
    }
    const action = {
      kind: "recover",
      message,
      loop: true
    };
    const cid2 = session.conversation_id;
    const ambient = !isChecklistExecuting(session);
    const debounceMs = this.resolveRecoverDebounceMs();
    const transcriptPath = input.transcriptPath?.trim() || void 0;
    let recoverAnsweredAtClaim = false;
    if (transcriptPath) {
      const tipEvents = readTranscriptTail(transcriptPath);
      const inflight = inFlightUserQuery(tipEvents);
      if (inflight && !isRecoverFollowupMessage(inflight)) {
        return null;
      }
      recoverAnsweredAtClaim = tipEvents.length > 0 && transcriptTipIsAssistant(tipEvents) && automationFollowupPresent(tipEvents, message);
    }
    const claim = this.tryClaimErrorRecoverWindow(
      cid2,
      message,
      debounceMs,
      ambient,
      recoverAnsweredAtClaim
    );
    if (claim.role === "coalesced") {
      return null;
    }
    if (claim.role === "failed") {
      return this.compensateFailedErrorRecoverClaim(cid2, message, action, ambient);
    }
    this.sleepRecoverDebounce(debounceMs);
    return this.finishErrorRecoverAfterDebounce(
      cid2,
      message,
      transcriptPath,
      claim.stamp,
      recoverAnsweredAtClaim
    );
  }
  /**
   * Claim the recover inject slot for this error storm.
   * - coalesced: another stop already owns the window → do not emit
   * - claimer/redeliver: pending written; `stamp` is pending_followup_at for CAS emit
   * - failed: exclusiveWrite threw
   */
  tryClaimErrorRecoverWindow(conversationId, message, debounceMs, ambient, recoverAnsweredAtClaim = false) {
    try {
      return this.store.exclusiveWrite(() => {
        const session = this.store.getSession(conversationId);
        if (!session || !this.sessionErrorRecoverable(session)) {
          return { commit: false, value: { role: "failed" } };
        }
        this.store.ensureReviewChain(conversationId);
        const chain = this.store.getReviewChain(conversationId);
        let pending = chain?.pending_followup?.trim() ?? "";
        const inWindow = isRecoverFollowupMessage(pending) && inRecoverDebounceWindow(chain?.pending_followup_at, debounceMs);
        if (recoverAnsweredAtClaim && isRecoverFollowupMessage(pending) && !inWindow) {
          this.store.clearPendingFollowupIf(
            conversationId,
            (m) => isRecoverFollowupMessage(m)
          );
          pending = "";
        }
        if (inWindow) {
          return { commit: true, value: { role: "coalesced" } };
        }
        if (isRecoverFollowupMessage(pending)) {
          this.store.savePendingFollowup(conversationId, message, {
            armChain: false
          });
          const stamp2 = this.store.getReviewChain(conversationId)?.pending_followup_at ?? "";
          if (!stamp2) {
            return { commit: false, value: { role: "failed" } };
          }
          this.store.clearChainPending(conversationId);
          this.armRecoverClaimRedeliverHold(conversationId, debounceMs);
          return {
            commit: true,
            value: { role: "redeliver", stamp: stamp2 }
          };
        }
        if (ambient) {
          this.applySoftResetAmbientChainForErrorRecover(conversationId);
        }
        this.store.savePendingFollowup(conversationId, message, {
          armChain: false
        });
        const stamp = this.store.getReviewChain(conversationId)?.pending_followup_at ?? "";
        if (!stamp) {
          return { commit: false, value: { role: "failed" } };
        }
        this.store.clearChainPending(conversationId);
        this.armRecoverClaimRedeliverHold(conversationId, debounceMs);
        return {
          commit: true,
          value: { role: "claimer", stamp }
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
  finishErrorRecoverAfterDebounce(conversationId, message, transcriptPath, expectedStamp, recoverAnsweredAtClaim = false) {
    if (!expectedStamp) {
      return null;
    }
    const fresh = this.store.getSession(conversationId);
    if (!fresh || !this.sessionErrorRecoverable(fresh)) {
      this.clearRecoverPendingBestEffort(conversationId);
      return null;
    }
    const live = this.store.getReviewChain(conversationId)?.pending_followup?.trim() ?? "";
    if (!isRecoverFollowupMessage(live)) {
      return null;
    }
    const needle = live || message;
    const events = transcriptPath ? readTranscriptTail(transcriptPath) : [];
    if (events.length > 0) {
      if (followupInFlight(events)) {
        try {
          this.store.clearPendingRedeliverHoldIfStamp(
            conversationId,
            expectedStamp
          );
        } catch {
        }
        return null;
      }
      if (!recoverAnsweredAtClaim && transcriptTipIsAssistant(events) && automationFollowupPresent(events, needle)) {
        this.clearRecoverPendingBestEffort(conversationId);
        return null;
      }
    }
    const emitted = this.tryCasRecoverEmit(
      conversationId,
      expectedStamp,
      needle
    );
    if (!emitted) return null;
    return this.recoverActionIfStillRunnable(conversationId, emitted);
  }
  /**
   * Atomically take emit ownership: only the stop whose claim stamp still
   * matches may return followup. Winner bumps pending_followup_at so a racing
   * redeliver lands in-window and coalesces instead of double-injecting.
   */
  tryCasRecoverEmit(conversationId, expectedStamp, fallbackMessage) {
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
          this.store.clearPendingFollowupIf(
            conversationId,
            (m) => isRecoverFollowupMessage(m)
          );
          return { commit: true, value: null };
        }
        if (!this.store.casBumpPendingFollowupAt(conversationId, expectedStamp)) {
          return { commit: false, value: null };
        }
        this.store.clearChainPending(conversationId);
        return {
          commit: true,
          value: {
            kind: "recover",
            message: live || fallbackMessage,
            loop: true
          }
        };
      });
    } catch {
      return null;
    }
  }
  clearRecoverPendingBestEffort(conversationId) {
    try {
      this.store.clearPendingFollowupIf(
        conversationId,
        (m) => isRecoverFollowupMessage(m)
      );
    } catch {
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
  armRecoverClaimRedeliverHold(conversationId, holdMs) {
    if (!(holdMs > 0) || !Number.isFinite(holdMs)) return;
    const cooldown = PENDING_REDELIVER_COOLDOWN_MS;
    const hold = Math.min(Math.floor(holdMs), 6e4);
    if (!(hold > 0)) return;
    const at = new Date(Date.now() - (cooldown - hold)).toISOString();
    this.store.setPendingRedeliverHold(conversationId, at);
  }
  /**
   * Last-resort when tryClaimErrorRecoverWindow's exclusiveWrite failed.
   * Retries ambient soft-reset+pending up to 3×; then column-only disarm +
   * emitRecover (never unlocked neutralize/soft-reset, never full-neutralize
   * after transient lock failures — that wiped mid-confirm confirm_left).
   * Skip wipe/emit when recover pending already exists.
   */
  compensateFailedErrorRecoverClaim(conversationId, message, action, ambient) {
    const recoverPending = () => {
      try {
        const pending = this.store.getReviewChain(conversationId)?.pending_followup?.trim() ?? "";
        return isRecoverFollowupMessage(pending);
      } catch {
        return false;
      }
    };
    if (!this.sessionStillErrorRecoverable(conversationId)) {
      return null;
    }
    if (recoverPending()) {
      return null;
    }
    if (ambient) {
      for (let i = 0; i < 3; i++) {
        const committed = this.tryCommitAmbientErrorRecover(
          conversationId,
          message
        );
        if (committed === "ok") {
          return this.recoverActionIfStillRunnable(conversationId, action);
        }
        if (committed === "exists") return null;
      }
      if (!this.sessionStillErrorRecoverable(conversationId)) {
        return null;
      }
      if (recoverPending()) {
        return null;
      }
      try {
        this.store.clearChainPending(conversationId);
      } catch {
      }
    }
    if (!this.sessionStillErrorRecoverable(conversationId)) {
      return null;
    }
    const emitted = this.emitRecoverAfterFailedClaim(conversationId, action, {
      ambientSoftReset: ambient
    });
    if (!emitted) return null;
    return this.recoverActionIfStillRunnable(conversationId, emitted);
  }
  /** After a successful compensate write, drop recover if session paused mid-flight. */
  recoverActionIfStillRunnable(conversationId, action) {
    if (this.sessionStillErrorRecoverable(conversationId)) {
      return action;
    }
    this.clearRecoverPendingBestEffort(conversationId);
    return null;
  }
  sessionStillErrorRecoverable(conversationId) {
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
  emitRecoverAfterFailedClaim(conversationId, action, opts) {
    const ambientSoftReset = opts?.ambientSoftReset === true;
    try {
      return this.store.exclusiveWrite(() => {
        const session = this.store.getSession(conversationId);
        if (!session || !this.sessionErrorRecoverable(session)) {
          return { commit: false, value: null };
        }
        const pending = this.store.getReviewChain(conversationId)?.pending_followup?.trim() ?? "";
        if (isRecoverFollowupMessage(pending)) {
          return { commit: false, value: null };
        }
        if (ambientSoftReset) {
          this.applySoftResetAmbientChainForErrorRecover(conversationId);
        }
        this.store.savePendingFollowup(conversationId, action.message, {
          armChain: false
        });
        const live = this.store.getReviewChain(conversationId)?.pending_followup?.trim() ?? "";
        if (!isRecoverFollowupMessage(live)) {
          return { commit: false, value: null };
        }
        this.store.clearChainPending(conversationId);
        return { commit: true, value: action };
      });
    } catch {
      if (!this.sessionStillErrorRecoverable(conversationId)) {
        return null;
      }
      try {
        const pending = this.store.getReviewChain(conversationId)?.pending_followup?.trim() ?? "";
        if (isRecoverFollowupMessage(pending)) {
          return null;
        }
      } catch {
      }
      this.emit(conversationId, action);
      try {
        this.store.clearChainPending(conversationId);
      } catch {
      }
      try {
        const live = this.store.getReviewChain(conversationId)?.pending_followup?.trim() ?? "";
        if (isRecoverFollowupMessage(live)) {
          return action;
        }
      } catch {
      }
      return null;
    }
  }
  /**
   * Ambient error recover write: soft-reset + recover pending under one
   * exclusiveWrite. "exists" = peer already claimed recover (do not overwrite).
   */
  tryCommitAmbientErrorRecover(conversationId, message) {
    try {
      return this.store.exclusiveWrite(() => {
        const session = this.store.getSession(conversationId);
        if (!session || !this.sessionErrorRecoverable(session)) {
          return { commit: false, value: "failed" };
        }
        const pending = this.store.getReviewChain(conversationId)?.pending_followup?.trim() ?? "";
        if (isRecoverFollowupMessage(pending)) {
          return { commit: false, value: "exists" };
        }
        this.applySoftResetAmbientChainForErrorRecover(conversationId);
        this.store.savePendingFollowup(conversationId, message, {
          armChain: false
        });
        const live = this.store.getReviewChain(conversationId)?.pending_followup?.trim() ?? "";
        const stamp = this.store.getReviewChain(conversationId)?.pending_followup_at ?? "";
        if (!stamp || !isRecoverFollowupMessage(live)) {
          return { commit: false, value: "failed" };
        }
        return { commit: true, value: "ok" };
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
  applySoftResetAmbientChainForErrorRecover(conversationId) {
    this.store.ensureReviewChain(conversationId);
    const chain = this.store.getReviewChain(conversationId);
    if (!chain) return;
    if (isRecoverFollowupMessage(chain.pending_followup?.trim() ?? "")) {
      return;
    }
    const atE5 = chain.confirm_left === 0 || chain.item_confirm_complete === 1 && chain.confirm_left === null;
    const midConfirm = chain.confirm_left !== null && chain.confirm_left > 0;
    const pending = chain.pending_followup?.trim() ?? "";
    const fixPending = this.isFixFollowupMessage(pending);
    const readyForE3 = !atE5 && !midConfirm && chain.chain_pending === 1 && chain.code_edited === 0 && pending.length === 0;
    const resumeFix = !atE5 && !midConfirm && !readyForE3 && (chain.chain_pending === 1 || chain.code_edited === 1 || fixPending);
    const rounds = this.config.confirmRounds;
    this.store.softResetAmbientChainUnlessRecover(conversationId, {
      confirm_left: atE5 || midConfirm ? chain.confirm_left : readyForE3 && rounds > 0 ? rounds : null,
      item_confirm_complete: atE5 ? chain.item_confirm_complete : 0,
      chain_pending: 0,
      // Preserve an in-flight edit marker (E2 wins over E4); else force only for mid-fix.
      code_edited: resumeFix || chain.code_edited === 1 ? 1 : 0
    });
  }
  /** Shared with inferPendingKind — locale templates must keep these prefixes. */
  isFixFollowupMessage(message) {
    const m = message.trim();
    return m.startsWith("Review fix") || m.startsWith("\u81EA\u5BA1\u4FEE\u590D");
  }
  /** True when a stop may still advance the review chain (re-check under write lock). */
  sessionRunnable(conversationId) {
    const s = this.store.getSession(conversationId);
    return !!s && sessionReviewRunnable(s, this.config.reviewScope);
  }
  /** Genuine error stop may inject recover (planning, project ambient, or armed executing). */
  sessionErrorRecoverable(session) {
    if (session.paused !== 0) return false;
    if (session.phase === "planning") return true;
    if (session.phase === "idle" && session.armed === 1 && this.config.reviewScope === "project") {
      return true;
    }
    return session.phase === "executing" && session.armed === 1;
  }
  recoverKindForPhase(phase) {
    if (phase === "planning") return "recover_planning";
    if (phase === "idle") return "recover_ambient";
    return "recover";
  }
  /** completed stop → reset error_count */
  noteCompletedOk(session) {
    if (session.error_count > 0) {
      this.store.upsertSession({
        conversation_id: session.conversation_id,
        project_root: session.project_root,
        code_root: session.code_root,
        error_count: 0,
        last_error: null
      });
    }
  }
  maybeResetErrorCountOnItemChange(_session) {
  }
  /**
   * E0': checklist executing, not in fix/confirm — skip lenses when there is no
   * product code edit. Soft/verified success advances in one IMMEDIATE txn with
   * evidence re-check (never arm at-E5 first). Only required-verify *fail*
   * arms at-E5 to reuse E5c verify_fix / stuck.
   */
  e0NoCodeContinue(session, chain) {
    if (!isChecklistExecuting(session)) return null;
    if (chain.code_edited === 1 || chain.confirm_left !== null || chain.item_confirm_complete === 1 || chain.chain_pending === 1) {
      return null;
    }
    const parsed = this.parseSessionChecklist(session);
    if (!parsed?.currentItem) return null;
    const trustRoot = this.trustedProjectRoot();
    const reportPath = this.config.verifyReportPath ?? defaultVerifyReportPath(trustRoot ?? "");
    const checklistPath = session.checklist_path || "";
    const evalResult = evaluateVerifyReport({
      enabled: this.config.verifyEnabled,
      commands: this.config.verifyCommands,
      reportPath,
      currentItem: parsed.currentItem,
      checklistPath,
      projectRoot: trustRoot ?? void 0
    });
    if (evalResult.outcome === "skip") {
      return this.e0DirectAdvance(session, reportPath, parsed.currentItem.id, {
        kind: "soft"
      });
    }
    if (evalResult.outcome === "pass") {
      return this.e0DirectAdvance(session, reportPath, parsed.currentItem.id, {
        kind: "verified",
        checklistPath
      });
    }
    if (!this.armAtE5ForNoCode(session.conversation_id)) return null;
    const fresh = this.store.getReviewChain(session.conversation_id);
    const sess = this.store.getSession(session.conversation_id);
    if (!fresh || !sess) {
      this.disarmE5NoCode(session.conversation_id);
      return null;
    }
    const action = this.e5Gate(sess, fresh);
    if (!action) {
      this.disarmE5NoCode(session.conversation_id);
      return null;
    }
    if (action.kind === "advance") {
      const cid2 = session.conversation_id;
      try {
        this.store.exclusiveWrite(() => {
          const live = this.store.getReviewChain(cid2);
          if (!live || live.chain_pending !== 1 || live.code_edited === 1 || live.confirm_left !== null || live.item_confirm_complete !== 0) {
            return { commit: false, value: void 0 };
          }
          this.store.updateReviewChain(cid2, { chain_pending: 0 });
          return { commit: true, value: void 0 };
        });
      } catch {
      }
    }
    return action;
  }
  /**
   * E0 direct advance/done: re-check soft or verified evidence under one
   * IMMEDIATE write — never enters the confirm/E5 state machine.
   */
  e0DirectAdvance(session, reportPath, expectedItemId, evidence) {
    const cid2 = session.conversation_id;
    const trustRoot = this.trustedProjectRoot();
    const action = this.store.exclusiveWrite(() => {
      if (!this.sessionRunnable(cid2)) {
        return { commit: false, value: null };
      }
      const lockedSession = this.store.getSession(cid2);
      if (!lockedSession || !isChecklistExecuting(lockedSession)) {
        return { commit: false, value: null };
      }
      const fresh = this.store.getReviewChain(cid2);
      if (!fresh || fresh.code_edited === 1 || fresh.confirm_left !== null || fresh.item_confirm_complete === 1 || fresh.chain_pending === 1) {
        return { commit: false, value: null };
      }
      const refreshed = this.parseSessionChecklist(lockedSession);
      if (!refreshed?.currentItem || refreshed.currentItem.id !== expectedItemId) {
        return { commit: false, value: null };
      }
      if (evidence.kind === "soft") {
        if (!hasNoCodeCompletionEvidence({
          reportPath,
          currentItemId: refreshed.currentItem.id,
          projectRoot: trustRoot ?? void 0
        })) {
          return { commit: false, value: null };
        }
      } else {
        const lockedChecklistPath = lockedSession.checklist_path?.trim() || evidence.checklistPath;
        const lockedEval = evaluateVerifyReport({
          enabled: this.config.verifyEnabled,
          commands: this.config.verifyCommands,
          reportPath,
          currentItem: refreshed.currentItem,
          checklistPath: lockedChecklistPath,
          projectRoot: trustRoot ?? void 0
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
      const message = isAdvance ? this.render("advance", {
        nextId: following?.id ?? "",
        nextTitle: following?.title ?? ""
      }) : this.render("done", {});
      const out = {
        kind: isAdvance ? "advance" : "done",
        message,
        loop: true
      };
      const chainReset = {
        confirm_left: null,
        fix_round: 0,
        code_edited: 0,
        item_confirm_complete: 0
      };
      if (isAdvance) {
        this.store.upsertSession({
          conversation_id: cid2,
          project_root: lockedSession.project_root,
          code_root: lockedSession.code_root,
          error_count: 0,
          idle_stop_count: 0,
          last_error: null
        });
        this.store.updateReviewChain(cid2, {
          ...chainReset,
          pending_followup: message,
          pending_followup_at: (/* @__PURE__ */ new Date()).toISOString(),
          pending_redeliver_at: null,
          chain_pending: 0
        });
      } else {
        this.store.upsertSession({
          conversation_id: cid2,
          project_root: lockedSession.project_root,
          code_root: lockedSession.code_root,
          phase: "done",
          armed: 0,
          error_count: 0,
          idle_stop_count: 0,
          last_error: null
        });
        this.store.updateReviewChain(cid2, {
          ...chainReset,
          pending_followup: message,
          pending_followup_at: (/* @__PURE__ */ new Date()).toISOString(),
          pending_redeliver_at: null,
          chain_pending: 0
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
  armAtE5ForNoCode(conversationId) {
    return this.store.exclusiveWrite(() => {
      if (!this.sessionRunnable(conversationId)) {
        return { commit: false, value: false };
      }
      const sess = this.store.getSession(conversationId);
      if (!sess || !isChecklistExecuting(sess)) {
        return { commit: false, value: false };
      }
      const fresh = this.store.getReviewChain(conversationId);
      if (!fresh || fresh.code_edited === 1 || fresh.confirm_left !== null || fresh.item_confirm_complete === 1 || fresh.chain_pending === 1) {
        return { commit: false, value: false };
      }
      this.store.updateReviewChain(conversationId, {
        confirm_left: 0,
        item_confirm_complete: 1,
        chain_pending: 0
      });
      return { commit: true, value: true };
    }) === true;
  }
  /** Undo a failed arm so the next stop cannot skip soft evidence via E5. */
  disarmE5NoCode(conversationId) {
    try {
      this.store.exclusiveWrite(() => {
        const fresh = this.store.getReviewChain(conversationId);
        if (!fresh || fresh.code_edited === 1 || fresh.confirm_left !== 0 || fresh.item_confirm_complete !== 1) {
          return { commit: false, value: void 0 };
        }
        if (fresh.pending_followup?.trim()) {
          return { commit: false, value: void 0 };
        }
        this.store.updateReviewChain(conversationId, {
          confirm_left: null,
          item_confirm_complete: 0,
          chain_pending: 0
        });
        return { commit: true, value: void 0 };
      });
    } catch {
    }
  }
  /** Session-monotonic round counter (fix + confirm share fix_round; no hard cap). */
  nextSessionRound(chain) {
    return chain.fix_round + 1;
  }
  e2Fix(session, _chain) {
    const rounds = this.config.confirmRounds;
    const cid2 = session.conversation_id;
    const action = this.store.exclusiveWrite(() => {
      if (!this.sessionRunnable(cid2)) {
        return { commit: false, value: null };
      }
      const fresh = this.store.getReviewChain(cid2);
      if (!fresh || fresh.code_edited !== 1) {
        return { commit: false, value: null };
      }
      const fixRound = this.nextSessionRound(fresh);
      const message = this.render("review.fix", { round: fixRound, total: rounds });
      const out = {
        kind: "review.fix",
        message,
        loop: true,
        meta: { fixRound }
      };
      this.store.updateReviewChain(cid2, {
        fix_round: fixRound,
        code_edited: 0,
        confirm_left: null,
        chain_pending: 1,
        // item_confirm_complete preserved (E2 path)
        pending_followup: message,
        pending_followup_at: (/* @__PURE__ */ new Date()).toISOString(),
        pending_redeliver_at: null
      });
      return { commit: true, value: out };
    });
    if (action) {
      this.afterFollowupCommitted(session, {});
    }
    return action;
  }
  e3ArmConfirm(session, _chain) {
    const rounds = this.config.confirmRounds;
    const lens = this.lens(1);
    const left = rounds - 1;
    const kind = rounds === 1 ? "review.confirm_final" : "review.confirm";
    const cid2 = session.conversation_id;
    const action = this.store.exclusiveWrite(() => {
      if (!this.sessionRunnable(cid2)) {
        return { commit: false, value: null };
      }
      const fresh = this.store.getReviewChain(cid2);
      if (!fresh || fresh.code_edited === 1 || fresh.confirm_left !== null || fresh.item_confirm_complete === 1) {
        return { commit: false, value: null };
      }
      const sessionRound = this.nextSessionRound(fresh);
      const message = this.render(kind, {
        n: 1,
        total: rounds,
        sessionRound,
        lensTitle: lens.title,
        lensFocus: lens.focus
      });
      const out = {
        kind,
        message,
        loop: true,
        meta: { n: 1, total: rounds, sessionRound }
      };
      this.store.updateReviewChain(cid2, {
        confirm_left: left,
        chain_pending: 1,
        fix_round: sessionRound,
        pending_followup: message,
        pending_followup_at: (/* @__PURE__ */ new Date()).toISOString(),
        pending_redeliver_at: null
      });
      return { commit: true, value: out };
    });
    if (action) {
      this.afterFollowupCommitted(session, { confirm_left: left });
    }
    return action;
  }
  e4Confirm(session, chain) {
    const rounds = this.config.confirmRounds;
    const expectedLeft = chain.confirm_left;
    if (expectedLeft === null || expectedLeft <= 0) return null;
    const n = rounds - expectedLeft + 1;
    const lens = this.lens(n);
    const newLeft = expectedLeft - 1;
    const isFinal = n === rounds;
    const kind = isFinal ? "review.confirm_final" : "review.confirm";
    const cid2 = session.conversation_id;
    const action = this.store.exclusiveWrite(() => {
      if (!this.sessionRunnable(cid2)) {
        return { commit: false, value: null };
      }
      const fresh = this.store.getReviewChain(cid2);
      if (!fresh || fresh.code_edited === 1 || fresh.confirm_left !== expectedLeft) {
        return { commit: false, value: null };
      }
      const sessionRound = this.nextSessionRound(fresh);
      const message = this.render(kind, {
        n,
        total: rounds,
        sessionRound,
        lensTitle: lens.title,
        lensFocus: lens.focus
      });
      const out = {
        kind,
        message,
        loop: true,
        meta: { n, total: rounds, confirm_left: newLeft, sessionRound }
      };
      this.store.updateReviewChain(cid2, {
        confirm_left: newLeft,
        chain_pending: 1,
        fix_round: sessionRound,
        pending_followup: message,
        pending_followup_at: (/* @__PURE__ */ new Date()).toISOString(),
        pending_redeliver_at: null
      });
      return { commit: true, value: out };
    });
    if (action) {
      this.afterFollowupCommitted(session, { confirm_left: newLeft });
    }
    return action;
  }
  e5Gate(session, _chain) {
    if (this.config.reviewScope === "project" && !isChecklistExecuting(session)) {
      return this.e5bAdvance(session, {
        unchecked: 0,
        next: null,
        verifiedPass: false
      });
    }
    const checklistPath = session.checklist_path;
    let currentItem = null;
    let unchecked = 0;
    if (checklistPath) {
      const parsed = this.parseSessionChecklist(session);
      if (!parsed) {
        return null;
      }
      unchecked = parsed.unchecked;
      currentItem = parsed.currentItem;
    }
    if (unchecked === 0) {
      return this.e5bAdvance(session, {
        unchecked: 0,
        next: null,
        verifiedPass: false
      });
    }
    if (!currentItem) {
      return null;
    }
    const trustRoot = this.trustedProjectRoot();
    const reportPath = this.config.verifyReportPath ?? defaultVerifyReportPath(trustRoot ?? "");
    const evalResult = evaluateVerifyReport({
      enabled: this.config.verifyEnabled,
      commands: this.config.verifyCommands,
      reportPath,
      currentItem,
      checklistPath: checklistPath || "",
      projectRoot: trustRoot ?? void 0
    });
    if (evalResult.outcome === "fail") {
      const reason = evalResult.reason ?? "fail";
      const cid2 = session.conversation_id;
      return this.store.exclusiveWrite(() => {
        const fresh = this.store.getReviewChain(cid2);
        const atE5 = !!fresh && (fresh.confirm_left === 0 || fresh.item_confirm_complete === 1 && fresh.confirm_left === null);
        if (!atE5) {
          return { commit: false, value: null };
        }
        const sess = this.store.getSession(cid2);
        if (!sess || !isChecklistExecuting(sess)) {
          return { commit: false, value: null };
        }
        let lockedItem = currentItem;
        const lockedPath = checklistPath || "";
        if (checklistPath) {
          const locked = this.parseSessionChecklist(sess);
          if (!locked) {
            return { commit: false, value: null };
          }
          if (locked.unchecked === 0) {
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
          projectRoot: this.trustedProjectRoot() ?? void 0
        });
        if (lockedEval.outcome !== "fail") {
          return { commit: false, value: null };
        }
        const failReason = lockedEval.reason ?? reason;
        const nextIdle = sess.idle_stop_count + 1;
        const nowStuck = nextIdle >= this.config.maxIdleStops;
        if (nowStuck) {
          this.store.upsertSession({
            conversation_id: cid2,
            project_root: sess.project_root,
            code_root: sess.code_root,
            idle_stop_count: nextIdle,
            paused: 1,
            paused_reason: "stuck",
            armed: 0
          });
        } else {
          this.store.upsertSession({
            conversation_id: cid2,
            project_root: sess.project_root,
            code_root: sess.code_root,
            idle_stop_count: nextIdle
          });
        }
        const kind = nowStuck ? "stuck" : "verify_fix";
        const message = this.render(kind, nowStuck ? {} : { reason: failReason });
        this.store.updateReviewChain(cid2, {
          confirm_left: 0,
          item_confirm_complete: 1,
          chain_pending: 1,
          pending_followup: message,
          pending_followup_at: (/* @__PURE__ */ new Date()).toISOString(),
          pending_redeliver_at: null
        });
        const out = {
          kind,
          message,
          loop: true,
          meta: { reason: failReason }
        };
        return { commit: true, value: out };
      });
    }
    return this.e5bAdvance(session, {
      unchecked,
      next: currentItem,
      verifiedPass: evalResult.outcome === "pass"
    });
  }
  e5bAdvance(session, checklist) {
    const cid2 = session.conversation_id;
    const chainReset = {
      confirm_left: null,
      fix_round: 0,
      code_edited: 0,
      item_confirm_complete: 0
    };
    return this.store.exclusiveWrite(() => {
      const fresh = this.store.getReviewChain(cid2);
      const atE5 = !!fresh && (fresh.confirm_left === 0 || fresh.item_confirm_complete === 1 && fresh.confirm_left === null);
      if (!atE5) {
        return { commit: false, value: null };
      }
      const lockedSession = this.store.getSession(cid2);
      if (!lockedSession || !sessionReviewRunnable(lockedSession, this.config.reviewScope)) {
        return { commit: false, value: null };
      }
      let unchecked = checklist.unchecked;
      let next = checklist.next;
      let following = null;
      const path9 = lockedSession.checklist_path?.trim() ?? "";
      const onChecklistPath = isChecklistExecuting(lockedSession) && path9.length > 0;
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
      if (!onChecklistPath) {
        if (isChecklistExecuting(lockedSession)) {
        } else if (this.config.reviewScope === "project") {
          const completeMsg = this.render("review_complete", {
            total: this.config.confirmRounds
          });
          const completeAction = {
            kind: "review_complete",
            message: completeMsg,
            loop: true
          };
          this.store.upsertSession({
            conversation_id: cid2,
            project_root: lockedSession.project_root,
            code_root: lockedSession.code_root,
            error_count: 0,
            idle_stop_count: 0,
            last_error: null
          });
          this.store.updateReviewChain(cid2, {
            ...chainReset,
            pending_followup: completeMsg,
            pending_followup_at: (/* @__PURE__ */ new Date()).toISOString(),
            pending_redeliver_at: null,
            chain_pending: 0
          });
          return { commit: true, value: completeAction };
        } else {
          return { commit: false, value: null };
        }
      }
      const verifyArmed = this.config.verifyEnabled && this.config.verifyCommands.some((c) => c.required === true);
      if (verifyArmed) {
        const foresawDone = checklist.unchecked === 0;
        if (foresawDone && unchecked > 0) {
          return { commit: false, value: null };
        }
        if (checklist.verifiedPass && checklist.next != null && (unchecked === 0 || next?.id !== checklist.next.id)) {
          return { commit: false, value: null };
        }
      }
      const isAdvance = unchecked > 1;
      if (isAdvance && !following) {
        return { commit: false, value: null };
      }
      const message = isAdvance ? this.render("advance", {
        nextId: following?.id ?? "",
        nextTitle: following?.title ?? ""
      }) : this.render("done", {});
      const action = {
        kind: isAdvance ? "advance" : "done",
        message,
        loop: true
      };
      if (isAdvance) {
        this.store.upsertSession({
          conversation_id: cid2,
          project_root: session.project_root,
          code_root: session.code_root,
          error_count: 0,
          idle_stop_count: 0,
          last_error: null
        });
        this.store.updateReviewChain(cid2, {
          ...chainReset,
          pending_followup: message,
          pending_followup_at: (/* @__PURE__ */ new Date()).toISOString(),
          pending_redeliver_at: null,
          chain_pending: 1
        });
      } else {
        this.store.upsertSession({
          conversation_id: cid2,
          project_root: session.project_root,
          code_root: session.code_root,
          phase: "done",
          armed: 0,
          error_count: 0,
          idle_stop_count: 0,
          last_error: null
        });
        this.store.updateReviewChain(cid2, {
          ...chainReset,
          pending_followup: message,
          pending_followup_at: (/* @__PURE__ */ new Date()).toISOString(),
          pending_redeliver_at: null,
          chain_pending: 0
        });
      }
      return { commit: true, value: action };
    });
  }
  bumpProgress(session, _changed) {
    if (session.idle_stop_count > 0) {
      this.store.upsertSession({
        conversation_id: session.conversation_id,
        project_root: session.project_root,
        code_root: session.code_root,
        idle_stop_count: 0
      });
    }
  }
  /**
   * Best-effort session bookkeeping after a followup was already committed
   * (pending_followup in exclusiveWrite). Must not throw into handleStop's
   * soft-fail catch — that would drop the committed action from the hook reply.
   */
  afterFollowupCommitted(session, changed) {
    try {
      this.bumpProgress(session, changed);
      this.noteCompletedOk(session);
    } catch {
    }
  }
  incrementIdle(session) {
    const next = session.idle_stop_count + 1;
    if (next >= this.config.maxIdleStops) {
      this.store.upsertSession({
        conversation_id: session.conversation_id,
        project_root: session.project_root,
        code_root: session.code_root,
        idle_stop_count: next,
        paused: 1,
        paused_reason: "stuck",
        armed: 0
      });
    } else {
      this.store.upsertSession({
        conversation_id: session.conversation_id,
        project_root: session.project_root,
        code_root: session.code_root,
        idle_stop_count: next
      });
    }
  }
  /** After a no-progress stop that didn't inject, check stuck threshold. */
  checkStuck(session) {
    const fresh = this.store.getSession(session.conversation_id);
    if (!fresh) return null;
    if (fresh.paused === 1 && fresh.paused_reason === "stuck") {
      return {
        kind: "stuck",
        message: this.render("stuck", {}),
        loop: true
      };
    }
    return null;
  }
};
function applyOff(store, conversationId) {
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
      paused_reason: null
    });
  }
  const ambientArmed = session.phase === "idle" && session.armed === 1 && session.paused === 0;
  if (session.phase === "planning" || session.phase === "executing" || ambientArmed) {
    const wasPaused = session.paused === 1;
    let pausedReason = session.paused_reason;
    if (!wasPaused) {
      pausedReason = session.phase === "executing" || session.phase === "idle" ? "human_gate" : null;
    }
    return store.upsertSession({
      conversation_id: conversationId,
      project_root: session.project_root,
      code_root: session.code_root,
      armed: 0,
      paused: 1,
      paused_reason: pausedReason
      // phase unchanged; review chain untouched
    });
  }
  return session;
}
function applyOn(store, conversationId, projectRoot, opts) {
  const root = normalizeProjectRoot(store.projectRoot) ?? normalizeProjectRoot(projectRoot);
  if (!root) {
    return { ok: false, userMessage: "Invalid project root." };
  }
  projectRoot = root;
  const session = store.getSession(conversationId);
  if (session?.phase === "executing") {
    return {
      ok: false,
      userMessage: "Autopilot is executing. Send Autopilot OFF, REPLAN, or RESUME before ON."
    };
  }
  if (opts?.slug && !isSafeTrackSlug(opts.slug)) {
    return {
      ok: false,
      userMessage: `Invalid track slug "${opts.slug}".`
    };
  }
  const trackId = opts?.slug ?? session?.track_id ?? "_pending";
  if (session?.phase === "done") {
    const s2 = store.upsertSession({
      conversation_id: conversationId,
      project_root: projectRoot,
      code_root: projectRoot,
      phase: "planning",
      armed: 0,
      paused: 0,
      paused_reason: null,
      track_id: opts?.slug ?? session.track_id,
      platform: session.platform
    });
    return { ok: true, session: s2 };
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
    checklist_path: session?.checklist_path ?? ""
  });
  return { ok: true, session: s };
}
function finishLocalResume(store, conversationId, session) {
  const snap = store.getSession(conversationId);
  if (!snap) {
    return null;
  }
  let armedOnUnpauseExecuting;
  if (snap.paused === 1 && snap.phase === "executing") {
    armedOnUnpauseExecuting = 0;
    if (snap.checklist_path) {
      const root = normalizeProjectRoot(store.projectRoot);
      if (root && isRealpathInsideProject(root, snap.checklist_path)) {
        try {
          armedOnUnpauseExecuting = countUnchecked(
            parseChecklist(snap.checklist_path, {
              projectRoot: root
            })
          ) > 0 ? 1 : 0;
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
    const patch = {
      conversation_id: conversationId,
      project_root: live.project_root || session.project_root,
      code_root: live.code_root || session.code_root
    };
    const phase = live.phase;
    const paused = live.paused;
    if (paused === 1) {
      patch.paused = 0;
      patch.paused_reason = null;
      patch.error_count = 0;
      patch.idle_stop_count = 0;
      if (phase === "executing") {
        if (armedOnUnpauseExecuting !== void 0 && snap.phase === "executing" && snap.checklist_path === live.checklist_path) {
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
        isRecoverOrStuckFollowupMessage
      );
    } catch {
    }
    return { commit: true, value: updated };
  });
}
function applyResume(store, conversationId, opts) {
  if (!store.isConversationIdOk(conversationId)) {
    return { ok: false, userMessage: "Invalid conversation id." };
  }
  let session = store.getSession(conversationId);
  const slug = opts?.slug?.trim() || void 0;
  if (slug && !isSafeTrackSlug(slug)) {
    return {
      ok: false,
      userMessage: `Invalid track slug "${sanitizeSessionDisplayText(slug).slice(0, 64)}".`
    };
  }
  const localMatches = !!session && (session.phase === "executing" || session.phase === "planning") && (!slug || session.track_id === slug);
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
      userMessage: "Session moved concurrently; retry Autopilot RESUME."
    };
  }
  return {
    ok: true,
    session: updated
  };
}
function applyResumeReview(store, conversationId) {
  store.setChainPending(conversationId);
}

// ../core/src/project-config.ts
import fs7 from "node:fs";
import path5 from "node:path";
var MAX_CONFIG_BYTES = 1e6;
var DEFAULT_PROJECT_REVIEW_CONFIG = {
  confirmRounds: 5,
  reviewScope: "executing_only",
  verifyEnabled: false,
  // freeze: chặn mutate hằng số mặc định làm bẩn mọi clone sau này
  verifyCommands: Object.freeze([]),
  maxIdleStops: 5,
  maxErrorsBeforePause: 0,
  locale: "en"
};
function parseReviewScope(raw) {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (s === "project" || s === "always" || s === "all") return "project";
  return "executing_only";
}
function cloneDefaultProjectReviewConfig() {
  return {
    confirmRounds: DEFAULT_PROJECT_REVIEW_CONFIG.confirmRounds,
    reviewScope: DEFAULT_PROJECT_REVIEW_CONFIG.reviewScope,
    verifyEnabled: DEFAULT_PROJECT_REVIEW_CONFIG.verifyEnabled,
    verifyCommands: [],
    maxIdleStops: DEFAULT_PROJECT_REVIEW_CONFIG.maxIdleStops,
    maxErrorsBeforePause: DEFAULT_PROJECT_REVIEW_CONFIG.maxErrorsBeforePause,
    locale: DEFAULT_PROJECT_REVIEW_CONFIG.locale
  };
}
function coerceIntInRange(raw, min, max, fallback) {
  if (raw == null || !raw.trim()) return fallback;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min) return fallback;
  if (n > max) return max;
  return n;
}
function unquote(value) {
  const v = value.trim();
  if (v.startsWith('"') && v.endsWith('"') || v.startsWith("'") && v.endsWith("'")) {
    return v.slice(1, -1);
  }
  return v;
}
function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.prototype.toString.call(value) === "[object Object]";
}
function isUnsafeKey(key) {
  return key === "__proto__" || key === "prototype" || key === "constructor";
}
function coerceScalar(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  return unquote(value);
}
function lineIndent(line) {
  let n = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === " ") n += 1;
    else if (ch === "	") n += 2;
    else break;
  }
  return n;
}
function parseSimpleYaml(raw) {
  const root = {};
  const stack = [{ indent: -1, obj: root }];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = lineIndent(line);
    const trimmed = line.trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const frame = stack[stack.length - 1];
    if (trimmed.startsWith("- ")) {
      const itemRaw = trimmed.slice(2).trim();
      if (!frame.openKey) continue;
      let list = frame.obj[frame.openKey];
      if (!Array.isArray(list)) {
        list = [];
        frame.obj[frame.openKey] = list;
      }
      if (itemRaw.includes(":") && !itemRaw.startsWith("{")) {
        const item = {};
        list.push(item);
        const m = itemRaw.match(/^([^:#]+):\s*(.*)$/);
        if (m) {
          const k = m[1].trim();
          const v = m[2].trim();
          if (!isUnsafeKey(k)) {
            item[k] = v === "" ? null : coerceScalar(v);
          }
          stack.push({ indent, obj: item });
        }
      } else {
        list.push(coerceScalar(itemRaw));
      }
      continue;
    }
    const kv = trimmed.match(/^([^:#]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].trim();
    const value = kv[2].trim();
    if (isUnsafeKey(key)) continue;
    if (frame.openKey && frame.openKeyIndent != null && indent > frame.openKeyIndent) {
      let child = frame.obj[frame.openKey];
      if (!isPlainObject(child) || Array.isArray(child)) {
        child = {};
        frame.obj[frame.openKey] = child;
      }
      const childObj = child;
      const childIndent = frame.openKeyIndent;
      frame.openKey = void 0;
      frame.openKeyIndent = void 0;
      stack.push({ indent: childIndent, obj: childObj });
      const childFrame = stack[stack.length - 1];
      if (value === "" || value === "|" || value === ">") {
        childFrame.openKey = key;
        childFrame.openKeyIndent = indent;
      } else {
        childObj[key] = coerceScalar(value);
      }
      continue;
    }
    if (value === "" || value === "|" || value === ">") {
      frame.openKey = key;
      frame.openKeyIndent = indent;
      continue;
    }
    frame.openKey = void 0;
    frame.openKeyIndent = void 0;
    frame.obj[key] = coerceScalar(value);
  }
  return root;
}
function coerceBool(raw) {
  if (raw === true || raw === "true") return true;
  if (raw === false || raw === "false") return false;
  return void 0;
}
function parseVerifyCommands(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue;
    if (typeof entry.id !== "string" || !entry.id.trim()) continue;
    const cmd = { id: entry.id.trim() };
    if (typeof entry.run === "string") cmd.run = entry.run;
    const required = coerceBool(entry.required);
    if (required !== void 0) cmd.required = required;
    out.push(cmd);
  }
  return out;
}
function loadProjectReviewConfig(projectRoot) {
  const root = normalizeProjectRoot(projectRoot);
  if (!root) {
    return cloneDefaultProjectReviewConfig();
  }
  const configPath = path5.join(root, ".autopilot", "config.yml");
  try {
    const nofollow = typeof fs7.constants.O_NOFOLLOW === "number" ? fs7.constants.O_NOFOLLOW : 0;
    if (nofollow === 0) {
      if (!fs7.existsSync(configPath)) return cloneDefaultProjectReviewConfig();
      if (fs7.lstatSync(configPath).isSymbolicLink()) {
        return cloneDefaultProjectReviewConfig();
      }
    }
    let fd;
    try {
      fd = fs7.openSync(configPath, fs7.constants.O_RDONLY | nofollow);
    } catch {
      return cloneDefaultProjectReviewConfig();
    }
    let raw;
    try {
      const st = fs7.fstatSync(fd);
      if (!st.isFile() || st.size > MAX_CONFIG_BYTES) {
        return cloneDefaultProjectReviewConfig();
      }
      const lst = fs7.lstatSync(configPath);
      if (lst.isSymbolicLink() || !lst.isFile()) {
        return cloneDefaultProjectReviewConfig();
      }
      if (lst.ino !== st.ino || lst.dev !== st.dev) {
        return cloneDefaultProjectReviewConfig();
      }
      if (!isRealpathInsideProject(root, configPath)) {
        return cloneDefaultProjectReviewConfig();
      }
      const buf = Buffer.alloc(st.size);
      const n = fs7.readSync(fd, buf, 0, st.size, 0);
      raw = buf.subarray(0, n).toString("utf8");
    } finally {
      fs7.closeSync(fd);
    }
    if (Buffer.byteLength(raw, "utf8") > MAX_CONFIG_BYTES) {
      return cloneDefaultProjectReviewConfig();
    }
    const text = raw.charCodeAt(0) === 65279 ? raw.slice(1) : raw;
    const parsed = parseSimpleYaml(text);
    if (!isPlainObject(parsed)) return cloneDefaultProjectReviewConfig();
    const review = isPlainObject(parsed.review) ? parsed.review : {};
    const verify = isPlainObject(review.verify) ? review.verify : {};
    const stuck = isPlainObject(review.stuck) ? review.stuck : {};
    const errors = isPlainObject(review.errors) ? review.errors : {};
    return normalizeProjectReviewConfig({
      confirmRounds: review.confirm_rounds,
      reviewScope: review.scope,
      verifyEnabled: verify.enabled,
      verifyCommands: verify.commands,
      maxIdleStops: stuck.max_idle_stops,
      maxErrorsBeforePause: errors.max_before_pause,
      locale: parsed.locale
    });
  } catch {
    return cloneDefaultProjectReviewConfig();
  }
}
function normalizeProjectReviewConfig(raw) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return cloneDefaultProjectReviewConfig();
  }
  const o = raw;
  return {
    confirmRounds: coerceIntInRange(
      o.confirmRounds != null ? String(o.confirmRounds) : void 0,
      1,
      5,
      DEFAULT_PROJECT_REVIEW_CONFIG.confirmRounds
    ),
    reviewScope: parseReviewScope(o.reviewScope),
    verifyEnabled: coerceBool(o.verifyEnabled) === true,
    verifyCommands: parseVerifyCommands(o.verifyCommands),
    maxIdleStops: coerceIntInRange(
      o.maxIdleStops != null ? String(o.maxIdleStops) : void 0,
      1,
      100,
      DEFAULT_PROJECT_REVIEW_CONFIG.maxIdleStops
    ),
    // 0 = unlimited; clamp 0..1000 (invalid → default unlimited)
    maxErrorsBeforePause: coerceIntInRange(
      o.maxErrorsBeforePause != null ? String(o.maxErrorsBeforePause) : void 0,
      0,
      1e3,
      DEFAULT_PROJECT_REVIEW_CONFIG.maxErrorsBeforePause
    ),
    locale: typeof o.locale === "string" && o.locale.trim() ? o.locale.trim() : DEFAULT_PROJECT_REVIEW_CONFIG.locale
  };
}

// ../core/src/i18n-render.ts
function renderTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = vars[key];
    return v === void 0 || v === null ? "" : String(v);
  });
}

// ../core/src/review-i18n.ts
function createRenderFollowup(bundle) {
  return (kind, vars) => {
    const f = bundle?.followup;
    if (!f) return "";
    switch (kind) {
      case "review.fix":
        return renderTemplate(f.review?.fix ?? "", vars);
      case "review.confirm":
        return renderTemplate(f.review?.confirm ?? "", vars);
      case "review.confirm_final":
        return renderTemplate(f.review?.confirm_final ?? "", vars);
      case "advance":
        return renderTemplate(f.advance ?? "", vars);
      case "done":
        return renderTemplate(f.done ?? "", vars);
      case "recover":
        return renderTemplate(f.recover ?? "", vars);
      case "recover_planning":
        return renderTemplate(
          f.recover_planning ?? f.recover ?? "",
          vars
        );
      case "recover_ambient":
        return renderTemplate(
          f.recover_ambient ?? f.recover ?? "",
          vars
        );
      case "review_complete":
        return renderTemplate(
          f.review_complete ?? "Review complete. All {total} confirm rounds passed; the review chain has ended.",
          vars
        );
      case "stuck":
        return renderTemplate(f.stuck ?? "", vars);
      case "verify_fix":
        return renderTemplate(
          f.verify_fix ?? "Verify failed ({reason}). Fix verify commands and rewrite verify-last.json; do not advance.",
          vars
        );
      default:
        return "";
    }
  };
}
function createResolveLens(bundle) {
  return (roundIndex, confirmRounds) => {
    const base = getLens(roundIndex, confirmRounds);
    const loc = bundle?.lens?.[base.key];
    if (!loc) return base;
    return {
      key: base.key,
      title: loc.title || base.title,
      focus: loc.focus || base.focus
    };
  };
}

// ../core/src/review-runtime.ts
function createConfiguredReviewEngine(store, projectRoot, localeBundle, preloaded) {
  const safeRoot = normalizeProjectRoot(store.projectRoot) ?? normalizeProjectRoot(projectRoot) ?? "";
  const cfg = normalizeProjectReviewConfig(
    preloaded ?? (safeRoot ? loadProjectReviewConfig(safeRoot) : void 0)
  );
  const usableLocale = Boolean(localeBundle?.followup?.review?.fix);
  return new ReviewEngine(store, {
    confirmRounds: cfg.confirmRounds,
    reviewScope: cfg.reviewScope,
    verifyEnabled: cfg.verifyEnabled,
    // shallow copy — caller mutating preloaded.verifyCommands must not affect engine
    verifyCommands: cfg.verifyCommands.map((c) => ({ ...c })),
    maxIdleStops: cfg.maxIdleStops,
    maxErrorsBeforePause: cfg.maxErrorsBeforePause,
    projectRoot: safeRoot,
    ...usableLocale && localeBundle ? {
      renderFollowup: createRenderFollowup(localeBundle),
      resolveLens: createResolveLens(localeBundle)
    } : {}
  });
}

// ../core/src/phase-actions.ts
import fs9 from "node:fs";
import path7 from "node:path";

// ../core/src/list-tracks.ts
import fs8 from "node:fs";
import path6 from "node:path";
function isRunnableTrack(t) {
  if (t.paused) return false;
  const unchecked = t.checklistTotal - t.checklistDone;
  if (unchecked <= 0) return false;
  return t.phase === "planning" || t.phase === "executing" || t.phase === "idle" || t.phase === "done";
}
function readPlansDir(root, plansDir = "plans") {
  if (typeof plansDir !== "string" || !root || root.includes("\0") || plansDir.includes("\0")) {
    return [];
  }
  const dir = path6.join(root, plansDir);
  try {
    const lst = fs8.lstatSync(dir);
    if (lst.isSymbolicLink() || !lst.isDirectory()) return [];
    if (!isRealpathInsideProject(root, dir)) return [];
  } catch {
    return [];
  }
  const names = fs8.readdirSync(dir, { withFileTypes: true }).filter(
    (d) => d.isDirectory() && !d.isSymbolicLink() && isSafeTrackSlug(d.name)
  ).map((d) => d.name);
  try {
    const lst = fs8.lstatSync(dir);
    if (lst.isSymbolicLink() || !lst.isDirectory()) return [];
    if (!isRealpathInsideProject(root, dir)) return [];
  } catch {
    return [];
  }
  return names;
}
function titleFromPlan(planPath, slug, projectRoot) {
  if (!planPath || planPath.includes("\0")) return slug;
  const root = normalizeProjectRoot(projectRoot);
  if (!root) return slug;
  const maxBytes = 65536;
  try {
    const nofollow = typeof fs8.constants.O_NOFOLLOW === "number" ? fs8.constants.O_NOFOLLOW : 0;
    if (nofollow === 0) {
      const lst = fs8.lstatSync(planPath);
      if (lst.isSymbolicLink() || !lst.isFile()) return slug;
    }
    const fd = fs8.openSync(planPath, fs8.constants.O_RDONLY | nofollow);
    try {
      const st = fs8.fstatSync(fd);
      if (!st.isFile() || st.size <= 0) return slug;
      const lst = fs8.lstatSync(planPath);
      if (lst.isSymbolicLink() || !lst.isFile()) return slug;
      if (lst.ino !== st.ino || lst.dev !== st.dev) return slug;
      if (!isRealpathInsideProject(root, planPath)) return slug;
      const len = Math.min(st.size, maxBytes);
      const buf = Buffer.alloc(len);
      const n = fs8.readSync(fd, buf, 0, len, 0);
      const first = buf.subarray(0, n).toString("utf8").split(/\r?\n/)[0] ?? "";
      const m = first.match(/^#\s+(.+)/);
      return m?.[1]?.trim() ?? slug;
    } finally {
      fs8.closeSync(fd);
    }
  } catch {
    return slug;
  }
}
function listTracks(root, store, filter = "all", plansDir = "plans") {
  const normalized = normalizeProjectRoot(root);
  if (!normalized) return [];
  root = normalized;
  const safePlans = normalizeInProjectPlansDir(root, plansDir);
  if (!safePlans) return [];
  plansDir = safePlans;
  const slugs = readPlansDir(root, plansDir);
  const tracks = [];
  for (const slug of slugs) {
    const trackDir = path6.join(root, plansDir, slug);
    try {
      const lst = fs8.lstatSync(trackDir);
      if (lst.isSymbolicLink() || !lst.isDirectory()) continue;
      if (!isRealpathInsideProject(root, trackDir)) continue;
    } catch {
      continue;
    }
    const planPath = path6.join(trackDir, "plan.md");
    const checklistPath = path6.join(trackDir, "checklist.md");
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
      }
    } else if (!planInProject) {
      continue;
    }
    let phase = "idle";
    let paused = false;
    let pausedReason;
    let updatedAt = (/* @__PURE__ */ new Date(0)).toISOString();
    if (store) {
      const sessions = store.db.prepare(
        `SELECT * FROM sessions WHERE track_id = ? ORDER BY last_active_at DESC LIMIT 1`
      ).all(slug);
      const latest = sessions[0];
      if (latest) {
        phase = latest.phase;
        paused = latest.paused === 1;
        if (latest.paused_reason === "stuck" || latest.paused_reason === "repeated_errors" || latest.paused_reason === "human_gate") {
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
      updatedAt
    });
  }
  if (filter === "all") return tracks;
  if (filter === "planning") {
    return tracks.filter((t) => t.phase === "planning");
  }
  return tracks.filter(isRunnableTrack);
}
function canEnterExecuting(options) {
  const { slug, checklistPath, paused, projectRoot } = options;
  if (!slug || slug === "_pending") {
    return { ok: false, reason: "no track slug" };
  }
  const root = normalizeProjectRoot(projectRoot);
  if (!root) {
    return { ok: false, reason: "invalid project root" };
  }
  if (!checklistPath || !fs8.existsSync(checklistPath)) {
    return { ok: false, reason: "checklist missing" };
  }
  if (!isRealpathInsideProject(root, checklistPath)) {
    return { ok: false, reason: "checklist outside project" };
  }
  let unchecked = 0;
  try {
    unchecked = countUnchecked(
      parseChecklist(checklistPath, { projectRoot: root })
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

// ../core/src/phase-actions.ts
function nowIso2() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function checklistPathFor(projectRoot, slug, plansDir) {
  const root = normalizeProjectRoot(projectRoot);
  if (!root) return path7.join(plansDir, slug, "checklist.md");
  return path7.join(root, plansDir, slug, "checklist.md");
}
function sameChecklistBinding(stored, rebuilt, projectRoot) {
  if (stored === rebuilt) return true;
  if (!stored || !rebuilt || stored.includes("\0") || rebuilt.includes("\0")) {
    return false;
  }
  const root = normalizeProjectRoot(projectRoot);
  if (!root) return false;
  try {
    const absStored = path7.isAbsolute(stored) ? path7.resolve(stored) : path7.resolve(root, stored);
    const absRebuilt = path7.isAbsolute(rebuilt) ? path7.resolve(rebuilt) : path7.resolve(root, rebuilt);
    return absStored === absRebuilt;
  } catch {
    return false;
  }
}
function trustedChecklistPath(projectRoot, plansDir, slug, storedPath, boundTrackId) {
  const rebuilt = checklistPathFor(projectRoot, slug, plansDir);
  if (storedPath && boundTrackId === slug) {
    if (isChecklistPathAllowed(projectRoot, storedPath)) {
      return storedPath;
    }
  }
  return rebuilt;
}
function isChecklistPathAllowed(projectRoot, checklistPath) {
  if (!checklistPath || checklistPath.includes("\0")) return false;
  const root = normalizeProjectRoot(projectRoot);
  if (!root) return false;
  try {
    fs9.lstatSync(
      path7.isAbsolute(checklistPath) ? checklistPath : path7.resolve(root, checklistPath)
    );
    return isRealpathInsideProject(root, checklistPath);
  } catch {
    return isLexicallyInsideProject(root, checklistPath);
  }
}
function ensureSession(store, conversationId, projectRoot) {
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
    checklist_path: ""
  });
}
function upsertTrack(store, slug, checklistPath, plansDir, projectRoot) {
  const ts = nowIso2();
  const root = normalizeProjectRoot(projectRoot);
  if (!root) return;
  const planPath = path7.join(root, plansDir, slug, "plan.md");
  const briefPath = path7.join(root, plansDir, slug, "brief.md");
  store.db.prepare(
    `INSERT INTO tracks (track_id, slug, checklist_path, plan_path, brief_path, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(track_id) DO UPDATE SET
         slug = excluded.slug,
         checklist_path = excluded.checklist_path,
         plan_path = excluded.plan_path,
         brief_path = excluded.brief_path,
         updated_at = excluded.updated_at`
  ).run(
    slug,
    slug,
    checklistPath,
    fs9.existsSync(planPath) ? planPath : null,
    fs9.existsSync(briefPath) ? briefPath : null,
    ts
  );
}
function candidatePayload(tracks) {
  return JSON.stringify(
    tracks.map((t) => ({
      slug: t.slug,
      title: t.title,
      phase: t.phase,
      progress: `${t.checklistDone}/${t.checklistTotal}`
    }))
  );
}
function resolveRunSlug(store, session, projectRoot, plansDir, requestedSlug) {
  const runnable = listTracks(projectRoot, store, "runnable", plansDir).filter(
    (t) => isSafeTrackSlug(t.slug)
  );
  if (requestedSlug) {
    if (!isSafeTrackSlug(requestedSlug)) {
      return {
        kind: "none",
        userMessage: `Invalid track slug "${requestedSlug}".`
      };
    }
    const hit = runnable.find((t) => t.slug === requestedSlug);
    if (!hit) {
      const all = listTracks(projectRoot, store, "all", plansDir);
      if (!all.some((t) => t.slug === requestedSlug)) {
        return {
          kind: "none",
          userMessage: `Track "${requestedSlug}" not found or has no unchecked checklist items.`
        };
      }
      return {
        kind: "none",
        userMessage: `Track "${requestedSlug}" is not runnable (paused or no unchecked items).`
      };
    }
    return { kind: "slug", slug: requestedSlug };
  }
  if (session.track_id && session.track_id !== "_pending") {
    const bound = runnable.find((t) => t.slug === session.track_id);
    if (bound) {
      return { kind: "slug", slug: bound.slug };
    }
  }
  if (runnable.length === 0) {
    return {
      kind: "none",
      userMessage: "No runnable plan. Use /autopilot-on to plan, then finalize a checklist with unchecked items."
    };
  }
  if (runnable.length === 1) {
    return { kind: "slug", slug: runnable[0].slug };
  }
  return { kind: "pick", candidates: runnable };
}
function requireProjectRoot(store, projectRoot) {
  return normalizeProjectRoot(store.projectRoot) ?? normalizeProjectRoot(projectRoot);
}
function requirePlansDir(projectRoot, plansDir) {
  return normalizeInProjectPlansDir(projectRoot, plansDir);
}
function applyRun(store, conversationId, projectRoot, opts) {
  const root = requireProjectRoot(store, projectRoot);
  if (!root) {
    return { ok: false, userMessage: "Invalid project root." };
  }
  projectRoot = root;
  const plansDir = requirePlansDir(projectRoot, opts?.config?.plansDir);
  if (!plansDir) {
    return { ok: false, userMessage: "Invalid plans directory." };
  }
  const concurrencyMode = opts?.config?.concurrencyMode ?? "one_executor";
  const session = ensureSession(store, conversationId, projectRoot);
  const resolved = resolveRunSlug(
    store,
    session,
    projectRoot,
    plansDir,
    opts?.slug
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
      armed: 0
      // phase unchanged — do not write executing
    });
    const lines = resolved.candidates.map(
      (t, i) => `  ${i + 1}. ${t.slug} \u2014 ${t.title} (${t.checklistTotal - t.checklistDone}/${t.checklistTotal} left)`
    ).join("\n");
    return {
      ok: false,
      needPick: true,
      candidates: resolved.candidates,
      userMessage: `Select a plan to execute:

${lines}

Reply with a number or /autopilot-run <slug>.`
    };
  }
  const slug = resolved.slug;
  if (!isSafeTrackSlug(slug)) {
    return {
      ok: false,
      userMessage: `Invalid track slug "${slug}".`
    };
  }
  const checklistPath = checklistPathFor(projectRoot, slug, plansDir);
  const gate = canEnterExecuting({
    slug,
    checklistPath,
    paused: session.paused === 1,
    projectRoot
  });
  if (!gate.ok) {
    return {
      ok: false,
      userMessage: `Cannot start executing: ${gate.reason}.`
    };
  }
  try {
    return store.exclusiveWrite(() => {
      if (concurrencyMode === "one_executor") {
        const other = store.findExecutingSession(conversationId);
        if (other) {
          return {
            commit: false,
            value: {
              ok: false,
              userMessage: `Another session is already executing (${other.track_id}). Send Autopilot OFF there or wait, then retry.`
            }
          };
        }
      }
      const fresh = store.getSession(conversationId);
      const alreadyExecutingSameTrack = fresh?.phase === "executing" && fresh.armed === 1 && fresh.paused === 0 && fresh.track_id === slug && sameChecklistBinding(fresh.checklist_path, checklistPath, projectRoot);
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
        idle_stop_count: 0
      });
      if (!alreadyExecutingSameTrack) {
        store.updateReviewChain(conversationId, {
          fix_round: 0,
          confirm_left: null,
          chain_pending: 0,
          code_edited: 0,
          item_confirm_complete: 0,
          pending_followup: null,
          pending_followup_at: null,
          pending_redeliver_at: null
        });
      } else {
        store.ensureReviewChain(conversationId);
      }
      return { commit: true, value: { ok: true, session: updated } };
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/busy|locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(msg)) {
      return {
        ok: false,
        userMessage: "State database is busy; retry Autopilot RUN in a moment."
      };
    }
    throw err;
  }
}
function applyReplan(store, conversationId, projectRoot, opts) {
  const root = requireProjectRoot(store, projectRoot);
  if (!root) {
    return { ok: false, userMessage: "Invalid project root." };
  }
  projectRoot = root;
  const plansDir = requirePlansDir(projectRoot, opts?.config?.plansDir);
  if (!plansDir) {
    return { ok: false, userMessage: "Invalid plans directory." };
  }
  const session = ensureSession(store, conversationId, projectRoot);
  let slug = opts?.slug ?? session.track_id;
  if (slug && slug !== "_pending" && !isSafeTrackSlug(slug)) {
    return {
      ok: false,
      userMessage: `Invalid track slug "${slug}".`
    };
  }
  if (!slug || slug === "_pending") {
    const all = listTracks(projectRoot, store, "all", plansDir).filter(
      (t) => isSafeTrackSlug(t.slug)
    );
    if (all.length === 1) {
      slug = all[0].slug;
    } else if (all.length > 1) {
      store.upsertSession({
        conversation_id: conversationId,
        project_root: session.project_root,
        code_root: session.code_root,
        pending_action: "replan",
        track_candidates_json: candidatePayload(all),
        armed: 0
      });
      const lines = all.map((t, i) => `  ${i + 1}. ${t.slug} \u2014 ${t.title}`).join("\n");
      return {
        ok: false,
        needPick: true,
        candidates: all,
        userMessage: `Select a plan to replan:

${lines}

Reply with a number or /autopilot-replan <slug>.`
      };
    } else {
      return {
        ok: false,
        userMessage: "No plan to replan. Use /autopilot-on first."
      };
    }
  }
  const checklistPath = trustedChecklistPath(
    projectRoot,
    plansDir,
    slug,
    session.checklist_path,
    session.track_id
  );
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
    track_candidates_json: null
  });
  store.updateReviewChain(conversationId, {
    fix_round: 0,
    confirm_left: null,
    chain_pending: 0,
    code_edited: 0,
    item_confirm_complete: 0,
    pending_followup: null,
    pending_followup_at: null,
    pending_redeliver_at: null
  });
  return { ok: true, session: updated };
}
function applyTrackPick(store, conversationId, projectRoot, pick, opts) {
  const root = requireProjectRoot(store, projectRoot);
  if (!root) {
    return { ok: false, userMessage: "Invalid project root." };
  }
  projectRoot = root;
  const session = store.getSession(conversationId);
  if (!session?.pending_action) {
    return {
      ok: false,
      userMessage: "No pending track selection."
    };
  }
  const pending = session.pending_action;
  if (pending !== "run" && pending !== "replan") {
    return {
      ok: false,
      userMessage: `Unknown pending action "${pending}".`
    };
  }
  if (!session.track_candidates_json) {
    return { ok: false, userMessage: "Invalid track candidates JSON." };
  }
  let candidates = [];
  try {
    const parsed = JSON.parse(session.track_candidates_json);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return { ok: false, userMessage: "Invalid track candidates JSON." };
    }
    const hasValidSlug = parsed.some(
      (c) => !!c && typeof c === "object" && !Array.isArray(c) && typeof c.slug === "string" && isSafeTrackSlug(c.slug)
    );
    if (!hasValidSlug) {
      return { ok: false, userMessage: "Invalid track candidates JSON." };
    }
    candidates = parsed;
  } catch {
    return { ok: false, userMessage: "Invalid track candidates JSON." };
  }
  let slug;
  if (/^\d+$/.test(pick)) {
    const idx = Number.parseInt(pick, 10) - 1;
    const entry = candidates[idx];
    slug = entry && typeof entry === "object" && !Array.isArray(entry) && typeof entry.slug === "string" ? entry.slug : void 0;
    if (!slug || !isSafeTrackSlug(slug)) {
      return {
        ok: false,
        userMessage: `Invalid selection "${pick}". Choose 1\u2013${candidates.length}.`
      };
    }
  } else {
    if (!isSafeTrackSlug(pick)) {
      return {
        ok: false,
        userMessage: `Invalid track slug "${pick}".`
      };
    }
    slug = pick;
    if (!candidates.some(
      (c) => !!c && typeof c === "object" && !Array.isArray(c) && c.slug === slug
    )) {
      return {
        ok: false,
        userMessage: `Unknown slug "${pick}".`
      };
    }
  }
  if (pending === "replan") {
    return applyReplan(store, conversationId, projectRoot, {
      slug,
      config: opts?.config
    });
  }
  return applyRun(store, conversationId, projectRoot, {
    slug,
    config: opts?.config
  });
}

// ../core/src/code-edit-detector.ts
import path8 from "node:path";
var CODE_EXTENSIONS = /* @__PURE__ */ new Set([
  // JS / TS
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  // Web
  ".vue",
  ".svelte",
  ".astro",
  ".css",
  ".scss",
  ".sass",
  ".less",
  // Systems / native
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".cxx",
  ".hpp",
  ".hh",
  ".m",
  ".mm",
  ".rs",
  ".go",
  ".zig",
  ".nim",
  ".v",
  // JVM / .NET
  ".java",
  ".kt",
  ".kts",
  ".scala",
  ".groovy",
  ".cs",
  ".fs",
  ".fsx",
  ".vb",
  // Mobile / UI
  ".swift",
  ".dart",
  // Scripting
  ".py",
  ".rb",
  ".php",
  ".pl",
  ".pm",
  ".lua",
  ".r",
  ".jl",
  ".ex",
  ".exs",
  ".erl",
  ".hrl",
  ".clj",
  ".cljs",
  ".cljc",
  ".edn",
  ".hs",
  ".lhs",
  ".ml",
  ".mli",
  ".elm",
  // Shell
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".bat",
  ".cmd",
  // Data / IDL / infra
  ".sql",
  ".graphql",
  ".gql",
  ".proto",
  ".tf",
  ".toml",
  ".yaml",
  ".yml",
  ".json",
  ".jsonc",
  ".xml",
  ".prisma"
]);
var ROOT_CONFIG_NAMES = /* @__PURE__ */ new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "pnpm-workspace.yaml",
  "Cargo.toml",
  "Cargo.lock",
  "go.mod",
  "go.sum",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "docker-compose.yml",
  "docker-compose.yaml",
  "Dockerfile",
  "Makefile",
  "makefile",
  "CMakeLists.txt",
  "pyproject.toml",
  "Pipfile",
  "requirements.txt",
  "Gemfile",
  "composer.json",
  "tsconfig.json",
  "jsconfig.json",
  "deno.json",
  "deno.jsonc"
]);
function normalizePosix(filePath) {
  return filePath.replace(/\\/g, "/");
}
function isProductCodeEdit(filePath) {
  const posix = normalizePosix(filePath);
  const base = path8.posix.basename(posix);
  const lower = posix.toLowerCase();
  if (lower.includes("/docs/") || lower.startsWith("docs/") || lower.includes("/plans/") || lower.startsWith("plans/") || lower.includes("/.autopilot/") || lower.startsWith(".autopilot/") || lower.includes("/.cursor/") || lower.startsWith(".cursor/") || lower.endsWith(".md") || lower.endsWith(".mdx")) {
    return false;
  }
  if (/\/\.cursor\/hooks\/\./.test(lower) || /^\.cursor\/hooks\/\./.test(lower)) {
    return false;
  }
  const ext = path8.posix.extname(posix).toLowerCase();
  if (CODE_EXTENSIONS.has(ext)) return true;
  if (ROOT_CONFIG_NAMES.has(base)) return true;
  return false;
}

// ../ports/cursor/src/index.ts
function cid(p) {
  return (p.conversation_id ?? p.conversationId ?? "").trim();
}
function collectStopErrorText(payload) {
  if (!payload || typeof payload !== "object") return "";
  const MAX_CHARS = 8192;
  const parts = [];
  try {
    const push = (value) => {
      if (typeof value === "string" && value.trim()) {
        parts.push(value);
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value.slice(0, 8)) {
          if (typeof item === "string" && item.trim()) parts.push(item);
        }
        return;
      }
      if (value && typeof value === "object") {
        const o = value;
        for (const key of ["message", "error", "name", "stack", "detail", "title"]) {
          const nested = o[key];
          if (typeof nested === "string" && nested.trim()) parts.push(nested);
        }
      }
    };
    push(payload.error);
    push(payload.message);
    push(payload.status_message);
    push(payload.reason);
    push(payload.detail);
    push(payload.title);
  } catch {
    return "";
  }
  const joined = parts.join("\n");
  return joined.length > MAX_CHARS ? joined.slice(0, MAX_CHARS) : joined;
}
function normalizeCursorStopStatus(payload) {
  if (!payload || typeof payload !== "object") return "completed";
  const statusRaw = String(payload.status ?? "completed").toLowerCase().trim();
  const errText = collectStopErrorText(payload);
  if (statusRaw === "aborted" || statusRaw === "cancelled" || statusRaw === "canceled") {
    return "aborted";
  }
  if (statusRaw === "error" || statusRaw === "failed") {
    if (isUserAbortText(errText)) return "aborted";
    return "error";
  }
  return "completed";
}
function handleBeforeSubmitPrompt(store, payload, projectRoot, portConfig) {
  const conversationId = cid(payload);
  if (!conversationId) return { continue: true };
  const prompt = payload.prompt ?? payload.content ?? "";
  try {
    store.clearPendingFollowupIf(
      conversationId,
      isRecoverOrStuckFollowupMessage
    );
  } catch {
  }
  const session = store.getSession(conversationId);
  const trigger = parseTrigger({
    prompt,
    conversationId,
    projectRoot,
    pendingAction: session?.pending_action
  });
  const actionConfig = portConfig?.phaseActions;
  if (trigger) {
    if (trigger.kind === "off") {
      applyOff(store, conversationId);
      return { continue: true };
    }
    if (trigger.kind === "on") {
      const result = applyOn(store, conversationId, projectRoot, {
        initialBrief: trigger.initialBrief,
        slug: trigger.slug
      });
      if (!result.ok) {
        return { continue: false, userMessage: result.userMessage };
      }
      return { continue: true };
    }
    if (trigger.kind === "resume") {
      const result = applyResume(store, conversationId, {
        slug: trigger.slug
      });
      if (!result.ok) {
        return { continue: false, userMessage: result.userMessage };
      }
      return { continue: true };
    }
    if (trigger.kind === "resume_review") {
      applyResumeReview(store, conversationId);
      return { continue: true };
    }
    if (trigger.kind === "run") {
      const result = applyRun(store, conversationId, projectRoot, {
        slug: trigger.slug,
        config: actionConfig
      });
      if (!result.ok) {
        return { continue: false, userMessage: result.userMessage };
      }
      return { continue: true };
    }
    if (trigger.kind === "replan") {
      const result = applyReplan(store, conversationId, projectRoot, {
        slug: trigger.slug,
        config: actionConfig
      });
      if (!result.ok) {
        return { continue: false, userMessage: result.userMessage };
      }
      return { continue: true };
    }
    if (trigger.kind === "track_pick" && trigger.trackPick) {
      const result = applyTrackPick(
        store,
        conversationId,
        projectRoot,
        trigger.trackPick,
        { config: actionConfig }
      );
      if (!result.ok) {
        return { continue: false, userMessage: result.userMessage };
      }
      return { continue: true };
    }
    return { continue: true };
  }
  if (!isHarnessFollowupMessage(prompt)) {
    store.clearChainPending(conversationId);
  }
  return { continue: true };
}
function handleAfterFileEdit(store, payload, projectRoot) {
  const conversationId = cid(payload);
  const filePath = payload.file_path ?? payload.filePath ?? "";
  if (!conversationId || !filePath) return;
  if (!isProductCodeEdit(filePath)) return;
  const cfg = loadProjectReviewConfig(projectRoot);
  if (cfg.reviewScope === "project") {
    ensureAmbientReviewSession(
      store,
      conversationId,
      projectRoot,
      cfg.reviewScope
    );
  }
  store.markCodeEdited(conversationId);
}
function handleStop(engine, payload) {
  const conversationId = cid(payload);
  if (!conversationId) return {};
  const status = normalizeCursorStopStatus(payload);
  const loopCount = payload.loop_count ?? payload.loopCount ?? 0;
  const transcriptPath = payload.transcript_path ?? payload.transcriptPath;
  const action = engine.handleStop({
    conversationId,
    status,
    loopCount,
    transcriptPath
  });
  if (!action) return {};
  if (!action.loop) {
    return { followup_message: action.message };
  }
  return { followup_message: action.message, loop: true };
}

// src/vendor-entry.ts
function createConfiguredReviewEngine2(store, projectRoot) {
  const cfg = loadProjectReviewConfig(projectRoot);
  const bundle = loadLocale(cfg.locale);
  return createConfiguredReviewEngine(store, projectRoot, bundle, cfg);
}
export {
  ReviewEngine,
  StateStore,
  createConfiguredReviewEngine2 as createConfiguredReviewEngine,
  getLatestSchemaVersion,
  handleAfterFileEdit,
  handleBeforeSubmitPrompt,
  handleStop,
  loadProjectReviewConfig
};
