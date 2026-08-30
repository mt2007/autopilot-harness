import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_VERIFY_REPORT_BYTES,
  evaluateVerifyReport,
  readVerifyReport,
} from "../src/verify-report.js";

describe("readVerifyReport hardening", () => {
  let root: string;

  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  function tmp(): string {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-vr-"));
    return root;
  }

  it("reads a regular JSON report", () => {
    const dir = tmp();
    const rp = path.join(dir, "verify-last.json");
    fs.writeFileSync(
      rp,
      JSON.stringify({
        itemId: "a",
        checklistPath: "/c.md",
        ranAt: new Date().toISOString(),
        commands: [{ id: "test", exitCode: 0 }],
      }),
    );
    const report = readVerifyReport(rp);
    expect(report?.itemId).toBe("a");
  });

  it("refuses symlinks (no follow / no read-through)", () => {
    const dir = tmp();
    const real = path.join(dir, "real.json");
    const link = path.join(dir, "link.json");
    fs.writeFileSync(real, JSON.stringify({ itemId: "secret" }));
    fs.symlinkSync(real, link);
    expect(readVerifyReport(link)).toBeNull();
    expect(readVerifyReport(real)?.itemId).toBe("secret");
  });

  it("refuses NUL in path", () => {
    expect(readVerifyReport("bad\0path.json")).toBeNull();
  });

  it("readVerifyReport with projectRoot refuses path outside project", () => {
    const project = tmp();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-vr-out-"));
    try {
      const rp = path.join(outside, "verify-last.json");
      fs.writeFileSync(
        rp,
        JSON.stringify({
          itemId: "secret",
          checklistPath: "/c.md",
          ranAt: new Date().toISOString(),
          commands: [],
        }),
      );
      expect(readVerifyReport(rp)).not.toBeNull();
      expect(readVerifyReport(rp, { projectRoot: project })).toBeNull();
      expect(
        readVerifyReport(rp, { projectRoot: `bad\0${project}` }),
      ).toBeNull();
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("refuses empty path / missing / directory / corrupt JSON", () => {
    const dir = tmp();
    expect(readVerifyReport("")).toBeNull();
    expect(readVerifyReport(path.join(dir, "missing.json"))).toBeNull();
    expect(readVerifyReport(dir)).toBeNull();
    const bad = path.join(dir, "bad.json");
    fs.writeFileSync(bad, "{not-json");
    expect(readVerifyReport(bad)).toBeNull();
  });

  it("refuses oversized files", () => {
    const dir = tmp();
    const rp = path.join(dir, "huge.json");
    const fd = fs.openSync(rp, "w");
    fs.ftruncateSync(fd, MAX_VERIFY_REPORT_BYTES + 1);
    fs.closeSync(fd);
    expect(readVerifyReport(rp)).toBeNull();
  });

  it("evaluate treats refused path as missing report (fail, no throw)", () => {
    const dir = tmp();
    const link = path.join(dir, "link.json");
    const real = path.join(dir, "real.json");
    fs.writeFileSync(
      real,
      JSON.stringify({
        itemId: "a",
        checklistPath: "/c.md",
        ranAt: new Date().toISOString(),
        commands: [{ id: "test", exitCode: 0 }],
      }),
    );
    fs.symlinkSync(real, link);
    const out = evaluateVerifyReport({
      enabled: true,
      commands: [{ id: "test", required: true }],
      reportPath: link,
      currentItem: {
        id: "a",
        title: "A",
        checked: false,
        line: "- [ ] a — A",
        lineNumber: 1,
        idFromSeparator: true,
      },
      checklistPath: "/c.md",
    });
    expect(out.outcome).toBe("fail");
    expect(out.reason).toBe("missing verify report");
  });

  it("evaluate refuses report whose realpath escapes projectRoot", () => {
    const project = tmp();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-vr-out-"));
    try {
      const rp = path.join(outside, "verify-last.json");
      fs.writeFileSync(
        rp,
        JSON.stringify({
          itemId: "a",
          checklistPath: "/c.md",
          ranAt: new Date().toISOString(),
          commands: [{ id: "test", exitCode: 0 }],
        }),
      );
      const out = evaluateVerifyReport({
        enabled: true,
        commands: [{ id: "test", required: true }],
        reportPath: rp,
        currentItem: {
          id: "a",
          title: "A",
          checked: false,
          line: "- [ ] a — A",
          lineNumber: 1,
          idFromSeparator: true,
        },
        checklistPath: "/c.md",
        projectRoot: project,
      });
      expect(out.outcome).toBe("fail");
      expect(out.reason).toBe("missing verify report");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("evaluate resolves relative reportPath against projectRoot not cwd", () => {
    const project = tmp();
    const apDir = path.join(project, ".autopilot");
    fs.mkdirSync(apDir, { recursive: true });
    const rp = path.join(apDir, "verify-last.json");
    fs.writeFileSync(
      rp,
      JSON.stringify({
        itemId: "a",
        checklistPath: "/c.md",
        ranAt: new Date().toISOString(),
        commands: [{ id: "test", exitCode: 0 }],
      }),
    );
    const prev = process.cwd();
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "ap-vr-cwd-"));
    try {
      process.chdir(other);
      const out = evaluateVerifyReport({
        enabled: true,
        commands: [{ id: "test", required: true }],
        reportPath: ".autopilot/verify-last.json",
        currentItem: {
          id: "a",
          title: "A",
          checked: false,
          line: "- [ ] a — A",
          lineNumber: 1,
          idFromSeparator: true,
        },
        checklistPath: "/c.md",
        projectRoot: project,
      });
      expect(out.outcome).toBe("pass");
      // Padded absolute root must trim before resolve (else Node treats as cwd-relative).
      const padded = evaluateVerifyReport({
        enabled: true,
        commands: [{ id: "test", required: true }],
        reportPath: ".autopilot/verify-last.json",
        currentItem: {
          id: "a",
          title: "A",
          checked: false,
          line: "- [ ] a — A",
          lineNumber: 1,
          idFromSeparator: true,
        },
        checklistPath: "/c.md",
        projectRoot: `  ${project}  `,
      });
      expect(padded.outcome).toBe("pass");
    } finally {
      process.chdir(prev);
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  it("evaluate refuses blank-only projectRoot (fail closed)", () => {
    expect(
      evaluateVerifyReport({
        enabled: true,
        commands: [{ id: "test", required: true }],
        reportPath: ".autopilot/verify-last.json",
        currentItem: {
          id: "a",
          title: "A",
          checked: false,
          line: "- [ ] a — A",
          lineNumber: 1,
          idFromSeparator: true,
        },
        checklistPath: "/c.md",
        projectRoot: "   ",
      }),
    ).toEqual({ outcome: "fail", reason: "missing verify report" });
  });

  it("evaluate refuses projectRoot containing NUL (fail closed)", () => {
    const project = tmp();
    const apDir = path.join(project, ".autopilot");
    fs.mkdirSync(apDir, { recursive: true });
    const rp = path.join(apDir, "verify-last.json");
    fs.writeFileSync(
      rp,
      JSON.stringify({
        itemId: "a",
        checklistPath: "/c.md",
        ranAt: new Date().toISOString(),
        commands: [{ id: "test", exitCode: 0 }],
      }),
    );
    const item = {
      id: "a",
      title: "A",
      checked: false,
      line: "- [ ] a — A",
      lineNumber: 1,
      idFromSeparator: true,
    };
    // Absolute report + NUL root must not skip containment and still pass.
    expect(
      evaluateVerifyReport({
        enabled: true,
        commands: [{ id: "test", required: true }],
        reportPath: rp,
        currentItem: item,
        checklistPath: "/c.md",
        projectRoot: `good\0${project}`,
      }),
    ).toEqual({ outcome: "fail", reason: "missing verify report" });
    // Relative report + NUL root must not resolve / read via cwd.
    expect(
      evaluateVerifyReport({
        enabled: true,
        commands: [{ id: "test", required: true }],
        reportPath: ".autopilot/verify-last.json",
        currentItem: item,
        checklistPath: "/c.md",
        projectRoot: `good\0${project}`,
      }),
    ).toEqual({ outcome: "fail", reason: "missing verify report" });
  });
});
