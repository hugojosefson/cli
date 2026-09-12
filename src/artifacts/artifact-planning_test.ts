import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { assertEquals } from "@std/assert";
import type {
  ArtifactObservation,
  ArtifactSchema,
} from "../api/artifact-inspection.ts";
import { inspectArtifact } from "./inspect-artifact.ts";
import {
  planArtifactCreation,
  planArtifactRemoval,
} from "./plan-artifact-change.ts";

const file: ArtifactSchema = {
  kind: "file",
  path: "deno.json",
  content: "{}\n",
  mode: 0o644,
};
const directory: ArtifactSchema = {
  kind: "directory",
  path: ".github",
  stateDigest: "directory-digest",
};
const symlink: ArtifactSchema = {
  kind: "symlink",
  path: "current",
  target: "releases/current",
};

function inspect(schema: ArtifactSchema, observation: ArtifactObservation) {
  return inspectArtifact(schema, observation);
}

function differences(schema: ArtifactSchema, observation: ArtifactObservation) {
  const result = inspect(schema, observation);
  if (result.result !== "differs") {
    throw new Error("test setup requires a difference");
  }
  return result.differences;
}

function changes(result: ReturnType<typeof planArtifactRemoval>) {
  if (result.result !== "planned") {
    throw new Error("test setup requires a plan");
  }
  return result.changes;
}

test("inspects exact absent, file, directory, and symlink schemas", () => {
  assertEquals(inspect({ kind: "absent", path: "gone" }, { kind: "absent" }), {
    result: "matches",
    schema: { kind: "absent", path: "gone" },
    observation: { kind: "absent" },
  });
  assertEquals(
    inspect(file, {
      kind: "file",
      content: "{}\n",
      digest: "file-digest",
      mode: 0o644,
    }).result,
    "matches",
  );
  assertEquals(
    inspect(directory, {
      kind: "directory",
      stateDigest: "directory-digest",
    }).result,
    "matches",
  );
  assertEquals(
    inspect(symlink, {
      kind: "symlink",
      target: "releases/current",
    }).result,
    "matches",
  );
});

test("reports absent desired artifacts and absent observations", () => {
  assertEquals(inspect(file, { kind: "absent" }), {
    result: "absent",
    schema: file,
  });
  assertEquals(
    inspect({ kind: "absent", path: "gone" }, {
      kind: "file",
      content: "kept\n",
      digest: "kept-digest",
      mode: 0o644,
    }),
    {
      result: "differs",
      schema: { kind: "absent", path: "gone" },
      observation: {
        kind: "file",
        content: "kept\n",
        digest: "kept-digest",
        mode: 0o644,
      },
      differences: [{
        kind: "artifact-kind",
        expected: "absent",
        actual: "file",
      }],
    },
  );
});

test("reports every file difference in stable order", () => {
  assertEquals(
    inspect(file, {
      kind: "file",
      content: '{ "drift": true }\n',
      digest: "drift-digest",
      mode: 0o755,
    }),
    {
      result: "differs",
      schema: file,
      observation: {
        kind: "file",
        content: '{ "drift": true }\n',
        digest: "drift-digest",
        mode: 0o755,
      },
      differences: [
        { kind: "content", expected: "{}\n", actual: '{ "drift": true }\n' },
        { kind: "mode", expected: 0o644, actual: 0o755 },
      ],
    },
  );
});

test("reports directory, symlink, kind, and unreadable differences", () => {
  assertEquals(
    differences(directory, {
      kind: "directory",
      stateDigest: "changed-digest",
    }),
    [{
      kind: "directory-state",
      expected: "directory-digest",
      actual: "changed-digest",
    }],
  );
  assertEquals(
    differences(symlink, {
      kind: "symlink",
      target: "other",
    }),
    [{
      kind: "symlink-target",
      expected: "releases/current",
      actual: "other",
    }],
  );
  assertEquals(
    differences(file, {
      kind: "directory",
      stateDigest: "other",
    }),
    [{ kind: "artifact-kind", expected: "file", actual: "directory" }],
  );
  assertEquals(
    inspect(file, {
      kind: "unreadable",
      observation: "permission denied",
    }),
    {
      result: "unreadable",
      schema: file,
      observation: "permission denied",
    },
  );
});

