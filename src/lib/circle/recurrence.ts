import { z } from "zod";

/**
 * When a care task happens. Dates are calendar days ("YYYY-MM-DD") compared
 * in UTC so daylight-saving changes never shift a day.
 */

export const RecurrenceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("daily") }),
  z.object({ type: z.literal("weekly"), days: z.array(z.number().int().min(0).max(6)).min(1) }),
  z.object({ type: z.literal("every_n_days"), n: z.number().int().min(1).max(366), start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ type: z.literal("once"), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
]);
export type Recurrence = z.infer<typeof RecurrenceSchema>;

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function isIsoDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const t = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === date;
}

function utcDay(date: string): number {
  if (!isIsoDate(date)) throw new Error(`Not a calendar date: ${date}`);
  return Date.parse(`${date}T00:00:00Z`);
}

export function weekday(date: string): number {
  return new Date(utcDay(date)).getUTCDay();
}

export function occursOn(r: Recurrence, date: string): boolean {
  const day = utcDay(date);
  switch (r.type) {
    case "daily":
      return true;
    case "weekly":
      return r.days.includes(new Date(day).getUTCDay());
    case "every_n_days": {
      const diff = Math.round((day - utcDay(r.start)) / DAY_MS);
      return diff >= 0 && diff % r.n === 0;
    }
    case "once":
      return r.date === date;
  }
}

/** "Wed, Nov 18" for a calendar date. */
export function shortDate(date: string): string {
  return new Date(utcDay(date)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** "November 18, 2026" for a date or timestamp that starts with YYYY-MM-DD. */
export function longDate(iso: string | null): string {
  if (!iso) return "unknown date";
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function describeRecurrence(r: Recurrence): string {
  switch (r.type) {
    case "daily":
      return "Every day";
    case "weekly": {
      const names = [...r.days].sort().map((d) => `${WEEKDAYS[d]}s`);
      return names.length === 7 ? "Every day" : `Every week on ${names.join(", ")}`;
    }
    case "every_n_days":
      return r.n === 1 ? "Every day" : `Every ${r.n} days from ${shortDate(r.start)}`;
    case "once":
      return `Once, on ${shortDate(r.date)}`;
  }
}

/** Today's calendar date on this machine, as YYYY-MM-DD. */
export function localToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
