/**
 * Shared timestamp parsing helper for columns.
 * Converts Date, ISO string, or Firestore-like Timestamp ({ toDate(): Date }) to a valid ISO datetime string.
 * Returns null if input is null, undefined, pending server timestamp, or invalid.
 */
export function timestampToIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const time = Date.parse(value);
    if (Number.isNaN(time)) return null;
    return new Date(time).toISOString();
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString();
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof (value as { toDate: () => unknown }).toDate === 'function'
  ) {
    try {
      const d = (value as { toDate: () => unknown }).toDate();
      if (d instanceof Date && !Number.isNaN(d.getTime())) {
        return d.toISOString();
      }
    } catch {
      return null;
    }
  }
  return null;
}
