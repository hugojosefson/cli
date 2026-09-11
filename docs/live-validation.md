# Live GitHub validation

These checks use `hugojosefson/scratchpad`, a disposable public repository. They
do not publish the CLI or a package. The shell fixtures test GitHub API behavior
with a real workflow token; they do not run the unpublished CLI on GitHub. The
local CLI is tested against the same remote repository separately.

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

## Limits

These runs test GitHub primitives and local adapter reads. They do not prove the
full generated release workflow, package installation, JSR identity credentials,
module digests, provenance, or publisher retries. Those checks remain in
[planned work](planned.md#remaining-live-validation).
