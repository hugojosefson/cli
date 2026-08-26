/** @module Errors raised while safely applying a local change plan. */

/** A non-secret reason a local change plan cannot be applied. */
export class ChangePlanError extends Error {
  constructor(
    readonly code: "precondition" | "expected-state" | "unsupported" | "git",
    readonly subject: string,
  ) {
    super(`${code}: ${subject}`);
    this.name = "ChangePlanError";
  }
}
