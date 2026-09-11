# First public release

Use implemented `hj` features for every operation they support. Use external
tools only for prerequisites and source changes that `hj` does not manage. The
CLI repository and package remain unpublished. This plan does not authorize
publication.

## First-release prerequisite

The standard release features are implemented, but they cannot yet publish this
CLI's first version without a separate bootstrap mechanism. A bootstrap
mechanism starts publication before a registry copy of `hj` exists.

Generated CI and release workflows load the exact `hj` version from JSR. The CLI
cannot upload that version through workflows that first need to download it. The
scratchpad tests used an edited local copy and temporary runners. That fixture
is test infrastructure, not an implemented feature.

Complete the [planned bootstrap support](planned.md#first-release-bootstrap)
before running the publication stages below. Keep version preparation and both
publishers in the implemented release pipeline. Do not replace them with a
manual tag, direct package upload, or a hand-written release workflow.

The package metadata currently contains `0.1.0`, with draft release notes. This
value is a baseline, not a reserved first tag. Tag preparation calculates the
next version from that baseline and the source commits. Review that selection
before publication. The implementation has no first-version override flag.

## Prepare locally

Use the checkout's existing tasks until registry installation is available:

| Step | Command or action                                                                       | Required result                                                    |
| ---- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1    | `deno task hj repo features`                                                            | Inspect the current feature states.                                |
| 2    | Inspect `jsr-package` and the declared local features.                                  | Package metadata, exports, license, and project tasks are enabled. |
| 3    | Apply missing features through `deno task hj repo features` and their documented flags. | Use the feature guide for selection and repair.                    |
| 4    | Review the README and draft release notes.                                              | Describe the supported behavior and known limits.                  |
| 5    | `deno task ci`                                                                          | Linux checks, coverage limits, and the package dry run pass.       |
| 6    | `git status --short`                                                                    | The reviewed changes are committed on clean `main`.                |

The [feature guide](repository-features.md) owns the feature definitions. The
[development guide](development.md) owns local task behavior and history rules.
Keep source changes in ordinary commits and merge by rebase and fast-forward.
Let feature operations create their own commits for managed files.

## External prerequisites

Complete these steps only after the owner authorizes repository and package
publication. Each step lacks an implemented `hj` operation:

| Prerequisite                       | Existing tool or interface                                  | Why it is outside `hj`                                                                               |
| ---------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| GitHub authentication              | [GitHub CLI](https://cli.github.com/), with `gh auth login` | `hj` uses an existing login.                                                                         |
| Repository creation                | GitHub CLI repository creation                              | `github-repo` manages an existing linked repository. Creation is planned.                            |
| Remote connection and initial push | [Git](https://git-scm.com/)                                 | `git` initializes and commits selected files. It does not connect or publish a remote.               |
| Actions PR permission              | GitHub repository Settings > Actions > General              | `github-ci` checks this permission but does not enable it.                                           |
| JSR scope and package access       | [JSR](https://jsr.io/)                                      | `jsr-package` configures local files. It does not create registry accounts or packages.              |
| JSR repository link                | JSR package settings                                        | The publisher requires the link but does not manage it.                                              |
| JSR publication security           | JSR scope settings                                          | Require CI publication and permit the release bot to start the workflow.                             |
| Source PRs and pushes              | Git and GitHub CLI                                          | Feature operations commit local files. They do not submit ordinary source PRs or push those commits. |

For Actions, enable “Allow GitHub Actions to create and approve pull requests”.
For JSR, link the package in its package settings. Then follow the
[scope security instructions](releases.md#jsr-scope-security) for automatic
publication. The owner confirmed that this package is linked to
`hugojosefson/cli`, with CI publication required and **Do not restrict
publishing** selected. The public GitHub repository exists and remains empty.
Publishing the CLI source or package still requires authorization.

## Configure GitHub through features

After authorization and external setup, run these commands from the checkout.
Finish the bootstrap prerequisite before pushing managed workflows that load
`hj`. Resolve blocked or ambiguous states before the next stage.

### Repository settings

Use the implemented preset, with explicit publication overrides:

```bash
deno task hj repo features \
  --github \
  --github-public \
  --no-github-squash-merge
```

The `github` preset enables auto-merge and rebase merging. It disables merge
commits and enables deletion of merged branches. The overrides select public
visibility and disable squash merging.

### CI before protection

Generate CI through its feature:

```bash
deno task hj repo features --github-ci
```

Make sure that its workflows exist on remote `main` before enabling protection.
The managed `check` job runs `deno task all`. In a normal source change, make
`all` depend on the existing `ci` task. This reuses the coverage checks without
copying their definition.

The existing `.github/workflows/ci.yaml` is custom source. The feature preserves
it. Remove that file in a normal source change only after managed CI covers its
checks. This avoids duplicate runs without losing coverage.

### Protection

Use the protection preset and keep mandatory reviews disabled:

```bash
deno task hj repo features \
  --github-protection \
  --no-github-main-review
```

The preset manages both main and tag protection. Do not create equivalent
rulesets by hand. The [tag policy](releases.md#tag-policy) supports personal
repositories and enforces exact SemVer in the CLI.

## Publish through release features

After the bootstrap prerequisite is complete, use the JSR preset and the GitHub
Release feature together:

```bash
deno task hj repo features \
  --jsr \
  --github-release-publish-github
```

Complete the remaining JSR checks in an authorized scratchpad package before
enabling unattended publication here. Then merge the generated workflows into
`main` through the source review process. The main push starts tag preparation.
The tag workflow starts both publishers after it creates the tag. Subsequent
source merges require no separate JSR publishing command.

| Release work                               | Implemented owner                        |
| ------------------------------------------ | ---------------------------------------- |
| Version selection and changelog            | `github-release-publish-tag` preparation |
| Release commit and PR                      | `github-release-publish-tag` application |
| Rebase merge and lightweight tag           | `github-release-publish-tag` application |
| Release branch cleanup and publisher event | `github-release-publish-tag` application |
| Package upload and registry verification   | `github-release-publish-jsr`             |
| GitHub Release creation and repeat checks  | `github-release-publish-github`          |

Use the generated workflows for these operations. The `hj release` commands are
workflow adapters, not standalone replacements with invented environment values.
Use the [documented retry routes](releases.md#retry-and-recovery) after an
interrupted run.

## Confirm publication

Use the version produced by tag preparation. Do not assume that it is `0.1.0`.
Set `RELEASE_VERSION` to that exact version before this Linux installation
check:

```bash
deno install --global --allow-all --name hj \
  "jsr:@hugojosefson/cli@${RELEASE_VERSION}"
```

Add the binary directory printed by Deno to `PATH`. Then run:

```bash
hj --help
mkdir hj-install-check
cd hj-install-check
hj repo features --deno-fmt --yes
hj repo features
hj repo features --deno-fmt --yes
```

The formatting feature must be enabled, and the repeated operation must report
no changes. The [remaining validation](planned.md#remaining-live-validation)
tracks registry loading and publisher checks. Use the same implemented release
features for subsequent versions.
