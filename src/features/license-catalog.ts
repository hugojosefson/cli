/** @module Built-in license providers and their trusted source declarations. */

import {
  createSpdxTextSource,
  type LicenseTextSource,
  type SpdxLicenseSourceDefinition,
} from "./license-spdx-source.ts";
import {
  createSpdxLicenseFeature,
  type SpdxLicenseProvider,
} from "./license-spdx-feature.ts";
import { apacheSourceDefinition } from "./license-apache-2.0-source.ts";
import { mitSourceDefinition } from "./license-mit-source.ts";

const templateCommit = "aa0399cd31350a2692d0f51f651fc2fd3d0a5dab";
const templateUrl = (file: string) =>
  `https://raw.githubusercontent.com/licenses/license-templates/${templateCommit}/templates/${file}`;
const template = (
  name: string,
  file: string,
  placeholders: SpdxLicenseSourceDefinition["placeholders"],
): SpdxLicenseSourceDefinition => ({
  name,
  url: templateUrl(file),
  placeholders,
});
const attributed = [
  { kind: "year" as const, marker: "{{ year }}" },
  { kind: "holder" as const, marker: "{{ organization }}" },
];
const attributedProject = [...attributed, {
  kind: "project" as const,
  marker: "{{ project }}",
}];

export const licenseCatalogDefinitions = [
  ["license-mit", mitSourceDefinition],
  ["license-apache-2.0", apacheSourceDefinition],
  ["license-gpl-2.0-only", template("GPL-2.0-only", "gpl2.txt", attributed)],
  [
    "license-gpl-3.0-only",
    template("GPL-3.0-only", "gpl3.txt", attributedProject),
  ],
  ["license-agpl-3.0-only", template("AGPL-3.0-only", "agpl3.txt", attributed)],
  ["license-isc", template("ISC", "isc.txt", attributed)],
  ["license-bsd-2-clause", template("BSD-2-Clause", "bsd2.txt", attributed)],
  [
    "license-bsd-3-clause",
    template("BSD-3-Clause", "bsd3.txt", attributedProject),
  ],
  ["license-mpl-2.0", template("MPL-2.0", "mpl.txt", [])],
  ["license-unlicense", template("Unlicense", "unlicense.txt", [])],
  ["license-cc0-1.0", template("CC0-1.0", "cc0.txt", [])],
  ["license-cc-by-4.0", template("CC-BY-4.0", "cc_by.txt", [])],
  ["license-cc-by-sa-4.0", template("CC-BY-SA-4.0", "cc_by_sa.txt", [])],
  ["license-cc-by-nd-4.0", template("CC-BY-ND-4.0", "cc_by_nd.txt", [])],
  ["license-cc-by-nc-4.0", template("CC-BY-NC-4.0", "cc_by_nc.txt", [])],
  [
    "license-cc-by-nc-sa-4.0",
    template("CC-BY-NC-SA-4.0", "cc_by_nc_sa.txt", []),
  ],
  [
    "license-cc-by-nc-nd-4.0",
    template("CC-BY-NC-ND-4.0", "cc_by_nc_nd.txt", []),
  ],
] as const satisfies readonly (readonly [
  string,
  SpdxLicenseSourceDefinition,
])[];

const sources = new Map<string, LicenseTextSource>(
  licenseCatalogDefinitions.map((
    [id, definition],
  ) => [id, createSpdxTextSource(definition)]),
);
export const licenseCatalog = licenseCatalogDefinitions.map((
  [id, definition],
) => ({
  id,
  definition,
  text: sources.get(id)!,
}));
export const licenseFeatures = licenseCatalog.map((provider) =>
  createSpdxLicenseFeature({
    ...provider,
    alternates: licenseCatalog.filter((alternate) =>
      alternate.id !== provider.id
    ),
  })
);

/** Builds a provider with injected sources for focused tests and compatibility. */
export function createCatalogLicenseFeature(
  id: string,
  source?: LicenseTextSource,
  alternate?: LicenseTextSource,
) {
  const provider = licenseCatalog.find((item) => item.id === id)!;
  return createSpdxLicenseFeature({
    ...provider,
    text: source ?? provider.text,
    alternates: source && alternate
      ? [{ ...licenseCatalog.find((item) => item.id !== id)!, text: alternate }]
      : licenseCatalog.filter((item) => item.id !== id),
  });
}

export function licenseProvider(id: string): SpdxLicenseProvider {
  const provider = licenseCatalog.find((item) => item.id === id)!;
  return {
    ...provider,
    alternates: licenseCatalog.filter((item) => item.id !== id),
  };
}
