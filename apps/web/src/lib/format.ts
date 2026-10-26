const RELATIVE_UNITS: readonly { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: 'day', ms: 86_400_000 },
  { unit: 'hour', ms: 3_600_000 },
  { unit: 'minute', ms: 60_000 },
];

/**
 * "just now", "5 minutes ago", "2 days ago", then a plain date once it is a week old. Takes any
 * timestamp-like with `toMillis()`, so Firestore timestamps work directly.
 */
export function formatUpdated(
  timestamp: { toMillis(): number } | null | undefined,
  now: number = Date.now(),
  locale?: string,
): string {
  if (!timestamp) return '';
  const diff = now - timestamp.toMillis();
  if (diff < 60_000) return 'just now';
  if (diff >= 7 * 86_400_000) {
    return new Date(timestamp.toMillis()).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const { unit, ms } of RELATIVE_UNITS) {
    if (diff >= ms) return formatter.format(-Math.floor(diff / ms), unit);
  }
  return 'just now';
}

const SHORT_UNITS: readonly { suffix: string; ms: number }[] = [
  { suffix: 'y', ms: 365 * 86_400_000 },
  { suffix: 'w', ms: 7 * 86_400_000 },
  { suffix: 'd', ms: 86_400_000 },
  { suffix: 'h', ms: 3_600_000 },
  { suffix: 'm', ms: 60_000 },
];

/** monday-style compact age: "now", "5m", "17h", "1d", "3w", "2y". */
export function formatRelativeShort(
  timestamp: { toMillis(): number } | null | undefined,
  now: number = Date.now(),
): string {
  if (!timestamp) return '';
  const diff = now - timestamp.toMillis();
  for (const { suffix, ms } of SHORT_UNITS) {
    if (diff >= ms) return `${Math.floor(diff / ms)}${suffix}`;
  }
  return 'now';
}

/** "Jan 5, 2026" - used for board info. */
export function formatDate(
  timestamp: { toMillis(): number } | null | undefined,
  locale?: string,
): string {
  if (!timestamp) return '';
  return new Date(timestamp.toMillis()).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Up to two uppercase initials of a name, e.g. "Ada Lovelace" -> "AL". */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
