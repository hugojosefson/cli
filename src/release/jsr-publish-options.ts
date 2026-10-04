/** @module JSR publication settings from the package configuration. */
export function jsrPublishOptions(config: Record<string, unknown>): string[] {
  const hj = configurationObject(config.hj, "hj");
  const jsr = configurationObject(hj?.jsr, "hj.jsr");
  const allowSlowTypes = jsr?.allowSlowTypes;
  if (allowSlowTypes !== undefined && typeof allowSlowTypes !== "boolean") {
    throw new TypeError("hj.jsr.allowSlowTypes must be a boolean.");
  }
  return allowSlowTypes === true ? ["--allow-slow-types"] : [];
}

function configurationObject(
  value: unknown,
  path: string,
): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}
