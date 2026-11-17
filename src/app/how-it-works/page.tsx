import fs from "node:fs";
import path from "node:path";
import { Card, PageTitle, SectionTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

interface EvalSummary {
  generated_at: string;
  provider: string;
  models: string[];
  cards: { name: string; ok: boolean; stats: { generated: number; kept: number; passed_first_check: number; recovered_by_repair: number } | null; verbatim_raw: number }[];
  matcher_vs_truth: { tp: number; fp: number; fn: number; tn: number; precision: number; recall: number };
}

function readEval(): EvalSummary | null {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "eval", "results.json"), "utf8")) as EvalSummary;
  } catch {
    return null;
  }
}

const STEPS: { who: "code" | "model" | "you"; title: string; body: string }[] = [
  { who: "you", title: "You type the list", body: "Name, dose and times exactly as the prescription label says. Your dose and times are stored word for word." },
  { who: "code", title: "Fetch the FDA label", body: "openFDA's drug-label API (free, no key). The exact single-ingredient label is chosen, its version and date kept, and the response cached on disk." },
  { who: "model", title: "Draft the card", body: "Claude writes short plain sentences in four parts. Each sentence must name a label section and copy a quote from it." },
  { who: "code", title: "Check every sentence", body: "The quote must be in that section word for word; numbers must be in the quote; no dose or dosing frequency anywhere. Failures go back once, then are deleted." },
  { who: "model", title: "Review for clarity", body: "A second pass may only reword. Every reworded sentence is checked again; one that fails keeps its checked wording." },
  { who: "code", title: "Find interaction flags", body: "Each label's interaction and warning sections are searched for the other medicines' names and drug classes. Claude may explain a flag; it cannot create one." },
  { who: "code", title: "Build the schedule", body: "Only from the doses and times you typed. The label is never an input." },
];

const WHO: Record<string, string> = { code: "bg-accent text-white", model: "bg-violet-600 text-white", you: "bg-amber-500 text-white" };
const WHO_LABEL: Record<string, string> = { code: "Code (deterministic)", model: "Claude (model)", you: "You" };

export default function HowItWorks() {
  const ev = readEval();
  const ok = ev?.cards.filter((c) => c.ok && c.stats) ?? [];
  const kept = ok.reduce((a, c) => a + (c.stats?.kept ?? 0), 0);
  const generated = ok.reduce((a, c) => a + (c.stats?.generated ?? 0), 0);
  const verbatim = ok.reduce((a, c) => a + c.verbatim_raw, 0);
  return (
    <div className="space-y-6">
      <PageTitle title="How Carepool works" kicker="For judges and curious families">
        The model writes; code decides what you are allowed to see. Every sentence on a card carries the label&apos;s own words, and a program checks those words are really there.
      </PageTitle>

      <Card>
        <SectionTitle>The pipeline</SectionTitle>
        <ol className="space-y-3" data-testid="pipeline">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-stone-100 text-sm font-bold">{i + 1}</span>
              <div>
                <p className="font-semibold">
                  {s.title} <span className={`ml-1 rounded-full px-2 py-0.5 text-xs font-semibold ${WHO[s.who]}`}>{WHO_LABEL[s.who]}</span>
                </p>
                <p className="text-muted">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <Card>
        <SectionTitle>Measured, not promised</SectionTitle>
        {ev ? (
          <div className="grid gap-4 sm:grid-cols-3" data-testid="eval-summary">
            <div>
              <p className="text-3xl font-bold">
                {verbatim}/{kept}
              </p>
              <p className="text-sm text-muted">
                kept sentences whose quote was found word for word in the raw label ({ok.length} medicines, {generated} sentences drafted)
              </p>
            </div>
            <div>
              <p className="text-3xl font-bold">{Math.round(ev.matcher_vs_truth.precision * 100)}%</p>
              <p className="text-sm text-muted">
                precision of the interaction matcher on 10 hand-checked pairs ({ev.matcher_vs_truth.tp} right, {ev.matcher_vs_truth.fp} false alarm)
              </p>
            </div>
            <div>
              <p className="text-3xl font-bold">{Math.round(ev.matcher_vs_truth.recall * 100)}%</p>
              <p className="text-sm text-muted">recall on the same pairs ({ev.matcher_vs_truth.fn} missed)</p>
            </div>
            <p className="text-xs text-muted sm:col-span-3">
              From eval/results.md, run {ev.generated_at.slice(0, 10)} with {ev.provider === "mock" ? "the mock provider" : ev.models.join(" and ")}. Ten pairs is a seed, not a benchmark. Not
              measured yet: whether each plain sentence means exactly what its quote says, which is why the quote is always one click away.
            </p>
          </div>
        ) : (
          <p className="text-muted">No evaluation yet. Run npm run eval.</p>
        )}
      </Card>

      <Card>
        <SectionTitle>What Carepool will not do</SectionTitle>
        <ul className="list-disc space-y-1 pl-5">
          <li>Show a dose, or how often to take something, from the label. Doses come only from what you typed.</li>
          <li>Pick a time for you. A medicine with no time entered stays in &ldquo;no time entered&rdquo;.</li>
          <li>Tell anyone to start, stop or change a medicine.</li>
          <li>Let the model invent an interaction. Flags come from label text, found by code.</li>
          <li>Send anything anywhere. It runs on this computer; the only outside call is to the FDA label API.</li>
        </ul>
      </Card>

      <Card>
        <SectionTitle>AI disclosure</SectionTitle>
        <p className="text-muted">
          Card sentences and flag explanations are drafted by Anthropic&apos;s Claude, called through the Claude Code command-line tool on this computer (Sonnet writes, Opus reviews). The
          code was written with Claude Code. Parts of the citation checker and model plumbing are adapted from the author&apos;s earlier open-source project, Dispute Defender; the README lists
          each one.
        </p>
      </Card>
    </div>
  );
}
