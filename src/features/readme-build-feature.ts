/** @module Generated README feature declaration. */

import type { Feature } from "../api/feature.ts";
import {
  checkDisableReadmeBuild,
  checkEnableReadmeBuild,
} from "./readme-build-checks.ts";
import { detectReadmeBuild } from "./readme-build-detection.ts";
import {
  planDisableReadmeBuild,
  planEnableReadmeBuild,
} from "./readme-build-plans.ts";
import { readmeBuildFeatureId } from "./readme-build-state.ts";

export const readmeBuildFeature: Feature = {
  metadata: {
    id: readmeBuildFeatureId,
    name: "Generated README",
    summary: "Generates a read-only README.md from readme/README.md.",
  },
  dependencies: {
    requires: [{
      featureId: "deno-fmt",
      reason: "Generated README tasks require Deno formatting.",
    }],
  },
  capabilities: { provides: ["readme"], requires: [] },
  detect: detectReadmeBuild,
  checkEnable: checkEnableReadmeBuild,
  planEnable: planEnableReadmeBuild,
  checkDisable: checkDisableReadmeBuild,
  planDisable: planDisableReadmeBuild,
};
