/** Synchronize project Area values and area:* labels without removing areas. */
import type { JsonObject } from "../api/json.ts";
import { object } from "./github-response.ts";

type Query = (query: string, variables: JsonObject) => Promise<JsonObject>;
type Pages = (
  read: (cursor: string | null) => Promise<unknown>,
) => Promise<unknown[]>;
export interface ProjectAreaSnapshot {
  readonly fieldId?: string;
  readonly conflict: boolean;
  readonly items: readonly {
    id: string;
    issueId: string;
    issueNumber: number;
    actual: string;
    desired: string;
    addedAreas: readonly string[];
    missingLabels: readonly string[];
  }[];
}
export function areaFromLabels(labels: readonly string[]): string {
  return [
    ...new Set(
      labels.filter((label) => label.startsWith("area:")).map((label) =>
        label.slice(5).trim()
      ).filter(Boolean),
    ),
  ].sort().join(", ");
}
export function areaReady(snapshot: ProjectAreaSnapshot): boolean {
  return !!snapshot.fieldId && !snapshot.conflict &&
    snapshot.items.every((item) =>
      item.actual === item.desired && item.missingLabels.length === 0
    );
}

function names(value: string): string[] {
  return [
    ...new Set(value.split(",").map((name) => name.trim()).filter(Boolean)),
  ];
}

function mergeAreas(actual: string, labels: readonly string[]) {
  const existing = names(actual);
  const labeled = names(areaFromLabels(labels));
  // GitHub label names are case-insensitive. Keep existing spelling and text
  // formatting when no Area value needs to be added.
  const has = (values: readonly string[], name: string) =>
    values.some((value) => value.toLowerCase() === name.toLowerCase());
  const additions = labeled.filter((name) => !has(existing, name));
  return {
    addedAreas: additions,
    desired: additions.length
      ? [...existing, ...additions].sort().join(", ")
      : actual,
    missingLabels: existing.filter((name) => !has(labeled, name))
      .map((name) => `area:${name}`),
  };
}
export class GithubProjectArea {
  constructor(
    readonly query: Query,
    readonly pages: Pages,
    readonly project: string,
    readonly repository: string,
  ) {}

  async inspect(): Promise<ProjectAreaSnapshot> {
    const fields = await this.pages(async (cursor) => {
      const data = await this.query(
        "query($project:ID!,$cursor:String){node(id:$project){... on ProjectV2{fields(first:100,after:$cursor){nodes{... on ProjectV2Field{id name dataType} ... on ProjectV2SingleSelectField{id name dataType} ... on ProjectV2MultiSelectField{id name dataType} ... on ProjectV2IterationField{id name dataType}}pageInfo{hasNextPage endCursor}}}}}",
        { project: this.project, cursor },
      );
      return object(data.node)?.fields;
    });
    const areas = fields.map(object).filter((field) => field?.name === "Area");
    if (
      areas.length > 1 || areas.length === 1 && areas[0]?.dataType !== "TEXT"
    ) return { conflict: true, items: [] };
    const fieldId = areas.length ? string(areas[0]?.id) : undefined;
    const nodes = await this.pages(async (cursor) => {
      const data = await this.query(
        'query($project:ID!,$cursor:String){node(id:$project){... on ProjectV2{items(first:100,after:$cursor){nodes{id content{... on Issue{id number repository{nameWithOwner} labels(first:100){nodes{name}pageInfo{hasNextPage}}}} fieldValueByName(name:"Area"){... on ProjectV2ItemFieldTextValue{text}}}pageInfo{hasNextPage endCursor}}}}}',
        { project: this.project, cursor },
      );
      return object(data.node)?.items;
    });
    const items: ProjectAreaSnapshot["items"][number][] = [];
    for (const node of nodes) {
      const item = object(node);
      const issue = object(item?.content);
      if (object(issue?.repository)?.nameWithOwner !== this.repository) {
        continue;
      }
      const labels = object(issue?.labels);
      if (
        !Array.isArray(labels?.nodes) ||
        object(labels.pageInfo)?.hasNextPage !== false
      ) throw new Error("Cannot read complete issue labels for Area.");
      const value = object(item?.fieldValueByName);
      if (value && typeof value.text !== "string") {
        throw new Error("Cannot read the project's Area value.");
      }
      if (!Number.isSafeInteger(issue?.number) || Number(issue?.number) < 1) {
        throw new Error("Cannot read GitHub Area issue number.");
      }
      const actual = value ? String(value.text) : "";
      items.push({
        id: string(item?.id),
        issueId: string(issue?.id),
        issueNumber: Number(issue!.number),
        actual,
        ...mergeAreas(
          actual,
          labels.nodes.map((label) => string(object(label)?.name)),
        ),
      });
    }
    return { fieldId, conflict: false, items };
  }

