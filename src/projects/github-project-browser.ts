/** GitHub's session-bound workflow API with a DOM automation fallback. */
import {
  type AutoAddBrowser,
  type AutoAddPlan,
  type AutoAddSnapshot,
  type AutoAddTarget,
  EndpointUnavailable,
  type ProjectWorkflow,
  UncertainProjectWrite,
  validateAutoAddTarget,
  workflowRequest,
} from "./auto-add.ts";
import type { ProjectPage } from "./browser-connection.ts";

// These declarations describe only the DOM surface used in serialized scripts.
// Importing lib.dom would conflict with Deno's published runtime declarations.
interface BrowserElement {
  readonly textContent: string | null;
  readonly href: string;
  getClientRects(): readonly unknown[];
  click(): void;
  hasAttribute(name: string): boolean;
  dispatchEvent(event: Event): boolean;
}
interface BrowserInput extends BrowserElement {
  value: string;
}
interface BrowserDocument {
  getElementById(id: string): BrowserElement | null;
  querySelectorAll<T extends BrowserElement>(selector: string): T[];
}
declare const document: BrowserDocument;
declare const location: { origin: string; href: string };
declare const HTMLInputElement: {
  new (): BrowserInput;
  prototype: BrowserInput;
};
declare const DOMParser: {
  new (): { parseFromString(source: string, type: string): BrowserDocument };
};

export interface ProjectPageData {
  readonly url: string;
  readonly project: unknown;
  readonly privileges: unknown;
  readonly workflows: unknown;
  readonly configurations: unknown;
  readonly create: unknown;
  readonly update: unknown;
}

/** Runs inside the browser. Return only project metadata, never session tokens. */
export function readProjectPage(_unused: null): ProjectPageData {
  const read = (id: string) =>
    JSON.parse(document.getElementById(id)?.textContent || "null");
  return {
    url: location.href,
    project: read("memex-data"),
    privileges: read("memex-viewer-privileges"),
    workflows: read("memex-workflows-data"),
    configurations: read("memex-workflow-configurations-data"),
    create: read("memex-workflow-create-api-data"),
    update: read("memex-workflow-update-api-data"),
  };
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
function workflow(value: unknown): ProjectWorkflow {
  const data = object(value);
  if (
    typeof data.name !== "string" || typeof data.triggerType !== "string" ||
    typeof data.enabled !== "boolean" || !Array.isArray(data.contentTypes) ||
    !data.contentTypes.every((item) => typeof item === "string") ||
    !Array.isArray(data.actions) || !data.actions.every((item) => {
      const action = object(item);
      return typeof action.actionType === "string" && action.arguments &&
        typeof action.arguments === "object" &&
        !Array.isArray(action.arguments);
    })
  ) {
    throw new Error(
      "GitHub's workflow data changed. Review the project in Firefox.",
    );
  }
  return data as unknown as ProjectWorkflow;
}
export function parseProjectPage(
  target: AutoAddTarget,
  data: ProjectPageData,
): AutoAddSnapshot {
  validateAutoAddTarget(target);
  const url = new URL(data.url);
  const projectUrl = new URL(target.projectUrl);
  if (
    url.origin !== projectUrl.origin ||
    !(url.pathname === projectUrl.pathname + "/workflows" ||
      url.pathname.startsWith(projectUrl.pathname + "/workflows/")) ||
    !["write", "admin"].includes(String(object(data.privileges).role))
  ) {
    throw new Error(
      "Sign in to GitHub in Firefox with project write access, then retry.",
    );
  }
  const project = object(data.project);
  if (
    !Number.isSafeInteger(project.id) || Number(project.id) < 1 ||
    project.number !== Number(projectUrl.pathname.split("/").at(-1)) ||
    !Array.isArray(data.workflows) || !Array.isArray(data.configurations)
  ) {
    throw new Error("GitHub did not expose the expected project data.");
  }
  const workflows = data.workflows.map(workflow);
  const config = data.configurations.map(object).find((item) =>
    item.triggerType === "query_matched" &&
    Array.isArray(object(item.defaultWorkflow).actions) &&
    (object(item.defaultWorkflow).actions as unknown[]).some((action) =>
      object(action).actionType === "add_project_item"
    )
  );
  const endpoint = (value: unknown) =>
    typeof object(value).url === "string"
      ? String(object(value).url)
      : undefined;
  return {
    projectId: Number(project.id),
    workflows,
    template: config ? workflow(config.defaultWorkflow) : undefined,
    createUrl: endpoint(data.create),
    updateUrl: endpoint(data.update),
  };
}

/** Same-origin fetch in the signed-in tab; the gh token cannot call this API. */
export async function requestWorkflow(
  input: ReturnType<typeof workflowRequest> & { projectUrl: string },
): Promise<number> {
  if (
    location.origin !== "https://github.com" ||
    !location.href.startsWith(input.projectUrl + "/workflows")
  ) return 401;
  const response = await fetch(input.url, {
    method: input.method,
    mode: "same-origin",
    credentials: "same-origin",
    redirect: "error",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "GitHub-Verified-Fetch": "true",
    },
    body: JSON.stringify(input.body),
    signal: AbortSignal.timeout(15000),
  });
  return response.status;
}

