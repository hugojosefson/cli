/** Loopback HTTP fixtures with explicit startup and awaited shutdown. */
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
export async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return (server.address() as AddressInfo).port;
}
export async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}
export async function serveFixture(
  handler: (request: Request) => Response | Promise<Response>,
) {
  const errors: unknown[] = [];
  const server = createServer(async (request, response) => {
    try {
      const result = await handler(
        new Request(`http://127.0.0.1${request.url}`),
      );
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(new Uint8Array(await result.arrayBuffer()));
    } catch (error) {
      errors.push(error);
      response.writeHead(500).end();
    }
  });
  const port = await listen(server);
  return {
    addr: { port },
    async shutdown() {
      await closeServer(server);
      if (errors.length) {
        throw new AggregateError(errors, "HTTP fixture failed");
      }
    },
  };
}
