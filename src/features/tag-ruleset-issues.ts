/** @module Tag ruleset conflicts with inspected definitions. */

import type { DetectionIssue } from "../api/feature-detection.ts";
import type {
  DetectionContext,
  GithubResource,
} from "../api/repository-context.ts";
import { canonical } from "../repository/canonical-ruleset.ts";
import {
  protectedTagsDefinition,
  protectedTagsGuardDefinition,
  releaseTagsDefinition,
  rulesetResource,
} from "./github-protection-definitions.ts";
import {
  githubReadDifference,
  githubReadResolution,
} from "./github-read-difference.ts";
import { jsonDifferences } from "./json-differences.ts";

export function tagRulesetIssues(
  context: DetectionContext,
  rulesets?: readonly GithubResource[],
): DetectionIssue[] {
  return [protectedTagsDefinition, releaseTagsDefinition].flatMap(
    (expected) => {
      const name = String(expected.name);
      const matches = rulesets?.filter((item) =>
        item.kind === rulesetResource && item.name === name
      );
      const observation = !matches
        ? githubReadDifference(
          context,
          name,
          "a readable repository ruleset list",
        )
        : !matches.length
        ? undefined
        : matches.length !== 1
        ? `${name}: expected one repository ruleset. Found ${matches.length} rulesets with this name.`
        : matches[0].sourceType !== "Repository"
        ? `${name}: expected sourceType=Repository. Found sourceType=${
          matches[0].sourceType ?? "missing"
        }.`
        : undefined;
      const differences =
        matches?.length === 1 && matches[0].sourceType === "Repository"
          ? jsonDifferences(
            expected,
            canonical(
              Object.fromEntries(
                Object.entries(matches[0].definition).filter(([key]) =>
                  key !== "id"
                ),
              ),
            ),
            name,
          )
          : [];
      if (
        matches?.length === 1 && matches[0].sourceType === "Repository" &&
        name === protectedTagsDefinition.name &&
        !jsonDifferences(
          protectedTagsGuardDefinition,
          canonical(
            Object.fromEntries(
              Object.entries(matches[0].definition).filter(([key]) =>
                key !== "id"
              ),
            ),
          ),
          name,
        ).length
      ) return [];
      if (!observation && !differences.length) return [];
      return [{
        code: "github-tag-ruleset-conflict",
        kind: "github-ruleset",
        subject: { kind: "github-ruleset", identifier: name },
        observation: observation ?? differences.join("\n"),
        resolution: !rulesets
          ? githubReadResolution(context)
          : `Correct the listed ${name} fields manually, or rename the custom ruleset before adopting managed protection. Preserve intentional protection rules.`,
      }];
    },
  );
}
