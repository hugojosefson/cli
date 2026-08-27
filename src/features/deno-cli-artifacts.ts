/** @module Exact starter artifacts contributed by the Deno CLI feature. */

import type {
  ArtifactSchema,
  ExactArtifactInspection,
} from "../api/artifact-inspection.ts";
import type { DetectionContext } from "../api/repository-context.ts";
import { inspectArtifact } from "../artifacts/inspect-artifact.ts";

export const denoCliFeatureId = "deno-cli";
export const denoCliExport = "./src/cli/cli.ts";
export const denoCliInitialConfigContribution = {
  featureId: denoCliFeatureId,
  value: { exports: { "./cli": denoCliExport } },
};

const commandContent = `export type CliCommand = {
  readonly name: string;
  readonly description: string;
  readonly run: (args: readonly string[]) => string;
};
`;

const commandsContent = `import type { CliCommand } from "./command.ts";

const helpCommand: CliCommand = {
  name: "help",
  description: "Show available commands.",
  run: () =>
    "Usage: cli <command>\\n\\n" +
    commands.map((command) => command.name + "  " + command.description).join(
      "\\n",
    ),
};

/** Generated command registry. Add future feature commands here. */
export const commands: readonly CliCommand[] = [helpCommand];
`;

const testContent = `import { commands } from "../src/cli/commands.ts";

Deno.test("generated CLI has help", () => {
  if (commands.length !== 1 || commands[0].name !== "help") {
    throw new Error("expected the generated help command");
  }
});
`;

export const denoCliArtifacts = [{
  path: "src/cli/cli.ts",
  content: `#!/bin/sh
// 2>/dev/null;DENO_VERSION_RANGE="^2.5.2";DENO_RUN_ARGS="";set -e;V="$DENO_VERSION_RANGE";A="$DENO_RUN_ARGS";h(){ [ -x "$(command -v "$1" 2>&1)" ];};n(){ [ "$(id -u)" != 0 ];};g(){ if n && ! h;then return;fi;u="$(n&&echo sudo||:)";if h brew;then echo "brew install $1";elif h apt;then echo "($u apt update && $u DEBIAN_FRONTEND=noninteractive apt install -y $1)";elif h yum;then echo "$u yum install -y $1";elif h pacman;then echo "$u pacman -yS --noconfirm $1";elif h opkg-install;then echo "$u opkg-install $1";fi;};p(){ q="$(g "$1")";if [ -z "$q" ];then echo "Please install '$1' manually, then try again.">&2;exit 1;fi;eval "o=\\"\\$(set +o)\\";set -x;$q;set +x;eval \\"\\$o\\"">&2;};f(){ h "$1"||p "$1";};w(){ [ -n "$1" ] && "$1" -V >/dev/null 2>&1;};U="$(l=$(printf "%s" "$V"|wc -c);for i in $(seq 1 $l);do c=$(printf "%s" "$V"|cut -c $i);printf '%%%02X' "'$c";done)";D="$(w "$(command -v deno||:)"||:)";t(){ i="$(if h findmnt;then findmnt -Ononoexec,noro -ttmpfs -nboAVAIL,TARGET|sort -rn|while IFS=$'\\n\\t ' read -r a m;do [ "$a" -ge 150000000 ]&&[ -d "$m" ]&&printf %s "$m"&&break||:;done;fi)";printf %s "\${i:-"\${TMPDIR:-/tmp}"}";};s(){ deno eval "import{satisfies as e}from'https://deno.land/x/semver@v1.4.1/mod.ts';Deno.exit(e(Deno.version.deno,'$V')?0:1);">/dev/null 2>&1;};e(){ R="$(t)/deno-range-$V/bin";mkdir -p "$R";export PATH="$R:$PATH";s&&return;f curl;v="$(curl -sSfL "https://semver.se.deno.net/api/github/denoland/deno/$U")";i="$(t)/deno-$v";ln -sf "$i/bin/deno" "$R/deno";s && return;f unzip;([ "\${A#*-q}" != "$A" ]&&exec 2>/dev/null;curl -fsSL https://deno.land/install.sh|DENO_INSTALL="$i" sh -s $DENO_INSTALL_ARGS "$v"|grep -iv discord>&2);};e;exec deno run $A "$0" "$@"

import { commands } from "./commands.ts";

function runCli(args: readonly string[]): number {
  const command = commands.find((item) => item.name === (args[0] ?? "help"));
  if (!command) {
    console.error("Unknown command: " + args[0]);
    return 1;
  }
  console.log(command.run(args.slice(1)));
  return 0;
}

if (import.meta.main) {
  Deno.exit(runCli(Deno.args));
}
`,
  mode: 0o755,
}, {
  path: "src/cli/command.ts",
  content: commandContent,
  mode: 0o644,
}, {
  path: "src/cli/commands.ts",
  content: commandsContent,
  mode: 0o644,
}, {
  path: "test/cli_test.ts",
  content: testContent,
  mode: 0o644,
}] as const;

/** Inspects the executable seed with exact content and mode checks. */
export async function inspectDenoCliArtifacts(
  context: DetectionContext,
): Promise<readonly ExactArtifactInspection[]> {
  return await Promise.all(denoCliArtifacts.map(async (artifact) => {
    const schema: ArtifactSchema = { kind: "file", ...artifact };
    return inspectArtifact(schema, await context.files.observe(artifact.path));
  }));
}

export function denoCliSubject() {
  return { kind: "repository-path", identifier: "deno.json|deno.jsonc" };
}
