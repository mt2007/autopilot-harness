import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeInProjectPlansDir,
  StateStore,
} from "@autopilot-harness/core";
import { installInitYes } from "../src/init/install.js";
import { applyPlatformsToConfigYaml } from "../src/init/platforms.js";
import { normalizePlansDir } from "../src/init/wizard-helpers.js";
import {
  formatStatus,
  hasGlobalSelfReviewHooks,
  readPinVersion,
  readStaleAfterHours,
  runDoctor,
  shortSessionId,
} from "../src/index.js";

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-cli-sd-"));
}

describe("formatStatus", () => {
  let root: string;
  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports not initialized", () => {
    root = tmpProject();
    expect(formatStatus(root)).toMatch(/not initialized/i);
  });

  it("rejects empty projectRoot (does not resolve to cwd)", () => {
    expect(formatStatus("")).toMatch(/projectRoot must be a non-empty string/);
    expect(readStaleAfterHours("   ")).toBe(0);
    expect(readPinVersion("")).toBeNull();
  });

  it("shows preferred_name, config, and active session from state.db", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const id = "sta-aaaa-bbbb-cccc-ddddeeee0001";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: id,
      project_root: root,
      code_root: root,
      track_id: "auth-fix",
      track_title: "Auth fix",
      session_title: "Cursor chat",
      phase: "executing",
      paused: 1,
      paused_reason: "human_gate",
      armed: 0,
      checklist_path: path.join(root, "plans", "auth-fix", "checklist.md"),
    });
    store.close();

    const text = formatStatus(root);
    expect(text).toMatch(/^Autopilot status/m);
    expect(text).toMatch(/platforms:\s*cursor\(ide\)/);
    expect(text).toMatch(/locale:\s*en/);
    expect(text).toMatch(/plans:\s*plans/);
    expect(text).toMatch(/sessions:\s*1/);
    expect(text).toMatch(/Auth fix/);
    expect(text).toMatch(/executing \(paused\)/);
    expect(text).toMatch(new RegExp(shortSessionId(id)));
  });

  it("lists pending+candidates for latest mid-pick (Cursor pick source)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: "pick-aaaa-bbbb-cccc-ddddeeee0001",
      project_root: root,
      code_root: root,
      track_id: "_pending",
      phase: "planning",
      armed: 0,
      paused: 0,
      pending_action: "run",
      track_candidates_json: JSON.stringify([
        { slug: "alpha", title: "A" },
        { slug: "beta", title: "B" },
      ]),
      checklist_path: "",
    });
    store.close();

    const text = formatStatus(root);
    expect(text).toMatch(/pending:\s*run\b/);
    expect(text).not.toMatch(/pending:\s*run @/);
    expect(text).toMatch(/candidates:\s*alpha, beta/);
  });

  it("shows pending without candidates on bad/empty JSON; skips junk before valid slugs", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: "bad-aaaa-bbbb-cccc-ddddeeee0001",
      project_root: root,
      code_root: root,
      track_id: "_pending",
      phase: "planning",
      armed: 0,
      paused: 0,
      pending_action: "run",
      track_candidates_json: "{not-json",
      checklist_path: "",
    });
    store.close();
    let text = formatStatus(root);
    expect(text).toMatch(/pending:\s*run\b/);
    expect(text).not.toMatch(/candidates:/);

    const storeEmpty = new StateStore(root);
    storeEmpty.upsertSession({
      conversation_id: "empty-aaaa-bbbb-cccc-ddddeeee0000",
      project_root: root,
      code_root: root,
      track_id: "_pending",
      phase: "planning",
      armed: 0,
      paused: 0,
      pending_action: "run",
      track_candidates_json: "[]",
      checklist_path: "",
    });
    storeEmpty.close();
    text = formatStatus(root);
    expect(text).toMatch(/pending:\s*run\b/);
    expect(text).not.toMatch(/candidates:/);

    const store2 = new StateStore(root);
    store2.upsertSession({
      conversation_id: "junk-aaaa-bbbb-cccc-ddddeeee0002",
      project_root: root,
      code_root: root,
      track_id: "_pending",
      phase: "planning",
      armed: 0,
      paused: 0,
      pending_action: "run",
      track_candidates_json: JSON.stringify([
        null,
        { slug: 1 },
        { notSlug: "x" },
        { slug: "gamma" },
      ]),
      checklist_path: "",
    });
    store2.close();
    text = formatStatus(root);
    expect(text).toMatch(/pending:\s*run\b/);
    expect(text).toMatch(/candidates:\s*gamma/);

    const storeHuge = new StateStore(root);
    storeHuge.upsertSession({
      conversation_id: "huge-aaaa-bbbb-cccc-ddddeeee0003",
      project_root: root,
      code_root: root,
      track_id: "_pending",
      phase: "planning",
      armed: 0,
      paused: 0,
      pending_action: "run",
      // Oversize JSON: status must not stall / must omit candidates (scan fallback).
      track_candidates_json: `[{"slug":"keep"},${"0,".repeat(20_000)}"x"]`,
      checklist_path: "",
    });
    storeHuge.close();
    text = formatStatus(root);
    expect(text).toMatch(/pending:\s*run\b/);
    expect(text).not.toMatch(/candidates:/);
  });

  it("lists armed executors and pending pick even when not latest", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const store = new StateStore(root);
    const older = "old-aaaa-bbbb-cccc-ddddeeee0001";
    const newer = "new-aaaa-bbbb-cccc-ddddeeee0002";
    store.upsertSession({
      conversation_id: older,
      project_root: root,
      code_root: root,
      track_id: "_pending",
      phase: "planning",
      armed: 0,
      paused: 0,
      pending_action: "run",
      track_candidates_json: JSON.stringify([
        { slug: "alpha" },
        { slug: "beta" },
      ]),
      checklist_path: "",
    });
    // Touch newer last so it sorts as latest
    store.upsertSession({
      conversation_id: newer,
      project_root: root,
      code_root: root,
      track_id: "demo",
      phase: "executing",
      armed: 1,
      paused: 0,
      checklist_path: path.join(root, "plans", "demo", "checklist.md"),
    });
    store.close();

    const text = formatStatus(root);
    expect(text).toMatch(/executors:/);
    expect(text).toMatch(/track=demo/);
    expect(text).toMatch(/OFF|session purge/i);
    expect(text).toMatch(/pending:\s*run @/);
    expect(text).toMatch(/candidates:\s*alpha, beta/);
  });

  it("does not list paused or unarmed executing as one_executor occupiers", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: "paused-exec-aaaa-bbbb-cccc-ddddeeee0001",
      project_root: root,
      code_root: root,
      track_id: "paused-track",
      phase: "executing",
      armed: 1,
      paused: 1,
      checklist_path: "",
    });
    store.upsertSession({
      conversation_id: "unarmed-exec-aaaa-bbbb-cccc-ddddeeee0002",
      project_root: root,
      code_root: root,
      track_id: "unarmed-track",
      phase: "executing",
      armed: 0,
      paused: 0,
      checklist_path: "",
    });
    store.close();

    const text = formatStatus(root);
    expect(text).not.toMatch(/executors:/);
    expect(text).not.toMatch(/track=paused-track|track=unarmed-track/);
  });
});

