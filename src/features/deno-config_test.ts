import { test as nativeTest } from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { applyEdits, modify } from "jsonc-parser";
import { assert, assertEquals } from "@std/assert";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import { readDenoConfig } from "../repository/read-deno-config.ts";
import { inspectDenoConfig } from "./deno-config.ts";
import { denoFmtConfigText } from "./deno-tasks.ts";
import {
  denoLockOwnershipPath,
  denoLockOwnershipText,
} from "./deno-lock-ownership.ts";
const test = trackTests(import.meta.url, nativeTest);

test("plain config reading preserves JSONC bytes and rejects ambiguous or non-object inputs", async () => {
  const path = await mkdtemp("/tmp/opencode/hj-config-reader-");
  const root = pathToFileURL(path + "/");
  const files = new LocalFileReader(root, false);
  try {
    assertEquals(await readDenoConfig({ files }), { kind: "absent" });
    for (const content of ["null", "[]", "{broken"]) {
      await writeFile(new URL("deno.jsonc", root), content);
      assertEquals((await readDenoConfig({ files })).kind, "ambiguous");
    }
    const text = '{\n // preserve comments\n "version": "1.2.3",\n}\n';
    await writeFile(new URL("deno.jsonc", root), text);
    const result = await readDenoConfig({ files });
    assert(result.kind === "config");
    assertEquals(result.text, text);
    assertEquals(result.value, { version: "1.2.3" });
    assertEquals(result.digest, await files.digest("deno.jsonc"));
    assertEquals(Object.hasOwn(result, "exactStandalone"), false);
    assertEquals(await readFile(new URL("deno.jsonc", root), "utf8"), text);
    await writeFile(new URL("deno.json", root), "{}");
    assertEquals(await readDenoConfig({ files }), {
      kind: "ambiguous",
      observation:
        "Both deno.json and deno.jsonc exist. Expected one Deno configuration file. Found two.",
    });
    await rm(new URL("deno.jsonc", root));
    await rm(new URL("deno.json", root));
    await mkdir(new URL("deno.json", root));
    assertEquals((await readDenoConfig({ files })).kind, "ambiguous");
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});

test("feature classification retains standalone and owned-lock behavior after reader separation", async () => {
  const path = await mkdtemp("/tmp/opencode/hj-config-classifier-");
  const root = pathToFileURL(path + "/");
  const files = new LocalFileReader(root, false);
  const exact = async () => {
    const result = await inspectDenoConfig({ files });
    assert(result.kind === "config");
    return result.exactStandalone;
  };
  try {
    assertEquals(await inspectDenoConfig({ files }), { kind: "absent" });
    const canonical = denoFmtConfigText();
    await writeFile(new URL("deno.jsonc", root), canonical);
    assertEquals(await exact(), true);
    const withLock = applyEdits(
      canonical,
      modify(canonical, ["lock"], false, {}),
    );
    await writeFile(new URL("deno.jsonc", root), withLock);
    assertEquals(await exact(), false);
    await mkdir(new URL(".hj/", root));
    await writeFile(
      new URL(denoLockOwnershipPath, root),
      denoLockOwnershipText({
        version: 1,
        configPath: "deno.jsonc",
        lock: false,
      }),
    );
    assertEquals(await exact(), true);
    await writeFile(
      new URL(denoLockOwnershipPath, root),
      denoLockOwnershipText({
        version: 1,
        configPath: "deno.jsonc",
        lock: false,
        explicit: true,
      }),
    );
    assertEquals(await exact(), false);
    assertEquals(await readFile(new URL("deno.jsonc", root), "utf8"), withLock);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});
