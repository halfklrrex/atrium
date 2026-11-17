const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** "March 12" for a birthday (day and month only; the year is never stored). */
export function formatBirthday(birthday: { month: number; day: number }): string | null {
  const month = MONTHS[birthday.month - 1];
  return month ? `${month} ${birthday.day}` : null;
}

/** The city part of an IANA zone: "Europe/Paris" gives "Paris", "America/New_York" gives "New York". */
export function zoneCity(timeZone: string): string {
  const last = timeZone.split('/').pop() ?? timeZone;
  return last.replaceAll('_', ' ');
}

/**
 * "14:05 (Paris)" in the person's time zone, or null when the zone is missing or not a real one
 * (a bad value in a member doc must never break the card).
 */
export function formatLocalTime(timeZone: string | null | undefined, now: Date): string | null {
  if (!timeZone) return null;
  try {
    const time = new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
    }).format(now);
    return `${time} (${zoneCity(timeZone)})`;
  } catch {
    return null;
  }
}
