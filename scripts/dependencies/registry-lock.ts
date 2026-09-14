export function verifyRegistryLock(
  packages: Record<string, { resolved?: string; inBundle?: boolean }>,
): void {
  for (const [path, entry] of Object.entries(packages)) {
    if (!path || (!entry.resolved && entry.inBundle)) {
      continue;
    }
    const url = entry.resolved ? new URL(entry.resolved) : undefined;
    if (
      !url || url.protocol !== "https:" || url.username || url.password ||
      url.port || !["registry.npmjs.org", "npm.jsr.io"].includes(url.hostname)
    ) {
      throw new Error(`Dependency ${path} has no approved registry URL.`);
    }
  }
}
