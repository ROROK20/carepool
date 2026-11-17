import { formatTime, isClockTime } from "./parse";

/**
 * The daily schedule. Its only input is what the family entered for each
 * medicine: the name, the dose exactly as typed, and the clock times they
 * gave. It does not take a label, a card or a model output, so nothing from
 * the FDA label can reach it, and it never computes, converts or suggests a
 * dose or a time. A medicine with no valid time goes to "no time entered"
 * instead of being placed somewhere.
 */

export interface MedEntry {
  id: string;
  name: string;
  /** Exactly as typed. May be empty. */
  dose: string;
  /** 24-hour HH:MM as entered. */
  times: string[];
  notes: string;
}

export interface ScheduleItem {
  med_id: string;
  name: string;
  /** The same string the family typed (never rewritten). */
  dose: string;
  notes: string;
}

export interface ScheduleSlot {
  time: string;
  label: string;
  items: ScheduleItem[];
}

export interface Schedule {
  slots: ScheduleSlot[];
  /** Medicines with no valid time entered. */
  unscheduled: ScheduleItem[];
  /** Entered times that are not valid clock times, kept so the UI can point at them. */
  invalid: { med_id: string; name: string; value: string }[];
}

export function buildSchedule(meds: readonly MedEntry[]): Schedule {
  const slots = new Map<string, ScheduleItem[]>();
  const unscheduled: ScheduleItem[] = [];
  const invalid: Schedule["invalid"] = [];
  for (const med of meds) {
    const item: ScheduleItem = { med_id: med.id, name: med.name, dose: med.dose, notes: med.notes };
    const valid = Array.from(new Set(med.times.filter((t) => isClockTime(t))));
    med.times.filter((t) => !isClockTime(t)).forEach((value) => invalid.push({ med_id: med.id, name: med.name, value }));
    if (valid.length === 0) {
      unscheduled.push(item);
      continue;
    }
    for (const t of valid) {
      const list = slots.get(t) ?? [];
      list.push(item);
      slots.set(t, list);
    }
  }
  return {
    slots: [...slots.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([time, items]) => ({ time, label: formatTime(time), items })),
    unscheduled,
    invalid,
  };
}

/** The items scheduled at exactly this time (used by a dose-check task for its slot). */
export function itemsAt(schedule: Schedule, time: string): ScheduleItem[] {
  return schedule.slots.find((s) => s.time === time)?.items ?? [];
}
