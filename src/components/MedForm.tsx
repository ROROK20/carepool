"use client";

import { useActionState } from "react";
import { saveMedAction, type ActionState } from "@/app/actions";
import { buttonClass, inputClass } from "./ui";

interface Props {
  med?: { id: string; name: string; dose: string; times: string[]; notes: string };
}

/** Add or edit one medicine. The dose box is saved exactly as typed. */
export function MedForm({ med }: Props) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveMedAction, { ok: true, message: "" });
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2" data-testid={med ? "edit-med-form" : "add-med-form"}>
      {med ? <input type="hidden" name="id" value={med.id} /> : null}
      <label className="text-sm font-semibold">
        Medicine name
        <input name="name" required defaultValue={med?.name} placeholder="e.g. Lisinopril" className={`${inputClass} mt-1 font-normal`} />
      </label>
      <label className="text-sm font-semibold">
        Times you give it
        <input name="times" defaultValue={med?.times.join(", ")} placeholder="e.g. 8:00 AM, 6:00 PM" className={`${inputClass} mt-1 font-normal`} />
        <span className="mt-1 block text-xs font-normal text-muted">Clock times only. Carepool never picks a time for you.</span>
      </label>
      <label className="text-sm font-semibold sm:col-span-2">
        Dose, exactly as the prescription label says
        <input name="dose" defaultValue={med?.dose} placeholder="e.g. 10 mg tablet, take 1 tablet by mouth once daily" className={`${inputClass} mt-1 font-normal`} />
        <span className="mt-1 block text-xs font-normal text-muted">Saved word for word. Carepool never changes, checks or suggests a dose.</span>
      </label>
      <label className="text-sm font-semibold sm:col-span-2">
        Notes (optional)
        <input name="notes" defaultValue={med?.notes} placeholder="e.g. with breakfast" className={`${inputClass} mt-1 font-normal`} />
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" disabled={pending} className={buttonClass.primary}>
          {med ? "Save changes" : "Add medicine"}
        </button>
        {state.message ? (
          <p role="status" className={`text-sm ${state.ok ? "text-ok" : "text-danger"}`}>
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
