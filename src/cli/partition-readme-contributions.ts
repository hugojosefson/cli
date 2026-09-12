/** @module Keep cumulative README contributions in their owning feature commits. */
import type { ChangePlan } from "../api/change-plan.ts";
import type { FileSnapshot, FileVersion } from "./feature-file-snapshot.ts";

interface FeatureFiles {
  readonly plan: ChangePlan;
  readonly files: Map<string, FileVersion | undefined>;
}
const pattern =
  /<!-- hj:readme ([\w:-]+) ([a-f0-9]+) -->\n[\s\S]*?\n<!-- \/hj:readme -->\n?/g;

/** Restore reached owners when a later captured snapshot predates their block. */
export function partitionReadmeContributions(
  baseline: FileSnapshot,
  features: FeatureFiles[],
  final: FileSnapshot,
): void {
  const provider =
    features.find((feature) =>
        feature.plan.featureId === "readme-build" &&
        feature.plan.action === "enable"
      )
      ? "readme-build"
      : "readme-static";
  const owner = (id: string) =>
    id.startsWith("readme:") ? provider : id.split(":")[0];
  const selected = new Set(features.map((feature) => feature.plan.featureId));
  for (const path of ["README.md", "readme/README.md"]) {
    const target = final.get(path);
    if (!target) continue;
    const targetText = decode(target);
    const initial = baseline.get(path);
    const initialBlocks = blocks(initial ? decode(initial) : "");
    const targetBlocks = blocks(targetText);
    const ids = [...new Set([...initialBlocks.keys(), ...targetBlocks.keys()])]
      .filter((id) => selected.has(owner(id)));
    if (!ids.length) continue;
    const reached = new Set<string>();
    let actual = initial;
    let previous = initial;
    for (const feature of features) {
      reached.add(feature.plan.featureId);
      if (feature.files.has(path)) actual = feature.files.get(path);
      if (!actual) continue;
      let text = decode(actual);
      // Use the final layout when only contributed blocks differ. This also
      // preserves the exact blank lines around additions and removals.
      if (body(text, ids) === body(targetText, ids)) text = targetText;
      for (const id of ids) {
        const desired = (reached.has(owner(id)) ? targetBlocks : initialBlocks)
          .get(id);
        const current = blocks(text).get(id);
        if (current) text = text.replace(current, desired ?? "");
        else if (desired) text = insert(text, desired, id, targetBlocks);
      }
      const version = { ...actual, bytes: new TextEncoder().encode(text) };
      if (
        !previous || decode(previous) !== text || previous.mode !== version.mode
      ) {
        feature.files.set(path, version);
      } else feature.files.delete(path);
      previous = version;
    }
  }
}

function blocks(text: string): Map<string, string> {
  return new Map(
    [...text.matchAll(pattern)].map((match) => [match[1], match[0]]),
  );
}
function body(text: string, ids: string[]): string {
  return text.replace(pattern, (block, id) => ids.includes(id) ? "" : block)
    .replace(/\n{2,}/g, "\n\n").trimEnd();
}
function decode(file: FileVersion): string {
  return new TextDecoder().decode(file.bytes);
}
function insert(
  text: string,
  block: string,
  id: string,
  target: Map<string, string>,
): string {
  const order = [...target.keys()];
  const later = order.slice(order.indexOf(id) + 1).map((key) =>
    text.indexOf(`<!-- hj:readme ${key} `)
  ).filter((index) => index >= 0);
  const license = text.search(/^## License\s*$/im);
  const at = Math.min(...later, license < 0 ? text.length : license);
  const before = text.slice(0, at).replace(/\n*$/, "");
  const after = text.slice(at).replace(/^\n*/, "");
  return before + "\n\n" + block + (after ? "\n" + after : "");
}
