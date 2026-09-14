/** @module CI inputs and checks for dependency pull requests. */
export const githubCiDispatchInputs = `  workflow_dispatch:
    inputs:
      pull_request:
        description: Pull request number
        required: true
        type: string
      base_sha:
        description: Base commit SHA
        required: true
        type: string
      head_sha:
        description: Head commit SHA
        required: true
        type: string
`;

export const githubCiDispatchValidation =
  `      - name: Validate pull request inputs
        if: github.event_name == 'workflow_dispatch'
        env:
          GH_TOKEN: \${{ github.token }}
          GH_REPO: \${{ github.repository }}
          PR_NUMBER: \${{ inputs.pull_request }}
          BASE_SHA: \${{ inputs.base_sha }}
          HEAD_SHA: \${{ inputs.head_sha }}
          RUN_SHA: \${{ github.sha }}
          RUN_REF: \${{ github.ref_name }}
        run: |
          set -euo pipefail
          [[ "\${PR_NUMBER}" =~ ^[1-9][0-9]*$ ]]
          [[ "\${BASE_SHA}" =~ ^[a-f0-9]{40}$ ]]
          [[ "\${HEAD_SHA}" =~ ^[a-f0-9]{40}$ ]]
          test "\${HEAD_SHA}" = "\${RUN_SHA}"
          gh pr view "\${PR_NUMBER}" --json state,isCrossRepository,headRefName,headRefOid,baseRefOid \\
            | jq --exit-status --arg head "\${HEAD_SHA}" --arg base "\${BASE_SHA}" --arg ref "\${RUN_REF}" \\
              '.state == "OPEN" and .isCrossRepository == false and .headRefOid == $head and .baseRefOid == $base and .headRefName == $ref'
`;

export const githubCiDispatchCommand =
  `          pr_json="\$(gh pr view "\${branch}" --json number,baseRefOid,headRefOid)"
          pr_number="\$(jq --raw-output '.number' <<< "\${pr_json}")"
          base_sha="\$(jq --raw-output '.baseRefOid' <<< "\${pr_json}")"
          head_sha="\$(jq --raw-output '.headRefOid' <<< "\${pr_json}")"
          test "\${head_sha}" = "\$(git rev-parse HEAD)"
          gh workflow run hj-ci.yaml --ref "\${branch}" \\
            --field pull_request="\${pr_number}" \\
            --field base_sha="\${base_sha}" \\
            --field head_sha="\${head_sha}"
`;
