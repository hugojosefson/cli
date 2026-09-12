import { deepStrictEqual as assertEquals, ok as assert } from "node:assert";
import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import * as fs from "node:fs/promises";
import { makeTempDirectory } from "../runtime/temp.ts";
import { inspectArtifact } from "../artifacts/inspect-artifact.ts";
import {
  accessFromMode,
  fileAccess,
  inspectFileAccess,
  matchesFileAccess,
  repairFileMode,
} from "./file-access.ts";
import { LocalFileReader } from "./local-file-reader.ts";

test("artifact access accepts sharing modes and uses observed user access", () => {
  const schema = {
    kind: "file",
    path: "file",
    content: "text",
    mode: 0o644,
  } as const;
  for (const mode of [0o600, 0o640, 0o644, 0o660, 0o664, 0o666, 0o645]) {
    const file = {
      kind: "file",
      content: "text",
      digest: "digest",
      mode,
    } as const;
    assertEquals(inspectArtifact(schema, file).result, "matches");
  }
  // These permissions come from a group or ACL, not the owner's mode bits.
  const group = { mode: 0o460, access: accessFromMode(0o460, 3) };
  assert(matchesFileAccess(group, 0o644));
  assertEquals(repairFileMode(group, 0o444), 0o440);
  const other = { mode: 0o406, access: accessFromMode(0o406, 0) };
  assert(matchesFileAccess(other, 0o644));
  assertEquals(repairFileMode(other, 0o444), 0o404);
  const acl = { mode: 0o640, access: { ...accessFromMode(0o644), shift: 3 } };
  assert(matchesFileAccess(acl, 0o644));
  const denied = {
    mode: 0o666,
    access: { ...accessFromMode(0o444), shift: 0 },
  };
  assert(!matchesFileAccess(denied, 0o644));
  assert(matchesFileAccess(denied, 0o444));
  assert(!matchesFileAccess({ mode: 0o644 }, 0o755));
  assert(matchesFileAccess({ mode: 0o700 }, 0o755));
  assertEquals(repairFileMode({ mode: 0o440 }, 0o644), 0o640);
  assertEquals(repairFileMode({ mode: 0o664 }, 0o444), 0o464);
});

test("local access inspection is read-only for files and directories", async () => {
  const path = await makeTempDirectory({
    dir: "/tmp/opencode",
    prefix: "file-access-",
  });
  const root = new URL(`file://${path}/`);
  const file = new URL("a file; literal $name", root);
  try {
    await fs.writeFile(file, "preserve me");
    const reader = new LocalFileReader(root);
    for (const mode of [0o600, 0o640, 0o664, 0o400, 0o440, 0o464]) {
      await fs.chmod(file, mode);
      const before = await fs.stat(file);
      const observed = await reader.observe("a file; literal $name");
      assert(observed.kind === "file");
      assertEquals(fileAccess(observed).readable, true);
      assertEquals(fileAccess(observed).writable, !!(mode & 0o200));
      assertEquals(fileAccess(observed).executable, false);
      const after = await fs.stat(file);
      assertEquals(after.mode, before.mode);
      assertEquals(after.mtime, before.mtime);
      assertEquals(observed.content, "preserve me");
    }
    for (const mode of [0o700, 0o750, 0o770, 0o500]) {
      await fs.chmod(root, mode);
      const info = await fs.stat(root);
      const access = await inspectFileAccess(root, {
        uid: info.uid!,
        gid: info.gid!,
      });
      assertEquals(access.readable, true);
      assertEquals(access.writable, !!(mode & 0o200));
      assertEquals(access.executable, true);
      assertEquals((await fs.stat(root)).mode, info.mode);
    }
    await fs.chmod(root, 0o700);
    assertEquals(await reader.observe("missing"), { kind: "absent" });
  } finally {
    await fs.chmod(root, 0o700);
    await fs.rm(root, { recursive: true });
  }
});
