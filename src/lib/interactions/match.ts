import { baseName, isCombination } from "../labels/openfda";
import type { LabelSection } from "../labels/parse";
import { INTERACTION_SECTIONS, sectionTitle } from "../labels/sections";
import { classPhrases } from "./classes";
import { isBoundary } from "../labels/sentences";

/**
 * Deterministic interaction matcher. No model, no network.
 *
 * For every ordered pair (A, B) it scans A's drug_interactions, boxed
 * warning, contraindications and warnings/precautions sections for a term
 * that names B: B's generic name, a brand name from B's label, or a phrase
 * for B's pharmacologic class (classes.ts). Each hit becomes a flag carrying
 * the label sentence around it, sliced straight out of A's section text, so
 * the quote is verbatim by construction.
 *
 * A model may later explain a flag in plain words. It never creates one: the
 * flag list is fixed here, before any model call.
 *
 * Two deliberate limits, both measured in the eval:
 *  - A class phrase that A and B share is skipped for that pair (a statin
 *    label saying "other statins" names itself as much as B).
 *  - A class phrase used as an adjective ("reduce the diuretic, natriuretic
 *    and antihypertensive effect") is not a mention of the class.
 *  - A sentence that says the two were studied together and nothing
 *    meaningful happened ("did not alter", "no clinically significant
 *    interaction") is kept but marked `no_effect_noted`, and does not count
 *    as a flag.
 */

export interface DrugForMatching {
  /** Stable key (medication id). */
  key: string;
  /** Display name, as the user typed it. */
  display: string;
  /** Names that identify this drug in other labels: generic base names and brand names. */
  names: string[];
  /** Established pharmacologic classes. */
  classes: string[];
  sections: Record<string, LabelSection>;
}

export type MatchKind = "name" | "class";
export type Polarity = "caution" | "no_effect_noted";

export interface InteractionFlag {
  id: string;
  /** The drug whose label was read. */
  a: string;
  /** The drug that label names. */
  b: string;
  section: string;
  section_title: string;
  kind: MatchKind;
  /** The term that matched (a name, or a class phrase). */
  term: string;
  /** For class matches, B's class the phrase stands for. */
  class_name: string | null;
  /** The matched text exactly as it appears in the label. */
  matched_text: string;
  /** Verbatim span of A's section around the match. */
  quote: string;
  /** True when the quote starts or ends mid-sentence (long sentences are windowed). */
  clipped_start: boolean;
  clipped_end: boolean;
  polarity: Polarity;
}

export interface PairFinding {
  /** Keys in a stable order (sorted). */
  pair: [string, string];
  flagged: boolean;
  flags: InteractionFlag[];
}

