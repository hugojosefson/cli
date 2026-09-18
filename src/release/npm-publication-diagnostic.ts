import type { ReleaseProcessResult } from "./release-process.ts";

const npmErrorCodes = new Set([
  "E400",
  "E401",
  "E403",
  "E404",
  "E409",
  "E422",
  "E429",
  "E500",
  "E502",
  "E503",
  "E504",
  "ENEEDAUTH",
  "EOTP",
  "EUSAGE",
  "EPUBLISHCONFLICT",
  "EINTEGRITY",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
]);

export function npmPublicationDiagnostic(
  result: ReleaseProcessResult | undefined,
): string {
  if (!result) {
    return "npm publish process result is unavailable.";
  }
  const exit = Number.isSafeInteger(result.code) && result.code >= 0 &&
      result.code <= 255
    ? `npm publish exit code: ${result.code}.`
    : "npm publish exit code is unavailable.";
  if (result.success) {
    return exit;
  }
  try {
    const data = JSON.parse(new TextDecoder().decode(result.stdout));
    const code: unknown = data?.error?.code;
    if (typeof code === "string" && npmErrorCodes.has(code)) {
      return `${exit} npm error code: ${code}.`;
    }
  } catch {
    // npm output can contain credentials. Diagnostics contain only known error codes.
  }
  return exit;
}
