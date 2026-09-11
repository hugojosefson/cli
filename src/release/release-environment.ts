/** Environment reads injected into release commands. */

export type ReleaseEnvironment = {
  get(name: string): string | undefined;
};

export const denoReleaseEnvironment: ReleaseEnvironment = {
  get: (name) => Deno.env.get(name),
};

export function requiredEnvironment(
  environment: ReleaseEnvironment,
  name: string,
): string {
  const value = environment.get(name);
  if (!value) throw new TypeError(`${name} is required.`);
  return value;
}
