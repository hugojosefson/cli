/** @module Strict parsing for release commit messages. */

import type { ValidatedConventionalCommit } from "./release-type.ts";

export type ConventionalCommit = ValidatedConventionalCommit & {
  readonly subject: string;
};

const header = /^([a-z][a-z0-9-]*)(?:\(([\w./@ -]+)\))?(!)?: ([^\r\n]+)$/;
const breakingFooter = /^BREAKING(?: |-)(?:CHANGE): .+/m;

/** Parses one complete Conventional Commit message without normalizing it. */
export function parseConventionalCommit(
  message: string,
): ConventionalCommit | undefined {
  if (!message || message.includes("\r") || message.endsWith("\n")) {
    return undefined;
  }
  const [firstLine, ...rest] = message.split("\n");
  const match = header.exec(firstLine);
  if (!match || (rest.length > 0 && rest[0] !== "")) {
    return undefined;
  }
  return {
    type: match[1],
    breaking: match[3] === "!" || breakingFooter.test(rest.join("\n")),
    subject: firstLine,
  };
}

/** Rejects the complete selected range when any message is not conventional. */
export function validateConventionalCommits(
  messages: readonly string[],
): readonly ConventionalCommit[] {
  return messages.map((message, index) => {
    const commit = parseConventionalCommit(message);
    if (!commit) {
      throw new TypeError(
        `Selected commit ${index + 1} is not a Conventional Commit.`,
      );
    }
    return commit;
  });
}
