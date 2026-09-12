/** @module Repository default Projects v2 setup and issue synchronization. */
import type {
  GithubRepository,
  GithubResource,
  GithubResourceUpsert,
} from "../api/repository-context.ts";
import type { JsonObject } from "../api/json.ts";
import {
  githubCommandFailure,
  type GithubCommandRunner,
} from "./github-command.ts";
import { object } from "./github-response.ts";
import { digestBytes } from "./digest-bytes.ts";
import {
  areaReady,
  areaRepairDetails,
  GithubProjectArea,
  type ProjectAreaSnapshot,
} from "./github-project-area.ts";
import {
  backlogBeforeTodo,
  type ProjectStatusOption,
} from "./project-status-order.ts";

export const defaultProjectResource = "repository-default-project";
export const defaultProjectName = "default";
export const projectAccessResolution =
  "Check `gh auth status` for project access. If the project scope is missing, run `gh auth refresh -h github.com -s project`; if GitHub is rate limited, wait for its reset, then retry. Projects require read/write project access.";

interface Project {
  id: string;
  title: string;
  url: string;
  closed: boolean;
  linked: boolean;
}
interface Field {
  id: string;
  name: string;
  options?: (ProjectStatusOption & { id: string })[];
}
interface View {
  id: string;
  number: number;
  name: string;
  layout: string;
  filter: string;
  fieldIds: string[];
}
interface Issue {
  id: string;
  state: string;
}
interface Snapshot {
  ownerId: string;
  repositoryId: string;
  projects: Project[];
  fields: Field[];
  views: View[];
  area?: ProjectAreaSnapshot;
  missing: Issue[];
}

/** All reads are fresh. Unknown or partial responses never mean absence. */
export class GithubDefaultProjectClient {
  constructor(
    readonly runner: GithubCommandRunner,
    readonly repository: GithubRepository,
  ) {}

  async resource(): Promise<GithubResource> {
    return await this.#resource(await this.#inspect());
  }

