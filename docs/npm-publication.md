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
in Git and keep all output inside that directory. The build must produce the
same archive when repeated for one release. It must not depend on timestamps or
unpinned downloaded tools.

This repository supplies a local example:

```bash
deno task npm-build
node .hj/npm/bin/hj.js --help
npm pack ./.hj/npm --ignore-scripts --pack-destination /tmp
```

The example packages the CLI source and a Node.js launcher. Users need Deno on
`PATH` because the launcher runs that source with full Deno permissions. It
preserves the caller's working directory. These commands build and inspect a
package without uploading it. The example does not enable npm publication for
`@hugojosefson/cli`.

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
the package supports it. Configure the GitHub owner, repository, and exact
workflow filename on npm. The generated workflow does not select a GitHub
environment. Leave the npm environment field empty. Trusted publishing requires
npm 11.5.1 or later and Node.js 22.14.0 or later.

For token authentication, add a publish-capable granular token as the repository
secret `NPM_TOKEN`. The workflow passes that secret to npm through
`NODE_AUTH_TOKEN` and the configuration from `actions/setup-node`. Keep tokens
out of configuration files and command arguments. A new package can require an
initial authenticated publication before you can configure its trusted
publisher. See the
[npm publication instructions](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/).

## First publication with a personal login

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
use `next`. The publisher waits up to one minute for confirmation after an
upload, including an uncertain upload result. Registry authentication failures
and unavailable metadata do not count as an absent version.

If confirmation fails, resolve the reported build or npm access problem and
retry the same tag:

```bash
gh workflow run hj-release-publish-npm.yaml \
  --repo owner/repository --ref 1.2.3 -f tag=1.2.3
```

A retry does not change an existing version or its npm distribution tag. Build
and authentication failures leave the release tag intact. The standalone command
is `hj release publish-npm`. It uses the same `HJ_RELEASE_*` input contract as
the other release publishers.
