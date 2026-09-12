/**
 * Opt-in Linux package-manager regression, with real JSR packages.
 * Usage: node scripts/check-npm-runtime-packaging.mjs <npm11-cli.js> <npm12-cli.js>
 * Native CLI: add --native <first-clean-build.tgz> <second-clean-build.tgz> first.
 * No public registry writes. Installs published dependencies to temporary trees.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const nativeArchives = process.argv[2] === "--native"
  ? process.argv.slice(3, 5).map((path) => resolve(path))
  : undefined;
const npmClis = process.argv.slice(nativeArchives ? 5 : 2).map((path) =>
  resolve(path)
);
assert.equal(
  npmClis.length,
  2,
  "Pass npm 11 and npm 12 CLI paths, in that order",
);
const root = await mkdtemp(join(tmpdir(), "hj-npm-runtime-packaging-"));
console.log(`Evidence directory: ${root}`);
const fixture = fileURLToPath(
  new URL("./fixtures/npm-runtime-packaging/", import.meta.url),
);
const emptyConfig = join(root, "empty.npmrc");
await writeFile(emptyConfig, "");
const emptyGlobalConfig = join(root, "empty-global.npmrc");
await writeFile(emptyGlobalConfig, "");
const cleanPath = join(root, "bin");
await mkdir(cleanPath);
await symlink(process.execPath, join(cleanPath, "node"));
const bunLookup = await run("which", ["bun"], { env: process.env });
const bun = await realpath(bunLookup.stdout.trim());
await symlink(bun, join(cleanPath, "bun"));
for (const command of ["gzip", "sh", ...(nativeArchives ? ["git"] : [])]) {
  const executable = (await checked("which", [command], { env: process.env }))
    .trim();
  await symlink(executable, join(cleanPath, command));
}

function environment(cwd, registry = "https://registry.npmjs.org") {
  return {
    PATH: cleanPath,
    HOME: cwd,
    TMPDIR: cwd,
    npm_config_userconfig: emptyConfig,
    npm_config_globalconfig: emptyGlobalConfig,
    npm_config_cache: join(cwd, "npm-cache"),
    npm_config_registry: registry,
    npm_config_audit: "false",
    npm_config_update_notifier: "false",
    npm_config_fund: "false",
    npm_config_ignore_scripts: "true",
    BUN_INSTALL_CACHE_DIR: join(cwd, "bun-cache"),
    BUN_CONFIG_NO_CLEAR_TERMINAL: "1",
  };
}

async function run(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: environment(root),
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => stdout += chunk);
  child.stderr.setEncoding("utf8").on("data", (chunk) => stderr += chunk);
  const timer = setTimeout(() => child.kill("SIGKILL"), 90_000);
  try {
    const [code, signal] = await once(child, "close");
    return { code, signal, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

async function checked(command, args, options = {}) {
  const result = await run(command, args, options);
  assert.equal(
    result.code,
    0,
    `${command}: ${result.stdout}\n${result.stderr}`,
  );
  return result.stdout;
}

const versions = [];
for (let index = 0; index < npmClis.length; index++) {
  const version =
    (await checked(process.execPath, [npmClis[index], "--version"])).trim();
  assert.equal(Number(version.split(".")[0]), 11 + index);
  versions.push(version);
}
const bunVersion = (await checked(bun, ["--version"])).trim();
console.log(
  JSON.stringify({ node: process.version, npm: versions, bun: bunVersion }),
);
const tar = (await checked("which", ["tar"], { env: process.env })).trim();

async function assemble(label) {
  const build = join(root, label);
  await cp(fixture, build, { recursive: true });
  // The committed npm lock owns the entire graph, including resolved URLs and integrity.
  // No registry configuration is needed even here: npm ci follows the locked URLs.
  await checked(process.execPath, [npmClis[0], "ci", "--ignore-scripts"], {
    cwd: build,
    env: environment(build),
  });
  assert.deepEqual(
    await readFile(join(build, "package-lock.json")),
    await readFile(join(fixture, "package-lock.json")),
  );
  await copyFile(
    join(build, "package-lock.json"),
    join(build, "npm-dependencies.lock.json"),
  );
  // Catch accidental inclusion of output, secrets or arbitrary source files.
  await writeFile(join(build, "previous-build.tgz"), "must not ship");
  await writeFile(join(build, ".npmrc"), "must not ship");
  const packed = JSON.parse(
    await checked(process.execPath, [
      npmClis[0],
      "pack",
      "--json",
      "--ignore-scripts",
      "--pack-destination",
      root,
    ], { cwd: build, env: environment(build) }),
  )[0];
  const unpack = join(root, `${label}-unpacked`);
  await mkdir(unpack);
  await checked(tar, ["-xzf", join(root, packed.filename), "-C", unpack]);
  const packageRoot = join(unpack, "package");
  const manifestPath = join(packageRoot, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  // Bun 1.4.2 resolves listed dependencies even when bundleDependencies includes them.
  // They are already installed in the archive, so no consumer resolution is necessary.
  manifest.hjBundledDependencies = manifest.dependencies;
  delete manifest.dependencies;
  // npm publish otherwise synthesizes wildcard dependencies in registry metadata.
  delete manifest.bundleDependencies;
  delete manifest.private;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  // npm prunes undeclared root node_modules when reusing an npx installation.
  await rename(
    join(packageRoot, "node_modules"),
    join(packageRoot, "bin", "node_modules"),
  );
  const archive = join(root, `${label}.tgz`);
  // GNU tar fixes order, ownership and timestamps; npm publish receives this archive.
  await checked(tar, [
    "--sort=name",
    "--mtime=@0",
    "--mode=u+rwX,go+rX,go-w",
    "--owner=0",
    "--group=0",
    "--numeric-owner",
    "--format=gnu",
    "-czf",
    archive,
    "-C",
    unpack,
    "package",
  ]);
  const entries = (await checked(tar, ["-tzf", archive])).trim().split("\n");
  assert(
    !entries.some((entry) =>
      /(?:previous-build\.tgz|\.npmrc|\/\.bin\/)/.test(entry)
    ),
  );
  for (const name of ["std__path", "std__internal"]) {
    const prefix = `package/bin/node_modules/@jsr/${name}/`;
    assert(entries.includes(prefix + "package.json"), `${name} is missing`);
    assert(
      entries.some((entry) =>
        entry.startsWith(prefix) && /\/LICENSE(?:\.|$)/.test(entry)
      ),
    );
  }
  assert(
    entries.every((entry) =>
      entry === "package/" ||
      entry.startsWith("package/bin/") ||
      [
        "package/package.json",
        "package/LICENSE",
        "package/npm-dependencies.lock.json",
      ].includes(entry)
    ),
  );
  return { archive, manifest, entries };
}

async function inspectNative(archive) {
  const manifest = JSON.parse(
    await checked(tar, ["-xzOf", archive, "package/package.json"]),
  );
  const entries = (await checked(tar, ["-tzf", archive])).trim().split("\n");
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.bundleDependencies, undefined);
  assert.deepEqual(manifest.os, ["linux"]);
  assert.deepEqual(manifest.cpu, ["x64"]);
  assert.deepEqual(manifest.libc, ["glibc"]);
  assert(
    !entries.some((entry) =>
      entry.startsWith("package/esm/") &&
        !entry.startsWith("package/esm/node_modules/") &&
        /(?:_test\.(?:ts|js)|test-fixtures|\.map$)/.test(entry) ||
      /\/\.npmrc$/.test(entry)
    ),
  );
  assert(entries.includes("package/npm-dependencies.lock.json"));
  return { archive, manifest, entries };
}
const first = nativeArchives
  ? await inspectNative(nativeArchives[0])
  : await assemble("build-a");
const second = nativeArchives
  ? await inspectNative(nativeArchives[1])
  : await assemble("build-b");
const binName = Object.keys(first.manifest.bin)[0];
const bytes = await readFile(first.archive);
assert.deepEqual(
  bytes,
  await readFile(second.archive),
  "Clean builds must be byte-identical",
);
const digest = (algorithm) => createHash(algorithm).update(bytes).digest("hex");
const requests = [];
const publications = [];
let publishing = false;
const server = createServer(async (request, response) => {
  requests.push(`${request.method} ${decodeURIComponent(request.url)}`);
  if (
    request.method === "PUT" &&
    decodeURIComponent(request.url) === `/${first.manifest.name}`
  ) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    publications.push(JSON.parse(Buffer.concat(chunks).toString()));
    response.writeHead(201, { "content-type": "application/json" });
    response.end('{"ok":true}');
  } else if (
    !publishing && request.method === "GET" &&
    decodeURIComponent(request.url) === `/${first.manifest.name}`
  ) {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      name: first.manifest.name,
      "dist-tags": { latest: first.manifest.version },
      versions: {
        [first.manifest.version]: {
          ...publications.at(-1).versions[first.manifest.version],
          dist: { tarball: `${registry}/archive.tgz`, shasum: digest("sha1") },
        },
      },
    }));
  } else if (request.method === "GET" && request.url === "/archive.tgz") {
    response.setHeader("content-type", "application/octet-stream");
    response.end(bytes);
  } else {
    response.writeHead(404);
    response.end("Unexpected dependency request");
  }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const registry = `http://127.0.0.1:${server.address().port}`;
const results = [];
try {
  if (nativeArchives) {
    const graph = join(root, "native-graph");
    await mkdir(graph);
    await checked(tar, ["-xzf", first.archive, "-C", graph]);
    const probe = join(graph, "package", "esm", "graph-probe.mjs");
    await copyFile(
      fileURLToPath(
        new URL("./fixtures/native-npm-graph/probe.mjs", import.meta.url),
      ),
      probe,
    );
    for (const runtime of [process.execPath, bun]) {
      const output = await checked(runtime, [probe], {
        cwd: graph,
        env: environment(graph, registry),
      });
      assert.match(output, /Native dynamic dependency graph passed/);
    }
    assert.deepEqual(requests, [], "Dynamic imports fetched a dependency");
  }
  // Real npm publish protocol against a loopback-only registry: proves no repack.
  publishing = true;
  for (let index = 0; index < npmClis.length; index++) {
    const cwd = join(root, `publish-npm${11 + index}`);
    await mkdir(cwd);
    await checked(process.execPath, [
      npmClis[index],
      "publish",
      first.archive,
      "--ignore-scripts",
      "--provenance=false",
      `--registry=${registry}`,
      "--access=public",
      `--//127.0.0.1:${server.address().port}/:_authToken=local-fixture-only`,
    ], { cwd, env: environment(cwd, registry) });
    const publication = publications[index];
    const attachments = Object.values(publication._attachments);
    assert.equal(attachments.length, 1);
    assert.deepEqual(
      Buffer.from(attachments[0].data, "base64"),
      bytes,
      "Publish repacked the archive",
    );
    const metadata = publication.versions[first.manifest.version];
    assert.equal(metadata.dependencies, undefined);
    assert.deepEqual(
      metadata.bundleDependencies,
      first.manifest.bundleDependencies,
    );
    assert.deepEqual(
      metadata.hjBundledDependencies,
      first.manifest.hjBundledDependencies,
    );
  }
  publishing = false;
  const managers = [
    ...npmClis.map((cli, index) => ({
      name: `npm${11 + index}`,
      command: process.execPath,
      prefix: [join(dirname(cli), "npx-cli.js"), "--yes"],
      runtime: "node",
    })),
    { name: "bun", command: bun, prefix: ["x", "--bun"], runtime: "bun" },
  ];
  for (const manager of managers) {
    for (const source of ["archive", "name"]) {
      const installation = join(root, `${manager.name}-${source}-installation`);
      await mkdir(installation);
      for (
        const scenario of nativeArchives
          ? [
            "help",
            "fail",
            "metadata",
            "features",
            "readme",
            "write",
            "deno-task",
          ]
          : ["pass", "fail"]
      ) {
        const failing = scenario === "fail";
        const label = `${manager.name}-${source}-${scenario}`;
        const cwd = join(root, `${label} caller with spaces`);
        await mkdir(cwd);
        // Runtime caches in HOME must not become unowned Git repair outputs.
        const home = join(installation, `${scenario} home with spaces`);
        await mkdir(home);
        const start = requests.length;
        const args = source === "archive"
          ? [...manager.prefix, "--package", first.archive, binName]
          : [
            ...manager.prefix,
            `${first.manifest.name}@${first.manifest.version}`,
          ];
        let env = {
          ...environment(cwd, registry),
          HOME: home,
          npm_config_cache: join(installation, "npm-cache"),
          BUN_INSTALL_CACHE_DIR: join(installation, "bun-cache"),
          TMPDIR: installation,
        };
        if (!["help", "pass"].includes(scenario)) {
          env.npm_config_offline = "true";
        }
        if (nativeArchives) {
          await writeFile(
            join(cwd, "deno.json"),
            JSON.stringify({
              name: "@fixture/project",
              version: "1.0.0",
              hj: { commandName: "fixture-command" },
            }),
          );
          if (scenario === "help") args.push("--help");
          if (scenario === "fail") args.push("--invalid-native-probe");
          if (scenario === "metadata") args.push("package", "build");
          if (scenario === "features") {
            await checked(join(cleanPath, "git"), ["init", "--quiet"], {
              cwd,
              env,
            });
            args.push("repo", "features");
          }
          if (scenario === "readme") {
            await mkdir(join(cwd, "readme"));
            await writeFile(
              join(cwd, "readme", "README.md"),
              "# Native archive writes\n",
            );
            args.push("readme", "build");
          }
          if (scenario === "write") {
            for (
              const gitArgs of [["init", "--quiet"], [
                "config",
                "user.name",
                "Fixture",
              ], ["config", "user.email", "fixture@example.test"]]
            ) {
              await checked(join(cleanPath, "git"), gitArgs, { cwd, env });
            }
            args.push("repo", "features", "--editorconfig", "--yes");
          }
          if (scenario === "deno-task") {
            const taskPath = join(cwd, "task-bin");
            await mkdir(taskPath);
            const deno =
              (await checked("which", ["deno"], { env: process.env })).trim();
            await symlink(deno, join(taskPath, "deno"));
            env = {
              ...env,
              PATH: `${taskPath}:${cleanPath}`,
              DENO_DIR: join(installation, "deno-cache"),
            };
            await writeFile(
              join(cwd, "deno.json"),
              JSON.stringify({
                tasks: { default: "deno run --allow-write task.ts" },
              }),
            );
            await writeFile(
              join(cwd, "task.ts"),
              `await Deno.writeTextFile(${
                JSON.stringify(join(installation, "deno-task-ran"))
              }, Deno.version.deno);\n`,
            );
            for (
              const gitArgs of [["init", "--quiet"], [
                "config",
                "user.name",
                "Fixture",
              ], ["config", "user.email", "fixture@example.test"]]
            ) {
              await checked(join(cleanPath, "git"), gitArgs, { cwd, env });
            }
            args.push("repo", "features", "--editorconfig", "--yes");
          }
        } else if (failing) args.push("--fail");
        const result = await run(manager.command, args, { cwd, env });
        await writeFile(
          join(root, `${label}.log`),
          JSON.stringify(result, null, 2),
        );
        assert.equal(result.signal, null, `${label} timed out`);
        if (failing) {
          assert.notEqual(result.code, 0, label);
          assert.match(
            result.stderr,
            nativeArchives ? /Unknown command/ : /expected fixture failure/,
            label,
          );
        } else {
          assert.equal(result.code, 0, `${label}: ${result.stderr}`);
          if (nativeArchives) {
            if (scenario === "help") {
              assert.match(result.stdout, /hj: repository setup/);
            }
            if (scenario === "metadata") {
              assert.deepEqual(JSON.parse(result.stdout), {
                name: "@fixture/project",
                command: "fixture-command",
              });
            }
            if (scenario === "features") {
              assert.match(result.stdout, /deno-cli/);
              assert.match(result.stdout, /readme-static/);
            }
            if (scenario === "readme") {
              assert.match(result.stdout, /Native archive writes/);
            }
            if (scenario === "write") {
              assert.match(
                await readFile(join(cwd, ".editorconfig"), "utf8"),
                /root = true/,
              );
            }
            if (scenario === "deno-task") {
              assert.match(
                await readFile(join(installation, "deno-task-ran"), "utf8"),
                /^2\./,
              );
            }
          } else {
            const output = JSON.parse(result.stdout.trim());
            assert.equal(output.result, "bundled JSR dependency works");
            assert.equal(output.runtime, manager.runtime);
          }
        }
        const observed = requests.slice(start);
        const expected =
          source === "archive" || !["help", "pass"].includes(scenario) ? [] : [
            `GET /${first.manifest.name}`,
            "GET /archive.tgz",
          ];
        assert.deepEqual(
          [...new Set(observed)],
          expected,
          `${label}: unexpected registry request`,
        );
        results.push({ label, exit: result.code, requests: observed });
        console.log(`${label}: passed`);
      }
    }
  }
  const evidence = {
    node: process.version,
    npm: versions,
    bun: bunVersion,
    dynamicGraphs: nativeArchives ? ["node", "bun"] : [],
    sha256: digest("sha256"),
    archiveBytes: bytes.length,
    entries: first.entries.length,
    repeatableCleanBuilds: true,
    exactArchivePublished: publications.length,
    results,
    requests,
  };
  await writeFile(
    join(root, "results.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(`All checks passed. Evidence: ${join(root, "results.json")}`);
} finally {
  server.close();
  server.closeAllConnections();
}
