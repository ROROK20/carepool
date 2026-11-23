import Link from "next/link";
import { GenerationPanel } from "@/components/GenerationPanel";
import { Avatar, ButtonLink, Card, PageTitle, Pill, SectionTitle } from "@/components/ui";
import { shortDate } from "@/lib/circle/recurrence";
import { isGenerating } from "@/lib/jobs";
import { getRecipient } from "@/lib/repo";
import { dashboard, pharmacistQuestion, pickDate } from "@/lib/views";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const date = pickDate((await searchParams).date);
  const d = dashboard(date);
  const recipient = getRecipient();
  const ready = d.meds.filter((m) => d.cards.get(m.id)?.status === "ready").length;
  const doneToday = d.today.filter((t) => t.status === "done").length;
  const needsCover = d.today.filter((t) => t.status === "needs_cover").length;

  if (!recipient && d.meds.length === 0) {
    return (
      <div>
        <PageTitle title="Welcome to Carepool" kicker="Getting started">
          Add the medicines of the person you care for, exactly as their prescription labels say. Carepool fetches each FDA label and explains it in plain words.
        </PageTitle>
        <ButtonLink href="/meds">Add medicines</ButtonLink>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageTitle title={`${recipient?.name ?? "Your family"}'s care`} kicker={`Today, ${shortDate(date)}`}>
        {recipient?.age ? `${recipient.age} years old. ` : ""}
        {d.meds.length} medicine{d.meds.length === 1 ? "" : "s"}, {d.members.length} people helping.
      </PageTitle>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/meds" className="rounded-2xl border border-line bg-card p-4 shadow-sm hover:border-accent" data-testid="tile-meds">
          <p className="text-sm text-muted">Medicine cards</p>
          <p className="mt-1 text-3xl font-bold">
            {ready}
            <span className="text-lg font-semibold text-muted"> / {d.meds.length}</span>
          </p>
          <p className="text-sm text-muted">ready, every sentence quoted from the label</p>
        </Link>
        <Link href="/interactions" className="rounded-2xl border border-line bg-card p-4 shadow-sm hover:border-accent" data-testid="tile-flags">
          <p className="text-sm text-muted">Interaction flags</p>
          <p className={`mt-1 text-3xl font-bold ${d.flaggedPairs.length ? "text-warn" : ""}`}>{d.flaggedPairs.length}</p>
          <p className="text-sm text-muted">pairs the labels mention together</p>
        </Link>
        <Link href="/schedule" className="rounded-2xl border border-line bg-card p-4 shadow-sm hover:border-accent" data-testid="tile-schedule">
          <p className="text-sm text-muted">Dose times today</p>
          <p className="mt-1 text-3xl font-bold">{d.schedule.slots.length}</p>
          <p className="text-sm text-muted">from the times you entered</p>
        </Link>
        <Link href="/circle" className="rounded-2xl border border-line bg-card p-4 shadow-sm hover:border-accent" data-testid="tile-circle">
          <p className="text-sm text-muted">Care tasks today</p>
          <p className="mt-1 text-3xl font-bold">
            {doneToday}
            <span className="text-lg font-semibold text-muted"> / {d.today.length}</span>
          </p>
          <p className="text-sm text-muted">{needsCover ? `${needsCover} need${needsCover === 1 ? "s" : ""} someone to cover` : "done"}</p>
        </Link>
      </div>

      {ready < d.meds.length ? (
        <Card>
          <SectionTitle>Medicine cards</SectionTitle>
          <p className="mb-3 text-muted">
            Carepool fetches each medicine&apos;s FDA label, writes a plain-language card, and keeps only sentences that quote the label word for word.
          </p>
          <GenerationPanel initiallyRunning={isGenerating()} />
        </Card>
      ) : null}

      {d.flaggedPairs.length > 0 ? (
        <Card>
          <SectionTitle>Ask the pharmacist about</SectionTitle>
          <ul className="space-y-3">
            {d.flaggedPairs.map((p) => (
              <li key={p.key} className="flex flex-col gap-1 border-l-4 border-amber-400 pl-3" data-testid="pharmacist-question">
                <Link href={`/interactions#${p.key}`} className="font-semibold hover:text-accent">
                  {p.names[0]} + {p.names[1]}
                </Link>
                <span className="text-sm text-muted" data-testid="pharmacist-question-text">
                  {pharmacistQuestion(p).text}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <ButtonLink href="/sheet" variant="quiet">
              Print a sheet for the doctor visit
            </ButtonLink>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>Today&apos;s doses</SectionTitle>
          {d.schedule.slots.length === 0 ? (
            <p className="text-muted">No dose times entered yet.</p>
          ) : (
            <ol className="space-y-2">
              {d.schedule.slots.map((s) => (
                <li key={s.time} className="flex gap-3">
                  <span className="w-20 shrink-0 font-semibold">{s.label}</span>
                  <span className="text-muted">{s.items.map((i) => i.name).join(", ")}</span>
                </li>
              ))}
            </ol>
          )}
          <div className="mt-3">
            <ButtonLink href="/schedule" variant="quiet">
              Full schedule
            </ButtonLink>
          </div>
        </Card>
        <Card>
          <SectionTitle>Who is doing what today</SectionTitle>
          <ul className="space-y-3">
            {d.members.map((m) => {
              const mine = d.today.filter((t) => t.owner_id === m.id);
              const done = mine.filter((t) => t.status === "done").length;
              return (
                <li key={m.id} className="flex items-center gap-3">
                  <Avatar name={m.name} color={m.color} />
                  <Link href={`/today/${m.id}?date=${date}`} className="font-semibold hover:text-accent">
                    {m.name}
                  </Link>
                  <span className="text-sm text-muted">{m.relation}</span>
                  <span className="ml-auto">
                    <Pill kind={mine.length && done === mine.length ? "done" : "open"}>
                      {done} / {mine.length} done
                    </Pill>
                  </span>
                </li>
              );
            })}
          </ul>
          {needsCover ? <p className="mt-3 text-sm font-semibold text-warn">{needsCover} task(s) need someone to cover today.</p> : null}
        </Card>
      </div>
    </div>
  );
}
