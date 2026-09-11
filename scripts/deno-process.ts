/** Run local tools with a predictable subprocess environment. */
export async function runDeno(args: readonly string[]): Promise<number> {
  const env = Deno.env.toObject();
  // Restricted Deno subprocesses reject dynamic-loader overrides.
  for (
    const name of [
      "LD_LIBRARY_PATH",
      "LD_PRELOAD",
      "DYLD_LIBRARY_PATH",
      "DYLD_INSERT_LIBRARIES",
    ]
  ) {
    delete env[name];
  }
  const status = await new Deno.Command(Deno.execPath(), {
    args: [...args],
    clearEnv: true,
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  return status.code;
}
