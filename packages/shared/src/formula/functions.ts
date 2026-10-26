import { FORMULA_ERRORS } from './types';

export type FormulaFunction = (...args: unknown[]) => unknown;

export const MAX_STRING_LENGTH = 100_000;
export const MAX_WORKDAYS = 100_000;

export function toNum(val: unknown): number {
  if (typeof val === 'number') {
    if (!isFinite(val) || isNaN(val)) throw new Error(FORMULA_ERRORS.VALUE);
    return val;
  }
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'boolean') return val ? 1 : 0;
  const parsed = Number(val);
  if (isNaN(parsed) || !isFinite(parsed)) throw new Error(FORMULA_ERRORS.VALUE);
  return parsed;
}

export function toStr(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.label === 'string') return obj.label;
    if (typeof obj.name === 'string') return obj.name;
    return JSON.stringify(val);
  }
  return String(val);
}

export function toBool(val: unknown): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  if (typeof val === 'string') {
    const s = val.trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes') return true;
    if (s === 'false' || s === '0' || s === 'no' || s === '') return false;
  }
  return Boolean(val);
}

export function areEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) {
    return (a === null || a === undefined) && (b === null || b === undefined);
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return a.toLowerCase() === b.toLowerCase();
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return a === b;
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return a === b;
  }
  return false;
}

export function assertStringLength(s: string): string {
  if (s.length > MAX_STRING_LENGTH) {
    throw new Error(FORMULA_ERRORS.VALUE);
  }
  return s;
}

export function parseDate(val: unknown): Date {
  if (val instanceof Date) {
    if (isNaN(val.getTime())) throw new Error(FORMULA_ERRORS.VALUE);
    return val;
  }
  if (!val) throw new Error(FORMULA_ERRORS.VALUE);

  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if (typeof obj.date === 'string') {
      return parseDate(obj.time ? `${obj.date}T${obj.time}` : obj.date);
    }
  }

  const str = toStr(val).trim();
  if (!str) throw new Error(FORMULA_ERRORS.VALUE);

  // Match YYYY-MM-DD with optional time and optional timezone offset
  const ymdMatch =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|([+-]\d{2}):?(\d{2})?)?)?$/i.exec(
      str,
    );
  if (ymdMatch) {
    const [, yStr, mStr, dStr, hStr, minStr, sStr, tzHStr, tzMinStr] = ymdMatch;
    const y = Number(yStr);
    const m = Number(mStr);
    const d = Number(dStr);
    const h = hStr !== undefined ? Number(hStr) : 0;
    const min = minStr !== undefined ? Number(minStr) : 0;
    const s = sStr !== undefined ? Number(sStr) : 0;

    let offsetMinutes = 0;
    if (tzHStr !== undefined) {
      const sign = tzHStr.startsWith('-') ? -1 : 1;
      const tzHours = Math.abs(Number(tzHStr));
      const tzMins = tzMinStr !== undefined ? Number(tzMinStr) : 0;
      offsetMinutes = sign * (tzHours * 60 + tzMins);
    }

    const utcMs = Date.UTC(y, m - 1, d, h, min, s) - offsetMinutes * 60 * 1000;
    const date = new Date(utcMs);
    if (isNaN(date.getTime())) {
      throw new Error(FORMULA_ERRORS.VALUE);
    }
    const checkDate = new Date(Date.UTC(y, m - 1, d));
    if (
      checkDate.getUTCFullYear() !== y ||
      checkDate.getUTCMonth() !== m - 1 ||
      checkDate.getUTCDate() !== d
    ) {
      throw new Error(FORMULA_ERRORS.VALUE);
    }
    return date;
  }

  const ts = Date.parse(str);
  if (isNaN(ts)) throw new Error(FORMULA_ERRORS.VALUE);
  return new Date(ts);
}

