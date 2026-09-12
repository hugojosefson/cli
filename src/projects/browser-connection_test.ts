import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { browserAddress, connectProjectBrowser } from "./browser-connection.ts";

Deno.test("Firefox connection accepts only explicit local session addresses", () => {
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
Deno.test("Firefox BiDi creates and closes only its own tab", async () => {
  const requests: {
    id: number;
    method: string;
    params: Record<string, unknown>;
  }[] = [];
  let socket: WebSocket | undefined;
  let failure = false;
  let exception = false;
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen() {} },
    (request) => {
      const upgraded = Deno.upgradeWebSocket(request);
      socket = upgraded.socket;
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
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
      return upgraded.response;
    },
  );
  try {
    const page = await connectProjectBrowser(
      `ws://127.0.0.1:${server.addr.port}/session`,
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
    socket?.close();
    await server.shutdown();
  }
});
Deno.test("Firefox connection reports a missing browser without launching one", async () => {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = listener.addr.port;
  listener.close();
  await assertRejects(
    () => connectProjectBrowser(`ws://127.0.0.1:${port}/session`),
    Error,
    "Start Firefox",
  );
});
