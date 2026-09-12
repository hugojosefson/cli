import { createServer } from "node:http";
// @deno-types="npm:@types/ws@8.18.1"
import { type WebSocket as FixtureSocket, WebSocketServer } from "ws";
import { closeServer, listen } from "../testing/network-test-fixtures.ts";
import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { browserAddress, connectProjectBrowser } from "./browser-connection.ts";

test("Firefox connection accepts only explicit local session addresses", () => {
  assertEquals(
    browserAddress("ws://127.0.0.1:9222/session"),
    "ws://127.0.0.1:9222/session",
  );
  for (
    const address of [
      "ws://example.org:9222/session",
      "http://127.0.0.1:9222/session",
      "ws://127.0.0.1:9222/session?token=secret",
      "ws://user:secret@127.0.0.1:9222/session",
      "ws://127.0.0.1:9222/other",
    ]
  ) assertThrows(() => browserAddress(address));
});
test("Firefox BiDi creates and closes only its own tab", async () => {
  const requests: {
    id: number;
    method: string;
    params: Record<string, unknown>;
  }[] = [];
  let socket: FixtureSocket | undefined;
  let failure = false;
  let exception = false;
  const server = createServer();
  const websocket = new WebSocketServer({ server });
  websocket.on("connection", (connection) => {
    socket = connection;
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      requests.push(message);
      let result: unknown = {};
      if (message.method === "browsingContext.create") {
        result = {
          context: "own-tab",
        };
      }
      if (message.method === "script.callFunction") {
        result = {
          type: exception ? "exception" : "success",
          result: { type: "string", value: JSON.stringify({ safe: true }) },
        };
      }
      socket!.send(JSON.stringify(
        failure
          ? { type: "error", id: message.id, message: "untrusted secret" }
          : { type: "success", id: message.id, result },
      ));
    };
  });
  const port = await listen(server);
  try {
    const page = await connectProjectBrowser(
      `ws://127.0.0.1:${port}/session`,
    );
    await page.navigate(
      "https://github.com/users/example/projects/10/workflows",
    );
    assertEquals(await page.evaluate((value) => ({ safe: value }), true), {
      safe: true,
    });
    exception = true;
    await assertRejects(
      () => page.evaluate((value) => value, null),
      Error,
      "rejected automation",
    );
    failure = true;
    await assertRejects(
      () => page.navigate("https://github.com/"),
      Error,
      "rejected an automation",
    );
    failure = false;
    await page.close();
    assertEquals(
      requests.filter((item) => item.method === "browser.close"),
      [],
    );
    assertEquals(requests.at(-2), {
      id: 7,
      method: "browsingContext.close",
      params: { context: "own-tab" },
    });
    assertEquals(requests[3].params.arguments, [{
      type: "string",
      value: "true",
    }]);
  } finally {
    socket?.terminate();
    await new Promise<void>((resolve, reject) =>
      websocket.close((error) => error ? reject(error) : resolve())
    );
    await closeServer(server);
  }
});
test("Firefox connection reports a missing browser without launching one", async () => {
  const listener = createServer();
  const port = await listen(listener);
  await closeServer(listener);
  await assertRejects(
    () => connectProjectBrowser(`ws://127.0.0.1:${port}/session`),
    Error,
    "Start Firefox",
  );
});
