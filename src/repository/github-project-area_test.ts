import { assertEquals, assertRejects } from "@std/assert";
import {
  areaFromLabels,
  areaReady,
  GithubProjectArea,
} from "./github-project-area.ts";
import type { JsonObject } from "../api/json.ts";

Deno.test("Area extracts only nonempty area labels with stable ordering", () => {
  assertEquals(
    areaFromLabels([
      "bug",
      "area:docs",
      "area:cli",
      "area:docs",
      "area:",
      "area: ",
    ]),
    "cli, docs",
  );
  assertEquals(
    areaReady({ fieldId: "area", conflict: false, items: [] }),
    true,
  );
  assertEquals(areaReady({ conflict: false, items: [] }), false);
});
Deno.test("Area ignores other repositories and refuses partial labels", async () => {
  let partial = false;
  let invalid = false;
  let actual: string | null = null;
  let labels = ["area:cli"];
  const query = (source: string): Promise<JsonObject> =>
    Promise.resolve<JsonObject>(
      source.includes("fields(first")
        ? {
          node: {
            fields: { nodes: [{ id: "area", name: "Area", dataType: "TEXT" }] },
          },
        }
        : {
          node: {
            items: {
              nodes: [
                {
                  id: "other",
                  content: { repository: { nameWithOwner: "other/repo" } },
                },
                {
                  id: "own",
                  content: {
                    id: "issue",
                    number: 36,
                    repository: { nameWithOwner: "owner/repo" },
                    labels: {
                      nodes: labels.map((name) => ({ name })),
                      pageInfo: { hasNextPage: partial },
                    },
                  },
                  fieldValueByName: invalid
                    ? {}
                    : actual === null
                    ? null
                    : { text: actual },
                },
              ],
            },
          },
        },
    );
  const pages = async (read: (cursor: string | null) => Promise<unknown>) =>
    (await read(null) as { nodes: unknown[] }).nodes;
  const area = new GithubProjectArea(query, pages, "project", "owner/repo");
  assertEquals((await area.inspect()).items, [{
    id: "own",
    issueId: "issue",
    issueNumber: 36,
    actual: "",
    desired: "cli",
    addedAreas: ["cli"],
    missingLabels: [],
  }]);
  assertEquals(areaReady(await area.inspect()), false);
  actual = " docs, CLI, docs, ";
  labels = ["bug", "area:cli", "area:docs"];
  assertEquals(areaReady(await area.inspect()), true);
  assertEquals((await area.inspect()).items[0].desired, actual);
  labels = ["bug", "area:cli", "area:release"];
  assertEquals((await area.inspect()).items[0], {
    id: "own",
    issueId: "issue",
    issueNumber: 36,
    actual,
    desired: "CLI, docs, release",
    addedAreas: ["release"],
    missingLabels: ["area:docs"],
  });
  actual = "docs";
  labels = [];
  assertEquals((await area.inspect()).items[0], {
    id: "own",
    issueId: "issue",
    issueNumber: 36,
    actual: "docs",
    desired: "docs",
    addedAreas: [],
    missingLabels: ["area:docs"],
  });
  assertEquals(areaReady(await area.inspect()), false);
  actual = null;
  assertEquals(areaReady(await area.inspect()), true);
  partial = true;
  await assertRejects(() => area.inspect(), Error, "complete issue labels");
  partial = false;
  invalid = true;
  await assertRejects(() => area.inspect(), Error, "Area value");
  await assertRejects(
    () => area.synchronize({ conflict: true, items: [] }),
    Error,
    "one text field",
  );
});
