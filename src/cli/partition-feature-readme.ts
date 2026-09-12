/** @module Attribution of selected license sections in newly created READMEs. */
import type { ChangePlan } from "../api/change-plan.ts";
import { licenseCatalog } from "../features/license-catalog.ts";
import {
  inspectLicenseSection,
  removeLicenseSection,
} from "../readme/license-section.ts";
import type { FileSnapshot, FileVersion } from "./feature-file-snapshot.ts";

/** Splits provider-prepared license content without rewriting validated files. */
export function partitionFeatureReadme(
  baseline: FileSnapshot,
  features: {
    readonly plan: ChangePlan;
    readonly files: Map<string, FileVersion | undefined>;
  }[],
): void {
  const license = features.find((feature) =>
    feature.plan.action === "enable" &&
    licenseCatalog.some((entry) => entry.id === feature.plan.featureId)
  );
  if (!license) return;
  const label =
    licenseCatalog.find((entry) => entry.id === license.plan.featureId)!
      .definition.name;
  for (const [index, feature] of features.entries()) {
    if (
      !["readme-static", "readme-build"].includes(feature.plan.featureId) ||
      features.indexOf(license) <= index
    ) continue;
    for (const [path, file] of feature.files) {
      if (
        !file || baseline.has(path) ||
        !/^(README\.md|readme\/README\.md)$/.test(path) ||
        license.files.has(path)
      ) continue;
      const text = new TextDecoder().decode(file.bytes);
      const section = inspectLicenseSection(
        text,
        label,
        path.startsWith("readme/") ? "../LICENSE" : "./LICENSE",
        [],
      );
      if (section.kind !== "exact") continue;
      let final = file;
      for (
        const intermediate of features.slice(index, features.indexOf(license))
      ) {
        const version = intermediate.files.get(path);
        if (!version) continue;
        const content = new TextDecoder().decode(version.bytes);
        const owned = inspectLicenseSection(
          content,
          label,
          path.startsWith("readme/") ? "../LICENSE" : "./LICENSE",
          [],
        );
        if (owned.kind !== "exact") {
          throw new Error(
            `Cannot attribute the selected license in ${path}; no feature commits were created.`,
          );
        }
        intermediate.files.set(path, {
          ...version,
          bytes: new TextEncoder().encode(
            removeLicenseSection(content, owned.section),
          ),
        });
        final = version;
      }
      license.files.set(path, final);
    }
  }
}