describe("runDoctor", () => {
  let root: string;
  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects empty projectRoot (does not resolve to cwd)", () => {
    const { ok, lines } = runDoctor("  ");
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/projectRoot must be a non-empty string/);
  });

  it("passes after init with schema and plans checks", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    // Touch state.db via store open so schema check can run.
    new StateStore(root).close();
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(/OK\s+config\.yml/);
    expect(joined).toMatch(/OK\s+\.autopilotignore/);
    expect(joined).toMatch(/OK\s+hook vendor runtime/);
    expect(joined).toMatch(/OK\s+state\.db/);
    expect(joined).toMatch(/schema_version/);
    expect(joined).toMatch(/OK\s+plans/);
  });

  it("lists executing+armed occupiers with OFF / session purge guidance", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: "occ-aaaa-bbbb-cccc-ddddeeee0001",
      project_root: root,
      code_root: root,
      track_id: "held-track",
      phase: "executing",
      armed: 1,
      paused: 0,
      checklist_path: path.join(root, "plans", "demo", "checklist.md"),
    });
    store.upsertSession({
      conversation_id: "plan-aaaa-bbbb-cccc-ddddeeee0002",
      project_root: root,
      code_root: root,
      track_id: "other",
      phase: "planning",
      armed: 0,
      paused: 0,
      checklist_path: "",
    });
    store.close();

    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(/WARN\s+\d+ executing\+armed session\(s\)/);
    expect(joined).toMatch(/held-track/);
    expect(joined).toMatch(/Autopilot OFF/i);
    expect(joined).toMatch(/session purge/i);
    expect(joined).not.toMatch(/track=other/);
  });

  it("truncates occupier lists with …and N more (status + doctor)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const store = new StateStore(root);
    for (let i = 0; i < 9; i++) {
      const n = String(i).padStart(2, "0");
      store.upsertSession({
        conversation_id: `occ${n}-aaaa-bbbb-cccc-ddddeeee00${n}`,
        project_root: root,
        code_root: root,
        track_id: `track-${n}`,
        phase: "executing",
        armed: 1,
        paused: 0,
        checklist_path: "",
      });
    }
    store.close();

    const status = formatStatus(root);
    expect(status).toMatch(/executors:/);
    expect(status).toMatch(/…and 1 more/);
    // Order follows listSessions (newest-first; timestamp ties by conversation_id).
    // Assert cap only — do not depend on which slug is truncated.
    const statusExec = status.split("executors:")[1] ?? "";
    expect(statusExec.match(/track=track-\d+/g)?.length ?? 0).toBe(8);

    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const doctor = lines.join("\n");
    expect(doctor).toMatch(/WARN\s+9 executing\+armed session\(s\)/);
    expect(doctor).toMatch(/…and 1 more/);
    const doctorOcc = doctor.split(/WARN\s+9 executing\+armed/)[1] ?? "";
    expect(doctorOcc.match(/track=track-\d+/g)?.length ?? 0).toBe(8);
  });

  it("does not WARN for paused or unarmed executing sessions", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: "paused-doc-aaaa-bbbb-cccc-ddddeeee0001",
      project_root: root,
      code_root: root,
      track_id: "paused-only",
      phase: "executing",
      armed: 1,
      paused: 1,
      checklist_path: "",
    });
    store.close();

    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).not.toMatch(/armed executor|executing\+armed/i);
    expect(joined).not.toMatch(/paused-only/);
  });

  it("WARNs when Autopilot stop omits loop_limit null", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();

    const hooksPath = path.join(root, ".cursor", "hooks.json");
    fs.writeFileSync(
      hooksPath,
      JSON.stringify({
        version: 1,
        hooks: {
          beforeSubmitPrompt: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --event beforeSubmitPrompt",
            },
          ],
          afterFileEdit: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --event afterFileEdit",
            },
          ],
          stop: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --event stop",
            },
          ],
          subagentStop: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --event subagentStop",
              loop_limit: null,
            },
          ],
        },
      }),
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(/Autopilot stop missing loop_limit:null/i);
    expect(joined).not.toMatch(/OK\s+hooks\.json Autopilot entries/);
  });

  it("WARNs when Autopilot hooks omit --platform stamp (no OK)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();

    fs.writeFileSync(
      path.join(root, ".cursor", "hooks.json"),
      JSON.stringify({
        version: 1,
        hooks: {
          beforeSubmitPrompt: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --event beforeSubmitPrompt",
            },
          ],
          afterFileEdit: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --event afterFileEdit",
            },
          ],
          stop: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --event stop",
              loop_limit: null,
            },
          ],
          subagentStop: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --event subagentStop",
              loop_limit: null,
            },
          ],
        },
      }),
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(/missing --platform cursor/i);
    expect(joined).not.toMatch(/OK\s+hooks\.json Autopilot entries/);
  });

  it("WARNs loop_limit even when another Autopilot event is missing", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();

    fs.writeFileSync(
      path.join(root, ".cursor", "hooks.json"),
      JSON.stringify({
        version: 1,
        hooks: {
          beforeSubmitPrompt: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --event beforeSubmitPrompt",
            },
          ],
          // afterFileEdit intentionally missing
          stop: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --event stop",
            },
          ],
          subagentStop: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --event subagentStop",
              loop_limit: null,
            },
          ],
        },
      }),
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    const joined = lines.join("\n");
    expect(joined).toMatch(/missing Autopilot.*afterFileEdit/i);
    expect(joined).toMatch(/Autopilot stop missing loop_limit:null/i);
  });

  it("WARNs when Autopilot subagentStop omits loop_limit null", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();

    fs.writeFileSync(
      path.join(root, ".cursor", "hooks.json"),
      JSON.stringify({
        version: 1,
        hooks: {
          beforeSubmitPrompt: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --platform cursor --event beforeSubmitPrompt",
            },
          ],
          afterFileEdit: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --platform cursor --event afterFileEdit",
            },
          ],
          stop: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --platform cursor --event stop",
              loop_limit: null,
            },
          ],
          subagentStop: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --platform cursor --event subagentStop",
            },
          ],
        },
      }),
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(/Autopilot subagentStop missing loop_limit:null/i);
    expect(joined).not.toMatch(/OK\s+hooks\.json Autopilot entries/);
  });

  it("FAILs when Autopilot subagentStop event is missing", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();

    fs.writeFileSync(
      path.join(root, ".cursor", "hooks.json"),
      JSON.stringify({
        version: 1,
        hooks: {
          beforeSubmitPrompt: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --platform cursor --event beforeSubmitPrompt",
            },
          ],
          afterFileEdit: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --platform cursor --event afterFileEdit",
            },
          ],
          stop: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --platform cursor --event stop",
              loop_limit: null,
            },
          ],
        },
      }),
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    const joined = lines.join("\n");
    expect(joined).toMatch(/missing Autopilot for:.*subagentStop/i);
    expect(joined).not.toMatch(/OK\s+hooks\.json Autopilot entries/);
  });

  it("WARNs when ~/.cursor still has global self-review hooks", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();

    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-home-"));
    try {
      const cursorDir = path.join(fakeHome, ".cursor");
      fs.mkdirSync(cursorDir, { recursive: true });
      fs.writeFileSync(
        path.join(cursorDir, "hooks.json"),
        JSON.stringify({
          version: 1,
          hooks: {
            stop: [
              {
                command: "python3 ./hooks/run-global-self-review.py stop",
              },
            ],
          },
        }),
      );
      const { ok, lines } = runDoctor(root, { homeDir: fakeHome });
      expect(ok).toBe(true);
      expect(lines.join("\n")).toMatch(/global self-review/i);
    } finally {
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it("ignores symlinked ~/.cursor/hooks.json (no follow)", () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-home-sym-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-outside-"));
    try {
      const target = path.join(outside, "secret-hooks.json");
      fs.writeFileSync(
        target,
        JSON.stringify({
          hooks: { stop: [{ command: "run-global-self-review.py" }] },
        }),
      );
      const cursorDir = path.join(fakeHome, ".cursor");
      fs.mkdirSync(cursorDir, { recursive: true });
      fs.symlinkSync(target, path.join(cursorDir, "hooks.json"));
      expect(hasGlobalSelfReviewHooks(fakeHome)).toBe(false);
    } finally {
      fs.rmSync(fakeHome, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects non-absolute homeDir for global hooks check", () => {
    expect(hasGlobalSelfReviewHooks("")).toBe(false);
    expect(hasGlobalSelfReviewHooks(".cursor")).toBe(false);
    expect(hasGlobalSelfReviewHooks("relative/home")).toBe(false);
  });

  it("WARNs on stale sessions and can prune them", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const id = "stl-aaaa-bbbb-cccc-ddddeeee0001";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: id,
      project_root: root,
      code_root: root,
      track_id: "old",
      checklist_path: "plans/old/checklist.md",
      armed: 0,
      phase: "planning",
    });
    // Force last_active_at far in the past.
    store.db
      .prepare(
        `UPDATE sessions SET last_active_at = ? WHERE conversation_id = ?`,
      )
      .run("2020-01-01T00:00:00.000Z", id);
    store.close();

    const warned = runDoctor(root, { nowMs: Date.parse("2026-08-28T00:00:00Z") });
    expect(warned.ok).toBe(true);
    expect(warned.lines.join("\n")).toMatch(/stale session/i);

    const pruned = runDoctor(root, {
      pruneStale: true,
      nowMs: Date.parse("2026-08-28T00:00:00Z"),
    });
    expect(pruned.ok).toBe(true);
    expect(pruned.pruned).toBe(1);
    expect(pruned.lines.join("\n")).toMatch(/pruned 1 stale/i);

    const store2 = new StateStore(root);
    expect(store2.getSession(id)).toBeNull();
    store2.close();
  });

  it("FAILs on unknown phase (orphan state)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const id = "orp-aaaa-bbbb-cccc-ddddeeee0001";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: id,
      project_root: root,
      code_root: root,
      track_id: "x",
      checklist_path: "plans/x/checklist.md",
      armed: 0,
      phase: "planning",
    });
    store.db
      .prepare(`UPDATE sessions SET phase = ? WHERE conversation_id = ?`)
      .run("weird_phase", id);
    store.close();

    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/unknown phase/i);
  });

  it("WARNs when pin lags package version", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
        packageVersion: "0.1.0",
      }).ok,
    ).toBe(true);
    const { ok, lines } = runDoctor(root, { packageVersion: "0.2.0" });
    expect(ok).toBe(true);
    expect(lines.join("\n")).toMatch(/upgrade/i);
  });

  it("FAILs on invalid config.yml YAML", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    fs.writeFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "platform: [unterminated\n",
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/invalid YAML/i);
  });

  it("refuses --prune-stale when schema_version mismatches", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const id = "sch-aaaa-bbbb-cccc-ddddeeee0001";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: id,
      project_root: root,
      code_root: root,
      track_id: "old",
      checklist_path: "plans/old/checklist.md",
      armed: 0,
      phase: "planning",
    });
    store.db
      .prepare(
        `UPDATE sessions SET last_active_at = ? WHERE conversation_id = ?`,
      )
      .run("2020-01-01T00:00:00.000Z", id);
    // Ahead of package latest so reopen migrate() will not rewrite it down.
    store.db
      .prepare(
        `INSERT OR REPLACE INTO _schema_meta (key, value) VALUES ('schema_version', ?)`,
      )
      .run("999");
    store.close();

    const result = runDoctor(root, {
      pruneStale: true,
      nowMs: Date.parse("2026-08-28T00:00:00Z"),
    });
    expect(result.ok).toBe(false);
    expect(result.pruned).toBeUndefined();
    expect(result.lines.join("\n")).toMatch(/refusing --prune-stale/i);

    const store2 = new StateStore(root);
    expect(store2.getSession(id)).not.toBeNull();
    store2.close();
  });

  it("skips armed executing sessions during --prune-stale", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const liveId = "liv-aaaa-bbbb-cccc-ddddeeee0001";
    const pausedArmedId = "paz-aaaa-bbbb-cccc-ddddeeee0001";
    const deadId = "ded-aaaa-bbbb-cccc-ddddeeee0001";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: liveId,
      project_root: root,
      code_root: root,
      track_id: "live",
      checklist_path: "plans/live/checklist.md",
      armed: 1,
      phase: "executing",
      paused: 0,
    });
    store.upsertSession({
      conversation_id: pausedArmedId,
      project_root: root,
      code_root: root,
      track_id: "paused",
      checklist_path: "plans/paused/checklist.md",
      armed: 1,
      phase: "executing",
      paused: 1,
      paused_reason: "human_gate",
    });
    store.upsertSession({
      conversation_id: deadId,
      project_root: root,
      code_root: root,
      track_id: "dead",
      checklist_path: "plans/dead/checklist.md",
      armed: 0,
      phase: "planning",
    });
    store.db
      .prepare(`UPDATE sessions SET last_active_at = ?`)
      .run("2020-01-01T00:00:00.000Z");
    store.close();

    const result = runDoctor(root, {
      pruneStale: true,
      nowMs: Date.parse("2026-08-28T00:00:00Z"),
    });
    expect(result.ok).toBe(true);
    expect(result.pruned).toBe(1);
    expect(result.lines.join("\n")).toMatch(/skipped 2 in-flight/i);

    const store2 = new StateStore(root);
    expect(store2.getSession(liveId)).not.toBeNull();
    expect(store2.getSession(pausedArmedId)).not.toBeNull();
    expect(store2.getSession(deadId)).toBeNull();
    store2.close();
  });

  it("skips pending_action and armed non-executing during --prune-stale", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const pendingId = "pen-aaaa-bbbb-cccc-ddddeeee0001";
    const armedPlanId = "apl-aaaa-bbbb-cccc-ddddeeee0001";
    const deadId = "dd2-aaaa-bbbb-cccc-ddddeeee0001";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: pendingId,
      project_root: root,
      code_root: root,
      track_id: "_pending",
      checklist_path: "",
      armed: 0,
      phase: "planning",
      pending_action: "run",
    });
    store.upsertSession({
      conversation_id: armedPlanId,
      project_root: root,
      code_root: root,
      track_id: "x",
      checklist_path: "plans/x/checklist.md",
      armed: 1,
      phase: "planning",
    });
    store.upsertSession({
      conversation_id: deadId,
      project_root: root,
      code_root: root,
      track_id: "dead",
      checklist_path: "plans/dead/checklist.md",
      armed: 0,
      phase: "idle",
    });
    store.db
      .prepare(`UPDATE sessions SET last_active_at = ?`)
      .run("2020-01-01T00:00:00.000Z");
    store.close();

    const result = runDoctor(root, {
      pruneStale: true,
      nowMs: Date.parse("2026-08-28T00:00:00Z"),
    });
    expect(result.ok).toBe(true);
    expect(result.pruned).toBe(1);
    expect(result.lines.join("\n")).toMatch(/skipped 2 in-flight/i);

    const store2 = new StateStore(root);
    expect(store2.getSession(pendingId)).not.toBeNull();
    expect(store2.getSession(armedPlanId)).not.toBeNull();
    expect(store2.getSession(deadId)).toBeNull();
    store2.close();
  });

  it("skips paused human_gate sessions during --prune-stale", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const gateId = "gat-aaaa-bbbb-cccc-ddddeeee0001";
    const deadId = "gd2-aaaa-bbbb-cccc-ddddeeee0001";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: gateId,
      project_root: root,
      code_root: root,
      track_id: "gate",
      checklist_path: "plans/gate/checklist.md",
      armed: 0,
      phase: "executing",
      paused: 1,
      paused_reason: "human_gate",
    });
    store.upsertSession({
      conversation_id: deadId,
      project_root: root,
      code_root: root,
      track_id: "dead",
      checklist_path: "plans/dead/checklist.md",
      armed: 0,
      phase: "idle",
      paused: 0,
    });
    store.db
      .prepare(`UPDATE sessions SET last_active_at = ?`)
      .run("2020-01-01T00:00:00.000Z");
    store.close();

    const result = runDoctor(root, {
      pruneStale: true,
      nowMs: Date.parse("2026-08-28T00:00:00Z"),
    });
    expect(result.ok).toBe(true);
    expect(result.pruned).toBe(1);
    expect(result.lines.join("\n")).toMatch(/skipped 1 in-flight/i);

    const store2 = new StateStore(root);
    expect(store2.getSession(gateId)).not.toBeNull();
    expect(store2.getSession(deadId)).toBeNull();
    store2.close();
  });

  it("refuses --prune-stale when orphan phase rows exist", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const orphanId = "orf-aaaa-bbbb-cccc-ddddeeee0001";
    const otherId = "oth-aaaa-bbbb-cccc-ddddeeee0001";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: orphanId,
      project_root: root,
      code_root: root,
      track_id: "x",
      checklist_path: "plans/x/checklist.md",
      armed: 0,
      phase: "planning",
    });
    store.upsertSession({
      conversation_id: otherId,
      project_root: root,
      code_root: root,
      track_id: "y",
      checklist_path: "plans/y/checklist.md",
      armed: 0,
      phase: "idle",
    });
    store.db
      .prepare(`UPDATE sessions SET phase = ? WHERE conversation_id = ?`)
      .run("weird_phase", orphanId);
    store.db
      .prepare(`UPDATE sessions SET last_active_at = ?`)
      .run("2020-01-01T00:00:00.000Z");
    store.close();

    const result = runDoctor(root, {
      pruneStale: true,
      nowMs: Date.parse("2026-08-28T00:00:00Z"),
    });
    expect(result.ok).toBe(false);
    expect(result.pruned).toBeUndefined();
    expect(result.lines.join("\n")).toMatch(/refusing --prune-stale.*orphan/i);
    const store2 = new StateStore(root);
    expect(store2.getSession(orphanId)).not.toBeNull();
    expect(store2.getSession(otherId)).not.toBeNull();
    store2.close();
  });

  it("stale_after_hours 0 disables stale detection", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const configPath = path.join(root, ".autopilot", "config.yml");
    const yaml = fs.readFileSync(configPath, "utf8");
    fs.writeFileSync(
      configPath,
      yaml.replace(/stale_after_hours:\s*72/, "stale_after_hours: 0"),
    );
    expect(readStaleAfterHours(root)).toBe(0);

    const id = "zro-aaaa-bbbb-cccc-ddddeeee0001";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: id,
      project_root: root,
      code_root: root,
      track_id: "old",
      checklist_path: "plans/old/checklist.md",
      armed: 0,
      phase: "idle",
    });
    store.db
      .prepare(
        `UPDATE sessions SET last_active_at = ? WHERE conversation_id = ?`,
      )
      .run("2020-01-01T00:00:00.000Z", id);
    store.close();

    const result = runDoctor(root, {
      pruneStale: true,
      nowMs: Date.parse("2026-08-28T00:00:00Z"),
    });
    expect(result.ok).toBe(true);
    expect(result.pruned).toBeUndefined();
    expect(result.lines.join("\n")).not.toMatch(/stale session/i);
    const store2 = new StateStore(root);
    expect(store2.getSession(id)).not.toBeNull();
    store2.close();
  });

  it("refuses --prune-stale when config.yml is invalid", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const id = "cfg-aaaa-bbbb-cccc-ddddeeee0001";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: id,
      project_root: root,
      code_root: root,
      track_id: "old",
      checklist_path: "plans/old/checklist.md",
      armed: 0,
      phase: "idle",
    });
    store.db
      .prepare(
        `UPDATE sessions SET last_active_at = ? WHERE conversation_id = ?`,
      )
      .run("2020-01-01T00:00:00.000Z", id);
    store.close();
    fs.writeFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "platform: [unterminated\n",
    );

    const result = runDoctor(root, {
      pruneStale: true,
      nowMs: Date.parse("2026-08-28T00:00:00Z"),
    });
    expect(result.ok).toBe(false);
    expect(result.pruned).toBeUndefined();
    expect(result.lines.join("\n")).toMatch(/invalid YAML/i);
    expect(result.lines.join("\n")).not.toMatch(/pruned \d+ stale/i);
    expect(result.lines.join("\n")).not.toMatch(/stale session/i);
    expect(readStaleAfterHours(root)).toBe(0);

    const store2 = new StateStore(root);
    expect(store2.getSession(id)).not.toBeNull();
    store2.close();
  });

  it("FAILs when artifacts.plans_dir is invalid (no silent fallback OK)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const configPath = path.join(root, ".autopilot", "config.yml");
    const yaml = fs.readFileSync(configPath, "utf8");
    fs.writeFileSync(
      configPath,
      yaml.replace(/plans_dir:\s*plans/, "plans_dir: ../escape"),
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/plans_dir invalid/i);
    // Lock core normalizer (wizard used different "plansDir must …" wording).
    expect(lines.join("\n")).toMatch(
      /not a valid in-project path/i,
    );
    expect(formatStatus(root)).toMatch(/plans:\s*invalid/i);
    expect(formatStatus(root)).toMatch(/not a valid in-project path/i);
  });

  it("readStaleAfterHours respects config (number or numeric string)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    expect(readStaleAfterHours(root)).toBe(72);
    const configPath = path.join(root, ".autopilot", "config.yml");
    let yaml = fs.readFileSync(configPath, "utf8");
    yaml = yaml.replace(/stale_after_hours:\s*72/, "stale_after_hours: 24");
    fs.writeFileSync(configPath, yaml);
    expect(readStaleAfterHours(root)).toBe(24);
    yaml = yaml.replace(/stale_after_hours:\s*24/, 'stale_after_hours: "48"');
    fs.writeFileSync(configPath, yaml);
    expect(readStaleAfterHours(root)).toBe(48);
    yaml = yaml.replace(/stale_after_hours:\s*"48"/, 'stale_after_hours: "0.0"');
    fs.writeFileSync(configPath, yaml);
    expect(readStaleAfterHours(root)).toBe(0);
  });

  it("FAILs on invalid stale_after_hours and does not prune with fallback", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const configPath = path.join(root, ".autopilot", "config.yml");
    const yaml = fs.readFileSync(configPath, "utf8");
    fs.writeFileSync(
      configPath,
      yaml.replace(/stale_after_hours:\s*72/, "stale_after_hours: -5"),
    );
    const id = "bad-aaaa-bbbb-cccc-ddddeeee0001";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: id,
      project_root: root,
      code_root: root,
      track_id: "old",
      checklist_path: "plans/old/checklist.md",
      armed: 0,
      phase: "idle",
    });
    store.db
      .prepare(
        `UPDATE sessions SET last_active_at = ? WHERE conversation_id = ?`,
      )
      .run("2020-01-01T00:00:00.000Z", id);
    store.close();

    const result = runDoctor(root, {
      pruneStale: true,
      nowMs: Date.parse("2026-08-28T00:00:00Z"),
    });
    expect(result.ok).toBe(false);
    expect(result.pruned).toBeUndefined();
    expect(result.lines.join("\n")).toMatch(/stale_after_hours invalid/i);
    expect(result.lines.join("\n")).not.toMatch(/pruned \d+ stale/i);
    expect(result.lines.join("\n")).not.toMatch(/stale session/i);
    expect(readStaleAfterHours(root)).toBe(0);
    const store2 = new StateStore(root);
    expect(store2.getSession(id)).not.toBeNull();
    store2.close();
  });

  it("FAILs when artifacts.plans_dir is not a string", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const configPath = path.join(root, ".autopilot", "config.yml");
    const yaml = fs.readFileSync(configPath, "utf8");
    fs.writeFileSync(
      configPath,
      yaml.replace(/plans_dir:\s*plans/, "plans_dir: 12"),
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/plans_dir must be a string/i);
  });

  it("strips control chars from pin display (status + doctor)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    fs.writeFileSync(
      path.join(root, ".autopilot", "pin.json"),
      JSON.stringify({ "autopilot-harness": "0.1.0\u001b[31mevil" }),
    );
    const status = formatStatus(root);
    expect(status).not.toMatch(/\u001b/);
    expect(status).toMatch(/autopilot-harness@0\.1\.0 \[31mevil/);
    const doctorOut = runDoctor(root).lines.join("\n");
    expect(doctorOut).not.toMatch(/\u001b/);
    expect(doctorOut).toMatch(/pin\.json → 0\.1\.0 \[31mevil/);
  });

  it("FAILs when config.yml exceeds size cap", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const configPath = path.join(root, ".autopilot", "config.yml");
    fs.writeFileSync(configPath, `# ${"x".repeat(1_000_100)}\nplatform: cursor\n`);
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/too large/i);
    expect(readStaleAfterHours(root)).toBe(0);
  });

  it("FAILs when config.yml is a symlink", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const configPath = path.join(root, ".autopilot", "config.yml");
    const outside = path.join(root, "outside-config.yml");
    fs.renameSync(configPath, outside);
    fs.symlinkSync(outside, configPath);
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/symlink/i);
    expect(formatStatus(root)).toMatch(/cannot read config|symlink/i);
    expect(readStaleAfterHours(root)).toBe(0);
  });

  it("FAILs when config.yml is a dangling symlink (not treated as missing)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const configPath = path.join(root, ".autopilot", "config.yml");
    fs.rmSync(configPath, { force: true });
    fs.symlinkSync(path.join(root, "missing-config.yml"), configPath);
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/symlink|unreadable/i);
    expect(lines.join("\n")).not.toMatch(/missing — run init/i);
    expect(formatStatus(root)).toMatch(/cannot read config|symlink/i);
    expect(formatStatus(root)).not.toMatch(/not initialized/i);
    expect(readStaleAfterHours(root)).toBe(0);
  });

  it("treats oversized pin.json as missing/invalid", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    fs.writeFileSync(
      path.join(root, ".autopilot", "pin.json"),
      JSON.stringify({ "autopilot-harness": "0.1.0", pad: "x".repeat(70_000) }),
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/pin\.json missing or invalid/i);
    expect(formatStatus(root)).toMatch(/autopilot-harness@unknown/);
  });

  it("treats symlinked pin.json as missing/invalid (no follow)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const pinPath = path.join(root, ".autopilot", "pin.json");
    const outside = path.join(root, "outside-pin.json");
    fs.renameSync(pinPath, outside);
    fs.symlinkSync(outside, pinPath);
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/pin\.json missing or invalid/i);
  });

  it("FAILs when project .cursor/hooks.json is a symlink", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const hooksPath = path.join(root, ".cursor", "hooks.json");
    const outside = path.join(root, "outside-hooks.json");
    fs.renameSync(hooksPath, outside);
    fs.symlinkSync(outside, hooksPath);
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/hooks\.json unreadable|symlink/i);
  });

  it("FAILs when project hooks.json is a dangling symlink (not treated as missing)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const hooksPath = path.join(root, ".cursor", "hooks.json");
    fs.rmSync(hooksPath, { force: true });
    fs.symlinkSync(path.join(root, "missing-hooks.json"), hooksPath);
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/hooks\.json unreadable|symlink/i);
    expect(lines.join("\n")).not.toMatch(/hooks\.json missing/i);
  });

  it("FAILs when plans dir is a dangling symlink (not treated as missing)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const plansDir = path.join(root, "plans");
    fs.rmSync(plansDir, { recursive: true, force: true });
    fs.symlinkSync(path.join(root, "missing-plans"), plansDir);
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/plans path is a symlink/i);
    expect(lines.join("\n")).not.toMatch(/plans dir missing/i);
  });

  it("WARNs when a skill path is a dangling symlink (not counted as present)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const skillPath = path.join(
      root,
      ".cursor",
      "skills",
      "autopilot-on",
      "SKILL.md",
    );
    fs.rmSync(skillPath, { force: true });
    fs.symlinkSync(path.join(root, "missing-skill.md"), skillPath);
    const { lines } = runDoctor(root);
    expect(lines.join("\n")).toMatch(/skill\(s\) missing/i);
  });

  it("WARNs when skill directory is a symlink escape (realpath outside project)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const skillDir = path.join(root, ".cursor", "skills", "autopilot-on");
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "ah-skill-esc-"));
    try {
      fs.writeFileSync(path.join(outsideDir, "SKILL.md"), "# outside\n", "utf8");
      fs.rmSync(skillDir, { recursive: true, force: true });
      fs.symlinkSync(outsideDir, skillDir);
      const { lines } = runDoctor(root);
      expect(lines.join("\n")).toMatch(/skill\(s\) missing/i);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("FAILs when project .cursor/hooks.json is too large", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const hooksPath = path.join(root, ".cursor", "hooks.json");
    fs.writeFileSync(hooksPath, `{"pad":"${"x".repeat(1_000_100)}"}`);
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/hooks\.json unreadable|too large/i);
  });

  it("FAILs hooks shape without echoing control chars in keys", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const hooksPath = path.join(root, ".cursor", "hooks.json");
    const badKey = "before\u001b[2JSubmit";
    fs.writeFileSync(
      hooksPath,
      JSON.stringify({
        version: 1,
        hooks: { [badKey]: "not-an-array" },
      }),
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    const text = lines.join("\n");
    expect(text).not.toMatch(/\u001b/);
    expect(text).toMatch(/hooks\.before \[2JSubmit/);
  });

  it("WARNs when Claude Autopilot hooks omit --platform stamp (no OK)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "claude-code",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();

    const settingsPath = path.join(root, ".claude", "settings.json");
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        env: { CLAUDE_CODE_STOP_HOOK_BLOCK_CAP: "0" },
        hooks: {
          UserPromptSubmit: [
            {
              hooks: [
                {
                  type: "command",
                  command:
                    "node .autopilot/bin/autopilot-harness-hook.mjs --event UserPromptSubmit",
                },
              ],
            },
          ],
          PostToolUse: [
            {
              matcher: "Edit|Write|NotebookEdit",
              hooks: [
                {
                  type: "command",
                  command:
                    "node .autopilot/bin/autopilot-harness-hook.mjs --event PostToolUse",
                },
              ],
            },
          ],
          Stop: [
            {
              hooks: [
                {
                  type: "command",
                  command:
                    "node .autopilot/bin/autopilot-harness-hook.mjs --event Stop",
                },
              ],
            },
          ],
          StopFailure: [
            {
              hooks: [
                {
                  type: "command",
                  command:
                    "node .autopilot/bin/autopilot-harness-hook.mjs --event StopFailure",
                },
              ],
            },
          ],
        },
      }),
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(/missing --platform claude-code/i);
    expect(joined).not.toMatch(/OK\s+\.claude\/settings\.json Autopilot entries/);
  });

  it("WARNs when Claude BLOCK_CAP missing or not 0", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "claude-code",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();

    const settingsPath = path.join(root, ".claude", "settings.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
      env?: Record<string, string>;
    };
    settings.env = { ...(settings.env ?? {}), CLAUDE_CODE_STOP_HOOK_BLOCK_CAP: "8" };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");

    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(/CLAUDE_CODE_STOP_HOOK_BLOCK_CAP/i);
    expect(joined).not.toMatch(/OK\s+\.claude\/settings\.json Autopilot entries/);
    expect(joined).not.toMatch(/FAIL\s+\.cursor\/hooks\.json missing/);
  });

  it("OKs Claude-only doctor without requiring Cursor hooks", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "claude-code",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(/OK\s+\.claude\/settings\.json Autopilot entries/);
    expect(joined).toMatch(/OK\s+skills \(5\)/);
    expect(joined).not.toMatch(/hooks\.json Autopilot entries/);
  });

  it("FAILs when Claude settings.json is missing on a Claude-enabled project", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "claude-code",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    fs.rmSync(path.join(root, ".claude", "settings.json"), { force: true });
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/\.claude\/settings\.json missing/i);
  });

  it("OKs Codex Autopilot entries and WARNs about /hooks trust", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "codex",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(/OK\s+\.codex\/hooks\.json Autopilot entries/);
    expect(joined).toMatch(/OK\s+skills \(5\)/);
    expect(joined).toMatch(/\/hooks trust/i);
    expect(joined).toMatch(/re-trust/i);
    expect(joined).not.toMatch(/FAIL\s+\.codex\/hooks\.json missing/i);
  });

  it("FAILs when .codex/hooks.json is missing on a Codex-enabled project", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "codex",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    fs.rmSync(path.join(root, ".codex", "hooks.json"), { force: true });
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/\.codex\/hooks\.json missing/i);
  });

  it("WARNs when Autopilot Codex hook timeout is set below 120s", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "codex",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const hooksPath = path.join(root, ".codex", "hooks.json");
    const file = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      hooks?: { Stop?: Array<{ hooks?: Array<{ timeout?: number }> }> };
    };
    const stopHook = file.hooks?.Stop?.[0]?.hooks?.[0];
    expect(stopHook).toBeTruthy();
    stopHook!.timeout = 30;
    fs.writeFileSync(hooksPath, JSON.stringify(file, null, 2) + "\n");
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    expect(lines.join("\n")).toMatch(/timeout set below 120s/i);
  });

  it("WARNs when Codex Autopilot hooks omit --platform stamp", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "codex",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const hooksPath = path.join(root, ".codex", "hooks.json");
    fs.writeFileSync(
      hooksPath,
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            {
              hooks: [
                {
                  type: "command",
                  command:
                    "node .autopilot/bin/autopilot-harness-hook.mjs --event UserPromptSubmit",
                },
              ],
            },
          ],
          PostToolUse: [
            {
              matcher: "apply_patch|Edit|Write",
              hooks: [
                {
                  type: "command",
                  command:
                    "node .autopilot/bin/autopilot-harness-hook.mjs --event PostToolUse",
                },
              ],
            },
          ],
          Stop: [
            {
              hooks: [
                {
                  type: "command",
                  command:
                    "node .autopilot/bin/autopilot-harness-hook.mjs --event Stop",
                },
              ],
            },
          ],
        },
      }),
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    expect(lines.join("\n")).toMatch(/missing --platform codex/i);
  });

  it("WARNs on duplicate Codex Autopilot hooks without FAIL", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "codex",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const hooksPath = path.join(root, ".codex", "hooks.json");
    const file = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      hooks: Record<string, Array<Record<string, unknown>>>;
    };
    file.hooks.Stop = [
      ...(file.hooks.Stop ?? []),
      {
        hooks: [
          {
            type: "command",
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --event Stop --platform codex",
          },
        ],
      },
    ];
    fs.writeFileSync(hooksPath, JSON.stringify(file, null, 2) + "\n");
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(/\.codex\/hooks\.json.*duplicate/i);
    expect(joined).not.toMatch(/FAIL\s+\.codex\/hooks\.json missing Autopilot/i);
    expect(joined).not.toMatch(/OK\s+\.codex\/hooks\.json Autopilot entries/);
  });

  it("FAILs when a Codex Autopilot event is missing", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "codex",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const hooksPath = path.join(root, ".codex", "hooks.json");
    const file = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      hooks: Record<string, unknown>;
    };
    delete file.hooks.Stop;
    fs.writeFileSync(hooksPath, JSON.stringify(file, null, 2) + "\n");
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(
      /FAIL\s+\.codex\/hooks\.json missing Autopilot for:.*Stop/i,
    );
  });

  it("OKs Kimi Autopilot entries and WARNs Stop≤1 + /hooks", () => {
    root = tmpProject();
    const kimiHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-kimi-doc-ok-"));
    const prev = process.env.KIMI_CODE_HOME;
    process.env.KIMI_CODE_HOME = kimiHome;
    try {
      expect(
        installInitYes({
          projectRoot: root,
          platform: "kimi-code",
          surface: "cli",
          locale: "en",
          force: false,
        }).ok,
      ).toBe(true);
      new StateStore(root).close();
      const { ok, lines } = runDoctor(root, { kimiCodeHome: kimiHome });
      expect(ok).toBe(true);
      const joined = lines.join("\n");
      expect(joined).toMatch(/OK\s+Kimi Code config\.toml Autopilot entries/);
      expect(joined).toMatch(/OK\s+skills \(5\)/);
      expect(joined).toMatch(/Stop-continue.*≤1|≤1\/turn/i);
      expect(joined).toMatch(/confirm_rounds:\s*1/);
      expect(joined).toMatch(/\/hooks/i);
      expect(joined).not.toMatch(/missing Autopilot/i);
      expect(joined).not.toMatch(/timeout below 120/i);
      expect(joined).not.toMatch(
        /review\.confirm_rounds is \d+ but Kimi Stop-continue/i,
      );
    } finally {
      if (prev === undefined) delete process.env.KIMI_CODE_HOME;
      else process.env.KIMI_CODE_HOME = prev;
      fs.rmSync(kimiHome, { recursive: true, force: true });
    }
  });

  it("WARNs when Kimi is enabled and confirm_rounds > 1", () => {
    root = tmpProject();
    const kimiHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-kimi-doc-cr-"));
    const prev = process.env.KIMI_CODE_HOME;
    process.env.KIMI_CODE_HOME = kimiHome;
    try {
      expect(
        installInitYes({
          projectRoot: root,
          platform: "kimi-code",
          surface: "cli",
          locale: "en",
          force: false,
        }).ok,
      ).toBe(true);
      new StateStore(root).close();
      const cfgPath = path.join(root, ".autopilot", "config.yml");
      const yaml = fs.readFileSync(cfgPath, "utf8");
      fs.writeFileSync(
        cfgPath,
        yaml.replace(/confirm_rounds:\s*\d+/, "confirm_rounds: 5"),
        "utf8",
      );
      const { ok, lines } = runDoctor(root, { kimiCodeHome: kimiHome });
      expect(ok).toBe(true);
      const joined = lines.join("\n");
      expect(joined).toMatch(/prefer confirm_rounds:\s*1/);
      expect(joined).toMatch(
        /review\.confirm_rounds is 5 but Kimi Stop-continue[\s\S]*runtime clamps to 1/i,
      );
    } finally {
      if (prev === undefined) delete process.env.KIMI_CODE_HOME;
      else process.env.KIMI_CODE_HOME = prev;
      fs.rmSync(kimiHome, { recursive: true, force: true });
    }
  });

  it("WARNs confirm_rounds>1 when YAML boolean true (not Number(true)→1)", () => {
    root = tmpProject();
    const kimiHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-kimi-doc-bool-"));
    const prev = process.env.KIMI_CODE_HOME;
    process.env.KIMI_CODE_HOME = kimiHome;
    try {
      expect(
        installInitYes({
          projectRoot: root,
          platform: "kimi-code",
          surface: "cli",
          locale: "en",
          force: false,
        }).ok,
      ).toBe(true);
      new StateStore(root).close();
      const cfgPath = path.join(root, ".autopilot", "config.yml");
      const yaml = fs.readFileSync(cfgPath, "utf8");
      fs.writeFileSync(
        cfgPath,
        yaml.replace(/confirm_rounds:\s*\d+/, "confirm_rounds: true"),
        "utf8",
      );
      const { lines } = runDoctor(root, { kimiCodeHome: kimiHome });
      expect(lines.join("\n")).toMatch(
        /review\.confirm_rounds is 5 but Kimi Stop-continue/i,
      );
    } finally {
      if (prev === undefined) delete process.env.KIMI_CODE_HOME;
      else process.env.KIMI_CODE_HOME = prev;
      fs.rmSync(kimiHome, { recursive: true, force: true });
    }
  });

  it("WARNs when Kimi Autopilot hooks are missing", () => {
    root = tmpProject();
    const kimiHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-kimi-doc-miss-"));
    const prev = process.env.KIMI_CODE_HOME;
    process.env.KIMI_CODE_HOME = kimiHome;
    try {
      expect(
        installInitYes({
          projectRoot: root,
          platform: "kimi-code",
          surface: "cli",
          locale: "en",
          force: false,
        }).ok,
      ).toBe(true);
      new StateStore(root).close();
      fs.writeFileSync(path.join(kimiHome, "config.toml"), "model = \"x\"\n", "utf8");
      const { ok, lines } = runDoctor(root, { kimiCodeHome: kimiHome });
      expect(ok).toBe(true);
      expect(lines.join("\n")).toMatch(
        /WARN\s+Kimi Code config\.toml missing Autopilot/i,
      );
      expect(lines.join("\n")).not.toMatch(
        /OK\s+Kimi Code config\.toml Autopilot entries/,
      );
    } finally {
      if (prev === undefined) delete process.env.KIMI_CODE_HOME;
      else process.env.KIMI_CODE_HOME = prev;
      fs.rmSync(kimiHome, { recursive: true, force: true });
    }
  });

  it("WARNs when Autopilot Kimi hook timeout is below 120s", () => {
    root = tmpProject();
    const kimiHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-kimi-doc-to-"));
    const prev = process.env.KIMI_CODE_HOME;
    process.env.KIMI_CODE_HOME = kimiHome;
    try {
      expect(
        installInitYes({
          projectRoot: root,
          platform: "kimi-code",
          surface: "cli",
          locale: "en",
          force: false,
        }).ok,
      ).toBe(true);
      new StateStore(root).close();
      const tomlPath = path.join(kimiHome, "config.toml");
      let toml = fs.readFileSync(tomlPath, "utf8");
      toml = toml.replace(/timeout = 120/g, "timeout = 30");
      fs.writeFileSync(tomlPath, toml, "utf8");
      const { ok, lines } = runDoctor(root, { kimiCodeHome: kimiHome });
      expect(ok).toBe(true);
      expect(lines.join("\n")).toMatch(/timeout below 120/i);
      expect(lines.join("\n")).not.toMatch(
        /OK\s+Kimi Code config\.toml Autopilot entries/,
      );
    } finally {
      if (prev === undefined) delete process.env.KIMI_CODE_HOME;
      else process.env.KIMI_CODE_HOME = prev;
      fs.rmSync(kimiHome, { recursive: true, force: true });
    }
  });

  it("WARNs when only legacy ~/.kimi exists without Kimi Code home", () => {
    root = tmpProject();
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-kimi-leg-"));
    const kimiCodeHome = path.join(fakeHome, ".kimi-code-missing-sibling");
    const prev = process.env.KIMI_CODE_HOME;
    process.env.KIMI_CODE_HOME = kimiCodeHome;
    try {
      fs.mkdirSync(path.join(fakeHome, ".kimi"), { recursive: true });
      expect(
        installInitYes({
          projectRoot: root,
          platform: "kimi-code",
          surface: "cli",
          locale: "en",
          force: false,
        }).ok,
      ).toBe(true);
      // Remove Code home so only legacy remains; leave config.yml wanting kimi.
      fs.rmSync(kimiCodeHome, { recursive: true, force: true });
      new StateStore(root).close();
      const { lines } = runDoctor(root, {
        homeDir: fakeHome,
        kimiCodeHome,
      });
      expect(lines.join("\n")).toMatch(/legacy ~\/\.kimi/i);
      expect(lines.join("\n")).toMatch(/Kimi Code home missing/i);
    } finally {
      if (prev === undefined) delete process.env.KIMI_CODE_HOME;
      else process.env.KIMI_CODE_HOME = prev;
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it("FAILs when Kimi Code config.toml is a symlink (unreadable)", () => {
    root = tmpProject();
    const kimiHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-kimi-doc-sym-"));
    const prev = process.env.KIMI_CODE_HOME;
    process.env.KIMI_CODE_HOME = kimiHome;
    try {
      expect(
        installInitYes({
          projectRoot: root,
          platform: "kimi-code",
          surface: "cli",
          locale: "en",
          force: false,
        }).ok,
      ).toBe(true);
      new StateStore(root).close();
      const tomlPath = path.join(kimiHome, "config.toml");
      const outside = path.join(kimiHome, "outside.toml");
      fs.renameSync(tomlPath, outside);
      fs.symlinkSync(outside, tomlPath);
      const { ok, lines } = runDoctor(root, { kimiCodeHome: kimiHome });
      expect(ok).toBe(false);
      const joined = lines.join("\n");
      expect(joined).toMatch(/FAIL\s+Kimi Code config\.toml unreadable/i);
      expect(joined).toMatch(/Stop-continue.*≤1|≤1\/turn/i);
    } finally {
      if (prev === undefined) delete process.env.KIMI_CODE_HOME;
      else process.env.KIMI_CODE_HOME = prev;
      fs.rmSync(kimiHome, { recursive: true, force: true });
    }
  });

  it("does not OK Kimi when Autopilot stamps appear only in comments", () => {
    root = tmpProject();
    const kimiHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-kimi-doc-cmt-"));
    const prev = process.env.KIMI_CODE_HOME;
    process.env.KIMI_CODE_HOME = kimiHome;
    try {
      expect(
        installInitYes({
          projectRoot: root,
          platform: "kimi-code",
          surface: "cli",
          locale: "en",
          force: false,
        }).ok,
      ).toBe(true);
      new StateStore(root).close();
      const tomlPath = path.join(kimiHome, "config.toml");
      const real = fs.readFileSync(tomlPath, "utf8");
      const commented = real
        .split(/\r?\n/)
        .map((line) => (line.trim() ? `# ${line}` : line))
        .join("\n");
      fs.writeFileSync(tomlPath, `model = "x"\n${commented}\n`, "utf8");
      const { ok, lines } = runDoctor(root, { kimiCodeHome: kimiHome });
      expect(ok).toBe(true);
      const joined = lines.join("\n");
      expect(joined).toMatch(/WARN\s+Kimi Code config\.toml missing Autopilot/i);
      expect(joined).not.toMatch(
        /OK\s+Kimi Code config\.toml Autopilot entries/,
      );
    } finally {
      if (prev === undefined) delete process.env.KIMI_CODE_HOME;
      else process.env.KIMI_CODE_HOME = prev;
      fs.rmSync(kimiHome, { recursive: true, force: true });
    }
  });

  it("does not OK Kimi for orphan markers plus comment stamps", () => {
    root = tmpProject();
    const kimiHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-kimi-doc-orp-"));
    const prev = process.env.KIMI_CODE_HOME;
    process.env.KIMI_CODE_HOME = kimiHome;
    try {
      expect(
        installInitYes({
          projectRoot: root,
          platform: "kimi-code",
          surface: "cli",
          locale: "en",
          force: false,
        }).ok,
      ).toBe(true);
      new StateStore(root).close();
      const tomlPath = path.join(kimiHome, "config.toml");
      const real = fs.readFileSync(tomlPath, "utf8");
      const stampComments = real
        .split(/\r?\n/)
        .filter((line) => /autopilot-harness-hook\.mjs/.test(line))
        .map((line) => `# ${line}`)
        .join("\n");
      fs.writeFileSync(
        tomlPath,
        `# --- autopilot-harness hooks begin ---\n${stampComments}\nmodel = "x"\n`,
        "utf8",
      );
      const { lines } = runDoctor(root, { kimiCodeHome: kimiHome });
      const joined = lines.join("\n");
      expect(joined).toMatch(/WARN\s+Kimi Code config\.toml missing Autopilot/i);
      expect(joined).not.toMatch(
        /OK\s+Kimi Code config\.toml Autopilot entries/,
      );
      expect(joined).not.toMatch(/\/hooks if offered/i);
    } finally {
      if (prev === undefined) delete process.env.KIMI_CODE_HOME;
      else process.env.KIMI_CODE_HOME = prev;
      fs.rmSync(kimiHome, { recursive: true, force: true });
    }
  });

  it("WARNs when only some Autopilot Kimi hook events are installed", () => {
    root = tmpProject();
    const kimiHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-kimi-doc-partial-"));
    const prev = process.env.KIMI_CODE_HOME;
    process.env.KIMI_CODE_HOME = kimiHome;
    try {
      expect(
        installInitYes({
          projectRoot: root,
          platform: "kimi-code",
          surface: "cli",
          locale: "en",
          force: false,
        }).ok,
      ).toBe(true);
      new StateStore(root).close();
      const tomlPath = path.join(kimiHome, "config.toml");
      const real = fs.readFileSync(tomlPath, "utf8");
      // Keep only the Stop table; leave other event stamps in comments so
      // whole-file substring checks would wrongly look complete.
      const lines = real.split(/\r?\n/);
      const kept: string[] = [];
      let i = 0;
      while (i < lines.length) {
        if (lines[i]!.trim() !== "[[hooks]]") {
          const line = lines[i]!;
          if (/autopilot-harness-hook\.mjs/.test(line) && !/Stop/.test(line)) {
            kept.push(`# ${line}`);
          } else if (!/autopilot-harness hooks (begin|end)/.test(line)) {
            kept.push(line);
          }
          i += 1;
          continue;
        }
        const block = [lines[i]!];
        i += 1;
        while (i < lines.length) {
          const next = lines[i]!;
          if (/^\s*\[\[/.test(next) || /^\s*\[[^[\]]/.test(next)) break;
          block.push(next);
          i += 1;
        }
        const text = block.join("\n");
        if (/event\s*=\s*"Stop"/.test(text)) kept.push(...block);
        else {
          for (const bl of block) {
            if (/autopilot-harness-hook\.mjs/.test(bl)) kept.push(`# ${bl}`);
          }
        }
      }
      fs.writeFileSync(tomlPath, `${kept.join("\n")}\n`, "utf8");
      const { lines: doc } = runDoctor(root, { kimiCodeHome: kimiHome });
      const joined = doc.join("\n");
      expect(joined).toMatch(
        /WARN\s+Kimi Code config\.toml missing Autopilot for:.*UserPromptSubmit/i,
      );
      expect(joined).toMatch(/PostToolUse/i);
      expect(joined).not.toMatch(
        /OK\s+Kimi Code config\.toml Autopilot entries/,
      );
    } finally {
      if (prev === undefined) delete process.env.KIMI_CODE_HOME;
      else process.env.KIMI_CODE_HOME = prev;
      fs.rmSync(kimiHome, { recursive: true, force: true });
    }
  });

  it("OKs dual-host doctor for Cursor hooks + Claude settings (skills 10)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [
          { id: "cursor", surface: "ide" },
          { id: "claude-code", surface: "cli" },
        ],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(/OK\s+hooks\.json Autopilot entries/);
    expect(joined).toMatch(/OK\s+\.claude\/settings\.json Autopilot entries/);
    expect(joined).toMatch(/OK\s+skills \(10\)/);
  });

  it("Claude-only doctor does not WARN about global Cursor self-review hooks", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "claude-code",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();

    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-home-claude-"));
    try {
      const cursorDir = path.join(fakeHome, ".cursor");
      fs.mkdirSync(cursorDir, { recursive: true });
      fs.writeFileSync(
        path.join(cursorDir, "hooks.json"),
        JSON.stringify({
          version: 1,
          hooks: {
            stop: [
              {
                command: "python3 ./hooks/run-global-self-review.py stop",
              },
            ],
          },
        }),
      );
      const { ok, lines } = runDoctor(root, { homeDir: fakeHome });
      expect(ok).toBe(true);
      expect(lines.join("\n")).not.toMatch(/global self-review/i);
    } finally {
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it("OKs Copilot Autopilot entries and WARNs Stop≤8 + restart", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "copilot-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(
      /OK\s+\.github\/hooks\/autopilot-harness\.json Autopilot entries/,
    );
    expect(joined).toMatch(/OK\s+skills \(5\)/);
    expect(joined).toMatch(/Stop-continue consecutive block cap ≤8/i);
    expect(joined).toMatch(/Restart Copilot CLI/i);
    expect(joined).not.toMatch(
      /FAIL\s+\.github\/hooks\/autopilot-harness\.json missing/i,
    );
  });

  it("FAILs when Copilot hooks file is missing on a Copilot-enabled project", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "copilot-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    fs.rmSync(
      path.join(root, ".github", "hooks", "autopilot-harness.json"),
      { force: true },
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    const joined = lines.join("\n");
    expect(joined).toMatch(
      /\.github\/hooks\/autopilot-harness\.json missing/i,
    );
    // Restart tip only when Autopilot events are present (Codex/Kimi parity).
    expect(joined).not.toMatch(/Restart Copilot CLI/i);
  });

  it("FAILs corrupt Copilot hooks without Restart tip", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "copilot-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    fs.writeFileSync(
      path.join(root, ".github", "hooks", "autopilot-harness.json"),
      "{not-json",
      "utf8",
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    const joined = lines.join("\n");
    expect(joined).toMatch(/autopilot-harness\.json unreadable/i);
    expect(joined).not.toMatch(/Restart Copilot CLI/i);
  });

  it("FAILs invalid Copilot hooks shape without Restart tip", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "copilot-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    fs.writeFileSync(
      path.join(root, ".github", "hooks", "autopilot-harness.json"),
      JSON.stringify({ version: 1, hooks: [] }, null, 2) + "\n",
      "utf8",
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    const joined = lines.join("\n");
    expect(joined).toMatch(/autopilot-harness\.json/i);
    expect(joined).toMatch(/invalid shape|must be an object/i);
    expect(joined).not.toMatch(/Restart Copilot CLI/i);
  });

  it("FAILs incomplete Copilot Autopilot events without Restart tip", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "copilot-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const hooksPath = path.join(
      root,
      ".github",
      "hooks",
      "autopilot-harness.json",
    );
    const file = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      hooks?: Record<string, unknown>;
    };
    expect(file.hooks?.agentStop).toBeTruthy();
    delete file.hooks!.agentStop;
    fs.writeFileSync(hooksPath, JSON.stringify(file, null, 2) + "\n");
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    const joined = lines.join("\n");
    expect(joined).toMatch(/missing Autopilot for:.*agentStop/i);
    expect(joined).not.toMatch(/Restart Copilot CLI/i);
  });

  it("WARNs when Autopilot Copilot hook timeoutSec is below 120", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "copilot-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const hooksPath = path.join(
      root,
      ".github",
      "hooks",
      "autopilot-harness.json",
    );
    const file = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      hooks?: { agentStop?: Array<{ timeoutSec?: number }> };
    };
    const stop = file.hooks?.agentStop?.[0];
    expect(stop).toBeTruthy();
    stop!.timeoutSec = 30;
    fs.writeFileSync(hooksPath, JSON.stringify(file, null, 2) + "\n");
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    expect(lines.join("\n")).toMatch(/timeoutSec below 120/i);
  });

  it("WARNs when Autopilot Copilot hooks omit --platform stamp (no OK)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "copilot-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const hooksPath = path.join(
      root,
      ".github",
      "hooks",
      "autopilot-harness.json",
    );
    const file = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      hooks?: Record<
        string,
        Array<{ bash?: string; powershell?: string; command?: string }>
      >;
    };
    for (const handlers of Object.values(file.hooks ?? {})) {
      for (const h of handlers) {
        for (const field of ["bash", "powershell", "command"] as const) {
          const cmd = h[field];
          if (typeof cmd === "string") {
            h[field] = cmd.replace(/\s+--platform\s+copilot-cli\b/g, "");
          }
        }
      }
    }
    fs.writeFileSync(hooksPath, JSON.stringify(file, null, 2) + "\n");
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(/missing --platform copilot-cli/i);
    expect(joined).toMatch(/Restart Copilot CLI/i);
    expect(joined).not.toMatch(
      /OK\s+\.github\/hooks\/autopilot-harness\.json Autopilot entries/,
    );
  });

  it("WARNs when Claude Code + Copilot CLI are both enabled", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "claude-code",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    expect(
      installInitYes({
        projectRoot: root,
        platform: "copilot-cli",
        surface: "cli",
        locale: "en",
        force: true,
        mergePlatforms: true,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    expect(lines.join("\n")).toMatch(
      /Claude Code \+ Copilot CLI both enabled/i,
    );
  });

  it("WARNs when Claude-only project has leftover Copilot Autopilot hooks", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "claude-code",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    expect(
      installInitYes({
        projectRoot: root,
        platform: "copilot-cli",
        surface: "cli",
        locale: "en",
        force: true,
        mergePlatforms: true,
      }).ok,
    ).toBe(true);
    // Narrow config back to Claude-only while leaving Copilot hooks on disk.
    const cfgPath = path.join(root, ".autopilot", "config.yml");
    const yaml = fs.readFileSync(cfgPath, "utf8");
    fs.writeFileSync(
      cfgPath,
      applyPlatformsToConfigYaml(yaml, [
        { id: "claude-code", surface: "cli" },
      ]),
      "utf8",
    );
    new StateStore(root).close();
    expect(
      fs.existsSync(
        path.join(root, ".github", "hooks", "autopilot-harness.json"),
      ),
    ).toBe(true);
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    expect(lines.join("\n")).toMatch(
      /Copilot Autopilot hooks present while Claude Code is enabled/i,
    );
  });

  it("WARNs when Copilot-only project has leftover Claude Autopilot settings", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "copilot-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    expect(
      installInitYes({
        projectRoot: root,
        platform: "claude-code",
        surface: "cli",
        locale: "en",
        force: true,
        mergePlatforms: true,
      }).ok,
    ).toBe(true);
    const cfgPath = path.join(root, ".autopilot", "config.yml");
    const yaml = fs.readFileSync(cfgPath, "utf8");
    fs.writeFileSync(
      cfgPath,
      applyPlatformsToConfigYaml(yaml, [
        { id: "copilot-cli", surface: "cli" },
      ]),
      "utf8",
    );
    new StateStore(root).close();
    expect(fs.existsSync(path.join(root, ".claude", "settings.json"))).toBe(
      true,
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    expect(lines.join("\n")).toMatch(
      /Claude Autopilot hooks present while Copilot CLI is enabled/i,
    );
  });

  it("WARNs when Cursor-only project has both Claude and Copilot leftover fingerprints", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "claude-code",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    expect(
      installInitYes({
        projectRoot: root,
        platform: "copilot-cli",
        surface: "cli",
        locale: "en",
        force: true,
        mergePlatforms: true,
      }).ok,
    ).toBe(true);
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: true,
        mergePlatforms: true,
      }).ok,
    ).toBe(true);
    const cfgPath = path.join(root, ".autopilot", "config.yml");
    const yaml = fs.readFileSync(cfgPath, "utf8");
    fs.writeFileSync(
      cfgPath,
      applyPlatformsToConfigYaml(yaml, [{ id: "cursor", surface: "ide" }]),
      "utf8",
    );
    new StateStore(root).close();
    expect(fs.existsSync(path.join(root, ".claude", "settings.json"))).toBe(
      true,
    );
    expect(
      fs.existsSync(
        path.join(root, ".github", "hooks", "autopilot-harness.json"),
      ),
    ).toBe(true);
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    expect(lines.join("\n")).toMatch(
      /Claude \+ Copilot Autopilot fingerprints both present on disk/i,
    );
  });

  it("OKs Grok Autopilot entries and WARNs Stop≤8/turn + trust + reload", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "grok-build",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(
      /OK\s+\.grok\/hooks\/autopilot-harness\.json Autopilot entries/,
    );
    expect(joined).toMatch(/OK\s+skills \(5\)/);
    expect(joined).toMatch(/Stop-continue per-turn block cap ≤8/i);
    expect(joined).toMatch(/hooks-trust|--trust/i);
    expect(joined).toMatch(/Reload Grok Build|new session/i);
    expect(joined).not.toMatch(
      /FAIL\s+\.grok\/hooks\/autopilot-harness\.json missing/i,
    );
  });

  it("FAILs when Grok hooks file is missing on a Grok-enabled project", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "grok-build",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    fs.rmSync(path.join(root, ".grok", "hooks", "autopilot-harness.json"), {
      force: true,
    });
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    const joined = lines.join("\n");
    expect(joined).toMatch(/\.grok\/hooks\/autopilot-harness\.json missing/i);
    expect(joined).not.toMatch(/hooks-trust|--trust/i);
    expect(joined).not.toMatch(/Reload Grok Build|new session/i);
  });

  it("FAILs corrupt Grok hooks without trust/reload tips", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "grok-build",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    fs.writeFileSync(
      path.join(root, ".grok", "hooks", "autopilot-harness.json"),
      "{not-json",
      "utf8",
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    const joined = lines.join("\n");
    expect(joined).toMatch(/\.grok\/hooks\/autopilot-harness\.json unreadable/i);
    expect(joined).not.toMatch(/hooks-trust|--trust/i);
    expect(joined).not.toMatch(/Reload Grok Build|new session/i);
    expect(joined).not.toMatch(
      /OK\s+\.grok\/hooks\/autopilot-harness\.json Autopilot entries/,
    );
  });

  it("FAILs incomplete Grok Autopilot events without trust/reload tips", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "grok-build",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const hooksPath = path.join(
      root,
      ".grok",
      "hooks",
      "autopilot-harness.json",
    );
    const file = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      hooks?: Record<string, unknown>;
    };
    expect(file.hooks?.Stop).toBeTruthy();
    delete file.hooks!.Stop;
    fs.writeFileSync(hooksPath, JSON.stringify(file, null, 2) + "\n");
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    const joined = lines.join("\n");
    expect(joined).toMatch(/missing Autopilot for:.*Stop/i);
    expect(joined).not.toMatch(/hooks-trust|--trust/i);
    expect(joined).not.toMatch(/Reload Grok Build|new session/i);
  });

  it("FAILs invalid Grok hooks shape without trust/reload tips", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "grok-build",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    fs.writeFileSync(
      path.join(root, ".grok", "hooks", "autopilot-harness.json"),
      JSON.stringify({ version: 1, hooks: [] }, null, 2) + "\n",
      "utf8",
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    const joined = lines.join("\n");
    expect(joined).toMatch(/\.grok\/hooks\/autopilot-harness\.json/i);
    expect(joined).toMatch(/invalid shape|must be an object/i);
    expect(joined).not.toMatch(/hooks-trust|--trust/i);
    expect(joined).not.toMatch(/Reload Grok Build|new session/i);
  });

  it("WARNs when Autopilot Grok hooks omit timeout (no OK)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "grok-build",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const hooksPath = path.join(
      root,
      ".grok",
      "hooks",
      "autopilot-harness.json",
    );
    const file = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      hooks?: Record<string, Array<{ hooks?: Array<{ timeout?: number }> }>>;
    };
    for (const groups of Object.values(file.hooks ?? {})) {
      for (const g of groups) {
        for (const h of g.hooks ?? []) {
          delete h.timeout;
        }
      }
    }
    fs.writeFileSync(hooksPath, JSON.stringify(file, null, 2) + "\n");
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(/timeout below 120 \(or omitted/i);
    expect(joined).not.toMatch(
      /OK\s+\.grok\/hooks\/autopilot-harness\.json Autopilot entries/,
    );
  });

  it("WARNs when Autopilot Grok hook timeout is set below 120", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "grok-build",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const hooksPath = path.join(
      root,
      ".grok",
      "hooks",
      "autopilot-harness.json",
    );
    const file = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      hooks?: Record<string, Array<{ hooks?: Array<{ timeout?: number }> }>>;
    };
    const stop = file.hooks?.Stop?.[0]?.hooks?.[0];
    expect(stop).toBeTruthy();
    stop!.timeout = 30;
    fs.writeFileSync(hooksPath, JSON.stringify(file, null, 2) + "\n");
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(/timeout below 120/i);
    expect(joined).not.toMatch(
      /OK\s+\.grok\/hooks\/autopilot-harness\.json Autopilot entries/,
    );
  });

  it("WARNs on duplicate Grok Autopilot hooks without FAIL", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "grok-build",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const hooksPath = path.join(
      root,
      ".grok",
      "hooks",
      "autopilot-harness.json",
    );
    const file = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      hooks: Record<string, Array<Record<string, unknown>>>;
    };
    file.hooks.Stop = [
      ...(file.hooks.Stop ?? []),
      {
        hooks: [
          {
            type: "command",
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --event Stop --platform grok-build",
            timeout: 120,
          },
        ],
      },
    ];
    fs.writeFileSync(hooksPath, JSON.stringify(file, null, 2) + "\n");
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(
      /\.grok\/hooks\/autopilot-harness\.json.*duplicate/i,
    );
    expect(joined).not.toMatch(
      /FAIL\s+\.grok\/hooks\/autopilot-harness\.json missing Autopilot/i,
    );
    expect(joined).not.toMatch(
      /OK\s+\.grok\/hooks\/autopilot-harness\.json Autopilot entries/,
    );
  });

  it("WARNs when Autopilot Grok hooks omit --platform stamp (no OK)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "grok-build",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const hooksPath = path.join(
      root,
      ".grok",
      "hooks",
      "autopilot-harness.json",
    );
    const file = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      hooks?: Record<
        string,
        Array<{ hooks?: Array<{ command?: string }> }>
      >;
    };
    for (const groups of Object.values(file.hooks ?? {})) {
      for (const g of groups) {
        for (const h of g.hooks ?? []) {
          if (typeof h.command === "string") {
            h.command = h.command.replace(/\s+--platform\s+grok-build\b/g, "");
          }
        }
      }
    }
    fs.writeFileSync(hooksPath, JSON.stringify(file, null, 2) + "\n");
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(/missing --platform grok-build/i);
    expect(joined).toMatch(/hooks-trust|--trust/i);
    expect(joined).not.toMatch(
      /OK\s+\.grok\/hooks\/autopilot-harness\.json Autopilot entries/,
    );
  });

  it("WARNs when Grok Build + Claude Code are both enabled", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "claude-code",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    expect(
      installInitYes({
        projectRoot: root,
        platform: "grok-build",
        surface: "cli",
        locale: "en",
        force: true,
        mergePlatforms: true,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    expect(lines.join("\n")).toMatch(
      /Grok Build \+ Claude Code both enabled/i,
    );
  });

  it("WARNs when Grok Build + Cursor are both enabled", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    expect(
      installInitYes({
        projectRoot: root,
        platform: "grok-build",
        surface: "cli",
        locale: "en",
        force: true,
        mergePlatforms: true,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    expect(lines.join("\n")).toMatch(/Grok Build \+ Cursor both enabled/i);
  });

  it("WARNs when Claude-only project has leftover Grok Autopilot hooks", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "claude-code",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    expect(
      installInitYes({
        projectRoot: root,
        platform: "grok-build",
        surface: "cli",
        locale: "en",
        force: true,
        mergePlatforms: true,
      }).ok,
    ).toBe(true);
    const cfgPath = path.join(root, ".autopilot", "config.yml");
    const yaml = fs.readFileSync(cfgPath, "utf8");
    fs.writeFileSync(
      cfgPath,
      applyPlatformsToConfigYaml(yaml, [
        { id: "claude-code", surface: "cli" },
      ]),
      "utf8",
    );
    new StateStore(root).close();
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    expect(lines.join("\n")).toMatch(
      /Grok Autopilot hooks present while Claude Code is enabled/i,
    );
  });

  it("WARNs when Cursor-only project has leftover Grok Autopilot hooks", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    expect(
      installInitYes({
        projectRoot: root,
        platform: "grok-build",
        surface: "cli",
        locale: "en",
        force: true,
        mergePlatforms: true,
      }).ok,
    ).toBe(true);
    const cfgPath = path.join(root, ".autopilot", "config.yml");
    const yaml = fs.readFileSync(cfgPath, "utf8");
    fs.writeFileSync(
      cfgPath,
      applyPlatformsToConfigYaml(yaml, [{ id: "cursor", surface: "ide" }]),
      "utf8",
    );
    new StateStore(root).close();
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    expect(lines.join("\n")).toMatch(
      /Grok Autopilot hooks present while Cursor is enabled/i,
    );
  });

  it("WARNs when Grok-only project has leftover Claude Autopilot settings", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "grok-build",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    expect(
      installInitYes({
        projectRoot: root,
        platform: "claude-code",
        surface: "cli",
        locale: "en",
        force: true,
        mergePlatforms: true,
      }).ok,
    ).toBe(true);
    const cfgPath = path.join(root, ".autopilot", "config.yml");
    const yaml = fs.readFileSync(cfgPath, "utf8");
    fs.writeFileSync(
      cfgPath,
      applyPlatformsToConfigYaml(yaml, [
        { id: "grok-build", surface: "cli" },
      ]),
      "utf8",
    );
    new StateStore(root).close();
    expect(fs.existsSync(path.join(root, ".claude", "settings.json"))).toBe(
      true,
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    expect(lines.join("\n")).toMatch(
      /Claude Autopilot hooks present while Grok Build is enabled/i,
    );
  });

  it("WARNs when Grok-only project has leftover Cursor Autopilot hooks", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "grok-build",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: true,
        mergePlatforms: true,
      }).ok,
    ).toBe(true);
    const cfgPath = path.join(root, ".autopilot", "config.yml");
    const yaml = fs.readFileSync(cfgPath, "utf8");
    fs.writeFileSync(
      cfgPath,
      applyPlatformsToConfigYaml(yaml, [
        { id: "grok-build", surface: "cli" },
      ]),
      "utf8",
    );
    new StateStore(root).close();
    expect(fs.existsSync(path.join(root, ".cursor", "hooks.json"))).toBe(true);
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    expect(lines.join("\n")).toMatch(
      /Cursor Autopilot hooks present while Grok Build is enabled/i,
    );
  });

  it("FAILs when Grok hooks file is a dangling symlink (not treated as missing)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "grok-build",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const hooksPath = path.join(
      root,
      ".grok",
      "hooks",
      "autopilot-harness.json",
    );
    fs.rmSync(hooksPath, { force: true });
    fs.symlinkSync(path.join(root, "missing-grok-hooks.json"), hooksPath);
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    const joined = lines.join("\n");
    expect(joined).toMatch(
      /\.grok\/hooks\/autopilot-harness\.json unreadable|symlink/i,
    );
    expect(joined).not.toMatch(
      /FAIL\s+\.grok\/hooks\/autopilot-harness\.json missing/i,
    );
    expect(joined).not.toMatch(/hooks-trust|--trust/i);
  });

  it("WARNs when Cursor-only project has both Grok and Claude leftover fingerprints", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "claude-code",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    expect(
      installInitYes({
        projectRoot: root,
        platform: "grok-build",
        surface: "cli",
        locale: "en",
        force: true,
        mergePlatforms: true,
      }).ok,
    ).toBe(true);
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: true,
        mergePlatforms: true,
      }).ok,
    ).toBe(true);
    const cfgPath = path.join(root, ".autopilot", "config.yml");
    const yaml = fs.readFileSync(cfgPath, "utf8");
    fs.writeFileSync(
      cfgPath,
      applyPlatformsToConfigYaml(yaml, [{ id: "cursor", surface: "ide" }]),
      "utf8",
    );
    new StateStore(root).close();
    expect(fs.existsSync(path.join(root, ".claude", "settings.json"))).toBe(
      true,
    );
    expect(
      fs.existsSync(
        path.join(root, ".grok", "hooks", "autopilot-harness.json"),
      ),
    ).toBe(true);
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(
      /Grok \+ Claude Autopilot fingerprints both present on disk/i,
    );
    expect(joined).toMatch(
      /Grok Autopilot hooks present while Cursor is enabled/i,
    );
  });

  it("OKs Gemini Autopilot entries and WARNs cap + min-CLI + trust + reload", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "gemini-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(
      /OK\s+\.gemini\/settings\.json Autopilot entries/,
    );
    expect(joined).toMatch(/AfterAgent turn cap ≤100/i);
    expect(joined).toMatch(/Prefer Gemini CLI ≥0\.31\.0/i);
    expect(joined).toMatch(/re-trust|\/trust|\/hooks panel|folder trust/i);
    expect(joined).toMatch(/hooks reload|\/skills reload|reload session/i);
    expect(joined).not.toMatch(/FAIL\s+\.gemini\/settings\.json missing/i);
  });

  it("FAILs when Gemini settings.json is missing on a Gemini-enabled project", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "gemini-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    fs.rmSync(path.join(root, ".gemini", "settings.json"), { force: true });
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    const joined = lines.join("\n");
    expect(joined).toMatch(/\.gemini\/settings\.json missing/i);
    expect(joined).not.toMatch(/re-trust|\/trust|\/hooks panel|folder trust/i);
    expect(joined).not.toMatch(/hooks reload|\/skills reload|reload session/i);
  });

  it("FAILs flat (non-nested) Gemini hooks without trust/reload tips", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "gemini-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    fs.writeFileSync(
      path.join(root, ".gemini", "settings.json"),
      JSON.stringify({
        hooks: {
          BeforeAgent: [{ type: "command", command: "echo flat" }],
        },
      }) + "\n",
      "utf8",
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    const joined = lines.join("\n");
    expect(joined).toMatch(/FAIL\s+\.gemini\/settings\.json/i);
    expect(joined).toMatch(/nested matcher groups|invalid shape/i);
    expect(joined).not.toMatch(/re-trust|\/trust|\/hooks panel|folder trust/i);
    expect(joined).not.toMatch(/hooks reload|\/skills reload/i);
  });

  it("FAILs incomplete Gemini Autopilot events without trust/reload tips", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "gemini-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const settingsPath = path.join(root, ".gemini", "settings.json");
    const file = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
      hooks?: Record<string, unknown>;
    };
    delete file.hooks!.AfterAgent;
    fs.writeFileSync(settingsPath, JSON.stringify(file, null, 2) + "\n");
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    const joined = lines.join("\n");
    expect(joined).toMatch(/missing Autopilot for:.*AfterAgent/i);
    expect(joined).not.toMatch(/re-trust|\/trust|\/hooks panel|folder trust/i);
    expect(joined).not.toMatch(/hooks reload|\/skills reload/i);
  });

  it("WARNs when Autopilot Gemini hook timeout is omitted or below 120000", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "gemini-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const settingsPath = path.join(root, ".gemini", "settings.json");
    const file = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
      hooks?: Record<
        string,
        Array<{ hooks?: Array<{ timeout?: number; command?: string }> }>
      >;
    };
    for (const groups of Object.values(file.hooks ?? {})) {
      for (const g of groups) {
        for (const h of g.hooks ?? []) {
          if (
            typeof h.command === "string" &&
            h.command.includes("autopilot-harness-hook")
          ) {
            delete h.timeout;
          }
        }
      }
    }
    fs.writeFileSync(settingsPath, JSON.stringify(file, null, 2) + "\n");
    const omit = runDoctor(root);
    expect(omit.ok).toBe(true);
    expect(omit.lines.join("\n")).toMatch(/timeout below 120000/i);
    expect(omit.lines.join("\n")).not.toMatch(
      /OK\s+\.gemini\/settings\.json Autopilot entries/,
    );

    for (const groups of Object.values(file.hooks ?? {})) {
      for (const g of groups) {
        for (const h of g.hooks ?? []) {
          if (
            typeof h.command === "string" &&
            h.command.includes("autopilot-harness-hook")
          ) {
            h.timeout = 1000;
          }
        }
      }
    }
    fs.writeFileSync(settingsPath, JSON.stringify(file, null, 2) + "\n");
    const small = runDoctor(root);
    expect(small.ok).toBe(true);
    expect(small.lines.join("\n")).toMatch(/timeout below 120000/i);
  });

  it("WARNs when hooksConfig.enabled===false or Autopilot names are disabled", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "gemini-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const settingsPath = path.join(root, ".gemini", "settings.json");
    const file = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
      hooksConfig?: unknown;
    };
    file.hooksConfig = {
      enabled: false,
      disabled: ["autopilot-harness-AfterAgent", "other"],
    };
    fs.writeFileSync(settingsPath, JSON.stringify(file, null, 2) + "\n");
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(/hooksConfig\.enabled===false/i);
    expect(joined).toMatch(
      /disabled lists Autopilot name\(s\):.*autopilot-harness-AfterAgent/i,
    );
    expect(joined).not.toMatch(
      /OK\s+\.gemini\/settings\.json Autopilot entries/,
    );
  });

  it("WARNs when only hooksConfig.disabled lists Autopilot names (no OK)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "gemini-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const settingsPath = path.join(root, ".gemini", "settings.json");
    const file = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
      hooksConfig?: unknown;
    };
    file.hooksConfig = {
      enabled: true,
      disabled: ["autopilot-harness-AfterAgent"],
    };
    fs.writeFileSync(settingsPath, JSON.stringify(file, null, 2) + "\n");
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).not.toMatch(/hooksConfig\.enabled===false/i);
    expect(joined).toMatch(
      /disabled lists Autopilot name\(s\):.*autopilot-harness-AfterAgent/i,
    );
    expect(joined).not.toMatch(
      /OK\s+\.gemini\/settings\.json Autopilot entries/,
    );
  });

  it("WARNs when legacy hooks.disabled lists Autopilot names (no OK)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "gemini-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const settingsPath = path.join(root, ".gemini", "settings.json");
    const file = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
      hooks?: Record<string, unknown>;
    };
    file.hooks = {
      ...(file.hooks ?? {}),
      disabled: ["autopilot-harness-BeforeAgent", "other"],
    };
    fs.writeFileSync(settingsPath, JSON.stringify(file, null, 2) + "\n");
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(
      /disabled lists Autopilot name\(s\):.*autopilot-harness-BeforeAgent/i,
    );
    expect(joined).toMatch(/hooksConfig\.disabled or legacy hooks\.disabled/i);
    expect(joined).not.toMatch(
      /OK\s+\.gemini\/settings\.json Autopilot entries/,
    );
  });

  it("WARNs when Autopilot Gemini hooks omit --platform stamp (no OK)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "gemini-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const settingsPath = path.join(root, ".gemini", "settings.json");
    const file = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
      hooks?: Record<
        string,
        Array<{ hooks?: Array<{ command?: string }> }>
      >;
    };
    for (const groups of Object.values(file.hooks ?? {})) {
      for (const g of groups) {
        for (const h of g.hooks ?? []) {
          if (
            typeof h.command === "string" &&
            h.command.includes("autopilot-harness-hook")
          ) {
            h.command = h.command.replace(
              /\s+--platform\s+gemini-cli\b/g,
              "",
            );
          }
        }
      }
    }
    fs.writeFileSync(settingsPath, JSON.stringify(file, null, 2) + "\n");
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(/missing --platform gemini-cli/i);
    expect(joined).not.toMatch(
      /OK\s+\.gemini\/settings\.json Autopilot entries/,
    );
  });

  it("FAILs when Gemini settings.json is a dangling symlink (not treated as missing)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "gemini-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const settingsPath = path.join(root, ".gemini", "settings.json");
    fs.rmSync(settingsPath, { force: true });
    fs.symlinkSync(path.join(root, "missing-gemini-settings.json"), settingsPath);
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    const joined = lines.join("\n");
    expect(joined).toMatch(
      /\.gemini\/settings\.json unreadable|symlink/i,
    );
    expect(joined).not.toMatch(/FAIL\s+\.gemini\/settings\.json missing/i);
    expect(joined).not.toMatch(/re-trust|\/hooks panel|folder trust/i);
  });

  it("WARNs when Gemini CLI + Claude Code are both enabled", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [
          { id: "gemini-cli", surface: "cli" },
          { id: "claude-code", surface: "cli" },
        ],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    expect(lines.join("\n")).toMatch(
      /Gemini CLI \+ Claude Code both enabled/i,
    );
  });

  it("WARNs when Claude-only project has leftover Gemini Autopilot settings", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "claude-code",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "gemini-cli",
        surface: "cli",
        locale: "en",
        force: true,
        mergePlatforms: true,
      }).ok,
    ).toBe(true);
    // Drop gemini-cli from config but leave settings on disk.
    const configPath = path.join(root, ".autopilot", "config.yml");
    const yaml = fs.readFileSync(configPath, "utf8");
    const next = applyPlatformsToConfigYaml(yaml, [
      { id: "claude-code", surface: "cli" },
    ]);
    fs.writeFileSync(configPath, next);
    expect(fs.existsSync(path.join(root, ".gemini", "settings.json"))).toBe(
      true,
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    expect(lines.join("\n")).toMatch(
      /Gemini Autopilot hooks present while Claude Code is enabled/i,
    );
  });

  it("WARNs when Gemini-only project has leftover Claude Autopilot settings", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "gemini-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    expect(
      installInitYes({
        projectRoot: root,
        platform: "claude-code",
        surface: "cli",
        locale: "en",
        force: true,
        mergePlatforms: true,
      }).ok,
    ).toBe(true);
    const cfgPath = path.join(root, ".autopilot", "config.yml");
    const yaml = fs.readFileSync(cfgPath, "utf8");
    fs.writeFileSync(
      cfgPath,
      applyPlatformsToConfigYaml(yaml, [
        { id: "gemini-cli", surface: "cli" },
      ]),
      "utf8",
    );
    new StateStore(root).close();
    expect(fs.existsSync(path.join(root, ".claude", "settings.json"))).toBe(
      true,
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    expect(lines.join("\n")).toMatch(
      /Claude Autopilot hooks present while Gemini CLI is enabled/i,
    );
  });

  it("does not WARN/withhold OK for unrelated autopilot-harness-* in hooksConfig.disabled", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "gemini-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const settingsPath = path.join(root, ".gemini", "settings.json");
    const file = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
      hooksConfig?: unknown;
    };
    file.hooksConfig = {
      enabled: true,
      disabled: ["autopilot-harness-custom", "other"],
    };
    fs.writeFileSync(settingsPath, JSON.stringify(file, null, 2) + "\n");
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).not.toMatch(/hooksConfig\.disabled lists Autopilot name/i);
    expect(joined).not.toMatch(/disabled lists Autopilot name\(s\)/i);
    expect(joined).toMatch(/OK\s+\.gemini\/settings\.json Autopilot entries/);
  });

  it("Factory-only doctor: OK hooks + WARNs for cap, /hooks, reload", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "factory-droid",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(/OK\s+\.factory\/hooks\.json Autopilot entries/);
    expect(joined).toMatch(/no documented raise\/hard-cap/i);
    expect(joined).toMatch(/multi-block under stop_hook_active live-proved/i);
    expect(joined).not.toMatch(
      /Factory Droid multi-block under stop_hook_active is unproven/i,
    );
    expect(joined).toMatch(/\/hooks/);
    expect(joined).toMatch(/snapshot|new session|Reload Factory/i);
    expect(joined).not.toMatch(/FAIL\s+\.factory\/hooks\.json missing/i);
  });

  it("FAILs when Factory hooks.json is missing", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "factory-droid",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    fs.rmSync(path.join(root, ".factory", "hooks.json"), { force: true });
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/\.factory\/hooks\.json missing/i);
  });

  it("WARNs Factory timeout below 120 and withholds OK", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "factory-droid",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const hooksPath = path.join(root, ".factory", "hooks.json");
    const file = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      Stop?: Array<{ hooks?: Array<{ timeout?: number }> }>;
    };
    for (const g of file.Stop ?? []) {
      for (const h of g.hooks ?? []) {
        h.timeout = 30;
      }
    }
    fs.writeFileSync(hooksPath, JSON.stringify(file, null, 2) + "\n");
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(/timeout below 120/i);
    expect(joined).not.toMatch(/OK\s+\.factory\/hooks\.json Autopilot entries/);
  });

  it("WARNs Factory missing --platform stamp and withholds OK", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "factory-droid",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const hooksPath = path.join(root, ".factory", "hooks.json");
    const file = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      [k: string]: Array<{ hooks?: Array<{ command?: string }> }> | unknown;
    };
    for (const event of ["UserPromptSubmit", "PostToolUse", "Stop"]) {
      const groups = file[event];
      if (!Array.isArray(groups)) continue;
      for (const g of groups) {
        for (const h of g.hooks ?? []) {
          if (typeof h.command === "string") {
            h.command = h.command.replace(/\s+--platform\s+factory-droid\b/g, "");
          }
        }
      }
    }
    fs.writeFileSync(hooksPath, JSON.stringify(file, null, 2) + "\n");
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(/missing --platform factory-droid/i);
    expect(joined).not.toMatch(/OK\s+\.factory\/hooks\.json Autopilot entries/);
  });

  it("WARNs Factory missing $FACTORY_PROJECT_DIR and withholds OK", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "factory-droid",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const hooksPath = path.join(root, ".factory", "hooks.json");
    const file = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      [k: string]: Array<{ hooks?: Array<{ command?: string }> }> | unknown;
    };
    for (const event of ["UserPromptSubmit", "PostToolUse", "Stop"]) {
      const groups = file[event];
      if (!Array.isArray(groups)) continue;
      for (const g of groups) {
        for (const h of g.hooks ?? []) {
          if (typeof h.command === "string") {
            h.command = h.command.replaceAll(
              '"$FACTORY_PROJECT_DIR"',
              '"."',
            );
          }
        }
      }
    }
    fs.writeFileSync(hooksPath, JSON.stringify(file, null, 2) + "\n");
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(/missing \$FACTORY_PROJECT_DIR/i);
    expect(joined).not.toMatch(/OK\s+\.factory\/hooks\.json Autopilot entries/);
  });

  it("WARNs Factory hooksDisabled and settings.json Autopilot residual", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "factory-droid",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const settingsPath = path.join(root, ".factory", "settings.json");
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          hooksDisabled: true,
          allowManagedHooksOnly: true,
          hooks: {
            Stop: [
              {
                hooks: [
                  {
                    type: "command",
                    command:
                      "node .autopilot/bin/autopilot-harness-hook.mjs --platform factory-droid --event Stop",
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(/hooksDisabled===true/i);
    expect(joined).toMatch(/allowManagedHooksOnly===true/i);
    expect(joined).toMatch(
      /\.factory\/settings\.json hooks still list Autopilot/i,
    );
    expect(joined).not.toMatch(/OK\s+\.factory\/hooks\.json Autopilot entries/);
  });

  it("WARNs legacy .factory/hooks/hooks.json Autopilot fingerprint", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "factory-droid",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const legacyDir = path.join(root, ".factory", "hooks");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacyDir, "hooks.json"),
      JSON.stringify(
        {
          Stop: [
            {
              hooks: [
                {
                  type: "command",
                  command:
                    "node .autopilot/bin/autopilot-harness-hook.mjs --event Stop",
                },
              ],
            },
          ],
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    expect(lines.join("\n")).toMatch(
      /legacy \.factory\/hooks\/hooks\.json still has Autopilot/i,
    );
  });

  it("WARNs ~/.factory residual Autopilot hooks when Factory enabled", () => {
    root = tmpProject();
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-factory-home-"));
    try {
      expect(
        installInitYes({
          projectRoot: root,
          platform: "factory-droid",
          surface: "cli",
          locale: "en",
          force: false,
        }).ok,
      ).toBe(true);
      new StateStore(root).close();
      const homeFactory = path.join(fakeHome, ".factory");
      fs.mkdirSync(homeFactory, { recursive: true });
      fs.writeFileSync(
        path.join(homeFactory, "hooks.json"),
        JSON.stringify(
          {
            Stop: [
              {
                hooks: [
                  {
                    type: "command",
                    command:
                      "node .autopilot/bin/autopilot-harness-hook.mjs --platform factory-droid --event Stop",
                  },
                ],
              },
            ],
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      const { ok, lines } = runDoctor(root, { homeDir: fakeHome });
      expect(ok).toBe(true);
      expect(lines.join("\n")).toMatch(/~\/\.factory\/hooks\.json has Autopilot/i);
    } finally {
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it("withholds Factory OK when ~/.factory/settings.json hooksDisabled===true", () => {
    root = tmpProject();
    const fakeHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "ap-factory-home-dis-"),
    );
    try {
      expect(
        installInitYes({
          projectRoot: root,
          platform: "factory-droid",
          surface: "cli",
          locale: "en",
          force: false,
        }).ok,
      ).toBe(true);
      new StateStore(root).close();
      const homeFactory = path.join(fakeHome, ".factory");
      fs.mkdirSync(homeFactory, { recursive: true });
      fs.writeFileSync(
        path.join(homeFactory, "settings.json"),
        JSON.stringify({ hooksDisabled: true }, null, 2) + "\n",
        "utf8",
      );
      const { ok, lines } = runDoctor(root, { homeDir: fakeHome });
      expect(ok).toBe(true);
      const joined = lines.join("\n");
      expect(joined).toMatch(/~\/\.factory\/settings\.json hooksDisabled===true/i);
      expect(joined).not.toMatch(/OK\s+\.factory\/hooks\.json Autopilot entries/);
    } finally {
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it("WARNs Factory Droid + Claude Code both enabled", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [
          { id: "factory-droid", surface: "cli" },
          { id: "claude-code", surface: "cli" },
        ],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    expect(lines.join("\n")).toMatch(
      /Factory Droid \+ Claude Code both enabled/i,
    );
  });

  it("WARNs when Claude-only project has leftover Factory Autopilot hooks", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "claude-code",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "factory-droid",
        surface: "cli",
        locale: "en",
        force: true,
        mergePlatforms: true,
      }).ok,
    ).toBe(true);
    const cfgPath = path.join(root, ".autopilot", "config.yml");
    const yaml = fs.readFileSync(cfgPath, "utf8");
    fs.writeFileSync(
      cfgPath,
      applyPlatformsToConfigYaml(yaml, [
        { id: "claude-code", surface: "cli" },
      ]),
      "utf8",
    );
    expect(fs.existsSync(path.join(root, ".factory", "hooks.json"))).toBe(true);
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    expect(lines.join("\n")).toMatch(
      /Factory Autopilot hooks present while Claude Code is enabled/i,
    );
  });

  it("WARNs leftover Factory settings.json Autopilot when Claude-only (no hooks.json)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "claude-code",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const factoryDir = path.join(root, ".factory");
    fs.mkdirSync(factoryDir, { recursive: true });
    fs.writeFileSync(
      path.join(factoryDir, "settings.json"),
      JSON.stringify(
        {
          hooks: {
            Stop: [
              {
                hooks: [
                  {
                    type: "command",
                    command:
                      "node .autopilot/bin/autopilot-harness-hook.mjs --platform factory-droid --event Stop",
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    expect(lines.join("\n")).toMatch(
      /Factory Autopilot hooks present while Claude Code is enabled/i,
    );
  });

  it("ignores relative homeDir for ~/.factory residual (no cwd leak)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "factory-droid",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const { ok, lines } = runDoctor(root, { homeDir: "relative-home" });
    expect(ok).toBe(true);
    expect(lines.join("\n")).not.toMatch(/~\/\.factory/);
  });

  it("does not false-WARN ~/.factory when homeDir === projectRoot", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "factory-droid",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    fs.writeFileSync(
      path.join(root, ".factory", "settings.json"),
      JSON.stringify({ hooksDisabled: true }, null, 2) + "\n",
      "utf8",
    );
    const { ok, lines } = runDoctor(root, { homeDir: root });
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    // Project path WARN only — not duplicated as ~/.factory for the same file.
    expect(joined).toMatch(/\.factory\/settings\.json hooksDisabled===true/i);
    expect(joined).not.toMatch(/~\/\.factory/);
    expect(joined).not.toMatch(/double-load with project hooks/i);
  });

  it("does not false-WARN ~/.factory when homeDir is a symlink to projectRoot", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "factory-droid",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const linkHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-factory-link-"));
    fs.rmSync(linkHome, { recursive: true, force: true });
    try {
      fs.symlinkSync(root, linkHome, "dir");
    } catch {
      // Some environments cannot create dir symlinks — skip without failing CI.
      return;
    }
    try {
      const { ok, lines } = runDoctor(root, { homeDir: linkHome });
      expect(ok).toBe(true);
      expect(lines.join("\n")).not.toMatch(/double-load with project hooks/i);
    } finally {
      // Unlink the symlink only — never recursive-rm a path that may point at root.
      try {
        if (fs.lstatSync(linkHome).isSymbolicLink()) {
          fs.unlinkSync(linkHome);
        }
      } catch {
        /* already gone */
      }
    }
  });
});

describe("status/doctor plans_dir aligns with core normalizeInProjectPlansDir", () => {
  let root: string;
  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts the same relative dirs as the hook normalizer", () => {
    root = tmpProject();
    for (const dir of ["plans", "work/plans", "docs/plans"]) {
      expect(normalizeInProjectPlansDir(root, dir)).toBe(dir);
      expect(normalizePlansDir(dir)).toEqual({ ok: true, value: dir });
    }
  });

  it("rejects the same escapes as the hook normalizer", () => {
    root = tmpProject();
    for (const dir of ["../escape", "/abs", "plans/../etc", "a\\b", "plans\nfoo"]) {
      expect(normalizeInProjectPlansDir(root, dir)).toBeNull();
      expect(normalizePlansDir(dir).ok).toBe(false);
    }
  });

  it("status/doctor report custom plans_dir that core accepts", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
        plansDir: "work/plans",
      }).ok,
    ).toBe(true);
    expect(normalizeInProjectPlansDir(root, "work/plans")).toBe("work/plans");
    expect(formatStatus(root)).toMatch(/plans:\s*work\/plans/);
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    expect(lines.join("\n")).toMatch(/OK\s+plans \(work\/plans\/\)/);
  });

  it("OKs Antigravity Autopilot entries and WARNs cap + IDE + CLI workspace + auto-attach + reload", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "antigravity",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(/OK\s+\.agents\/hooks\.json Autopilot entries/);
    expect(joined).toMatch(/Antigravity Stop-continue: no documented raise/i);
    expect(joined).toMatch(/IDE tip|hooks may stay silent/i);
    expect(joined).toMatch(
      /CLI tip:.*--add-dir|mount the instrumented project as a workspace/i,
    );
    expect(joined).toMatch(/Auto-attach.*Autopilot ON/i);
    expect(joined).toMatch(/Reload Antigravity|new session/i);
    expect(joined).toMatch(/OK\s+skills \(5\)/);
    expect(joined).not.toMatch(/FAIL\s+\.agents\/hooks\.json missing/i);
  });

  it("FAILs when Antigravity hooks.json is missing", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "antigravity",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    fs.rmSync(path.join(root, ".agents", "hooks.json"), { force: true });
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    const joined = lines.join("\n");
    expect(joined).toMatch(/FAIL\s+\.agents\/hooks\.json missing/i);
    expect(joined).not.toMatch(/Reload Antigravity|new session/i);
  });

  it("FAILs when Antigravity Autopilot events are incomplete", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "antigravity",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const hooksPath = path.join(root, ".agents", "hooks.json");
    const file = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      "autopilot-harness"?: Record<string, unknown>;
    };
    delete file["autopilot-harness"]!.Stop;
    fs.writeFileSync(hooksPath, JSON.stringify(file, null, 2) + "\n");
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    const joined = lines.join("\n");
    expect(joined).toMatch(/missing Autopilot for:.*Stop/i);
    expect(joined).not.toMatch(/OK\s+\.agents\/hooks\.json Autopilot entries/);
  });

  it("FAILs when Antigravity PostToolUse matcher is wrong (残指纹)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "antigravity",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const hooksPath = path.join(root, ".agents", "hooks.json");
    const file = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      "autopilot-harness"?: {
        PostToolUse?: Array<{ matcher?: string }>;
      };
    };
    file["autopilot-harness"]!.PostToolUse![0]!.matcher = "run_command";
    fs.writeFileSync(hooksPath, JSON.stringify(file, null, 2) + "\n");
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    const joined = lines.join("\n");
    expect(joined).toMatch(
      /FAIL\s+\.agents\/hooks\.json Autopilot fingerprint incomplete \(stamp\/matcher\)/i,
    );
    expect(joined).not.toMatch(/OK\s+\.agents\/hooks\.json Autopilot entries/);
    expect(joined).not.toMatch(/Reload Antigravity|new session/i);
  });

  it("FAILs when Antigravity hooks omit --platform stamp (残指纹)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "antigravity",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const hooksPath = path.join(root, ".agents", "hooks.json");
    const raw = fs.readFileSync(hooksPath, "utf8");
    fs.writeFileSync(
      hooksPath,
      raw.replaceAll(" --platform antigravity", ""),
      "utf8",
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    const joined = lines.join("\n");
    expect(joined).toMatch(
      /FAIL\s+\.agents\/hooks\.json Autopilot fingerprint incomplete \(stamp\/matcher\)/i,
    );
    expect(joined).not.toMatch(/OK\s+\.agents\/hooks\.json Autopilot entries/);
    expect(joined).not.toMatch(/Reload Antigravity|new session/i);
  });

  it("WARNs when Antigravity Autopilot block enabled===false (withholds OK + reload)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "antigravity",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const hooksPath = path.join(root, ".agents", "hooks.json");
    const file = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      "autopilot-harness"?: { enabled?: boolean };
    };
    file["autopilot-harness"]!.enabled = false;
    fs.writeFileSync(hooksPath, JSON.stringify(file, null, 2) + "\n");
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(
      /WARN\s+\.agents\/hooks\.json Autopilot block enabled===false/i,
    );
    expect(joined).not.toMatch(/OK\s+\.agents\/hooks\.json Autopilot entries/);
    expect(joined).not.toMatch(/Reload Antigravity|new session/i);
  });

  it("WARNs when Antigravity hooks omit relative .agents/bin shim (and legacy)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "antigravity",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const hooksPath = path.join(root, ".agents", "hooks.json");
    const raw = fs.readFileSync(hooksPath, "utf8");
    fs.writeFileSync(
      hooksPath,
      raw.replaceAll(
        "node .agents/bin/autopilot-harness-hook.mjs",
        "node /abs/.autopilot/bin/autopilot-harness-hook.mjs",
      ),
      "utf8",
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(
      /WARN\s+Autopilot Antigravity hooks missing \.agents\/bin shim \(or legacy \.autopilot\/bin\)/i,
    );
    expect(joined).not.toMatch(/OK\s+\.agents\/hooks\.json Autopilot entries/);
    expect(joined).not.toMatch(
      /WARN\s+Reload Antigravity or open a new session after install or upgrade so Autopilot hooks reload/,
    );
  });

  it("WARNs when Antigravity hooks.json points at shim but shim file is missing", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "antigravity",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    fs.unlinkSync(
      path.join(root, ".agents", "bin", "autopilot-harness-hook.mjs"),
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(
      /WARN\s+\.agents\/bin\/autopilot-harness-hook\.mjs missing/i,
    );
    expect(joined).not.toMatch(/OK\s+\.agents\/hooks\.json Autopilot entries/);
    expect(joined).not.toMatch(/Reload Antigravity|new session/i);
  });

  it("WARNs Antigravity timeout below 120 and withholds OK", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "antigravity",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const hooksPath = path.join(root, ".agents", "hooks.json");
    const file = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      "autopilot-harness"?: Record<
        string,
        Array<{ timeout?: number; hooks?: Array<{ timeout?: number }> }>
      >;
    };
    const block = file["autopilot-harness"]!;
    for (const entries of Object.values(block)) {
      if (!Array.isArray(entries)) continue;
      for (const g of entries) {
        // Flat PreInvocation/Stop handlers carry timeout on the entry itself.
        if (typeof g.timeout === "number") g.timeout = 30;
        for (const h of g.hooks ?? []) {
          h.timeout = 30;
        }
      }
    }
    fs.writeFileSync(hooksPath, JSON.stringify(file, null, 2) + "\n");
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(
      /WARN\s+Autopilot Antigravity hook timeout below 120/i,
    );
    expect(joined).not.toMatch(/OK\s+\.agents\/hooks\.json Autopilot entries/);
  });

  it("FAILs when Antigravity hooks.json is a dangling symlink (not treated as missing)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "antigravity",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const hooksPath = path.join(root, ".agents", "hooks.json");
    fs.rmSync(hooksPath, { force: true });
    fs.symlinkSync(path.join(root, "missing-agents-hooks.json"), hooksPath);
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    const joined = lines.join("\n");
    expect(joined).toMatch(/\.agents\/hooks\.json unreadable|symlink/i);
    expect(joined).not.toMatch(/FAIL\s+\.agents\/hooks\.json missing/i);
  });

  it("WARNs Antigravity + Claude dual fingerprints when both enabled", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "antigravity",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    expect(
      installInitYes({
        projectRoot: root,
        platform: "claude-code",
        surface: "cli",
        locale: "en",
        force: true,
        mergePlatforms: true,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    expect(lines.join("\n")).toMatch(
      /Antigravity \+ Claude Code both enabled/i,
    );
  });

  it("WARNs when Claude-only project has leftover Antigravity Autopilot hooks", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "claude-code",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    expect(
      installInitYes({
        projectRoot: root,
        platform: "antigravity",
        surface: "cli",
        locale: "en",
        force: true,
        mergePlatforms: true,
      }).ok,
    ).toBe(true);
    const cfgPath = path.join(root, ".autopilot", "config.yml");
    const yaml = fs.readFileSync(cfgPath, "utf8");
    fs.writeFileSync(
      cfgPath,
      applyPlatformsToConfigYaml(yaml, [
        { id: "claude-code", surface: "cli" },
      ]),
      "utf8",
    );
    new StateStore(root).close();
    expect(fs.existsSync(path.join(root, ".agents", "hooks.json"))).toBe(true);
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    expect(lines.join("\n")).toMatch(
      /Antigravity Autopilot hooks present while Claude Code is enabled/i,
    );
  });

  it("WARNs Antigravity + Gemini dual fingerprints when both enabled", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "antigravity",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    expect(
      installInitYes({
        projectRoot: root,
        platform: "gemini-cli",
        surface: "cli",
        locale: "en",
        force: true,
        mergePlatforms: true,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(/Antigravity \+ Gemini CLI both enabled/i);
    // Co-install still plants both skill trees.
    expect(joined).toMatch(/OK\s+skills \(10\)/);
  });

  it("WARNs missing Gemini skills when Gemini enabled", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "gemini-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    fs.rmSync(path.join(root, ".gemini", "skills"), {
      recursive: true,
      force: true,
    });
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(
      /WARN\s+5 skill\(s\) missing under \.gemini\/skills\//i,
    );
    expect(joined).not.toMatch(/OK\s+skills/);
  });

});

