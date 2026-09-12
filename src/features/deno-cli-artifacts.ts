/** @module Exact starter artifacts contributed by the Deno CLI feature. */

import { bundledMetadata, readPackageMetadata } from "../package/metadata.ts";
import { jsrPackageIdentity } from "./jsr-package-identity.ts";
import { hjPackageReference } from "./hj-package.ts";
import type {
  ArtifactSchema,
  ExactArtifactInspection,
} from "../api/artifact-inspection.ts";
import type {
  DetectionContext,
  OperationContext,
} from "../api/repository-context.ts";
import { inspectArtifact } from "../artifacts/inspect-artifact.ts";

export const denoCliFeatureId = "deno-cli";
export const denoCliExport = "./src/cli/cli.ts";
export const packageMetadataTask = {
  description: "Build bundled CLI package metadata from Deno configuration.",
  command:
    'sh -c \'temp=$(mktemp src/cli/package-metadata.json.XXXXXX) && trap "rm -f \\"$temp\\"" EXIT && deno run --allow-read=. ' +
    hjPackageReference +
    ' package build > "$temp" && chmod 644 "$temp" && mv "$temp" src/cli/package-metadata.json\'',
};
export const denoCliInitialConfigContribution = {
  featureId: denoCliFeatureId,
  value: {
    exports: { "./cli": denoCliExport },
    tasks: { "package-metadata": packageMetadataTask },
  },
};

const commandContent = `export type CliCommand = {
  readonly name: string;
  readonly description: string;
  readonly run: (args: readonly string[]) => string | Promise<string>;
};
`;

const baseCommandsContent =
  `import metadata from "./package-metadata.json" with { type: "json" };
import type { CliCommand } from "./command.ts";

const helpCommand: CliCommand = {
  name: "help",
  description: "Show available commands.",
  run: () =>
    metadata.name + "\\n\\nUsage: " + metadata.command + " <command>\\n\\n" +
    commands.map((command) => command.name + "  " + command.description).join(
      "\\n",
    ),
};

/** Generated command registry. Feature composition rewrites this file. */
export const commands: readonly CliCommand[] = [helpCommand];
`;

const serverCommandsContent =
  `import metadata from "./package-metadata.json" with { type: "json" };
import type { CliCommand } from "./command.ts";
import { serveCommand } from "./serve-command.ts";

const helpCommand: CliCommand = {
  name: "help",
  description: "Show available commands.",
  run: () =>
    metadata.name + "\\n\\nUsage: " + metadata.command + " <command>\\n\\n" +
    commands.map((command) => command.name + "  " + command.description).join(
      "\\n",
    ),
};

/** Generated command registry. Feature composition rewrites this file. */
export const commands: readonly CliCommand[] = [helpCommand, serveCommand];
`;

const testContent = `import { commands } from "../src/cli/commands.ts";

Deno.test("generated CLI has help", () => {
  if (commands[0]?.name !== "help") {
    throw new Error("expected the generated help command");
  }
});
`;

const serverListenAddress = "0.0.0.0:8000";

/** Files that change when the generated CLI gains or loses its server command. */
export const denoCliServerPaths: readonly string[] = [
  "src/cli/cli.ts",
  "src/cli/commands.ts",
  "src/cli/package-metadata.json",
  "src/cli/serve-command.ts",
];

