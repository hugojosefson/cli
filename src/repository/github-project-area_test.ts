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
                    repository: { nameWithOwner: "owner/repo" },
                    labels: {
                      nodes: [{ name: "area:cli" }],
                      pageInfo: { hasNextPage: partial },
                    },
                  },
                  fieldValueByName: invalid ? {} : null,
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
    actual: "",
    desired: "cli",
  }]);
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
