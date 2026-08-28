/** @module GitHub main-branch and tag-protection features. */

import {
  mainProtectionDefinition,
  mainReviewDefinition,
  protectedTagsDefinition,
} from "./github-protection-definitions.ts";
import { rulesetFeature } from "./github-protection-lifecycle.ts";

export const githubMainProtectionFeature = rulesetFeature(
  "github-main-protection",
  "default branch protection",
  [mainProtectionDefinition],
  [{
    featureId: "github-ci",
    reason: "Main protection requires generated GitHub CI.",
  }],
);
export const githubMainReviewFeature = rulesetFeature(
  "github-main-review",
  "strict main reviews",
  [mainReviewDefinition],
  [{
    featureId: "github-main-protection",
    reason: "Strict reviews layer on main protection.",
  }],
);
export const githubProtectedTagsFeature = rulesetFeature(
  "github-protected-tags",
  "protected tags",
  [protectedTagsDefinition],
  [{
    featureId: "github-repo",
    reason: "Tag protection requires a GitHub repository.",
  }],
);
