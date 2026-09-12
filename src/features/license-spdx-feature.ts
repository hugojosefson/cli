/** @module Safe SPDX LICENSE provider implementation. */

import type { ChangePlan } from "../api/change-plan.ts";
import type { PlannedChange } from "../api/planned-change.ts";
import type { Feature } from "../api/feature.ts";
import type { OperationCheck } from "../api/feature-operation.ts";
import type {
  DetectionContext,
  OperationContext,
} from "../api/repository-context.ts";
import type {
  LicensePlaceholderKind,
  LicenseTextSource,
  SpdxLicenseSourceDefinition,
} from "./license-spdx-source.ts";
import { basename, fromFileUrl } from "@std/path";
import {
  inspectLicenseReadme,
  type LicenseReadmeState,
} from "./license-readme-state.ts";
import {
  appendLicenseSection,
  exactLicenseSection,
  removeLicenseSection,
  replaceLicenseSection,
} from "../readme/license-section.ts";
import { buildReadmeText } from "../readme/build-readme.ts";

const path = "LICENSE";
type Values = Partial<Record<LicensePlaceholderKind, string>>;
type Source = {
  readonly id: string;
  readonly definition: SpdxLicenseSourceDefinition;
  readonly text: LicenseTextSource;
};
type State =
  | { readonly kind: "absent" }
  | {
    readonly kind: "alternate";
    readonly digest: string;
    readonly readme: LicenseReadmeState;
  }
  | {
    readonly kind: "exact";
    readonly digest: string;
    readonly readme: LicenseReadmeState;
  }
  | {
    readonly kind: "drifted";
    readonly digest: string;
    readonly mode: number;
    readonly readme: LicenseReadmeState;
  }
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
    capabilities: {
      provides: ["license"],
      requires: [{
        capabilityId: "readme",
        reason: "License links need a README provider.",
      }],
    },
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
      const readme = await inspectLicenseReadme(
        context,
        provider.definition.name,
        provider.alternates.map((item) => item.definition.name),
      );
      if (
        readme.section.kind === "custom" || readme.section.kind === "duplicate"
      ) return { kind: "ambiguous", digest: observed.digest };
      if (
        readme.section.kind === "exact" && readme.rootFresh &&
        (observed.mode & 0o711) === 0o600
      ) {
        return { kind: "exact", digest: observed.digest, readme };
      }
      return {
        kind: "drifted",
        digest: observed.digest,
        mode: observed.mode,
        readme,
      };
    }
    for (const alternate of provider.alternates) {
      if (
        parse(await alternate.text(), alternate.definition, observed.content)
      ) {
        return {
          kind: "alternate",
          digest: observed.digest,
          readme: await inspectLicenseReadme(
            context,
            provider.definition.name,
            provider.alternates.map((item) => item.definition.name),
          ),
        };
      }
    }
    return { kind: "ambiguous", digest: observed.digest };
  } catch {
    return { kind: "ambiguous", digest: observed.digest };
  }
}

