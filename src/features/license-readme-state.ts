/** @module README facts used by owned license providers. */

import type { DetectionContext } from "../api/repository-context.ts";
import {
  inspectLicenseSection,
  type LicenseSectionState,
} from "../readme/license-section.ts";
import {
  readmeBuildRootPath,
  readmeBuildSourcePath,
} from "./readme-build-state.ts";

export type LicenseReadmeState = {
  readonly mode: "static" | "generated";
  readonly path: string;
  readonly content: string | undefined;
  readonly digest: string | undefined;
  readonly targetMode: number | undefined;
  readonly target: import("../api/artifact-inspection.ts").ArtifactObservation;
  readonly root: import("../api/artifact-inspection.ts").ArtifactObservation;
  readonly section: LicenseSectionState;
  readonly rootContent: string | undefined;
  readonly rootDigest: string | undefined;
  readonly rootMode: number | undefined;
};

export async function inspectLicenseReadme(
  context: DetectionContext,
  label: string,
  alternates: readonly string[],
): Promise<LicenseReadmeState> {
  const [root, directory] = await Promise.all([
    context.files.observe(readmeBuildRootPath),
    context.files.observe("readme"),
  ]);
  const source = directory.kind === "directory"
    ? await context.files.observe(readmeBuildSourcePath)
    : { kind: "absent" as const };
  const generated = source.kind === "file";
  const target = generated ? source : root;
  const content = target.kind === "file" ? target.content : undefined;
  return {
    mode: generated ? "generated" : "static",
    target,
    root,
    path: generated ? readmeBuildSourcePath : readmeBuildRootPath,
    content,
    digest: target.kind === "file" ? target.digest : undefined,
    targetMode: target.kind === "file" ? target.mode : undefined,
    section: content === undefined
      ? { kind: "missing" }
      : inspectLicenseSection(
        content,
        label,
        generated ? "../LICENSE" : "./LICENSE",
        alternates,
      ),
    rootContent: root.kind === "file" ? root.content : undefined,
    rootDigest: root.kind === "file" ? root.digest : undefined,
    rootMode: root.kind === "file" ? root.mode : undefined,
  };
}
