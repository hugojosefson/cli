# Native npm archive contract

The native build must ship its production dependency packages inside the
archive. It must preserve each package's JavaScript modules, metadata, and
license. It must install through npx and `bunx --bun` without a consumer
`.npmrc`, an install script, or a Deno subprocess. This document specifies
packaging for [issue #74](https://github.com/hugojosefson/cli/issues/74). The
build implements this contract through `scripts/npm-build/build.ts`.

## Bun installer workaround

Bun 1.4.2 tries to resolve `dependencies` through the consumer's registry even
when those packages appear in `bundleDependencies` and are already in the
archive. JSR's npm packages do not exist at the public npm registry, so this
fails with 404 responses. Both `bundleDependencies` and `bundledDependencies`
spellings fail. [Bun issue #27418](https://github.com/oven-sh/bun/issues/27418)
tracks this behavior and was still open on 2026-09-12.

A final archive with the same dependency files and neither root `dependencies`
nor `bundleDependencies` works. Record the original exact dependency map in
`hjBundledDependencies`. Removing only `dependencies` is insufficient: npm
publish regenerates wildcard dependencies in registry metadata from the
remaining bundle list, which breaks package-name installation again. This
changes installation metadata. It does not combine JavaScript, rewrite
dependency source, or fetch packages at runtime. The dependency packages retain
their own manifests, including transitive requirements.

Also relocate the dependency tree from root `node_modules` to
`esm/node_modules`, next to the emitted application. npm otherwise prunes the
undeclared root dependencies when a later npx invocation reuses its cache. A
fresh install alone does not detect that failure. Normal module resolution finds
the private tree from the emitted code without changing imports or dependency
source. The small fixture uses the equivalent `bin/node_modules` location.

Use two stages:

1. Build the ESM application and install its production dependency graph using a
   frozen npm lock. The staging manifest still has `dependencies` and
   `bundleDependencies`. Bundle every direct production dependency, so npm
   includes the complete installed transitive tree.
2. Run `npm pack --ignore-scripts` with an explicit file allowlist and an
   archive destination outside the staging directory. Extract that archive, move
   its root `dependencies` map to `hjBundledDependencies`, remove both root
   `dependencies` and `bundleDependencies`, move the package tree to
   `esm/node_modules`, and repack the same files with deterministic archive
   headers. Publish that final archive.

For example, the staging manifest contains:

```json
{
  "dependencies": { "@jsr/std__path": "1.1.6" },
  "bundleDependencies": ["@jsr/std__path"]
}
```

The final manifest contains:

```json
{
  "hjBundledDependencies": { "@jsr/std__path": "1.1.6" }
}
```

The archive still includes `esm/node_modules/@jsr/std__path`, its transitive
`@jsr/std__internal` package, and both licenses. Normal Node and Bun module
resolution uses those packages. The root manifest has no runtime `dependencies`,
`optionalDependencies`, or `peerDependencies` that could cause consumer
resolution. Reject a build that introduces such an unhandled requirement.

Do not run `npm pack` on the normalized directory. npm omits the dependency tree
when its root `dependencies` field is absent. The publisher in
`src/release/publish-npm.ts` recognizes the build manifest's `hjNpmArchive`
field and inspects that exact archive without directory packing. Its file
inspection, size checks, SHA/integrity calculation, registry comparison, and
publication must all use the **final** archive. A successful ordinary `npm pack`
is insufficient.

The fixture below confirms that npm 11 and npm 12 send the final archive's exact
bytes through the publish protocol. It uses a loopback registry and fake local
credentials. It does not publish anything publicly. An eventual public release
must separately verify public package-name installation.

## Frozen dependencies and repeatability

Commit an npm lockfile for the emitted production dependency graph, with exact
versions, resolved archive URLs, and integrity values for every dependency. Use
a pinned npm version and `npm ci --ignore-scripts` to assemble packages. Do not
generate or update this lock during a release. A normal fresh install is not a
substitute: the earlier application probe selected `undici@7.29.1` while the
Deno lock selected 7.29.0.

The build must compare emitted direct dependencies with this lock and compare
shared runtime dependency versions with `deno.lock`. For JSR dependencies, map
`@scope/name` to the corresponding `@jsr/scope__name` package. Deno source
hashes and npm archive integrity hashes identify different artifacts; compare
versions across registries and validate each artifact against its own recorded
hash. Update both locks deliberately when the graph changes. Fail rather than
resolve new versions during packaging. Build tools and test-only dependencies
must stay outside the shipped production tree.

The final archive includes the build lock under `npm-dependencies.lock.json` for
provenance. This name deliberately differs from `package-lock.json`, which npm
excludes from packages. Preserve the original staging dependency map in that
lock; the final manifest's empty installer graph is not a replacement lock.
Package consumers receive the recorded tree. Updating one of its dependencies
requires rebuilding and releasing the CLI archive.

The fixture uses GNU tar with sorted names, timestamp zero, numeric owner/group
zero, normalized read/write modes that preserve executable files, and GNU
format. Mode normalization makes the archive independent of the builder's umask.
It runs two clean installs with separate caches and compares final archive
bytes. Production reproducibility must also account for dnt output, generated
source maps, and any other build output. Keep archives, caches, credentials,
tests, and previous outputs outside the explicit file allowlist. Inspect the
packed tree for the complete graph and licenses before publication. Do not
silently rely on ignored dependency lifecycle scripts.

## Reproduce the package-manager checks

On Linux with GNU tar, gzip, Node, and Bun on `PATH`, prepare the npm versions:

```bash
npm install --prefix /tmp/hj-packaging-npm11 --ignore-scripts --no-audit --no-fund npm@11.11.1
npm install --prefix /tmp/hj-packaging-npm12 --ignore-scripts --no-audit --no-fund npm@12.0.2
node scripts/check-npm-runtime-packaging.mjs \
  /tmp/hj-packaging-npm11/node_modules/npm/bin/npm-cli.js \
  /tmp/hj-packaging-npm12/node_modules/npm/bin/npm-cli.js
```

The runner uses the committed fixture lock to install real published JSR
packages. It writes evidence, logs, and archives to a new temporary directory
and prints the location. Each package-manager/source combination starts with a
separate cache and temporary directory, then reuses them for later invocations.
Each invocation has a separate home and empty npm configuration. Their `PATH`
contains Node, Bun, shell, and gzip, with no Deno executable. Bun's temporary
directory must also be isolated for a fresh installation: otherwise bunx can
reuse an earlier execution installation even with a fresh
`BUN_INSTALL_CACHE_DIR`.

The matrix covers local archive installation and simulated-registry package-name
installation for npx 11, npx 12, and `bunx --bun`. Each fresh installation runs
successfully, then an intentional application error reuses the same cache. The
fixture imports `@jsr/std__path`, exercises paths and file URLs, checks which
runtime executed it, and rejects a Deno global. The registry rejects every
request except the fixture's metadata and archive. Archive installs make no
registry requests. Named installs request only root metadata and the archive,
using metadata captured from the actual npm publish protocol. The fixture also
verifies two clean builds are identical and that npm 11/12 publish their exact
final bytes to the local registry.

This is an opt-in distribution regression because it requires external package
manager binaries and build-time network access. The native release integration
must run it in the distribution CI job, alongside installation checks of the
actual CLI. It does not replace the shared application suite, portable prompt
checks, or public registry smoke tests.

## Verified results

On 2026-09-12 the private package-tree fixture passed on Linux x64 with Node
26.2.0, npm 11.11.1 and 12.0.2, and Bun 1.4.2. All archive/name installations
start from fresh caches, then repeat execution with those caches. This catches
the npm pruning failure that the original fresh-only fixture missed. The
production native matrix additionally exercises Node 24, dynamic imports,
metadata, repository inspection, file writes, and external Deno tasks; see
[npm publication](npm-publication.md) for its command.
