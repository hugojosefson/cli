/** @module Copyright holder checks for license detection and creation. */

// SPDX, Choose a License, GNU, and license-templates use these field names.
const placeholder =
  /^(?:fullname|full name|your (?:full )?name(?: here)?|name of (?:the )?(?:copyright (?:owner|holder)|author)|copyright (?:holders?|owners?)(?:\(s\))?|author name|organization|organisation)$/i;
const field = /<([^<>]+)>|\[([^\[\]]+)\]|\{+([^{}]+)\}+/g;

export function validLicenseHolder(value: string): boolean {
  if (
    !value.trim() || /[\p{Cc}\u2028\u2029]/u.test(value.replaceAll("\t", ""))
  ) {
    return false;
  }
  const normalized = value.trim().replaceAll(/[\t ]+/g, " ");
  if (/^\.{1,2}$/.test(normalized) || placeholder.test(normalized)) {
    return false;
  }
  return !Array.from(normalized.matchAll(field)).some((match) => {
    const name = (match[1] ?? match[2] ?? match[3]!).trim();
    return placeholder.test(name) ||
      /^(?:name|author|owner|holder)$/i.test(name);
  });
}
