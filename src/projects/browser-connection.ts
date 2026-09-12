/** A connection to an existing Firefox session using WebDriver BiDi. */
export interface ProjectPage {
  navigate(url: string): Promise<void>;
  evaluate<T, A>(fn: (arg: A) => T | Promise<T>, arg: A): Promise<T>;
  close(): Promise<void>;
}

export function browserAddress(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "ws:" || url.hostname !== "127.0.0.1" ||
    !url.port || url.pathname !== "/session" || url.username || url.password ||
    url.search || url.hash
  ) {
    throw new Error(
      "Use a local Firefox address: ws://127.0.0.1:9222/session.",
    );
  }
  return url.href;
}

/** Never launch, terminate, or read the profile of the user's browser. */
export async function connectProjectBrowser(
  address: string,
): Promise<ProjectPage> {
  const socket = new WebSocket(browserAddress(address));
  let sequence = 0;
  const pending = new Map<number, {
    resolve: (value: Record<string, unknown>) => void;
    reject: (reason: Error) => void;
  }>();
  const fail = () => {
    for (const entry of pending.values()) {
      entry.reject(
        new Error("Firefox disconnected. Review the project before retrying."),
      );
    }
    pending.clear();
  };
  socket.addEventListener("close", fail);
  socket.addEventListener("message", (event) => {
    const response = JSON.parse(String(event.data));
    const entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    if (response.type === "error") {
      entry.reject(
        new Error(
          `Firefox rejected an automation command (${
            typeof response.error === "string" &&
              /^[a-z ]+$/.test(response.error)
              ? response.error
              : "unknown error"
          }). Review the project before retrying.`,
        ),
      );
    } else entry.resolve(response.result);
  });
  let endSession: (() => Promise<unknown>) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Firefox connection timed out.")),
        5000,
      );
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(
          new Error(
            "Start Firefox with --remote-debugging-port=9222, then retry.",
          ),
        );
      }, { once: true });
    });
    const command = async (
      method: string,
      params: Record<string, unknown>,
    ): Promise<Record<string, unknown>> => {
      const id = ++sequence;
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(
            new Error(
              "Firefox command timed out. Review the project before retrying.",
            ),
          );
        }, 30000);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        socket.send(JSON.stringify({ id, method, params }));
      });
    };
    await command("session.new", {
      capabilities: { alwaysMatch: { acceptInsecureCerts: false } },
    });
    endSession = () => command("session.end", {});
    const { context } = await command("browsingContext.create", {
      type: "tab",
    });
    if (typeof context !== "string") {
      throw new Error("Firefox did not create an automation tab.");
    }
    return {
      async navigate(url) {
        await command("browsingContext.navigate", {
          context,
          url,
          wait: "complete",
        });
      },
      async evaluate<T, A>(fn: (arg: A) => T | Promise<T>, arg: A): Promise<T> {
        // Only return JSON strings, avoiding BiDi object handles and credentials.
        const result = await command("script.callFunction", {
          functionDeclaration:
            `async function(value) { return JSON.stringify(await (${fn.toString()})(JSON.parse(value))); }`,
          target: { context },
          arguments: [{ type: "string", value: JSON.stringify(arg) }],
          awaitPromise: true,
          resultOwnership: "none",
        });
        const remote = result.result as
          | { type?: string; value?: string }
          | undefined;
        if (result.type !== "success" || remote?.type !== "string") {
          throw new Error(
            "The GitHub page rejected automation. Check the login and page layout.",
          );
        }
        return JSON.parse(remote.value!) as T;
      },
      async close() {
        try {
          await command("browsingContext.close", { context });
        } finally {
          try {
            await endSession!();
          } finally {
            socket.close();
          }
        }
      },
    };
  } catch (error) {
    try {
      await endSession?.();
    } catch { /* Preserve the setup error. */ }
    socket.close();
    throw error;
  }
}
