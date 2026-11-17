import fs from "node:fs";
import path from "node:path";
import { parseLabel, stripClassSuffix, type Formulation, type ParsedLabel } from "./parse";

/**
 * openFDA drug-label lookup with an on-disk cache.
 *
 * Why not `search=openfda.generic_name:"lisinopril"&limit=1`: that phrase
 * search also matches combination products, and on 2026-11-17 its first hit
 * was the lisinopril + hydrochlorothiazide label. So the lookup is two steps:
 *
 *  1. `count=openfda.generic_name.exact` lists the exact generic names that
 *     match what the user typed, with how many labels carry each one. We keep
 *     single-ingredient names whose base (salt words removed) equals the typed
 *     name, and take the most common. "metformin" → "METFORMIN HYDROCHLORIDE".
 *     No generic match → the same with `openfda.brand_name` ("Lipitor").
 *  2. Fetch the most recently updated label with that exact name that has an
 *     indications section, in the right release form. openFDA gives
 *     immediate- and extended-release metformin the same generic name, and on
 *     2026-11-17 the newest "METFORMIN HYDROCHLORIDE" label was extended-release
 *     (whose card says "take with the evening meal"). So unless the family
 *     typed ER/XR/XL/SR/"extended", the query excludes extended-release labels;
 *     if they did, it asks for one. Either falls back to any label, and the
 *     card warns when the label's form does not match what was typed.
 *  3. Classes. Most labels in the label endpoint carry no
 *     `openfda.pharm_class_epc` (none of 154 lisinopril labels did on
 *     2026-11-17), so when the label has none we ask openFDA's NDC directory,
 *     which does: the exact single-ingredient NDC generic name, then
 *     `count=pharm_class.exact`, keeping the established pharmacologic classes
 *     ([EPC]). The class drives the interaction matcher's class terms.
 *
 * Every HTTP response (including "No matches found" 404s) is written to
 * `data/label-cache/` as `{url, fetched_at, status, body}`. A cached response
 * is always reused, so a lookup is reproducible and works offline. With
 * CAREPOOL_OFFLINE=1 a cache miss is an error instead of a request.
 * Requests are spaced at least 260 ms apart (openFDA allows 240 per minute
 * without a key) and retried on 429/5xx/network errors.
 */

const BASE = "https://api.fda.gov/drug/label.json";
const MIN_SPACING_MS = 260;

export class LabelNotFoundError extends Error {
  constructor(readonly query: string) {
    super(`No FDA label found for "${query}". Check the spelling, or try the generic name.`);
    this.name = "LabelNotFoundError";
  }
}

export class LabelUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LabelUnavailableError";
  }
}

export interface CachedResponse {
  url: string;
  fetched_at: string;
  status: number;
  body: unknown;
}

export interface ResolvedLabel {
  /** What the user typed, as given. */
  query: string;
  matched_by: "generic" | "brand";
  /** The exact openFDA name the label was fetched by. */
  term: string;
  label: ParsedLabel;
  /** The raw openFDA result object for this label. */
  raw: Record<string, unknown>;
  /** Cache files this resolution read, relative to the cache dir. */
  cache_files: string[];
  /** When the label response was fetched from openFDA. */
  fetched_at: string;
  /** Established pharmacologic classes (no suffix), from the label or the NDC directory. */
  classes: string[];
  class_source: "label" | "ndc" | "none";
  /** Release form the typed name or dose asked for, if any. */
  formulation_wanted: "extended" | null;
  /** True when the label's release form differs from what was typed (shown as a warning). */
  formulation_mismatch: boolean;
}

/** "ER", "XR", "XL", "SR", "CR", "LA", "extended", "24 hr", "sustained": the family typed an extended-release form. */
export function formulationHint(text: string): "extended" | null {
  return /\b(?:ER|XR|XL|SR|CR|LA|XL24|extended|sustained|controlled|24[\s-]?h(?:ou)?r)\b/i.test(text) ? "extended" : null;
}

export function formulationMismatch(wanted: "extended" | null, actual: Formulation): boolean {
  return wanted === "extended" ? actual !== "extended" : actual === "extended";
}

