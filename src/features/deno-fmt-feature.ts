/** @module Built-in Deno formatting feature declaration. */

import type { Feature } from "../api/feature.ts";
import { checkDisableDenoFmt, checkEnableDenoFmt } from "./deno-fmt-checks.ts";
import { detectDenoFmt } from "./deno-fmt-detection.ts";
import { denoFmtFeatureId } from "./deno-fmt-inspection.ts";
import { planDisableDenoFmt, planEnableDenoFmt } from "./deno-fmt-plans.ts";

/** Adds and owns only the declared Deno formatting task definitions. */
export const denoFmtFeature: Feature = {
  metadata: {
    id: denoFmtFeatureId,
    name: "Deno formatting",
    summary: "Adds Deno formatting tasks without requiring Git.",
  },
  dependencies: { requires: [] },
  capabilities: { provides: [], requires: [] },
  detect: detectDenoFmt,
  checkEnable: checkEnableDenoFmt,
  planEnable: planEnableDenoFmt,
  checkDisable: checkDisableDenoFmt,
  planDisable: planDisableDenoFmt,
};
