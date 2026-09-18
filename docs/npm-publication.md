# npm publication

The `github-release-publish-npm` feature adds a separate npm workflow. It
listens for `hj-release-publish-tag-success`, the same event as the GitHub
Release publisher. It also accepts an existing release tag through
`workflow_dispatch`. The tag publisher does not build npm packages or receive
npm credentials.

## Define the build

Add an `npm-build` task to the Deno configuration before you enable the
workflow. The task must create `.hj/npm/package.json` and its declared `bin` or
`main` files. Use a Node-compatible build tool for your package. Deno source
does not automatically become compatible with Node.js.

The package must meet these requirements:

- Match the scoped `name` and `version` in the release Deno configuration.
- Set `gitHead` to `HJ_RELEASE_SHA`, which the publisher passes to the build
  task.
- Include every declared `bin` and `main` entry in the packed archive.
- Use regular files under `.hj/npm` for the manifest and entry points.
- Target the public npm registry and permit public access.

The publisher also passes `HJ_RELEASE_VERSION` and `HJ_RELEASE_REPOSITORY` to
the task. Do not change tracked source files during the build. Ignore `.hj/npm/`
in Git and keep publishable output inside that directory. Ignore separate build
tool and packing directories too, if the build uses them. The build must produce
the same archive when repeated for one release. It must not depend on timestamps
or unpinned downloaded tools.

This repository builds a native ESM CLI for Linux x64 with glibc:

```bash
deno task npm-build
node .hj/npm/esm/hj.js --help
bun .hj/npm/esm/hj.js --help
```

The build requires Deno, Node.js 24 or later, npm, GNU tar, and gzip. It uses
separate frozen locks for dnt 0.43.2, npm 11.11.1 and Node type definitions, and
the complete production dependency graph. The host npm bootstraps the locked
build tools; the pinned npm performs dependency installation and packing.
Production dependencies must agree with `deno.lock`. Build-only type definitions
and npm itself stay outside the package. Builds use fresh staging directories
and a fresh cache, disable dependency install scripts, and never update locks.

The generated `.hj/npm/package.json` declares the final archive through
`hjNpmArchive`, for example `hugojosefson-cli-0.8.3.tgz`. Its declared binary is
`esm/hj.js`. Plain `hj` prefers a supported Node runtime on `PATH`, then falls
back to supported Bun. Explicit `node`, `bun`, and `bunx --bun` choices keep
that runtime. The launcher reports an actionable error if no supported runtime
is available. It does not download a runtime or start Deno.

The archive includes dependency packages and licenses under `esm/node_modules`,
including JSR packages, so consumers need no JSR registry configuration.
Ordinary commands execute in Node or Bun. Commands that perform Deno project
tasks use an external Deno executable. The caller's working directory and
arguments are preserved. These build commands do not enable or perform npm
publication.

Do not run `npm pack .hj/npm` on the finalized output. The
[native archive contract](npm-runtime-packaging.md) explains the required
manifest normalization. The publisher recognizes `hjNpmArchive`, rejects unsafe
or symlinked paths, checks the archived manifest against the staged manifest,
and inspects the exact archive with
`npm pack --dry-run --json --ignore-scripts`. The archive's name, version,
gitHead, and entry points must match the release. It publishes those exact
bytes, preserving integrity checks and retry behavior. Builds without
`hjNpmArchive` retain the original directory-packing contract.

Inspect `.hj/npm/artifact.json` for the final archive's integrity and file list.
For release verification, create two clean builds without changing source or
`HJ_RELEASE_SHA`, copy each generated archive outside the build tree, and run:

```bash
node scripts/check-npm-runtime-packaging.mjs --native \
  /tmp/native-build-a.tgz /tmp/native-build-b.tgz \
  /path/to/npm11/bin/npm-cli.js /path/to/npm12/bin/npm-cli.js
```

Repeat with Node 24 and Node 26. The shared package-manager harness compares
archive bytes, captures real npm publication metadata on a loopback-only
registry, and verifies clean npx/npm 11/12 and bunx archive/name installations.
It verifies repeated execution from the same cache as well as fresh
installation. It exercises help, error propagation, project metadata from a
directory with spaces, repository inspection without Deno, README output,
EditorConfig writes, and an external installed-Deno project task. No public
registry writes occur. The full shared application suite and public package
installation remain separate release checks.

For native archives, the harness also installs globally with npm 11, npm 12, and
Bun. It runs plain `hj` with only the installer's runtime on `PATH`, repeats the
installation to check the upgrade command, and removes the installation. It
checks explicit Node and Bun execution, Node preference when both are available,
fallback from an unsuitable Node version, and errors when no runtime meets the
requirements. Bun's explicit package execution must not start Node. The shared
launcher tests separately check version boundaries, arguments, working
directories, symlinks, process IDs, exit codes, and signals in every supported
test runtime.

