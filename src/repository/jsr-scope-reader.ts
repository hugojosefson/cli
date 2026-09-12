/** @module Authenticated JSR memberships, isolated from plans and generated files. */
import metadata from "../../deno.json" with { type: "json" };
import { validScope } from "../package/metadata.ts";

export type JsrScopes =
  | { readonly kind: "available"; readonly scopes: readonly string[] }
  | { readonly kind: "missing-authentication" }
  | { readonly kind: "unavailable"; readonly observation: string };

export interface JsrScopeReader {
  scopes(): Promise<JsrScopes>;
}

/** Reads user memberships, including ordinary members, never pending invites. */
export class AuthenticatedJsrScopeReader implements JsrScopeReader {
  constructor(
    private readonly token: () => string | undefined = () =>
      Deno.env.get("JSR_TOKEN"),
    private readonly request: typeof fetch = fetch,
  ) {}

  async scopes(): Promise<JsrScopes> {
    try {
      const token = this.token()?.trim();
      if (!token) return { kind: "missing-authentication" };
      const response = await this.request("https://api.jsr.io/user/scopes", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "User-Agent":
            `hj/${metadata.version}; https://github.com/hugojosefson/cli`,
        },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return unavailable(
          `JSR membership request failed (HTTP ${response.status}).`,
        );
      }
      const value: unknown = await response.json();
      if (
        !Array.isArray(value) ||
        !value.every((item) =>
          item !== null && typeof item === "object" &&
          typeof item.scope === "string" && validScope(item.scope)
        )
      ) return unavailable("JSR returned an unreadable membership response.");
      return {
        kind: "available",
        scopes: [...new Set(value.map((item) => item.scope as string))].sort(),
      };
    } catch {
      // Transport, environment, and JSON errors may include the token or body.
      return unavailable(
        "JSR membership discovery could not be read. Check JSR_TOKEN and network access.",
      );
    }
  }
}

function unavailable(observation: string): JsrScopes {
  return { kind: "unavailable", observation };
}
