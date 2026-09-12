/** Environment reads injected into release commands. */
import process from "node:process";

export type ReleaseEnvironment = {
  get(name: string): string | undefined;
};

export const denoReleaseEnvironment: ReleaseEnvironment = {
  get: (name) => process.env[name],
};

export function requiredEnvironment(
  environment: ReleaseEnvironment,
  name: string,
): string {
  const value = environment.get(name);
  if (!value) throw new TypeError(`${name} is required.`);
  return value;
}
