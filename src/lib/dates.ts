/** Calendar date helpers. Date-only values represent the user's local calendar, never UTC midnight. */
export function localDate(date = new Date()): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function daysInMonth(year: number, monthIndex: number): number {
  const date = new Date(0);
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCFullYear(year, monthIndex + 1, 0);
  return date.getUTCDate();
}

export function isDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month - 1)
  );
}

function utcCalendar(value: string): Date {
  if (!isDateString(value)) throw new RangeError("日付が正しくありません。");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

function formatCalendar(date: Date): string {
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

/** Whole calendar days, unaffected by local daylight-saving transitions. */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (utcCalendar(to).getTime() - utcCalendar(from).getTime()) / 86_400_000,
  );
}

export function addDays(value: string, days: number): string {
  if (!Number.isInteger(days))
    throw new RangeError("日数は整数で指定してください。");
  const date = utcCalendar(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatCalendar(date);
}

/** Move by calendar months, clamping the day to the destination month's final day. */
export function addMonths(value: string, months: number): string {
  if (!Number.isInteger(months))
    throw new RangeError("月数は整数で指定してください。");
  const date = utcCalendar(value);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  date.setUTCDate(
    Math.min(day, daysInMonth(date.getUTCFullYear(), date.getUTCMonth())),
  );
  return formatCalendar(date);
}

export function monthKey(date: string): string {
  if (!isDateString(date)) throw new RangeError("日付が正しくありません。");
  return date.slice(0, 7);
}
