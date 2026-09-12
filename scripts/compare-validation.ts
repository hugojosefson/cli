/** Compare saved observations without running, restoring, or accepting tests. */
import { compareObservations } from "./testing/observation.ts";
if (Deno.args.length !== 2) {
  throw new Error("Provide previous and current runtime report JSON paths");
}
const [previous, current] = await Promise.all(
  Deno.args.map(async (path) => JSON.parse(await Deno.readTextFile(path))),
);
for (const line of compareObservations(previous, current)) console.log(line);
console.log(
  "Input matches are hypothetical reuse opportunities. All tests ran freshly. " +
    "Body durations exclude startup, compilation, coverage processing, and artifact transfer; they are not saved wall time.",
);
