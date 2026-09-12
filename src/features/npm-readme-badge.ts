/** @module npm publication's contribution to either managed README provider. */
import { fileDifference, valueDifference } from "./detection-differences.ts";
import type { Feature } from "../api/feature.ts";
import type { FeatureDetection } from "../api/feature-detection.ts";
import type { OperationCheck } from "../api/feature-operation.ts";
import type {
  DetectionContext,
  OperationContext,
} from "../api/repository-context.ts";
import { validNpmPublishName } from "../package/npm-name.ts";
import {
  inspectContribution,
  npmBadgeImages,
  type ReadmeContribution,
} from "../readme/contribution-blocks.ts";
import { inspectDenoConfig } from "./deno-config.ts";
import { isObject, isReadmeTask } from "./deno-tasks.ts";

export const npmBadgeOwner = "github-release-publish-npm";
export function npmBadge(name: string): ReadmeContribution {
  return {
    id: `${npmBadgeOwner}:badge`,
    position: "badges",
    content:
      `[![npm Version](https://img.shields.io/npm/v/${name})](https://www.npmjs.com/package/${name})`,
  };
}

/** Use the same explicit Deno-config name that publication verifies in its archive. */
export async function npmBadgeIdentity(
  context: Pick<DetectionContext, "files">,
) {
  const config = await inspectDenoConfig(context);
  return config.kind === "config" && validNpmPublishName(config.value.name)
    ? config.value.name
    : undefined;
}

async function inspect(context: DetectionContext) {
  const config = await inspectDenoConfig(context);
  const tasks = config.kind === "config" && isObject(config.value.tasks)
    ? config.value.tasks
    : {};
  const build = isReadmeTask(tasks.readme);
  const path = build ? "readme/README.md" : "README.md";
  const entry = await context.files.observe(path);
  const name = await npmBadgeIdentity(context);
  const text = entry.kind === "file" ? entry.content : "";
  const desired = npmBadge(name ?? "@unknown/package");
  const owned = await inspectContribution(text, desired);
  const npmImages = npmBadgeImages(text);
  const custom = owned === "absent" && npmImages.length > 0;
  const compatibleCustom = custom && npmImages.length === 1 &&
    text.includes(desired.content);
  const kind = entry.kind !== "file" && entry.kind !== "absent"
    ? "custom"
    : owned === "duplicate" || npmImages.length > 1
    ? "duplicate"
    : custom && !compatibleCustom
    ? "custom"
    : compatibleCustom
    ? "exact"
    : owned;
  return {
    path,
    name,
    text,
    entry,
    config,
    imageCount: npmImages.length,
    kind,
    owned,
    compatibleCustom,
    missingReadme: entry.kind === "absent",
  };
}

function finding(
  state: "drifted" | "ambiguous",
  path: string,
  observation: string,
  resolution: string,
): FeatureDetection {
  return {
    state,
    evidence: [],
    issues: [{
      code: "npm-readme-badge",
      kind: "readme",
      subject: { kind: "repository-path", identifier: path },
      observation,
      resolution,
    }],
  };
}

