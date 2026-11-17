import Link from "next/link";
import { Card, PageTitle, SectionTitle } from "@/components/ui";
import { scheduleView } from "@/lib/views";

export const dynamic = "force-dynamic";

export default function SchedulePage() {
  const { schedule } = scheduleView();
  return (
    <div className="space-y-6">
      <PageTitle title="Daily schedule" kicker="Built only from what you typed">
        Every dose and every time below is copied from what you entered on the Medicines page. Carepool never adds a dose, changes one, or picks a time; if something is missing, it
        says so instead.
      </PageTitle>

      {schedule.slots.length === 0 && schedule.unscheduled.length === 0 ? (
        <Card>
          <p>
            No medicines yet.{" "}
            <Link href="/meds" className="font-semibold text-accent underline">
              Add them
            </Link>
            .
          </p>
        </Card>
      ) : null}

      <ol className="space-y-4" data-testid="schedule">
        {schedule.slots.map((slot) => (
          <li key={slot.time}>
            <Card>
              <SectionTitle>{slot.label}</SectionTitle>
              <ul className="divide-y divide-line">
                {slot.items.map((i) => (
                  <li key={i.med_id} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:gap-4" data-testid="schedule-item">
                    <Link href={`/meds/${i.med_id}`} className="w-40 shrink-0 font-semibold hover:text-accent">
                      {i.name}
                    </Link>
                    <span data-testid="schedule-dose">{i.dose || <span className="text-warn">No dose entered. Check the prescription label.</span>}</span>
                    {i.notes ? <span className="text-sm text-muted">({i.notes})</span> : null}
                  </li>
                ))}
              </ul>
            </Card>
          </li>
        ))}
      </ol>

      {schedule.unscheduled.length > 0 ? (
        <Card className="border-amber-300">
          <SectionTitle>No time entered</SectionTitle>
          <p className="mb-2 text-sm text-muted">These are not on the schedule because no clock time was entered. Add the times from the prescription.</p>
          <ul className="space-y-1" data-testid="unscheduled">
            {schedule.unscheduled.map((i) => (
              <li key={i.med_id}>
                <Link href={`/meds/${i.med_id}`} className="font-semibold hover:text-accent">
                  {i.name}
                </Link>{" "}
                <span className="text-muted">{i.dose}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
