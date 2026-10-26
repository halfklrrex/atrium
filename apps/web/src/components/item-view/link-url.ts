/** A typed link address as a normalised http(s) URL, or null when it is not one. */
export function parseLinkUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}
