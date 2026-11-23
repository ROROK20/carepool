import type { Metadata } from "next";
import Link from "next/link";
import { PrintButton } from "@/components/PrintButton";
import { labelTitle } from "@/lib/cards/pipeline";
import { localToday, longDate } from "@/lib/circle/recurrence";
import { getRecipient } from "@/lib/repo";
import { formatTime } from "@/lib/schedule/parse";
import { sheetView } from "@/lib/views";

export const dynamic = "force-dynamic";

/** The browser prints the title in its page header, so a second page still says whose sheet it is. */
export function generateMetadata(): Metadata {
  const name = getRecipient()?.name;
  return { title: name ? `${name}: doctor visit sheet (Carepool)` : "Doctor visit sheet (Carepool)" };
}

/**
 * One printable page to bring to a doctor or pharmacist visit. Every dose and
 * time is the family's own entry, copied as stored; every label quote is the
 * matcher's verbatim span; every explanatory sentence is one the app already
 * shows elsewhere. Nothing on this page is written for it.
 */

const NOT_ENTERED = "not entered";

function formulationNote(f: "extended" | "delayed" | "immediate"): string {
  return f === "extended" ? " (extended-release)" : f === "delayed" ? " (delayed-release)" : "";
}

export default function SheetPage() {
  const v = sheetView();
  const name = v.recipient?.name;
  return (
    <article id="doctor-sheet" data-testid="doctor-sheet" className="sheet space-y-6 print:space-y-3">
      <header className="space-y-3 print:space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-accent">Carepool · Doctor visit sheet</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink print:text-2xl" data-testid="sheet-recipient">
              {name ? `${name}'s medicines` : "Medicines"}
            </h1>
            <p className="mt-1 text-muted">
              {v.recipient?.age ? `${v.recipient.age} years old · ` : ""}
              <span data-testid="sheet-printed-date">Printed {longDate(localToday())}</span>
            </p>
          </div>
          <PrintButton>Print this sheet</PrintButton>
        </div>
        <p className="rounded-xl border border-amber-300 bg-warn-soft px-3 py-2 text-sm text-warn print:border-black" data-testid="sheet-safety">
          <strong>Not medical advice.</strong> Carepool shows what each medicine&apos;s FDA label says, in plain words, with the label&apos;s exact text beside it. Always confirm
          medicines, doses and interactions with a pharmacist or doctor.
        </p>
      </header>

      <section aria-labelledby="sheet-meds">
        <div className="sheet-head">
          <h2 id="sheet-meds" className="text-xl font-semibold text-ink">
            Medicines ({v.meds.length})
          </h2>
          <p className="mt-1 text-sm text-muted">
            Every dose and every time below is copied from what you entered on the Medicines page. Carepool never adds a dose, changes one, or picks a time; if something is
            missing, it says so instead.
          </p>
        </div>
        {v.meds.length === 0 ? (
          <p className="mt-3">
            No medicines yet.{" "}
            <Link href="/meds" className="font-semibold text-accent underline print:no-underline">
              Add them
            </Link>
            .
          </p>
        ) : (
          <ol className="mt-3 divide-y divide-line border-y border-line print:mt-2">
            {v.meds.map(({ med, label }) => (
              <li
                key={med.id}
                className="sheet-block grid gap-x-5 gap-y-1 py-3 sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1.15fr)] print:py-1.5"
                data-testid="sheet-med"
              >
                <h3 className="text-lg font-bold text-ink print:text-base" data-testid="sheet-med-name">
                  {med.name}
                </h3>
                <div>
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 sm:mt-0.5">
                    <dt className="text-sm text-muted">Dose, as typed</dt>
                    <dd data-testid="sheet-dose" className={med.dose.trim() ? "font-semibold" : "italic text-warn"}>
                      {med.dose.trim() || NOT_ENTERED}
                    </dd>
                    <dt className="text-sm text-muted">Times</dt>
                    <dd data-testid="sheet-times" className={med.times.length ? "font-semibold" : "italic text-warn"}>
                      {med.times.length ? med.times.map(formatTime).join(", ") : NOT_ENTERED}
                    </dd>
                    {med.notes ? (
                      <>
                        <dt className="text-sm text-muted">Notes</dt>
                        <dd data-testid="sheet-notes">{med.notes}</dd>
                      </>
                    ) : null}
                  </dl>
                </div>
                <div className="text-sm text-muted sm:mt-0.5 print:text-xs" data-testid="sheet-label">
                  {label ? (
                    <>
                      <p>
                        <span className="font-semibold text-ink">Label the card used:</span> {labelTitle(label)}
                        {formulationNote(label.formulation)}, version {label.version ?? "?"}, effective {longDate(label.effective_date)}.{" "}
                        <span className="wrap-anywhere" data-testid="sheet-dailymed">
                          DailyMed:{" "}
                          <a href={label.dailymed_url} className="text-accent hover:underline">
                            {label.dailymed_url}
                          </a>
                        </span>
                      </p>
                      {label.route_mismatch ? (
                        <p className="mt-1 font-semibold text-warn" data-testid="sheet-route-warning">
                          Check the bottle. The FDA label found is for a medicine given by {label.routes.join(" or ").toLowerCase() || "another route"}, which may not be how this
                          one is taken.
                        </p>
                      ) : null}
                      {label.formulation_mismatch ? (
                        <p className="mt-1 font-semibold text-warn" data-testid="sheet-formulation-warning">
                          Check the bottle.{" "}
                          {label.formulation === "extended"
                            ? "The only FDA label found is for an extended-release form, but your entry does not say extended-release (ER, XR, XL)."
                            : "Your entry says extended-release, but the label found is not for an extended-release form."}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p>
                      <span className="font-semibold text-ink">Label the card used:</span> No card yet.
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="sheet-questions">
        <div className="sheet-head">
          <h2 id="sheet-questions" className="text-xl font-semibold text-ink">
            Ask the pharmacist about
          </h2>
          <p className="mt-1 text-sm text-muted">A flag means a label mentions the pair; it is a question for the pharmacist, not a diagnosis.</p>
        </div>

        {v.meds_without_label.length > 0 ? (
          <p className="mt-3 text-warn" data-testid="sheet-unchecked">
            Not checked yet: {v.meds_without_label.map((m) => m.name).join(", ")}. Make their cards first; that fetches their labels.
          </p>
        ) : null}

        {v.questions.length === 0 && v.checked_meds > 1 ? (
          <p className="mt-3" data-testid="sheet-no-flags">
            No label names another medicine on this list. That is not a promise they are safe together: labels do not list everything. Ask the pharmacist to review the full list.
          </p>
        ) : null}

        {v.questions.length > 0 ? (
          <ol className="mt-3 divide-y divide-line border-y border-line print:mt-2">
            {v.questions.map((p) => (
              <li key={p.key} className="sheet-block py-3 print:py-1.5" data-testid="sheet-pair">
                <h3 className="text-lg font-bold text-ink print:text-base">
                  {p.names[0]} + {p.names[1]}
                </h3>
                <p className="mt-0.5" data-testid="sheet-question">
                  <span data-testid="sheet-question-text">{p.question.text}</span>
                  {p.question.explanation ? (
                    <span className="text-xs text-muted">
                      {" "}
                      (In plain words by {p.question.explanation.provider === "mock" ? "the mock template" : (p.question.explanation.model ?? "Claude")}. Checked: each sentence
                      quotes the label word for word.)
                    </span>
                  ) : null}
                </p>
                <p className="mt-2 text-sm font-semibold print:hidden">What the labels say:</p>
                <ul className="mt-1 space-y-2 print:space-y-1">
                  {p.flags.map((f) => (
                    <li key={f.id} className="sheet-quote border-l-2 border-line pl-3 text-sm leading-relaxed print:leading-snug" data-testid="sheet-quote">
                      <span className="font-serif text-ink">
                        {f.clipped_start ? "… " : ""}&ldquo;<span data-testid="sheet-quote-text">{f.quote}</span>&rdquo;{f.clipped_end ? " …" : ""}
                      </span>{" "}
                      <span className="text-xs text-muted" data-testid="sheet-quote-source">
                        {f.a_name} FDA label, {f.section_title} section{f.label_version ? `, version ${f.label_version}` : ""}
                        {f.label_date ? ` (${f.label_date})` : ""}. It names &ldquo;{f.matched_text}&rdquo;
                        {f.kind === "class" ? `, the class ${f.b_name} belongs to (${f.class_name})` : ""}.
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        ) : null}
      </section>

      <footer className="space-y-1 border-t border-line pt-3 text-xs text-muted">
        <p>
          Limits: the check finds names and drug-class phrases in the label text. It can miss an interaction a label describes in other words, and it can flag a mention that is
          not really about using the two together.
        </p>
        <p className="hidden print:block">Label text from openFDA (U.S. Food and Drug Administration, public domain), cached locally with each label&apos;s version and date.</p>
      </footer>
    </article>
  );
}
