/** @module Independent, guarded management of generated-file Git exclusions. */
import type { ChangePlan } from "../api/change-plan.ts";
import type { FeatureDetection } from "../api/feature-detection.ts";
import type {
  AllowedOperation,
  OperationCheck,
} from "../api/feature-operation.ts";
import type { Feature } from "../api/feature.ts";
import type {
  DetectionContext,
  OperationContext,
} from "../api/repository-context.ts";
import {
  gitIgnoreContent,
  gitIgnoreRequirements,
  ownsGitIgnore,
} from "./git-ignore-content.ts";

const id = "git-ignore";
const subject = { kind: "file", identifier: ".gitignore" };

async function inspect(context: DetectionContext) {
  const observation = await context.files.observe(".gitignore");
  if (observation.kind !== "file" && observation.kind !== "absent") {
    throw new Error(".gitignore must be a regular file.");
  }
  return {
    content: observation.kind === "file" ? observation.content : "",
    digest: observation.kind === "file" ? observation.digest : undefined,
  };
}

function detection(
  state: FeatureDetection["state"],
  observation: string,
): FeatureDetection {
  const evidence = [{
    code: `git-ignore-${state}`,
    kind: id,
    subject,
    observation,
  }];
  return state === "enabled" || state === "disabled" ? { state, evidence } : {
    state,
    evidence,
    issues: [{
      ...evidence[0]!,
      resolution: "Review the configuration and enable or repair git-ignore.",
    }],
  };
}

async function detect(context: DetectionContext): Promise<FeatureDetection> {
  try {
    const { content } = await inspect(context);
    if (!ownsGitIgnore(content)) {
      return detection("disabled", "Managed Git exclusions are absent.");
    }
    const { patterns } = await gitIgnoreRequirements(context);
    return gitIgnoreContent(content, patterns) === content
      ? detection(
        "enabled",
        "Generated-file exclusions match project configuration.",
      )
      : detection("drifted", "Managed Git exclusions need updating.");
  } catch (error) {
    return detection("ambiguous", (error as Error).message);
  }
}

async function check(
  context: OperationContext,
  enabled: boolean,
): Promise<OperationCheck> {
  try {
    const { content, digest } = await inspect(context);
    const requirements = enabled
      ? await gitIgnoreRequirements(context)
      : undefined;
    const desired = gitIgnoreContent(content, requirements?.patterns);
    if (desired === content) {
      return {
        result: "no-op",
        reason: "Git exclusions already match.",
        warnings: [],
      };
    }
    return {
      result: "allowed",
      warnings: [],
      preconditions: [
        { kind: "file-digest", path: ".gitignore", digest },
        ...requirements?.preconditions ?? [],
      ],
    };
  } catch (error) {
    return {
      result: "blocked",
      warnings: [],
      blockers: [{
        code: "git-ignore-conflict",
        message: (error as Error).message,
        subjects: [subject],
        resolution: "Resolve the file or configuration conflict, then retry.",
      }],
    };
  }
}

async function plan(
  context: OperationContext,
  enabled: boolean,
  allowed: AllowedOperation,
  projected: readonly ChangePlan[] = [],
): Promise<ChangePlan> {
  const { content, digest } = await inspect(context);
  const requirements = enabled
    ? await gitIgnoreRequirements(
      context,
      projected.flatMap((plan) => plan.changes),
    )
    : undefined;
  const desired = gitIgnoreContent(content, requirements?.patterns);
  return {
    featureId: id,
    action: enabled ? "enable" : "disable",
    summary: enabled
      ? "Update generated-file exclusions."
      : "Remove unchanged owned Git exclusions.",
    warnings: allowed.warnings,
    preconditions: [
      { kind: "file-digest", path: ".gitignore", digest },
      ...requirements?.preconditions ?? [],
    ],
    changes: desired === content
      ? []
      : desired === "" && digest !== undefined
      ? [{ kind: "remove-file", path: ".gitignore", expectedDigest: digest }]
      : [{
        kind: "write-file",
        path: ".gitignore",
        content: desired,
        expectedDigest: digest,
      }],
    validations: [{
      kind: "feature-redetection",
      featureId: id,
      expected: enabled ? "enabled" : "disabled",
    }],
  };
}

/** Adds only individually marked entries and preserves all custom exclusions. */
export const gitIgnoreFeature: Feature = {
  metadata: {
    id,
    name: "Ignore generated files",
    summary: "Ignore editor swap files and configured generated directories.",
  },
  dependencies: { requires: [] },
  capabilities: { provides: [], requires: [] },
  detect,
  checkEnable: (context) => check(context, true),
  checkDisable: (context) => check(context, false),
  planEnable: (context, allowed) => plan(context, true, allowed),
  planDisable: (context, allowed) => plan(context, false, allowed),
};

/** Reconcile active exclusions against final config before applying any plan. */
export async function reconcileGitIgnorePlans(
  context: OperationContext,
  plans: readonly ChangePlan[],
): Promise<readonly ChangePlan[]> {
  const explicit = plans.find((plan) => plan.featureId === id);
  const configChanged = plans.some((plan) =>
    plan.changes.some((change) =>
      "path" in change &&
      ["deno.json", "deno.jsonc", "package.json"].includes(change.path)
    )
  );
  if (
    !explicit &&
    (!configChanged ||
      !ownsGitIgnore(await context.files.readText(".gitignore") ?? ""))
  ) return plans;
  const enabled = explicit?.action !== "disable";
  const reconciled = await plan(context, enabled, {
    result: "allowed",
    preconditions: [],
    warnings: explicit?.warnings ?? [],
  }, plans);
  // Config digests must be checked before the other plans mutate those files.
  return [reconciled, ...plans.filter((plan) => plan.featureId !== id)];
}
