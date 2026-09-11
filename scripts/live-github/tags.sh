#!/usr/bin/env bash
set -euo pipefail
[[ "$GITHUB_REPOSITORY" == hugojosefson/scratchpad ]]
repo="repos/$GITHUB_REPOSITORY"
tag="999999.0.$GITHUB_RUN_ID"
sha=$(gh api "$repo/git/ref/heads/main" --jq .object.sha)
other=$(gh api "$repo/git/commits/$sha" --jq '.parents[0].sha')
gh api --method POST "$repo/git/refs" -f ref="refs/tags/$tag" -f sha="$sha" > /dev/null
[[ $(gh api "$repo/git/ref/tags/$tag" --jq .object.sha) == "$sha" ]]
if gh api --method PATCH "$repo/git/refs/tags/$tag" -f sha="$other" -F force=true > update.json 2> update.err; then
  echo 'Tag update unexpectedly succeeded'; exit 1
fi
jq . update.json
jq -e '.status == "422" and (.message | contains("Repository rule violations"))' update.json
[[ $(gh api "$repo/git/ref/tags/$tag" --jq .object.sha) == "$sha" ]]
if gh api --method DELETE "$repo/git/refs/tags/$tag" > delete.json 2> delete.err; then
  echo 'Tag deletion unexpectedly succeeded'; exit 1
fi
jq -e '.status == "422" and (.message | contains("Repository rule violations"))' delete.json
[[ $(gh api "$repo/git/ref/tags/$tag" --jq .object.sha) == "$sha" ]]
if gh api --method POST "$repo/git/refs" -f ref="refs/tags/hj-live-$GITHUB_RUN_ID" -f sha="$sha" > create.json 2> create.err; then
  echo 'Nonrelease tag creation unexpectedly succeeded'; exit 1
fi
jq . create.json
jq -e '.status == "422" and .message == "Reference update failed"' create.json
gh api "$repo/git/matching-refs/tags/hj-live-$GITHUB_RUN_ID" --jq 'length == 0' | grep -qx true
# This deliberately demonstrates the documented boundary: GitHub's wildcard
# accepts a leading zero. Exact SemVer is enforced by hj, not this ruleset.
invalid="0999999.0.$GITHUB_RUN_ID"
gh api --method POST "$repo/git/refs" -f ref="refs/tags/$invalid" -f sha="$sha" > /dev/null
[[ $(gh api "$repo/git/ref/tags/$invalid" --jq .object.sha) == "$sha" ]]
printf 'Tag protection passed. Admin cleanup tags: %s %s\n' "$tag" "$invalid"
