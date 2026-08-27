/** @module SPDX MIT license provider. */

import type { ChangePlan } from "../api/change-plan.ts";
import type { Feature } from "../api/feature.ts";
import type { OperationCheck } from "../api/feature-operation.ts";
import type {
  DetectionContext,
  OperationContext,
} from "../api/repository-context.ts";
import {
  createMitTextSource,
  type LicenseTextSource,
} from "./license-mit-source.ts";

export const licenseMitFeatureId = "license-mit";
const path = "LICENSE";

/** Creates a MIT provider with an injectable trusted template source. */
export function createLicenseMitFeature(
  source: LicenseTextSource = createMitTextSource(),
): Feature {
  const inspect = async (context: DetectionContext): Promise<LicenseState> => {
    const observed = await context.files.observe(path);
    if (observed.kind === "absent") return { kind: "absent" };
    if (observed.kind !== "file") return { kind: "ambiguous" };
    try {
      const template = await source();
      const attribution = parseAttribution(template, observed.content);
      if (!attribution) return { kind: "ambiguous", digest: observed.digest };
      const expected = render(template, attribution.year, attribution.holder);
      if (observed.content !== expected) {
        return { kind: "ambiguous", digest: observed.digest };
      }
      return observed.mode === 0o644
        ? { kind: "exact", digest: observed.digest }
        : {
          kind: "drifted",
          digest: observed.digest,
          mode: observed.mode,
          attribution,
        };
    } catch {
      return { kind: "ambiguous", digest: observed.digest };
    }
  };
  return {
    metadata: {
      id: licenseMitFeatureId,
      name: "MIT license",
      summary: "Provides the SPDX MIT license.",
    },
    dependencies: { requires: [] },
    capabilities: { provides: ["license"], requires: [] },
    detect: async (context) => detection(await inspect(context)),
    checkEnable: async (context) =>
      checkEnable(context, await inspect(context), source),
    checkDisable: async (context) => checkDisable(await inspect(context)),
    planEnable: async (context, allowed) =>
      enablePlan(context, allowed, await inspect(context), source),
    planDisable: async (_context, allowed) =>
      disablePlan(allowed, await inspect(_context)),
  };
}

export const licenseMitFeature = createLicenseMitFeature();

type Attribution = { readonly year: string; readonly holder: string };
type LicenseState =
  | { readonly kind: "absent" }
  | { readonly kind: "exact"; readonly digest: string }
  | {
    readonly kind: "drifted";
    readonly digest: string;
    readonly mode: number;
    readonly attribution: Attribution;
  }
  | { readonly kind: "ambiguous"; readonly digest?: string };

function detection(state: LicenseState) {
  if (state.kind === "absent") {
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
      code: drifted ? "license-mit-drifted" : "license-mit-ambiguous",
      kind: "license-mit",
      subject: subject(),
      observation: drifted
        ? "LICENSE matches SPDX MIT content but has the wrong mode."
        : "LICENSE is not an exact recognizable MIT license.",
      resolution: drifted
        ? "Repair the MIT license mode explicitly."
        : "Replace LICENSE manually, then retry.",
    }],
  };
}

function checkEnable(
  context: OperationContext,
  state: LicenseState,
  source: LicenseTextSource,
): Promise<OperationCheck> {
  if (state.kind === "exact") {
    return Promise.resolve(noop("MIT license is already adopted."));
  }
  if (state.kind === "absent") {
    if (!attribution(context)) {
      return Promise.resolve(blocked("MIT attribution is unresolved."));
    }
    return source().then(
      () => allowed(undefined),
      () => blocked("MIT license template could not be downloaded."),
    );
  }
  if (state.kind === "drifted" && repairSelected(context)) {
    return Promise.resolve(allowed(state.digest));
  }
  return Promise.resolve(blocked("LICENSE cannot be safely replaced."));
}

function checkDisable(state: LicenseState): OperationCheck {
  if (state.kind === "absent") return noop("MIT license is already absent.");
  if (state.kind === "exact") return allowed(state.digest);
  return blocked("Only an exact MIT license may be removed.");
}

async function enablePlan(
  context: OperationContext,
  allowed_: Extract<OperationCheck, { result: "allowed" }>,
  state: LicenseState,
  source: LicenseTextSource,
): Promise<ChangePlan> {
  if (state.kind === "drifted") {
    return plan("enable", allowed_, [{
      kind: "set-file-mode",
      path,
      mode: 0o644,
      expectedMode: state.mode,
    }], "Repair the SPDX MIT license mode.");
  }
  const resolved = attribution(context)!;
  return plan("enable", allowed_, [{
    kind: "write-file",
    path,
    content: render(await source(), resolved.year, resolved.holder),
    mode: 0o644,
    expectedDigest: state.kind === "absent" ? undefined : state.digest,
  }], "Write the SPDX MIT license.");
}

function disablePlan(
  allowed_: Extract<OperationCheck, { result: "allowed" }>,
  state: LicenseState,
): Promise<ChangePlan> {
  if (state.kind !== "exact") throw new Error("MIT license cannot be removed.");
  return Promise.resolve(
    plan("disable", allowed_, [{
      kind: "remove-file",
      path,
      expectedDigest: state.digest,
    }], "Remove the exact SPDX MIT license."),
  );
}

function plan(
  action: "enable" | "disable",
  allowed_: Extract<OperationCheck, { result: "allowed" }>,
  changes: ChangePlan["changes"],
  summary: string,
): ChangePlan {
  return {
    featureId: licenseMitFeatureId,
    action,
    summary,
    warnings: allowed_.warnings,
    preconditions: allowed_.preconditions,
    changes,
    validations: [{
      kind: "feature-redetection",
      featureId: licenseMitFeatureId,
      expected: action === "enable" ? "enabled" : "disabled",
    }],
  };
}

function parseAttribution(
  template: string,
  content: string,
): Attribution | undefined {
  const lineIndex = template.split("\n").findIndex((item) =>
    item.includes("<year>") && item.includes("<copyright holders>")
  );
  if (lineIndex < 0) return undefined;
  const line = template.split("\n")[lineIndex];
  const [prefix, afterYear] = line.split("<year>");
  const [between, suffix] = afterYear.split("<copyright holders>");
  const actual = content.split("\n")[lineIndex];
  if (!actual) return undefined;
  const values = actual.slice(prefix.length, actual.length - suffix.length)
    .split(between);
  if (
    values.length !== 2 || !/^\d{4}$/.test(values[0]) || !safeHolder(values[1])
  ) return undefined;
  return { year: values[0], holder: values[1] };
}

function render(template: string, year: string, holder: string): string {
  return template.replace("<year>", year).replace(
    "<copyright holders>",
    holder,
  );
}
function attribution(context: OperationContext): Attribution | undefined {
  const holder = context.options.licenseHolder;
  const year = context.options.licenseYear;
  return typeof holder === "string" && typeof year === "string" &&
      safeHolder(holder) && /^\d{4}$/.test(year)
    ? { holder, year }
    : undefined;
}
function safeHolder(value: string): boolean {
  return value.trim().length > 0 && !/[\0\r\n]/.test(value);
}
function repairSelected(context: OperationContext): boolean {
  return context.repair?.kind === "all-drifted" ||
    context.repair?.kind === "features" &&
      context.repair.featureIds.includes(licenseMitFeatureId);
}
function allowed(digest: string | undefined): OperationCheck {
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
      code: "license-mit-conflict",
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
