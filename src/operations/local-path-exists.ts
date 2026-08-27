export async function pathExists(url: URL): Promise<boolean> {
  try {
    await Deno.lstat(url);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}