// Salt, hydrate and dosage-form words removed when comparing a typed name with an openFDA name.
const SALT_WORDS = new Set([
  "hydrochloride", "hcl", "sodium", "potassium", "calcium", "magnesium", "besylate", "maleate",
  "mesylate", "succinate", "tartrate", "fumarate", "citrate", "sulfate", "acetate", "bromide",
  "chloride", "phosphate", "monohydrate", "dihydrate", "trihydrate", "sesquihydrate", "hemihydrate",
  "anhydrous", "hyclate", "bitartrate", "disodium", "dipotassium", "usp", "tablet", "tablets",
  "capsule", "capsules", "oral", "solution", "film", "coated", "film-coated", "extended-release",
  "delayed-release", "er", "xr", "xl", "sr", "dr",
]);

/** Lower-case base name: letters only up to the first digit, salt and form words removed. */
export function baseName(name: string): string {
  const head = name.toLowerCase().split(/\d/)[0];
  const words = head.replace(/[^a-z\s-]/g, " ").split(/\s+/).filter(Boolean);
  const kept = words.filter((w) => !SALT_WORDS.has(w));
  return (kept.length > 0 ? kept : words).join(" ").trim();
}

export function isCombination(term: string): boolean {
  return /\s(and|with|&)\s|[/,+]/i.test(term);
}

export interface CountTerm {
  term: string;
  count: number;
}

/** Pick the exact openFDA name for a typed name from a `count=...exact` result. Deterministic. */
export function pickTerm(query: string, terms: CountTerm[]): string | null {
  const want = baseName(query);
  if (!want) return null;
  const matches = terms
    .filter((t) => !isCombination(t.term) && baseName(t.term) === want)
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
  return matches[0]?.term ?? null;
}

function cacheDir(): string {
  return path.resolve(process.cwd(), process.env.LABEL_CACHE_DIR || "data/label-cache");
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "x";
}

function isOffline(): boolean {
  return ["1", "true", "yes", "on"].includes((process.env.CAREPOOL_OFFLINE ?? "").toLowerCase());
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let nextSlot = 0;
async function waitTurn(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + MIN_SPACING_MS;
  if (at > now) await sleep(at - now);
}

async function httpGet(url: string): Promise<{ status: number; body: unknown }> {
  const backoff = [2_000, 6_000, 15_000];
  let lastError = "";
  for (let attempt = 0; attempt <= backoff.length; attempt++) {
    await waitTurn();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { accept: "application/json" } });
      const text = await res.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = { error: { code: "NON_JSON", message: text.slice(0, 300) } };
      }
      if (res.status === 429 || res.status >= 500) {
        lastError = `HTTP ${res.status}`;
      } else {
        return { status: res.status, body };
      }
    } catch (err) {
      lastError = (err as Error).message;
    }
    if (attempt < backoff.length) await sleep(backoff[attempt]);
  }
  throw new LabelUnavailableError(`openFDA did not answer (${lastError}). Try again later; cached labels still work.`);
}

/** One cached GET. Returns the cached response when present; fetches and stores it otherwise. */
export async function cachedGet(file: string, url: string): Promise<CachedResponse> {
  const full = path.join(cacheDir(), file);
  if (fs.existsSync(full)) {
    const hit = JSON.parse(fs.readFileSync(full, "utf8")) as CachedResponse;
    if (hit.url === url) return hit;
  }
  if (isOffline()) {
    throw new LabelUnavailableError(`Offline mode (CAREPOOL_OFFLINE=1) and ${file} is not in the label cache.`);
  }
  const { status, body } = await httpGet(url);
  const entry: CachedResponse = { url, fetched_at: new Date().toISOString(), status, body };
  fs.mkdirSync(cacheDir(), { recursive: true });
  fs.writeFileSync(full, `${JSON.stringify(entry, null, 1)}\n`);
  return entry;
}

function q(field: string, value: string): string {
  return `${field}:${encodeURIComponent(`"${value}"`)}`;
}

function countUrl(field: "generic_name" | "brand_name", query: string): string {
  return `${BASE}?search=${q(`openfda.${field}`, query)}&count=openfda.${field}.exact&limit=100`;
}

type Variant = "ir" | "er" | "any";

function labelUrl(field: "generic_name" | "brand_name", term: string, variant: Variant): string {
  const parts = [q(`openfda.${field}.exact`, term), "_exists_:indications_and_usage"];
  const er = encodeURIComponent('"extended-release"');
  if (variant === "ir") parts.push(`NOT+description:${er}`, `NOT+indications_and_usage:${er}`);
  if (variant === "er") parts.push(`description:${er}`);
  return `${BASE}?search=${parts.join("+AND+")}&sort=effective_time:desc&limit=1`;
}