export function formatUtcYmd(d: Date): string {
  if (isNaN(d.getTime())) throw new Error(FORMULA_ERRORS.VALUE);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatUtcDateTime(d: Date): string {
  if (isNaN(d.getTime())) throw new Error(FORMULA_ERRORS.VALUE);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const h = d.getUTCHours();
  const min = d.getUTCMinutes();
  const s = d.getUTCSeconds();
  if (h === 0 && min === 0 && s === 0) {
    return `${y}-${m}-${day}`;
  }
  const hStr = String(h).padStart(2, '0');
  const minStr = String(min).padStart(2, '0');
  const sStr = String(s).padStart(2, '0');
  return `${y}-${m}-${day} ${hStr}:${minStr}:${sStr}`;
}

export function workdaysBetween(startDate: Date, endDate: Date): number {
  const d1 = new Date(
    Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()),
  );
  const d2 = new Date(
    Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()),
  );

  if (d1.getTime() > d2.getTime()) {
    return -workdaysBetween(d2, d1);
  }

  const diffMs = d2.getTime() - d1.getTime();
  const totalDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
  if (totalDays > MAX_WORKDAYS) {
    throw new Error(FORMULA_ERRORS.NUM);
  }

  // Closed-form O(1) arithmetic
  const fullWeeks = Math.floor(totalDays / 7);
  let workdays = fullWeeks * 5;
  const remainingDays = totalDays % 7;
  let currentDay = d1.getUTCDay();

  for (let i = 0; i < remainingDays; i++) {
    currentDay = (currentDay + 1) % 7;
    if (currentDay !== 0 && currentDay !== 6) {
      workdays++;
    }
  }

  return workdays;
}

export function datetimeDiff(date1: unknown, date2: unknown, unit: unknown = 'days'): number {
  const dt1 = parseDate(date1);
  const dt2 = parseDate(date2);
  const diffMs = dt1.getTime() - dt2.getTime();
  const u = toStr(unit).toLowerCase();

  if (u === 'years' || u === 'y') {
    let years = dt1.getUTCFullYear() - dt2.getUTCFullYear();
    const m1 = dt1.getUTCMonth();
    const m2 = dt2.getUTCMonth();
    if (m1 < m2 || (m1 === m2 && dt1.getUTCDate() < dt2.getUTCDate())) {
      years--;
    }
    return years;
  }
  if (u === 'months' || u === 'm') {
    let months =
      (dt1.getUTCFullYear() - dt2.getUTCFullYear()) * 12 + (dt1.getUTCMonth() - dt2.getUTCMonth());
    if (dt1.getUTCDate() < dt2.getUTCDate()) {
      months--;
    }
    return months;
  }
  if (u === 'weeks' || u === 'w') return Math.floor(diffMs / (1000 * 60 * 60 * 24 * 7));
  if (u === 'hours' || u === 'h') return Math.floor(diffMs / (1000 * 60 * 60));
  if (u === 'minutes') return Math.floor(diffMs / (1000 * 60));
  if (u === 'seconds') return Math.floor(diffMs / 1000);
  return Math.floor(diffMs / (1000 * 60 * 60 * 24)); // default days
}

export function dateAdd(date: unknown, amount: unknown, unit: unknown = 'days'): string {
  const d = parseDate(date);
  const n = toNum(amount);
  const u = toStr(unit).toLowerCase();
  const isSubDay = u === 'hours' || u === 'h' || u === 'minutes' || u === 'seconds';

  if (u === 'years' || u === 'y') d.setUTCFullYear(d.getUTCFullYear() + n);
  else if (u === 'months' || u === 'm') d.setUTCMonth(d.getUTCMonth() + n);
  else if (u === 'weeks' || u === 'w') d.setUTCDate(d.getUTCDate() + n * 7);
  else if (u === 'hours' || u === 'h') d.setUTCHours(d.getUTCHours() + n);
  else if (u === 'minutes') d.setUTCMinutes(d.getUTCMinutes() + n);
  else if (u === 'seconds') d.setUTCSeconds(d.getUTCSeconds() + n);
  else d.setUTCDate(d.getUTCDate() + n);

  return isSubDay || d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0
    ? formatUtcDateTime(d)
    : formatUtcYmd(d);
}

