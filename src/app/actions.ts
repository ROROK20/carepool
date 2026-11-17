"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isIsoDate, RecurrenceSchema, type Recurrence } from "@/lib/circle/recurrence";
import { nextEvent, occurrences } from "@/lib/circle/today";
import { startGeneration } from "@/lib/jobs";
import {
  clearEvent,
  createMed,
  createMember,
  createTask,
  deleteMed,
  deleteMember,
  deleteTask,
  getMember,
  listEvents,
  listMeds,
  listTasks,
  setEvent,
  setTaskAssignee,
  updateMed,
} from "@/lib/repo";
import { buildSchedule } from "@/lib/schedule/build";
import { isClockTime, parseTimes } from "@/lib/schedule/parse";
import { MEMBER_COLORS } from "@/components/ui";

/**
 * Server actions. Every form posts here; inputs are validated with zod and
 * nothing a person typed is rewritten except trimming the ends.
 */

export interface ActionState {
  ok: boolean;
  message: string;
}

function refreshAll() {
  for (const p of ["/", "/meds", "/interactions", "/schedule", "/circle"]) revalidatePath(p);
  revalidatePath("/meds/[id]", "page");
  revalidatePath("/today/[member]", "page");
}

/** Times field: clock times only ("8:00 AM, 6 pm, 20:00"); anything else is reported, never guessed. */
function readTimes(raw: string): { times: string[]; bad: string[] } {
  const parts = raw.split(/[,;]|\band\b/).map((p) => p.trim()).filter(Boolean);
  const times = new Set<string>();
  const bad: string[] = [];
  for (const p of parts) {
    if (isClockTime(p)) times.add(p);
    else {
      const found = parseTimes(p);
      if (found.length === 0) bad.push(p);
      found.forEach((t) => times.add(t));
    }
  }
  return { times: [...times].sort(), bad };
}

const MedForm = z.object({
  name: z.string().trim().min(2, "Enter the medicine name.").max(80),
  dose: z.string().max(300),
  times: z.string().max(200),
  notes: z.string().max(300),
});

export async function saveMedAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = MedForm.safeParse({
    name: form.get("name") ?? "",
    dose: form.get("dose") ?? "",
    times: form.get("times") ?? "",
    notes: form.get("notes") ?? "",
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the form." };
  const { times, bad } = readTimes(parsed.data.times);
  if (bad.length > 0) {
    return { ok: false, message: `"${bad[0]}" is not a clock time. Write times like 8:00 AM or 20:00; Carepool does not turn words like "morning" into times.` };
  }
  const id = String(form.get("id") ?? "");
  const fields = { name: parsed.data.name, dose: parsed.data.dose.trim(), times, notes: parsed.data.notes.trim() };
  if (id) updateMed(id, fields);
  else createMed(fields);
  refreshAll();
  return { ok: true, message: id ? `Saved ${fields.name}.` : `Added ${fields.name}.` };
}

const PastedItems = z.array(
  z.object({
    name: z.string().trim().min(2).max(80),
    dose: z.string().max(300),
    times: z.array(z.string()).max(12),
    notes: z.string().max(300).optional(),
  }),
);

export async function addPastedMedsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let items: z.infer<typeof PastedItems>;
  try {
    items = PastedItems.parse(JSON.parse(String(form.get("items") ?? "[]")));
  } catch {
    return { ok: false, message: "Nothing to add." };
  }
  for (const it of items) {
    createMed({ name: it.name, dose: it.dose, times: it.times.filter(isClockTime), notes: it.notes ?? "" });
  }
  refreshAll();
  return { ok: true, message: `Added ${items.length} medicine(s).` };
}

export async function deleteMedAction(form: FormData): Promise<void> {
  const id = String(form.get("id") ?? "");
  if (id) deleteMed(id);
  refreshAll();
  if (form.get("redirect")) redirect("/meds");
}

export async function generateCardsAction(form: FormData): Promise<ActionState> {
  const medId = String(form.get("med_id") ?? "");
  const r = startGeneration(medId ? { medIds: [medId] } : {});
  refreshAll();
  return r.started ? { ok: true, message: "Started." } : { ok: false, message: r.reason ?? "Could not start." };
}

