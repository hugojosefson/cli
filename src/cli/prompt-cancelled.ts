/** @module A deliberate interactive cancellation, with no feature application. */
export class PromptCancelled extends Error {
  constructor() {
    super("Interactive selection cancelled.");
    this.name = "PromptCancelled";
  }
}
