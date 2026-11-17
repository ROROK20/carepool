import Link from "next/link";
import { notFound } from "next/navigation";
import { GenerationPanel } from "@/components/GenerationPanel";
import { MedForm } from "@/components/MedForm";
import { Card, PageTitle, Pill, SectionTitle } from "@/components/ui";
import { labelTitle } from "@/lib/cards/pipeline";
import { isGenerating } from "@/lib/jobs";
import { CARD_PARTS, CARD_PART_TITLES, sectionTitle } from "@/lib/labels/sections";
import { formatTime } from "@/lib/schedule/parse";
import { cardView } from "@/lib/views";

export const dynamic = "force-dynamic";

function longDate(iso: string | null): string {
  if (!iso) return "unknown date";
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const REASON_TEXT: Record<string, string> = {
  QUOTE_NOT_FOUND: "its quote is not in the label word for word",
  DOSE_MENTION: "it states a dose or how often to take it",
  UNGROUNDED_TOKEN: "it has a number or phrase its quote does not",
  WRONG_PART: "it cites a label section that does not cover this part of the card",
  UNKNOWN_SECTION: "it cites a section this label does not have",
  QUOTE_TOO_SHORT: "its quote is too short to check",
  QUOTE_TOO_LONG: "its quote is too long",
  NO_CITATION: "it has no quote",
};

export default async function CardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = cardView(id);
  if (!view) notFound();
  const { med, row, card, label, verified, context } = view;
  const allVerified = card ? card.sentences.every((s) => verified[s.id]) : false;

  return (
    <div className="space-y-6">
      <p>
        <Link href="/meds" className="text-sm font-semibold text-accent hover:underline">
          ← All medicines
        </Link>
      </p>
      <PageTitle title={med.name} kicker="Medicine card">
        {card && label ? (
          <span data-testid="label-meta">
            From the FDA label for <strong className="text-ink">{labelTitle(card.label)}</strong>, version {card.label.version ?? "?"}, effective {longDate(card.label.effective_date)}.{" "}
            <a href={card.label.dailymed_url} className="font-semibold text-accent hover:underline" target="_blank" rel="noreferrer">
              Read the full label on DailyMed
            </a>
            .
          </span>
        ) : (
          "No card yet."
        )}
      </PageTitle>

      <Card className="border-accent/30 bg-accent-soft">
        <p className="text-sm font-semibold uppercase tracking-wide text-accent-strong">Your prescription, as you typed it</p>
        <p className="mt-1 text-lg font-semibold" data-testid="card-typed-dose">
          {med.dose || "No dose entered"}
        </p>
        <p className="text-sm text-muted">
          Times: {med.times.length ? med.times.map(formatTime).join(", ") : "none entered"}
          {med.notes ? ` · ${med.notes}` : ""}
        </p>
        <p className="mt-2 text-xs text-muted">This card never shows a dose or how often to take it. Those come only from the prescription above.</p>
      </Card>

      {!card ? (
        <Card>
          {row?.status === "failed" ? <p className="mb-3 text-danger">The last attempt failed: {row.error}</p> : null}
          {row?.status === "running" || row?.status === "queued" ? <p className="mb-3 text-muted">{row.step}</p> : null}
          <GenerationPanel label="Make this card" medId={med.id} initiallyRunning={isGenerating()} />
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="card-provenance">
            {card.provider === "mock" ? <Pill kind="mock">Mock card (scripted, not a model)</Pill> : null}
            <Pill kind={allVerified ? "verified" : "failed"}>
              {card.sentences.filter((s) => verified[s.id]).length}/{card.sentences.length} quotes found word for word
            </Pill>
            <span className="text-muted">
              {card.stats.generated} drafted · {card.stats.kept} kept · {card.removed.length} removed
              {card.stats.recovered_by_repair ? ` · ${card.stats.recovered_by_repair} fixed on a second try` : ""}
              {card.models.writer ? ` · written by ${card.models.writer}` : ""}
              {card.review.status === "applied" && card.models.review ? `, reworded for clarity by ${card.models.review} (${card.review.changed} re-checked${card.review.reverted ? `, ${card.review.reverted} kept original` : ""})` : ""}
            </span>
          </div>

          {CARD_PARTS.map((part) => {
            const sentences = card.sentences.filter((s) => s.part === part);
            return (
              <Card key={part}>
                <SectionTitle>{CARD_PART_TITLES[part]}</SectionTitle>
                {sentences.length === 0 ? (
                  <p className="text-muted">Nothing for this part passed the checker. Ask the pharmacist.</p>
                ) : (
                  <ul className="space-y-4" data-testid={`part-${part}`}>
                    {sentences.map((s) => (
                      <li key={s.id} data-testid="card-sentence">
                        <p className="text-lg leading-relaxed">{s.text}</p>
                        <details className="group mt-1">
                          <summary className="inline-flex items-center gap-2 rounded-lg border border-line px-2 py-1 text-xs font-semibold text-muted hover:border-accent hover:text-accent">
                            <span>Label says · {sectionTitle(s.section)}</span>
                            {verified[s.id] ? <span className="text-ok">✓ word for word</span> : <span className="text-danger">not found</span>}
                          </summary>
                          <blockquote className="mt-2 rounded-xl border border-line bg-stone-50 p-3 text-sm leading-relaxed text-muted" data-testid="quote-context">
                            {context[s.id] ? (
                              <>
                                {context[s.id][0]}
                                <mark className="label-quote text-ink" data-testid="quote-highlight">
                                  {context[s.id][1]}
                                </mark>
                                {context[s.id][2]}
                              </>
                            ) : (
                              <span className="label-quote">{s.quote}</span>
                            )}
                            <footer className="mt-2 text-xs">
                              FDA label, {sectionTitle(s.section)} section, version {card.label.version ?? "?"} ({card.label.effective_date ?? "date unknown"}).
                            </footer>
                          </blockquote>
                        </details>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}

          {card.removed.length > 0 ? (
            <Card>
              <details data-testid="removed-sentences">
                <summary className="font-semibold">
                  {card.removed.length} sentence{card.removed.length === 1 ? "" : "s"} removed by the checker <span className="text-sm font-normal text-muted">(never shown on the card)</span>
                </summary>
                <ul className="mt-3 space-y-2 text-sm">
                  {card.removed.map((r) => (
                    <li key={r.id} className="rounded-lg bg-danger-soft p-2">
                      <span className="line-through">{r.text}</span>
                      <span className="block text-danger">Removed because {REASON_TEXT[r.reason] ?? r.reason}.</span>
                    </li>
                  ))}
                </ul>
              </details>
            </Card>
          ) : null}

          <Card>
            <details>
              <summary className="font-semibold">Edit this medicine or remake the card</summary>
              <div className="mt-4 space-y-4">
                <MedForm med={med} />
                <GenerationPanel label="Remake this card" medId={med.id} initiallyRunning={isGenerating()} />
              </div>
            </details>
          </Card>
        </>
      )}
    </div>
  );
}
