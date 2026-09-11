/** Available commands and their usage, shared by dispatch errors and help. */
export const commandDefinitions = {
  "repo features": {
    usage: "hj repo features",
    description: "Inspect or change repository features.",
    details:
      "With no flags, report status without changes.\nUse --<feature> or --no-<feature> to select changes.\nUse --defaults for the built-in selection, --repair for drift,\n--interactive for a checklist, and --yes to accept the plan.",
  },
  "readme build": {
    usage: "hj readme build [input]",
    description: "Build a README from Markdown includes.",
    details:
      "Write the built document to stdout. The default input is readme/README.md.",
  },
  "release publish-tag-prepare": {
    usage: "hj release publish-tag-prepare",
    release: "publish-tag-prepare",
    description: "Prepare release data or validate source commits.",
    details:
      "Workflow command. Requires the environment described in docs/releases.md.",
  },
  "release publish-tag-apply": {
    usage: "hj release publish-tag-apply",
    release: "publish-tag-apply",
    description: "Apply a prepared release or recover its tag.",
    details:
      "Workflow command. Requires a validated release bundle and GitHub access.",
  },
  "release publish-jsr": {
    usage: "hj release publish-jsr",
    release: "publish-jsr",
    description: "Publish a tagged JSR package.",
    details:
      "Workflow command. Requires GitHub OIDC and the release environment.",
  },
  "release publish-github": {
    usage: "hj release publish-github",
    release: "publish-github",
    description: "Create or verify a GitHub Release for a tag.",
    details:
      "Workflow command. Requires GitHub access and the release environment.",
  },
} as const;

export type CommandName = keyof typeof commandDefinitions;

export function commandHelp(command?: CommandName): string {
  if (command) {
    const entry = commandDefinitions[command];
    return `${entry.usage}\n\n${entry.description}\n\n${entry.details}`;
  }
  return [
    "hj: repository setup and release automation",
    "",
    ...Object.values(commandDefinitions).map((entry) =>
      `${entry.usage}\n  ${entry.description}`
    ),
    "",
    "Use <command> --help for details.",
    "Global configuration and npm publication are planned, not implemented.",
  ].join("\n");
}