const NDC = "https://api.fda.gov/drug/ndc.json";

/** Established pharmacologic classes from a `count=pharm_class.exact` result, deduplicated case-insensitively. */
export function epcClasses(terms: CountTerm[]): string[] {
  const out = new Map<string, string>();
  for (const t of [...terms].sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))) {
    if (!/\[EPC\]\s*$/i.test(t.term)) continue;
    const name = stripClassSuffix(t.term);
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!out.has(key)) out.set(key, name);
  }
  return [...out.values()];
}

/** Classes for a generic base name from the NDC directory (cached like every other response). */
async function ndcClasses(name: string, files: string[]): Promise<string[]> {
  const namesFile = `ndc-names__${slug(name)}.json`;
  files.push(namesFile);
  const names = await cachedGet(namesFile, `${NDC}?search=${q("generic_name", name)}&count=generic_name.exact&limit=100`);
  const term = pickTerm(name, countTerms(names));
  if (!term) return [];
  const classFile = `ndc-classes__${slug(term)}.json`;
  files.push(classFile);
  const classes = await cachedGet(classFile, `${NDC}?search=${q("generic_name.exact", term)}&count=pharm_class.exact&limit=100`);
  return epcClasses(countTerms(classes));
}

function countTerms(res: CachedResponse): CountTerm[] {
  if (res.status !== 200) return [];
  const results = (res.body as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  return results
    .map((r) => r as { term?: unknown; count?: unknown })
    .filter((r): r is CountTerm => typeof r.term === "string" && typeof r.count === "number");
}

function firstResult(res: CachedResponse): Record<string, unknown> | null {
  if (res.status !== 200) return null;
  const results = (res.body as { results?: unknown }).results;
  return Array.isArray(results) && results[0] && typeof results[0] === "object" ? (results[0] as Record<string, unknown>) : null;
}

/**
 * Resolve a typed medication name to one FDA label. `formulationText` is what
 * else the family typed (the dose line); it only decides the release form.
 */
export async function resolveLabel(query: string, opts: { formulationText?: string } = {}): Promise<ResolvedLabel> {
  const name = baseName(query);
  const wanted = formulationHint(`${query} ${opts.formulationText ?? ""}`);
  if (!name) throw new LabelNotFoundError(query);
  const files: string[] = [];

  for (const field of ["generic_name", "brand_name"] as const) {
    const kind = field === "generic_name" ? "generic" : "brand";
    const countFile = `count-${kind}__${slug(name)}.json`;
    files.push(countFile);
    const counted = await cachedGet(countFile, countUrl(field, name));
    const term = pickTerm(name, countTerms(counted));
    if (!term) continue;

    let res: CachedResponse | null = null;
    let raw: Record<string, unknown> | null = null;
    for (const variant of [wanted === "extended" ? "er" : "ir", "any"] as Variant[]) {
      const labelFile = `label-${kind}${variant === "any" ? "" : `-${variant}`}__${slug(term)}.json`;
      files.push(labelFile);
      res = await cachedGet(labelFile, labelUrl(field, term, variant));
      raw = firstResult(res);
      if (raw) break;
    }
    if (!raw || !res) continue;
    const label = parseLabel(raw);
    let classes = label.pharm_classes;
    let classSource: ResolvedLabel["class_source"] = classes.length > 0 ? "label" : "none";
    if (classes.length === 0) {
      const generic = label.generic_names.find((g) => !isCombination(g)) ?? term;
      classes = await ndcClasses(baseName(generic), files);
      if (classes.length > 0) classSource = "ndc";
    }
    return {
      query,
      matched_by: kind,
      term,
      label,
      raw,
      cache_files: files,
      fetched_at: res.fetched_at,
      classes,
      class_source: classSource,
      formulation_wanted: wanted,
      formulation_mismatch: formulationMismatch(wanted, label.formulation),
    };
  }
  throw new LabelNotFoundError(query);
}

/** Read the raw label object for a resolution straight from the cache file (used by the eval's independent re-check). */
export function readCachedLabelRaw(cacheFile: string): Record<string, unknown> | null {
  const full = path.join(cacheDir(), cacheFile);
  if (!fs.existsSync(full)) return null;
  const entry = JSON.parse(fs.readFileSync(full, "utf8")) as CachedResponse;
  return firstResult(entry);
}
