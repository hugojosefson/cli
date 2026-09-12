/** Optional changelog lifecycle that preserves existing release history. */
import { parseSemver } from "../release/semver.ts";
import {
  changelogHeadings,
  changelogLines,
} from "../release/changelog-markdown.ts";
import type { Feature } from "../api/feature.ts";
import type { FeatureDetection } from "../api/feature-detection.ts";
import type {
  AllowedOperation,
  OperationCheck,
} from "../api/feature-operation.ts";
import type {
  DetectionContext,
  OperationContext,
} from "../api/repository-context.ts";
import type { ChangePlan } from "../api/change-plan.ts";

const id = "changelog";
const path = "CHANGELOG.md";
const subject = { kind: "file", identifier: path };
export const changelogStarter = "# Changelog\n";
const resolution =
  "Automatic repair is unsupported. Make CHANGELOG.md a readable regular file, preserving its history, then inspect it again.";

async function inspect(context: DetectionContext) {
  const file = await context.files.observe(path);
  if (file.kind !== "file" && file.kind !== "absent") {
    throw new Error("CHANGELOG.md is not a readable regular file.");
  }
  return file;
}

async function detect(context: DetectionContext): Promise<FeatureDetection> {
  try {
    const file = await inspect(context);
    let observation =
      "CHANGELOG.md is absent. Enable --changelog to create it with # Changelog.";
    if (file.kind === "file") {
      const headings = changelogHeadings(file.content).filter((heading) =>
        heading.level === 2
      );
      const releaseText = headings.flatMap((heading, index) =>
        parseSemver(heading.title)
          ? [file.content.slice(heading.offset, headings[index + 1]?.offset)]
          : []
      ).join("\n");
      const content = changelogLines(releaseText).map((line) => line.text).join(
        "\n",
      );
      const flat = /^[-*] [a-z][a-z0-9-]*(?:\([\w./@ -]+\))?!?: .+/m.test(
        content,
      );
      const grouped = /^### (?:BREAKING CHANGE|Features|Fixes|Other)\r?$/m.test(
        content,
      );
      observation = flat
        ? `CHANGELOG.md contains ${
          grouped ? "mixed flat and grouped" : "flat"
        } entries. Existing history is preserved. Optional migration preview: hj changelog migrate.`
        : grouped
        ? "CHANGELOG.md contains grouped release sections. Existing history is preserved."
        : file.content === changelogStarter
        ? "CHANGELOG.md has an empty starter heading, ready for release entries."
        : "CHANGELOG.md exists with custom content. Existing history is preserved.";
    }
    return {
      state: file.kind === "file" ? "enabled" : "disabled",
      evidence: [{
        code: "changelog-observed",
        kind: id,
        subject,
        observation,
      }],
    };
  } catch {
    const issue = {
      code: "changelog-unreadable",
      kind: id,
      subject,
      observation: "CHANGELOG.md could not be read as a regular file.",
      resolution,
    };
    return { state: "ambiguous", evidence: [issue], issues: [issue] };
  }
}

async function check(
  context: OperationContext,
  enabled: boolean,
): Promise<OperationCheck> {
  try {
    const file = await inspect(context);
    if (
      (enabled && file.kind === "file") || (!enabled && file.kind === "absent")
    ) {
      return {
        result: "no-op",
        warnings: [],
        reason: enabled
          ? "Existing CHANGELOG.md is preserved."
          : "CHANGELOG.md is absent.",
      };
    }
    if (!enabled && file.kind === "file" && file.content !== changelogStarter) {
      return {
        result: "blocked",
        warnings: [],
        blockers: [{
          code: "changelog-history",
          subjects: [subject],
          message:
            "CHANGELOG.md contains history or custom content; automatic deletion is unsupported.",
          resolution:
            "Keep the changelog enabled, or archive its contents and remove CHANGELOG.md manually after disabling dependent release publication.",
        }],
      };
    }
    return {
      result: "allowed",
      warnings: [],
      preconditions: [{
        kind: "file-digest",
        path,
        digest: file.kind === "file" ? file.digest : undefined,
      }],
    };
  } catch {
    return {
      result: "blocked",
      warnings: [],
      blockers: [{
        code: "changelog-unreadable",
        subjects: [subject],
        message: "CHANGELOG.md could not be read as a regular file.",
        resolution,
      }],
    };
  }
}

async function plan(
  context: OperationContext,
  enabled: boolean,
  allowed: AllowedOperation,
): Promise<ChangePlan> {
  const file = await inspect(context);
  const checked = await check(context, enabled);
  if (checked.result !== "allowed") {
    throw new Error("Changelog operation no longer matches its checked state.");
  }
  let changes: ChangePlan["changes"];
  if (enabled) {
    changes = [{
      kind: "write-file",
      path,
      content: changelogStarter,
      expectedDigest: undefined,
    }];
  } else {
    if (file.kind !== "file") {
      throw new Error("CHANGELOG.md disappeared during planning.");
    }
    changes = [{ kind: "remove-file", path, expectedDigest: file.digest }];
  }
  return {
    featureId: id,
    action: enabled ? "enable" : "disable",
    summary: enabled
      ? "Create CHANGELOG.md with # Changelog."
      : "Remove the empty CHANGELOG.md starter.",
    warnings: allowed.warnings,
    preconditions: allowed.preconditions,
    changes,
    validations: [{
      kind: "feature-redetection",
      featureId: id,
      expected: enabled ? "enabled" : "disabled",
    }],
  };
}

/** Presence, rather than a required style, defines a valid changelog. */
export const changelogFeature: Feature = {
  metadata: {
    id,
    name: "Changelog",
    summary:
      "Keep release history, with optional migration from flat entries to grouped sections.",
  },
  dependencies: { requires: [] },
  capabilities: { provides: [], requires: [] },
  detect,
  checkEnable: (context) => check(context, true),
  checkDisable: (context) => check(context, false),
  planEnable: (context, allowed) => plan(context, true, allowed),
  planDisable: (context, allowed) => plan(context, false, allowed),
};
