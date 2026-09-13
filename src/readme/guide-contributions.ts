/** @module Feature-owned guide content for either README provider. */
import type { PackageMetadata } from "../package/metadata.ts";
import type { ReadmeContribution } from "./contribution-blocks.ts";

export interface GuideInputs {
  readonly metadata: PackageMetadata;
  readonly build: boolean;
  readonly jsr: boolean;
  readonly cli: boolean;
  readonly lib: boolean;
  readonly deno: boolean;
  readonly install?: string;
  readonly example?: string;
  readonly github?: { readonly owner: string; readonly name: string };
  readonly releaseTag?: boolean;
  readonly cliPermissions: string;
}

export function guideContributions(input: GuideInputs): ReadmeContribution[] {
  const { metadata, build } = input;
  const name = build ? "{{package.name}}" : metadata.name;
  const command = build ? "{{package.command}}" : metadata.command;
  const result: ReadmeContribution[] = [];
  const section = (id: string, content: string) =>
    result.push({ id, content, position: "section" });
  if (input.jsr) {
    result.push({
      id: "jsr-package:badges",
      position: "badges",
      content:
        `[![JSR Version](https://jsr.io/badges/${name})](https://jsr.io/${name})\n[![JSR Score](https://jsr.io/badges/${name}/score)](https://jsr.io/${name})`,
    });
  }
  if (input.github) {
    const workflow = input.releaseTag ? "hj-release-publish-tag" : "hj-ci";
    const url =
      `https://github.com/${input.github.owner}/${input.github.name}/actions/workflows/${workflow}.yaml`;
    result.push({
      id: "github-ci:badge",
      position: "badges",
      content: input.releaseTag
        ? `[![CI](${url}/badge.svg?branch=main)](${url}?query=branch%3Amain)`
        : `[![CI](${url}/badge.svg)](${url})`,
    });
  }
  if (input.deno) {
    section(
      "readme:requirements",
      "## Requirements\n\nRequires [Deno](https://deno.com/).",
    );
  }
  if (input.jsr && input.lib) {
    section(
      "deno-lib:api",
      `## API\n\nSee the API documentation on\n[jsr.io/${name}](https://jsr.io/${name}).`,
    );
  }
  if (input.jsr) {
    if (input.install !== undefined) {
      section(
        "jsr-package:installation",
        `## Installation\n\nAdd the package as a dependency:\n\n\`\`\`sh\n${
          build
            ? "@@include(./install.sh)"
            : withoutShebang(input.install).trimEnd()
        }\n\`\`\``,
      );
    }
  }
  if (input.jsr && input.cli) {
    section(
      "deno-cli:installation",
      `To install the command:\n\n\`\`\`sh\ndeno install --global ${input.cliPermissions}--name ${command} jsr:${name}/cli\n\`\`\``,
    );
  }
  if (input.jsr && input.example !== undefined) {
    section(
      "deno-lib:example",
      `## Example usage\n\n\`\`\`typescript\n${
        build ? "@@include(./example-usage.ts)" : input.example.trimEnd()
      }\n\`\`\`\n\nRun this example without cloning the repository:\n\n\`\`\`sh\ndeno run --reload jsr:${name}/example-usage\n\`\`\`\n\nFrom a checkout, run the same example:\n\n\`\`\`sh\ndeno run readme/example-usage.ts\n\`\`\`\n\nFor more examples, see the tests:\n\n[test/lib_test.ts](${
        build ? "../" : "./"
      }test/lib_test.ts)`,
    );
  }
  return result;
}

export function withoutShebang(text: string): string {
  return text.replace(/^#![^\n]*\n/, "");
}

export function libraryExample(target: string): string {
  return `import { placeholder } from "../${
    target.slice(2)
  }";\n\nconst result = placeholder();\nconsole.dir({ result });\n`;
}
