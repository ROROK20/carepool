import Link from "next/link";
import { Card, PageTitle, Pill, SectionTitle } from "@/components/ui";
import { interactionsView, type FlagView } from "@/lib/views";

export const dynamic = "force-dynamic";

function Quote({ flag }: { flag: FlagView }) {
  return (
    <blockquote className="mt-2 rounded-xl border border-line bg-stone-50 p-3 text-sm leading-relaxed" data-testid="flag-quote">
      {flag.clipped_start ? "… " : ""}
      <span className="label-quote">{flag.quote}</span>
      {flag.clipped_end ? " …" : ""}
      <footer className="mt-2 text-xs text-muted">
        {flag.a_name} FDA label, {flag.section_title} section{flag.label_version ? `, version ${flag.label_version}` : ""}
        {flag.label_date ? ` (${flag.label_date})` : ""}. It names{" "}
        <strong className="text-ink">&ldquo;{flag.matched_text}&rdquo;</strong>
        {flag.kind === "class" ? `, the class ${flag.b_name} belongs to (${flag.class_name})` : ""}.{" "}
        <a href={flag.dailymed_url} target="_blank" rel="noreferrer" className="font-semibold text-accent hover:underline">
          DailyMed
        </a>
      </footer>
    </blockquote>
  );
}

export default function InteractionsPage() {
  const v = interactionsView();
  const flagged = v.pairs.filter((p) => p.flagged);
  const noted = v.pairs.filter((p) => !p.flagged);
  return (
    <div className="space-y-6">
      <PageTitle title="Interaction flags" kicker="From the labels, not from the model">
        Carepool read each medicine&apos;s FDA label (its Drug Interactions, Boxed Warning, Contraindications and Warnings sections) and looked for the name or drug class of every other
        medicine on the list. A flag means a label mentions the pair; it is a question for the pharmacist, not a diagnosis. Claude only explains a flag in plain words; it cannot add one.
      </PageTitle>

      {v.meds_without_label.length > 0 ? (
        <Card>
          <p className="text-warn">
            Not checked yet: {v.meds_without_label.map((m) => m.name).join(", ")}. Make their cards first; that fetches their labels.{" "}
            <Link href="/meds" className="font-semibold underline">
              Medicines
            </Link>
          </p>
        </Card>
      ) : null}

      <p className="text-sm text-muted" data-testid="flag-summary">
        {v.checked_meds} medicines checked, {(v.checked_meds * (v.checked_meds - 1)) / 2} pairs, {flagged.length} flagged.
      </p>

      {flagged.length === 0 && v.checked_meds > 1 ? (
        <Card>
          <p>
            No label names another medicine on this list. That is not a promise they are safe together: labels do not list everything. Ask the pharmacist to review the full list.
          </p>
        </Card>
      ) : null}

      {flagged.map((p) => {
        const directions = [p.flags.filter((f) => f.a === p.flags[0].a), p.flags.filter((f) => f.a !== p.flags[0].a)].filter((x) => x.length > 0);
        const explanation = p.flags.map((f) => f.explanation).find((e) => e?.verified);
        return (
          <Card key={p.key} className="border-l-4 border-l-amber-400">
            <div id={p.key} className="scroll-mt-24" data-testid="flag-pair">
              <div className="flex flex-wrap items-center gap-2">
                <SectionTitle>
                  {p.names[0]} + {p.names[1]}
                </SectionTitle>
                <Pill kind="flag">Ask the pharmacist</Pill>
              </div>
              {explanation ? (
                <div className="mb-3" data-testid="flag-explanation">
                  <p className="text-lg">{explanation.text}</p>
                  <p className="mt-1 text-xs text-muted">
                    Plain-words explanation by {explanation.provider === "mock" ? "the mock template" : (explanation.model ?? "Claude")}, checked: it quotes the label word for word (
                    <span className="label-quote">{explanation.quote}</span>).
                  </p>
                </div>
              ) : (
                <p className="mb-3 text-sm text-muted">No checked explanation yet. The label text is below.</p>
              )}
              {directions.map((flags) => (
                <div key={flags[0].a} className="mt-3">
                  <p className="text-sm font-semibold">What the {flags[0].a_name} label says:</p>
                  {flags.map((f) => (
                    <Quote key={f.id} flag={f} />
                  ))}
                </div>
              ))}
            </div>
          </Card>
        );
      })}

      {noted.length > 0 ? (
        <Card>
          <SectionTitle>Mentioned, but the label reports no meaningful interaction</SectionTitle>
          {noted.map((p) => (
            <div key={p.key} className="mt-3">
              <p className="font-semibold">
                {p.names[0]} + {p.names[1]}
              </p>
              {p.flags.map((f) => (
                <Quote key={f.id} flag={f} />
              ))}
            </div>
          ))}
        </Card>
      ) : null}

      <p className="text-xs text-muted">
        Limits: the check finds names and drug-class phrases in the label text. It can miss an interaction a label describes in other words, and it can flag a mention that is not
        really about using the two together. The evaluation in the project&apos;s eval/results.md measures both.
      </p>
    </div>
  );
}
