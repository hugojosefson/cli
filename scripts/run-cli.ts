/** Permissions for local CLI development; no installation or publishing. */
import { runDeno } from "./deno-process.ts";
Deno.exit(
  await runDeno([
    "run",
    "--frozen",
    "--allow-read",
    "--allow-write",
    "--allow-run=git,gh,deno",
    "--allow-net=raw.githubusercontent.com,api.jsr.io,jsr.io,rekor.sigstore.dev",
    "--allow-env=HJ_RELEASE_ROUTE,HJ_SOURCE_BASE_SHA,HJ_SOURCE_HEAD_SHA,HJ_RELEASE_TAG,HJ_RELEASE_VERSION,HJ_RELEASE_SHA,HJ_RELEASE_SCHEMA,HJ_RELEASE_BUNDLE,HJ_RELEASE_BUNDLE_DIGEST,GITHUB_RUN_ID,GITHUB_RUN_ATTEMPT,GITHUB_SERVER_URL,GITHUB_REPOSITORY,GITHUB_OUTPUT,GITHUB_STEP_SUMMARY,ESBUILD_BINARY_PATH,ESBUILD_WORKER_THREADS",
    new URL("../src/cli/cli.ts", import.meta.url).href,
    ...Deno.args,
  ]),
);
