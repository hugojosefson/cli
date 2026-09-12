import type {
  AutoAddSnapshot,
  AutoAddTarget,
  ProjectWorkflow,
} from "./auto-add.ts";
export const target: AutoAddTarget = {
  projectUrl: "https://github.com/users/example/projects/10",
  repository: "example/cli",
  repositoryId: 42,
};
export const template: ProjectWorkflow = {
  name: "Auto-add to project",
  triggerType: "query_matched",
  enabled: false,
  contentTypes: ["Issue", "PullRequest"],
  actions: [
    { actionType: "get_items", arguments: { query: "is:open label:bug" } },
    { actionType: "add_project_item", arguments: {} },
  ],
};
export const before: AutoAddSnapshot = {
  projectId: 123,
  workflows: [],
  template,
  createUrl: "/memexes/123/workflows",
  updateUrl: "/memexes/123/workflows",
};
export const enabled: ProjectWorkflow = {
  ...template,
  id: 7,
  number: 3,
  enabled: true,
  contentTypes: ["Issue"],
  actions: [
    { actionType: "get_items", arguments: { repositoryId: 42, query: "" } },
    { actionType: "add_project_item", arguments: { repositoryId: 42 } },
  ],
};
export const after: AutoAddSnapshot = { ...before, workflows: [enabled] };