const MemberForm = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(40),
  relation: z.string().trim().max(40),
  color: z.enum(MEMBER_COLORS as [string, ...string[]]),
});

export async function addMemberAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = MemberForm.safeParse({ name: form.get("name") ?? "", relation: form.get("relation") ?? "", color: form.get("color") ?? "teal" });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the form." };
  createMember(parsed.data);
  refreshAll();
  return { ok: true, message: `${parsed.data.name} joined the care circle.` };
}

export async function removeMemberAction(form: FormData): Promise<void> {
  const id = String(form.get("id") ?? "");
  if (id) deleteMember(id);
  refreshAll();
}

const TaskForm = z.object({
  title: z.string().trim().min(2, "Name the task.").max(80),
  kind: z.enum(["dose_check", "refill", "organizer", "custom"]),
  assignee_id: z.string().max(80),
  time: z.string().max(20),
  slot: z.string().max(10),
  repeat: z.enum(["daily", "weekly", "every_n_days", "once"]),
  weekday: z.coerce.number().int().min(0).max(6),
  n: z.coerce.number().int().min(1).max(366),
  date: z.string().max(10),
});

export async function addTaskAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const raw = Object.fromEntries(["title", "kind", "assignee_id", "time", "slot", "repeat", "weekday", "n", "date"].map((k) => [k, form.get(k) ?? ""]));
  const parsed = TaskForm.safeParse({ ...raw, weekday: raw.weekday || 0, n: raw.n || 1 });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the form." };
  const t = parsed.data;
  const time = t.time ? readTimes(t.time).times[0] ?? null : null;
  if (t.time && !time) return { ok: false, message: `"${t.time}" is not a clock time.` };
  if ((t.repeat === "every_n_days" || t.repeat === "once") && !isIsoDate(t.date)) return { ok: false, message: "Pick a date." };
  let recurrence: Recurrence;
  if (t.repeat === "daily") recurrence = { type: "daily" };
  else if (t.repeat === "weekly") recurrence = { type: "weekly", days: [t.weekday] };
  else if (t.repeat === "every_n_days") recurrence = { type: "every_n_days", n: t.n, start: t.date };
  else recurrence = { type: "once", date: t.date };
  if (t.assignee_id && !getMember(t.assignee_id)) return { ok: false, message: "Pick someone from the care circle." };
  createTask({
    title: t.title,
    kind: t.kind,
    slot: t.kind === "dose_check" && isClockTime(t.slot) ? t.slot : null,
    time,
    assignee_id: t.assignee_id || null,
    recurrence: RecurrenceSchema.parse(recurrence),
  });
  refreshAll();
  return { ok: true, message: `Added "${t.title}".` };
}

export async function reassignTaskAction(form: FormData): Promise<void> {
  const taskId = String(form.get("task_id") ?? "");
  const memberId = String(form.get("assignee_id") ?? "");
  if (taskId && (!memberId || getMember(memberId))) setTaskAssignee(taskId, memberId || null);
  refreshAll();
}

export async function deleteTaskAction(form: FormData): Promise<void> {
  const id = String(form.get("task_id") ?? "");
  if (id) deleteTask(id);
  refreshAll();
}

/** done | undo | need_cover | take, for one task on one day, by one person. Illegal moves are ignored. */
export async function taskAction(form: FormData): Promise<void> {
  const taskId = String(form.get("task_id") ?? "");
  const date = String(form.get("date") ?? "");
  const memberId = String(form.get("member_id") ?? "");
  const action = String(form.get("action") ?? "") as "done" | "undo" | "need_cover" | "take";
  if (!isIsoDate(date) || !getMember(memberId) || !["done", "undo", "need_cover", "take"].includes(action)) return;
  const occ = occurrences(listTasks(), listEvents(date), buildSchedule(listMeds()), date).find((o) => o.task.id === taskId);
  if (!occ) return;
  const next = nextEvent(occ, action, memberId);
  if (next === "clear") clearEvent(taskId, date);
  else if (next) setEvent(taskId, date, next);
  refreshAll();
}
