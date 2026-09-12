/** Run the suite with the same permissions locally and in CI. */
import { runDeno } from "./deno-process.ts";
const coverage = Deno.args.includes("--coverage");
const args = Deno.args.filter((arg) => arg !== "--coverage");
await Deno.mkdir("/tmp/opencode", { recursive: true });
Deno.exit(
  await runDeno([
    "test",
    "--frozen",
    "--allow-read=/tmp/opencode",
    "--allow-write=/tmp/opencode",
    "--allow-run=git,deno,sh",
    "--allow-net=127.0.0.1",
    "--allow-env=ESBUILD_BINARY_PATH,ESBUILD_WORKER_THREADS,LOG_TOKENS,LOG_STREAM,GIT_AUTHOR_NAME,GIT_AUTHOR_EMAIL,GIT_COMMITTER_NAME,GIT_COMMITTER_EMAIL",
    ...(coverage
      ? ["--coverage=.coverage", "--clean", "--coverage-raw-data-only"]
      : []),
    ...args,
  ]),
);
