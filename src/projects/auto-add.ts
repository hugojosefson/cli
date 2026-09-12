/** @module Guarded auto-add setup through GitHub's browser API or UI. */

export interface AutoAddTarget {
  readonly projectUrl: string;
  readonly boardUrl?: string;
  readonly repository: string;
  readonly repositoryId: number;
}
export interface ProjectWorkflow {
  readonly id?: number;
  readonly number?: number;
  readonly name: string;
  readonly triggerType: string;
  readonly contentTypes: readonly string[];
  readonly enabled: boolean;
  readonly actions: readonly {
    readonly id?: number;
    readonly actionType: string;
    readonly arguments: Record<string, unknown>;
  }[];
}
export interface AutoAddSnapshot {
  readonly projectId: number;
  readonly workflows: readonly ProjectWorkflow[];
  readonly template?: ProjectWorkflow;
  readonly createUrl?: string;
  readonly updateUrl?: string;
}
export interface AutoAddBrowser {
  /** Reload authoritative state, never cached React state or mutation responses. */
  inspect(): Promise<AutoAddSnapshot>;
  request(plan: AutoAddPlan): Promise<void>;
  configure(plan: AutoAddPlan): Promise<void>;
}
export interface AutoAddPlan {
  readonly target: AutoAddTarget;
  readonly before: AutoAddSnapshot;
  readonly existing?: ProjectWorkflow;
  readonly workflow: ProjectWorkflow;
}
export type AutoAddMethod = "auto" | "endpoint" | "browser";

/** Fallback is appropriate only when GitHub rejects the internal protocol. */
export class EndpointUnavailable extends Error {}
/** A timed-out write can have succeeded. Do not create again after this error. */
export class UncertainProjectWrite extends Error {}

export function validateAutoAddTarget(target: AutoAddTarget): void {
  const url = new URL(target.projectUrl);
  if (
    url.origin !== "https://github.com" || url.search || url.hash ||
    !/^\/(users|orgs)\/[\w-]+\/projects\/[1-9]\d*$/.test(url.pathname) ||
    !/^[\w-]+\/[\w.-]+$/.test(target.repository) ||
    !Number.isSafeInteger(target.repositoryId) || target.repositoryId < 1
  ) throw new Error("Invalid GitHub project or repository target.");
}

function isAutoAdd(workflow: ProjectWorkflow): boolean {
  return workflow.triggerType === "query_matched" &&
    workflow.actions.some((action) => action.actionType === "add_project_item");
}
function repositoryIds(workflow: ProjectWorkflow): unknown[] {
  return workflow.actions.filter((action) =>
    action.actionType === "get_items" ||
    action.actionType === "add_project_item"
  ).map((action) => action.arguments.repositoryId);
}
function exact(workflow: ProjectWorkflow, target: AutoAddTarget): boolean {
  const ids = repositoryIds(workflow);
  return isAutoAdd(workflow) && workflow.enabled && ids.length === 2 &&
    ids.every((id) => id === target.repositoryId) &&
    workflow.actions.length === 2 &&
    ["", "is:issue"].includes(
      String(
        workflow.actions.find((action) => action.actionType === "get_items")
          ?.arguments.query,
      ),
    ) &&
    workflow.contentTypes.length === 1 && workflow.contentTypes[0] === "Issue";
}

