# Releases

The release implementation is available locally. Generated release workflows
need a published `hj` package before they can run on GitHub. See
[planned work](planned.md) for distribution and live validation. This guide
replaces the previous release plan and owns release setup, operation, and design
constraints.

## Setup and workflow roles

A source PR contains developer commits and targets `main`. A release PR contains
the generated version and changelog changes. The release features use separate
workflows:

| Feature                         | Workflow file under `.github/workflows/` | Role                                       |
| ------------------------------- | ---------------------------------------- | ------------------------------------------ |
| `github-ci`                     | `hj-ci.yaml`                             | Run source checks and commit validation.   |
| `github-release-publish-tag`    | `hj-release-publish-tag.yaml`            | Prepare, apply, and recover a release tag. |
| `github-release-publish-jsr`    | `hj-release-publish-jsr.yaml`            | Publish the tagged package to JSR.         |
| `github-release-publish-github` | `hj-release-publish-github.yaml`         | Create the GitHub Release object.          |

The [feature guide](repository-features.md) describes selection and direct
dependencies. Tag publication requires a version provider, CI, compatible main
protection, and protected tags. The current version provider reads one Deno
configuration with an exact SemVer version. SemVer is a version format such as
`1.2.3`. The JSR publisher also requires a JSR package.

Tag publication requires rebase-only PR merges and zero mandatory approvals
across effective protection rules. It cannot coexist with `github-main-review`.
The repository must enable auto-merge and allow GitHub Actions to create pull
requests. That Actions setting also permits review approval, but these workflows
do not create review approvals. If the repository uses `CODEOWNERS`, include the
generated workflow files.

For JSR publication, connect the package to the GitHub repository and disable
its actor-membership requirement. The publisher uses OIDC, which gives the
workflow temporary identity credentials. The workflows use `GITHUB_TOKEN`
through environment variables and do not store checkout credentials. The prepare
job has read access, the apply job can write checks and PRs, and only the JSR
job requests OIDC. The GitHub Release job has repository write access.

## Normal release

A source merge starts the tag workflow on `main`. Preparation selects the
current `main`, validates source commits, and builds the candidate release tree.
A tree is the complete set of tracked file contents and modes. Preparation runs
the project's checks before it returns the release bundle. A bundle is validated
data that describes the exact release changes.

Application uses a fresh checkout and compares `main` with the selected commit.
It recreates the candidate tree and reserves `release-<version>` and its release
PR. It creates two in-progress synthetic checks on the release commit. These
checks use contexts `check` and `hj-release-commit-validation`.

After GitHub reports the release PR blocked by those checks, `hj` requests
rebase auto-merge for the exact PR head. It then completes the checks and waits
for the merge. It validates the rebased release commit, creates the tag, removes
the owned release branch, and sends `hj-release-publish-tag-success`. That event
starts the two publishers independently.

The tag is lightweight and has no prefix, for example `1.2.3`. The release
commit subject is `chore(release): <version>`. Each publisher compares the
remote tag, checkout, version, and existing published data before changes.
Correct existing objects can be reused. Conflicting objects stop the operation.

## Retry and recovery

The following commands apply to a configured remote repository after
publication. If a release PR merged without a correct tag or success event,
rerun the tag workflow with its version:

```bash
gh workflow run hj-release-publish-tag.yaml -f tag=1.2.3
```

If one publisher fails, rerun only that publisher:

```bash
gh workflow run hj-release-publish-jsr.yaml -f tag=1.2.3
gh workflow run hj-release-publish-github.yaml -f tag=1.2.3
```

Recovery requires exactly one matching release commit on `main`. It confirms the
release tree and the target of any existing tag. It removes a release branch
only when the branch head and PR ownership agree. It can repeat the success
event, so publishers must accept correct existing data. An interrupted write is
confirmed with a new read before another change.

If a source merge wins a race with the release PR, application disables its
exact auto-merge request. It removes the owned branch with an expected-head
guard and closes the owned PR. The next tag workflow prepares the new source
state. If the release merges first, update the source PR against the new `main`
and rerun its checks. Do not replace a conflicting tag or delete an unknown
release branch to force recovery.

## Remove release features

Disable the active publishers and tag publication in one feature operation. The
resolver orders publisher workflow removal before tag workflow removal. It
blocks removal while workflow runs, owned PRs, release branches, or untagged
releases remain active. Unavailable or ambiguous remote data also blocks
removal.

Merge the workflow removal into `main` before disabling `github-protected-tags`
in a separate operation. The second operation requires the remote tag workflow
to be absent and repeats the inactive-state checks. It removes only exact
generated tag rulesets. Removal keeps changelogs, version files, tags, releases,
and published packages.

## Migration and repair

