import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
import { assert, assertStringIncludes } from "@std/assert";
import { githubCommandFailure } from "./github-command.ts";

const test = trackTests(import.meta.url, nativeTest);

test("plan restrictions name the rejected resource without command or response secrets", () => {
  for (
    const [endpoint, expected] of [
      ["repos/owner/repo/branches/main/protection", "branch protection"],
      [
        "repos/owner/repo/branches/feature/branch/protection",
        "branch protection",
      ],
      [
        "repos/owner/repo/rulesets?includes_parents=true",
        "repository rulesets",
      ],
      ["repos/owner/repo/rulesets/123", "repository rulesets"],
      ["repos/owner/repo", "the repository API request"],
      ["private-token", "the repository API request"],
    ]
  ) {
    const message = githubCommandFailure(["api", endpoint, "private-token"], {
      success: false,
      code: 1,
      stdout: new TextEncoder().encode(JSON.stringify({
        message:
          "Upgrade to GitHub Pro or make this repository public to enable this feature.",
        other: "private-token",
      })),
      stderr: new TextEncoder().encode("HTTP 403 private-token"),
    });
    assertStringIncludes(message, `GitHub rejected ${expected} (HTTP 403).`);
    assert(!message.includes("private-token"));
    assert(!message.includes("gh auth"));
  }
});
