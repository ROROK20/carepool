import { resolveLabel, type ResolvedLabel } from "../labels/openfda";
import { dailyMedUrl } from "../labels/parse";
import { CARD_PARTS } from "../labels/sections";
import type { Provider, ProviderName } from "../model";
import type { ModelResponse } from "../model/types";
import { checkCardSentences, checkSentence, isVerbatim, type CardFailure, type CardFailureReason, type CardSentence } from "./citations";
import { judgeSentences, type Verdict } from "./judge";
import {
  REPAIR_SYSTEM,
  REVIEW_SYSTEM,
  WRITER_SYSTEM,
  cardSections,
  repairPrompt,
  reviewPrompt,
  writerPrompt,
} from "./prompts";
import {
  REPAIR_JSON_SCHEMA,
  REVIEW_JSON_SCHEMA,
  RepairOutputSchema,
  ReviewOutputSchema,
  WRITER_JSON_SCHEMA,
  WriterOutputSchema,
  formatZodIssues,
} from "./schemas";

/**
 * One drug card, end to end:
 *
 *   label  → openFDA (or the cache) gives the label and its sections
 *   write  → the model drafts sentences, each with {part, text, section, quote}
 *   check  → the deterministic checker keeps only grounded sentences
 *   repair → failed sentences go back to the model once (configurable), then re-checked
 *   review → a second model call may only reword; each reworded sentence is
 *            re-checked, and one that fails keeps its checked wording
 *   gate   → the meaning gate: a separate model call reads each kept sentence
 *            next to its quote, and only the quote. SUPPORTED stays.
 *            PARTIAL (the sentence adds a claim, cause or condition) goes
 *            back for one rewrite with the gate's reason, must pass the
 *            citation checker again, and is judged again; still not
 *            supported means removed. UNSUPPORTED is removed.
 *
 * Adapted from Dispute Defender's `runner.ts` (`checkAndRepair`) and
 * `review.ts` (same author, MIT). Changes: one structured call per stage
 * instead of a tool loop, and the review is accepted or reverted per sentence
 * instead of all-or-nothing, so one bad rewording does not discard the rest.
 * Every kept sentence has passed the checker; there is no path around it.
 */

export interface CardLabelInfo {
  query: string;
  matched_by: "generic" | "brand";
  term: string;
  id: string;
  set_id: string;
  version: string | null;
  effective_time: string | null;
  effective_date: string | null;
  generic_names: string[];
  brand_names: string[];
  manufacturer: string | null;
  classes: string[];
  class_source: "label" | "ndc" | "none";
  /** Release form of the label, what the family's entry asked for, and whether they differ. */
  formulation: "extended" | "delayed" | "immediate";
  formulation_wanted: "extended" | null;
  formulation_mismatch: boolean;
  routes: string[];
  route_mismatch: boolean;
  dailymed_url: string;
  cache_files: string[];
  fetched_at: string;
}

export interface GateResult {
  status: "applied" | "disabled" | "skipped" | "failed";
  model: string | null;
  /** Sentences that reached the gate (kept by the citation checker, after review). */
  checked: number;
  /** The gate's first verdicts on those sentences. */
  first: Record<Verdict | "unjudged", number>;
  /** PARTIAL sentences rewritten once, re-checked, and then judged supported. */
  repaired: number;
  removed: { partial: number; unsupported: number; unchecked: number };
  note: string | null;
}

export interface CardResult {
  med_key: string;
  typed_name: string;
  label: CardLabelInfo;
  /** Kept sentences, in part order. Every one passed the checker. */
  sentences: CardSentence[];
  /** Sentences the checker or the meaning gate removed (after any repair), with the reason. */
  removed: CardFailure[];
  /** The meaning gate. Absent on cards made before it existed. */
  gate?: GateResult;
  review: {
    status: "applied" | "unchanged" | "failed" | "disabled" | "skipped";
    changed: number;
    reverted: number;
    reverted_ids: string[];
    note: string | null;
  };
  stats: {
    generated: number;
    passed_first_check: number;
    /** Why sentences failed the first check (before any repair), by reason. */
    first_check_failures: Partial<Record<CardFailure["reason"], number>>;
    recovered_by_repair: number;
    repair_rounds: number;
    kept: number;
    verbatim_kept: number;
  };
  provider: ProviderName;
  models: { writer: string | null; repair: string | null; review: string | null; gate?: string | null };
  usage: { input_tokens: number; output_tokens: number };
  timings_ms: { label: number; write: number; repair: number; review: number; gate?: number; total: number };
  generated_at: string;
}