  async #resource(snapshot: Snapshot): Promise<GithubResource> {
    const project = snapshot.projects.length === 1
      ? snapshot.projects[0]
      : undefined;
    const fieldConflict = ["Status", "Priority"].some((name) => {
      const fields = snapshot.fields.filter((field) => field.name === name);
      return fields.length > 1 || fields.length === 1 && !fields[0].options;
    });
    const boards = snapshot.views.filter((view) => view.name === "Board");
    const status = snapshot.fields.find((field) => field.name === "Status");
    let statusOrderReady = false;
    let statusConflict = false;
    try {
      statusOrderReady = !!status?.options &&
        !backlogBeforeTodo(status.options);
    } catch {
      statusConflict = true;
    }
    const conflictDetails = [
      ...(snapshot.projects.length > 1
        ? [
          `Expected one default project. Found ${snapshot.projects.length}: ${
            snapshot.projects.map((item) => item.url).join(", ")
          }.`,
        ]
        : []),
      ...(project?.closed
        ? [`${project.url}: expected an open project. Found closed=true.`]
        : []),
      ...["Status", "Priority"].flatMap((name) => {
        const fields = snapshot.fields.filter((field) => field.name === name);
        return fields.length > 1
          ? [
            `Project ${name}: expected one single-select field. Found ${fields.length} fields.`,
          ]
          : fields.length === 1 && !fields[0].options
          ? [
            `Project ${name}: expected a single-select field with options. Found a field without single-select options.`,
          ]
          : [];
      }),
      ...(statusConflict
        ? [
          `Project Status: expected unique Backlog and Todo options. Found Backlog=${
            status?.options?.filter((item) => item.name === "Backlog").length ??
              0
          }, Todo=${
            status?.options?.filter((item) => item.name === "Todo").length ?? 0
          }.`,
        ]
        : []),
      ...(boards.length > 1
        ? [`Project Board: expected one view. Found ${boards.length} views.`]
        : []),
      ...boards.filter((view) => view.layout !== "BOARD_LAYOUT").map((view) =>
        `Project Board view ${view.number}: expected layout=BOARD_LAYOUT. Found layout=${view.layout}.`
      ),
      ...(snapshot.area?.conflictDetails ?? []),
    ];
    const definition = {
      candidates: snapshot.projects.length,
      projectId: project?.id ?? null,
      url: project?.url ?? null,
      linked: project?.linked ?? false,
      closed: project?.closed ?? false,
      fieldConflict: fieldConflict || statusConflict ||
        snapshot.area?.conflict || boards.length > 1 ||
        boards.some((view) => view.layout !== "BOARD_LAYOUT"),
      hasStatus: snapshot.fields.some((field) => field.name === "Status"),
      hasPriority: snapshot.fields.some((field) => field.name === "Priority"),
      areaReady: !!snapshot.area && areaReady(snapshot.area),
      hasWork: snapshot.views.some((view) => view.name === "Work"),
      areaVisible: !!snapshot.area?.fieldId &&
        snapshot.views.filter((view) => ["Work", "Board"].includes(view.name))
          .every((view) => view.fieldIds.includes(snapshot.area!.fieldId!)),
      hasBoard: boards.length === 1 && boards[0].layout === "BOARD_LAYOUT",
      boardUrl: project && boards.length === 1
        ? `${project.url}/views/${boards[0].number}`
        : null,
      statusOrderReady,
      missingIssues: snapshot.missing.length,
    };
    const repairDetails: string[] = [];
    if (!definition.hasStatus) {
      repairDetails.push("Create project Status field.");
    }
    if (!definition.hasPriority) {
      repairDetails.push("Create project Priority field.");
    }
    if (!definition.hasBoard) repairDetails.push("Set up project Board view.");
    if (!definition.hasWork) repairDetails.push("Create project Work view.");
    if (!snapshot.area?.fieldId) {
      repairDetails.push("Create project Area text field.");
    }
    if (!definition.areaVisible) {
      repairDetails.push("Show Area in project Work and Board views.");
    }
    if (!definition.statusOrderReady && definition.hasStatus) {
      repairDetails.push(
        "Place Backlog before Todo in project Status options.",
      );
    }
    if (definition.missingIssues) {
      repairDetails.push(
        `Add ${definition.missingIssues} missing repository issue(s) to the project.`,
      );
    }
    if (snapshot.area) repairDetails.push(...areaRepairDetails(snapshot.area));
    return {
      kind: defaultProjectResource,
      name: defaultProjectName,
      definition: { ...definition, repairDetails, conflictDetails },
      stateDigest: await digestBytes(
        new TextEncoder().encode(JSON.stringify(snapshot)),
      ),
    };
  }

  async upsert(change: GithubResourceUpsert): Promise<void> {
    if (
      change.name !== defaultProjectName ||
      typeof change.definition.enabled !== "boolean"
    ) throw new Error("unsupported GitHub project change");
    const snapshot = await this.#inspect();
    const current = await this.#resource(snapshot);
    if (current.stateDigest !== change.expectedStateDigest) {
      throw new Error("GitHub resource precondition failed");
    }
    if (
      snapshot.projects.length > 1 || current.definition.fieldConflict ||
      current.definition.closed
    ) throw new Error("Resolve the conflicting default GitHub project first.");
    let project = snapshot.projects[0];
    if (!change.definition.enabled) {
      if (project?.linked) {
        await this.#query(
          "mutation($project:ID!,$repository:ID!){unlinkProjectV2FromRepository(input:{projectId:$project,repositoryId:$repository}){clientMutationId}}",
          { project: project.id, repository: snapshot.repositoryId },
        );
      }
      await this.#waitFor(false);
      return;
    }
    if (!project) {
      const data = await this.#query(
        "mutation($owner:ID!,$repository:ID!,$title:String!){createProjectV2(input:{ownerId:$owner,repositoryId:$repository,title:$title}){projectV2{id title url closed}}}",
        {
          owner: snapshot.ownerId,
          repository: snapshot.repositoryId,
          title: this.repository.name,
        },
      );
      project = parseProject(object(data.createProjectV2)?.projectV2, true);
    } else if (!project.linked) {
      await this.#query(
        "mutation($project:ID!,$repository:ID!){linkProjectV2ToRepository(input:{projectId:$project,repositoryId:$repository}){clientMutationId}}",
        { project: project.id, repository: snapshot.repositoryId },
      );
    }
    const fields = await this.#fields(project.id);
    for (
      const [name, options] of [
        ["Status", ["Backlog", "Todo", "In Progress", "Done"]],
        ["Priority", ["P1", "P2", "P3"]],
      ] as const
    ) {
      if (fields.some((field) => field.name === name)) continue;
      await this.#query(
        "mutation($project:ID!,$name:String!,$options:[ProjectV2SingleSelectFieldOptionInput!]!){createProjectV2Field(input:{projectId:$project,dataType:SINGLE_SELECT,name:$name,singleSelectOptions:$options}){projectV2Field{... on ProjectV2SingleSelectField{id}}}}",
        {
          project: project.id,
          name,
          options: options.map((name, index) => ({
            name,
            color: name.startsWith("P")
              ? ["RED", "YELLOW", "GREEN"][index]
              : ["GRAY", "GREEN", "YELLOW", "PURPLE"][index],
            description: name.startsWith("P")
              ? ["Foundational work", "Normal work", "Optional or later work"][
                index
              ]
              : name,
          })),
        },
      );
    }
    const status = (await this.#fields(project.id)).find((field) =>
      field.name === "Status"
    );
    const reordered = status?.options && backlogBeforeTodo(status.options);
    if (status && reordered) {
      await this.#query(
        "mutation($field:ID!,$options:[ProjectV2SingleSelectFieldOptionInput!]!){updateProjectV2Field(input:{fieldId:$field,singleSelectOptions:$options}){projectV2Field{... on ProjectV2SingleSelectField{id}}}}",
        {
          field: status.id,
          options: reordered.map((option) => ({
            ...(option.id ? { id: option.id } : {}),
            name: option.name,
            color: option.color,
            description: option.description,
          })),
        },
      );
    }
    await this.#ensureBoard(project.id);
    // Only initialize new items. Preserve existing priorities and board status.
    for (const issue of snapshot.missing) {
      const data = await this.#query(
        "mutation($project:ID!,$issue:ID!){addProjectV2ItemById(input:{projectId:$project,contentId:$issue}){item{id}}}",
        { project: project.id, issue: issue.id },
      );
      const item = requiredString(
        object(object(data.addProjectV2ItemById)?.item)?.id,
      );
      const option = status?.options?.find((option) =>
        option.name === (issue.state === "CLOSED" ? "Done" : "Todo")
      );
      if (status && option) {
        await this.#query(
          "mutation($project:ID!,$item:ID!,$field:ID!,$option:String!){updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,value:{singleSelectOptionId:$option}}){projectV2Item{id}}}",
          { project: project.id, item, field: status.id, option: option.id },
        );
      }
    }
    const area = this.#area(project.id);
    await area.synchronize(await area.inspect());
    await this.#ensureWork(project.id);
    await this.#waitFor(true);
  }

  async #waitFor(enabled: boolean): Promise<void> {
    // Project connections can lag successful mutations. Retry reads, not writes.
    for (let attempt = 0; attempt < 20; attempt++) {
      const { definition } = await this.resource();
      const ready = enabled
        ? definition.candidates === 1 && definition.linked &&
          !definition.closed && !definition.fieldConflict &&
          definition.hasStatus && definition.hasPriority &&
          definition.hasBoard && definition.hasWork && definition.areaReady &&
          definition.areaVisible && definition.statusOrderReady &&
          definition.missingIssues === 0
        : !definition.linked;
      if (ready) return;
      if (attempt < 19) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    throw new Error(
      `GitHub project changes are not visible yet. Retry --${
        enabled ? "" : "no-"
      }github-default-project --yes.`,
    );
  }

  async #inspect(): Promise<Snapshot> {
    let ownerId = "";
    let repositoryId = "";
    const nodes = await this.#pages(async (cursor) => {
      const data = await this.#query(
        "query($owner:String!,$name:String!,$cursor:String){repository(owner:$owner,name:$name){id owner{id ... on User{projectsV2(first:100,after:$cursor){nodes{id title url closed repositories(first:100){nodes{id}pageInfo{hasNextPage}}}pageInfo{hasNextPage endCursor}}} ... on Organization{projectsV2(first:100,after:$cursor){nodes{id title url closed repositories(first:100){nodes{id}pageInfo{hasNextPage}}}pageInfo{hasNextPage endCursor}}}}}}",
        { owner: this.repository.owner, name: this.repository.name, cursor },
      );
      const repository = object(data.repository);
      repositoryId = requiredString(repository?.id);
      const owner = object(repository?.owner);
      ownerId = requiredString(owner?.id);
      return owner?.projectsV2;
    });
    const all = nodes.map((node) => {
      const repositories = object(object(node)?.repositories);
      if (
        object(repositories?.pageInfo)?.hasNextPage !== false ||
        !Array.isArray(repositories?.nodes)
      ) {
        throw new Error(
          "Cannot read complete GitHub project repository links.",
        );
      }
      const ids = repositories.nodes.map((node) =>
        requiredString(object(node)?.id)
      );
      return parseProject(node, ids.includes(repositoryId));
    });
    // Prefer the repository name, then a single existing linked project.
    const named = all.filter((project) =>
      project.title === this.repository.name
    );
    const projects =
      (named.length ? named : all.filter((project) => project.linked))
        .sort((a, b) => a.id.localeCompare(b.id));
    const selected = projects.length === 1 ? projects[0] : undefined;
    const fields = selected ? await this.#fields(selected.id) : [];
    const items = selected ? await this.#items(selected.id) : [];
    const issues = await this.#issues();
    return {
      ownerId,
      repositoryId,
      projects,
      fields,
      views: selected ? await this.#views(selected.id) : [],
      area: selected ? await this.#area(selected.id).inspect() : undefined,
      missing: issues.filter((issue) => !items.includes(issue.id)),
    };
  }

  async #fields(project: string): Promise<Field[]> {
    const nodes = await this.#pages(async (cursor) => {
      const data = await this.#query(
        "query($project:ID!,$cursor:String){node(id:$project){... on ProjectV2{fields(first:100,after:$cursor){nodes{... on ProjectV2Field{id name} ... on ProjectV2IterationField{id name} ... on ProjectV2MultiSelectField{id name} ... on ProjectV2SingleSelectField{id name options{id name color description}}}pageInfo{hasNextPage endCursor}}}}}",
        { project, cursor },
      );
      return object(data.node)?.fields;
    });
    return nodes.map((node) => {
      const field = object(node);
      return {
        id: requiredString(field?.id),
        name: requiredString(field?.name),
        ...(Array.isArray(field?.options)
          ? {
            options: field.options.map((option) => ({
              id: requiredString(object(option)?.id),
              name: requiredString(object(option)?.name),
              color: requiredString(object(option)?.color),
              description: typeof object(option)?.description === "string"
                ? String(object(option)!.description)
                : requiredString(undefined),
            })),
          }
          : {}),
      };
    }).sort((a, b) => a.id.localeCompare(b.id));
  }

  async #views(project: string): Promise<View[]> {
    const nodes = await this.#pages(async (cursor) => {
      const data = await this.#query(
        "query($project:ID!,$cursor:String){node(id:$project){... on ProjectV2{views(first:100,after:$cursor){nodes{id number name layout filter configuration{visibleFields(first:100){nodes{... on ProjectV2Field{id} ... on ProjectV2SingleSelectField{id} ... on ProjectV2MultiSelectField{id} ... on ProjectV2IterationField{id}}pageInfo{hasNextPage}}}}pageInfo{hasNextPage endCursor}}}}}",
        { project, cursor },
      );
      return object(data.node)?.views;
    });
    return nodes.map((node) => {
      const view = object(node);
      if (!Number.isSafeInteger(view?.number) || Number(view?.number) < 1) {
        throw new Error("Cannot read GitHub project view number.");
      }
      const visible = object(object(view?.configuration)?.visibleFields);
      if (
        !Array.isArray(visible?.nodes) ||
        object(visible.pageInfo)?.hasNextPage !== false
      ) throw new Error("Cannot read complete view fields.");
      return {
        fieldIds: visible.nodes.map((field) =>
          requiredString(object(field)?.id)
        ),
        id: requiredString(view?.id),
        number: Number(view!.number),
        name: requiredString(view?.name),
        layout: requiredString(view?.layout),
        filter: view?.filter === null
          ? ""
          : typeof view?.filter === "string"
          ? view.filter
          : requiredString(undefined),
      };
    });
  }

  async #ensureBoard(project: string): Promise<void> {
    const views = await this.#views(project);
    if (
      views.some((view) =>
        view.name === "Board" && view.layout === "BOARD_LAYOUT"
      )
    ) return;
    // Converting GitHub's untouched initial view makes Board the landing view.
    // Other saved views keep their names, filters, and URLs.
    if (
      views.length === 1 && views[0].name === "View 1" &&
      views[0].layout === "TABLE_LAYOUT" && !views[0].filter
    ) {
      await this.#query(
        'mutation($view:ID!){updateProjectV2View(input:{viewId:$view,name:"Board",layout:BOARD_LAYOUT}){projectV2View{id}}}',
        { view: views[0].id },
      );
    } else {
      await this.#query(
        'mutation($project:ID!){createProjectV2View(input:{projectId:$project,name:"Board",layout:BOARD_LAYOUT}){projectV2View{id}}}',
        { project },
      );
    }
  }

  #area(project: string): GithubProjectArea {
    return new GithubProjectArea(
      (query, variables) => this.#query(query, variables),
      (read) => this.#pages(read),
      project,
      `${this.repository.owner}/${this.repository.name}`,
    );
  }

  async #ensureWork(project: string): Promise<void> {
    let views = await this.#views(project);
    if (!views.some((view) => view.name === "Work")) {
      await this.#query(
        'mutation($project:ID!){createProjectV2View(input:{projectId:$project,name:"Work",layout:TABLE_LAYOUT}){projectV2View{id}}}',
        { project },
      );
      views = await this.#views(project);
    }
    const fields = await this.#fields(project);
    const area = fields.find((field) => field.name === "Area");
    if (!area) {
      throw new Error(
        "The project's Area field is not visible yet. Retry setup.",
      );
    }
    const title = fields.find((field) => field.name === "Title");
    for (
      const view of views.filter((view) =>
        ["Work", "Board"].includes(view.name)
      )
    ) {
      if (view.fieldIds.includes(area.id)) continue;
      const fieldIds = [...view.fieldIds];
      const index = title ? fieldIds.indexOf(title.id) + 1 : fieldIds.length;
      fieldIds.splice(index, 0, area.id);
      await this.#query(
        "mutation($view:ID!,$fields:[ID!]!){updateProjectV2View(input:{viewId:$view,configuration:{visibleFieldIds:$fields}}){projectV2View{id}}}",
        { view: view.id, fields: fieldIds },
      );
    }
  }

  async #items(project: string): Promise<string[]> {
    const nodes = await this.#pages(async (cursor) => {
      const data = await this.#query(
        "query($project:ID!,$cursor:String){node(id:$project){... on ProjectV2{items(first:100,after:$cursor){nodes{content{... on Issue{id}}}pageInfo{hasNextPage endCursor}}}}}",
        { project, cursor },
      );
      return object(data.node)?.items;
    });
    return nodes.flatMap((node) => {
      if (!object(node) || !("content" in object(node)!)) {
        throw new Error("Cannot read GitHub project items.");
      }
      const id = object(object(node)?.content)?.id;
      return typeof id === "string" ? [id] : [];
    });
  }

  async #issues(): Promise<Issue[]> {
    const nodes = await this.#pages(async (cursor) => {
      const data = await this.#query(
        "query($owner:String!,$name:String!,$cursor:String){repository(owner:$owner,name:$name){issues(first:100,after:$cursor){nodes{id state}pageInfo{hasNextPage endCursor}}}}",
        { owner: this.repository.owner, name: this.repository.name, cursor },
      );
      return object(data.repository)?.issues;
    });
    return nodes.map((node) => {
      const issue = object(node);
      if (issue?.state !== "OPEN" && issue?.state !== "CLOSED") {
        throw new Error("Cannot read GitHub issue state.");
      }
      return { id: requiredString(issue.id), state: issue.state };
    }).sort((a, b) => a.id.localeCompare(b.id));
  }

  async #pages(
    read: (cursor: string | null) => Promise<unknown>,
  ): Promise<unknown[]> {
    const nodes: unknown[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < 10_000; page++) {
      const connection = object(await read(cursor));
      const info = object(connection?.pageInfo);
      if (
        !Array.isArray(connection?.nodes) ||
        typeof info?.hasNextPage !== "boolean"
      ) {
        throw new Error("Cannot read complete GitHub project data.");
      }
      nodes.push(...connection.nodes);
      if (!info.hasNextPage) return nodes;
      cursor = requiredString(info.endCursor);
      if (seen.has(cursor)) throw new Error("Repeated GitHub project page.");
      seen.add(cursor);
    }
    throw new Error("GitHub project pagination limit reached.");
  }

  async #query(query: string, variables: JsonObject): Promise<JsonObject> {
    const args = ["api", "graphql", "--input", "-"];
    let result;
    try {
      result = await this.runner.run(
        args,
        JSON.stringify({ query, variables }),
      );
    } catch {
      throw new Error(githubCommandFailure(args));
    }
    if (!result.success) {
      throw new Error(
        `${githubCommandFailure(args, result)} ${projectAccessResolution}`,
      );
    }
    let response;
    try {
      response = object(JSON.parse(new TextDecoder().decode(result.stdout)));
    } catch { /* Report no raw response data. */ }
    const data = object(response?.data);
    if (!data || response?.errors) {
      throw new Error(
        `Cannot read GitHub project data. ${projectAccessResolution}`,
      );
    }
    return data;
  }
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value) {
    throw new Error("Cannot read GitHub project data.");
  }
  return value;
}
function parseProject(value: unknown, linked: boolean): Project {
  const project = object(value);
  if (typeof project?.closed !== "boolean") {
    throw new Error("Cannot read GitHub project state.");
  }
  return {
    id: requiredString(project.id),
    title: requiredString(project.title),
    url: requiredString(project.url),
    closed: project.closed,
    linked,
  };
}
