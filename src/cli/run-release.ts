/** Release command adapters; heavyweight preparation loads only when requested. */
import type { CliResult } from "./cli-result.ts";
import { requiredEnvironment } from "../release/release-environment.ts";
import type { ApplyClock } from "../release/apply-types.ts";
import type { ReleaseEnvironment } from "../release/release-environment.ts";
import type { ReleaseProcess } from "../release/release-process.ts";
import type { JsrApi, PackageFileReader } from "../release/publish-jsr.ts";
import type { GithubReleaseApi } from "../release/publish-github.ts";
import type { PublisherFiles } from "../release/publisher-input.ts";

export type ReleaseServices = {
  readonly releaseEnvironment?: ReleaseEnvironment;
  readonly releaseProcess?: ReleaseProcess;
  readonly releaseClock?: ApplyClock;
  readonly publisherFiles?: PublisherFiles;
  readonly packageFiles?: PackageFileReader;
  readonly jsrApi?: JsrApi;
  readonly githubReleaseApi?: GithubReleaseApi;
};

export type ReleaseCommand =
  | "publish-tag-prepare"
  | "publish-tag-apply"
  | "publish-jsr"
  | "publish-github";
export async function runReleaseCommand(
  command: ReleaseCommand,
  root: URL,
  services: ReleaseServices,
): Promise<CliResult> {
  const handlers = {
    "publish-tag-prepare": runPublishTagPrepare,
    "publish-tag-apply": runPublishTagApply,
    "publish-jsr": runPublishJsr,
    "publish-github": runPublishGithub,
  };
  return await handlers[command](root, services);
}
async function releaseContext(root: URL, services: ReleaseServices) {
  const environment = services.releaseEnvironment ??
    (await import("../release/release-environment.ts")).denoReleaseEnvironment;
  const process = services.releaseProcess ??
    (await import("../release/release-process.ts")).localReleaseProcess(root);
  return { environment, process };
}
async function runPublishJsr(
  root: URL,
  dependencies: ReleaseServices,
): Promise<CliResult> {
  const { environment, process } = await releaseContext(root, dependencies);
  const publisher = await import("../release/publish-jsr.ts");
  const files = dependencies.publisherFiles ??
    (await import("../release/publisher-input.ts")).localPublisherFiles(root);
  await publisher.publishJsr({
    environment,
    process,
    files,
    packageFiles: dependencies.packageFiles ??
      publisher.localPackageFiles(root),
    api: dependencies.jsrApi ??
      publisher.jsrHttpApi((url, init) => fetch(url, init)),
    clock: dependencies.releaseClock,
  });
  return { output: "JSR publication finished.", terminalNewline: true };
}

async function runPublishGithub(
  root: URL,
  dependencies: ReleaseServices,
): Promise<CliResult> {
  const { environment, process } = await releaseContext(root, dependencies);
  const publisher = await import("../release/publish-github.ts");
  const files = dependencies.publisherFiles ??
    (await import("../release/publisher-input.ts")).localPublisherFiles(root);
  const api = dependencies.githubReleaseApi ?? publisher.githubReleaseApi(
    process,
    requiredEnvironment(environment, "GITHUB_REPOSITORY"),
  );
  await publisher.publishGithub({ environment, process, files, api });
  return {
    output: "GitHub Release publication finished.",
    terminalNewline: true,
  };
}

async function runPublishTagPrepare(
  root: URL,
  dependencies: ReleaseServices,
): Promise<CliResult> {
  const { environment, process } = await releaseContext(root, dependencies);
  if (environment.get("HJ_RELEASE_ROUTE") === "source-validation") {
    const base = requiredEnvironment(environment, "HJ_SOURCE_BASE_SHA");
    const head = requiredEnvironment(environment, "HJ_SOURCE_HEAD_SHA");
    const { validateSourceCommitRange } = await import(
      "../release/source-commit-validation.ts"
    );
    await validateSourceCommitRange(process, base, head);
    return { output: "Source commits are valid.", terminalNewline: true };
  }
  const { publishTagPrepare } = await import(
    "../release/publish-tag-prepare.ts"
  );
  const result = await publishTagPrepare(root, environment, process);
  return { output: result.output, terminalNewline: true };
}

async function runPublishTagApply(
  root: URL,
  dependencies: ReleaseServices,
): Promise<CliResult> {
  const { environment, process } = await releaseContext(root, dependencies);
  const encoded = requiredEnvironment(environment, "HJ_RELEASE_BUNDLE");
  const digest = requiredEnvironment(environment, "HJ_RELEASE_BUNDLE_DIGEST");
  const { decodeReleaseBundle } = await import("../release/release-bundle.ts");
  const bundle = await decodeReleaseBundle(encoded, digest);
  const repository = githubRepository(
    requiredEnvironment(environment, "GITHUB_REPOSITORY"),
  );
  const { releaseBranch } = await import("../release/names.ts");
  const { publishTagGithub } = await import(
    "../release/publish-tag-github.ts"
  );
  const { publishTagApply } = await import(
    "../release/publish-tag-orchestration.ts"
  );
  const clock = dependencies.releaseClock ?? {
    now: () => Date.now(),
    sleep: (milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
  };
  await publishTagApply(
    root,
    environment,
    process,
    publishTagGithub(
      process,
      repository,
      releaseBranch(bundle.nextVersion),
    ),
    clock,
  );
  return { output: "Release apply route finished.", terminalNewline: true };
}

function githubRepository(value: string): { owner: string; name: string } {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(value);
  if (!match) throw new TypeError("GITHUB_REPOSITORY is invalid.");
  return { owner: match[1], name: match[2] };
}
