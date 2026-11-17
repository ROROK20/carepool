import { isVerbatim } from "./cards/citations";
import type { CardResult } from "./cards/pipeline";
import { localToday, isIsoDate } from "./circle/recurrence";
import { occurrences, todayFor, type TodayTask, type TodayView } from "./circle/today";
import { getEnv } from "./env";
import { findInteractions, toMatchingDrug, type InteractionFlag } from "./interactions/match";
import {
  getCard,
  getLabel,
  getMed,
  latestRun,
  listCards,
  listEvents,
  listExplanations,
  listLabels,
  listMeds,
  listMembers,
  listTasks,
  type CardRow,
  type Explanation,
  type Med,
  type Member,
  type StoredLabel,
} from "./repo";
import { buildSchedule, type Schedule } from "./schedule/build";

/**
 * View models for the pages. Every quote shown on screen is re-checked here
 * against the stored label section at render time; the "word for word" badge
 * is computed, not stored.
 */

export function providerName(): "claude-cli" | "mock" {
  return getEnv().CAREPOOL_PROVIDER;
}

export function pickDate(raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && isIsoDate(v) ? v : localToday();
}

export interface CardView {
  med: Med;
  row: CardRow | null;
  card: CardResult | null;
  label: StoredLabel | null;
  /** For each kept sentence id: is its quote verbatim in the stored section right now? */
  verified: Record<string, boolean>;
  /** Short context around each quote: [before, quote, after]. */
  context: Record<string, [string, string, string]>;
}

export function cardView(medId: string): CardView | null {
  const med = getMed(medId);
  if (!med) return null;
  const row = getCard(medId);
  const label = getLabel(medId);
  const card = row?.card ?? null;
  const verified: Record<string, boolean> = {};
  const context: CardView["context"] = {};
  for (const s of card?.sentences ?? []) {
    const text = label?.label.sections[s.section]?.text ?? "";
    verified[s.id] = isVerbatim(text, s.quote);
    const at = text.indexOf(s.quote);
    if (at >= 0) {
      const before = text.slice(Math.max(0, at - 220), at);
      const after = text.slice(at + s.quote.length, at + s.quote.length + 220);
      context[s.id] = [`${at > 220 ? "… " : ""}${before}`, s.quote, `${after}${at + s.quote.length + 220 < text.length ? " …" : ""}`];
    }
  }
  return { med, row, card, label, verified, context };
}

export interface FlagView extends InteractionFlag {
  a_name: string;
  b_name: string;
  label_date: string | null;
  label_version: string | null;
  dailymed_url: string;
  explanation: (Explanation & { verified: boolean }) | null;
}

export interface PairView {
  key: string;
  names: [string, string];
  flagged: boolean;
  flags: FlagView[];
}

export interface InteractionsView {
  pairs: PairView[];
  meds_without_label: Med[];
  checked_meds: number;
}

export function interactionsView(): InteractionsView {
  const meds = listMeds();
  const labels = listLabels();
  const explanations = listExplanations();
  const name = new Map(meds.map((m) => [m.id, m.name]));
  const withLabel = meds.filter((m) => labels.has(m.id));
  const drugs = withLabel.map((m) => toMatchingDrug(m.id, m.name, labels.get(m.id)!.label, labels.get(m.id)!.classes));
  const pairs = findInteractions(drugs).map((p) => ({
    key: p.pair.join("+"),
    names: [name.get(p.pair[0]) ?? p.pair[0], name.get(p.pair[1]) ?? p.pair[1]] as [string, string],
    flagged: p.flagged,
    flags: p.flags.map((f) => {
      const l = labels.get(f.a)!;
      const e = explanations.get(f.id);
      const sectionText = l.label.sections[f.section]?.text ?? "";
      return {
        ...f,
        a_name: name.get(f.a) ?? f.a,
        b_name: name.get(f.b) ?? f.b,
        label_date: l.label.effective_date,
        label_version: l.label.version,
        dailymed_url: `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${encodeURIComponent(l.label.set_id)}`,
        explanation: e ? { ...e, verified: isVerbatim(sectionText, e.quote) } : null,
      };
    }),
  }));
  return { pairs, meds_without_label: meds.filter((m) => !labels.has(m.id)), checked_meds: withLabel.length };
}

export function scheduleView(): { meds: Med[]; schedule: Schedule } {
  const meds = listMeds();
  return { meds, schedule: buildSchedule(meds) };
}

export function memberTodayView(memberId: string, date: string): { view: TodayView; members: Member[] } {
  const members = listMembers();
  const schedule = buildSchedule(listMeds());
  return { view: todayFor(memberId, listTasks(), listEvents(date), schedule, date), members };
}

export interface Dashboard {
  meds: Med[];
  cards: Map<string, CardRow>;
  schedule: Schedule;
  members: Member[];
  today: TodayTask[];
  date: string;
  flaggedPairs: PairView[];
  run: ReturnType<typeof latestRun>;
}

export function dashboard(date: string): Dashboard {
  const meds = listMeds();
  const schedule = buildSchedule(meds);
  return {
    meds,
    cards: listCards(),
    schedule,
    members: listMembers(),
    today: occurrences(listTasks(), listEvents(date), schedule, date),
    date,
    flaggedPairs: interactionsView().pairs.filter((p) => p.flagged),
    run: latestRun(),
  };
}