export interface BuildCardOptions {
  provider: Provider;
  reviewEnabled: boolean;
  maxRepairRounds: number;
  /** Run the meaning gate (MEANING_GATE_ENABLED). Off unless asked for, so a caller always chooses. */
  meaningGate?: boolean;
  /** Eval seam: the sentences as they reach the meaning gate, before it changes anything. */
  onBeforeGate?: (sentences: CardSentence[]) => void;
  /** Test seam: supply the label (production resolves through openFDA and the cache). */
  resolve?: (query: string, opts?: { formulationText?: string }) => Promise<ResolvedLabel>;
  onStep?: (step: string) => void;
}

function labelInfo(r: ResolvedLabel): CardLabelInfo {
  const l = r.label;
  return {
    query: r.query,
    matched_by: r.matched_by,
    term: r.term,
    id: l.id,
    set_id: l.set_id,
    version: l.version,
    effective_time: l.effective_time,
    effective_date: l.effective_date,
    generic_names: l.generic_names,
    brand_names: l.brand_names,
    manufacturer: l.manufacturer,
    classes: r.classes,
    class_source: r.class_source,
    formulation: l.formulation,
    formulation_wanted: r.formulation_wanted,
    formulation_mismatch: r.formulation_mismatch,
    routes: l.routes,
    route_mismatch: r.route_mismatch,
    dailymed_url: dailyMedUrl(l.set_id),
    cache_files: r.cache_files,
    fetched_at: r.fetched_at,
  };
}

export function labelTitle(info: Pick<CardLabelInfo, "generic_names" | "brand_names" | "manufacturer" | "term">): string {
  const name = info.brand_names[0] ?? info.generic_names[0] ?? info.term;
  return info.manufacturer ? `${name} (${info.manufacturer})` : name;
}

const partIndex = (s: CardSentence) => CARD_PARTS.indexOf(s.part);
const idNumber = (s: CardSentence) => Number(s.id.replace(/\D/g, "")) || 0;

function sortSentences(list: CardSentence[]): CardSentence[] {
  return [...list].sort((a, b) => partIndex(a) - partIndex(b) || idNumber(a) - idNumber(b));
}

function meaningFailure(s: CardSentence, reason: CardFailureReason, detail: string): CardFailure {
  return { id: s.id, part: s.part, text: s.text, section: s.section, quote: s.quote, reason, detail };
}

