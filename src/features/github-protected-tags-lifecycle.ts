/** @module Safe, resumable lifecycle for layered GitHub tag rulesets. */

import { canonical } from "../repository/canonical-ruleset.ts";
import type { ChangePlan } from "../api/change-plan.ts";
import type { Feature } from "../api/feature.ts";
import type {
  AllowedOperation,
  OperationCheck,
} from "../api/feature-operation.ts";
import type { JsonObject } from "../api/json.ts";
import type {
  DetectionContext,
  OperationContext,
} from "../api/repository-context.ts";
import type {
  GithubRulesetExpectation,
  GithubRulesetTransitionChange,
} from "../api/planned-change.ts";
import {
  protectedTagsDefinition,
  protectedTagsGuardDefinition,
  releaseTagsDefinition,
  rulesetResource,
} from "./github-protection-definitions.ts";
import { schemaSupportsProtectedTags } from "./github-ruleset-schema.ts";
import { requireTagQuiescence } from "./release-quiescence.ts";
import { publishTagWorkflow } from "../release/names.ts";
import { publishTagArtifact } from "./github-release-publish-artifacts.ts";

type TagState = "absent" | "final" | "guard" | "release" | "invalid";
type Snapshot = {
  readonly general: TagState;
  readonly release: TagState;
  readonly digests: readonly (string | undefined)[];
};

export const githubProtectedTagsFeature: Feature = {
  metadata: {
    id: "github-protected-tags",
    name: "protected tags",
    summary: "Manages protected tags.",
  },
  dependencies: {
    requires: [{
      featureId: "github-repo",
      reason: "Tag protection requires a GitHub repository.",
    }],
  },
  conflicts: { featureIds: [], disableWith: ["github-release-publish-tag"] },
  capabilities: { provides: [], requires: [] },
  detect: async (context) => detection(await snapshot(context)),
  checkEnable: check(true),
  planEnable: plan(true),
  checkDisable: check(false),
  planDisable: plan(false),
};

function check(enable: boolean) {
  return async (context: OperationContext): Promise<OperationCheck> => {
    const state = await snapshot(context);
    if (
      enable
        ? state.general === "final" && state.release === "release"
        : state.general === "absent" && state.release === "absent"
    ) {
      return {
        result: "no-op",
        reason: "GitHub tag protection is already in the requested state.",
        warnings: [],
      };
    }
    if (!enable) {
      let remote;
      try {
        remote = await context.github?.remoteFile?.(publishTagWorkflow);
      } catch {
        remote = undefined;
      }
      if (remote === undefined) {
        return blocked("The remote tag workflow cannot be read.");
      }
      if (
        remote.kind === "file" && remote.content === publishTagArtifact.content
      ) {
        return blocked("The generated remote tag workflow is still present.");
      }
      if (remote.kind === "file") {
        return blocked("The remote tag workflow has ambiguous ownership.");
      }
      const quiescence = await requireTagQuiescence(
        context.github,
        publishTagWorkflow,
      );
      if (quiescence) return blocked(quiescence);
    }
    if (
      enable && (!schemaSupportsProtectedTags() ||
        await context.github?.tagRulesetEligibility?.() !== "eligible")
    ) {
      return blocked(
        "GitHub tag ruleset eligibility is unavailable or unsupported.",
      );
    }
    if (
      state.general === "invalid" || state.release === "invalid" ||
      !safe(state, enable)
    ) {
      return blocked(
        "Reserved GitHub tag rulesets have unknown, duplicate, or inherited state.",
      );
    }
    return {
      result: "allowed",
      warnings: [{
        code: "github-ruleset-mutation",
        message: "Change GitHub tag rulesets through a guarded sequence.",
        subjects: [],
        requiresConfirmation: true,
      }],
      preconditions: preconditions(state),
    };
  };
}

function plan(enable: boolean) {
  return async (
    context: OperationContext,
    operation: AllowedOperation,
  ): Promise<ChangePlan> => {
    const state = await snapshot(context);
    if (
      JSON.stringify(preconditions(state)) !==
        JSON.stringify(operation.preconditions)
    ) {
      throw new Error("GitHub tag ruleset state changed after check");
    }
    const transition = transitionFor(state, enable);
    return {
      featureId: "github-protected-tags",
      action: enable ? "enable" : "disable",
      summary: `${enable ? "Configure" : "Remove"} protected tags.`,
      warnings: operation.warnings,
      preconditions: operation.preconditions,
      changes: transition.steps.length ? [transition] : [],
      validations: [
        {
          kind: "feature-redetection",
          featureId: "github-protected-tags",
          expected: enable ? "enabled" : "disabled",
        },
        ...(enable
          ? [{ kind: "github-tag-protection" as const, tag: "0.0.0" }]
          : []),
      ],
    };
  };
}

