export type TriggerKind =
  | "on"
  | "run"
  | "off"
  | "resume"
  | "replan"
  | "resume_review"
  | "track_pick";

export interface TriggerEvent {
  kind: TriggerKind;
  source: "slash" | "text" | "cli";
  command?: string;
  slug?: string;
  initialBrief?: string;
  trackPick?: string;
  conversationId: string;
  projectRoot: string;
}

export interface TriggerConfig {
  match?: "line_start";
  on?: string[];
  run?: string[];
  off?: string[];
  resume?: string[];
  replan?: string[];
  resume_review?: string[];
}

export const DEFAULT_TRIGGERS: Required<
  Omit<TriggerConfig, "match">
> & { match: "line_start" } = {
  match: "line_start",
  on: ["Autopilot ON", "Enable autopilot", "开启自动驾驶"],
  run: ["Autopilot RUN", "Start execution", "开始执行"],
  off: ["Autopilot OFF", "Disable autopilot", "关闭自动驾驶"],
  resume: ["Autopilot RESUME", "继续执行"],
  replan: ["Autopilot REPLAN", "修改方案"],
  resume_review: ["Resume review", "继续自审"],
};

const SLASH_MAP: Record<string, TriggerKind> = {
  "autopilot-on": "on",
  "autopilot-run": "run",
  "autopilot-off": "off",
  "autopilot-resume": "resume",
  "autopilot-replan": "replan",
};

/** Prefixes that count as harness followups (E8: do not clear chain_pending). */
export const HARNESS_FOLLOWUP_PREFIXES = [
  "Review fix round",
  "Review confirm",
  "Advance checklist",
  "All checklist items done",
  "Stuck:",
  "Recover:",
  "Review complete",
  "Verify failed",
  "自审修复",
  "自审确认",
  "自审完成",
  "推进下一项",
  "全部完成",
  "校验失败",
  // Match zh recover/stuck templates (fullwidth colon) — bare「恢复」is too broad.
  "恢复：",
  "卡住：",
  // Halfwidth colon variants (same as isRecoverOrStuckFollowupMessage).
  "恢复:",
  "卡住:",
];

function stripUserQuery(prompt: string): string {
  const m = prompt.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i);
  return (m?.[1] ?? prompt).trim();
}

/**
 * Prompt body after stripping `<user_query>` and leading markup lines
 * (`<timestamp>…</timestamp>`, etc.). Keeps the remainder of a multiline tip.
 */
export function substantivePromptBody(text: string): string {
  const body = stripUserQuery(text || "");
  const lines = body.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i]!.trim();
    if (!trimmed) {
      i++;
      continue;
    }
    // Cursor may prepend <timestamp>...</timestamp>.
    if (trimmed.startsWith("<") && trimmed.includes(">")) {
      i++;
      continue;
    }
    break;
  }
  return lines.slice(i).join("\n").trim();
}

/** First non-empty line of {@link substantivePromptBody}. */
export function firstSubstantiveLine(text: string): string {
  const body = substantivePromptBody(text);
  if (!body) return "";
  return body.split(/\r?\n/)[0]?.trim() ?? "";
}

export function isHarnessFollowupMessage(text: string): boolean {
  // Cursor may wrap the prompt in <user_query> and/or a leading <timestamp> line.
  const line = firstSubstantiveLine(text);
  if (!line) return false;
  return HARNESS_FOLLOWUP_PREFIXES.some((p) => line.startsWith(p));
}

/**
 * Recover automation prompts (not stuck). Used for error-recover coalesce/CAS.
 * Must tolerate <user_query> / <timestamp> wrappers like isHarnessFollowupMessage.
 */
export function isRecoverFollowupMessage(text: string): boolean {
  const line = firstSubstantiveLine(text);
  if (!line) return false;
  return (
    line.startsWith("Recover:") ||
    line.startsWith("恢复：") ||
    line.startsWith("恢复:")
  );
}

/**
 * Recover / stuck automation prompts. Safe to drop on user Stop or ordinary chat
 * (unlike fix/confirm pending, which must survive for lens redelivery).
 */
export function isRecoverOrStuckFollowupMessage(text: string): boolean {
  const line = firstSubstantiveLine(text);
  if (!line) return false;
  return (
    isRecoverFollowupMessage(line) ||
    line.startsWith("Stuck:") ||
    line.startsWith("卡住：") ||
    line.startsWith("卡住:")
  );
}

/** Cursor / host phrases that mean the user clicked Stop (not a model crash). */
export const USER_ABORT_MARKERS = [
  "user aborted",
  "interrupted manually",
  "aborted/interrupted",
] as const;

export function isUserAbortText(text: string): boolean {
  const low = (text || "").toLowerCase();
  if (!low.trim()) return false;
  return USER_ABORT_MARKERS.some((m) => low.includes(m));
}