`github-release-publish-jsr` replaces the legacy `jsr-release` feature. Enable
or repair migrates an exact `.github/workflows/hj-release.yaml` file. Custom
data blocks migration. Legacy template bytes remain fixed for recognition.
Current workflow templates use the version policy in the
[development guide](development.md#ci-and-toolchain-changes).

CI and protection repairs must preserve runnable required checks throughout
their operation order. Generated-file ownership alone does not permit replacing
unknown custom content. The feature checks and tests define supported partial
states and safe retry behavior. The protection preset retains an enabled
main-review feature but does not select it automatically.

## Design constraints

The following constraints guide implementation and review. Detailed response
schemas live beside their parsers and tests, rather than in a duplicate prose
schema. Local tests cover these decisions with real Git refs and injected GitHub
operations. The [live validation list](planned.md#validation-after-publication)
covers behavior that needs the remote services.

### Versions and candidate files

Every source commit in the selected range must use an accepted Conventional
Commit message. A breaking change selects major, `feat` selects minor, and other
accepted types select patch. Breaking changes below `1.0.0` also select major.
An empty commit range needs no release. The highest applicable release tag
supplies the previous version, with conflicts rejected. The first release uses
the version-file baseline when no applicable release tag exists.

The `fork-version` adapter uses the version locked in `deno.json`. It receives
the selected release type and does not make commits or tags. Only usual
preparation loads that dependency. The apply route and publishers do not import
it. The adapter's contract tests cover stable, prerelease, and build-metadata
versions.

Only the selected Deno version file and `CHANGELOG.md` can change in a candidate
release. Formatting must preserve previous changelog bytes. The new section is
inserted after the heading and preamble. The bundle carries old and new digests,
exact changed paths, insertion data, and the candidate tree digest. It does not
contain the final rebased commit SHA.

The wire format uses canonical minified JSON, base64url encoding, and a SHA-256
digest. Preparation limits all GitHub outputs together to the one-megabyte
UTF-16 size limit. There is no artifact fallback for an oversized bundle.
Application receives the bundle through environment variables, not interpolated
shell source. Before remote writes, application compares previous release
selection, local files, and the staged tree against the bundle.

### Ownership, checks, and time limits

A release PR body carries schema, selected SHA, version, branch head, and tree
digest. Reserved names are not proof of ownership. Application compares the
marker, head, parent, subject, and tree before it reuses or removes release
data. A final release commit must have the selected source commit as its only
parent. Its tree and release files must match the bundle.

The exact required contexts belong to GitHub Actions App `15368`. The main rules
require strict status checks, rebase-only PR merges, resolved review threads,
and zero approvals. They prevent main deletion and force-pushes. Effective
protection includes inherited rulesets and legacy branch protection. Unknown
conditions or rules block publication instead of being ignored.

Synthetic check IDs identify the schema, workflow run, attempt, context, bundle
digest, and release SHA. New checks start in progress before older owned checks
are neutralized. An auto-merge request must use `REBASE`, the expected head, and
`github-actions[bot]`. The code never performs a direct PR merge or merges after
a timeout.

Request confirmation polls every five seconds for up to one minute. The merge
wait polls every ten seconds within a 29-minute overall application deadline.
Workflow jobs have a 30-minute limit. Cleanup rereads ownership before disabling
auto-merge or canceling checks. A branch deletion uses an exact expected-head
guard. Cleanup errors remain errors, so uncertain cleanup does not look
successful.

### Events and publisher consistency

The success event contains schema `1`, version, tag, and release SHA. A
publisher validates every event field before process or API effects. Manual
publisher runs require an existing unprefixed SemVer tag. Both routes require
agreement between the remote tag, checkout, and version file.

JSR publication runs a dry run before publication. An existing version must
match local module digests and the expected GitHub provenance. Provenance is
evidence of the workflow that built the package. The comparison includes
repository, workflow, event route, and release commit. The publisher stops if
published data differs.

A GitHub Release uses the version title and the matching changelog section. It
is not a draft. Only prerelease identifiers set the prerelease flag. Build
metadata does not. The command accepts an existing release only when all
expected fields agree.

Tag preparation and application share one concurrency group for `main`. Each
publisher has a separate group for its tag, with active runs kept alive. The
implementation assumes token-triggered event behavior described by the generated
workflows. That assumption still needs the live checks listed in planned work.

## Command environment

Release commands are workflow adapters, not ordinary local release shortcuts.
Their generated workflows supply the required variables and narrowly scoped
permissions. The following table gives the route inputs. `GITHUB_OUTPUT` and
`GITHUB_STEP_SUMMARY` are optional output paths.

| Command or route                                | Inputs                                                                                                                                                     |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source validation through `publish-tag-prepare` | `HJ_RELEASE_ROUTE=source-validation`, `HJ_SOURCE_BASE_SHA`, `HJ_SOURCE_HEAD_SHA`                                                                           |
| Usual preparation                               | `HJ_RELEASE_ROUTE=usual`                                                                                                                                   |
| Recovery preparation                            | `HJ_RELEASE_ROUTE=recovery`, `HJ_RELEASE_TAG`                                                                                                              |
| Usual application                               | `HJ_RELEASE_ROUTE=usual`, `HJ_RELEASE_BUNDLE`, `HJ_RELEASE_BUNDLE_DIGEST`, `GITHUB_REPOSITORY`, `GITHUB_SERVER_URL`, `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT` |
| Recovery application                            | `HJ_RELEASE_ROUTE=recovery`, `HJ_RELEASE_BUNDLE`, `HJ_RELEASE_BUNDLE_DIGEST`, `GITHUB_REPOSITORY`                                                          |
| Publisher event                                 | `HJ_RELEASE_ROUTE=event`, `HJ_RELEASE_SCHEMA`, `HJ_RELEASE_VERSION`, `HJ_RELEASE_TAG`, `HJ_RELEASE_SHA`, `GITHUB_REPOSITORY`                               |
| Publisher manual run                            | `HJ_RELEASE_ROUTE=user`, `HJ_RELEASE_TAG`, `GITHUB_REPOSITORY`                                                                                             |

The template source is
[github-release-publish-artifacts.ts](../src/features/github-release-publish-artifacts.ts).
Command names and usage live in CLI help. Environment validation belongs in the
adapters and publisher input tests.
