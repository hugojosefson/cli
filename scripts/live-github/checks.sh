#!/usr/bin/env bash
# Temporary owned test of live GitHub checks and rebase auto-merge.
set -euo pipefail
repo="$GITHUB_REPOSITORY"
[[ "$repo" == hugojosefson/scratchpad ]]
branch="hj-live/run-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
base=$(gh api "repos/$repo/git/ref/heads/main" --jq .object.sha)
tree=$(gh api "repos/$repo/git/commits/$base" --jq .tree.sha)
jq -n --arg tree "$tree" --arg content "$GITHUB_RUN_ID/$GITHUB_RUN_ATTEMPT" \
  '{base_tree:$tree,tree:[{path:".hj-live-result",mode:"100644",type:"blob",content:$content}]}' > tree.json
tree=$(gh api --method POST "repos/$repo/git/trees" --input tree.json --jq .sha)
jq -n --arg tree "$tree" --arg base "$base" '{tree:$tree,parents:[$base],message:"chore: validate live release checks"}' > commit.json
head=$(gh api --method POST "repos/$repo/git/commits" --input commit.json --jq .sha)
gh api --method POST "repos/$repo/git/refs" -f ref="refs/heads/$branch" -f sha="$head" >/dev/null
gh api --method POST "repos/$repo/pulls" -f base=main -f head="$branch" \
  -f title="chore: validate live release checks" -f body="Temporary hj live fixture for run $GITHUB_RUN_ID. No package publication." > pr.json
number=$(jq -r .number pr.json)
id=$(jq -r .node_id pr.json)
echo "pr=$number head=$head branch=$branch"
for context in check hj-release-commit-validation; do
  gh api --method POST "repos/$repo/check-runs" -f name="$context" -f head_sha="$head" \
    -f status=in_progress -f external_id="hj-live/$GITHUB_RUN_ID/$GITHUB_RUN_ATTEMPT/$context" > "$context.json"
  [[ $(jq -r .app.id "$context.json") == 15368 ]]
done
query='query($id:ID!){node(id:$id){... on PullRequest{state headRefOid mergeStateStatus autoMergeRequest{mergeMethod enabledBy{login}}}}}'
for attempt in {1..24}; do
  gh api graphql -f query="$query" -f id="$id" > observed.json
  state=$(jq -r .data.node.mergeStateStatus observed.json)
  [[ "$state" == BLOCKED ]] && break
  sleep 5
done
[[ "$state" == BLOCKED ]]
[[ $(jq -r .data.node.headRefOid observed.json) == "$head" ]]
echo "New checks block the exact PR head."
mutation='mutation($id:ID!,$sha:GitObjectID!){enablePullRequestAutoMerge(input:{pullRequestId:$id,mergeMethod:REBASE,expectedHeadOid:$sha}){pullRequest{id}}}'
gh api graphql -f query="$mutation" -f id="$id" -f sha="$head" > enabled.json
gh api graphql -f query="$query" -f id="$id" > observed.json
[[ $(jq -r .data.node.autoMergeRequest.mergeMethod observed.json) == REBASE ]]
[[ $(jq -r .data.node.autoMergeRequest.enabledBy.login observed.json) == 'github-actions' ]]
for context in check hj-release-commit-validation; do
  check_id=$(jq -r .id "$context.json")
  gh api --method PATCH "repos/$repo/check-runs/$check_id" -f status=completed -f conclusion=success >/dev/null
done
for attempt in {1..36}; do
  gh api "repos/$repo/pulls/$number" > observed-pr.json
  [[ $(jq -r .merged observed-pr.json) == true ]] && break
  sleep 5
done
[[ $(jq -r .merged observed-pr.json) == true ]]
merged=$(jq -r .merge_commit_sha observed-pr.json)
gh api "repos/$repo/git/commits/$merged" > merged.json
[[ $(jq -r '.parents|length' merged.json) == 1 ]]
[[ $(jq -r '.parents[0].sha' merged.json) == "$base" ]]
[[ $(jq -r .tree.sha merged.json) == "$tree" ]]
{
  echo '## Live release check result'
  echo "PR #$number rebased with zero reviews and two GitHub Actions checks."
  echo "Original head: $head"
  echo "Merged commit: $merged"
  echo "Verified parent: $base"
  echo "Verified tree: $tree"
} >> "$GITHUB_STEP_SUMMARY"
echo 'Live checks and rebase validation passed.'
