import { assertEquals } from "@std/assert";
import { jsrPackageIdentity } from "./jsr-package-identity.ts";

for (
  const [name, repository, expected] of [
    [
      "normalizes repository case",
      { owner: "Owner", name: "Repository" },
      "@owner/repository",
    ],
    [
      "keeps valid hyphens",
      { owner: "my-org", name: "my-package" },
      "@my-org/my-package",
    ],
  ] as const
) {
  Deno.test(`JSR identity ${name}`, async () => {
    const identity = await jsrPackageIdentity(context(repository));
    if (identity.kind !== "available") throw new Error("expected identity");
    assertEquals(identity.name, expected);
  });
}

for (
  const [name, repository] of [
    ["rejects punctuation", { owner: "owner_name", name: "package" }],
    ["rejects leading hyphens", { owner: "-owner", name: "package" }],
    ["rejects trailing hyphens", { owner: "owner", name: "package-" }],
  ] as const
) {
  Deno.test(`JSR identity ${name}`, async () => {
    assertEquals(
      (await jsrPackageIdentity(context(repository))).kind,
      "unavailable",
    );
  });
}

Deno.test("JSR identity requires GitHub access", async () => {
  assertEquals((await jsrPackageIdentity(context())).kind, "unavailable");
});

function context(
  repository?: { readonly owner: string; readonly name: string },
) {
  return {
    github: repository
      ? { repository: () => Promise.resolve(repository) }
      : undefined,
  } as never;
}
