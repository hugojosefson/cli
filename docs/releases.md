# Releases

This guide describes release setup, operation, and recovery. Generated workflows
use the exact `hj` version that generated them by default. That version must be
available on [JSR](https://jsr.io/@hugojosefson/cli). A pinned GitHub source can
start the first release before that registry version exists.

## Setup and workflow roles

A source PR contains developer commits. A release PR contains generated version
and changelog changes. Both target `main`.

| Feature                         | Workflow under `.github/workflows/` | Role                                       |
| ------------------------------- | ----------------------------------- | ------------------------------------------ |
| `github-ci`                     | `hj-ci.yaml`                        | Run source checks and commit validation.   |
| `github-release-publish-tag`    | `hj-release-publish-tag.yaml`       | Prepare, apply, and recover a release tag. |
| `github-release-publish-jsr`    | `hj-release-publish-jsr.yaml`       | Publish the tagged package to JSR.         |
| `github-release-publish-github` | `hj-release-publish-github.yaml`    | Create the GitHub Release.                 |

The [feature guide](repository-features.md) owns feature dependencies. SemVer is
a version format such as `1.2.3`.

| Setup requirement                       | Reason                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------ |
| One Deno version configuration          | Supply the exact SemVer release version.                                 |
| Generated CI                            | Validate source commits and project checks.                              |
| Compatible main protection              | Require the two release checks and rebase-only PR merges.                |
| Protected tags                          | Allow tag creation while blocking later changes.                         |
| Zero required approvals                 | Allow the generated release PR to merge unattended.                      |
| Auto-merge enabled                      | Let GitHub merge after the checks pass.                                  |
| Actions allowed to create PRs           | Permit the release workflow to create its PR.                            |
| No `github-main-review`                 | This review feature conflicts with unattended releases.                  |
| Workflow files in `CODEOWNERS`, if used | Cover the generated workflow files in the repository's ownership policy. |
| JSR package linked to GitHub            | Configure the link in the package settings.                              |
| JSR scope allows the release bot        | Use the [scope security configuration](#jsr-scope-security).             |

The Actions PR setting also permits review approval, but these workflows do not
create review approvals. OIDC gives the JSR workflow temporary identity
credentials. Credentials are not stored by checkout.

| Job                      | Access                               |
| ------------------------ | ------------------------------------ |
| Prepare                  | Read repository data.                |
| Apply                    | Write release refs, checks, and PRs. |
| JSR publisher            | Request OIDC credentials.            |
| GitHub Release publisher | Write repository release data.       |

Enable and push generated CI before enabling main protection. Protection needs
the required checks to exist in the remote workflow. On GitHub Free, use a
public repository for rulesets and auto-merge. Private repositories can need a
paid plan. The CLI reports this restriction when GitHub rejects setup.

For this package's first publication, follow the
[first-release plan](first-release.md). It uses these features and tracks the
bootstrap source needed before a JSR copy of `hj` exists.

## Bootstrap before the first registry version

Bootstrap means running the CLI before its package exists on JSR. Use
`--workflow-cli=github:owner/repository@<commit SHA>` with the workflow
features. Replace the placeholder with a full, 40-character commit SHA from the
public CLI repository. Branch names and tags are rejected because they can move.

```bash
hj repo features --github-ci --repair \
  --workflow-cli="github:hugojosefson/cli@${CLI_COMMIT}"
hj repo features --jsr --github-release-publish-github --repair \
  --workflow-cli="github:hugojosefson/cli@${CLI_COMMIT}"
```

The generated workflow loads that revision's CLI and import map from GitHub. Its
marker records the source. Detection, repair, and removal recognize the exact
generated variant. Running feature operations without the source option
preserves a recorded source. Custom changes still require repair or manual
resolution under the normal ownership rules.

After the CLI version exists on JSR, generate normal workflows with that version
of the CLI:

```bash
hj repo features --github-ci --jsr --github-release-publish-github \
  --repair --workflow-cli=jsr
```

The source option changes selected workflows and their selected dependencies. It
does not change README build tasks or fetch the source during generation. Before
merging generated workflows, make sure that the pinned source is public and
runnable. CI and release preparation still run the project checks.

## JSR scope security

A scope is a group of packages, such as `@hugojosefson`. The actor is the
account that starts a GitHub Actions run. The release bot starts JSR publication
after it creates the release tag.

In your scope settings, use this configuration:

| Setting                    | Value                      | Effect                                                                   |
| -------------------------- | -------------------------- | ------------------------------------------------------------------------ |
| GitHub Actions security    | Do not restrict publishing | Allow the release bot to start publication without JSR scope membership. |
| Require Publishing from CI | Enabled                    | Accept uploads only through GitHub Actions identity credentials.         |

These settings apply to every package in the scope. Publication still requires a
workflow in the GitHub repository linked to the package. The membership setting
does not give arbitrary GitHub users write access to that repository. See the
[JSR scope security documentation](https://jsr.io/docs/scopes#github-actions-publishing-security).

For this package, use the
[scope settings](https://jsr.io/@hugojosefson/~/settings). Select **Do not
restrict publishing** under **GitHub Actions security**. Keep **Require
Publishing from CI** enabled. `hj` generates the workflow but does not change
these account settings.

Once setup is complete, merging source into `main` starts the release pipeline.
The pipeline creates the release tag and starts both publishers automatically.
No extra publishing command or stored JSR token is required. Manual workflow
runs remain available for [retry and recovery](#retry-and-recovery).

If `main` advances before JSR publication starts, the workflow starts another
run at the release tag automatically. This keeps the signed publication record
tied to the released commit. Only this dispatch job receives permission to start
a workflow. The upload job receives permission to request identity credentials.

## Normal release

A tree is the complete set of tracked file contents and modes. A release bundle
is validated data describing the exact proposed changes.

| Phase                  | Work                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| Source merge           | Start the tag workflow on `main`.                                                                 |
| Prepare                | Select current `main`, validate source commits, build the candidate tree, and run project checks. |
| Reserve                | Recreate the tree in a fresh checkout and reserve `release-<version>` with its PR.                |
| Block                  | Create in-progress `check` and `hj-release-commit-validation` checks on the exact PR head.        |
| Request merge          | Wait for the blocked state, then enable rebase auto-merge for that head.                          |
| Complete checks        | Mark both synthetic checks successful and wait for GitHub to merge.                               |
| Validate merge         | Confirm the rebased commit's parent, tree, and release files.                                     |
| Publish tag            | Create the lightweight tag and remove the owned release branch.                                   |
| Publish GitHub Release | Send `hj-release-publish-tag-success` to start the GitHub Release publisher.                      |
| Publish JSR package    | The same success event starts the JSR publisher automatically.                                    |

Preparation runs package checks on uncommitted candidate files. The generated
`publish-check` task uses `--dry-run --allow-dirty --check=all`. It uploads
nothing. The real publisher still requires the exact tagged source.

The release commit uses the standard `github-actions[bot]` Git identity. The
workflow does not need a runner's global Git identity.

The release commit subject is `chore(release): <version>`. Publishers compare
remote state with the checkout before writing. Matching existing objects can be
reused. Conflicting objects stop the operation.

## Tag policy

| Property                | Rule                                                               |
| ----------------------- | ------------------------------------------------------------------ |
| Tag format              | Lightweight, unprefixed SemVer, such as `1.2.3`.                   |
| GitHub creation pattern | `[0-9]*.[0-9]*.[0-9]*`                                             |
| Workflow token          | Can create matching tags; cannot update or delete them.            |
| Other tag names         | Require an administrator bypass for creation, update, or deletion. |
| Administrator           | Retains a tag-rule bypass.                                         |
| Exact SemVer validation | Enforced by `hj`, not by the GitHub wildcard.                      |

The wildcard is broader than SemVer. A direct GitHub API request can create
`01.2.3`, but `hj` rejects it. The managed rules need no Enterprise-only
tag-name restrictions.

## Retry and recovery

Use [GitHub CLI](https://cli.github.com/) with a configured remote repository.
Rerun only the route that needs recovery:

| Problem                                                    | Command                                                                |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| Release PR merged, but its tag or success event is missing | `gh workflow run hj-release-publish-tag.yaml -f tag=1.2.3`             |
| JSR publisher failed                                       | `gh workflow run hj-release-publish-jsr.yaml --ref 1.2.3 -f tag=1.2.3` |
| GitHub Release publisher failed                            | `gh workflow run hj-release-publish-github.yaml -f tag=1.2.3`          |

Recovery requires exactly one matching release commit on `main`. It verifies the
tree and any existing tag. Branch removal requires matching head and PR
ownership. Lost write responses are resolved by reading the remote state again.
The success event can repeat, so publishers must accept matching existing data.

| Merge order          | Recovery behavior                                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source merges first  | Disable the exact auto-merge request, remove the owned branch with an expected-head guard, and close the PR. Prepare again from the new source state. |
| Release merges first | Update the source PR against the new `main` and rerun its checks.                                                                                     |

Deleting a tag can turn its GitHub Release into a draft. Restoring the tag does
not restore the release's published state. The publisher rejects that draft
instead of creating a duplicate. Review and restore the intended release in
GitHub, then retry publication.

The publisher lists all releases because GitHub's
[tag lookup excludes drafts](https://docs.github.com/en/rest/releases/releases#get-a-release-by-tag-name).
Multiple releases with the same tag also block publication.

Do not overwrite a conflicting tag or delete an unknown release branch to force
recovery.

JSR retries select the release tag with `--ref`, so Deno records the correct
source commit in the publication provenance. A workflow on another commit can
verify an existing package, but it cannot create a new package version.

Deno rewrites import paths before uploading modules. The publisher binds the
registry manifest digest to its provenance and requires a clean tagged checkout.
It also compares unchanged file types with their local bytes. Publication from
an unexpected workflow, repository, or source commit fails verification.

## Remove release features

| Step | Action                                                                                                         |
| ---- | -------------------------------------------------------------------------------------------------------------- |
| 1    | Disable active publishers and tag publication in one feature operation. Publisher workflows are removed first. |
| 2    | Merge the workflow removal into `main`.                                                                        |
| 3    | Disable `github-protected-tags` in a separate operation.                                                       |

Removal is blocked by active workflow runs, owned PRs, release branches, or
untagged releases. Unavailable or ambiguous remote data also blocks removal. The
final step requires the remote tag workflow to be absent and repeats the
inactive-state checks.

Removal deletes only exact generated rulesets and workflow files. It preserves
published packages, releases, tags, changelogs, and version files.

## Migration and repair

To update a generated JSR workflow that requires manual publication, run
`hj repo features --repair --github-release-publish-jsr`. Review the generated
commit and merge it through the normal source process. The repaired workflow
starts publication automatically after tag creation.

`github-release-publish-jsr` replaces the legacy `jsr-release` feature. Enable
or repair can migrate the exact `.github/workflows/hj-release.yaml` template.
Custom content blocks migration. Legacy template bytes stay fixed for
recognition.

| Constraint               | Required behavior                                                                 |
| ------------------------ | --------------------------------------------------------------------------------- |
| CI and protection repair | Keep required checks runnable throughout the operation order.                     |
| Unknown custom content   | Preserve it rather than claim ownership.                                          |
| Partial state            | Use the states and retries supported by feature checks and tests.                 |
| Protection preset        | Retain an enabled review feature without selecting it automatically.              |
| New template versions    | Follow the [development version policy](development.md#ci-and-toolchain-changes). |

## Design constraints

Response schemas live beside their parsers and tests. The tables below record
behavior rather than duplicate those schemas. Local tests use real Git refs and
injected GitHub responses. The [live validation record](live-validation.md)
describes the remote checks and their limits.

### Versions and candidate files

| Input                                    | Selected release                               |
| ---------------------------------------- | ---------------------------------------------- |
| Breaking change                          | Major, including below `1.0.0`.                |
| `feat`                                   | Minor, unless a breaking change selects major. |
| Other accepted Conventional Commit types | Patch.                                         |
| Empty commit range                       | No release.                                    |
| Invalid source commit message            | Stop preparation.                              |

The highest applicable release tag supplies the previous version. Conflicting
tags are rejected. Without a previous tag, use the version-file baseline. Only
usual preparation loads `fork-version`; it receives the selected release type
and makes no commits or tags.

| Candidate constraint | Required behavior                                                                   |
| -------------------- | ----------------------------------------------------------------------------------- |
| Changed files        | Only the selected Deno version file and `CHANGELOG.md`.                             |
| Changelog            | Preserve prior bytes; insert the new section after the heading and preamble.        |
| Bundle               | Carry digests, changed paths, insertion data, and candidate tree digest.            |
| Final commit SHA     | Excluded from the bundle because rebase has not occurred.                           |
| Encoding             | Canonical minified JSON, encoded as base64url with a SHA-256 digest.                |
| Output size          | Keep all GitHub outputs within the one-megabyte UTF-16 limit; no artifact fallback. |
| Application input    | Pass the bundle through environment variables, never interpolated shell source.     |
| Before writes        | Compare prior release selection, local files, and staged tree with the bundle.      |

### Ownership, checks, and time limits

Reserved names do not prove ownership. The PR marker and observed Git data must
agree before release data is reused or removed.

| Ownership data           | Check                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| PR marker                | Schema, selected SHA, version, branch head, and tree digest.                                                    |
| Candidate commit         | Head, parent, subject, and tree match the prepared data.                                                        |
| Rebased commit           | Selected source commit is its only parent; tree and release files match the bundle.                             |
| Required checks          | Only the two managed contexts, from GitHub Actions App `15368`.                                                 |
| Main rules               | Strict checks, rebase-only PRs, resolved review threads, zero approvals, and no deletion or force-push.         |
| Effective protection     | Include inherited rulesets and legacy branch protection; unknown rules block publication.                       |
| Synthetic check identity | Schema, run, attempt, context, bundle digest, and release SHA.                                                  |
| Check details URL        | The exact workflow URL or GitHub's canonical URL for that check ID in the same repository.                      |
| Check replacement        | Start new checks before neutralizing old owned checks.                                                          |
| Auto-merge owner         | GraphQL `Bot` named `github-actions`, using `REBASE` and the expected head.                                     |
| Cleanup                  | Recheck ownership before disabling auto-merge or canceling checks; delete branches with an expected-head guard. |

| Wait                 | Interval       | Limit                                  |
| -------------------- | -------------- | -------------------------------------- |
| Request confirmation | 5 seconds      | 1 minute                               |
| Merge                | 10 seconds     | 29-minute overall application deadline |
| Workflow job         | Not applicable | 30 minutes                             |

The code never directly merges a PR or merges after timeout. Uncertain cleanup
remains an error.

### Events and publisher consistency

| Publisher input | Validation                                                                  |
| --------------- | --------------------------------------------------------------------------- |
| Success event   | Validate schema `1`, version, tag, and release SHA before external effects. |
| Manual run      | Require an existing unprefixed SemVer tag.                                  |
| Either route    | Remote tag, checkout, and version file must agree.                          |

| Publisher      | Existing data must match                                                             |
| -------------- | ------------------------------------------------------------------------------------ |
| JSR            | Local module digests and expected GitHub provenance.                                 |
| GitHub Release | Version title, matching changelog section, draft=false, and correct prerelease flag. |

Provenance identifies the workflow that built the package. JSR comparison checks
the repository, workflow, event route, and release commit. Publication runs a
dry run first. Any difference in published data stops the operation. Only
prerelease identifiers set the GitHub prerelease flag; build metadata does not.

Tag preparation and application share one concurrency group for `main`. Each
publisher has a separate group per tag, with active runs kept alive.

## Command environment

These commands are workflow adapters. Generated workflows supply their inputs
and permissions. `GITHUB_OUTPUT` and `GITHUB_STEP_SUMMARY` are optional paths.

| Route                                           | `HJ_RELEASE_ROUTE`  |
| ----------------------------------------------- | ------------------- |
| Source validation through `publish-tag-prepare` | `source-validation` |
| Normal preparation or application               | `usual`             |
| Recovery preparation or application             | `recovery`          |
| Publisher success event                         | `event`             |
| Manual publisher                                | `user`              |

| Variable                   | Used by                                           |
| -------------------------- | ------------------------------------------------- |
| `HJ_SOURCE_BASE_SHA`       | Source validation                                 |
| `HJ_SOURCE_HEAD_SHA`       | Source validation                                 |
| `HJ_RELEASE_TAG`           | Recovery preparation and both publisher routes    |
| `HJ_RELEASE_BUNDLE`        | Both application routes                           |
| `HJ_RELEASE_BUNDLE_DIGEST` | Both application routes                           |
| `GITHUB_REPOSITORY`        | Both application routes and both publisher routes |
| `GITHUB_SERVER_URL`        | Usual application                                 |
| `GITHUB_RUN_ID`            | Usual application                                 |
| `GITHUB_RUN_ATTEMPT`       | Usual application                                 |
| `HJ_RELEASE_SCHEMA`        | Publisher event                                   |
| `HJ_RELEASE_VERSION`       | Publisher event                                   |
| `HJ_RELEASE_SHA`           | Publisher event                                   |

The [template source](../src/features/github-release-publish-artifacts.ts)
provides the exact commands. CLI help owns command usage. Input validation and
its tests belong to the workflow adapters.
