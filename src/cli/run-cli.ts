/** Parse commands before constructing services or starting effects. */
import { colorText, type OutputColors } from "./terminal-colors.ts";
import type { CliResult } from "./cli-result.ts";
import type { ReleaseServices } from "./run-release.ts";
import {
  commandDefinitions,
  commandHelp,
  type CommandName,
} from "./command-help.ts";

export async function runCli(
  root: URL,
  args: readonly string[],
  services: ReleaseServices & { readonly colors?: OutputColors } = {},
): Promise<CliResult> {
  if (!args.length || (args.length === 1 && isHelp(args[0]))) {
    return {
      output: commandHelp(undefined, services.colors?.stdout),
      terminalNewline: true,
    };
  }
  if (root.protocol !== "file:") {
    throw new TypeError("Repository root must be a file URL.");
  }
  root = root.pathname.endsWith("/") ? root : new URL(`${root.href}/`);
  const name = `${args[0]} ${args[1]}`;
  if (!Object.hasOwn(commandDefinitions, name)) {
    throw new Error("Unknown command. Run `hj --help` for available commands.");
  }
  const command = name as CommandName;
  if (args.length === 3 && isHelp(args[2])) {
    return {
      output: commandHelp(command, services.colors?.stdout),
      terminalNewline: true,
    };
  }
  if (command === "repo features") {
    const { builtInFeatureRegistry } = await import(
      "../features/built-in-feature-registry.ts"
    );
    const { parseFeatures } = await import("./parse-features.ts");
    const { runFeatures } = await import("./run-features.ts");
    return {
      output: await runFeatures(
        root,
        parseFeatures(args, builtInFeatureRegistry),
        undefined,
        services.colors,
      ),
      terminalNewline: true,
    };
  }
  if (command === "repo project-auto-add") {
    const { parseProjectAutoAdd, runProjectAutoAdd } = await import(
      "./run-project-auto-add.ts"
    );
    return {
      output: await runProjectAutoAdd(root, parseProjectAutoAdd(args.slice(2))),
      terminalNewline: true,
    };
  }
  const usage = commandDefinitions[command].usage;
  if (command === "readme build") {
    if (args.length > 3) throw new Error(`expected \`${usage}\``);
    const { buildReadme } = await import("../readme/build-readme.ts");
    return { output: await buildReadme(root, args[2]), terminalNewline: false };
  }
  if (args.length !== 2) throw new Error(`expected \`${usage}\``);
  const { runReleaseCommand } = await import("./run-release.ts");
  const result = await runReleaseCommand(
    commandDefinitions[command].release,
    root,
    services,
  );
  return {
    ...result,
    output: colorText(
      result.output,
      "green",
      services.colors?.stdout,
    ),
  };
}

function isHelp(value: string): boolean {
  return value === "--help" || value === "-h";
}
