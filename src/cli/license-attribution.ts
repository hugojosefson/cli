/** @module Resolves non-secret license attribution before planning. */

import type { GithubIdentityReader } from "../api/repository-context.ts";

import { promptTerminalText } from "./terminal-prompt.ts";

export type AttributionPrompt = () =>
  | string
  | null
  | undefined
  | Promise<string | null | undefined>;
export interface AttributionContext {
  readonly githubIdentity?: GithubIdentityReader;
  readonly git: { userName?(): Promise<string | undefined> };
}

/** Resolves Github viewer, Git name, then an interactive prompt. */
export async function resolveLicenseAttribution(
  context: AttributionContext,
  prompt: AttributionPrompt = () =>
    promptTerminalText("License copyright holder"),
): Promise<{ readonly licenseHolder: string; readonly licenseYear: string }> {
  const viewer = await context.githubIdentity?.viewer();
  const holder = viewer?.name || await context.git.userName?.() ||
    await prompt();
  if (!holder || !safe(holder)) {
    throw new Error("License attribution is required.");
  }
  return {
    licenseHolder: holder.trim(),
    licenseYear: String(new Date().getUTCFullYear()),
  };
}

function safe(value: string): boolean {
  return value.trim().length > 0 && !/[\0\r\n]/.test(value);
}