/** Do not replace narrower user filters or widen an existing custom workflow. */
export function planAutoAdd(
  target: AutoAddTarget,
  before: AutoAddSnapshot,
): AutoAddPlan | undefined {
  validateAutoAddTarget(target);
  const related = before.workflows.filter((workflow) =>
    isAutoAdd(workflow) && repositoryIds(workflow).includes(target.repositoryId)
  );
  if (related.length === 1 && exact(related[0], target)) return undefined;
  if (related.length > 1) {
    throw new Error(
      "Multiple auto-add workflows target this repository. Resolve them in GitHub first.",
    );
  }
  const existing = related[0];
  if (existing) {
    if (!exact({ ...existing, enabled: true }, target)) {
      throw new Error(
        "An existing auto-add workflow has a custom filter or actions. Preserve or adjust it in GitHub first.",
      );
    }
  }
  const template = existing ?? before.template;
  if (!template || !isAutoAdd(template)) {
    throw new Error(
      "GitHub's auto-add workflow template is unavailable. Open the project Workflows page while signed in.",
    );
  }
  const actions = template.actions.filter((action) =>
    action.actionType === "get_items" ||
    action.actionType === "add_project_item"
  );
  if (
    template.actions.length !== 2 || actions.length !== 2 ||
    new Set(actions.map((action) => action.actionType)).size !== 2
  ) {
    throw new Error("GitHub's auto-add workflow schema changed.");
  }
  const name = existing?.name ??
    (before.workflows.some((workflow) => workflow.name === template.name)
      ? `Auto-add ${target.repository}`
      : template.name);
  return {
    target,
    before,
    existing,
    workflow: {
      ...(existing ? { id: existing.id, number: existing.number } : {}),
      name,
      enabled: true,
      triggerType: "query_matched",
      contentTypes: ["Issue"],
      actions: actions.map((action) => ({
        ...(existing && action.id !== undefined ? { id: action.id } : {}),
        actionType: action.actionType,
        arguments: {
          repositoryId: target.repositoryId,
          ...(action.actionType === "get_items" ? { query: "is:issue" } : {}),
        },
      })),
    },
  };
}

export function workflowRequest(plan: AutoAddPlan): {
  url: string;
  method: "POST" | "PUT";
  body: Record<string, unknown>;
} {
  const value = plan.existing ? plan.before.updateUrl : plan.before.createUrl;
  if (!value) {
    throw new EndpointUnavailable(
      "GitHub did not expose the workflow endpoint.",
    );
  }
  const url = new URL(value, plan.target.projectUrl);
  if (
    url.origin !== "https://github.com" ||
    url.pathname !== `/memexes/${plan.before.projectId}/workflows` ||
    url.search || url.hash
  ) {
    throw new EndpointUnavailable("GitHub's workflow endpoint changed.");
  }
  const { id: _id, number: _number, ...workflow } = plan.workflow;
  if (plan.existing) {
    if (!Number.isSafeInteger(plan.existing.number)) {
      throw new EndpointUnavailable("The workflow number is unavailable.");
    }
    return {
      url: url.href,
      method: "PUT",
      body: { workflowNumber: plan.existing.number, enabled: true },
    };
  }
  return { url: url.href, method: "POST", body: { workflow } };
}

export function sameWorkflows(
  left: AutoAddSnapshot,
  right: AutoAddSnapshot,
): boolean {
  const normalized = (snapshot: AutoAddSnapshot) =>
    JSON.stringify({
      projectId: snapshot.projectId,
      workflows: [...snapshot.workflows].sort((a, b) =>
        (a.id ?? 0) - (b.id ?? 0)
      ),
    });
  return normalized(left) === normalized(right);
}

export async function enableProjectAutoAdd(
  target: AutoAddTarget,
  browser: AutoAddBrowser,
  method: AutoAddMethod = "auto",
): Promise<"unchanged" | "endpoint" | "browser"> {
  const before = await browser.inspect();
  const plan = planAutoAdd(target, before);
  if (!plan) return "unchanged";
  if (!sameWorkflows(before, await browser.inspect())) {
    throw new Error(
      "GitHub workflows changed during setup. Retry the command.",
    );
  }
  let used: "endpoint" | "browser" = method === "browser"
    ? "browser"
    : "endpoint";
  if (used === "endpoint") {
    try {
      await browser.request(plan);
    } catch (error) {
      // Refresh before deciding whether to fall back: a failed response can
      // follow a successful write, so a blind second POST can create duplicates.
      const after = await browser.inspect();
      if (!planAutoAdd(target, after)) return "endpoint";
      if (method !== "auto" || !(error instanceof EndpointUnavailable)) {
        throw error;
      }
      if (!sameWorkflows(before, after)) {
        throw new Error(
          "GitHub workflows changed after the endpoint request. Review them before retrying.",
        );
      }
      used = "browser";
    }
  }
  if (used === "browser") await browser.configure(plan);
  const after = await browser.inspect();
  if (planAutoAdd(target, after)) {
    throw new Error(
      "GitHub did not confirm the auto-add workflow. Review the project Workflows page before retrying.",
    );
  }
  return used;
}
