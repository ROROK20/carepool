import { describe, expect, it } from "vitest";
import { describeRecurrence, isIsoDate, localToday, occursOn, RecurrenceSchema } from "@/lib/circle/recurrence";
import { nextEvent, occurrences, todayFor, type TaskEvent, type TaskRow } from "@/lib/circle/today";
import { buildSchedule } from "@/lib/schedule/build";

describe("recurrence", () => {
  it("daily, weekly, every-n-days and once", () => {
    expect(occursOn({ type: "daily" }, "2026-11-19")).toBe(true);
    // 2026-11-22 is a Sunday.
    expect(occursOn({ type: "weekly", days: [0] }, "2026-11-22")).toBe(true);
    expect(occursOn({ type: "weekly", days: [0] }, "2026-11-21")).toBe(false);
    expect(occursOn({ type: "every_n_days", n: 30, start: "2026-11-20" }, "2026-11-20")).toBe(true);
    expect(occursOn({ type: "every_n_days", n: 30, start: "2026-11-20" }, "2026-12-20")).toBe(true);
    expect(occursOn({ type: "every_n_days", n: 30, start: "2026-11-20" }, "2026-12-19")).toBe(false);
    expect(occursOn({ type: "every_n_days", n: 30, start: "2026-11-20" }, "2026-10-21")).toBe(false);
    expect(occursOn({ type: "once", date: "2026-11-24" }, "2026-11-24")).toBe(true);
    expect(occursOn({ type: "once", date: "2026-11-24" }, "2026-11-25")).toBe(false);
  });

  it("is not shifted by the daylight-saving change (US DST ended 2026-11-01)", () => {
    expect(occursOn({ type: "every_n_days", n: 2, start: "2026-10-30" }, "2026-11-03")).toBe(true);
    expect(occursOn({ type: "every_n_days", n: 7, start: "2026-03-01" }, "2026-03-15")).toBe(true);
  });

  it("validates input and rejects impossible dates", () => {
    expect(RecurrenceSchema.safeParse({ type: "weekly", days: [] }).success).toBe(false);
    expect(RecurrenceSchema.safeParse({ type: "every_n_days", n: 0, start: "2026-11-20" }).success).toBe(false);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(() => occursOn({ type: "daily" }, "2026-13-01")).toThrow();
  });

  it("describes schedules in plain words", () => {
    expect(describeRecurrence({ type: "weekly", days: [0] })).toBe("Every week on Sundays");
    expect(describeRecurrence({ type: "every_n_days", n: 30, start: "2026-11-20" })).toBe("Every 30 days from Fri, Nov 20");
    expect(localToday(new Date(2026, 10, 19, 23, 59))).toBe("2026-11-19");
  });
});

const tasks: TaskRow[] = [
  { id: "am", title: "Morning dose check", kind: "dose_check", slot: "08:00", time: "08:30", assignee_id: "ana", recurrence: { type: "daily" } },
  { id: "org", title: "Fill the pill organizer", kind: "organizer", slot: null, time: "10:00", assignee_id: "luis", recurrence: { type: "weekly", days: [0] } },
  { id: "pm", title: "Evening dose check", kind: "dose_check", slot: "18:00", time: "18:30", assignee_id: "maya", recurrence: { type: "daily" } },
];
const schedule = buildSchedule([
  { id: "l", name: "Lisinopril", dose: "10 mg tablet, take 1 tablet", times: ["08:00"], notes: "" },
  { id: "w", name: "Warfarin", dose: "5 mg tablet in the evening", times: ["18:00"], notes: "" },
]);

describe("today view and handing tasks off", () => {
  it("shows each person their own tasks for the day, dose checks with the doses as typed", () => {
    const v = todayFor("ana", tasks, [], schedule, "2026-11-20");
    expect(v.mine.map((t) => t.task.id)).toEqual(["am"]);
    expect(v.mine[0].dose_items.map((i) => [i.name, i.dose])).toEqual([["Lisinopril", "10 mg tablet, take 1 tablet"]]);
    expect(occurrences(tasks, [], schedule, "2026-11-22").map((t) => t.task.id)).toEqual(["am", "org", "pm"]);
  });

  it("asking for cover puts the task up for grabs for everyone else; taking it moves it", () => {
    const today = "2026-11-20";
    const open = occurrences(tasks, [], schedule, today).find((t) => t.task.id === "pm")!;
    expect(nextEvent(open, "need_cover", "ana")).toBeNull(); // only the assignee can ask
    const ask = nextEvent(open, "need_cover", "maya");
    expect(ask).toMatchObject({ status: "needs_cover" });
    const events: TaskEvent[] = [{ task_id: "pm", date: today, ...(ask as Omit<TaskEvent, "task_id" | "date">) }];

    expect(todayFor("ana", tasks, events, schedule, today).up_for_grabs.map((t) => t.task.id)).toEqual(["pm"]);
    expect(todayFor("maya", tasks, events, schedule, today).up_for_grabs).toEqual([]);

    const pending = occurrences(tasks, events, schedule, today).find((t) => t.task.id === "pm")!;
    expect(nextEvent(pending, "take", "maya")).toBeNull(); // cannot take your own
    expect(nextEvent(pending, "done", "maya")).toBeNull(); // waiting for cover
    const take = nextEvent(pending, "take", "luis");
    expect(take).toMatchObject({ status: "covered", cover_member_id: "luis" });
    events[0] = { task_id: "pm", date: today, ...(take as Omit<TaskEvent, "task_id" | "date">) };

    const luis = todayFor("luis", tasks, events, schedule, today);
    expect(luis.covering.map((t) => t.task.id)).toEqual(["pm"]);
    expect(todayFor("maya", tasks, events, schedule, today).mine.map((t) => t.task.id)).toEqual([]);
    expect(todayFor("ana", tasks, events, schedule, today).up_for_grabs).toEqual([]);

    const covered = luis.covering[0];
    expect(nextEvent(covered, "done", "maya")).toBeNull();
    expect(nextEvent(covered, "done", "luis")).toMatchObject({ status: "done", by_member_id: "luis", cover_member_id: "luis" });
  });

  it("done can be undone by the person who did it", () => {
    const open = occurrences(tasks, [], schedule, "2026-11-20").find((t) => t.task.id === "am")!;
    const done = nextEvent(open, "done", "ana");
    expect(done).toMatchObject({ status: "done", by_member_id: "ana" });
    const ev: TaskEvent[] = [{ task_id: "am", date: "2026-11-20", ...(done as Omit<TaskEvent, "task_id" | "date">) }];
    const doneOcc = occurrences(tasks, ev, schedule, "2026-11-20").find((t) => t.task.id === "am")!;
    expect(nextEvent(doneOcc, "done", "ana")).toBeNull();
    expect(nextEvent(doneOcc, "undo", "luis")).toBeNull();
    expect(nextEvent(doneOcc, "undo", "ana")).toBe("clear");
  });
});
