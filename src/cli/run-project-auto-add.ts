/** Optional, explicit browser automation for the repository's default project. */
import {
  type AutoAddMethod,
  type AutoAddTarget,
  enableProjectAutoAdd,
} from "../projects/auto-add.ts";
import {
  browserAddress,
  connectProjectBrowser,
  type ProjectPage,
} from "../projects/browser-connection.ts";
import { githubProjectBrowser } from "../projects/github-project-browser.ts";
import {
  githubCommandFailure,
  localGithubCommand,
} from "../repository/github-command.ts";
import { LocalGithubClient } from "../repository/local-github-client.ts";
import { defaultProjectResource } from "../repository/github-default-project.ts";
import { ensureGithubAuthentication } from "./github-authentication.ts";

export interface ProjectAutoAddOptions {
  readonly method: AutoAddMethod;
  readonly browserUrl: string;
}
export function parseProjectAutoAdd(
  args: readonly string[],
): ProjectAutoAddOptions {
  let method: AutoAddMethod = "auto";
  let browserUrl = "ws://127.0.0.1:9222/session";
  const seen = new Set<string>();
  for (const arg of args) {
    const flag = arg.split("=", 1)[0];
    if (seen.has(flag)) throw new Error(`Repeated option: ${flag}`);
    seen.add(flag);
    if (arg === "--yes") continue;
    if (
      arg.startsWith("--method=") &&
      ["auto", "endpoint", "browser"].includes(arg.slice(9))
    ) method = arg.slice(9) as AutoAddMethod;
    else if (arg.startsWith("--browser-url=")) {
      browserUrl = browserAddress(arg.slice(14));
    } else {throw new Error(
        "Expected --yes, --method=auto|endpoint|browser, or --browser-url=ws://127.0.0.1:9222/session.",
      );}
  }
  if (!seen.has("--yes")) {
    throw new Error(
      "Use --yes to enable automatic issue addition to the default project.",
    );
  }
  return { method, browserUrl };
}

export async function defaultAutoAddTarget(root: URL): Promise<AutoAddTarget> {
  await ensureGithubAuthentication(root);
  const runner = localGithubCommand(root);
  const github = new LocalGithubClient(root, runner);
  const repository = await github.repository();
  if (!repository) {
    throw new Error(
      "Link this repository to GitHub and sign in with gh first.",
    );
  }
  const project = await github.resource(defaultProjectResource, "default");
  if (
    !project || project.definition.candidates !== 1 ||
    !project.definition.linked || project.definition.closed ||
    typeof project.definition.url !== "string"
  ) {
    throw new Error(
      "Set up a default project with `hj repo features --github-default-project --yes` first.",
    );
  }
  const name = `${repository.owner}/${repository.name}`;
  const args = ["api", `repos/${name}`, "--jq", ".id"];
  const result = await runner.run(args);
  if (!result.success) throw new Error(githubCommandFailure(args, result));
  const repositoryId = Number(new TextDecoder().decode(result.stdout).trim());
  return {
    projectUrl: project.definition.url,
    ...(typeof project.definition.boardUrl === "string"
      ? { boardUrl: project.definition.boardUrl }
      : {}),
    repository: name,
    repositoryId,
  };
}

export async function runProjectAutoAdd(
  root: URL,
  options: ProjectAutoAddOptions,
  services: {
    readonly target?: (root: URL) => Promise<AutoAddTarget>;
    readonly connect?: (address: string) => Promise<ProjectPage>;
  } = {},
): Promise<string> {
  const target = await (services.target ?? defaultAutoAddTarget)(root);
  const page = await (services.connect ?? connectProjectBrowser)(
    options.browserUrl,
  );
  try {
    const method = await enableProjectAutoAdd(
      target,
      githubProjectBrowser(target, page),
      options.method,
    );
    return method === "unchanged"
      ? `Auto-add is already enabled: ${target.boardUrl ?? target.projectUrl}`
      : `Auto-add enabled via ${method}: ${
        target.boardUrl ?? target.projectUrl
      }`;
  } finally {
    await page.close();
  }
}
