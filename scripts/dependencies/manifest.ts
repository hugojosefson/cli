export type DenoLock = {
  specifiers: Record<string, string>;
  npm: Record<string, {
    integrity: string;
    dependencies?: string[];
    optionalDependencies?: string[];
  }>;
  jsr?: Record<string, unknown>;
};
export type Manifest = {
  dependencies: Record<string, string>;
  overrides?: Record<string, unknown>;
  [key: string]: unknown;
};

export function npmIdentity(key: string): [string, string] {
  const index = key.indexOf("@", 1);
  return [key.slice(0, index), key.slice(index + 1).split("_")[0]];
}

export function mappedDependencies(
  dependencies: Record<string, string>,
  imports: Record<string, string>,
  lock: DenoLock,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(dependencies).map(([name, version]) => {
      const specifier = Object.values(imports).find((value) => {
        const identity = value.match(/^(npm|jsr):(@[^/]+\/[^@/]+|[^@/]+)@/);
        if (!identity) {
          return false;
        }
        const mapped = identity[1] === "jsr"
          ? "@jsr/" + identity[2].slice(1).replace("/", "__")
          : identity[2];
        return mapped === name;
      }) ?? Object.keys(lock.specifiers).find((value) =>
        value.startsWith(`npm:${name}@`)
      );
      if (!specifier) {
        return [name, version];
      }
      const selected = lock.specifiers[specifier]?.split("_")[0];
      if (!selected) {
        throw new Error(`No locked version for ${specifier}.`);
      }
      return [name, selected];
    }),
  );
}

export function dependencyOverrides(
  dependencies: Record<string, string>,
  lock: DenoLock,
): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  const seen = new Set<string>();
  const visit = (key: string): void => {
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    const entry = lock.npm[key];
    if (!entry) {
      return;
    }
    const children: Record<string, string> = {};
    for (
      const dependency of [
        ...entry.dependencies ?? [],
        ...entry.optionalDependencies ?? [],
      ]
    ) {
      const child = lock.npm[dependency]
        ? dependency
        : Object.keys(lock.npm).find((candidate) =>
          npmIdentity(candidate)[0] === dependency
        );
      if (!child) {
        throw new Error(`No locked dependency for ${dependency}.`);
      }
      const [name, version] = npmIdentity(child);
      children[name] = version;
      visit(child);
    }
    if (Object.keys(children).length) {
      overrides[npmIdentity(key).join("@")] = children;
    }
  };
  for (const [name, version] of Object.entries(dependencies)) {
    const key = Object.keys(lock.npm).find((candidate) =>
      npmIdentity(candidate).join("@") === `${name}@${version}`
    );
    if (key) {
      visit(key);
    }
  }
  return Object.fromEntries(
    Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b)),
  );
}
