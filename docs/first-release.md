# First public release

Version `0.1.0` is prepared locally. The CLI repository and package remain
unpublished. This procedure describes future publication after authorization.
The [development guide](development.md#first-public-release) records the current
preparation state.

## Before publication

| Check            | Required result                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------ |
| Authorization    | The owner authorizes publication of both the repository and the package.                   |
| Working tree     | `git status --short` is empty on `main`.                                                   |
| History          | Changes reach `main` through rebase and fast-forward, with no merge commits.               |
| Version          | `deno.json` contains the intended release version.                                         |
| Release notes    | `CHANGELOG.md` describes that version and its known limits.                                |
| Validation       | `deno task ci` passes on Linux.                                                            |
| JSR access       | The owner can publish `@hugojosefson/cli`.                                                 |
| Package contents | The dry run includes the runtime files, toolchain, license, README, changelog, and guides. |

The [JSR publication guide](https://jsr.io/docs/publishing-packages) describes
account access and package linking. A local dry run does not prove account
access or registry provenance, which records a package's build origin.

## Publish the first version

The first upload uses Deno directly. Generated `hj` workflows depend on a
published `hj` version, so they cannot publish that same version for the first
time.

| Step | Action                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------- |
| 1    | Create the public GitHub repository and push the reviewed `main` history.                         |
| 2    | Create or select the JSR package and link it to that GitHub repository.                           |
| 3    | Remove the unpublished notice from the release notes and commit the final release state.          |
| 4    | Run `deno task ci` again from the clean release commit.                                           |
| 5    | Create the lightweight tag with `git tag 0.1.0` and push the commit and tag.                      |
| 6    | Run `deno publish --frozen --check=all` from the tagged checkout. Approve the upload through JSR. |
| 7    | Confirm that JSR serves the expected package version and files.                                   |
| 8    | Install from JSR in clean Linux and run the checks below.                                         |
| 9    | Create the GitHub Release for the existing tag, using the release notes.                          |

If the version changes, update the tag and installation examples together. Do
not overwrite a published version or move a release tag. A local first upload
does not test the generated workflow's OIDC credentials, which are temporary
identity credentials issued by GitHub.

## Test registry installation

Run these commands in a clean Linux environment with Deno installed:

```bash
deno install --global --allow-all --name hj jsr:@hugojosefson/cli@0.1.0
```

Add the binary directory printed by Deno to `PATH`. Then run:

```bash
hj --help
mkdir hj-install-check
cd hj-install-check
hj repo features --deno-fmt --yes
hj repo features
```

Make sure that the formatting feature is enabled in this new directory. Repeat
the feature command and make sure that it reports no changes.

## Enable later releases

Use the released CLI for workflow generation. The
[release guide](releases.md#setup-and-workflow-roles) owns the release
requirements. Complete the remaining registry tests in a separately authorized
scratchpad package before enabling unattended JSR publication here.

| Step | Action                                                                                                |
| ---- | ----------------------------------------------------------------------------------------------------- |
| 1    | Allow GitHub Actions to create pull requests in the repository configuration.                         |
| 2    | Enable `github-ci` with the released CLI, then merge and push its generated workflows.                |
| 3    | Enable auto-merge and rebase merging. Disable merge commits and squash merging.                       |
| 4    | Enable compatible main protection and protected tags. Keep required approvals at zero.                |
| 5    | Enable tag publication and the selected publishers. Merge their generated workflows.                  |
| 6    | Link the JSR package to GitHub and configure its actor requirement as described in the release guide. |
| 7    | Merge a source PR and inspect its release, package contents, and provenance.                          |

The bootstrap CI file is `.github/workflows/ci.yaml`. When managed `hj-ci.yaml`
replaces it, remove the bootstrap file in the same change to avoid duplicate CI
runs. Keep release configuration in the managed workflows.