/** Operates GitHub's visible controls, then lets GitHub submit its own request. */
export async function configureWorkflow(plan: AutoAddPlan): Promise<boolean> {
  if (
    location.origin !== "https://github.com" ||
    !location.href.startsWith(plan.target.projectUrl + "/workflows")
  ) throw new Error("Unexpected page.");
  const visible = (selector: string) =>
    [...document.querySelectorAll<BrowserElement>(selector)].filter((element) =>
      element.getClientRects().length
    );
  const wait = async (find: () => BrowserElement | undefined) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const element = find();
      if (element) return element;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("GitHub's workflow controls changed.");
  };
  const one = (selector: string) => {
    const found = visible(selector);
    return found.length === 1 ? found[0] : undefined;
  };
  const click = async (selector: string) =>
    (await wait(() => one(selector))).click();
  const buttonNamed = (text: string, scope = "main") => {
    const matches = visible(`${scope} button`).filter((element) =>
      element.textContent?.trim() === text
    );
    return matches.length === 1 ? matches[0] : undefined;
  };
  const editButton = () =>
    one('[data-testid="workflow-edit-button"]') ?? buttonNamed("Edit");
  const saveButton = () =>
    one('[data-testid="workflow-save-button"]') ??
      buttonNamed("Save and turn on workflow") ?? buttonNamed("Save workflow");
  const fill = (element: BrowserElement, text: string) => {
    if (!(element instanceof HTMLInputElement)) {
      throw new Error("Expected a text input.");
    }
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
      .call(element, text);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const links = visible('a[href*="/workflows/"]');
  let link: BrowserElement | undefined;
  let selectedName = plan.existing?.name ?? plan.before.template?.name;
  if (plan.existing) {
    link = links.find((item) =>
      new URL((item as BrowserElement).href).pathname.endsWith(
        `/workflows/${plan.existing!.id}`,
      )
    );
  } else {
    const source = plan.before.workflows.find((item) =>
      item.triggerType === "query_matched" &&
      item.actions.some((action) => action.actionType === "add_project_item")
    );
    selectedName = source?.name ?? selectedName;
    link = source
      ? links.find((item) =>
        new URL(item.href).pathname.endsWith(`/workflows/${source.id}`)
      )
      : links.find((item) =>
        item.textContent?.trim() === plan.before.template?.name
      );
  }
  if (!link) throw new Error("Auto-add navigation is unavailable.");
  const selectedPath = new URL(link.href).pathname;
  link.click();
  // React can leave the previous workflow's Edit button visible during routing.
  await wait(() =>
    new URL(location.href).pathname === selectedPath &&
      visible("main h2").some((item) =>
        item.textContent?.trim() === selectedName
      )
      ? editButton()
      : undefined
  );
  if (
    !plan.existing &&
    plan.before.workflows.some((item) =>
      item.triggerType === "query_matched" &&
      item.actions.some((action) => action.actionType === "add_project_item")
    )
  ) {
    const sourceId = new URL((link as BrowserElement).href).pathname.split(
      "/",
    ).at(-1);
    await click(`#workflow-nav-item-menu-${sourceId}`);
    const duplicate = await wait(() =>
      visible('button,[role="menuitem"]').find((item) =>
        item.textContent?.trim() === "Duplicate workflow"
      )
    );
    duplicate.click();
    const name = await wait(() => one('[role="dialog"] input'));
    fill(name, plan.workflow.name);
    (await wait(() =>
      one('[data-testid="new-workflow-dialog-create-button"]') ??
        buttonNamed("Duplicate", '[role="dialog"]')
    )).click();
  }
  const edit = editButton();
  if (edit) edit.click();
  if (!plan.existing) {
    (await wait(() =>
      one('[data-testid="repo-suggestions-button"]') ??
        one(
          'main button[aria-label^="When the filter matches a new or updated item"]',
        ) ?? buttonNamed("Select repository")
    )).click();
    const search = await wait(() =>
      one('[data-testid="repo-picker-repo-list"] input') ??
        one('[role="dialog"] input[placeholder="Search repositories"]')
    );
    fill(search, plan.target.repository);
    const repository = await wait(() => {
      const matches = visible(
        '[data-testid="repo-picker-repo-list"] [role="option"], [role="dialog"] [role="option"]',
      ).filter((item) =>
        item.textContent?.trim() ===
          (new URL(plan.target.projectUrl).pathname.split("/")[2] ===
              plan.target.repository.split("/")[0]
            ? plan.target.repository.split("/")[1]
            : plan.target.repository)
      );
      return matches.length === 1 ? matches[0] : undefined;
    });
    repository.click();
    const filter = await wait(() =>
      one("input#automation-filter, #automation-filter input")
    );
    fill(filter, "is:issue");
    // GitHub updates the content-type filter after its 200 ms input debounce.
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  // Re-read persisted state before Save. Never overwrite a concurrent edit.
  const response = await fetch(plan.target.projectUrl + "/workflows", {
    credentials: "same-origin",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Could not refresh workflow state.");
  const doc = new DOMParser().parseFromString(
    await response.text(),
    "text/html",
  );
  const workflows = JSON.parse(
    doc.getElementById("memex-workflows-data")?.textContent || "null",
  );
  const normalize = (value: unknown): string =>
    JSON.stringify(
      value,
      (_key, item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? Object.fromEntries(
            Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
          )
          : item,
    );
  if (
    !Array.isArray(workflows) ||
    normalize(workflows) !== normalize(plan.before.workflows)
  ) throw new Error("Workflows changed before Save.");
  const save = await wait(() => {
    const button = saveButton();
    return button && !button.hasAttribute("disabled") ? button : undefined;
  });
  if (!save.textContent?.includes("turn on")) {
    throw new Error("GitHub did not offer to enable this workflow.");
  }
  save.click();
  await wait(editButton);
  return true;
}

export function githubProjectBrowser(
  target: AutoAddTarget,
  page: ProjectPage,
): AutoAddBrowser {
  validateAutoAddTarget(target);
  return {
    async inspect() {
      await page.navigate(target.projectUrl + "/workflows");
      return parseProjectPage(
        target,
        await page.evaluate(readProjectPage, null),
      );
    },
    async request(plan) {
      const request = workflowRequest(plan);
      let status: number;
      try {
        status = await page.evaluate(requestWorkflow, {
          ...request,
          projectUrl: target.projectUrl,
        });
      } catch {
        throw new UncertainProjectWrite(
          "The endpoint response was lost. Review the workflow before retrying.",
        );
      }
      if ([404, 405, 410].includes(status)) {
        throw new EndpointUnavailable(
          "GitHub rejected the internal workflow endpoint.",
        );
      }
      if (status < 200 || status >= 300) {
        throw new Error(
          `GitHub rejected workflow setup (HTTP ${status}). Review project access and workflow limits.`,
        );
      }
    },
    async configure(plan) {
      await page.evaluate(configureWorkflow, plan);
    },
  };
}
