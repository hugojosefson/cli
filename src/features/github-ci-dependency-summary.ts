/** @module Workflow results for dependency pull requests. */
export const githubCiDependencySummary =
  `          expected_head="\$(git rev-parse HEAD)"
          for attempt in {1..10}; do
            if pr_json="\$(gh pr view "\${branch}" --json number,url,state,isCrossRepository,headRefName,headRefOid)" &&
              jq --exit-status --arg head "\${expected_head}" --arg ref "\${branch}" \\
                '.state == "OPEN" and .isCrossRepository == false and .headRefOid == $head and .headRefName == $ref and (.number | type == "number") and (.url | type == "string")' \\
                <<< "\${pr_json}" >/dev/null; then
              break
            fi
            if [ "\${attempt}" = "10" ]; then
              echo "GitHub PR data did not agree with commit \${expected_head} after 10 attempts." | tee -a "\${GITHUB_STEP_SUMMARY}" >&2
              exit 1
            fi
            sleep 2
          done
          pr_url="\$(jq --raw-output '.url' <<< "\${pr_json}")"
          printf 'Dependency PR: %s\\n\\nCommit: %s\\n\\n' "\${pr_url}" "\${expected_head}" >> "\${GITHUB_STEP_SUMMARY}"
          for attempt in {1..10}; do
            if runs_json="\$(gh run list --workflow hj-ci.yaml --event pull_request --commit "\${expected_head}" --limit 10 --json event,headSha,status,conclusion,url)" &&
              run_json="\$(jq --compact-output --exit-status --arg head "\${expected_head}" \\
                '[.[] | select(.event == "pull_request" and .headSha == $head and (.url | type == "string"))][0] // empty' <<< "\${runs_json}")"; then
              break
            fi
            if [ "\${attempt}" = "10" ]; then
              echo "GitHub did not return a PR workflow for this commit after 10 attempts. Examine the PR checks." | tee -a "\${GITHUB_STEP_SUMMARY}" >&2
              exit 1
            fi
            sleep 3
          done
          run_url="\$(jq --raw-output '.url' <<< "\${run_json}")"
          run_status="\$(jq --raw-output '.conclusion // empty | select(. != "")' <<< "\${run_json}")"
          if [ -z "\${run_status}" ]; then
            run_status="\$(jq --raw-output '.status' <<< "\${run_json}")"
          fi
          printf 'PR workflow: %s\\n\\nWorkflow status: %s\\n\\n' "\${run_url}" "\${run_status}" >> "\${GITHUB_STEP_SUMMARY}"
          if [ "\${run_status}" = "action_required" ]; then
            echo 'User approval is necessary. A user with write access must select "Approve workflows" on the PR.' >> "\${GITHUB_STEP_SUMMARY}"
          fi
`;
