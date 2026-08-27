/** @module SPDX MIT license provider. */

import {
  apacheSourceDefinition,
  createApacheTextSource,
} from "./license-apache-2.0-source.ts";
import { createSpdxLicenseFeature } from "./license-spdx-feature.ts";
import {
  createMitTextSource,
  type LicenseTextSource,
  mitSourceDefinition,
} from "./license-mit-source.ts";

export const licenseMitFeatureId = "license-mit";

export function createLicenseMitFeature(
  source: LicenseTextSource = createMitTextSource(),
  alternate: LicenseTextSource = createApacheTextSource(),
) {
  return createSpdxLicenseFeature({
    id: licenseMitFeatureId,
    definition: mitSourceDefinition,
    text: source,
    alternates: [{
      id: "license-apache-2.0",
      definition: apacheSourceDefinition,
      text: alternate,
    }],
  });
}

export const licenseMitFeature = createLicenseMitFeature();
