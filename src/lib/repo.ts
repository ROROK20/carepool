import { randomUUID } from "node:crypto";
import type { CardResult } from "./cards/pipeline";
import { RecurrenceSchema, type Recurrence } from "./circle/recurrence";
import type { TaskEvent, TaskKind, TaskRow } from "./circle/today";
import { getDb, nowIso, parseJson, tx } from "./db";
import type { ResolvedLabel } from "./labels/openfda";
import type { MedEntry } from "./schedule/build";

/** Data access. Plain SQL over better-sqlite3; every function is synchronous. */

export interface Recipient {
  name: string;
  age: number | null;
  fictional: boolean;
  notice: string | null;
}

export interface Med extends MedEntry {
  position: number;
  created_at: string;
}

/** A resolved label as stored: everything but the raw openFDA object (that stays in the cache file). */
export type StoredLabel = Omit<ResolvedLabel, "raw">;

export type CardStatus = "queued" | "running" | "ready" | "failed";

export interface CardRow {
  med_id: string;
  status: CardStatus;
  step: string | null;
  card: CardResult | null;
  error: string | null;
  updated_at: string;
}

export interface Explanation {
  flag_id: string;
  text: string;
  quote: string;
  model: string | null;
  provider: string;
}

export interface Run {
  id: string;
  status: "running" | "done" | "failed";
  provider: string;
  started_at: string;
  finished_at: string | null;
  note: string | null;
}

export interface Member {
  id: string;
  name: string;
  relation: string;
  color: string;
  position: number;
}

export function slugId(prefix: string, name: string, unique = true): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "x";
  return unique ? `${prefix}-${base}-${randomUUID().slice(0, 6)}` : `${prefix}-${base}`;
}

// ── recipient ────────────────────────────────────────────────────────

export function getRecipient(): Recipient | null {
  const r = getDb().prepare("SELECT name, age, fictional, notice FROM recipient WHERE id = 1").get() as
    | { name: string; age: number | null; fictional: number; notice: string | null }
    | undefined;
  return r ? { name: r.name, age: r.age, fictional: r.fictional === 1, notice: r.notice } : null;
}

export function setRecipient(r: Recipient): void {
  getDb()
    .prepare(
      "INSERT INTO recipient (id, name, age, fictional, notice) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, age = excluded.age, fictional = excluded.fictional, notice = excluded.notice",
    )
    .run(r.name, r.age, r.fictional ? 1 : 0, r.notice);
}

// ── medicines ────────────────────────────────────────────────────────

interface MedDbRow {
  id: string;
  name: string;
  dose: string;
  times_json: string;
  notes: string;
  position: number;
  created_at: string;
}

const toMed = (r: MedDbRow): Med => ({
  id: r.id,
  name: r.name,
  dose: r.dose,
  times: parseJson<string[]>(r.times_json, []),
  notes: r.notes,
  position: r.position,
  created_at: r.created_at,
});

export function listMeds(): Med[] {
  return (getDb().prepare("SELECT * FROM meds ORDER BY position, created_at").all() as MedDbRow[]).map(toMed);
}

export function getMed(id: string): Med | null {
  const r = getDb().prepare("SELECT * FROM meds WHERE id = ?").get(id) as MedDbRow | undefined;
  return r ? toMed(r) : null;
}

