import type { GithubCommandRunner } from "./github-command.ts";

export const projectConnection = (
  nodes: unknown[],
  endCursor: string | null = null,
) => ({
  nodes,
  pageInfo: { hasNextPage: endCursor !== null, endCursor },
});

/** Mutable API fixture: queries observe writes, including partial setup retries. */
export class ProjectFixture implements GithubCommandRunner {
  projects: Record<string, unknown>[] = [];
  fields: Record<string, unknown>[] = [
    {
      id: "status",
      name: "Status",
      options: [
        { id: "todo", name: "Todo" },
        { id: "progress", name: "In Progress" },
        { id: "done", name: "Done" },
      ],
    },
  ];
  views: Record<string, unknown>[] = [{
    id: "view1",
    number: 1,
    name: "View 1",
    layout: "TABLE_LAYOUT",
    filter: "",
  }];
  issues = [{ id: "open-issue", state: "OPEN" }, {
    id: "closed-issue",
    state: "CLOSED",
  }];
  items: { content: { id: string } | null }[] = [];
  assignments: Record<string, unknown>[] = [];
  areaValues = new Map<string, string>();
  issueLabels = new Map<string, string[]>();
  mutations: string[] = [];
  hasProjects = false;
  fail?: string;
  override?: (query: string, variables: Record<string, unknown>) => unknown;

  project(title = "repo", linked = true) {
    return {
      id: "project",
      title,
      url: "https://github.com/users/owner/projects/1",
      closed: false,
      repositories: projectConnection(linked ? [{ id: "repository" }] : []),
    };
  }

