import Link from "next/link";
import { notFound } from "next/navigation";
import { taskAction } from "@/app/actions";
import { Avatar, buttonClass, Card, PageTitle, Pill, SectionTitle } from "@/components/ui";
import { describeRecurrence, shortDate } from "@/lib/circle/recurrence";
import type { TodayTask } from "@/lib/circle/today";
import { getMember, type Member } from "@/lib/repo";
import { formatTime } from "@/lib/schedule/parse";
import { memberTodayView, pickDate } from "@/lib/views";

export const dynamic = "force-dynamic";

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function ActionButton({ task, date, member, action, label, primary }: { task: TodayTask; date: string; member: string; action: string; label: string; primary?: boolean }) {
  return (
    <form action={taskAction}>
      <input type="hidden" name="task_id" value={task.task.id} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="member_id" value={member} />
      <input type="hidden" name="action" value={action} />
      <button type="submit" className={primary ? buttonClass.primary : buttonClass.quiet}>
        {label}
      </button>
    </form>
  );
}

const STATUS_LABEL: Record<string, string> = { open: "to do", done: "done", needs_cover: "needs cover", covered: "covered" };

function TaskItem({ t, me, date, members, mode }: { t: TodayTask; me: Member; date: string; members: Map<string, Member>; mode: "mine" | "covering" | "grabs" }) {
  const assignee = t.task.assignee_id ? members.get(t.task.assignee_id) : undefined;
  const coverer = t.cover_member_id ? members.get(t.cover_member_id) : undefined;
  return (
    <li className="rounded-xl border border-line p-4" data-testid={`task-${t.task.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-lg font-semibold">{t.task.title}</p>
          <p className="text-sm text-muted">
            {t.task.time ? `${formatTime(t.task.time)} · ` : ""}
            {describeRecurrence(t.task.recurrence)}
            {mode === "grabs" && assignee ? ` · ${assignee.name} can't make it` : ""}
            {mode === "covering" && assignee ? ` · covering for ${assignee.name}` : ""}
            {mode === "mine" && coverer ? ` · ${coverer.name} is covering` : ""}
          </p>
        </div>
        <Pill kind={t.status}>{STATUS_LABEL[t.status]}</Pill>
      </div>
      {t.dose_items.length > 0 ? (
        <div className="mt-3 rounded-lg bg-accent-soft p-3 text-sm">
          <p className="font-semibold">Check these {t.task.slot ? formatTime(t.task.slot) : ""} doses (as typed on the Medicines page):</p>
          <ul className="mt-1 list-disc pl-5">
            {t.dose_items.map((i) => (
              <li key={i.med_id}>
                <span className="font-semibold">{i.name}</span>: {i.dose || "no dose entered"}
                {i.notes ? ` (${i.notes})` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {mode === "grabs" ? <ActionButton task={t} date={date} member={me.id} action="take" label="I'll take it" primary /> : null}
        {mode !== "grabs" && t.status !== "done" && t.status !== "needs_cover" && t.owner_id === me.id ? (
          <ActionButton task={t} date={date} member={me.id} action="done" label="Mark done" primary />
        ) : null}
        {mode === "mine" && t.status === "open" ? <ActionButton task={t} date={date} member={me.id} action="need_cover" label="I can't today" /> : null}
        {(t.status === "done" && t.done_by_id === me.id) || (mode === "mine" && t.status === "needs_cover") ? (
          <ActionButton task={t} date={date} member={me.id} action="undo" label="Undo" />
        ) : null}
      </div>
    </li>
  );
}

export default async function TodayPage({ params, searchParams }: { params: Promise<{ member: string }>; searchParams: Promise<{ date?: string }> }) {
  const { member } = await params;
  const me = getMember(member);
  if (!me) notFound();
  const date = pickDate((await searchParams).date);
  const { view, members } = memberTodayView(me.id, date);
  const byId = new Map(members.map((m) => [m.id, m]));
  const total = view.mine.length + view.covering.length;
  const done = [...view.mine, ...view.covering].filter((t) => t.status === "done").length;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={me.name} color={me.color} size="lg" />
        <PageTitle title={`Hi ${me.name}, here's your day`} kicker={shortDate(date)}>
          {total === 0 ? "Nothing assigned to you today." : `${done} of ${total} done.`}
        </PageTitle>
      </div>
      <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label="Day and person">
        <Link href={`/today/${me.id}?date=${addDays(date, -1)}`} className={buttonClass.quiet}>
          ← Previous day
        </Link>
        <Link href={`/today/${me.id}?date=${addDays(date, 1)}`} className={buttonClass.quiet}>
          Next day →
        </Link>
        <span className="ml-2 text-muted">Switch person:</span>
        {members
          .filter((m) => m.id !== me.id)
          .map((m) => (
            <Link key={m.id} href={`/today/${m.id}?date=${date}`} className="font-semibold text-accent hover:underline">
              {m.name}
            </Link>
          ))}
      </nav>

      {view.up_for_grabs.length > 0 ? (
        <Card className="border-amber-300 bg-warn-soft/40">
          <SectionTitle>Someone needs a hand</SectionTitle>
          <ul className="space-y-3" data-testid="up-for-grabs">
            {view.up_for_grabs.map((t) => (
              <TaskItem key={t.task.id} t={t} me={me} date={date} members={byId} mode="grabs" />
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <SectionTitle>Your jobs today</SectionTitle>
        {view.mine.length === 0 ? (
          <p className="text-muted">None today.</p>
        ) : (
          <ul className="space-y-3" data-testid="my-tasks">
            {view.mine.map((t) => (
              <TaskItem key={t.task.id} t={t} me={me} date={date} members={byId} mode="mine" />
            ))}
          </ul>
        )}
      </Card>

      {view.covering.length > 0 ? (
        <Card>
          <SectionTitle>You&apos;re covering</SectionTitle>
          <ul className="space-y-3" data-testid="covering">
            {view.covering.map((t) => (
              <TaskItem key={t.task.id} t={t} me={me} date={date} members={byId} mode="covering" />
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