function detection(state: State, provider: SpdxLicenseProvider) {
  const evidence = [{
    code: `${provider.id}-inspected`,
    kind: "license",
    subject: subject(),
    observation: state.kind === "absent"
      ? "LICENSE is absent."
      : state.kind === "alternate"
      ? "LICENSE uses another recognized license."
      : `LICENSE and its README link match ${provider.definition.name}.`,
  }];
  if (state.kind === "absent") {
    return { state: "disabled" as const, evidence };
  }
  if (state.kind === "alternate") {
    const safe = state.readme.section.kind === "missing" ||
      state.readme.section.kind === "alternate";
    return safe
      ? { state: "disabled" as const, evidence }
      : ambiguous(provider);
  }
  if (state.kind === "exact") {
    return { state: "enabled" as const, evidence };
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
        ? "LICENSE or its owned README license section needs repair."
        : "LICENSE is not an exact recognizable SPDX license.",
      resolution: drifted
        ? "Repair the owned license files explicitly."
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
  if (!values(context, provider.definition)) {
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
    const changes = readmeProviderWillCreate(context)
      ? []
      : await readmeChanges(
        context,
        state.readme,
        provider.definition.name,
      );
    if (state.mode !== 0o644) {
      changes.unshift({
        kind: "set-file-mode",
        path,
        mode: 0o644,
        expectedMode: state.mode,
      });
    }
    return plan(
      provider.id,
      "enable",
      allowed_,
      changes,
      "Repair the SPDX license and README link.",
    );
  }
  const value = values(context, provider.definition)!;
  const changes: PlannedChange[] = [{
    kind: "write-file",
    path,
    content: render(await provider.text(), provider.definition, value),
    mode: 0o644,
    expectedDigest: state.kind === "alternate" ? state.digest : undefined,
  }];
  if (!readmeProviderWillCreate(context)) {
    changes.push(
      ...await readmeChanges(
        context,
        state.kind === "alternate" ? state.readme : await inspectLicenseReadme(
          context,
          provider.definition.name,
          provider.alternates.map((item) => item.definition.name),
        ),
        provider.definition.name,
      ),
    );
  }
  return plan(
    provider.id,
    "enable",
    allowed_,
    changes,
    "Write the SPDX license.",
  );
}

async function disablePlan(
  context: OperationContext,
  allowed_: Allowed,
  state: State,
  provider: SpdxLicenseProvider,
): Promise<ChangePlan> {
  if (state.kind !== "exact") {
    throw new Error("License cannot be removed.");
  }
  if (replacementSelected(context, provider)) {
    return plan(
      provider.id,
      "disable",
      { ...allowed_, preconditions: [] },
      [],
      "Defer LICENSE removal to the selected provider.",
    );
  }
  return plan(
    provider.id,
    "disable",
    allowed_,
    [
      { kind: "remove-file", path, expectedDigest: state.digest },
      ...await removeReadmeChanges(context, state.readme),
    ],
    "Remove the exact SPDX license.",
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
): Values | undefined {
  let templateCursor = 0;
  let contentCursor = 0;
  const result: Values = {};
  for (const [index, placeholder] of definition.placeholders.entries()) {
    const markerIndex = template.indexOf(placeholder.marker, templateCursor);
    if (markerIndex < 0) return undefined;
    const prefix = template.slice(templateCursor, markerIndex);
    if (!content.startsWith(prefix, contentCursor)) return undefined;
    contentCursor += prefix.length;
    templateCursor = markerIndex + placeholder.marker.length;
    const next = definition.placeholders[index + 1];
    const nextIndex = next
      ? template.indexOf(next.marker, templateCursor)
      : template.length;
    if (nextIndex < 0) return undefined;
    const following = template.slice(templateCursor, nextIndex);
    const valueEnd = following
      ? content.indexOf(following, contentCursor)
      : content.length;
    if (valueEnd < 0) return undefined;
    const value = content.slice(contentCursor, valueEnd);
    if (!valid(placeholder.kind, value)) return undefined;
    result[placeholder.kind] = value;
    contentCursor = valueEnd;
  }
  const suffix = template.slice(templateCursor);
  return content.startsWith(suffix, contentCursor) &&
      contentCursor + suffix.length === content.length
    ? result
    : undefined;
}

function render(
  template: string,
  definition: SpdxLicenseSourceDefinition,
  value: Values,
): string {
  return definition.placeholders.reduce(
    (text, { kind, marker }) => text.replace(marker, value[kind]!),
    template,
  );
}
function values(
  context: OperationContext,
  definition: SpdxLicenseSourceDefinition,
): Values | undefined {
  const { licenseHolder: holder, licenseYear: year } = context.options;
  const required = new Set(definition.placeholders.map(({ kind }) => kind));
  if (required.has("holder") && (typeof holder !== "string" || !safe(holder))) {
    return undefined;
  }
  if (
    required.has("year") && (typeof year !== "string" || !/^\d{4}$/.test(year))
  ) {
    return undefined;
  }
  const project = basename(fromFileUrl(context.repositoryRoot));
  if (required.has("project") && !safe(project)) return undefined;
  return {
    holder: typeof holder === "string" ? holder : undefined,
    year: typeof year === "string" ? year : undefined,
    project,
  };
}
function valid(kind: LicensePlaceholderKind, value: string): boolean {
  return kind === "year" ? /^\d{4}$/.test(value) : safe(value);
}
function safe(value: string): boolean {
  return value.trim().length > 0 && !/[\0\r\n/\\]/.test(value) &&
    value !== "." && value !== "..";
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
function readmeProviderWillCreate(context: OperationContext): boolean {
  return context.resolvedChanges.some((change) =>
    change.enabled &&
    (change.featureId === "readme-static" ||
      change.featureId === "readme-build") &&
    ["disabled", "drifted"].includes(
      context.detections.get(change.featureId)?.state ?? "",
    )
  );
}
async function readmeChanges(
  context: OperationContext,
  readme: LicenseReadmeState,
  label: string,
): Promise<PlannedChange[]> {
  if (readme.section.kind === "custom" || readme.section.kind === "duplicate") {
    throw new Error("README license section is ambiguous.");
  }
  const target = readme.mode === "generated" ? "../LICENSE" : "./LICENSE";
  const desired = exactLicenseSection(label, target);
  const content = readme.content === undefined
    ? desired
    : readme.section.kind === "missing"
    ? appendLicenseSection(readme.content, desired)
    : replaceLicenseSection(readme.content, readme.section.section, desired);
  const changes: PlannedChange[] = [];
  if (readme.mode === "static") {
    if (content !== readme.content) {
      changes.push({
        kind: "write-file",
        path: "README.md",
        content,
        mode: 0o644,
        expectedDigest: readme.digest,
      });
    }
    return changes;
  }
  if (content !== readme.content) {
    if (
      readme.targetMode !== undefined && (readme.targetMode & 0o200) === 0
    ) {
      changes.push({
        kind: "set-file-mode",
        path: readme.path,
        mode: 0o644,
        expectedMode: readme.targetMode,
      });
    }
    changes.push({
      kind: "write-file",
      path: readme.path,
      content,
      mode: 0o644,
      expectedDigest: readme.digest,
    });
  } else if (readme.targetMode !== 0o644) {
    changes.push({
      kind: "set-file-mode",
      path: readme.path,
      mode: 0o644,
      expectedMode: readme.targetMode,
    });
  }
  const root = await buildReadmeText(context.repositoryRoot, content);
  if (root !== readme.rootContent) {
    if (readme.rootMode === undefined) {
      changes.push({
        kind: "write-file",
        path: "README.md",
        content: root,
        mode: 0o444,
        expectedDigest: undefined,
      });
      return changes;
    }
    const writable = readme.rootMode !== undefined &&
      (readme.rootMode & 0o200) !== 0;
    if (!writable) {
      changes.push({
        kind: "set-file-mode",
        path: "README.md",
        mode: 0o644,
        expectedMode: readme.rootMode,
      });
    }
    changes.push({
      kind: "write-file",
      path: "README.md",
      content: root,
      expectedDigest: readme.rootDigest,
    }, {
      kind: "set-file-mode",
      path: "README.md",
      mode: 0o444,
      expectedMode: writable ? readme.rootMode : 0o644,
    });
  } else if (readme.rootMode !== 0o444) {
    changes.push({
      kind: "set-file-mode",
      path: "README.md",
      mode: 0o444,
      expectedMode: readme.rootMode,
    });
  }
  return changes;
}
async function removeReadmeChanges(
  context: OperationContext,
  readme: LicenseReadmeState,
): Promise<PlannedChange[]> {
  if (readme.section.kind !== "exact") {
    throw new Error("README license section cannot be safely removed.");
  }
  const content = removeLicenseSection(readme.content!, readme.section.section);
  if (readme.mode === "static") {
    return [{
      kind: "write-file",
      path: "README.md",
      content,
      mode: 0o644,
      expectedDigest: readme.digest,
    }];
  }
  const root = await buildReadmeText(context.repositoryRoot, content);
  return [{
    kind: "write-file",
    path: readme.path,
    content,
    mode: 0o644,
    expectedDigest: readme.digest,
  }, {
    kind: "set-file-mode",
    path: "README.md",
    mode: 0o644,
    expectedMode: 0o444,
  }, {
    kind: "write-file",
    path: "README.md",
    content: root,
    expectedDigest: readme.rootDigest,
  }, {
    kind: "set-file-mode",
    path: "README.md",
    mode: 0o444,
    expectedMode: 0o644,
  }];
}
function ambiguous(provider: SpdxLicenseProvider) {
  return {
    state: "ambiguous" as const,
    evidence: [],
    issues: [{
      code: `${provider.id}-ambiguous`,
      kind: provider.id,
      subject: subject(),
      observation: "README license ownership is ambiguous.",
      resolution: "Resolve the README license section before retrying.",
    }],
  };
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