test("plans creation only for absent paths", () => {
  assertEquals(planArtifactCreation(inspect(file, { kind: "absent" })), {
    result: "planned",
    changes: [{
      kind: "write-file",
      path: "deno.json",
      content: "{}\n",
      mode: 0o644,
      expectedDigest: undefined,
    }],
  });
  assertEquals(planArtifactCreation(inspect(directory, { kind: "absent" })), {
    result: "planned",
    changes: [{ kind: "create-directory", path: ".github" }],
  });
  assertEquals(planArtifactCreation(inspect(symlink, { kind: "absent" })), {
    result: "planned",
    changes: [{
      kind: "create-symlink",
      path: "current",
      target: "releases/current",
    }],
  });
});

test("creation leaves matching artifacts alone and reports drift or ambiguity", () => {
  assertEquals(
    planArtifactCreation(inspect(file, {
      kind: "file",
      content: "{}\n",
      digest: "file-digest",
      mode: 0o644,
    })),
    { result: "no-op", changes: [] },
  );
  assertEquals(
    planArtifactCreation(inspect(file, {
      kind: "file",
      content: "changed\n",
      digest: "changed-digest",
      mode: 0o644,
    })).result,
    "drifted",
  );
  assertEquals(
    planArtifactCreation(inspect(file, {
      kind: "symlink",
      target: "elsewhere",
    })).result,
    "ambiguous",
  );
  assertEquals(
    planArtifactCreation(inspect(file, {
      kind: "unreadable",
      observation: "permission denied",
    })).result,
    "ambiguous",
  );
});

test("removes exact owned artifacts with state guards", () => {
  assertEquals(
    planArtifactRemoval(
      inspect(file, {
        kind: "file",
        content: "{}\n",
        digest: "file-digest",
        mode: 0o644,
      }),
      "owned",
    ),
    {
      result: "planned",
      changes: [{
        kind: "remove-file",
        path: "deno.json",
        expectedDigest: "file-digest",
      }],
    },
  );
  assertEquals(
    changes(planArtifactRemoval(
      inspect(directory, {
        kind: "directory",
        stateDigest: "directory-digest",
      }),
      "owned",
    )),
    [{
      kind: "remove-directory",
      path: ".github",
      expectedStateDigest: "directory-digest",
    }],
  );
  assertEquals(
    changes(planArtifactRemoval(
      inspect(symlink, {
        kind: "symlink",
        target: "releases/current",
      }),
      "owned",
    )),
    [{
      kind: "remove-symlink",
      path: "current",
      expectedTarget: "releases/current",
    }],
  );
});

test("removal preserves seed artifacts and represents drift and ambiguity", () => {
  assertEquals(
    planArtifactRemoval(
      inspect(file, {
        kind: "file",
        content: "{}\n",
        digest: "file-digest",
        mode: 0o644,
      }),
      "seed",
    ),
    { result: "preserved", changes: [] },
  );
  assertEquals(
    planArtifactRemoval(
      inspect(file, {
        kind: "file",
        content: "user-owned now\n",
        digest: "changed-digest",
        mode: 0o644,
      }),
      "seed",
    ),
    { result: "preserved", changes: [] },
  );
  assertEquals(
    planArtifactRemoval(
      inspect(file, {
        kind: "file",
        content: "changed\n",
        digest: "changed-digest",
        mode: 0o644,
      }),
      "owned",
    ).result,
    "drifted",
  );
  assertEquals(
    planArtifactRemoval(
      inspect(file, {
        kind: "directory",
        stateDigest: "directory-digest",
      }),
      "owned",
    ).result,
    "ambiguous",
  );
  assertEquals(
    planArtifactRemoval(
      inspect({ kind: "absent", path: "gone" }, {
        kind: "absent",
      }),
      "owned",
    ),
    { result: "no-op", changes: [] },
  );
  assertEquals(
    planArtifactRemoval(inspect(file, { kind: "absent" }), "owned"),
    { result: "no-op", changes: [] },
  );
});