function oneLine(text: string, max = 300): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export async function buildCard(
  input: { medKey: string; typedName: string; typedDose?: string },
  opts: BuildCardOptions,
): Promise<{ card: CardResult; resolved: ResolvedLabel }> {
  const { provider } = opts;
  const step = opts.onStep ?? (() => {});
  const usage = { input_tokens: 0, output_tokens: 0 };
  const models: CardResult["models"] = { writer: null, repair: null, review: null, gate: null };
  const timings = { label: 0, write: 0, repair: 0, review: 0, gate: 0, total: 0 };
  const t0 = Date.now();
  const tally = (r: Pick<ModelResponse, "usage">) => {
    usage.input_tokens += r.usage.input_tokens;
    usage.output_tokens += r.usage.output_tokens;
  };

  step("Fetching the FDA label");
  let t = Date.now();
  const resolved = await (opts.resolve ?? resolveLabel)(input.typedName, { formulationText: input.typedDose ?? "" });
  timings.label = Date.now() - t;
  const info = labelInfo(resolved);
  const sections = resolved.label.sections;

  step("Writing the card");
  t = Date.now();
  const written = await provider.model({
    role: "writer",
    system: WRITER_SYSTEM,
    prompt: writerPrompt({
      typedName: input.typedName,
      labelTitle: labelTitle(info),
      effectiveDate: info.effective_date,
      version: info.version,
      sections: cardSections(sections),
    }),
    schema: WRITER_JSON_SCHEMA,
    context: { role: "writer", drug: input.typedName, sections },
  });
  timings.write = Date.now() - t;
  tally(written);
  models.writer = written.model;
  const parsed = WriterOutputSchema.safeParse(written.output);
  if (!parsed.success) throw new Error(`The card writer's answer did not match the schema:\n${formatZodIssues(parsed.error)}`);
  const draft: CardSentence[] = parsed.data.sentences.map((s, i) => ({ id: `s${i + 1}`, ...s }));
  const duplicates: CardFailure[] = [];

  step("Checking every quote against the label");
  const check = checkCardSentences(draft, sections);
  const passedFirst = check.passed.length;
  const firstFailures: CardResult["stats"]["first_check_failures"] = {};
  for (const f of check.failed) firstFailures[f.reason] = (firstFailures[f.reason] ?? 0) + 1;
  let kept = check.passed;
  let failed = check.failed;

  let rounds = 0;
  t = Date.now();
  while (failed.length > 0 && rounds < opts.maxRepairRounds) {
    rounds++;
    step(`Repairing ${failed.length} sentence(s) the checker rejected`);
    const res = await provider.model({
      role: "repair",
      system: REPAIR_SYSTEM,
      prompt: repairPrompt(failed, sections),
      schema: REPAIR_JSON_SCHEMA,
      context: { role: "repair" },
    });
    tally(res);
    models.repair = res.model;
    const rep = RepairOutputSchema.safeParse(res.output);
    const failedIds = new Set(failed.map((f) => f.id));
    const revised = rep.success ? rep.data.sentences.filter((s) => failedIds.has(s.id)) : [];
    const recheck = checkCardSentences(revised, sections);
    const recovered = new Set(recheck.passed.map((s) => s.id));
    kept = [...kept, ...recheck.passed];
    // A sentence the repair dropped or could not fix stays failed with its latest reason.
    const latest = new Map(recheck.failed.map((f) => [f.id, f]));
    failed = failed.filter((f) => !recovered.has(f.id)).map((f) => latest.get(f.id) ?? f);
  }
  timings.repair = Date.now() - t;
  const recoveredByRepair = kept.length - passedFirst;

  // Two sentences citing the same words say the same thing twice: keep the first.
  const seenQuotes = new Set<string>();
  kept = sortSentences(kept).filter((s) => {
    const key = `${s.section}\u0000${s.quote}`;
    if (!seenQuotes.has(key)) {
      seenQuotes.add(key);
      return true;
    }
    duplicates.push({ id: s.id, part: s.part, text: s.text, section: s.section, quote: s.quote, reason: "DUPLICATE_QUOTE", detail: "Another sentence on this card already cites the same words." });
    return false;
  });

  const review: CardResult["review"] = { status: "disabled", changed: 0, reverted: 0, reverted_ids: [], note: null };
  if (opts.reviewEnabled && kept.length > 0) {
    step("Review pass: rewording for clarity, then re-checking");
    t = Date.now();
    try {
      const res = await provider.model({
        role: "review",
        system: REVIEW_SYSTEM,
        prompt: reviewPrompt(sortSentences(kept)),
        schema: REVIEW_JSON_SCHEMA,
        context: { role: "review", sentences: kept.map((s) => ({ id: s.id, text: s.text })) },
      });
      tally(res);
      models.review = res.model;
      const rv = ReviewOutputSchema.safeParse(res.output);
      if (!rv.success) {
        review.status = "failed";
        review.note = "The reviewer's answer did not match the schema; the checked wording is kept.";
      } else {
        const byId = new Map(rv.data.sentences.map((s) => [s.id, s.text]));
        kept = kept.map((s) => {
          const reworded = byId.get(s.id);
          if (!reworded || reworded === s.text) return s;
          const r = checkSentence({ ...s, text: reworded }, sections);
          if (r.ok) {
            review.changed++;
            return r.sentence;
          }
          review.reverted++;
          review.reverted_ids.push(s.id);
          return s;
        });
        review.status = review.changed > 0 ? "applied" : "unchanged";
      }
    } catch (err) {
      review.status = "failed";
      review.note = `The review call failed (${(err as Error).message.slice(0, 160)}); the checked wording is kept.`;
    }
    timings.review = Date.now() - t;
  } else if (opts.reviewEnabled) {
    review.status = "skipped";
  }

  const gate: GateResult = {
    status: opts.meaningGate ? "skipped" : "disabled",
    model: null,
    checked: 0,
    first: { supported: 0, partial: 0, unsupported: 0, unjudged: 0 },
    repaired: 0,
    removed: { partial: 0, unsupported: 0, unchecked: 0 },
    note: null,
  };
  const gateRemoved: CardFailure[] = [];
  if (opts.meaningGate && kept.length > 0) {
    step("Meaning check: does each sentence say only what its quote says?");
    t = Date.now();
    const before = sortSentences(kept);
    opts.onBeforeGate?.(before);
    gate.checked = before.length;
    try {
      const first = await judgeSentences(before, provider, "gate");
      tally(first);
      models.gate = first.model;
      gate.model = first.model;
      const pass: CardSentence[] = [];
      /** Sentences that get a second judgment: PARTIAL ones after a rewrite, and ones the gate skipped. */
      const retry: { s: CardSentence; why: string | null }[] = [];
      for (const s of before) {
        const v = first.verdicts.get(s.id);
        if (!v) {
          gate.first.unjudged++;
          retry.push({ s, why: null });
          continue;
        }
        gate.first[v.verdict]++;
        if (v.verdict === "supported") pass.push(s);
        else if (v.verdict === "unsupported") gateRemoved.push(meaningFailure(s, "MEANING_UNSUPPORTED", oneLine(v.reason || "Its quote does not say this.")));
        else retry.push({ s, why: oneLine(v.reason || "It says more than its quote.") });
      }

      const partials = retry.filter((r): r is { s: CardSentence; why: string } => r.why !== null);
      const revised = new Map<string, CardSentence>();
      if (partials.length > 0 && opts.maxRepairRounds > 0) {
        step(`Rewriting ${partials.length} sentence(s) that said more than their quote`);
        try {
          const res = await provider.model({
            role: "repair",
            system: REPAIR_SYSTEM,
            prompt: repairPrompt(
              partials.map((r) =>
                meaningFailure(
                  r.s,
                  "MEANING_PARTIAL",
                  `A meaning check found the sentence says more than its quote: ${r.why} Rewrite it so it says only what its quote says, or cite a quote that states it, or leave it out.`,
                ),
              ),
              sections,
            ),
            schema: REPAIR_JSON_SCHEMA,
            context: { role: "repair" },
          });
          tally(res);
          models.repair = models.repair ?? res.model;
          const rep = RepairOutputSchema.safeParse(res.output);
          const ids = new Set(partials.map((r) => r.s.id));
          const out = rep.success ? rep.data.sentences.filter((x) => ids.has(x.id)) : [];
          for (const x of checkCardSentences(out, sections).passed) if (!revised.has(x.id)) revised.set(x.id, x);
        } catch {
          // A failed rewrite call leaves the PARTIAL sentences unrepaired; they are removed below.
        }
      }

      const second = retry.flatMap((r) => (r.why === null ? [r.s] : revised.has(r.s.id) ? [revised.get(r.s.id)!] : []));
      let secondVerdicts = new Map<string, { verdict: Verdict; reason: string }>();
      if (second.length > 0) {
        try {
          const j2 = await judgeSentences(second, provider, "gate");
          tally(j2);
          secondVerdicts = j2.verdicts;
        } catch {
          // No second verdict: those sentences are removed below as not checked or still partial.
        }
      }
      for (const r of retry) {
        const candidate = r.why === null ? r.s : revised.get(r.s.id);
        const v = candidate ? secondVerdicts.get(candidate.id) : undefined;
        if (candidate && v?.verdict === "supported") {
          pass.push(candidate);
          if (r.why !== null) gate.repaired++;
          continue;
        }
        if (v?.verdict === "unsupported") gateRemoved.push(meaningFailure(r.s, "MEANING_UNSUPPORTED", oneLine(v.reason || "Its quote does not say this.")));
        else if (v?.verdict === "partial") gateRemoved.push(meaningFailure(r.s, "MEANING_PARTIAL", oneLine(v.reason || r.why || "It says more than its quote.")));
        else if (r.why !== null) gateRemoved.push(meaningFailure(r.s, "MEANING_PARTIAL", r.why));
        else gateRemoved.push(meaningFailure(r.s, "MEANING_UNCHECKED", "The meaning check gave no verdict for this sentence, twice."));
      }

      // A rewrite may now cite words another kept sentence already cites.
      const quotes = new Set<string>();
      kept = sortSentences(pass).filter((s) => {
        const key = `${s.section}\u0000${s.quote}`;
        if (!quotes.has(key)) {
          quotes.add(key);
          return true;
        }
        duplicates.push({ id: s.id, part: s.part, text: s.text, section: s.section, quote: s.quote, reason: "DUPLICATE_QUOTE", detail: "Another sentence on this card already cites the same words." });
        return false;
      });
      for (const f of gateRemoved) {
        if (f.reason === "MEANING_PARTIAL") gate.removed.partial++;
        else if (f.reason === "MEANING_UNSUPPORTED") gate.removed.unsupported++;
        else gate.removed.unchecked++;
      }
      gate.status = "applied";
    } catch (err) {
      gate.status = "failed";
      gate.note = `The meaning check did not run (${oneLine((err as Error).message, 160)}). The sentences passed the citation checker but were not meaning-checked.`;
    }
    timings.gate = Date.now() - t;
  }

  const finalSentences = sortSentences(kept);
  timings.total = Date.now() - t0;
  const card: CardResult = {
    med_key: input.medKey,
    typed_name: input.typedName,
    label: info,
    sentences: finalSentences,
    removed: [...failed, ...gateRemoved, ...duplicates],
    review,
    gate,
    stats: {
      generated: draft.length,
      passed_first_check: passedFirst,
      first_check_failures: firstFailures,
      recovered_by_repair: recoveredByRepair,
      repair_rounds: rounds,
      kept: finalSentences.length,
      verbatim_kept: finalSentences.filter((s) => isVerbatim(sections[s.section]?.text ?? "", s.quote)).length,
    },
    provider: provider.name,
    models,
    usage,
    timings_ms: timings,
    generated_at: new Date().toISOString(),
  };
  step("Card ready");
  return { card, resolved };
}
