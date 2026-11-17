"use client";

import { useActionState, useMemo, useState } from "react";
import { addPastedMedsAction, type ActionState } from "@/app/actions";
import { formatTime, parsePastedList } from "@/lib/schedule/parse";
import { buttonClass, inputClass } from "./ui";

/**
 * Paste a list (one medicine per line). The same parser the tests cover runs
 * right here, so the family sees exactly what will be saved, and what was
 * not understood, before anything is added.
 */
export function PastePreview() {
  const [text, setText] = useState("");
  const [state, action, pending] = useActionState<ActionState, FormData>(addPastedMedsAction, { ok: true, message: "" });
  const lines = useMemo(() => parsePastedList(text), [text]);
  const items = lines.map((l) => ({ name: l.name, dose: l.dose, times: l.times }));
  return (
    <div className="space-y-3">
      <label className="block text-sm font-semibold">
        Paste the list, one medicine per line
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          data-testid="paste-box"
          placeholder={"Lisinopril 10 mg tablet, take 1 tablet once daily, 8:00 AM\nMetformin 500 mg tablet twice daily with meals, 8:00 AM and 6:00 PM"}
          className={`${inputClass} mt-1 font-mono text-sm font-normal`}
        />
      </label>
      {lines.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-left text-sm" data-testid="paste-preview">
            <thead className="bg-stone-50 text-xs uppercase text-muted">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Dose (as written)</th>
                <th className="px-3 py-2">Times found</th>
                <th className="px-3 py-2">Check</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t border-line align-top">
                  <td className="px-3 py-2 font-semibold">{l.name}</td>
                  <td className="px-3 py-2">{l.dose || <span className="text-muted">none</span>}</td>
                  <td className="px-3 py-2">{l.times.length ? l.times.map(formatTime).join(", ") : <span className="text-warn">none</span>}</td>
                  <td className="px-3 py-2 text-xs text-warn">{l.warnings.join(" ") || <span className="text-ok">OK</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <form
        action={(fd) => {
          action(fd);
          setText("");
        }}
        className="flex items-center gap-3"
      >
        <input type="hidden" name="items" value={JSON.stringify(items)} />
        <button type="submit" disabled={pending || lines.length === 0} className={buttonClass.primary}>
          Add {lines.length || ""} medicine{lines.length === 1 ? "" : "s"}
        </button>
        {state.message ? <p className={`text-sm ${state.ok ? "text-ok" : "text-danger"}`}>{state.message}</p> : null}
      </form>
    </div>
  );
}
