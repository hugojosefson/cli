/** @module Stable SHA-256 content digests. */

/** Returns the lowercase hexadecimal SHA-256 digest of bytes. */
export async function digestBytes(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(bytes).buffer,
  );
  return Array.from(
    new Uint8Array(hash),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
