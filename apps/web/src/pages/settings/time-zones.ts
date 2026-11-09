/** The IANA zones the browser knows, plus the stored one when it is not among them. */
export function timeZoneChoices(current: string | undefined): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    // Very old engines: only the stored value and the device zone are offered.
  }
  const set = new Set(zones);
  if (current) set.add(current);
  return [...set].sort((a, b) => a.localeCompare(b));
}
