/** Project Area values are derived from this repository's area:* labels. */
import type { JsonObject } from "../api/json.ts";
import { object } from "./github-response.ts";

type Query = (query: string, variables: JsonObject) => Promise<JsonObject>;
type Pages = (
  read: (cursor: string | null) => Promise<unknown>,
) => Promise<unknown[]>;
export interface ProjectAreaSnapshot {
  readonly fieldId?: string;
  readonly conflict: boolean;
  readonly items: readonly { id: string; actual: string; desired: string }[];
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
    snapshot.items.every((item) => item.actual === item.desired);
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
        'query($project:ID!,$cursor:String){node(id:$project){... on ProjectV2{items(first:100,after:$cursor){nodes{id content{... on Issue{repository{nameWithOwner} labels(first:100){nodes{name}pageInfo{hasNextPage}}}} fieldValueByName(name:"Area"){... on ProjectV2ItemFieldTextValue{text}}}pageInfo{hasNextPage endCursor}}}}}',
        { project: this.project, cursor },
      );
      return object(data.node)?.items;
    });
    const items: { id: string; actual: string; desired: string }[] = [];
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
      items.push({
        id: string(item?.id),
        actual: value ? String(value.text) : "",
        desired: areaFromLabels(
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
    for (const item of snapshot.items) {
      if (item.actual === item.desired) continue;
      if (!item.desired) {
        await this.query(
          "mutation($project:ID!,$item:ID!,$field:ID!){clearProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field}){projectV2Item{id}}}",
          { project: this.project, item: item.id, field: fieldId },
        );
      } else {
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
}
function string(value: unknown): string {
  if (typeof value !== "string" || !value) {
    throw new Error("Cannot read GitHub Area data.");
  }
  return value;
}
