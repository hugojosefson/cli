import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { before, target, template } from "./auto-add-test-fixtures.ts";
import {
  EndpointUnavailable,
  planAutoAdd,
  UncertainProjectWrite,
} from "./auto-add.ts";
import {
  githubProjectBrowser,
  parseProjectPage,
  type ProjectPageData,
  requestWorkflow,
} from "./github-project-browser.ts";
import type { ProjectPage } from "./browser-connection.ts";
export const pageData: ProjectPageData = {
  url: target.projectUrl + "/workflows/123",
  project: { id: 123, number: 10 },
  privileges: { role: "admin" },
  workflows: [],
  configurations: [{ triggerType: "query_matched", defaultWorkflow: template }],
  create: { url: "/memexes/123/workflows" },
  update: { url: "/memexes/123/workflows" },
};
test("GitHub browser metadata requires the intended project and write access", () => {
  assertEquals(parseProjectPage(target, pageData), before);
  assertEquals(
    parseProjectPage(target, {
      ...pageData,
      configurations: [
        {
          triggerType: "query_matched",
          defaultWorkflow: {
            ...template,
            name: "Auto-archive items",
            actions: [{ actionType: "archive_project_item", arguments: {} }],
          },
        },
        ...(pageData.configurations as unknown[]),
      ],
    }).template,
    template,
  );
  for (
    const patch of [{ url: "https://github.com/login" }, {
      url: target.projectUrl + "0/workflows",
    }, { privileges: { role: "read" } }]
  ) {
    assertThrows(
      () => parseProjectPage(target, { ...pageData, ...patch }),
      Error,
      "Sign in",
    );
  }
  for (
    const patch of [{ project: { id: 123, number: 11 } }, { workflows: null }, {
      configurations: null,
    }]
  ) {
    assertThrows(
      () => parseProjectPage(target, { ...pageData, ...patch }),
      Error,
      "expected project",
    );
  }
  assertThrows(
    () =>
      parseProjectPage(target, {
        ...pageData,
        workflows: [{
          ...template,
          actions: [{ actionType: "get_items", arguments: null }],
        }],
      }),
    Error,
    "data changed",
  );
  assertEquals(
    parseProjectPage(target, { ...pageData, configurations: [], create: null })
      .template,
    undefined,
  );
});
test("GitHub adapter distinguishes endpoint rejection from uncertain writes", async () => {
  const destinations: string[] = [];
  let result: unknown = pageData;
  let lost = false;
  const page: ProjectPage = {
    navigate(url) {
      destinations.push(url);
      return Promise.resolve();
    },
    evaluate<T>() {
      return lost
        ? Promise.reject(new Error("secret"))
        : Promise.resolve(result as T);
    },
    close() {
      return Promise.resolve();
    },
  };
  const adapter = githubProjectBrowser(target, page);
  assertEquals(await adapter.inspect(), before);
  assertEquals(destinations, [target.projectUrl + "/workflows"]);
  const plan = planAutoAdd(target, before)!;
  for (const status of [404, 405, 410]) {
    result = status;
    await assertRejects(() => adapter.request(plan), EndpointUnavailable);
  }
  for (const status of [401, 403, 422, 429, 500]) {
    result = status;
    await assertRejects(() => adapter.request(plan), Error, `HTTP ${status}`);
  }
  result = 200;
  await adapter.request(plan);
  result = true;
  await adapter.configure(plan);
  lost = true;
  await assertRejects(() => adapter.request(plan), UncertainProjectWrite);
});
test("internal endpoint sends only same-origin authenticated JSON", async () => {
  const originalLocation = Object.getOwnPropertyDescriptor(
    globalThis,
    "location",
  );
  const originalFetch = globalThis.fetch;
  const requests: RequestInit[] = [];
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: {
      origin: "https://github.com",
      href: target.projectUrl + "/workflows",
    },
  });
  globalThis.fetch = (_input, init) => {
    requests.push(init!);
    return Promise.resolve(new Response(null, { status: 201 }));
  };
  try {
    assertEquals(
      await requestWorkflow({
        projectUrl: target.projectUrl,
        url: "https://github.com/memexes/123/workflows",
        method: "POST",
        body: { workflow: template },
      }),
      201,
    );
    assertEquals(requests[0].credentials, "same-origin");
    assertEquals(requests[0].redirect, "error");
    assertEquals(JSON.parse(String(requests[0].body)), { workflow: template });
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: { origin: "https://other.example", href: "https://other.example" },
    });
    assertEquals(
      await requestWorkflow({
        projectUrl: target.projectUrl,
        url: "https://github.com/memexes/123/workflows",
        method: "POST",
        body: {},
      }),
      401,
    );
    assertEquals(requests.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocation) {
      Object.defineProperty(globalThis, "location", originalLocation);
    } else Reflect.deleteProperty(globalThis, "location");
  }
});

test("browser fallback uses visible controls when GitHub omits test attributes", async () => {
  const { configureWorkflow } = await import("./github-project-browser.ts");
  const { after, enabled } = await import("./auto-add-test-fixtures.ts");
  const plan = planAutoAdd(target, {
    ...after,
    workflows: [{ ...enabled, enabled: false }],
  })!;
  const originals = new Map(
    ["document", "location", "DOMParser", "fetch"].map((
      name,
    ) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  let editing = false;
  let saves = 0;
  let stale = false;
  let routed = false;
  let navigation: ReturnType<typeof setTimeout>;
  const control = (textContent: string, click: () => void) => ({
    textContent,
    click,
    getClientRects: () => [1],
    hasAttribute: () => false,
  });
  const edit = control("Edit", () => {
    assertEquals(routed, true, "Wait for the selected workflow before Edit");
    editing = true;
  });
  const save = control("Save and turn on workflow", () => {
    saves++;
    editing = false;
  });
  const link = {
    ...control(enabled.name, () => {
      routed = false;
      values.location.href = target.projectUrl + "/workflows";
      navigation = setTimeout(() => {
        routed = true;
        values.location.href = link.href;
      }, 20);
    }),
    href: `${target.projectUrl}/workflows/${enabled.id}`,
  };
  const values = {
    location: {
      origin: "https://github.com",
      href: target.projectUrl + "/workflows",
    },
    document: {
      querySelectorAll(selector: string) {
        if (selector === 'a[href*="/workflows/"]') return [link];
        if (selector === "main button") return editing ? [save] : [edit];
        if (selector === "main h2") {
          return [control(routed ? enabled.name : "Item closed", () => {})];
        }
        return [];
      },
    },
    DOMParser: class {
      parseFromString() {
        return {
          getElementById() {
            return {
              textContent: JSON.stringify(stale ? [] : plan.before.workflows),
            };
          },
        };
      }
    },
    fetch: () => Promise.resolve(new Response("project page")),
  };
  try {
    for (const [name, value] of Object.entries(values)) {
      Object.defineProperty(globalThis, name, { configurable: true, value });
    }
    assertEquals(await configureWorkflow(plan), true);
    assertEquals(saves, 1);
    stale = true;
    await assertRejects(
      () => configureWorkflow(plan),
      Error,
      "Workflows changed before Save",
    );
    assertEquals(saves, 1);
  } finally {
    clearTimeout(navigation!);
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
