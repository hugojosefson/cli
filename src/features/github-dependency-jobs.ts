/** @module Isolated jobs for automatic dependency validation. */
import { githubDependencyContext } from "./github-dependency-context.ts";
import { githubDependencyChecks } from "./github-dependency-checks.ts";
import { hjPackageReference } from "./hj-package.ts";
import { workflowDenoVersion } from "./workflow-toolchain.ts";
import { denoCacheInputs } from "./github-workflow-cache.ts";

const script = (githubDependencyContext + githubDependencyChecks).trimEnd()
  .split("\n").map((line) => line ? `          ${line}` : "").join("\n");
const reporter = (phase: "select" | "report") =>
  `    runs-on: ubuntu-latest
    permissions:
      contents: read
      actions: read
      pull-requests: read
      checks: write
    steps:
      - id: checks
        env:
          GH_TOKEN: \${{ github.token }}
          PHASE: ${phase}
          HEAD_SHA: \${{ needs.update.outputs.head }}
          BASE_SHA: \${{ needs.update.outputs.base }}
${
    phase === "report"
      ? "          PR_NUMBER: ${{ needs.select.outputs.pr }}\n"
      : ""
  }        run: |
          python3 <<'PY'
${script}
          PY
`;
const setup = `    runs-on: ubuntu-latest
    needs: select
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: \${{ needs.select.outputs.head }}
          fetch-depth: 0
          persist-credentials: false
      - uses: denoland/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed # v2.0.5
        with:
          deno-version: ${workflowDenoVersion}
${denoCacheInputs}`;
export const githubDependencyJobs = `  select:
    needs: update
    if: needs.update.outputs.head != ''
    outputs:
      head: \${{ steps.checks.outputs.head }}
      base: \${{ steps.checks.outputs.base }}
      pr: \${{ steps.checks.outputs.pr }}
${reporter("select")}  dependency-check:
${setup}      - name: Validate dependencies
        run: deno task all
  dependency-source-validation:
${setup}      - name: Validate source commits
        env:
          HJ_RELEASE_ROUTE: source-validation
          HJ_SOURCE_BASE_SHA: \${{ needs.select.outputs.base }}
          HJ_SOURCE_HEAD_SHA: \${{ needs.select.outputs.head }}
        run: >-
          deno run --no-lock
          --allow-env=HJ_RELEASE_ROUTE,HJ_SOURCE_BASE_SHA,HJ_SOURCE_HEAD_SHA
          --allow-run=git
          ${hjPackageReference}
          release publish-tag-prepare
  report:
    needs: [update, select, dependency-check, dependency-source-validation]
    if: \${{ always() && needs.select.result == 'success' }}
${reporter("report")}`;
