import { numericOf, type NumbersSettings, type NumbersValue } from '@atrium/shared';

/** `YYYY-MM-DD` as a local date (a plain `new Date('2026-10-23')` would be UTC and can shift a day). */
export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export function toIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "Oct 23", or "Oct 23, 2025" when the year is not the current one. */
export function formatDay(iso: string, now: Date = new Date(), locale?: string): string {
  const date = parseIsoDate(iso);
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** "Oct 3 - Nov 12" for the date summary pill. */
export function formatRange(
  earliest: string,
  latest: string,
  now: Date = new Date(),
  locale?: string,
): string {
  const from = formatDay(earliest, now, locale);
  return earliest === latest ? from : `${from} - ${formatDay(latest, now, locale)}`;
}

/** True when `iso` is before today (local time). */
export function isBeforeToday(iso: string, now: Date = new Date()): boolean {
  return iso < toIsoDate(now);
}

/** "$1,200" / "12 kg" style text for a number cell or sum. */
export function formatNumber(
  value: NumbersValue | number,
  settings: NumbersSettings,
  locale?: string,
): string {
  const n = typeof value === 'number' ? value : numericOf(value);
  const body = n.toLocaleString(locale, {
    minimumFractionDigits: settings.decimals ?? 0,
    maximumFractionDigits: settings.decimals ?? 10,
  });
  if (!settings.unit) return body;
  return settings.unit.direction === 'left'
    ? `${settings.unit.symbol}${body}`
    : `${body} ${settings.unit.symbol}`;
}

/** Parse what a person typed into a number cell; `null` for empty, `undefined` when invalid. */
export function parseNumberInput(raw: string): string | null | undefined {
  const text = raw.trim().replace(/[\s,]/g, '');
  if (text === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(text)) return undefined;
  // Normalise "007" and "-0" without losing decimals.
  return String(Number(text));
}