export const denoCliArtifacts = [{
  path: "src/cli/cli.ts",
  content: `#!/bin/sh
// 2>/dev/null;DENO_VERSION_RANGE="^2.5.2";DENO_RUN_ARGS="";set -e;V="$DENO_VERSION_RANGE";A="$DENO_RUN_ARGS";h(){ [ -x "$(command -v "$1" 2>&1)" ];};n(){ [ "$(id -u)" != 0 ];};g(){ if n && ! h;then return;fi;u="$(n&&echo sudo||:)";if h brew;then echo "brew install $1";elif h apt;then echo "($u apt update && $u DEBIAN_FRONTEND=noninteractive apt install -y $1)";elif h yum;then echo "$u yum install -y $1";elif h pacman;then echo "$u pacman -yS --noconfirm $1";elif h opkg-install;then echo "$u opkg-install $1";fi;};p(){ q="$(g "$1")";if [ -z "$q" ];then echo "Please install '$1' manually, then try again.">&2;exit 1;fi;eval "o=\\"\\$(set +o)\\";set -x;$q;set +x;eval \\"\\$o\\"">&2;};f(){ h "$1"||p "$1";};w(){ [ -n "$1" ] && "$1" -V >/dev/null 2>&1;};U="$(l=$(printf "%s" "$V"|wc -c);for i in $(seq 1 $l);do c=$(printf "%s" "$V"|cut -c $i);printf '%%%02X' "'$c";done)";D="$(w "$(command -v deno||:)"||:)";t(){ i="$(if h findmnt;then findmnt -Ononoexec,noro -ttmpfs -nboAVAIL,TARGET|sort -rn|while IFS=$'\\n\\t ' read -r a m;do [ "$a" -ge 150000000 ]&&[ -d "$m" ]&&printf %s "$m"&&break||:;done;fi)";printf %s "\${i:-"\${TMPDIR:-/tmp}"}";};s(){ deno eval "import{satisfies as e}from'https://deno.land/x/semver@v1.4.1/mod.ts';Deno.exit(e(Deno.version.deno,'$V')?0:1);">/dev/null 2>&1;};e(){ R="$(t)/deno-range-$V/bin";mkdir -p "$R";export PATH="$R:$PATH";s&&return;f curl;v="$(curl -sSfL "https://semver.se.deno.net/api/github/denoland/deno/$U")";i="$(t)/deno-$v";ln -sf "$i/bin/deno" "$R/deno";s && return;f unzip;([ "\${A#*-q}" != "$A" ]&&exec 2>/dev/null;curl -fsSL https://deno.land/install.sh|DENO_INSTALL="$i" sh -s $DENO_INSTALL_ARGS "$v"|grep -iv discord>&2);};e;exec deno run $A "$0" "$@"

import { commands } from "./commands.ts";

async function runCli(args: readonly string[]): Promise<number> {
  const command = commands.find((item) => item.name === (args[0] ?? "help"));
  if (!command) {
    console.error("Unknown command: " + args[0]);
    return 1;
  }
  console.log(await command.run(args.slice(1)));
  return 0;
}

if (import.meta.main) {
  Deno.exit(await runCli(Deno.args));
}
`,
  mode: 0o755,
}, {
  path: "src/cli/command.ts",
  content: commandContent,
  mode: 0o644,
}, {
  path: "src/cli/commands.ts",
  content: baseCommandsContent,
  mode: 0o644,
}, {
  path: "test/cli_test.ts",
  content: testContent,
  mode: 0o644,
}] as const;

/** CLI adapter, contributed only when both CLI and server are enabled. */
export const denoCliServeArtifact = {
  path: "src/cli/serve-command.ts",
  content: `import server from "../server/server.ts";

export const serveCommand = {
  name: "serve",
  description: "Start the server.",
  run: async () => {
    const permission = await Deno.permissions.request({
      name: "net",
      host: "${serverListenAddress}",
    });
    if (permission.state !== "granted") {
      return "Network permission denied.";
    }
    await Deno.serve(server.fetch).finished;
    return "Server stopped.";
  },
};
`,
  mode: 0o644,
} as const;

/** Exact registry variants selected by the current or resolved server export. */
export function denoCliArtifactsForServer(serverEnabled: boolean) {
  const artifacts = denoCliArtifacts.map((artifact) => {
    if (!serverEnabled) return artifact;
    if (artifact.path === "src/cli/commands.ts") {
      return { ...artifact, content: serverCommandsContent };
    }
    if (artifact.path === "src/cli/cli.ts") {
      return {
        ...artifact,
        content: artifact.content.replace(
          'DENO_RUN_ARGS=""',
          `DENO_RUN_ARGS="--allow-net=${serverListenAddress}"`,
        ),
      };
    }
    return artifact;
  });
  return serverEnabled ? [...artifacts, denoCliServeArtifact] : artifacts;
}

/** Inspects the executable seed with exact content and mode checks. */
export async function inspectDenoCliArtifacts(
  context:
    & DetectionContext
    & Partial<Pick<OperationContext, "resolvedChanges">>,
  serverEnabled = false,
): Promise<readonly ExactArtifactInspection[]> {
  let metadata = await readPackageMetadata(context);
  if (
    !metadata.configured &&
    context.resolvedChanges?.some((change) =>
      change.featureId === "jsr-package" && change.enabled
    )
  ) {
    const identity = await jsrPackageIdentity(context);
    if (identity.kind === "available") {
      metadata = { ...metadata, name: identity.name };
    }
  }
  const artifacts = [...denoCliArtifactsForServer(serverEnabled), {
    path: "src/cli/package-metadata.json",
    content: bundledMetadata(metadata),
    mode: 0o644,
  }];
  return await Promise.all(
    artifacts.map(async (artifact) => {
      const schema: ArtifactSchema = { kind: "file", ...artifact };
      return inspectArtifact(
        schema,
        await context.files.observe(artifact.path),
      );
    }),
  );
}

export function denoCliSubject() {
  return { kind: "repository-path", identifier: "deno.json|deno.jsonc" };
}
