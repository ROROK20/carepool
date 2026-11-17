import { itemsAt, type Schedule, type ScheduleItem } from "../schedule/build";
import { occursOn, type Recurrence } from "./recurrence";

/**
 * One person's "today": the tasks assigned to them that fall on the date,
 * the ones they agreed to cover for someone else, and the ones others asked
 * for help with ("up for grabs"). A task occurrence moves through:
 *
 *   open → done                      (the assignee does it)
 *   open → needs_cover → covered → done   (assignee can't; someone else takes it)
 *
 * Pure: the caller loads tasks, events and the schedule.
 */

export type TaskKind = "dose_check" | "refill" | "organizer" | "custom";
export type OccurrenceStatus = "open" | "done" | "needs_cover" | "covered";

export interface TaskRow {
  id: string;
  title: string;
  kind: TaskKind;
  /** For dose checks: the schedule time this check covers ("08:00"). */
  slot: string | null;
  /** When the task is due ("08:30"), or null for any time. */
  time: string | null;
  assignee_id: string | null;
  recurrence: Recurrence;
}

export interface TaskEvent {
  task_id: string;
  date: string;
  status: Exclude<OccurrenceStatus, "open">;
  by_member_id: string | null;
  cover_member_id: string | null;
}

export interface TodayTask {
  task: TaskRow;
  status: OccurrenceStatus;
  /** Who is doing it now: the coverer if covered, else the assignee. */
  owner_id: string | null;
  cover_member_id: string | null;
  done_by_id: string | null;
  /** For dose checks: what the family scheduled at the slot, doses as typed. */
  dose_items: ScheduleItem[];
}

export interface TodayView {
  date: string;
  mine: TodayTask[];
  covering: TodayTask[];
  up_for_grabs: TodayTask[];
}

export function occurrences(tasks: TaskRow[], events: TaskEvent[], schedule: Schedule, date: string): TodayTask[] {
  const byTask = new Map(events.filter((e) => e.date === date).map((e) => [e.task_id, e]));
  return tasks
    .filter((t) => occursOn(t.recurrence, date))
    .map((task) => {
      const e = byTask.get(task.id);
      const status: OccurrenceStatus = e?.status ?? "open";
      const cover = e?.cover_member_id ?? null;
      return {
        task,
        status,
        owner_id: cover ?? task.assignee_id,
        cover_member_id: cover,
        done_by_id: status === "done" ? (e?.by_member_id ?? null) : null,
        dose_items: task.kind === "dose_check" && task.slot ? itemsAt(schedule, task.slot) : [],
      };
    })
    .sort((a, b) => (a.task.time ?? "99:99").localeCompare(b.task.time ?? "99:99") || a.task.title.localeCompare(b.task.title));
}

export function todayFor(memberId: string, tasks: TaskRow[], events: TaskEvent[], schedule: Schedule, date: string): TodayView {
  const all = occurrences(tasks, events, schedule, date);
  return {
    date,
    mine: all.filter((o) => o.task.assignee_id === memberId && !o.cover_member_id),
    covering: all.filter((o) => o.cover_member_id === memberId),
    up_for_grabs: all.filter((o) => o.status === "needs_cover" && o.task.assignee_id !== memberId),
  };
}

/** The allowed transitions; anything else is refused. */
export function nextEvent(
  current: TodayTask,
  action: "done" | "undo" | "need_cover" | "take",
  memberId: string,
): Omit<TaskEvent, "task_id" | "date"> | null | "clear" {
  switch (action) {
    case "done":
      if (current.status === "done") return null;
      if (current.status === "needs_cover") return null;
      if (current.owner_id !== memberId) return null;
      return { status: "done", by_member_id: memberId, cover_member_id: current.cover_member_id };
    case "undo":
      if (current.status === "done" && current.done_by_id === memberId) {
        return current.cover_member_id ? { status: "covered", by_member_id: null, cover_member_id: current.cover_member_id } : "clear";
      }
      if (current.status === "needs_cover" && current.task.assignee_id === memberId) return "clear";
      return null;
    case "need_cover":
      if (current.status !== "open" || current.task.assignee_id !== memberId) return null;
      return { status: "needs_cover", by_member_id: null, cover_member_id: null };
    case "take":
      if (current.status !== "needs_cover" || current.task.assignee_id === memberId) return null;
      return { status: "covered", by_member_id: null, cover_member_id: memberId };
  }
}
