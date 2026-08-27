/** @module Safe SPDX LICENSE provider implementation. */

import type { ChangePlan } from "../api/change-plan.ts";
import type { Feature } from "../api/feature.ts";
import type { OperationCheck } from "../api/feature-operation.ts";
import type {
  DetectionContext,
  OperationContext,
} from "../api/repository-context.ts";
import type {
  LicenseTextSource,
  SpdxLicenseSourceDefinition,
} from "./license-spdx-source.ts";

const path = "LICENSE";
type Attribution = { readonly year: string; readonly holder: string };
type Source = {
  readonly id: string;
  readonly definition: SpdxLicenseSourceDefinition;
  readonly text: LicenseTextSource;
};
type State =
  | { readonly kind: "absent" }
  | { readonly kind: "alternate"; readonly digest: string }
  | { readonly kind: "exact"; readonly digest: string }
  | { readonly kind: "drifted"; readonly digest: string; readonly mode: number }
  | { readonly kind: "ambiguous"; readonly digest?: string };

export interface SpdxLicenseProvider {
  readonly id: string;
  readonly definition: SpdxLicenseSourceDefinition;
  readonly text: LicenseTextSource;
  readonly alternates: readonly Source[];
}

/** Creates an exclusive provider that recognizes exact alternate SPDX licenses. */
export function createSpdxLicenseFeature(
  provider: SpdxLicenseProvider,
): Feature {
  const inspect = (context: DetectionContext) =>
    inspectLicense(context, provider);
  return {
    metadata: {
      id: provider.id,
      name: `${provider.definition.name} license`,
      summary: `Provides the SPDX ${provider.definition.name} license.`,
    },
    dependencies: { requires: [] },
    capabilities: { provides: ["license"], requires: [] },
    detect: async (context) => detection(await inspect(context), provider),
    checkEnable: async (context) =>
      checkEnable(context, await inspect(context), provider),
    checkDisable: async (context) =>
      checkDisable(context, await inspect(context), provider),
    planEnable: async (context, allowed) =>
      enablePlan(context, allowed, await inspect(context), provider),
    planDisable: async (context, allowed) =>
      disablePlan(context, allowed, await inspect(context), provider),
  };
}

async function inspectLicense(
  context: DetectionContext,
  provider: SpdxLicenseProvider,
): Promise<State> {
  const observed = await context.files.observe(path);
  if (observed.kind === "absent") return { kind: "absent" };
  if (observed.kind !== "file") return { kind: "ambiguous" };
  try {
    const own = await provider.text();
    const ownAttribution = parse(own, provider.definition, observed.content);
    if (ownAttribution) {
      return observed.mode === 0o644
        ? { kind: "exact", digest: observed.digest }
        : { kind: "drifted", digest: observed.digest, mode: observed.mode };
    }
    for (const alternate of provider.alternates) {
      if (
        parse(await alternate.text(), alternate.definition, observed.content)
      ) {
        return { kind: "alternate", digest: observed.digest };
      }
    }
    return { kind: "ambiguous", digest: observed.digest };
  } catch {
    return { kind: "ambiguous", digest: observed.digest };
  }
}

function detection(state: State, provider: SpdxLicenseProvider) {
  if (state.kind === "absent" || state.kind === "alternate") {
    return { state: "disabled" as const, evidence: [] };
  }
  if (state.kind === "exact") {
    return { state: "enabled" as const, evidence: [] };
  }
  const drifted = state.kind === "drifted";
  return {
    state: drifted ? "drifted" as const : "ambiguous" as const,
    evidence: [],
    issues: [{
      code: `${provider.id}-${drifted ? "drifted" : "ambiguous"}`,
      kind: provider.id,
      subject: subject(),
      observation: drifted
        ? "LICENSE matches SPDX content but has the wrong mode."
        : "LICENSE is not an exact recognizable SPDX license.",
      resolution: drifted
        ? "Repair the license mode explicitly."
        : "Replace LICENSE manually, then retry.",
    }],
  };
}

async function checkEnable(
  context: OperationContext,
  state: State,
  provider: SpdxLicenseProvider,
): Promise<OperationCheck> {
  if (state.kind === "exact") return noop("License is already adopted.");
  if (state.kind === "drifted" && repairSelected(context, provider.id)) {
    return allowed(state.digest);
  }
  if (state.kind !== "absent" && state.kind !== "alternate") {
    return blocked("LICENSE cannot be safely replaced.");
  }
  if (!attribution(context)) {
    return blocked("License attribution is unresolved.");
  }
  try {
    await provider.text();
    return allowed(state.kind === "alternate" ? state.digest : undefined);
  } catch {
    return blocked("License template could not be downloaded.");
  }
}

