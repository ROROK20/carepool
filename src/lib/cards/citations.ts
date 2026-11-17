import type { LabelSection } from "../labels/parse";
import { PART_SECTIONS, type CardPart } from "../labels/sections";

/**
 * Deterministic citation checker for drug-card sentences. Pure: no I/O, no model.
 *
 * Adapted from Dispute Defender's `src/lib/agent/citations.ts` (same author,
 * MIT). The grounded-token extraction (numbers, dates, double-quoted
 * strings) is that file's, unchanged in behavior. What changed: a citation
 * here is one label section plus one verbatim quoted span, not a list of
 * source ids, and the rules are:
 *
 *  1. NO_CITATION      the sentence names no section or no quote.
 *  2. UNKNOWN_SECTION  the section is not in this label.
 *  3. WRONG_PART       the section cannot back this card part (a side effect must
 *                      cite Adverse Reactions or patient information, and so on).
 *  4. QUOTE_TOO_SHORT / QUOTE_TOO_LONG   a quote must be a real span, 3+ words
 *                      and at most 400 characters.
 *  5. QUOTE_NOT_FOUND  the quote is not a verbatim substring of the section text
 *                      (whitespace collapsed, otherwise exact: case and wording).
 *  6. UNGROUNDED_TOKEN a number, date or quoted phrase in the plain-language
 *                      sentence does not appear in the quote.
 *  7. DOSE_MENTION     the sentence or its quote states a dose amount or a dosing
 *                      frequency. Doses come only from what the family typed.
 *
 * One mechanical repair is allowed and only one: if the quote matches after
 * curly quotes and dashes are mapped to plain ones, the stored quote is
 * replaced with the exact label substring. The kept quote is therefore always
 * a byte-for-byte substring of the collapsed section text.
 */

export type CardFailureReason =
  | "NO_CITATION"
  | "UNKNOWN_SECTION"
  | "WRONG_PART"
  | "QUOTE_TOO_SHORT"
  | "QUOTE_TOO_LONG"
  | "QUOTE_NOT_FOUND"
  | "UNGROUNDED_TOKEN"
  | "DOSE_MENTION";

export interface CardSentence {
  id: string;
  part: CardPart;
  /** Plain-language sentence shown to the family. */
  text: string;
  /** openFDA section key, e.g. "adverse_reactions". */
  section: string;
  /** Verbatim span of that section. */
  quote: string;
}

export interface CardFailure {
  id: string;
  part: CardPart;
  text: string;
  section: string;
  quote: string;
  reason: CardFailureReason;
  /** The offending token, unknown section, or dose phrase. */
  token?: string;
  /** One readable line, sent back to the model in a repair round and shown in the UI. */
  detail: string;
}

export interface CardCheckResult {
  passed: CardSentence[];
  failed: CardFailure[];
}

export const MIN_QUOTE_CHARS = 12;
export const MIN_QUOTE_WORDS = 3;
export const MAX_QUOTE_CHARS = 400;

// ── Grounded tokens (from Dispute Defender citations.ts) ─────────────

export type GroundedTokenKind = "quote" | "date" | "number";

