import { type DenoLock, npmIdentity } from "./manifest.ts";

export function verifyNativeLock(
  source: DenoLock,
  packages: Record<string, { version: string; integrity?: string }>,
  production: boolean,
): void {
  for (const [path, entry] of Object.entries(packages)) {
    if (!path) {
      continue;
    }
    const name = path.split("node_modules/").at(-1)!;
    if (name.startsWith("@jsr/")) {
      const jsr = "@" + name.slice(5).replace("__", "/");
      if (!source.jsr?.[`${jsr}@${entry.version}`]) {
        throw new Error(
          `JSR dependency ${name}@${entry.version} differs from deno.lock.`,
        );
      }
      continue;
    }
    const matchingName = Object.keys(source.npm).some((key) =>
      npmIdentity(key)[0] === name
    );
    if (!production && !matchingName) {
      continue;
    }
    const locked = Object.entries(source.npm).find(([key]) =>
      npmIdentity(key).join("@") === `${name}@${entry.version}`
    )?.[1];
    if (!locked || locked.integrity !== entry.integrity) {
      throw new Error(
        `npm dependency ${name}@${entry.version} differs from deno.lock.`,
      );
    }
  }
}
