/** @module License-link conflicts in selected overwrite artifacts. */
import {
  parseLicenseSections,
  removeLicenseSection,
} from "../readme/license-section.ts";
import type { OverwriteFiles } from "./overwrite-files.ts";

export async function clearOverwriteLicenseSections(
  files: OverwriteFiles,
): Promise<void> {
  for (const path of ["README.md", "readme/README.md"]) {
    const file = await files.observe(path);
    if (file.kind !== "file") continue;
    const sections = parseLicenseSections(file.content);
    if (sections.length === 0) continue;
    const content = [...sections].reverse().reduce(
      (text, section) => removeLicenseSection(text, section),
      file.content,
    );
    await files.write(path, content, file.mode);
  }
}
