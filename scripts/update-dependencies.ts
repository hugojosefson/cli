import { readFile, writeFile } from "node:fs/promises";
import {
  type DenoLock,
  dependencyOverrides,
  type Manifest,
  mappedDependencies,
} from "./dependencies/manifest.ts";
import { verifyRegistryLock } from "./dependencies/registry-lock.ts";
import { latestVersion } from "./dependencies/latest-version.ts";
import { verifyNativeLock } from "./dependencies/verify-lock.ts";

const root = new URL("../", import.meta.url);
function command(name: string, args: string[], cwd = root): string {
  const result = new Deno.Command(name, {
    args,
    cwd,
    clearEnv: true,
    env: Object.fromEntries(
      ["PATH", "HOME", "DENO_DIR", "XDG_CACHE_HOME", "TMPDIR"].flatMap(
        (name) => {
          const value = Deno.env.get(name);
          return value === undefined ? [] : [[name, value]];
        },
      ),
    ),
    stdin: "null",
    stdout: "piped",
    stderr: "inherit",
  }).outputSync();
  if (!result.success) {
    throw new Error(`${name} failed (${result.code}).`);
  }
  return new TextDecoder().decode(result.stdout);
}
async function json(path: string) {
  return JSON.parse(await readFile(new URL(path, root), "utf8"));
}
const update = ["outdated", "--recursive", "--update", "--latest"];
command("deno", update);
command("deno", [...update, "--config", "scripts/npm-build/deno.json"]);
const config = await json("deno.json");
const source: DenoLock = await json("deno.lock");
for (
  const path of [
    "scripts/npm-build/dependencies/",
    "scripts/test-build/dependencies/",
    "scripts/npm-build/tools/",
  ]
) {
  const manifest: Manifest = await json(path + "package.json");
  const native = path.includes("/dependencies/");
  const mapped = native
    ? mappedDependencies(manifest.dependencies, config.imports, source)
    : {};
  for (const name of Object.keys(manifest.dependencies)) {
    const locked = native &&
      (Object.values(config.imports as Record<string, string>).some((
        specifier,
      ) =>
        specifier.startsWith(`npm:${name}@`) ||
        specifier.startsWith(`jsr:@${name.slice(5).replace("__", "/")}@`)
      ) || Object.keys(source.specifiers).some((specifier) =>
        specifier.startsWith(`npm:${name}@`)
      ));
    manifest.dependencies[name] = locked ? mapped[name] : latestVersion(
      command("npm", ["view", `${name}@latest`, "version", "--json"]),
    );
  }
  if (native) {
    manifest.overrides = dependencyOverrides(manifest.dependencies, source);
  }
  await writeFile(
    new URL(path + "package.json", root),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  if (!native) {
    verifyRegistryLock((await json(path + "package-lock.json")).packages);
    for (const [name, version] of Object.entries(manifest.dependencies)) {
      const output = JSON.parse(
        command("npm", [
          "view",
          `${name}@${version}`,
          "dist.tarball",
          "--json",
        ]),
      );
      const resolved = Array.isArray(output) && output.length === 1
        ? output[0]
        : output;
      verifyRegistryLock({ [name]: { resolved } });
    }
  }
  command("npm", [
    "install",
    "--package-lock-only",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--@jsr:registry=https://npm.jsr.io",
    ...native ? [] : ["--allow-remote=all"],
  ], new URL(path, root));
  verifyRegistryLock((await json(path + "package-lock.json")).packages);
  if (native) {
    verifyNativeLock(
      source,
      (await json(path + "package-lock.json")).packages,
      path.includes("npm-build"),
    );
  }
}
