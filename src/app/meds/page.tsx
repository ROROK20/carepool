import Link from "next/link";
import { deleteMedAction } from "@/app/actions";
import { GenerationPanel } from "@/components/GenerationPanel";
import { MedForm } from "@/components/MedForm";
import { PastePreview } from "@/components/PastePreview";
import { buttonClass, Card, PageTitle, Pill, SectionTitle } from "@/components/ui";
import { isGenerating } from "@/lib/jobs";
import { listCards, listMeds } from "@/lib/repo";
import { formatTime } from "@/lib/schedule/parse";

export const dynamic = "force-dynamic";

export default function MedsPage() {
  const meds = listMeds();
  const cards = listCards();
  const ready = meds.filter((m) => cards.get(m.id)?.status === "ready").length;
  return (
    <div className="space-y-6">
      <PageTitle title="Medicines" kicker="As you typed them">
        Type or paste each medicine exactly as the prescription label says. Carepool keeps your words for the dose and the times, and uses the name to find the FDA label.
      </PageTitle>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <SectionTitle>Medicine cards</SectionTitle>
            <p className="text-muted">
              {ready} of {meds.length} ready. Making a card fetches the FDA label, drafts plain sentences, and deletes any sentence whose quote is not in the label word for word.
            </p>
          </div>
          <GenerationPanel label={ready === meds.length && meds.length > 0 ? "Remake all cards" : "Make the medicine cards"} initiallyRunning={isGenerating()} />
        </div>
      </Card>

      <ul className="grid gap-4 md:grid-cols-2" data-testid="med-list">
        {meds.map((m) => {
          const c = cards.get(m.id);
          return (
            <li key={m.id}>
              <Card className="h-full">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-xl font-semibold">{m.name}</h2>
                  <Pill kind={c?.status ?? "none"}>{c?.status === "ready" ? "card ready" : (c?.status ?? "no card yet")}</Pill>
                </div>
                <dl className="mt-2 space-y-1 text-sm">
                  <div>
                    <dt className="inline font-semibold">Dose (as typed): </dt>
                    <dd className="inline" data-testid="typed-dose">
                      {m.dose || <span className="text-muted">not entered</span>}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline font-semibold">Times: </dt>
                    <dd className="inline">{m.times.length ? m.times.map(formatTime).join(", ") : <span className="text-warn">none entered</span>}</dd>
                  </div>
                  {m.notes ? (
                    <div>
                      <dt className="inline font-semibold">Notes: </dt>
                      <dd className="inline">{m.notes}</dd>
                    </div>
                  ) : null}
                  {c?.status === "failed" ? <p className="text-danger">Card failed: {c.error}</p> : null}
                  {c?.status === "running" || c?.status === "queued" ? <p className="text-muted">{c.step}</p> : null}
                </dl>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href={`/meds/${m.id}`} className={buttonClass.quiet}>
                    {c?.status === "ready" ? "Open card" : "Details"}
                  </Link>
                  <form action={deleteMedAction}>
                    <input type="hidden" name="id" value={m.id} />
                    <button type="submit" className={buttonClass.danger}>
                      Remove
                    </button>
                  </form>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>Add one medicine</SectionTitle>
          <MedForm />
        </Card>
        <Card>
          <SectionTitle>Paste a list</SectionTitle>
          <PastePreview />
        </Card>
      </div>
    </div>
  );
}