function firstLine(text: string): string {
  return text.trim().split(/\r?\n/)[0]?.trim() ?? "";
}

function matchTextTrigger(
  line: string,
  phrases: string[],
): { matched: string; rest: string } | null {
  for (const phrase of phrases) {
    if (line === phrase || line.startsWith(phrase + " ") || line.startsWith(phrase + "·") || line.startsWith(phrase + " ·")) {
      let rest = line.slice(phrase.length).trim();
      rest = rest.replace(/^[·•]\s*/, "").trim();
      return { matched: phrase, rest };
    }
  }
  return null;
}

function parseSlugAndBrief(rest: string): { slug?: string; initialBrief?: string } {
  if (!rest) return {};
  // token optional then · slug or free text
  const parts = rest.split(/\s*·\s*/);
  if (parts.length >= 2) {
    const maybeSlug = parts[1]!.trim();
    if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(maybeSlug)) {
      return { slug: maybeSlug, initialBrief: parts.slice(2).join(" · ").trim() || undefined };
    }
  }
  if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(rest)) {
    return { slug: rest };
  }
  return { initialBrief: rest };
}

export function parseTrigger(options: {
  prompt: string;
  conversationId: string;
  projectRoot: string;
  triggers?: TriggerConfig;
  pendingAction?: string | null;
}): TriggerEvent | null {
  const {
    conversationId,
    projectRoot,
    triggers = DEFAULT_TRIGGERS,
    pendingAction,
  } = options;
  const text = stripUserQuery(options.prompt);
  const line = firstLine(text);

  // Slash: /autopilot-on … or bare skill name
  const slash = line.match(/^\/?(autopilot-(?:on|run|off|resume|replan))(?:\s+(.*))?$/i);
  if (slash) {
    const command = slash[1]!.toLowerCase();
    const kind = SLASH_MAP[command];
    if (!kind) return null;
    const rest = (slash[2] ?? "").trim();
    const event: TriggerEvent = {
      kind,
      source: "slash",
      command,
      conversationId,
      projectRoot,
    };
    if (kind === "on") {
      const { slug, initialBrief } = parseSlugAndBrief(rest);
      if (slug) event.slug = slug;
      if (initialBrief || (!slug && rest)) event.initialBrief = initialBrief ?? rest;
    } else if (kind === "run" || kind === "replan" || kind === "resume") {
      const { slug, initialBrief } = parseSlugAndBrief(rest);
      if (slug) event.slug = slug;
      else if (rest && kind !== "resume") {
        event.slug = rest.split(/\s+/)[0];
      } else if (rest && kind === "resume") {
        // Single token → pass through (applyResume rejects unsafe). Multi-word
        // free text → no slug (bare resume). Do not silently drop illegal slugs.
        const token = rest.split(/\s+/)[0]!;
        if (token === rest) event.slug = token;
      }
      if (initialBrief && kind !== "resume") event.initialBrief = initialBrief;
    }
    return event;
  }

  const cfg = { ...DEFAULT_TRIGGERS, ...triggers };

  const kinds: Array<{ kind: TriggerKind; phrases: string[] }> = [
    { kind: "on", phrases: cfg.on },
    { kind: "run", phrases: cfg.run },
    { kind: "off", phrases: cfg.off },
    { kind: "resume", phrases: cfg.resume },
    { kind: "replan", phrases: cfg.replan },
    { kind: "resume_review", phrases: cfg.resume_review },
  ];

  for (const { kind, phrases } of kinds) {
    const hit = matchTextTrigger(line, phrases);
    if (!hit) continue;
    const event: TriggerEvent = {
      kind,
      source: "text",
      conversationId,
      projectRoot,
    };
    if (kind === "on") {
      const { slug, initialBrief } = parseSlugAndBrief(hit.rest);
      if (slug) event.slug = slug;
      if (initialBrief || (!slug && hit.rest)) event.initialBrief = initialBrief ?? hit.rest;
    } else if (kind === "run" || kind === "replan" || kind === "resume") {
      const { slug } = parseSlugAndBrief(hit.rest);
      if (slug) event.slug = slug;
      else if (hit.rest && kind !== "resume") {
        event.slug = hit.rest.split(/\s+/)[0];
      } else if (hit.rest && kind === "resume") {
        // Single token → pass through (applyResume rejects unsafe). Multi-word
        // free text → no slug (bare resume).
        const token = hit.rest.split(/\s+/)[0]!;
        if (token === hit.rest) event.slug = token;
      }
    }
    return event;
  }

  // track_pick when pending
  if (pendingAction === "run" || pendingAction === "replan") {
    if (/^\d+$/.test(line) || /^[a-z0-9]+(-[a-z0-9]+)*$/.test(line)) {
      return {
        kind: "track_pick",
        source: "text",
        trackPick: line,
        conversationId,
        projectRoot,
      };
    }
  }

  return null;
}
