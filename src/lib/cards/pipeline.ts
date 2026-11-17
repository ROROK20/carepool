import { resolveLabel, type ResolvedLabel } from "../labels/openfda";
import { dailyMedUrl } from "../labels/parse";
import { CARD_PARTS } from "../labels/sections";
import type { Provider, ProviderName } from "../model";
import type { ModelResponse } from "../model/types";
import { checkCardSentences, checkSentence, isVerbatim, type CardFailure, type CardSentence } from "./citations";
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

export interface CardResult {
  med_key: string;
  typed_name: string;
  label: CardLabelInfo;
  /** Kept sentences, in part order. Every one passed the checker. */
  sentences: CardSentence[];
  /** Sentences the checker removed (after any repair), with the reason. */
  removed: CardFailure[];
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
  models: { writer: string | null; repair: string | null; review: string | null };
  usage: { input_tokens: number; output_tokens: number };
  timings_ms: { label: number; write: number; repair: number; review: number; total: number };
  generated_at: string;
}

export interface BuildCardOptions {
  provider: Provider;
  reviewEnabled: boolean;
  maxRepairRounds: number;
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

export async function buildCard(
  input: { medKey: string; typedName: string; typedDose?: string },
  opts: BuildCardOptions,
): Promise<{ card: CardResult; resolved: ResolvedLabel }> {
  const { provider } = opts;
  const step = opts.onStep ?? (() => {});
  const usage = { input_tokens: 0, output_tokens: 0 };
  const models: CardResult["models"] = { writer: null, repair: null, review: null };
  const timings = { label: 0, write: 0, repair: 0, review: 0, total: 0 };
  const t0 = Date.now();
  const tally = (r: ModelResponse) => {
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

  const finalSentences = sortSentences(kept);
  timings.total = Date.now() - t0;
  const card: CardResult = {
    med_key: input.medKey,
    typed_name: input.typedName,
    label: info,
    sentences: finalSentences,
    removed: [...failed, ...duplicates],
    review,
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
