/** Permissions for local CLI development commands. */
import { runDeno } from "./deno-process.ts";
import { parseDenoOptions } from "../src/runtime/deno-options.ts";
const args = parseDenoOptions(Deno.args).args;
const taskCapable = !args.some((arg) => arg === "--help" || arg === "-h") &&
  (args[0] === "release" ||
    args[0] === "repo" && args[1] === "features" &&
      args.slice(2).some((arg) => arg !== "--yes"));
const projectAutoAdd = args[0] === "repo" &&
  args[1] === "project-auto-add";
const npmPublication = args[0] === "release" &&
  args[1] === "publish-npm";
Deno.exit(
  await runDeno([
    "run",
    "--frozen",
    "--allow-sys=uid,gid",
    "--allow-read",
    "--allow-write",
    taskCapable ? "--allow-run" : "--allow-run=git,gh,deno,sh",
    `--allow-net=raw.githubusercontent.com,api.jsr.io,jsr.io,rekor.sigstore.dev${
      projectAutoAdd ? ",127.0.0.1" : ""
    }${npmPublication ? ",registry.npmjs.org" : ""}`,
    "--allow-env=PATH,XDG_CACHE_HOME,LOG_TOKENS,LOG_STREAM,HOME,XDG_CONFIG_HOME,TERM,CLI_WIDTH,JSR_TOKEN,HJ_RELEASE_ROUTE,HJ_SOURCE_BASE_SHA,HJ_SOURCE_HEAD_SHA,HJ_RELEASE_TAG,HJ_RELEASE_VERSION,HJ_RELEASE_SHA,HJ_RELEASE_SCHEMA,HJ_RELEASE_BUNDLE,HJ_RELEASE_BUNDLE_DIGEST,GITHUB_RUN_ID,GITHUB_RUN_ATTEMPT,GITHUB_SERVER_URL,GITHUB_REPOSITORY,GITHUB_SHA,GITHUB_OUTPUT,GITHUB_STEP_SUMMARY,ESBUILD_BINARY_PATH,ESBUILD_WORKER_THREADS",
    new URL("../src/cli/cli.ts", import.meta.url).href,
    ...Deno.args,
  ]),
);
