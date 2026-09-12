/** @module A failed project command with its original process exit status. */

/** Preserves a child command's failure at the CLI boundary. */
export class CommandFailure extends Error {
  constructor(message: string, readonly exitCode: number) {
    super(message);
    this.name = "CommandFailure";
  }
}