## Configure publication

Enable the feature after you test the build:

```bash
hj repo features --github-release-publish-npm --yes
```

The workflow file is `.github/workflows/hj-release-publish-npm.yaml`. It uses
Node.js 24 and npm 11.11.1. It grants read access to repository contents and
requests an OIDC identity. OIDC is a short-lived identity issued by the workflow
runner.

Use an [npm trusted publisher](https://docs.npmjs.com/trusted-publishers/) when
the package supports it. The npm package and workflow file must exist first.
Configure the GitHub owner, repository, and exact workflow filename on npm. The
generated workflow does not select a GitHub environment. Leave that field empty.
Trusted publication requires npm 11.5.1 or later and Node.js 22.14.0 or later.

The [npm trust command](https://docs.npmjs.com/cli/v11/commands/npm-trust/)
configures publication from a terminal. It requires npm 11.15.0 or later,
package write access, and account two-factor authentication. Two-factor
authentication requires a separate proof of your identity.

```bash
npm trust github @owner/package --repo=owner/repository \
  --file=hj-release-publish-npm.yaml --allow-publish
npm trust list @owner/package
```

Replace the package and repository names with your own. Enter only the workflow
filename, without `.github/workflows/`. Complete npm's browser authentication
when requested. Make sure that the saved relationship names the intended
repository and workflow. Preserve unrelated existing relationships.

If a release starts before authentication is ready, retry its exact tag after
configuration. A successful retry of an existing version proves its archive
matches. A new upload from GitHub Actions proves that trusted publication works.

For token authentication, add a publish-capable granular token as the repository
secret `NPM_TOKEN`. The workflow passes that secret to npm through
`NODE_AUTH_TOKEN` and the configuration from `actions/setup-node`. Keep tokens
out of configuration files and command arguments. A new package can require an
initial authenticated publication before you can configure its trusted
publisher. See the
[npm publication instructions](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/).

## First publication with a personal login

Use a clean checkout of the exact lightweight remote release tag. Let the
project's release process choose its version before publication. Make sure that
the release contains the native build and its completed runtime tests.

Run the guarded publisher from that checkout:

```bash
HJ_RELEASE_ROUTE=user HJ_RELEASE_TAG=1.2.3 \
  GITHUB_REPOSITORY=owner/repository hj release publish-npm
```

Replace the tag and repository with the intended release. The publisher checks
the remote tag, checkout, package metadata, and archive before an upload. It
creates the archive through the release's `npm-build` task.

Use a CLI version that supports the `hjNpmArchive` contract described above. A
checkout does not change the installed `hj` version. When publishing this CLI
repository, replace `hj` in the command with `deno task hj` to use the
checkout's publisher.

A personal npm login can require a separate browser approval for publication.
The automated publisher does not prompt for that approval. If npm requires it,
publish the archive from the failed attempt in a terminal:

```bash
npm publish .hj/npm/<package-archive>.tgz --ignore-scripts \
  --access=public --registry=https://registry.npmjs.org/ --tag=next
```

Replace `<package-archive>` with the archive created by the publisher. Use
`next` for a prerelease and `latest` for a stable release. Approve npm's browser
request, then rerun `hj release publish-npm` with the same release environment.
The rerun compares the published archive with the release build. Keep tokens and
one-time passwords out of command arguments and chat messages.

## Retry a release

The publisher requires a clean checkout at the exact lightweight remote tag. It
builds and packs once, then compares the registry version with the local
archive. An existing version must match the package name, version, release SHA,
and SHA-512 archive integrity. SHA-512 integrity identifies the archive bytes. A
mismatch stops publication because npm versions cannot be overwritten.

For a missing version, the publisher uploads the packed archive once. It
disables npm lifecycle scripts during packing and publication because
`npm-build` owns the build. Stable versions use `latest`; prerelease versions
use `next`. After npm reports success, confirmation uses a ten-minute polling
period. An active registry lookup can finish after this period. Each npm lookup
has a 15-second timeout.

A registry delay can be more than five minutes. Other upload results keep the
one-minute polling period. Each publication command uploads at most one time.
Registry authentication failures and unavailable metadata do not count as a
missing version.

If confirmation fails, the publisher reports the process exit code and any known
npm error code. It does not print captured output or unknown error codes. A
missing process result means that the command did not return its status. Examine
the reported error, then retry the same tag:

```bash
gh workflow run hj-release-publish-npm.yaml \
  --repo owner/repository --ref 1.2.3 -f tag=1.2.3
```

A retry does not change an existing version or its npm distribution tag. Build
and authentication failures leave the release tag intact. The standalone command
is `hj release publish-npm`. It uses the same `HJ_RELEASE_*` input contract as
the other release publishers.