  async synchronize(snapshot: ProjectAreaSnapshot): Promise<void> {
    if (snapshot.conflict) {
      throw new Error("The project needs one text field named Area.");
    }
    let fieldId = snapshot.fieldId;
    if (!fieldId) {
      const result = await this.query(
        'mutation($project:ID!){createProjectV2Field(input:{projectId:$project,name:"Area",dataType:TEXT}){projectV2Field{... on ProjectV2Field{id}}}}',
        { project: this.project },
      );
      fieldId = string(
        object(object(result.createProjectV2Field)?.projectV2Field)?.id,
      );
    }
    const labelIds = new Map<string, string>();
    for (const item of snapshot.items) {
      const missingIds: string[] = [];
      for (const name of item.missingLabels) {
        const key = name.toLowerCase();
        let id = labelIds.get(key);
        if (!id) {
          id = await this.#ensureLabel(name);
          labelIds.set(key, id);
        }
        missingIds.push(id);
      }
      if (missingIds.length) {
        await this.query(
          "mutation($issue:ID!,$labels:[ID!]!){addLabelsToLabelable(input:{labelableId:$issue,labelIds:$labels}){labelable{... on Issue{id}}}}",
          { issue: item.issueId, labels: missingIds },
        );
      }
      if (item.actual !== item.desired) {
        await this.query(
          "mutation($project:ID!,$item:ID!,$field:ID!,$text:String!){updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,value:{text:$text}}){projectV2Item{id}}}",
          {
            project: this.project,
            item: item.id,
            field: fieldId,
            text: item.desired,
          },
        );
      }
    }
  }

  async #ensureLabel(label: string): Promise<string> {
    const [owner, name] = this.repository.split("/");
    const read = async () => {
      const data = await this.query(
        "query($owner:String!,$name:String!,$label:String!){repository(owner:$owner,name:$name){id label(name:$label){id}}}",
        { owner, name, label },
      );
      const repository = object(data.repository);
      const repositoryId = string(repository?.id);
      // Only an explicit null means the label does not exist.
      const id = repository?.label === null
        ? undefined
        : string(object(repository?.label)?.id);
      return { repositoryId, id };
    };
    const current = await read();
    if (current.id) return current.id;
    try {
      const result = await this.query(
        'mutation($repository:ID!,$name:String!){createLabel(input:{repositoryId:$repository,name:$name,color:"ededed"}){label{id}}}',
        { repository: current.repositoryId, name: label },
      );
      return string(object(object(result.createLabel)?.label)?.id);
    } catch (error) {
      // Another writer or an uncertain response can leave the label created.
      // Read before deciding to fail; never repeat the creation blindly.
      const after = await read();
      if (after.id) return after.id;
      throw error;
    }
  }
}

export function areaRepairDetails(snapshot: ProjectAreaSnapshot): string[] {
  const details: string[] = [];
  for (const item of snapshot.items) {
    const subject = `issue #${item.issueNumber}`;
    const quoted = (values: readonly string[]) =>
      values.map((value) => JSON.stringify(value)).join(", ");
    if (item.missingLabels.length) {
      details.push(
        `Add ${item.missingLabels.length === 1 ? "label" : "labels"} ${
          quoted(item.missingLabels)
        } to ${subject}.`,
      );
    }
    if (item.addedAreas.length) {
      details.push(
        `Add ${quoted(item.addedAreas)} to project Area for ${subject}.`,
      );
    }
  }
  return details;
}

function string(value: unknown): string {
  if (typeof value !== "string" || !value) {
    throw new Error("Cannot read GitHub Area data.");
  }
  return value;
}
