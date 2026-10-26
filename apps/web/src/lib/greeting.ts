/** Part of the day, with monday's boundaries: morning 5-12, afternoon 12-17, evening 17-21, else night. */
export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';

export function dayPartAt(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

/** First word of the display name, falling back to the part of the email before the `@`. */
export function firstNameOf(
  displayName: string | null | undefined,
  email?: string | null,
): string | null {
  const fromName = displayName?.trim().split(/\s+/)[0];
  if (fromName) return fromName;
  const fromEmail = email?.split('@')[0]?.trim();
  return fromEmail || null;
}

/** "Good evening, Avery!" - or "Good evening!" when there is no name to use. */
export function greetingFor(date: Date, firstName: string | null): string {
  const part = dayPartAt(date.getHours());
  return firstName ? `Good ${part}, ${firstName}!` : `Good ${part}!`;
}
