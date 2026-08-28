/** @module Selected SPDX label for README provider-owned starter content. */

import type { OperationContext } from "../api/repository-context.ts";
import { licenseCatalog } from "./license-catalog.ts";

export function selectedLicenseLabel(
  context: OperationContext,
): string | undefined {
  const selected = context.resolvedChanges.find((change) =>
    change.enabled &&
    ["disabled", "drifted"].includes(
      context.detections.get(change.featureId)?.state ?? "",
    ) &&
    licenseCatalog.some((item) => item.id === change.featureId)
  );
  return licenseCatalog.find((item) => item.id === selected?.featureId)
    ?.definition.name;
}