/** Keep publication's existing workflow checks and add badge lifecycle ownership. */
export function withNpmReadmeBadge(workflow: Feature): Feature {
  return {
    ...workflow,
    capabilities: {
      provides: [],
      requires: [{
        capabilityId: "readme",
        reason: "npm publication includes a README version badge.",
      }],
    },
    detect: async (context) => {
      const current = await workflow.detect(context);
      if (current.state === "ambiguous") return current;
      const badge = await inspect(context);
      if (current.state === "disabled") {
        if (badge.owned === "exact" || badge.owned === "stale") {
          return finding(
            "drifted",
            badge.path,
            `The npm publication workflow is absent but ${badge.path} retains its owned npm badge.`,
            `Disable --github-release-publish-npm to remove its owned badge, or enable it with --repair to restore publication.`,
          );
        }
        return current;
      }
      if (!badge.name) {
        return finding(
          "ambiguous",
          "deno.json|deno.jsonc",
          badge.config.kind === "ambiguous"
            ? badge.config.observation
            : badge.config.kind === "absent"
            ? "Expected one Deno configuration with the npm package name. Found no Deno configuration."
            : valueDifference(
              badge.config.path,
              "name",
              "the npm package name used by npm-build",
              badge.config.value.name,
            ),
          "Set name in exactly one valid deno.json or deno.jsonc to the npm package published by npm-build. The built archive must use the same name.",
        );
      }
      if (badge.kind === "custom" || badge.kind === "duplicate") {
        return finding(
          "ambiguous",
          badge.path,
          badge.entry.kind !== "file"
            ? fileDifference(badge.path, badge.entry)
            : `${badge.path}: expected one npm badge with ${
              npmBadge(badge.name).content
            }. Found ${badge.imageCount} npm images and ${badge.owned} ownership markers.`,
          `Preserve custom text, then replace the conflicting badge with ${
            npmBadge(badge.name).content
          }, or remove it before enabling npm publication.`,
        );
      }
      if (current.state === "drifted") return current;
      if (badge.kind !== "exact") {
        return finding(
          "drifted",
          badge.path,
          `The npm version badge for ${badge.name} is ${
            badge.kind === "absent" ? "missing" : "outdated"
          } in ${badge.path}.`,
          `Use --repair to ${
            badge.kind === "absent" ? "add" : "replace"
          } the owned npm badge in ${badge.path} with ${
            npmBadge(badge.name).content
          }${
            badge.path.startsWith("readme/") ? " and rebuild README.md." : "."
          }`,
        );
      }
      return {
        state: "enabled",
        evidence: [...current.evidence, {
          code: "npm-readme-badge",
          kind: "readme",
          subject: { kind: "repository-path", identifier: badge.path },
          observation: `${badge.path} links its ${
            badge.compatibleCustom ? "custom" : "owned"
          } npm version badge to https://www.npmjs.com/package/${badge.name}.`,
        }],
      };
    },
    checkEnable: async (context) => {
      const check = await workflow.checkEnable(context);
      if (check.result === "blocked") return check;
      const badge = await inspect(context);
      if (!badge.name) {
        return blocked(
          "Set an explicit scoped npm package name in exactly one deno.json or deno.jsonc before adding its badge.",
        );
      }
      if (badge.kind === "custom" || badge.kind === "duplicate") {
        return blocked(
          `Resolve custom or duplicate npm badges in ${badge.path}. Keep custom text and use exactly ${
            npmBadge(badge.name).content
          }, or remove the conflicting badge. Custom content will not be overwritten.`,
        );
      }
      if (
        badge.missingReadme &&
        !context.resolvedChanges.some((change) =>
          change.enabled &&
          ["readme-static", "readme-build"].includes(change.featureId)
        )
      ) {
        return blocked(
          `Select a README provider to create ${badge.path} for the npm badge.`,
        );
      }
      if (
        badge.kind !== "exact" &&
        (await workflow.detect(context)).state === "enabled" &&
        !repairing(context)
      ) {
        return blocked(
          `Use --repair to ${
            badge.kind === "absent" ? "add" : "replace"
          } the npm badge for ${badge.name} in ${badge.path}.`,
        );
      }
      return check.result === "no-op" && badge.kind !== "exact"
        ? { result: "allowed", warnings: [], preconditions: [] }
        : check;
    },
    checkDisable: async (context) => {
      const check = await workflow.checkDisable(context);
      if (check.result !== "no-op") return check;
      const badge = await inspect(context);
      return badge.owned === "exact" || badge.owned === "stale"
        ? { result: "allowed", warnings: [], preconditions: [] }
        : check;
    },
  };
}
function repairing(context: OperationContext) {
  return context.repair?.kind === "all-drifted" ||
    context.repair?.kind === "features" &&
      context.repair.featureIds.includes(npmBadgeOwner);
}
function blocked(message: string): OperationCheck {
  return {
    result: "blocked",
    warnings: [],
    blockers: [{
      code: "npm-readme-badge",
      message,
      subjects: [],
      resolution:
        "Resolve the stated README badge or package identity before continuing.",
    }],
  };
}
