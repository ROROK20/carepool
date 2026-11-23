/**
 * Mechanical check of the held-out interaction truth list.
 *
 *   npm run truth:check                          # offline, from data/label-cache/
 *   npx tsx scripts/check-truth.ts --write-hash  # only while building a list, before it is frozen
 *
 * This does not decide whether a pair is right; a person reading the two labels
 * does that. It proves the file says nothing the cached labels do not:
 *
 *  - every medicine in a pair is in eval/meds.json, a and b differ, and no
 *    unordered pair appears twice;
 *  - every evidence quote is found word for word in the parsed section text of
 *    the label it names (the same whitespace-collapsed text the app cites and
 *    the eval re-checks), that label is one of the pair's two, and the section
 *    is one the rule counts (INTERACTION_SECTIONS);
 *  - every positive has at least one quote stating the interaction or caution;
 *    every negative records the searches that confirmed it;
 *  - every "searched" entry, written `"x>y": "/regex/flags: N hits"` (x's label
 *    searched for y), is re-run on x's INTERACTION_SECTIONS text and must give
 *    exactly N matches;
 *  - each pair's kind follows mechanically from its evidence (see KIND below)
 *    and agrees with the pair's "kind" field when one is given;
 *  - pairs_sha256 matches the pairs, so an edit after freezing cannot pass quietly.
 *
 * Exit code 1 on any failure. CAREPOOL_OFFLINE is forced on: a label missing
 * from the cache is a failure, never a network request.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveLabel, type ResolvedLabel } from "../src/lib/labels/openfda";
import { INTERACTION_SECTIONS } from "../src/lib/labels/sections";

process.env.CAREPOOL_OFFLINE = "1";

const TRUTH_FILE = path.resolve("eval/interaction-truth.json");
const MEDS_FILE = path.resolve("eval/meds.json");

/**
 * KIND, derived from a pair's core evidence (quotes without a "role"):
 *  - stated_by_name: positive, and a core quote contains the other medicine's generic name;
 *  - stated_by_class_only: positive, and no core quote contains the other medicine's name;
 *  - mentioned_not_co_use: negative with core quotes (the mention, which is not a caution);
 *  - never_mentioned: negative with no core quotes; both directions searched, 0 hits.
 * Quotes with role "context" (background) or "membership" (which class a drug
 * belongs to, in its own label's words) are checked verbatim but do not decide the kind.
 */
const KINDS = ["stated_by_name", "stated_by_class_only", "mentioned_not_co_use", "never_mentioned"] as const;
type Kind = (typeof KINDS)[number];
const ROLES = ["context", "membership"];

interface Evidence {
  label: string;
  section: string;
  quote: string;
  role?: string;
}

interface Pair {
  a: string;
  b: string;
  interacts: boolean;
  kind?: string;
  why: string;
  evidence: Evidence[];
  searched?: Record<string, string>;
  note?: string;
}

interface Truth {
  version: number;
  checked_on: string;
  checked_by: string;
  frozen_before_scoring: string;
  rule: string;
  pairs_sha256?: string;
  pairs: Pair[];
}

const SEARCHED = /^\/(.+)\/([a-z]*): (\d+) hits?$/;

const failures: string[] = [];
function fail(message: string): void {
  failures.push(message);
}

function isKind(value: string): value is Kind {
  return (KINDS as readonly string[]).includes(value);
}

function pairsHash(pairs: Pair[]): string {
  return createHash("sha256").update(JSON.stringify(pairs)).digest("hex");
}

/** The text of each section the rule counts, kept separate so no match spans two sections. */
function ruleSections(r: ResolvedLabel): string[] {
  return INTERACTION_SECTIONS.map((key) => r.label.sections[key]?.text).filter((t): t is string => typeof t === "string");
}

function countMatches(texts: string[], source: string, flags: string): number {
  const re = new RegExp(source, flags.includes("g") ? flags : `${flags}g`);
  return texts.reduce((n, t) => n + (t.match(re)?.length ?? 0), 0);
}

