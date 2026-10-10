// `{Color}` or `{Color|annotation}` suffix that follows `==text==`.
// Groups: 1 = color key, 2 = annotation (optional).
export const COLOR_SUFFIX_SOURCE = String.raw`\{([a-zA-Z0-9_\-\s]+)(?:\|([^}\n]*))?\}`;

// Groups: 1 = highlighted text, 2 = color key, 3 = annotation (optional).
export const coloredHighlightRegex = () =>
  new RegExp(String.raw`==((?:(?!==).)*?)==` + COLOR_SUFFIX_SOURCE, "g");

export const colorSuffixAtStartRegex = () =>
  new RegExp("^" + COLOR_SUFFIX_SOURCE);

export interface ColoredHighlightMatch {
  start: number;
  end: number;
  suffixStart: number;
  color: string;
  note: string;
}

export function findColoredHighlightAt(
  lineText: string,
  ch: number
): ColoredHighlightMatch | null {
  const regex = coloredHighlightRegex();
  let match;
  while ((match = regex.exec(lineText)) !== null) {
    const start = match.index;
    const end = regex.lastIndex;
    if (start <= ch && ch <= end) {
      return {
        start,
        end,
        suffixStart: start + 2 + match[1].length + 2,
        color: match[2],
        note: match[3] ?? "",
      };
    }
  }
  return null;
}

export function buildColorSuffix(color: string, note: string) {
  return note ? `{${color}|${note}}` : `{${color}}`;
}

// Annotations live inside `{...}` on a single line, so `}`, newlines and `==` would break parsing.
export function sanitizeNote(note: string) {
  return note
    .replace(/[\r\n]+/g, " ")
    .replace(/}/g, "")
    .replace(/={2,}/g, "=")
    .trim();
}
