/** @module Explicit managed CI variant for hj's shared runtime suite. */
import { nativeNpmCacheStep } from "./github-workflow-cache.ts";
export const githubCiRuntimeMatrixMarker =
  "# hj-ci-runtime-matrix: deno-node-bun-v1\n";

/** Retain shared setup and release validation while replacing the check job. */
export function githubCiRuntimeMatrix(content: string): string {
  const start = content.indexOf("  check:\n");
  const end = content.indexOf("  hj-release-commit-validation:\n", start);
  const setup = content.slice(start, end).split("    steps:\n")[1]
    .split("      - run: deno task all\n")[0];
  const upload = (label: string) =>
    `      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        with:
          name: runtime-report-${label}
          path: .hj/test-results/${label}.json
          include-hidden-files: true
          if-no-files-found: error
          retention-days: 1
          overwrite: true
`;
  const jobs = `  deno:
    runs-on: ubuntu-latest
    steps:
${setup}      - run: deno task ci-deno
${upload("deno")}  native:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        runtime: [node24, node26, bun]
    steps:
${setup}${nativeNpmCacheStep}      - run: deno run --allow-all scripts/run-test-matrix.ts --runtime \${{ matrix.runtime }}
${upload("\${{ matrix.runtime }}")}  check:
    if: \${{ always() }}
    needs: [deno, native]
    runs-on: ubuntu-latest
    steps:
      - name: Require successful checks and every runtime
        env:
          DENO_RESULT: \${{ needs.deno.result }}
          NATIVE_RESULT: \${{ needs.native.result }}
        run: test "$DENO_RESULT" = success && test "$NATIVE_RESULT" = success
${setup}      - uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4
        with:
          pattern: runtime-report-*
          path: .hj/test-results
          merge-multiple: true
      - name: Compare complete executed inventories
        run: deno run --allow-read scripts/run-test-matrix.ts --compare-only
`;
  return (content.slice(0, start) + jobs + content.slice(end)).replace(
    "name: CI\n",
    githubCiRuntimeMatrixMarker + "name: CI\n",
  );
}