export interface GroundedToken {
  kind: GroundedTokenKind;
  raw: string;
  key: string;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_PATTERN =
  "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const QUOTE_RE = /["“]([^"“”]{1,400})["”]/g;
const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const MONTH_DAY_RE = new RegExp(`\\b${MONTH_PATTERN}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "gi");
const NUMBER_RE = /\$?\d[\d,]*(?:\.\d+)?%?/g;
const CONTENT_NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g;

export function normalizeText(text: string): string {
  return normalizeGlyphs(text).toLowerCase().replace(/\s+/g, " ").trim();
}

/** Curly quotes and dashes → plain ones. One character in, one character out, so indices are preserved. */
export function normalizeGlyphs(text: string): string {
  return text
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/ /g, " ");
}

interface Span {
  start: number;
  end: number;
}

const overlaps = (spans: Span[], start: number, end: number) => spans.some((s) => start < s.end && end > s.start);
const pad2 = (n: number) => String(n).padStart(2, "0");

function numericKey(raw: string): string | null {
  const n = Number(raw.replace(/[$,%]/g, ""));
  return Number.isFinite(n) ? String(n) : null;
}

/** Every token in a sentence that must be grounded in its quote. */
export function extractGroundedTokens(text: string): GroundedToken[] {
  const spans: Span[] = [];
  const tokens: GroundedToken[] = [];
  for (const m of text.matchAll(QUOTE_RE)) {
    const inner = m[1].trim().replace(/[.,;:!?]+$/, "").trim();
    const start = m.index ?? 0;
    spans.push({ start, end: start + m[0].length });
    if (inner) tokens.push({ kind: "quote", raw: m[0], key: normalizeText(inner) });
  }
  for (const m of text.matchAll(ISO_DATE_RE)) {
    const start = m.index ?? 0;
    if (overlaps(spans, start, start + m[0].length)) continue;
    spans.push({ start, end: start + m[0].length });
    tokens.push({ kind: "date", raw: m[0], key: `${m[1]}-${m[2]}-${m[3]}` });
  }
  for (const m of text.matchAll(MONTH_DAY_RE)) {
    const start = m.index ?? 0;
    if (overlaps(spans, start, start + m[0].length)) continue;
    const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (!month) continue;
    spans.push({ start, end: start + m[0].length });
    tokens.push({ kind: "date", raw: m[0], key: m[3] ? `${m[3]}-${pad2(month)}-${pad2(Number(m[2]))}` : `--${pad2(month)}-${pad2(Number(m[2]))}` });
  }
  for (const m of text.matchAll(NUMBER_RE)) {
    const start = m.index ?? 0;
    if (overlaps(spans, start, start + m[0].length)) continue;
    const key = numericKey(m[0]);
    if (key) tokens.push({ kind: "number", raw: m[0], key });
  }
  return tokens;
}

function groundedIn(token: GroundedToken, quote: string): boolean {
  if (token.kind === "quote") return normalizeText(quote).includes(token.key);
  if (token.kind === "date") {
    const inner = extractGroundedTokens(quote).filter((t) => t.kind === "date").map((t) => t.key);
    return inner.includes(token.key) || inner.some((k) => k.slice(-6) === token.key.slice(-6) && token.key.startsWith("--"));
  }
  const numbers = new Set<string>();
  for (const m of quote.matchAll(CONTENT_NUMBER_RE)) {
    const key = numericKey(m[0]);
    if (key) numbers.add(key);
  }
  return numbers.has(token.key);
}

// ── Dose and frequency ───────────────────────────────────────────────

const DOSE_AMOUNT_RE =
  /\b\d+(?:[.,]\d+)?(?:\s*(?:-|–|to)\s*\d+(?:[.,]\d+)?)?\s*(?:mg|mcg|µg|μg|g|grams?|milligrams?|micrograms?|mL(?!\s*\/\s*min)|ml(?!\s*\/\s*min)|units?|IU|tablets?|capsules?|caplets?|puffs?|drops?|teaspoons?|tablespoons?|tsp|tbsp)(?![A-Za-z])/i;
const WORD_DOSE_RE = /\b(?:one|two|three|four|half(?:\s+a)?|a\s+half)\s+(?:tablets?|capsules?|caplets?|puffs?|drops?|teaspoons?|tablespoons?)\b/i;
const FREQUENCY_RE =
  /\b(?:once|twice|thrice|one\s+time|two\s+times|three\s+times|four\s+times|\d+\s*times)\s+(?:a\s+|per\s+|each\s+)?(?:day|daily|week|weekly|night|nightly)\b|\bevery\s+\d+(?:\s*(?:to|-)\s*\d+)?\s*(?:hours?|hrs?|days?|weeks?)\b|\b(?:b\.?i\.?d|t\.?i\.?d|q\.?i\.?d|q\.?h\.?s)\b\.?|\bq\s?\d+\s?h\b/i;

/** The first dose amount or dosing frequency in a string, or null. */
export function doseMention(text: string): string | null {
  const t = normalizeGlyphs(text);
  for (const re of [DOSE_AMOUNT_RE, WORD_DOSE_RE, FREQUENCY_RE]) {
    const m = re.exec(t);
    if (m) return m[0];
  }
  return null;
}

// ── Verbatim lookup ──────────────────────────────────────────────────

/** Tidy what a model returns as a quote: trim, unwrap one pair of quote marks, drop edge ellipses. */
export function cleanQuote(quote: string): string {
  let q = quote.replace(/\s+/g, " ").trim();
  q = q.replace(/^(?:\.\.\.|…)\s*/, "").replace(/\s*(?:\.\.\.|…)$/, "");
  const pairs: [string, string][] = [['"', '"'], ["“", "”"], ["'", "'"], ["‘", "’"]];
  for (const [open, close] of pairs) {
    if (q.length > 2 && q.startsWith(open) && q.endsWith(close)) {
      q = q.slice(1, -1).trim();
      break;
    }
  }
  return q;
}

/** The exact label substring for a quote, or null. Exact match first, then curly-quote/dash-insensitive. */
export function findVerbatim(sectionText: string, quote: string): string | null {
  const q = cleanQuote(quote);
  if (!q) return null;
  if (sectionText.includes(q)) return q;
  const at = normalizeGlyphs(sectionText).indexOf(normalizeGlyphs(q));
  return at === -1 ? null : sectionText.slice(at, at + q.length);
}

// ── The checker ──────────────────────────────────────────────────────

export function describe(reason: CardFailureReason, s: Pick<CardSentence, "part" | "section">, token?: string): string {
  switch (reason) {
    case "NO_CITATION":
      return "The sentence has no section or no quote.";
    case "UNKNOWN_SECTION":
      return `This label has no section "${token}".`;
    case "WRONG_PART":
      return `A "${s.part}" sentence cannot cite the ${s.section} section; allowed: ${PART_SECTIONS[s.part].join(", ")}.`;
    case "QUOTE_TOO_SHORT":
      return `The quote is too short to check (at least ${MIN_QUOTE_WORDS} words and ${MIN_QUOTE_CHARS} characters).`;
    case "QUOTE_TOO_LONG":
      return `The quote is longer than ${MAX_QUOTE_CHARS} characters; quote one sentence or less.`;
    case "QUOTE_NOT_FOUND":
      return `The quote does not appear word for word in the ${s.section} section.`;
    case "UNGROUNDED_TOKEN":
      return `${token} is in the sentence but not in its quote.`;
    case "DOSE_MENTION":
      return `"${token}" is a dose amount or dosing frequency; cards never state doses (the family's own prescription does).`;
  }
}

export type QuoteCheck =
  | { ok: true; exact: string }
  | { ok: false; reason: Exclude<CardFailureReason, "NO_CITATION" | "UNKNOWN_SECTION" | "WRONG_PART">; token?: string };

/**
 * The core rules shared by card sentences and interaction explanations:
 * quote length, verbatim presence in the section, no dose or frequency, and
 * every number/date/quoted phrase of the plain text inside the quote.
 */
export function checkQuoted(text: string, quote: string, sectionText: string): QuoteCheck {
  const q = cleanQuote(quote);
  if (q.length < MIN_QUOTE_CHARS || q.split(" ").length < MIN_QUOTE_WORDS) return { ok: false, reason: "QUOTE_TOO_SHORT" };
  if (q.length > MAX_QUOTE_CHARS) return { ok: false, reason: "QUOTE_TOO_LONG" };
  const exact = findVerbatim(sectionText, q);
  if (!exact) return { ok: false, reason: "QUOTE_NOT_FOUND" };
  const dose = doseMention(text) ?? doseMention(exact);
  if (dose) return { ok: false, reason: "DOSE_MENTION", token: dose };
  const missing = extractGroundedTokens(text).find((t) => !groundedIn(t, exact));
  if (missing) return { ok: false, reason: "UNGROUNDED_TOKEN", token: missing.raw };
  return { ok: true, exact };
}

/** Check one sentence. Returns the sentence with its quote set to the exact label span, or a failure. */
export function checkSentence(
  s: CardSentence,
  sections: Record<string, LabelSection>,
): { ok: true; sentence: CardSentence } | { ok: false; failure: CardFailure } {
  const fail = (reason: CardFailureReason, token?: string) => ({
    ok: false as const,
    failure: {
      id: s.id,
      part: s.part,
      text: s.text,
      section: s.section,
      quote: s.quote,
      reason,
      ...(token !== undefined ? { token } : {}),
      detail: describe(reason, s, token),
    },
  });

  if (!s.section?.trim() || !cleanQuote(s.quote ?? "")) return fail("NO_CITATION");
  const section = sections[s.section];
  if (!section) return fail("UNKNOWN_SECTION", s.section);
  if (!PART_SECTIONS[s.part]?.includes(s.section)) return fail("WRONG_PART", s.section);
  const r = checkQuoted(s.text, s.quote, section.text);
  if (!r.ok) return fail(r.reason, r.token);
  return { ok: true, sentence: { ...s, quote: r.exact } };
}

export function checkCardSentences(sentences: CardSentence[], sections: Record<string, LabelSection>): CardCheckResult {
  const passed: CardSentence[] = [];
  const failed: CardFailure[] = [];
  for (const s of sentences) {
    const r = checkSentence(s, sections);
    if (r.ok) passed.push(r.sentence);
    else failed.push(r.failure);
  }
  return { passed, failed };
}

/** Independent re-check used by the eval and the UI badge: is this quote a verbatim substring of this text? */
export function isVerbatim(sectionText: string, quote: string): boolean {
  return quote.length > 0 && sectionText.includes(quote);
}
