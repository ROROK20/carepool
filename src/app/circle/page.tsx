import Link from "next/link";
import { deleteTaskAction, reassignTaskAction, removeMemberAction } from "@/app/actions";
import { AddMemberForm, AddTaskForm } from "@/components/CircleForms";
import { Avatar, buttonClass, Card, inputClass, PageTitle, SectionTitle } from "@/components/ui";
import { describeRecurrence, localToday } from "@/lib/circle/recurrence";
import { listMeds, listMembers, listTasks } from "@/lib/repo";
import { buildSchedule } from "@/lib/schedule/build";
import { formatTime } from "@/lib/schedule/parse";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = { dose_check: "Dose check", refill: "Refill", organizer: "Pill organizer", custom: "Task" };

export default function CirclePage() {
  const members = listMembers();
  const tasks = listTasks();
  const slots = buildSchedule(listMeds()).slots.map((s) => s.time);
  const today = localToday();
  const byId = new Map(members.map((m) => [m.id, m]));
  return (
    <div className="space-y-6">
      <PageTitle title="Care circle" kicker="Sharing the work">
        The people who help, and the recurring jobs that keep things running. Each person has a &ldquo;today&rdquo; page with just their jobs; if someone can&apos;t make it, the
        others see it and can take it.
      </PageTitle>

      <ul className="grid gap-4 sm:grid-cols-3" data-testid="members">
        {members.map((m) => {
          const count = tasks.filter((t) => t.assignee_id === m.id).length;
          return (
            <li key={m.id}>
              <Card className="h-full">
                <div className="flex items-center gap-3">
                  <Avatar name={m.name} color={m.color} size="lg" />
                  <div>
                    <p className="text-lg font-semibold">{m.name}</p>
                    <p className="text-sm text-muted">
                      {m.relation} · {count} recurring task{count === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href={`/today/${m.id}`} className={buttonClass.quiet} data-testid={`today-link-${m.name}`}>
                    {m.name}&apos;s today
                  </Link>
                  <form action={removeMemberAction}>
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

      <Card>
        <SectionTitle>Recurring tasks</SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="task-table">
            <thead className="text-xs uppercase text-muted">
              <tr>
                <th className="py-2 pr-3">Task</th>
                <th className="py-2 pr-3">When</th>
                <th className="py-2 pr-3">Who</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id} className="border-t border-line align-middle">
                  <td className="py-2 pr-3">
                    <span className="font-semibold">{t.title}</span>
                    <span className="block text-xs text-muted">
                      {KIND_LABEL[t.kind]}
                      {t.kind === "dose_check" && t.slot ? ` for the ${formatTime(t.slot)} doses` : ""}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    {describeRecurrence(t.recurrence)}
                    {t.time ? `, ${formatTime(t.time)}` : ""}
                  </td>
                  <td className="py-2 pr-3">
                    <form action={reassignTaskAction} className="flex items-center gap-2">
                      <input type="hidden" name="task_id" value={t.id} />
                      {t.assignee_id && byId.get(t.assignee_id) ? <Avatar name={byId.get(t.assignee_id)!.name} color={byId.get(t.assignee_id)!.color} size="sm" /> : null}
                      <select name="assignee_id" defaultValue={t.assignee_id ?? ""} className={`${inputClass} w-auto py-1 text-sm`} aria-label={`Who does ${t.title}`}>
                        {members.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                        <option value="">Nobody</option>
                      </select>
                      <button type="submit" className={buttonClass.quiet}>
                        Assign
                      </button>
                    </form>
                  </td>
                  <td className="py-2 text-right">
                    <form action={deleteTaskAction}>
                      <input type="hidden" name="task_id" value={t.id} />
                      <button type="submit" className={buttonClass.danger} aria-label={`Delete ${t.title}`}>
                        Delete
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>Add a task</SectionTitle>
          <AddTaskForm members={members.map((m) => ({ id: m.id, name: m.name }))} slots={slots} today={today} />
        </Card>
        <Card>
          <SectionTitle>Add someone</SectionTitle>
          <AddMemberForm />
        </Card>
      </div>
    </div>
  );
}
