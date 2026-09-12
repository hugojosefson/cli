/** One explicit source inventory shared by every test runner and native emitter. */
import { readdir } from "node:fs/promises";
export async function testFiles(root: URL): Promise<string[]> {
  const files: string[] = [];
  async function visit(path: string) {
    for (
      const entry of await readdir(new URL(path, root), { withFileTypes: true })
    ) {
      if (
        entry.name === "node_modules" || entry.name === ".git" ||
        entry.name === ".hj"
      ) continue;
      const name = path + entry.name;
      if (entry.isDirectory()) await visit(name + "/");
      if (entry.isFile() && entry.name.endsWith("_test.ts")) files.push(name);
    }
  }
  await visit("src/");
  await visit("scripts/");
  return files.sort();
}
export interface InventoryEvent {
  id: string;
  state: string;
}
export function executedInventory(
  events: InventoryEvent[],
  complete = true,
): string[] {
  const histories = new Map<string, string[]>();
  for (const { id, state } of events) {
    const states = histories.get(id) ?? [];
    states.push(state);
    histories.set(id, states);
  }
  const executed: string[] = [];
  for (const [id, states] of histories) {
    if (!complete && states.join() === "registered") continue;
    if (states.join() !== "registered,started,passed") {
      throw new Error(`Incomplete or failed test: ${id}: ${states.join(", ")}`);
    }
    executed.push(id);
  }
  if (!executed.length) throw new Error("No test bodies executed");
  return executed.sort();
}

export interface InventoryReport {
  runtime: string;
  complete: boolean;
  success: boolean;
  files: string[];
  tests: string[];
}
/** A saved or partial success cannot substitute for a complete matrix result. */
export function compareInventories(reports: InventoryReport[]): void {
  if (reports.length !== 4) {
    throw new Error("The matrix requires four runtime reports");
  }
  for (const report of reports) {
    if (
      !report.complete || !report.success || !report.tests.length ||
      !report.files.length
    ) throw new Error(`Incomplete matrix result: ${report.runtime}`);
    if (
      JSON.stringify(report.files) !== JSON.stringify(reports[0].files) ||
      JSON.stringify(report.tests) !== JSON.stringify(reports[0].tests)
    ) throw new Error(`Executed test inventory differs for ${report.runtime}`);
  }
}
