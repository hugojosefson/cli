import { assertEquals, assertRejects } from "@std/assert";
import { resolveLicenseAttribution } from "./license-attribution.ts";

Deno.test("license attribution prefers Github, then Git, then prompt", async () => {
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
