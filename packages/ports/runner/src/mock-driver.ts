import type { AgentDriver, DriverResult, DriverRunInput } from "./driver.js";

export type MockDriverStep =
  | DriverResult
  | ((input: DriverRunInput) => DriverResult | Promise<DriverResult>);

/**
 * In-process driver for contract tests (research §5).
 * Records every prompt; plays scripted exit codes / side effects.
 */
export class MockDriver implements AgentDriver {
  readonly calls: DriverRunInput[] = [];
  private stepIndex = 0;

  constructor(private readonly steps: readonly MockDriverStep[] = []) {}

  async run(input: DriverRunInput): Promise<DriverResult> {
    this.calls.push({ ...input });
    const step = this.steps[this.stepIndex];
    this.stepIndex += 1;
    if (step === undefined) {
      return { exitCode: 0, signal: null };
    }
    if (typeof step === "function") {
      return step(input);
    }
    return step;
  }
}
