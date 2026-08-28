/** @module Complete built-in feature and capability registry. */

import type { FeatureRegistry } from "./feature-registry.ts";
import { denoCliFeature } from "./deno-cli-feature.ts";
import { denoFmtFeature } from "./deno-fmt-feature.ts";
import {
  denoLintFeature,
  denoTestFeature,
  denoTypecheckFeature,
} from "./deno-task-features.ts";
import { denoLibFeature } from "./deno-lib-feature.ts";
import { denoServerFeature } from "./deno-server-feature.ts";
import { gitFeature } from "./git-feature.ts";
import { readmeStaticFeature } from "./readme-static-feature.ts";
import { readmeBuildFeature } from "./readme-build-feature.ts";
import { licenseFeatures } from "./license-catalog.ts";
import {
  githubRepoFeature,
  githubSettingFeature,
  githubSettings,
} from "./github-features.ts";
import { githubCiFeature } from "./github-ci-feature.ts";
import {
  githubMainProtectionFeature,
  githubMainReviewFeature,
  githubProtectedTagsFeature,
} from "./github-protection-features.ts";

/** Features available without repository-specific configuration. */
export const builtInFeatureRegistry: FeatureRegistry = {
  features: [
    denoCliFeature,
    denoFmtFeature,
    denoLintFeature,
    denoTypecheckFeature,
    denoTestFeature,
    denoLibFeature,
    denoServerFeature,
    gitFeature,
    githubRepoFeature,
    githubCiFeature,
    githubMainProtectionFeature,
    githubMainReviewFeature,
    githubProtectedTagsFeature,
    ...githubSettings.map(githubSettingFeature),
    ...licenseFeatures,
    readmeStaticFeature,
    readmeBuildFeature,
  ],
  capabilities: [{ id: "deno-export", providerPolicy: "multiple" }, {
    id: "license",
    providerPolicy: "exclusive",
    defaultProvider: "license-mit",
  }, {
    id: "readme",
    providerPolicy: "exclusive",
    defaultProvider: "readme-static",
  }],
  presets: [{
    id: "github",
    name: "GitHub",
    summary: "Apply common GitHub repository settings.",
    changes: [
      { featureId: "github-repo", enabled: true },
      ...githubSettings.map((setting) => ({
        featureId: setting.id,
        enabled: setting.enabled,
      })),
    ],
  }, {
    id: "github-protection",
    name: "GitHub protection",
    summary: "Protect the default branch and tags.",
    changes: [
      { featureId: "github-main-protection", enabled: true },
      { featureId: "github-main-review", enabled: true },
      { featureId: "github-protected-tags", enabled: true },
    ],
  }, {
    id: "github-public",
    name: "Public GitHub repository",
    summary: "Make the GitHub repository public.",
    changes: [{ featureId: "github-private", enabled: false }],
  }],
};
