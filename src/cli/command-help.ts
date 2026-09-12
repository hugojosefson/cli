/** Available commands and their usage, shared by dispatch errors and help. */
import { colorText } from "./terminal-colors.ts";
import { formatTable } from "./format-table.ts";
export const commandDefinitions = {
  "repo features": {
    usage: "hj repo features",
    description: "Inspect or change repository features.",
    details:
      "With no flags, report status without changes.\nPresets select a group of features with one flag. Explicit feature flags override presets.\nGitHub changes require an authenticated gh CLI, an existing repository link, and --yes.",
    flags: [
      ["--defaults", "Select Git and README."],
      ["--jsr", "Set up a JSR package and publication from GitHub Actions."],
      [
        "--workflow-cli=<source>",
        "Use jsr or github:owner/repository@<commit SHA> in selected workflows.",
      ],
      ["--github", "Apply common GitHub repository settings (private)."],
      ["--github-protection", "Protect the default branch and tags."],
      [
        "--github-public",
        "Select public visibility; overrides --github visibility.",
      ],
      ["--<feature>", "Enable a feature."],
      ["--no-<feature>", "Disable a feature."],
      ["--repair", "Repair drifted managed configuration."],
      ["--interactive, -i", "Select actions in a terminal checklist."],
      ["--yes", "Accept plan warnings that need confirmation."],
    ],
  },
  "repo project-auto-add": {
    usage: "hj repo project-auto-add --yes",
    description: "Auto-add issues to the default GitHub project.",
    details:
      "Uses a signed-in Firefox automation session. Start a dedicated Firefox profile with --remote-debugging-port=9222 first.\nTries GitHub's internal endpoint, then its workflow controls when the endpoint is unavailable.",
    flags: [
      ["--yes", "Enable auto-add for all repository issues."],
      [
        "--method=auto|endpoint|browser",
        "Choose the setup route (default: auto).",
      ],
      [
        "--browser-url=<url>",
        "Firefox connection (default: ws://127.0.0.1:9222/session).",
      ],
    ],
  },
  "package build": {
    usage: "hj package build",
    description: "Build bundled CLI package metadata.",
    details:
      "Write package metadata JSON to stdout from deno.json or deno.jsonc.",
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

const featureExamples = [
  ["hj repo features --defaults", "Set up Git and README."],
  [
    "hj repo features --github --github-public --yes",
    "Apply GitHub settings with public visibility.",
  ],
  [
    "hj repo features --github-protection --yes",
    "Protect the default branch and tags.",
  ],
] as const;

export function commandHelp(command?: CommandName, color = false): string {
  const examples = formatTable(
    ["Example", "Effect"],
    featureExamples,
    undefined,
    {
      color,
      columns: ["cyan"],
    },
  );
  if (command) {
    const entry = commandDefinitions[command];
    const flags = "flags" in entry
      ? "\n\n" +
        formatTable(["Flag", "Effect"], entry.flags, undefined, {
          color,
          columns: ["cyan"],
        })
      : "";
    return `${
      colorText(entry.usage, "cyan", color)
    }\n\n${entry.description}\n\n${entry.details}${flags}${
      command === "repo features" ? `\n\n${examples}` : ""
    }`;
  }
  return [
    colorText("hj: repository setup and release automation", "bold", color),
    "",
    formatTable(
      ["Command", "Description"],
      Object.values(commandDefinitions).map((
        entry,
      ) => [entry.usage, entry.description]),
      undefined,
      { color, columns: ["cyan"] },
    ),
    "",
    examples,
    "",
    "GitHub changes require an authenticated gh CLI and an existing repository link.",
    "Use <command> --help for details.",
    "Track proposed changes at https://github.com/hugojosefson/cli/issues.",
  ].join("\n");
}
