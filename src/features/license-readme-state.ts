/** @module README facts used by owned license providers. */

import { fileAccess } from "../repository/file-access.ts";
import type { DetectionContext } from "../api/repository-context.ts";
import { buildReadme } from "../readme/build-readme.ts";
import {
  inspectLicenseSection,
  type LicenseSectionState,
} from "../readme/license-section.ts";
import {
  inspectReadmeBuild,
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
  readonly rootFresh: boolean;
  readonly rootMode: number | undefined;
};

export async function inspectLicenseReadme(
  context: DetectionContext,
  label: string,
  alternates: readonly string[],
): Promise<LicenseReadmeState> {
  const build = await inspectReadmeBuild(context);
  const root = build.root;
  const source = build.source;
  const generated = source.kind === "file" &&
    (build.generatedMarker || build.exactTask);
  const target = generated ? source : root;
  const content = target.kind === "file" ? target.content : undefined;
  let output: string | undefined;
  if (generated) {
    try {
      output = await buildReadme(context.repositoryRoot);
    } catch {
      output = undefined;
    }
  }
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
    rootFresh: !generated || output !== undefined && root.kind === "file" &&
        root.content === output && !fileAccess(root).writable &&
        source.kind === "file" && fileAccess(source).writable,
    rootMode: root.kind === "file" ? root.mode : undefined,
  };
}