function transitionFor(
  initial: Snapshot,
  enable: boolean,
): GithubRulesetTransitionChange {
  let general = initial.general;
  let release = initial.release;
  const steps: GithubRulesetTransitionChange["steps"][number][] = [];
  const add = (
    change: GithubRulesetTransitionChange["steps"][number]["change"],
    nextGeneral: TagState,
    nextRelease: TagState,
  ) => {
    steps.push({
      change,
      before: expectations(general, release),
      after: expectations(nextGeneral, nextRelease),
    });
    general = nextGeneral;
    release = nextRelease;
  };
  if (enable) {
    if (general !== "guard") {
      add(
        {
          kind: "upsert",
          name: protectedTagsGuardDefinition.name as string,
          definition: protectedTagsGuardDefinition,
        },
        "guard",
        release,
      );
    }
    if (release !== "release") {
      add(
        {
          kind: "upsert",
          name: releaseTagsDefinition.name as string,
          definition: releaseTagsDefinition,
        },
        general,
        "release",
      );
    }
    if (general !== "final") {
      add(
        {
          kind: "upsert",
          name: protectedTagsDefinition.name as string,
          definition: protectedTagsDefinition,
        },
        "final",
        release,
      );
    }
  } else {
    if (general !== "guard") {
      add(
        {
          kind: "upsert",
          name: protectedTagsGuardDefinition.name as string,
          definition: protectedTagsGuardDefinition,
        },
        "guard",
        release,
      );
    }
    if (release === "release") {
      add(
        { kind: "delete", name: releaseTagsDefinition.name as string },
        general,
        "absent",
      );
    }
    if (general === "guard") {
      add(
        { kind: "delete", name: protectedTagsGuardDefinition.name as string },
        "absent",
        release,
      );
    }
  }
  return { kind: "github-ruleset-transition", steps };
}

function expectations(
  general: TagState,
  release: TagState,
): readonly GithubRulesetExpectation[] {
  return [{
    name: protectedTagsDefinition.name as string,
    ...(general === "final"
      ? { definition: protectedTagsDefinition }
      : general === "guard"
      ? { definition: protectedTagsGuardDefinition }
      : {}),
  }, {
    name: releaseTagsDefinition.name as string,
    ...(release === "release" ? { definition: releaseTagsDefinition } : {}),
  }];
}

async function snapshot(context: DetectionContext): Promise<Snapshot> {
  if (!context.github || !await context.github.repository()) {
    return {
      general: "absent",
      release: "absent",
      digests: [undefined, undefined],
    };
  }
  const rulesets = await context.github.rulesets();
  if (!rulesets) {
    return {
      general: "invalid",
      release: "invalid",
      digests: [undefined, undefined],
    };
  }
  const inspect = (
    name: string,
    definitions: readonly [JsonObject, TagState][],
  ): [TagState, string | undefined] => {
    const matches = rulesets.filter((item) =>
      item.kind === rulesetResource && item.name === name
    );
    if (!matches.length) return ["absent", undefined];
    if (
      matches.length !== 1 ||
      matches[0].sourceType !== "Repository"
    ) return ["invalid", undefined];
    const { id: _id, ...actual } = matches[0].definition;
    const match = definitions.find(([definition]) =>
      JSON.stringify(canonical(actual)) === JSON.stringify(definition)
    );
    return match
      ? [match[1], matches[0].stateDigest]
      : ["invalid", matches[0].stateDigest];
  };
  const [general, generalDigest] = inspect(
    protectedTagsDefinition.name as string,
    [[protectedTagsDefinition, "final"], [
      protectedTagsGuardDefinition,
      "guard",
    ]],
  );
  const [release, releaseDigest] = inspect(
    releaseTagsDefinition.name as string,
    [[releaseTagsDefinition, "release"]],
  );
  return { general, release, digests: [generalDigest, releaseDigest] };
}

function safe(state: Snapshot, enable: boolean): boolean {
  if (enable) {
    return !(state.general === "absent" && state.release === "release");
  }
  return state.general !== "final" || state.release === "release";
}
function preconditions(state: Snapshot) {
  return [
    protectedTagsDefinition.name as string,
    releaseTagsDefinition.name as string,
  ].map((name, index) => ({
    kind: "github-resource-state" as const,
    resource: rulesetResource,
    name,
    stateDigest: state.digests[index],
  }));
}
function detection(state: Snapshot) {
  if (state.general === "invalid" || state.release === "invalid") {
    return { state: "ambiguous" as const, evidence: [], issues: [] };
  }
  if (state.general === "absent" && state.release === "absent") {
    return { state: "disabled" as const, evidence: [] };
  }
  return state.general === "final" && state.release === "release"
    ? { state: "enabled" as const, evidence: [] }
    : { state: "drifted" as const, evidence: [], issues: [] };
}
function blocked(message: string): OperationCheck {
  return {
    result: "blocked",
    blockers: [{
      code: "github-ruleset-conflict",
      message,
      subjects: [],
      resolution: "Resolve the GitHub tag ruleset state manually.",
    }],
    warnings: [],
  };
}
