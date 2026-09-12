/** @module Conservative EditorConfig defaults and per-entry ownership. */
export const editorconfigPath = ".editorconfig";
export const editorconfigOwnershipPath = ".hj/editorconfig.json";
const heading = "# EditorConfig: http://EditorConfig.org";
const defaults: Readonly<Record<string, string>> = {
  root: "true",
  end_of_line: "lf",
  charset: "utf-8",
  trim_trailing_whitespace: "true",
  insert_final_newline: "true",
  indent_style: "space",
  indent_size: "2",
};
export const editorconfigStarter = `${heading}\n\nroot = true\n\n[*]\n${
  Object.entries(defaults).slice(1).map(([key, value]) => `${key} = ${value}`)
    .join("\n")
}\n`;

export interface EditorconfigOwnership {
  readonly version: 1;
  readonly keys: readonly string[];
  readonly heading: boolean;
  readonly section: boolean;
}

interface Line {
  text: string;
  section: string;
  key?: string;
}

function parse(content: string): Line[] {
  let section = "";
  return (content.match(/[^\n]*\n|[^\n]+$/g) ?? []).map((text, index) => {
    const value = text.trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      section = value.slice(1, -1);
    } else if (value && !/^[#;]/.test(value) && !value.includes("=")) {
      throw new Error(
        `.editorconfig:${
          index + 1
        }: expected a section heading, comment, or key=value entry. Found a line without a section marker or equals sign.`,
      );
    }
    const key = value && !/^[#;[]/.test(value) && value.includes("=")
      ? value.slice(0, value.indexOf("=")).trim().toLowerCase()
      : undefined;
    return { text, section, key };
  });
}

export function readEditorconfigOwnership(
  text: string | undefined,
): EditorconfigOwnership | undefined {
  if (text === undefined) return undefined;
  const value = parseOwnership(text);
  if (
    !value || value.version !== 1 || !Array.isArray(value.keys) ||
    value.keys.some((key: unknown) =>
      typeof key !== "string" || !Object.hasOwn(defaults, key)
    ) ||
    new Set(value.keys).size !== value.keys.length ||
    typeof value.heading !== "boolean" || typeof value.section !== "boolean" ||
    Object.keys(value).some((key) =>
      !["version", "keys", "heading", "section"].includes(key)
    )
  ) {
    throw new Error(
      ".hj/editorconfig.json: expected version=1, unique supported keys, and boolean heading and section fields. Found " +
        ownershipDifferences(value).join("; ") + ".",
    );
  }
  return value;
}

function entries(lines: readonly Line[], key: string) {
  return lines.filter((line) =>
    line.key === key && line.section === (key === "root" ? "" : "*")
  );
}

function unchanged(lines: readonly Line[], key: string): boolean {
  const found = entries(lines, key);
  return found.length === 1 &&
    found[0]!.text.replace(/\r?\n$/, "") === `${key} = ${defaults[key]}`;
}

export function editorconfigComplete(
  content: string,
  ownership?: EditorconfigOwnership,
): boolean {
  const lines = parse(content);
  return Object.keys(defaults).every((key) => entries(lines, key).length > 0) &&
    (ownership?.keys.every((key) => unchanged(lines, key)) ?? true);
}

/** Add defaults before custom sections; remove only unchanged recorded entries. */
export function updateEditorconfig(
  content: string,
  ownership: EditorconfigOwnership | undefined,
  enabled: boolean,
): { content: string; ownership?: EditorconfigOwnership } {
  const lines = parse(content);
  if (!enabled) {
    if (!ownership) return { content };
    const keys = ownership.keys.filter((key) => unchanged(lines, key));
    let kept = lines.filter((line) =>
      !keys.some((key) => entries(lines, key).includes(line))
    );
    if (
      ownership.heading &&
      kept.filter((line) => line.text.replace(/\r?\n$/, "") === heading)
          .length === 1
    ) {
      kept = kept.filter((line) => line.text.replace(/\r?\n$/, "") !== heading);
    }
    if (
      ownership.section &&
      kept.filter((line) => line.text.replace(/\r?\n$/, "") === "[*]")
          .length === 1
    ) {
      const index = kept.findIndex((line) =>
        line.text.replace(/\r?\n$/, "") === "[*]"
      );
      let end = index + 1;
      while (end < kept.length && !kept[end]!.text.trim().startsWith("[")) {
        end++;
      }
      if (kept.slice(index + 1, end).every((line) => !line.text.trim())) {
        kept.splice(index, end - index);
      }
    }
    const result = kept.map((line) => line.text).join("");
    return { content: result.trim() ? result : "" };
  }
  if (!content) {
    return {
      content: editorconfigStarter,
      ownership: {
        version: 1,
        keys: Object.keys(defaults),
        heading: true,
        section: true,
      },
    };
  }
  const missing = Object.keys(defaults).filter((key) =>
    entries(lines, key).length === 0
  );
  const keys = [
    ...ownership?.keys.filter((key) => unchanged(lines, key)) ?? [],
    ...missing,
  ];
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const root = missing.includes("root")
    ? `root = true${newline}${newline}`
    : "";
  const settings = missing.filter((key) => key !== "root");
  const block = settings.length
    ? `[*]${newline}${
      settings.map((key) => `${key} = ${defaults[key]}${newline}`).join("")
    }${newline}`
    : "";
  let index = lines.findIndex((line) => line.text.trim().startsWith("["));
  if (index < 0) index = lines.length;
  const before = lines.slice(0, index).map((line) => line.text).join("");
  const after = lines.slice(index).map((line) => line.text).join("");
  const separator = (root || block) && before && !before.endsWith("\n")
    ? newline
    : "";
  return {
    content: `${before}${separator}${root}${block}${after}`,
    ownership: keys.length || ownership
      ? {
        version: 1,
        keys,
        heading: ownership?.heading ?? false,
        section: ownership?.section || !!block,
      }
      : undefined,
  };
}

function parseOwnership(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      ".hj/editorconfig.json: expected a JSON object. Found invalid JSON syntax.",
    );
  }
}

function ownershipDifferences(value: Record<string, unknown> | null): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return ["a non-object value"];
  }
  return [
    ...(value.version !== 1
      ? [
        `version=${
          typeof value.version === "number"
            ? value.version
            : typeof value.version
        }`,
      ]
      : []),
    ...(!Array.isArray(value.keys)
      ? ["keys is not an array"]
      : value.keys.some((key) =>
          typeof key !== "string" || !Object.hasOwn(defaults, key)
        )
      ? ["keys contains unsupported entries"]
      : new Set(value.keys).size !== value.keys.length
      ? ["keys contains duplicate entries"]
      : []),
    ...(typeof value.heading !== "boolean" ? ["heading is not a boolean"] : []),
    ...(typeof value.section !== "boolean" ? ["section is not a boolean"] : []),
    ...(Object.keys(value).some((key) =>
        !["version", "keys", "heading", "section"].includes(key)
      )
      ? ["unexpected fields"]
      : []),
  ];
}
