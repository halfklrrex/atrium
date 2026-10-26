/** Short random slug (`[a-z0-9]`), as used for column and group ids. */
export function newSlugId(length = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}
