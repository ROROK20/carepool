"use client";

import { useActionState, useState } from "react";
import { addMemberAction, addTaskAction, type ActionState } from "@/app/actions";
import { buttonClass, inputClass, MEMBER_COLORS } from "./ui";

export function AddMemberForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(addMemberAction, { ok: true, message: "" });
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-4" data-testid="add-member-form">
      <label className="text-sm font-semibold sm:col-span-2">
        Name
        <input name="name" required placeholder="e.g. Tomás" className={`${inputClass} mt-1 font-normal`} />
      </label>
      <label className="text-sm font-semibold">
        Relation
        <input name="relation" placeholder="e.g. grandson" className={`${inputClass} mt-1 font-normal`} />
      </label>
      <label className="text-sm font-semibold">
        Color
        <select name="color" defaultValue="sky" className={`${inputClass} mt-1 font-normal`}>
          {MEMBER_COLORS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-3 sm:col-span-4">
        <button type="submit" disabled={pending} className={buttonClass.primary}>
          Add to the circle
        </button>
        {state.message ? <p className={`text-sm ${state.ok ? "text-ok" : "text-danger"}`}>{state.message}</p> : null}
      </div>
    </form>
  );
}

export function AddTaskForm({ members, slots, today }: { members: { id: string; name: string }[]; slots: string[]; today: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addTaskAction, { ok: true, message: "" });
  const [repeat, setRepeat] = useState("daily");
  const [kind, setKind] = useState("custom");
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-6" data-testid="add-task-form">
      <label className="text-sm font-semibold sm:col-span-3">
        Task
        <input name="title" required placeholder="e.g. Pick up refills" className={`${inputClass} mt-1 font-normal`} />
      </label>
      <label className="text-sm font-semibold sm:col-span-3">
        Kind
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className={`${inputClass} mt-1 font-normal`}>
          <option value="custom">General task</option>
          <option value="dose_check">Dose check</option>
          <option value="refill">Refill pickup</option>
          <option value="organizer">Pill organizer</option>
        </select>
      </label>
      {kind === "dose_check" ? (
        <label className="text-sm font-semibold sm:col-span-3">
          Checks the doses scheduled at
          <select name="slot" className={`${inputClass} mt-1 font-normal`}>
            {slots.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <input type="hidden" name="slot" value="" />
      )}
      <label className="text-sm font-semibold sm:col-span-3">
        Who
        <select name="assignee_id" className={`${inputClass} mt-1 font-normal`}>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
          <option value="">Nobody yet</option>
        </select>
      </label>
      <label className="text-sm font-semibold sm:col-span-2">
        Repeats
        <select name="repeat" value={repeat} onChange={(e) => setRepeat(e.target.value)} className={`${inputClass} mt-1 font-normal`}>
          <option value="daily">Every day</option>
          <option value="weekly">Every week</option>
          <option value="every_n_days">Every few days</option>
          <option value="once">Once</option>
        </select>
      </label>
      {repeat === "weekly" ? (
        <label className="text-sm font-semibold sm:col-span-2">
          On
          <select name="weekday" defaultValue="0" className={`${inputClass} mt-1 font-normal`}>
            {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {repeat === "every_n_days" ? (
        <label className="text-sm font-semibold sm:col-span-1">
          Every (days)
          <input name="n" type="number" min={1} max={366} defaultValue={30} className={`${inputClass} mt-1 font-normal`} />
        </label>
      ) : null}
      {repeat === "every_n_days" || repeat === "once" ? (
        <label className="text-sm font-semibold sm:col-span-2">
          {repeat === "once" ? "Date" : "Starting"}
          <input name="date" type="date" defaultValue={today} className={`${inputClass} mt-1 font-normal`} />
        </label>
      ) : null}
      <label className="text-sm font-semibold sm:col-span-1">
        Time
        <input name="time" placeholder="5:00 PM" className={`${inputClass} mt-1 font-normal`} />
      </label>
      <div className="flex items-center gap-3 sm:col-span-6">
        <button type="submit" disabled={pending} className={buttonClass.primary}>
          Add task
        </button>
        {state.message ? <p className={`text-sm ${state.ok ? "text-ok" : "text-danger"}`}>{state.message}</p> : null}
      </div>
    </form>
  );
}
