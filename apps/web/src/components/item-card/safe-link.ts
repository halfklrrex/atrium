const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/** The address when it is a web or mail link, else null (javascript:, data:, relative, ...). */
export function safeLinkHref(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  try {
    const url = new URL(href.trim());
    return SAFE_LINK_PROTOCOLS.has(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}
