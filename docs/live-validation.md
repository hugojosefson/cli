# Live GitHub validation

These records cover disposable GitHub repositories owned by `hugojosefson`. Each
section identifies its CLI source and whether it uploads a package. Early runs
preceded source publication. Later runs use the public CLI repository.

## Results on 2026-09-11

[The checks run](https://github.com/hugojosefson/scratchpad/actions/runs/34634456766)
created [PR 35](https://github.com/hugojosefson/scratchpad/pull/35) with the
workflow token.

| Check                | Observed result                                                                         |
| -------------------- | --------------------------------------------------------------------------------------- |
| In-progress checks   | Both GitHub Actions App `15368` checks blocked the PR.                                  |
| Auto-merge           | The bot enabled `REBASE` for the exact head.                                            |
| Completed checks     | Both succeeded; GitHub merged without a person approving the PR or workflow.            |
| Rebased commit       | Candidate tree preserved; original main commit was its only parent.                     |
| Token-triggered push | The main update did not start the push probe.                                           |
| PR workflow          | Initially `action_required`; no jobs ran, but the synthetic checks still allowed merge. |

The PR workflow state matches GitHub's
[bot-created workflow approval policy](https://github.blog/changelog/2026-06-11-bot-created-pull-requests-can-run-workflows-if-approved/).
Do not treat every temporary `UNSTABLE` merge state as a terminal failure.

The first run exposed a response mismatch: GraphQL returns the actor login
`github-actions`, not the REST login `github-actions[bot]`. The adapter now
requests the actor type and requires `Bot` for auto-merge ownership. Regression
tests cover another bot, a user with the same login, and missing actor data.

Local tag setup exposed two other issues. Tag-name metadata restrictions are
[Enterprise-only](https://github.com/github/docs/blob/main/data/features/repo-rules-enterprise.yml),
so the managed rules now use the version-shaped wildcard described in the
[release guide](releases.md#tag-policy). Also, rulesets can set a branch's
`protected` field even when legacy branch protection is absent. The adapter now
accepts the exact `404` response `Branch not protected` for that legacy layer;
it still rejects generic not-found and permission errors.

[The tag run](https://github.com/hugojosefson/scratchpad/actions/runs/34635181992)
confirmed that the workflow token can create a version-shaped tag but cannot
update or delete it. Nonrelease tag creation failed, and a fresh read confirmed
that no ref existed. A leading-zero version-shaped tag could be created, as
expected under the CLI validation policy. The local adapter independently
reported the complete release protection configuration as compatible.

After validation, all temporary tags and branches were removed. Scratchpad's
original tracked files, rulesets, and workflow states were restored. The test
commits and run logs remain as evidence; the CLI repository remains unpublished.

## Repeat the checks

The fixtures live in [scripts/live-github](../scripts/live-github). They
explicitly reject any repository other than `hugojosefson/scratchpad`. They
create temporary PRs, branches, commits, and tags. Run them only when changes to
that scratchpad are authorized. Keep them outside normal CI.

1. Save the scratchpad refs, repository settings, workflow states, and full
   ruleset definitions. A Git bundle does not save GitHub settings.
2. Disable package-publishing and unrelated workflows before changing main or
   creating tags. Leave publishing disabled until test tags are removed.
3. Copy `checks.sh` and `tags.sh` into `.github/hj-live/`, and `workflow.yaml`
   into `.github/workflows/hj-live-validation.yaml` on scratchpad's main branch.
4. Configure the current managed main protection, enable auto-merge and rebase
   merging, and allow Actions to create PRs. Disable review requirements for
   this test. Configure the current managed tag rulesets with the local CLI.
5. Dispatch `hj-live-validation.yaml` with `mode=checks`, then with `mode=tags`.
   Check each run's logs and conclusion. The checks fixture creates its PR
   through the GitHub API and verifies the rebased tree and parent.
6. Remove the fixture's exact tags using the administrator bypass. Close any
   unmerged fixture PR, remove its branch, and remove the temporary main files.
   Restore saved rulesets and workflow states, then confirm the remote state.

The tag fixture verifies creation, rejected updates, and rejected deletion with
the workflow token. It reads the tag again after each rejected mutation. It also
proves the documented boundary by creating a version-shaped tag with a leading
zero. These temporary tags use the run ID and are printed for cleanup.

## Generated workflow runs on 2026-09-11 and 2026-09-12

These tests run on Linux. The dates include the local Stockholm date and UTC
workflow timestamps.

| Repository                                                                       | Purpose                                                              |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [scratchpad](https://github.com/hugojosefson/scratchpad)                         | Confirm a reversible setting change against the existing repository. |
| [scratchpad-hj-settings](https://github.com/hugojosefson/scratchpad-hj-settings) | Exercise repository settings and protection lifecycle.               |
| [scratchpad-hj-release](https://github.com/hugojosefson/scratchpad-hj-release)   | Run generated CI, tag publication, and the GitHub Release publisher. |

The release fixture uses two temporary GitHub Actions runners in Docker on the
local machine. The runners receive a read-only copy of the unpublished CLI.
Generated workflows substitute a local `file:` reference for the JSR reference
and select these runners. No CLI source is uploaded to GitHub.

The fixture otherwise runs the generated commands with their declared Deno
permissions and real workflow tokens. The JSR publisher is removed before any
workflow runs. Package checks use `deno publish --dry-run` and upload nothing.

### Repository configuration

| Check               | Observed result                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| Existing scratchpad | Discussions enabled and disabled. Original configuration and tracked files preserved.              |
| Private repository  | GitHub Free rejected rulesets and did not enable auto-merge.                                       |
| Plan diagnostics    | The CLI reports the private-repository plan restriction without suggesting a login failure.        |
| Public visibility   | The CLI changed the disposable repository from private to public.                                  |
| Scalar settings     | Each managed boolean setting enabled and disabled, then restored to the publication configuration. |
| CI dependency       | Main protection rejected setup before the generated CI workflow existed remotely.                  |
| Actions PR setting  | Setup rejected missing permission to create PRs. It passed after the setting changed.              |
| Main protection     | Required checks and rebase-only merges enabled.                                                    |
| Main review         | Enabled, disabled, and preserved independently of the protection preset.                           |
| Tag protection      | Personal-repository rulesets enabled, removed, and enabled again.                                  |

| Scalar setting tested in both directions | GitHub field                  |
| ---------------------------------------- | ----------------------------- |
| Merge commits                            | `allow_merge_commit`          |
| Squash merging                           | `allow_squash_merge`          |
| Rebase merging                           | `allow_rebase_merge`          |
| Auto-merge                               | `allow_auto_merge`            |
| Delete merged branches                   | `delete_branch_on_merge`      |
| Issues                                   | `has_issues`                  |
| Projects                                 | `has_projects`                |
| Branch updates                           | `allow_update_branch`         |
| Wiki                                     | `has_wiki`                    |
| Discussions                              | `has_discussions`             |
| Web commit signoff                       | `web_commit_signoff_required` |
| Private visibility                       | `private`                     |

The fixture ends with merge commits and squash merging disabled.

### Release results

| Check                               | Evidence or observed result                                                                                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source CI                           | Both required jobs passed for [PR 2](https://github.com/hugojosefson/scratchpad-hj-release/pull/2).                                                              |
| Release preparation and application | [Run 34651242050, attempt 3](https://github.com/hugojosefson/scratchpad-hj-release/actions/runs/34651242050/attempts/3) completed both jobs.                     |
| Release PR                          | [PR 3](https://github.com/hugojosefson/scratchpad-hj-release/pull/3) merged by rebase with the workflow token.                                                   |
| Commit identity                     | The release commit uses `github-actions[bot]` for author and committer.                                                                                          |
| Commit contents                     | The rebased candidate retained its expected tree and had one parent.                                                                                             |
| Tag and branch                      | Lightweight tag `0.0.1` points to `c21d358dadaefd55bc18c474028aad0e0338e2dd`. Its owned branch was removed.                                                      |
| Independent publisher               | [Run 34651687176](https://github.com/hugojosefson/scratchpad-hj-release/actions/runs/34651687176) created the GitHub Release after the success event.            |
| Repeated publisher                  | [Run 34651769927](https://github.com/hugojosefson/scratchpad-hj-release/actions/runs/34651769927) succeeded without changing the release ID or publication time. |
| Existing-tag recovery               | [Run 34651772010](https://github.com/hugojosefson/scratchpad-hj-release/actions/runs/34651772010) accepted the exact tag and repeated the publisher event.       |
| Release-first collision             | PR 5 needed rebase and fresh checks after release `0.0.2` reached `main`. Both source changes survived.                                                          |

| Additional check       | Evidence or observed result                                                                                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source-first collision | [Run 34652352267, attempt 2](https://github.com/hugojosefson/scratchpad-hj-release/actions/runs/34652352267/attempts/2) closed stale [PR 10](https://github.com/hugojosefson/scratchpad-hj-release/pull/10) after source PR 9 merged. |
| Fresh preparation      | [Run 34652758570](https://github.com/hugojosefson/scratchpad-hj-release/actions/runs/34652758570) released `0.0.3` from the new source, with `collision-proof.txt` intact.                                                            |
| Publisher conflict     | [Run 34652760606](https://github.com/hugojosefson/scratchpad-hj-release/actions/runs/34652760606) rejected a changed release description. A fresh read confirmed no overwrite.                                                        |
| Publisher retry        | Attempt 2 of the same run succeeded after the original description was restored.                                                                                                                                                      |
| Draft conflict         | After tag deletion, GitHub changed the old release to a draft. The old publisher overlooked it and created a duplicate. The corrected local CLI found the draft and refused publication without changes.                              |
| Draft recovery         | The duplicate was deleted and the original release was restored manually. The corrected CLI then accepted it. Exactly one published release per tag remains.                                                                          |
| Missing-tag recovery   | [Run 34652875645](https://github.com/hugojosefson/scratchpad-hj-release/actions/runs/34652875645) restored the deleted `0.0.1` tag to its exact original commit.                                                                      |
| Active removal guard   | Feature removal stopped while tag publication was active. Local files stayed unchanged.                                                                                                                                               |
| Ordered removal        | [PR 12](https://github.com/hugojosefson/scratchpad-hj-release/pull/12) removed both publication workflows. Tag-protection removal was blocked before that merge and succeeded afterward.                                              |
| Dependency update      | [Run 34653191461](https://github.com/hugojosefson/scratchpad-hj-release/actions/runs/34653191461) created [PR 13](https://github.com/hugojosefson/scratchpad-hj-release/pull/13) for a deliberately outdated dependency.              |
| Dependency retry       | [Run 34653241667](https://github.com/hugojosefson/scratchpad-hj-release/actions/runs/34653241667) updated the same branch and reused PR 13. No duplicate PR appeared.                                                                 |
| CI removal             | Removing main protection and CI together removed the exact generated workflows from the settings fixture.                                                                                                                             |
| Dependency no-op       | [Run 34652917128](https://github.com/hugojosefson/scratchpad-hj-release/actions/runs/34652917128) completed without creating a PR when dependencies were current.                                                                     |

The collision rehearsal inserted a 90-second pause after PR reservation in the
local test copy only. This made the source-first order deterministic. The pause
was removed before the next release run. The first rehearsal exposed the cleanup
bug and needed manual removal of its stale PR. The corrected rehearsal closed
its own PR and removed its branch.

Bot-created PR workflow runs did not execute jobs without approval. The tag
workflow's owned synthetic checks still gated the release PR. Source PRs ran the
normal CI jobs.

### Fixes found by these runs

| Problem                   | Fix                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Version calculator import | Generated preparation grants the two environment reads required by `fork-version` through esbuild.                              |
| Candidate package check   | The generated dry run accepts the deliberately uncommitted version and changelog. Exact older task definitions can be repaired. |
| Git commit identity       | Release commit commands set the standard bot identity explicitly.                                                               |
| Check URL comparison      | Ownership accepts GitHub's canonical check URL for the exact check ID and repository. Other ownership checks remain required.   |
| Early source collision    | Cleanup also handles a source merge before the release enables auto-merge.                                                      |
| Hidden release drafts     | The publisher reads all release pages, including drafts, and rejects duplicate tags before creating a release.                  |
| Mutation result text      | Local file changes and GitHub changes have separate result rows.                                                                |

Regression tests cover each fix. A clean Linux container also installed the CLI
from the local package entry point, ran help, and applied a formatting feature.
A repeated operation reported no changes.

| Local check       | Result on 2026-09-12                                          |
| ----------------- | ------------------------------------------------------------- |
| Full Linux suite  | 394 tests passed, with zero failures.                         |
| Line coverage     | 89.3%.                                                        |
| Branch coverage   | 89.0%.                                                        |
| Function coverage | 93.3%.                                                        |
| Package           | Version `0.1.0` passed the JSR dry run with full type checks. |
| Documentation     | Formatting passed and local file links resolved.              |

## Cleanup after the local-copy tests

| Resource              | Final state                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| Original scratchpad   | Clean `main` and original repository configuration.                                                     |
| Settings fixture      | Generated CI files removed. Actions disabled.                                                           |
| Release fixture       | Tag and publisher workflows removed. Tag protection removed after the workflow merge. Actions disabled. |
| Test PRs and branches | All PRs closed or merged. Temporary remote branches removed.                                            |
| GitHub Releases       | Three scratchpad releases remain as evidence. Their tags and source changes are preserved.              |
| Local runners         | Both containers removed and both runner registrations deleted.                                          |
| Local credentials     | Temporary runner credentials removed with their runner directories.                                     |
| CLI repository        | Local `main` only, with no release tag and no publication.                                              |

The remaining remote logs and releases belong only to the disposable
repositories. They contain generated fixture projects, not this CLI source.

## Limits

The local-copy runs test real GitHub events, tokens, checks, rulesets, rebase
merges, tags, and GitHub Releases. They do not test loading the CLI from JSR.
The later JSR runs in this record cover package upload, registry installation,
module digests, and provenance. Linux is the current live test target. Local
tests reject conflicting JSR metadata and provenance; no conflicting public
package version was deliberately uploaded.

## Member-triggered JSR workflow, 2026-09-12

The generated JSR workflow passed an identity test on a GitHub-hosted Linux
runner in
[scratchpad-hj-jsr-identity](https://github.com/hugojosefson/scratchpad-hj-jsr-identity).
[Run 34656257334](https://github.com/hugojosefson/scratchpad-hj-jsr-identity/actions/runs/34656257334)
used the generated workflow with its CLI reference replaced by a small test
script. The script requested GitHub identity credentials without uploading a
package. The repository contains no unpublished CLI source.

| Check       | Observed result                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------- |
| Trigger     | `gh workflow run` selected `main` and supplied tag `0.0.1`.                                                      |
| Identity    | The credential identified `hugojosefson` as the actor and `workflow_dispatch` as the event.                      |
| Workflow    | The credential named `.github/workflows/hj-release-publish-jsr.yaml` on `main` in the test repository.           |
| Checkout    | The workflow selected the tagged commit, although `main` pointed to a later commit.                              |
| Permissions | The generated permissions allowed Git authentication and the child Deno process to obtain temporary credentials. |
| Cleanup     | Actions were disabled after the successful run.                                                                  |

This test proves the manual retry route used with both JSR restrictions. The
default automatic route requires the scope to permit publication by the release
bot. This test does not prove that JSR accepts an upload or that registry
provenance matches. Those checks still need an authorized package publication.

## Automatic JSR workflow, 2026-09-12

The automatic workflow passed in the same disposable repository. The
[launcher run](https://github.com/hugojosefson/scratchpad-hj-jsr-identity/actions/runs/34656625560)
sent the tag-success event with its GitHub Actions token. That event started
[publisher run 34656635383](https://github.com/hugojosefson/scratchpad-hj-jsr-identity/actions/runs/34656635383)
without a separate user command for the publisher.

| Check              | Observed result                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------- |
| Generated workflow | Used the automatic JSR template, with only the CLI reference replaced by the test script.    |
| Trigger            | Received `hj-release-publish-tag-success` through `repository_dispatch`.                     |
| Identity           | GitHub issued credentials with actor `github-actions[bot]` and event `repository_dispatch`.  |
| Checkout           | Selected the commit for tag `0.0.2`, although `main` pointed to a later commit.              |
| Permissions        | Git authentication and temporary identity credentials worked with the generated permissions. |
| Cleanup            | Actions were disabled after both runs succeeded.                                             |

The bot identity explains why automatic publication needs **Do not restrict
publishing** in JSR. **Require Publishing from CI** remains compatible with this
route. This test performed no JSR upload, so registry acceptance and provenance
still need live publication validation.

## Public bootstrap source, 2026-09-12

The owner authorized publication before these tests. The
[bootstrap fixture](https://github.com/hugojosefson/scratchpad-hj-bootstrap)
loads the CLI from a full commit SHA in the public GitHub repository. All
workflow files come from implemented feature operations. No JSR package is
uploaded by this fixture.

| Check                   | Evidence or observed result                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source CI               | [Run 34657723358](https://github.com/hugojosefson/scratchpad-hj-bootstrap/actions/runs/34657723358) passed.                                                                   |
| Tag workflow            | [Run 34657787991](https://github.com/hugojosefson/scratchpad-hj-bootstrap/actions/runs/34657787991) passed preparation and application.                                       |
| Release PR              | [PR 2](https://github.com/hugojosefson/scratchpad-hj-bootstrap/pull/2) merged by rebase and created tag `0.0.1`.                                                              |
| Delayed release listing | [Run 34657903360](https://github.com/hugojosefson/scratchpad-hj-bootstrap/actions/runs/34657903360) created the GitHub Release but did not immediately see it in the listing. |
| Safe publisher retry    | [Run 34658094996](https://github.com/hugojosefson/scratchpad-hj-bootstrap/actions/runs/34658094996) accepted the existing release without creating a duplicate.               |

The delayed listing exposed a missing confirmation wait. Both publishers now
retry temporary read failures for up to 60 seconds. Content conflicts still stop
immediately. Regression tests cover delayed visibility and safe retries.

The registry reader also accepted the real metadata and Rekor record for
`@std/assert@1.0.19`. Its manifest digest matched the signed subject. The reader
correctly rejected that package's unrelated publishing workflow. This read-only
check tests response formats, not publication of the CLI package.

## Automatic recovery at the tag, 2026-09-12

The identity fixture placed tag `0.0.3` behind `main`. The
[launcher](https://github.com/hugojosefson/scratchpad-hj-jsr-identity/actions/runs/34659860367)
sent the usual release event. The
[dispatch job](https://github.com/hugojosefson/scratchpad-hj-jsr-identity/actions/runs/34659868409)
started a new run at the tag automatically. The
[publication probe](https://github.com/hugojosefson/scratchpad-hj-jsr-identity/actions/runs/34659873813)
passed with the release bot as actor, `workflow_dispatch` as event, and the tag
as workflow ref. Its checkout and workflow commit matched. No package was
uploaded. Actions were disabled after the test.

The updated bootstrap fixture also completed its
[tag pipeline](https://github.com/hugojosefson/scratchpad-hj-bootstrap/actions/runs/34659910256)
and
[GitHub publisher](https://github.com/hugojosefson/scratchpad-hj-bootstrap/actions/runs/34659975150)
for `0.0.2`. No retry was needed. Actions were disabled afterward.

## CLI publication, 2026-09-12

The owner authorized the first public release. All stages below used the
generated workflows and their declared permissions on GitHub-hosted Linux.

| Check              | Evidence or observed result                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source CI          | [Run 34659880368](https://github.com/hugojosefson/cli/actions/runs/34659880368) passed both required jobs.                                                          |
| Tag publication    | [Run 34660013067](https://github.com/hugojosefson/cli/actions/runs/34660013067) created and merged release PR 2, then created tag `0.2.0`.                          |
| GitHub Release     | [Run 34660145283](https://github.com/hugojosefson/cli/actions/runs/34660145283) published the matching release.                                                     |
| JSR publication    | [Run 34660145354](https://github.com/hugojosefson/cli/actions/runs/34660145354) uploaded and confirmed `@hugojosefson/cli@0.2.0`.                                   |
| JSR retry          | [Run 34660511479](https://github.com/hugojosefson/cli/actions/runs/34660511479) accepted the existing version from the manual retry route, without another upload.  |
| Provenance         | The registry manifest and Rekor entry `2800096274` bind the package to release commit `df18f39bc7cb23a0984a0500182c9e40b0dd1f9b`. An independent local read passed. |
| Installation       | A clean `denoland/deno:2.9.6` Linux container installed directly from JSR and ran help. No repository was mounted or cloned.                                        |
| Repository command | After Git installation, the container enabled `deno-fmt`, detected it, and repeated the operation with no changes. GitHub CLI was not required.                     |

The immediate installation required `--min-dep-age=0` because Deno delays new
dependencies for 24 hours. A separate fresh-container check passed with an
exclusion for only `jsr:@hugojosefson/cli`. The README describes the
installation choice. The missing-Git test also exposed an unclear error, which
now names the required tool before optional GitHub reads start.

The ordinary CI run on the bot-created release PR did not start jobs. The tag
workflow ran the project checks during preparation and created both required
synthetic checks on the exact release commit. These checks allowed the rebase
merge. This behavior matches the earlier disposable tests.

The
[migration CI run](https://github.com/hugojosefson/cli/actions/runs/34660580410)
passed both jobs with the exact `jsr:@hugojosefson/cli@0.2.0` reference. The
migration also updates all three release workflows through the feature command.
The final local suite passed 410 tests, with 89.5% line coverage, 89.3% branch
coverage, and 93.5% function coverage.

## Default GitHub project, 2026-09-12

The local checkout created and linked the public
[`cli` project](https://github.com/users/hugojosefson/projects/10) through
`hj repo features --github-default-project --yes`. The project contains all 25
repository issues created during the documentation migration. GitHub queries
confirmed project membership for every issue, including closed issues.

Setup created the Priority field and assigned initial statuses. The migration
then assigned priorities, recorded issue dependencies, and configured Work,
Board, Ideas, and Decisions views. Issue titles contain at most 26 characters.

GitHub briefly omitted recent writes from its project queries. The adapter now
waits for those writes to appear before feature validation. A fixture test
covers this delay without repeating mutations. A repeated live setup reported
`github-default-project` as enabled and made no changes.

The local `deno task ci` run passed 426 tests and enforced coverage thresholds.
The feature adds missing issues when explicitly enabled again.

## Project auto-add, 2026-09-12

The optional `hj repo project-auto-add --yes` command connected to the owner's
signed-in Firefox through WebDriver BiDi, Firefox's automation connection.
Firefox ran from Snap. The browser reported admin access to project 10.

The endpoint route created workflow 7, `Auto-add to project`, with issue-only
content and the `is:issue` filter for `hugojosefson/cli`. A fresh page read
confirmed the saved workflow. The browser route then enabled the same workflow
through GitHub's visible Edit and Save controls in the signed-in preview. A
fresh page read and the public GraphQL API confirmed that it remained enabled.
The setup planner reported no further change and found no duplicate workflow.

The live browser test exposed missing test attributes in GitHub's production UI.
The fallback now also uses visible button names and accessible repository
controls. A regression test covers enabling a workflow without test attributes
and rejecting a concurrent change before Save.

An isolated Firefox session tested a simulated GitHub page. Endpoint creation,
HTTP 404 fallback, and direct browser creation each saved one workflow. A repeat
run reported no change for each route.

The browser route also created an issue-only workflow in a temporary private
GitHub project through the signed-in preview. The first attempt exposed a page
transition race. The fallback now waits for the selected workflow before it
clicks Edit. A regression test covers the delay. With the fix, creation passed
on the first attempt in a fresh project. A fresh page read confirmed one enabled
workflow with the `is:issue` filter, and repeated planning returned no change.
Both temporary projects were deleted after validation.

[Issue 33](https://github.com/hugojosefson/cli/issues/33) tracks this
implementation and its live validation.

## Project views and Area, 2026-09-12

The project root opened on Board after its tab moved before Work. The browser
confirmed that Backlog preceded Todo. The public API confirmed the status option
order and the original option IDs. GitHub's browser API moved the existing Board
tab because the public view API has no tab-order input.

The feature command added Area to Work and Board and populated values for all 25
issues with `area:*` labels. Issues with multiple area labels received all
values in alphabetical order. Work displayed the Area header next to Title. The
original issue labels remained in GitHub.

Fixture tests cover Board as the first view of a new project, preservation of
custom views and status options, Area updates after label changes, and repeated
setup without duplicate views or item assignments.

## npm publisher checks

Issue #12 adds a separate npm publisher and a local build example for this
repository. On 2026-09-12, `deno task npm-build` produced the CLI package and
its Node.js launcher displayed `hj --help`. `npm pack --ignore-scripts` produced
an archive without publishing it. The CLI launcher requires Deno on `PATH`.

The scratchpad fixture builds `@hugojosefson/scratchpad@3.0.20-npm.0` from its
two existing library exports. Both built exports ran in Node.js, and npm packed
the five expected files. A local Git remote supplied an exact release tag for
the full publisher check. Real Git commands, the build task, npm packing,
entry-point inspection, and a repeated publication command passed. Only the
upload and the npm registry response were simulated in that check. The repeated
command did not upload again.

The public npm registry returned 404 for `@hugojosefson/scratchpad`. The local
environment has no npm token or npm login configuration, and the browser
redirects to npm sign-in. The scratchpad repository has no `NPM_TOKEN` secret.
Live publication remains unverified until npm authentication is configured.
Issue #12 must remain open until that publication succeeds. See
[npm publication](npm-publication.md) for the exact workflow and authentication
contract.

The
[scratchpad fixture branch](https://github.com/hugojosefson/scratchpad/tree/test/npm-publisher)
contains the build and workflow. GitHub must first load the workflow on the
default branch before a manual workflow dispatch can run it. The fixture does
not change the scratchpad default branch or publish a package.