export function createMed(m: { id?: string; name: string; dose: string; times: string[]; notes?: string }): string {
  const id = m.id ?? slugId("med", m.name);
  const db = getDb();
  const pos = (db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM meds").get() as { p: number }).p;
  db.prepare("INSERT INTO meds (id, name, dose, times_json, notes, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    id,
    m.name,
    m.dose,
    JSON.stringify(m.times),
    m.notes ?? "",
    pos,
    nowIso(),
  );
  return id;
}

/** Update what the family typed. A new name means a different medicine: its label and card are dropped. */
export function updateMed(id: string, m: { name: string; dose: string; times: string[]; notes: string }): void {
  tx((db) => {
    const before = getMed(id);
    if (!before) throw new Error("Medicine not found.");
    db.prepare("UPDATE meds SET name = ?, dose = ?, times_json = ?, notes = ? WHERE id = ?").run(m.name, m.dose, JSON.stringify(m.times), m.notes, id);
    if (before.name.trim().toLowerCase() !== m.name.trim().toLowerCase()) {
      db.prepare("DELETE FROM labels WHERE med_id = ?").run(id);
      db.prepare("DELETE FROM cards WHERE med_id = ?").run(id);
    }
  });
}

export function deleteMed(id: string): void {
  getDb().prepare("DELETE FROM meds WHERE id = ?").run(id);
}

// ── labels ───────────────────────────────────────────────────────────

export function saveLabel(medId: string, resolved: ResolvedLabel): void {
  const { raw: _raw, ...stored } = resolved;
  getDb()
    .prepare(
      "INSERT INTO labels (med_id, query, resolved_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(med_id) DO UPDATE SET query = excluded.query, resolved_json = excluded.resolved_json, updated_at = excluded.updated_at",
    )
    .run(medId, resolved.query, JSON.stringify(stored), nowIso());
}

export function getLabel(medId: string): StoredLabel | null {
  const r = getDb().prepare("SELECT resolved_json FROM labels WHERE med_id = ?").get(medId) as { resolved_json: string } | undefined;
  return r ? parseJson<StoredLabel | null>(r.resolved_json, null) : null;
}

export function listLabels(): Map<string, StoredLabel> {
  const rows = getDb().prepare("SELECT med_id, resolved_json FROM labels").all() as { med_id: string; resolved_json: string }[];
  const out = new Map<string, StoredLabel>();
  for (const r of rows) {
    const l = parseJson<StoredLabel | null>(r.resolved_json, null);
    if (l) out.set(r.med_id, l);
  }
  return out;
}

// ── cards ────────────────────────────────────────────────────────────

interface CardDbRow {
  med_id: string;
  status: CardStatus;
  step: string | null;
  card_json: string | null;
  error: string | null;
  updated_at: string;
}

const toCard = (r: CardDbRow): CardRow => ({
  med_id: r.med_id,
  status: r.status,
  step: r.step,
  card: parseJson<CardResult | null>(r.card_json, null),
  error: r.error,
  updated_at: r.updated_at,
});

export function setCardStatus(medId: string, status: "queued" | "running", step: string | null = null): void {
  getDb()
    .prepare(
      "INSERT INTO cards (med_id, status, step, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(med_id) DO UPDATE SET status = excluded.status, step = excluded.step, error = NULL, updated_at = excluded.updated_at",
    )
    .run(medId, status, step, nowIso());
}

export function saveCard(medId: string, card: CardResult): void {
  getDb()
    .prepare(
      "INSERT INTO cards (med_id, status, step, card_json, error, updated_at) VALUES (?, 'ready', NULL, ?, NULL, ?) ON CONFLICT(med_id) DO UPDATE SET status = 'ready', step = NULL, card_json = excluded.card_json, error = NULL, updated_at = excluded.updated_at",
    )
    .run(medId, JSON.stringify(card), nowIso());
}

export function failCard(medId: string, error: string): void {
  getDb()
    .prepare(
      "INSERT INTO cards (med_id, status, error, updated_at) VALUES (?, 'failed', ?, ?) ON CONFLICT(med_id) DO UPDATE SET status = 'failed', step = NULL, error = excluded.error, updated_at = excluded.updated_at",
    )
    .run(medId, error, nowIso());
}

export function getCard(medId: string): CardRow | null {
  const r = getDb().prepare("SELECT * FROM cards WHERE med_id = ?").get(medId) as CardDbRow | undefined;
  return r ? toCard(r) : null;
}

export function listCards(): Map<string, CardRow> {
  const rows = getDb().prepare("SELECT * FROM cards").all() as CardDbRow[];
  return new Map(rows.map((r) => [r.med_id, toCard(r)]));
}

// ── explanations ─────────────────────────────────────────────────────

export function replaceExplanations(list: Omit<Explanation, "provider">[], provider: string): void {
  tx((db) => {
    db.prepare("DELETE FROM explanations").run();
    const ins = db.prepare("INSERT INTO explanations (flag_id, text, quote, model, provider, created_at) VALUES (?, ?, ?, ?, ?, ?)");
    for (const e of list) ins.run(e.flag_id, e.text, e.quote, e.model, provider, nowIso());
  });
}

export function listExplanations(): Map<string, Explanation> {
  const rows = getDb().prepare("SELECT flag_id, text, quote, model, provider FROM explanations").all() as Explanation[];
  return new Map(rows.map((r) => [r.flag_id, r]));
}

// ── runs ─────────────────────────────────────────────────────────────

export function startRun(provider: string): string {
  const id = `run-${randomUUID().slice(0, 8)}`;
  getDb().prepare("INSERT INTO runs (id, status, provider, started_at) VALUES (?, 'running', ?, ?)").run(id, provider, nowIso());
  return id;
}

export function finishRun(id: string, status: "done" | "failed", note: string | null): void {
  getDb().prepare("UPDATE runs SET status = ?, finished_at = ?, note = ? WHERE id = ?").run(status, nowIso(), note, id);
}

export function latestRun(): Run | null {
  return (getDb().prepare("SELECT * FROM runs ORDER BY started_at DESC LIMIT 1").get() as Run | undefined) ?? null;
}

/** A run left "running" by a process that stopped (dev server restart) is closed as failed. */
export function closeStaleRuns(): void {
  getDb().prepare("UPDATE runs SET status = 'failed', finished_at = ?, note = 'Interrupted (the server restarted).' WHERE status = 'running'").run(nowIso());
  getDb().prepare("UPDATE cards SET status = 'failed', error = 'Interrupted (the server restarted). Generate again.' WHERE status IN ('queued', 'running')").run();
}

// ── care circle ──────────────────────────────────────────────────────

export function listMembers(): Member[] {
  return getDb().prepare("SELECT * FROM members ORDER BY position").all() as Member[];
}

export function getMember(id: string): Member | null {
  return (getDb().prepare("SELECT * FROM members WHERE id = ?").get(id) as Member | undefined) ?? null;
}

export function createMember(m: { id?: string; name: string; relation: string; color: string }): string {
  const id = m.id ?? slugId("member", m.name);
  const db = getDb();
  const pos = (db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM members").get() as { p: number }).p;
  db.prepare("INSERT INTO members (id, name, relation, color, position) VALUES (?, ?, ?, ?, ?)").run(id, m.name, m.relation, m.color, pos);
  return id;
}

export function deleteMember(id: string): void {
  getDb().prepare("DELETE FROM members WHERE id = ?").run(id);
}

interface TaskDbRow {
  id: string;
  title: string;
  kind: TaskKind;
  slot: string | null;
  time: string | null;
  assignee_id: string | null;
  recurrence_json: string;
}

export function listTasks(): TaskRow[] {
  const rows = getDb().prepare("SELECT * FROM tasks ORDER BY COALESCE(time, '99:99'), title").all() as TaskDbRow[];
  return rows.flatMap((r) => {
    const rec = RecurrenceSchema.safeParse(parseJson<unknown>(r.recurrence_json, null));
    return rec.success ? [{ id: r.id, title: r.title, kind: r.kind, slot: r.slot, time: r.time, assignee_id: r.assignee_id, recurrence: rec.data }] : [];
  });
}

export function createTask(t: { id?: string; title: string; kind: TaskKind; slot: string | null; time: string | null; assignee_id: string | null; recurrence: Recurrence }): string {
  const id = t.id ?? slugId("task", t.title);
  getDb()
    .prepare("INSERT INTO tasks (id, title, kind, slot, time, assignee_id, recurrence_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, t.title, t.kind, t.slot, t.time, t.assignee_id, JSON.stringify(RecurrenceSchema.parse(t.recurrence)), nowIso());
  return id;
}

export function setTaskAssignee(taskId: string, memberId: string | null): void {
  getDb().prepare("UPDATE tasks SET assignee_id = ? WHERE id = ?").run(memberId, taskId);
}

export function deleteTask(id: string): void {
  getDb().prepare("DELETE FROM tasks WHERE id = ?").run(id);
}

export function listEvents(date: string): TaskEvent[] {
  return getDb().prepare("SELECT task_id, date, status, by_member_id, cover_member_id FROM task_events WHERE date = ?").all(date) as TaskEvent[];
}

export function setEvent(taskId: string, date: string, e: Omit<TaskEvent, "task_id" | "date">): void {
  getDb()
    .prepare(
      "INSERT INTO task_events (task_id, date, status, by_member_id, cover_member_id, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(task_id, date) DO UPDATE SET status = excluded.status, by_member_id = excluded.by_member_id, cover_member_id = excluded.cover_member_id, updated_at = excluded.updated_at",
    )
    .run(taskId, date, e.status, e.by_member_id, e.cover_member_id, nowIso());
}

export function clearEvent(taskId: string, date: string): void {
  getDb().prepare("DELETE FROM task_events WHERE task_id = ? AND date = ?").run(taskId, date);
}

/** Wipe everything (setup --reset). */
export function resetAll(): void {
  tx((db) => {
    for (const t of ["task_events", "tasks", "members", "explanations", "cards", "labels", "runs", "meds", "recipient"]) db.prepare(`DELETE FROM ${t}`).run();
  });
}