function checkDisable(
  _context: OperationContext,
  state: State,
  _provider: SpdxLicenseProvider,
): OperationCheck {
  if (state.kind === "absent" || state.kind === "alternate") {
    return noop("License is already absent or replaced.");
  }
  if (state.kind === "exact") return allowed(state.digest);
  return blocked("Only an exact SPDX license may be removed.");
}

async function enablePlan(
  context: OperationContext,
  allowed_: Allowed,
  state: State,
  provider: SpdxLicenseProvider,
): Promise<ChangePlan> {
  if (state.kind === "drifted") {
    return plan(provider.id, "enable", allowed_, [{
      kind: "set-file-mode",
      path,
      mode: 0o644,
      expectedMode: state.mode,
    }], "Repair the SPDX license mode.");
  }
  const value = attribution(context)!;
  return plan(provider.id, "enable", allowed_, [{
    kind: "write-file",
    path,
    content: render(await provider.text(), provider.definition, value),
    mode: 0o644,
    expectedDigest: state.kind === "alternate" ? state.digest : undefined,
  }], "Write the SPDX license.");
}

function disablePlan(
  context: OperationContext,
  allowed_: Allowed,
  state: State,
  provider: SpdxLicenseProvider,
): Promise<ChangePlan> {
  if (state.kind !== "exact") {
    throw new Error("License cannot be removed.");
  }
  if (replacementSelected(context, provider)) {
    return Promise.resolve(
      plan(
        provider.id,
        "disable",
        allowed_,
        [],
        "Defer LICENSE removal to the selected provider.",
      ),
    );
  }
  return Promise.resolve(
    plan(provider.id, "disable", allowed_, [{
      kind: "remove-file",
      path,
      expectedDigest: state.digest,
    }], "Remove the exact SPDX license."),
  );
}

type Allowed = Extract<OperationCheck, { result: "allowed" }>;
function plan(
  id: string,
  action: "enable" | "disable",
  allowed_: Allowed,
  changes: ChangePlan["changes"],
  summary: string,
): ChangePlan {
  return {
    featureId: id,
    action,
    summary,
    warnings: allowed_.warnings,
    preconditions: allowed_.preconditions,
    changes,
    validations: [{
      kind: "feature-redetection",
      featureId: id,
      expected: action === "enable" ? "enabled" : "disabled",
    }],
  };
}

function parse(
  template: string,
  definition: SpdxLicenseSourceDefinition,
  content: string,
): Attribution | undefined {
  const [yearMarker, holderMarker] = definition.placeholders;
  const [prefix, rest] = template.split(yearMarker);
  const [middle, suffix] = rest?.split(holderMarker) ?? [];
  if (
    prefix === undefined || middle === undefined || suffix === undefined ||
    !content.startsWith(prefix) || !content.endsWith(suffix)
  ) return undefined;
  const values = content.slice(prefix.length, content.length - suffix.length)
    .split(middle);
  return values.length === 2 && /^\d{4}$/.test(values[0]) &&
      safeHolder(values[1])
    ? { year: values[0], holder: values[1] }
    : undefined;
}

function render(
  template: string,
  definition: SpdxLicenseSourceDefinition,
  value: Attribution,
): string {
  return template.replace(definition.placeholders[0], value.year).replace(
    definition.placeholders[1],
    value.holder,
  );
}
function attribution(context: OperationContext): Attribution | undefined {
  const { licenseHolder: holder, licenseYear: year } = context.options;
  return typeof holder === "string" && typeof year === "string" &&
      safeHolder(holder) && /^\d{4}$/.test(year)
    ? { holder, year }
    : undefined;
}
function safeHolder(value: string): boolean {
  return value.trim().length > 0 && !/[\0\r\n]/.test(value);
}
function repairSelected(context: OperationContext, id: string): boolean {
  return context.repair?.kind === "all-drifted" ||
    context.repair?.kind === "features" &&
      context.repair.featureIds.includes(id);
}
function replacementSelected(
  context: OperationContext,
  provider: SpdxLicenseProvider,
): boolean {
  return context.resolvedChanges.some((change) =>
    change.enabled &&
    provider.alternates.some((alternate) => alternate.id === change.featureId)
  );
}
function allowed(digest: string | undefined): Allowed {
  return {
    result: "allowed",
    warnings: [],
    preconditions: [{ kind: "file-digest", path, digest }],
  };
}
function noop(reason: string): OperationCheck {
  return { result: "no-op", reason, warnings: [] };
}
function blocked(message: string): OperationCheck {
  return {
    result: "blocked",
    blockers: [{
      code: "license-conflict",
      message,
      subjects: [subject()],
      resolution: "Resolve attribution or LICENSE content before retrying.",
    }],
    warnings: [],
  };
}
function subject() {
  return { kind: "repository-path", identifier: path };
}
