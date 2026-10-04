import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { assertEquals, assertRejects } from "@std/assert";
import { resolveLicenseAttribution } from "./license-attribution.ts";

test("license attribution prefers Github, then Git, then prompt", async () => {
  const names: string[] = [];
  const context = (github?: string, git?: string) => ({
    githubIdentity: github
      ? { viewer: () => Promise.resolve({ name: github }) }
      : undefined,
    git: { userName: () => Promise.resolve(git) },
  });
  const prompt = () => {
    names.push("prompt");
    return "Prompt";
  };
  assertEquals(
    (await resolveLicenseAttribution(context("Github", "Git"), prompt))
      .licenseHolder,
    "Github",
  );
  assertEquals(
    (await resolveLicenseAttribution(context(undefined, "Git"), prompt))
      .licenseHolder,
    "Git",
  );
  assertEquals(
    (await resolveLicenseAttribution(context(), prompt)).licenseHolder,
    "Prompt",
  );
  assertEquals(names, ["prompt"]);
  assertEquals(
    (await resolveLicenseAttribution(context(undefined, "Git"), prompt))
      .licenseYear,
    String(new Date().getUTCFullYear()),
  );
  await assertRejects(
    () => resolveLicenseAttribution(context(), () => undefined),
    Error,
    "License attribution is required",
  );
});

test("license attribution rejects a placeholder from each identity source", async () => {
  for (const holder of ["[fullname]", "<copyright holders>", "Your Name"]) {
    for (const source of ["github", "git", "prompt"]) {
      await assertRejects(
        () =>
          resolveLicenseAttribution({
            githubIdentity: {
              viewer: () =>
                Promise.resolve(
                  source === "github" ? { name: holder } : undefined,
                ),
            },
            git: {
              userName: () =>
                Promise.resolve(source === "git" ? holder : undefined),
            },
          }, () => holder),
        Error,
        "License attribution is required",
      );
    }
  }
});
