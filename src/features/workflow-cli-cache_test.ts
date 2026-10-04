import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
import { assertEquals } from "@std/assert";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { closeServer, listen } from "../testing/network-test-fixtures.ts";
import { makeTempDir, remove } from "../testing/files-test-fixtures.ts";
import { runRawCommand } from "../runtime/command.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import { LocalGitReader } from "../repository/local-git-reader.ts";
import { hjPackageReference } from "./hj-package.ts";
import { workflowCliArtifact } from "./workflow-cli.ts";

const test = trackTests(import.meta.url, nativeTest);

test("latest workflow command refreshes cached JSR metadata after a new publication", async () => {
  const directory = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-jsr-cache-",
  });
  const root = new URL(`file://${directory}/`);
  const packageName = hjPackageReference.slice(
    4,
    hjPackageReference.lastIndexOf("@"),
  );
  const versions = ["1.0.0"];
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "public, max-age=86400");
    response.setHeader("Content-Type", "application/json");
    if (request.url === `/${packageName}/meta.json`) {
      response.end(JSON.stringify({
        latest: versions.at(-1),
        versions: Object.fromEntries(
          versions.map(
            (version) => [version, { createdAt: "2020-01-01T00:00:00Z" }],
          ),
        ),
      }));
      return;
    }
    for (const version of versions) {
      const source = `console.log("${version}");\n`;
      if (request.url === `/${packageName}/${version}_meta.json`) {
        response.end(JSON.stringify({
          exports: { ".": "./main.ts" },
          manifest: {
            "/main.ts": {
              size: source.length,
              checksum: "sha256-" +
                createHash("sha256").update(source).digest("hex"),
            },
          },
          moduleGraph2: { "/main.ts": {} },
        }));
        return;
      }
      if (request.url === `/${packageName}/${version}/main.ts`) {
        response.setHeader("Content-Type", "application/typescript");
        response.end(source);
        return;
      }
    }
    response.writeHead(404);
    response.end();
  });
  try {
    const registry = `http://127.0.0.1:${await listen(server)}/`;
    const context = {
      repositoryRoot: root,
      files: new LocalFileReader(root, false),
      git: new LocalGitReader(root),
      options: { workflowCli: "jsr-latest" },
    };
    const artifact = workflowCliArtifact(
      {
        path: ".github/workflows/test.yaml",
        content: `# Generated\nrun --no-lock ${hjPackageReference}`,
      },
      context,
      { kind: "absent" },
    );
    const args = artifact.content.split("\n").at(-1)!.replace(
      "https://jsr.io/",
      registry,
    ).split(" ");
    const run = async () => {
      const result = await runRawCommand("deno", {
        args,
        cwd: root,
        env: { DENO_DIR: `${directory}/cache`, JSR_URL: registry },
      });
      assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
      return new TextDecoder().decode(result.stdout).trim();
    };
    assertEquals(await run(), "1.0.0");
    versions.push("2.0.0");
    assertEquals(await run(), "2.0.0");
  } finally {
    await closeServer(server);
    await remove(root, { recursive: true });
  }
});
