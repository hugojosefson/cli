/** Non-secret user defaults stored outside the current repository. */
import { fromFileUrl, isAbsolute, join, toFileUrl } from "@std/path";
import type { FeatureRegistry } from "../features/feature-registry.ts";
import { validateDenoVersion } from "../features/workflow-deno.ts";

export interface GlobalConfig {
  readonly features?: readonly string[];
  readonly "deno-version"?: string;
  readonly "github-visibility"?: "public" | "private";
}

export function globalConfigFile(
  env: Pick<typeof Deno.env, "get"> = Deno.env,
): URL {
  const xdg = env.get("XDG_CONFIG_HOME");
  if (xdg && isAbsolute(xdg)) return toFileUrl(join(xdg, "hj/config.json"));
  const home = env.get("HOME");
  if (!home || !isAbsolute(home)) {
    throw new Error(
      "Set an absolute XDG_CONFIG_HOME or HOME to use hj config.",
    );
  }
  return toFileUrl(join(home, ".config/hj/config.json"));
}

export function configKey(key: string): keyof GlobalConfig {
  if (
    key === "features" || key === "deno-version" || key === "github-visibility"
  ) return key;
  throw new Error(
    "Unknown configuration key. Use features, deno-version, or github-visibility. Secrets are not supported.",
  );
}

function validateConfig(
  value: unknown,
  registry: FeatureRegistry,
): GlobalConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("hj config must contain a JSON object.");
  }
  for (const [key, item] of Object.entries(value)) {
    configKey(key);
    if (key === "deno-version") validateDenoVersion(item);
    else if (key === "github-visibility") {
      if (item !== "public" && item !== "private") {
        throw new Error("github-visibility must be public or private.");
      }
    } else {
      if (!Array.isArray(item) || !item.every((id) => typeof id === "string")) {
        throw new Error(
          "features must be a JSON array of feature or capability IDs.",
        );
      }
      const ids = new Set([
        ...registry.features.map((feature) => feature.metadata.id),
        ...registry.capabilities.map((capability) => capability.id),
      ]);
      if (item.some((id) => !ids.has(id))) {
        throw new Error(
          "features contains an unknown feature or capability ID.",
        );
      }
      if (new Set(item).size !== item.length) {
        throw new Error("features must not contain duplicate IDs.");
      }
    }
  }
  return value as GlobalConfig;
}

export async function readGlobalConfig(
  file: URL,
  registry: FeatureRegistry,
): Promise<GlobalConfig> {
  let text: string;
  try {
    text = await Deno.readTextFile(file);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return {};
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(
      "hj config contains invalid JSON. Repair the configuration file.",
    );
  }
  return validateConfig(value, registry);
}

export async function runConfig(
  args: readonly string[],
  file: URL,
  registry: FeatureRegistry,
): Promise<string> {
  const [action, key, raw] = args;
  const counts: Record<string, number> = { get: 2, set: 3, list: 1, unset: 2 };
  if (args.length !== counts[action]) {
    throw new Error(
      "Use hj config get <key>, set <key> <value>, list, or unset <key>.",
    );
  }
  if (key !== undefined) configKey(key);
  const current = await readGlobalConfig(file, registry);
  if (action === "list") return JSON.stringify(current, null, 2);
  if (action === "get") {
    const value = current[configKey(key)];
    if (value === undefined) {
      throw new Error(`Configuration key is not set: ${key}`);
    }
    return typeof value === "string" ? value : JSON.stringify(value);
  }
  const next = { ...current };
  if (action === "unset") delete next[configKey(key)];
  else {
    let value: unknown = raw;
    if (key === "features") {
      try {
        value = JSON.parse(raw);
      } catch {
        throw new Error(
          "features must be a JSON array of feature or capability IDs.",
        );
      }
    }
    Object.assign(next, { [key]: value });
    validateConfig(next, registry);
  }
  if (JSON.stringify(next) === JSON.stringify(current)) {
    return "Configuration unchanged.";
  }
  const directory = new URL(".", file);
  await Deno.mkdir(directory, { recursive: true });
  const temp = await Deno.makeTempFile({
    dir: fromFileUrl(directory),
    prefix: ".hj-config-",
  });
  try {
    await Deno.writeTextFile(temp, JSON.stringify(next, null, 2) + "\n");
    await Deno.rename(temp, file);
  } catch (error) {
    await Deno.remove(temp).catch(() => undefined);
    throw error;
  }
  return action === "unset" ? `Unset ${key}.` : `Set ${key}.`;
}