describe("runDoctor skillHosts for Codex/Kimi/Copilot/Grok", () => {
  let root: string;
  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("OKs Codex skills under .agents/skills", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "codex",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    expect(lines.join("\n")).toMatch(/OK\s+skills \(5\)/);
  });

  it("WARNs missing Codex skills when Codex enabled", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "codex",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    fs.rmSync(path.join(root, ".agents", "skills"), {
      recursive: true,
      force: true,
    });
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(
      /WARN\s+5 skill\(s\) missing under \.agents\/skills\//i,
    );
    expect(joined).not.toMatch(/OK\s+skills/);
  });

  it("OKs Copilot skills under .github/skills", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "copilot-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    expect(lines.join("\n")).toMatch(/OK\s+skills \(5\)/);
  });

  it("WARNs missing Copilot skills when Copilot enabled", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "copilot-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    fs.rmSync(path.join(root, ".github", "skills"), {
      recursive: true,
      force: true,
    });
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(
      /WARN\s+5 skill\(s\) missing under \.github\/skills\//i,
    );
    expect(joined).not.toMatch(/OK\s+skills/);
  });

  it("OKs Grok skills under .grok/skills", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "grok-build",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    expect(lines.join("\n")).toMatch(/OK\s+skills \(5\)/);
  });

  it("WARNs missing Grok skills when Grok enabled", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "grok-build",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    new StateStore(root).close();
    fs.rmSync(path.join(root, ".grok", "skills"), {
      recursive: true,
      force: true,
    });
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).toMatch(
      /WARN\s+5 skill\(s\) missing under \.grok\/skills\//i,
    );
    expect(joined).not.toMatch(/OK\s+skills/);
  });

  it("OKs Kimi skills under .agents/skills", () => {
    root = tmpProject();
    const kimiHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-doc-kimi-sk-"));
    const prev = process.env.KIMI_CODE_HOME;
    process.env.KIMI_CODE_HOME = kimiHome;
    try {
      expect(
        installInitYes({
          projectRoot: root,
          platform: "kimi-code",
          surface: "cli",
          locale: "en",
          force: false,
        }).ok,
      ).toBe(true);
      new StateStore(root).close();
      const { ok, lines } = runDoctor(root);
      expect(ok).toBe(true);
      expect(lines.join("\n")).toMatch(/OK\s+skills \(5\)/);
    } finally {
      if (prev === undefined) delete process.env.KIMI_CODE_HOME;
      else process.env.KIMI_CODE_HOME = prev;
      fs.rmSync(kimiHome, { recursive: true, force: true });
    }
  });

  it("WARNs missing Kimi skills when Kimi enabled", () => {
    root = tmpProject();
    const kimiHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-doc-kimi-miss-"));
    const prev = process.env.KIMI_CODE_HOME;
    process.env.KIMI_CODE_HOME = kimiHome;
    try {
      expect(
        installInitYes({
          projectRoot: root,
          platform: "kimi-code",
          surface: "cli",
          locale: "en",
          force: false,
        }).ok,
      ).toBe(true);
      new StateStore(root).close();
      fs.rmSync(path.join(root, ".agents", "skills"), {
        recursive: true,
        force: true,
      });
      const { ok, lines } = runDoctor(root);
      expect(ok).toBe(true);
      const joined = lines.join("\n");
      expect(joined).toMatch(
        /WARN\s+5 skill\(s\) missing under \.agents\/skills\//i,
      );
      expect(joined).not.toMatch(/OK\s+skills/);
    } finally {
      if (prev === undefined) delete process.env.KIMI_CODE_HOME;
      else process.env.KIMI_CODE_HOME = prev;
      fs.rmSync(kimiHome, { recursive: true, force: true });
    }
  });
});