interface Term {
  term: string;
  kind: MatchKind;
  class_name: string | null;
  re: RegExp;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isAcronym(term: string): boolean {
  return /^[A-Z0-9]{2,6}$/.test(term);
}

/** Regex for a term: word-bounded, spaces/hyphens interchangeable, optional plural. */
export function termRegex(term: string): RegExp {
  const body = term
    .trim()
    .split(/[\s-]+/)
    .map(escapeRe)
    .join("[\\s-]+");
  return new RegExp(`(?<![A-Za-z0-9])${body}(?:s|es)?(?![A-Za-z0-9])`, isAcronym(term) ? "g" : "gi");
}

/** Names that identify a drug: typed name, generic base names, brand names. Short or combination names are dropped. */
export function identityNames(typed: string, genericNames: string[], brandNames: string[]): string[] {
  const out = new Map<string, string>();
  const add = (n: string) => {
    const v = n.trim();
    if (v.length < 4 || isCombination(v)) return;
    const k = v.toLowerCase();
    if (!out.has(k)) out.set(k, v);
  };
  add(baseName(typed));
  genericNames.forEach((g) => add(baseName(g)));
  brandNames.forEach((b) => add(b));
  return [...out.values()];
}

function termsFor(b: DrugForMatching, a: DrugForMatching): Term[] {
  const aPhrases = new Set(a.classes.flatMap((c) => classPhrases(c)).map((p) => p.toLowerCase()));
  const terms: Term[] = b.names.map((n) => ({ term: n, kind: "name" as const, class_name: null, re: termRegex(n) }));
  for (const cls of b.classes) {
    for (const phrase of classPhrases(cls)) {
      if (aPhrases.has(phrase.toLowerCase())) continue;
      terms.push({ term: phrase, kind: "class", class_name: cls, re: termRegex(phrase) });
    }
  }
  return terms;
}

const MAX_QUOTE = 420;
const WINDOW = 200;

/** A class phrase followed by one of these is used as an adjective ("diuretic effect"), not naming the class. */
const ADJECTIVAL_FOLLOWER = /^,?\s+(?:and\s+)?(?:natriuretic|effects?|actions?|response|activity|properties)\b/i;

export function isAdjectivalUse(text: string, matchEnd: number): boolean {
  return ADJECTIVAL_FOLLOWER.test(text.slice(matchEnd, matchEnd + 40));
}

export interface Span {
  start: number;
  end: number;
  clipped_start: boolean;
  clipped_end: boolean;
}

/** The sentence containing [start, end), as indices into text; long sentences are windowed around the match. */
export function sentenceSpan(text: string, start: number, end: number): Span {
  let s = start;
  while (s > 0 && !isBoundary(text, s - 1)) s--;
  let e = end;
  while (e < text.length && !isBoundary(text, e)) e++;
  if (e < text.length && text[e] !== "•") e++; // keep the full stop
  while (s < e && text[s] === " ") s++;
  while (e > s && text[e - 1] === " ") e--;
  if (e - s <= MAX_QUOTE) return { start: s, end: e, clipped_start: false, clipped_end: false };
  let ws = Math.max(s, start - WINDOW);
  let we = Math.min(e, end + WINDOW);
  if (ws > s) {
    const sp = text.indexOf(" ", ws);
    if (sp !== -1 && sp < start) ws = sp + 1;
  }
  if (we < e) {
    const sp = text.lastIndexOf(" ", we);
    if (sp > end) we = sp;
  }
  return { start: ws, end: we, clipped_start: ws > s, clipped_end: we < e };
}

const NO_EFFECT_PATTERNS: RegExp[] = [
  /\bno\s+(?:clinically\s+)?(?:significant|important|meaningful|relevant|apparent|appreciable)?\s*(?:pharmacokinetic\s+|pharmacodynamic\s+)?(?:drug[\s-]+drug\s+)?(?:interaction|effect|change)s?\b/i,
  /\b(?:did|does|do|was|were)\s+not\s+(?:significantly\s+|substantially\s+|meaningfully\s+|appreciably\s+)?(?:alter|affect|change|influence|potentiate|interact)/i,
  /\bnot\s+(?:clinically\s+)?(?:significant|important|meaningful)ly?\b/i,
  /\bno\s+dos(?:e|age)\s+adjustment/i,
];

export function polarityOf(quote: string): Polarity {
  return NO_EFFECT_PATTERNS.some((re) => re.test(quote)) ? "no_effect_noted" : "caution";
}

/** Flags for one direction: what A's label says about B. At most one flag per section (cautions preferred). */
export function matchDirection(a: DrugForMatching, b: DrugForMatching): InteractionFlag[] {
  if (a.key === b.key) return [];
  const terms = termsFor(b, a);
  const flags: InteractionFlag[] = [];
  for (const sectionKey of INTERACTION_SECTIONS) {
    const section = a.sections[sectionKey];
    if (!section) continue;
    const hits: { index: number; text: string; term: Term }[] = [];
    for (const term of terms) {
      term.re.lastIndex = 0;
      for (const m of section.text.matchAll(term.re)) {
        const index = m.index ?? 0;
        if (term.kind === "class" && isAdjectivalUse(section.text, index + m[0].length)) continue;
        hits.push({ index, text: m[0], term });
      }
    }
    if (hits.length === 0) continue;
    const candidates: InteractionFlag[] = hits.map((hit) => {
      const span = sentenceSpan(section.text, hit.index, hit.index + hit.text.length);
      const quote = section.text.slice(span.start, span.end);
      return {
        id: `${a.key}>${b.key}:${sectionKey}:${span.start}`,
        a: a.key,
        b: b.key,
        section: sectionKey,
        section_title: sectionTitle(sectionKey),
        kind: hit.term.kind,
        term: hit.term.term,
        class_name: hit.term.class_name,
        matched_text: hit.text,
        quote,
        clipped_start: span.clipped_start,
        clipped_end: span.clipped_end,
        polarity: polarityOf(quote),
      };
    });
    // Earliest sentence first; within one sentence a direct name beats a class phrase.
    const rank = (f: InteractionFlag) => (f.kind === "name" ? 0 : 1);
    const start = (f: InteractionFlag) => section.text.indexOf(f.quote);
    candidates.sort((x, y) => start(x) - start(y) || rank(x) - rank(y));
    const chosen = candidates.find((c) => c.polarity === "caution") ?? candidates[0] ?? null;
    if (chosen) flags.push(chosen);
  }
  return flags;
}

/** Every unordered pair that has at least one directional flag (caution or no-effect). */
export function findInteractions(drugs: DrugForMatching[]): PairFinding[] {
  const out: PairFinding[] = [];
  for (let i = 0; i < drugs.length; i++) {
    for (let j = i + 1; j < drugs.length; j++) {
      const [x, y] = [drugs[i], drugs[j]].sort((p, q) => p.key.localeCompare(q.key));
      const flags = [...matchDirection(x, y), ...matchDirection(y, x)];
      if (flags.length === 0) continue;
      out.push({ pair: [x.key, y.key], flagged: flags.some((f) => f.polarity === "caution"), flags });
    }
  }
  return out.sort((p, q) => Number(q.flagged) - Number(p.flagged) || p.pair.join().localeCompare(q.pair.join()));
}
