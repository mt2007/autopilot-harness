/**
 * Devin CLI probe helpers for doctor (WARN only; never blocks init).
 */
import { execFileSync } from "node:child_process";
import { DEVIN_SOFT_MIN_VERSION } from "@autopilot-harness/port-devin";

export { DEVIN_SOFT_MIN_VERSION };

/**
 * Probe `devin --version` when on PATH (doctor WARN only).
 * Returns null when missing / unreadable.
 */
export function probeDevinCliVersion(
  run?: (cmd: string, args: string[]) => string,
): string | null {
  try {
    const exec =
      run ??
      ((cmd: string, args: string[]) =>
        execFileSync(cmd, args, {
          encoding: "utf8",
          timeout: 5_000,
          stdio: ["ignore", "pipe", "pipe"],
        }));
    const out = exec("devin", ["--version"]);
    const raw = String(out).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
    // Prefer a version near the "devin" token so a banner Node semver is not stolen.
    const nearDevin = raw.match(/devin\b[^\d]{0,24}(\d+\.\d+\.\d+)/i);
    if (nearDevin?.[1]) return nearDevin[1];
    const m = raw.match(/(\d+\.\d+\.\d+)/);
    if (m?.[1]) return m[1];
    const text = raw.slice(0, 80);
    return text || null;
  } catch {
    return null;
  }
}

/** True when `have` looks like dotted numeric version parts. */
export function isParseableDevinVersion(have: string | null): boolean {
  if (!have) return false;
  return /^\d+(\.\d+)*$/.test(have.trim());
}

/**
 * Semver-ish compare: true when `have` < `want`.
 * Missing / unparseable → false here (caller uses a separate tip).
 */
export function isDevinVersionBelowSoftMin(
  have: string | null,
  want: string = DEVIN_SOFT_MIN_VERSION,
): boolean {
  if (!have || !isParseableDevinVersion(have)) return false;
  if (!want || !isParseableDevinVersion(want)) return false;
  const parse = (v: string): number[] =>
    v
      .split(".")
      .map((p) => Number.parseInt(p.replace(/[^\d].*$/, ""), 10))
      .map((n) => (Number.isFinite(n) ? n : 0));
  const a = parse(have);
  const b = parse(want);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x < y) return true;
    if (x > y) return false;
  }
  return false;
}
