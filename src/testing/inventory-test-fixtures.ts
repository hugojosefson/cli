/** Observe native node:test bodies without replacing its runner or contexts. */
import { appendFileSync } from "node:fs";
import process from "node:process";
import type { test as nativeTest, TestContext } from "node:test";

type Body = (context: TestContext) => unknown | Promise<unknown>;
const parents = new WeakMap<TestContext, string>();
const occurrences = new Map<string, number>();
function event(id: string, state: string) {
  const path = process.env.HJ_TEST_INVENTORY;
  if (path) appendFileSync(path, JSON.stringify({ id, state }) + "\n");
}
function tracked(
  id: string,
  body: Body,
): (context: TestContext) => Promise<void> {
  event(id, "registered");
  return async (context) => {
    parents.set(context, id);
    event(id, "started");
    const original = { skip: context.skip, todo: context.todo };
    for (const method of ["skip", "todo"] as const) {
      context[method] = (...args: Parameters<TestContext[typeof method]>) => {
        event(id, method === "skip" ? "skipped" : "todo");
        return Reflect.apply(original[method], context, args);
      };
    }
    try {
      await body(context);
      event(id, "passed");
    } catch (error) {
      event(id, "failed");
      throw error;
    } finally {
      context.skip = original.skip;
      context.todo = original.todo;
    }
  };
}
function identify(parent: string, name: string) {
  const base = `${parent} > ${name}`;
  const count = (occurrences.get(base) ?? 0) + 1;
  occurrences.set(base, count);
  return `${base} #${count}`;
}
export function trackTests(url: string, test: typeof nativeTest) {
  const path = new URL(url).pathname;
  const relative = path.slice(
    Math.max(path.lastIndexOf("/src/"), path.lastIndexOf("/scripts/")),
  );
  const filename = decodeURIComponent(relative).match(
    /\/(src|scripts)\/(.*)_test\.(ts|js)$/,
  );
  if (!filename) throw new Error(`Unrecognized test module: ${url}`);
  const file = `${filename[1]}/${filename[2]}_test.ts`;
  return (name: string, body: Body) =>
    test(name, tracked(identify(file, name), body));
}
/** Subtests remain awaited native t.test calls, with their own executed identity. */
export function testStep(context: TestContext, name: string, body: Body) {
  const parent = parents.get(context);
  if (!parent) throw new Error("Subtest lacks a tracked parent");
  return context.test(name, tracked(identify(parent, name), body));
}
