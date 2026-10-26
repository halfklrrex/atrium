export interface TextPart {
  text: string;
  match: boolean;
}

/** Split `text` into plain and matching parts for `term` (case-insensitive; `term` non-empty). */
export function splitMatches(text: string, term: string): TextPart[] {
  const needle = term.trim().toLowerCase();
  if (!needle || !text) return [{ text, match: false }];
  const haystack = text.toLowerCase();
  const parts: TextPart[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    if (at > from) parts.push({ text: text.slice(from, at), match: false });
    parts.push({ text: text.slice(at, at + needle.length), match: true });
    from = at + needle.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false });
  return parts.length > 0 ? parts : [{ text, match: false }];
}
