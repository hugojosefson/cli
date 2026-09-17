import { highestLockedVersion } from "./highest-locked-version.ts";
import { type DenoLock, npmIdentity } from "./manifest.ts";

export function mappedDependencies(
  dependencies: Record<string, string>,
  imports: Record<string, string>,
  lock: DenoLock,
): Record<string, string> {
  return Object.fromEntries(
    Object.keys(dependencies).flatMap((name) => {
      const imported = Object.values(imports).filter((value) => {
        const identity = value.match(/^(npm|jsr):(@[^/]+\/[^@/]+|[^@/]+)@/);
        if (!identity) {
          return false;
        }
        const mapped = identity[1] === "jsr"
          ? "@jsr/" + identity[2].slice(1).replace("/", "__")
          : identity[2];
        return mapped === name;
      });
      const specifiers = imported.length
        ? imported
        : Object.keys(lock.specifiers).filter((value) =>
          value.startsWith(`npm:${name}@`)
        );
      const versions = specifiers.length
        ? specifiers.map((specifier) => {
          const selected = lock.specifiers[specifier]?.split("_")[0];
          if (!selected) {
            throw new Error(`No locked version for ${specifier}.`);
          }
          return selected;
        })
        : Object.keys(lock.npm).map(npmIdentity).filter(([candidate]) =>
          candidate === name
        ).map(([, version]) => version);
      return versions.length ? [[name, highestLockedVersion(versions)]] : [];
    }),
  );
}