async function main(): Promise<void> {
  const writeHash = process.argv.includes("--write-hash");
  const rawTruth = fs.readFileSync(TRUTH_FILE, "utf8");
  const truth = JSON.parse(rawTruth) as Truth;
  const meds = (JSON.parse(fs.readFileSync(MEDS_FILE, "utf8")) as { meds: string[] }).meds;

  if (truth.version !== 2) fail(`version is ${String(truth.version)}, expected 2`);
  for (const key of ["checked_on", "checked_by", "frozen_before_scoring", "rule"] as const) {
    if (typeof truth[key] !== "string" || truth[key].trim() === "") fail(`top-level "${key}" is missing or empty`);
  }
  if (!Array.isArray(truth.pairs) || truth.pairs.length === 0) {
    fail("no pairs");
    report(truth, meds, null);
    return;
  }

  const medSet = new Set(meds);
  if (medSet.size !== meds.length) fail("eval/meds.json lists a medicine twice");

  const labels = new Map<string, ResolvedLabel>();
  for (const name of meds) {
    try {
      labels.set(name, await resolveLabel(name));
    } catch (err) {
      fail(`${name}: does not resolve offline from the label cache (${(err as Error).message})`);
    }
  }

  const seen = new Map<string, number>();
  const tally = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<Kind, number>;
  let quotes = 0;
  let quotesFound = 0;
  let searches = 0;
  let searchesMatching = 0;

  truth.pairs.forEach((p, i) => {
    const id = `pair ${i + 1} (${p.a} + ${p.b})`;
    if (typeof p.a !== "string" || typeof p.b !== "string" || typeof p.interacts !== "boolean" || typeof p.why !== "string" || !Array.isArray(p.evidence)) {
      fail(`${id}: needs a, b, interacts, why and evidence`);
      return;
    }
    if (p.a === p.b) fail(`${id}: a and b are the same medicine`);
    for (const name of [p.a, p.b]) if (!medSet.has(name)) fail(`${id}: "${name}" is not in eval/meds.json`);
    const key = [p.a, p.b].sort().join(" + ");
    const first = seen.get(key);
    if (first !== undefined) fail(`${id}: same pair as pair ${first + 1}`);
    else seen.set(key, i);
    const other = (label: string) => (label === p.a ? p.b : p.a);

    for (const e of p.evidence) {
      quotes++;
      if (e.label !== p.a && e.label !== p.b) {
        fail(`${id}: evidence label "${e.label}" is not one of the pair`);
        continue;
      }
      if (!INTERACTION_SECTIONS.includes(e.section)) {
        fail(`${id}: section "${e.section}" is not one the rule counts`);
        continue;
      }
      if (e.role !== undefined && !ROLES.includes(e.role)) {
        fail(`${id}: unknown evidence role "${e.role}"`);
        continue;
      }
      if (typeof e.quote !== "string" || e.quote.trim() === "") {
        fail(`${id}: empty quote`);
        continue;
      }
      const text = labels.get(e.label)?.label.sections[e.section]?.text;
      if (text === undefined) {
        fail(`${id}: the ${e.label} label has no ${e.section} section`);
        continue;
      }
      if (!text.includes(e.quote)) {
        fail(`${id}: quote not found verbatim in ${e.label} / ${e.section}: "${e.quote}"`);
        continue;
      }
      quotesFound++;
    }

    const searched = p.searched ?? {};
    for (const [direction, value] of Object.entries(searched)) {
      searches++;
      const [x, y, extra] = direction.split(">");
      if (!x || !y || extra !== undefined || x === y || ![p.a, p.b].includes(x) || ![p.a, p.b].includes(y)) {
        fail(`${id}: searched key "${direction}" must be "${p.a}>${p.b}" or "${p.b}>${p.a}"`);
        continue;
      }
      const m = SEARCHED.exec(value);
      if (!m) {
        fail(`${id}: searched "${direction}" is not written as "/regex/flags: N hits"`);
        continue;
      }
      const [, source, flags, recorded] = m;
      const r = labels.get(x);
      if (!r) continue; // already reported as unresolved
      let found: number;
      try {
        found = countMatches(ruleSections(r), source, flags);
      } catch (err) {
        fail(`${id}: searched "${direction}" has an invalid regex (${(err as Error).message})`);
        continue;
      }
      if (found !== Number(recorded)) {
        fail(`${id}: searched "${direction}" records ${recorded} hits; re-run on the ${x} label finds ${found}`);
        continue;
      }
      searchesMatching++;
    }

    const core = p.evidence.filter((e) => e.role === undefined);
    let kind: Kind;
    if (p.interacts) {
      if (core.length === 0) fail(`${id}: a positive needs at least one quote stating the interaction or caution`);
      kind = core.some((e) => e.quote.toLowerCase().includes(other(e.label).toLowerCase())) ? "stated_by_name" : "stated_by_class_only";
    } else {
      if (Object.keys(searched).length === 0) fail(`${id}: a negative must record the searches that confirmed it`);
      kind = core.length > 0 ? "mentioned_not_co_use" : "never_mentioned";
      if (kind === "never_mentioned") {
        for (const direction of [`${p.a}>${p.b}`, `${p.b}>${p.a}`]) {
          if (!(direction in searched)) fail(`${id}: a never-mentioned negative must search both labels (missing "${direction}")`);
        }
        for (const [direction, value] of Object.entries(searched)) {
          const m = SEARCHED.exec(value);
          if (m && Number(m[3]) !== 0) fail(`${id}: never-mentioned, but "${direction}" has ${m[3]} hits; quote the mention or narrow the pattern`);
        }
      }
    }
    if (p.kind !== undefined && !isKind(p.kind)) fail(`${id}: unknown kind "${p.kind}"`);
    else if (p.kind !== undefined && p.kind !== kind) fail(`${id}: kind is "${p.kind}" but its evidence makes it "${kind}"`);
    tally[kind]++;
  });

  const hash = pairsHash(truth.pairs);
  if (writeHash) {
    if (!/"pairs_sha256": "[^"]*"/.test(rawTruth)) fail('--write-hash: the file has no "pairs_sha256" field to fill');
    else {
      fs.writeFileSync(TRUTH_FILE, rawTruth.replace(/"pairs_sha256": "[^"]*"/, `"pairs_sha256": "${hash}"`));
      truth.pairs_sha256 = hash;
      console.log(`wrote pairs_sha256 ${hash}`);
    }
  } else if (truth.pairs_sha256 !== hash) {
    fail(`pairs_sha256 is ${truth.pairs_sha256 ?? "missing"} but the pairs hash to ${hash}: the pairs were edited after the list was frozen`);
  }

  report(truth, meds, { tally, quotes, quotesFound, searches, searchesMatching, hash, resolved: labels.size });
}

interface Stats {
  tally: Record<Kind, number>;
  quotes: number;
  quotesFound: number;
  searches: number;
  searchesMatching: number;
  hash: string;
  resolved: number;
}

function report(truth: Truth, meds: string[], s: Stats | null): void {
  console.log(`Interaction truth list v${String(truth.version)} (checked ${truth.checked_on}), read offline from data/label-cache/`);
  if (s) {
    const pos = s.tally.stated_by_name + s.tally.stated_by_class_only;
    const neg = s.tally.mentioned_not_co_use + s.tally.never_mentioned;
    console.log(`Medicines in eval/meds.json: ${meds.length} (${s.resolved} resolved offline)`);
    console.log(`Pairs: ${truth.pairs.length}`);
    console.log(`  positives: ${pos} (${s.tally.stated_by_name} stated by name, ${s.tally.stated_by_class_only} stated by class only)`);
    console.log(`  negatives: ${neg} (${s.tally.mentioned_not_co_use} mentioned but not as a caution about co-use, ${s.tally.never_mentioned} never mentioned)`);
    console.log(`Evidence quotes found verbatim in the parsed label sections: ${s.quotesFound}/${s.quotes}`);
    console.log(`Searched patterns re-run, recorded hit counts matching: ${s.searchesMatching}/${s.searches}`);
    console.log(`pairs_sha256: ${s.hash}`);
  }
  if (failures.length > 0) {
    for (const f of failures) console.log(`FAILED: ${f}`);
    console.log(`truth:check FAILED (${failures.length} problem${failures.length === 1 ? "" : "s"})`);
    process.exitCode = 1;
  } else {
    console.log("truth:check passed");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