  run(args: readonly string[], stdin?: string) {
    const output = (data: unknown, success = true) => {
      const response = data as {
        data?: { node?: { fields?: { nodes?: Record<string, unknown>[] } } };
      };
      const nodes = response?.data?.node?.fields?.nodes;
      if (Array.isArray(nodes)) {
        for (const field of nodes) {
          field.dataType ??= Array.isArray(field.options)
            ? "SINGLE_SELECT"
            : "TEXT";
          if (Array.isArray(field?.options)) {
            field.options = field.options.map((option) => ({
              color: "GRAY",
              description: "",
              ...option,
            }));
          }
        }
      }
      return Promise.resolve({
        success,
        stdout: new TextEncoder().encode(JSON.stringify(data)),
        code: success ? 0 : 1,
      });
    };
    if (args[0] === "repo") {
      return output({
        nameWithOwner: "owner/repo",
        defaultBranchRef: { name: "main" },
      });
    }
    if (args.includes("repos/owner/repo")) {
      if (args.includes("PATCH")) {
        this.hasProjects = JSON.parse(stdin!).has_projects;
      }
      return output({ has_projects: this.hasProjects });
    }
    const { query, variables } = JSON.parse(stdin!);
    if (this.fail && query.includes(this.fail)) {
      return output({ errors: [{ message: "private details" }] }, false);
    }
    const override = this.override?.(query, variables);
    if (override !== undefined) return output(override);
    if (query.startsWith("mutation")) this.mutations.push(query);
    if (query.includes("createProjectV2(input")) {
      this.projects.push(this.project(variables.title));
      return output({
        data: { createProjectV2: { projectV2: this.projects[0] } },
      });
    }
    if (query.includes("unlinkProjectV2FromRepository(input")) {
      this.projects[0].repositories = projectConnection([]);
      return output({
        data: { unlinkProjectV2FromRepository: { clientMutationId: null } },
      });
    }
    if (query.includes("linkProjectV2ToRepository(input")) {
      this.projects[0].repositories = projectConnection([{ id: "repository" }]);
      return output({
        data: { linkProjectV2ToRepository: { clientMutationId: null } },
      });
    }
    if (query.includes("updateProjectV2Field(input")) {
      const field = this.fields.find((field) => field.id === variables.field)!;
      field.options = variables.options.map((
        option: Record<string, unknown>,
      ) => ({ ...option, id: option.id ?? String(option.name).toLowerCase() }));
      return output({
        data: { updateProjectV2Field: { projectV2Field: { id: field.id } } },
      });
    }
    if (query.includes("updateProjectV2View(input")) {
      const view = this.views.find((view) => view.id === variables.view)!;
      Object.assign(
        view,
        variables.fields
          ? { fieldIds: variables.fields }
          : { name: "Board", layout: "BOARD_LAYOUT" },
      );
      return output({
        data: {
          updateProjectV2View: { projectV2View: { id: variables.view } },
        },
      });
    }
    if (query.includes("createProjectV2View(input")) {
      const work = query.includes('name:"Work"');
      const view = {
        id: `view${this.views.length + 1}`,
        number: this.views.length + 1,
        name: work ? "Work" : "Board",
        layout: work ? "TABLE_LAYOUT" : "BOARD_LAYOUT",
        filter: "",
        fieldIds: this.fields.filter((field) => field.name !== "Area").map((
          field,
        ) => field.id),
      };
      this.views.push(view);
      return output({
        data: { createProjectV2View: { projectV2View: { id: view.id } } },
      });
    }
    if (query.includes("views(first")) {
      return output({
        data: {
          node: {
            views: projectConnection(this.views.map((view) => ({
              ...view,
              configuration: {
                visibleFields: projectConnection(
                  ((view.fieldIds as string[] | undefined) ??
                    this.fields.filter((field) => field.name !== "Area").map((
                      field,
                    ) => String(field.id))).map((id) => ({ id })),
                ),
              },
            }))),
          },
        },
      });
    }
    if (query.includes("dataType:TEXT")) {
      this.fields.push({ id: "area", name: "Area", dataType: "TEXT" });
      return output({
        data: { createProjectV2Field: { projectV2Field: { id: "area" } } },
      });
    }
    if (query.includes('fieldValueByName(name:"Area")')) {
      const items = this.items.map((item) => {
        const issueId = item.content?.id;
        return {
          id: `item-${issueId}`,
          content: issueId
            ? {
              repository: { nameWithOwner: "owner/repo" },
              labels: projectConnection(
                (this.issueLabels.get(issueId) ?? []).map((name) => ({ name })),
              ),
            }
            : null,
          fieldValueByName: this.areaValues.has(`item-${issueId}`)
            ? { text: this.areaValues.get(`item-${issueId}`) }
            : null,
        };
      });
      return output({ data: { node: { items: projectConnection(items) } } });
    }
    if (query.includes("clearProjectV2ItemFieldValue(input")) {
      this.areaValues.delete(variables.item);
      return output({
        data: {
          clearProjectV2ItemFieldValue: {
            projectV2Item: { id: variables.item },
          },
        },
      });
    }
    if (query.includes("value:{text:$text}")) {
      this.areaValues.set(variables.item, variables.text);
      return output({
        data: {
          updateProjectV2ItemFieldValue: {
            projectV2Item: { id: variables.item },
          },
        },
      });
    }
    if (query.includes("createProjectV2Field(input")) {
      this.fields.push({
        id: variables.name,
        name: variables.name,
        options: variables.options.map((o: { name: string }) => ({
          id: o.name,
          name: o.name,
        })),
      });
      return output({
        data: {
          createProjectV2Field: { projectV2Field: { id: variables.name } },
        },
      });
    }
    if (query.includes("addProjectV2ItemById(input")) {
      if (!this.items.some((item) => item.content?.id === variables.issue)) {
        this.items.push({ content: { id: variables.issue } });
      }
      return output({
        data: {
          addProjectV2ItemById: { item: { id: "item-" + variables.issue } },
        },
      });
    }
    if (query.includes("updateProjectV2ItemFieldValue(input")) {
      this.assignments.push(variables);
      return output({
        data: {
          updateProjectV2ItemFieldValue: {
            projectV2Item: { id: variables.item },
          },
        },
      });
    }
    if (query.includes("projectsV2(first")) {
      return output({
        data: {
          repository: {
            id: "repository",
            owner: {
              id: "owner",
              projectsV2: projectConnection(this.projects),
            },
          },
        },
      });
    }
    if (query.includes("fields(first")) {
      return output({
        data: {
          node: { fields: projectConnection(structuredClone(this.fields)) },
        },
      });
    }
    if (query.includes("items(first")) {
      return output({
        data: { node: { items: projectConnection(this.items) } },
      });
    }
    if (query.includes("issues(first")) {
      return output({
        data: { repository: { issues: projectConnection(this.issues) } },
      });
    }
    throw new Error("Unexpected fixture request.");
  }
}
