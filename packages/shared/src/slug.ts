const MAX_SLUG_LENGTH = 40;

/**
 * URL slug of a name: ASCII lower-case words joined by `-`, at most 40 characters. Accents are
 * folded (NFKD, combining marks dropped); anything else non-alphanumeric (emoji, non-Latin
 * letters, punctuation) becomes a separator. An empty result becomes `fallback`.
 */
export function slugify(name: string, fallback: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length <= MAX_SLUG_LENGTH) return slug || fallback;
  const cut = slug.slice(0, MAX_SLUG_LENGTH);
  // Prefer ending on a whole word when the cut fell inside one.
  const lastDash = cut.lastIndexOf('-');
  const wholeWords =
    slug.charAt(MAX_SLUG_LENGTH) === '-' || lastDash < 1 ? cut : cut.slice(0, lastDash);
  return wholeWords.replace(/-+$/g, '') || fallback;
}