export const FUNCTIONS: Record<string, FormulaFunction> = {
  // --- Logical ---
  IF: (cond, thenVal, elseVal) => (toBool(cond) ? thenVal : elseVal),

  SWITCH: (expr, ...casesAndDefault) => {
    const target = expr;
    let defaultVal: unknown = null;
    const count = casesAndDefault.length;

    for (let i = 0; i < count; i += 2) {
      if (i + 1 < count) {
        if (areEqual(casesAndDefault[i], target)) {
          return casesAndDefault[i + 1];
        }
      } else {
        defaultVal = casesAndDefault[i];
      }
    }
    return defaultVal;
  },

  AND: (...args) => args.every(toBool),
  OR: (...args) => args.some(toBool),
  NOT: (val) => !toBool(val),
  XOR: (a, b) => Boolean(toBool(a) !== toBool(b)),
  BLANK: () => null,
  ISERROR: (val) =>
    typeof val === 'string' &&
    Object.values(FORMULA_ERRORS).includes(
      val as (typeof FORMULA_ERRORS)[keyof typeof FORMULA_ERRORS],
    ),

  // --- Math / Numeric ---
  ADD: (a, b) => toNum(a) + toNum(b),
  MINUS: (a, b) => toNum(a) - toNum(b),
  MULTIPLY: (a, b) => toNum(a) * toNum(b),
  DIVIDE: (a, b) => {
    const d = toNum(b);
    if (d === 0) throw new Error(FORMULA_ERRORS.DIV_ZERO);
    return toNum(a) / d;
  },

  SUM: (...args) =>
    args.flat(Infinity).reduce<number>((acc, v) => acc + (v === null ? 0 : toNum(v)), 0),

  AVERAGE: (...args) => {
    const flat = args.flat(Infinity).filter((v) => v !== null && v !== undefined && v !== '');
    if (flat.length === 0) return 0;
    const sum = flat.reduce<number>((acc, v) => acc + toNum(v), 0);
    return sum / flat.length;
  },

  ROUND: (num, precision = 0) => {
    const n = toNum(num);
    const p = toNum(precision);
    const factor = Math.pow(10, p);
    return Math.round(n * factor) / factor;
  },

  ROUNDUP: (num, precision = 0) => {
    const n = toNum(num);
    const p = toNum(precision);
    const factor = Math.pow(10, p);
    return Math.ceil(n * factor) / factor;
  },

  ROUNDDOWN: (num, precision = 0) => {
    const n = toNum(num);
    const p = toNum(precision);
    const factor = Math.pow(10, p);
    return Math.floor(n * factor) / factor;
  },

  INT: (num) => Math.floor(toNum(num)),
  ABS: (num) => Math.abs(toNum(num)),
  SQRT: (num) => {
    const n = toNum(num);
    if (n < 0) throw new Error(FORMULA_ERRORS.VALUE);
    return Math.sqrt(n);
  },
  POWER: (base, exp) => {
    const res = Math.pow(toNum(base), toNum(exp));
    if (!isFinite(res) || isNaN(res)) throw new Error(FORMULA_ERRORS.NUM);
    return res;
  },
  MOD: (dividend, divisor) => {
    const d = toNum(divisor);
    if (d === 0) throw new Error(FORMULA_ERRORS.DIV_ZERO);
    return toNum(dividend) % d;
  },
  MAX: (...args) => Math.max(...args.flat(Infinity).map(toNum)),
  MIN: (...args) => Math.min(...args.flat(Infinity).map(toNum)),
  CEILING: (num) => Math.ceil(toNum(num)),
  FLOOR: (num) => Math.floor(toNum(num)),

  // --- Text ---
  CONCATENATE: (...args) => assertStringLength(args.flat(Infinity).map(toStr).join('')),
  LEFT: (str, n = 1) => toStr(str).slice(0, Math.max(0, toNum(n))),
  RIGHT: (str, n = 1) => {
    const s = toStr(str);
    const count = Math.max(0, toNum(n));
    return s.slice(Math.max(0, s.length - count));
  },
  MID: (str, start, len) => {
    const s = toStr(str);
    const st = Math.max(1, toNum(start)) - 1;
    return s.slice(st, st + Math.max(0, toNum(len)));
  },
  LEN: (str) => toStr(str).length,
  TRIM: (str) => toStr(str).trim(),
  LOWER: (str) => toStr(str).toLowerCase(),
  UPPER: (str) => toStr(str).toUpperCase(),
  REPT: (str, count) => {
    const n = Math.max(0, Math.floor(toNum(count)));
    const s = toStr(str);
    if (s.length * n > MAX_STRING_LENGTH) throw new Error(FORMULA_ERRORS.VALUE);
    return s.repeat(n);
  },
  SUBSTITUTE: (str, oldText, newText) => {
    const s = toStr(str);
    const target = toStr(oldText);
    if (target === '') return s;
    return assertStringLength(s.split(target).join(toStr(newText)));
  },
  REPLACE: (str, start, len, newText) => {
    const s = toStr(str);
    const st = Math.max(1, toNum(start)) - 1;
    const l = Math.max(0, toNum(len));
    return assertStringLength(s.slice(0, st) + toStr(newText) + s.slice(st + l));
  },
  SEARCH: (find, within) => {
    const idx = toStr(within).toLowerCase().indexOf(toStr(find).toLowerCase());
    return idx === -1 ? 0 : idx + 1;
  },
  T: (val) => (typeof val === 'string' ? val : ''),
  TEXT: (val) => toStr(val),

  // --- Date / Time ---
  TODAY: () => {
    const now = new Date();
    return formatUtcYmd(now);
  },
  NOW: () => new Date().toISOString(),
  YEAR: (date) => parseDate(date).getUTCFullYear(),
  MONTH: (date) => parseDate(date).getUTCMonth() + 1,
  DAY: (date) => parseDate(date).getUTCDate(),
  HOUR: (date) => parseDate(date).getUTCHours(),
  MINUTE: (date) => parseDate(date).getUTCMinutes(),
  SECOND: (date) => parseDate(date).getUTCSeconds(),
  DAYS: (date1, date2) => {
    const d1 = parseDate(date1).getTime();
    const d2 = parseDate(date2).getTime();
    return Math.round((d1 - d2) / (1000 * 60 * 60 * 24));
  },
  HOURS_DIFF: (date1, date2) => {
    const d1 = parseDate(date1).getTime();
    const d2 = parseDate(date2).getTime();
    return Math.floor((d1 - d2) / (1000 * 60 * 60));
  },
  WORKDAYS: (date1, date2) => workdaysBetween(parseDate(date1), parseDate(date2)),
  WORKDAY: (startDate, days) => {
    const date = parseDate(startDate);
    const n = toNum(days);
    if (!isFinite(n) || isNaN(n) || Math.abs(n) > MAX_WORKDAYS) {
      throw new Error(FORMULA_ERRORS.VALUE);
    }
    let count = Math.floor(Math.abs(n));
    const step = n >= 0 ? 1 : -1;

    while (count > 0) {
      date.setUTCDate(date.getUTCDate() + step);
      const day = date.getUTCDay();
      if (day !== 0 && day !== 6) {
        count--;
      }
    }
    return formatUtcYmd(date);
  },
  DATETIME_DIFF: datetimeDiff,
  DATE_ADD: dateAdd,
  ADD_DAYS: (date, days) => dateAdd(date, days, 'days'),
  SUBTRACT_DAYS: (date, days) => dateAdd(date, -toNum(days), 'days'),
  FORMAT_DATE: (date, formatStr) => {
    const d = parseDate(date);
    if (!formatStr) return formatUtcYmd(d);
    const fmt = toStr(formatStr);
    const y = String(d.getUTCFullYear());
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return fmt.replace(/YYYY/g, y).replace(/MM/g, m).replace(/DD/g, day);
  },
};
