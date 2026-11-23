/**
 * Evaluation v1.
 *
 *   npm run eval                         # real model through the local claude CLI
 *   npm run eval -- --only lisinopril,warfarin
 *   CAREPOOL_PROVIDER=mock npm run eval  # offline smoke run; writes eval/results-mock.*
 *
 * Part 1 runs each of the 10 medicines in eval/meds.json through the same card
 * pipeline the app uses and reports, per medicine: sentences generated,
 * sentences kept, the share of kept sentences whose quote is found verbatim
 * (re-checked here against the raw openFDA field in the cache file, not the
 * parser's copy), what was removed and why, and the interaction flags found
 * among the 10.
 *
 * Part 2 lists the interaction flags among them. Part 3 scores the
 * deterministic interaction matcher against the hand-checked pairs in
 * eval/interaction-truth.json (precision and recall), after confirming every
 * evidence quote in that file is itself verbatim in the cached labels.
 *
 * Part 4 measures meaning with a judge model (role "judge", by default a
 * different model from the pipeline's meaning gate). It judges, in one call
 * per medicine, the sentences as they reached the gate ("before") and any
 * sentence the gate had rewritten ("after"), so before and after are scored
 * by the same instrument on the same drafts.
 *
 * Nothing is tuned here and nothing is retried to look better: a medicine
 * whose card fails is reported as failed.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { judgeSentences } from "../src/lib/cards/judge";
import type { CardSentence } from "../src/lib/cards/citations";
import { buildCard, labelTitle, type CardResult } from "../src/lib/cards/pipeline";
import { getEnv } from "../src/lib/env";
import { MATCHER_VERSION, findInteractions, toMatchingDrug, type DrugForMatching, type MatcherVersion, type PairFinding } from "../src/lib/interactions/match";
import { readCachedLabelRaw, resolveLabel, type ResolvedLabel } from "../src/lib/labels/openfda";
import { collapseWhitespace } from "../src/lib/labels/parse";
import { getProvider } from "../src/lib/model";

interface TruthPair {
  a: string;
  b: string;
  interacts: boolean;
  why: string;
  /** v2 lists: how the label states it (by name, by class only, mentioned but not co-use, never mentioned). */
  kind?: string;
  evidence: { label: string; section: string; quote: string; role?: string }[];
}

interface DrugRow {
  name: string;
  ok: boolean;
  error?: string;
  card?: CardResult;
  verbatim_raw: number;
  byte_exact_raw: number;
  flagged_partners: string[];
  seconds: number;
  judge: JudgeRow | null;
  before_gate: CardSentence[];
}

interface Tally {
  sentences: number;
  supported: number;
  partial: number;
  unsupported: number;
  unjudged: number;
}

interface JudgeNote {
  id: string;
  part: string;
  text: string;
  quote: string;
  verdict: string;
  reason: string;
}

interface JudgeRow {
  model: string;
  /** The sentences as they reached the meaning gate. */
  before: Tally;
  /** The sentences on the final card. */
  after: Tally;
  error: string | null;
  /** Final-card sentences the judge did not call supported. */
  notes: JudgeNote[];
  /** Sentences the judge did not call supported before the gate, and what the gate did with each. */
  before_notes: (JudgeNote & { gate_outcome: "kept" | "rewritten" | "removed" })[];
}

const args = process.argv.slice(2);
const onlyArg = args.find((a) => a.startsWith("--only"));
const only = onlyArg ? (onlyArg.includes("=") ? onlyArg.split("=")[1] : args[args.indexOf(onlyArg) + 1]).split(",") : null;

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(n === d ? 0 : 1)}%`;
}

function gitCommit(): string {
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim() !== "";
    return dirty ? `${sha} (with uncommitted changes)` : sha;
  } catch {
    return "unknown";
  }
}

function tallyOf(ids: string[], verdicts: Map<string, { verdict: string }>): Tally {
  const t: Tally = { sentences: ids.length, supported: 0, partial: 0, unsupported: 0, unjudged: 0 };
  for (const id of ids) {
    const v = verdicts.get(id)?.verdict;
    if (v === "supported") t.supported++;
    else if (v === "partial") t.partial++;
    else if (v === "unsupported") t.unsupported++;
    else t.unjudged++;
  }
  return t;
}

function cliVersion(): string {
  try {
    return execFileSync(process.env.CLAUDE_CLI_PATH || "claude", ["--version"], { encoding: "utf8", timeout: 120_000 }).trim();
  } catch {
    return "unknown";
  }
}

/** The raw openFDA field for a section, from the label cache file, joined and whitespace-collapsed. */
function rawSectionText(resolved: ResolvedLabel, section: string): { collapsed: string; joined: string } {
  const file = [...resolved.cache_files].reverse().find((f) => f.startsWith("label-"));
  const raw = file ? readCachedLabelRaw(file) : null;
  const value = raw?.[section];
  const parts = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  const joined = parts.join(" ");
  return { collapsed: collapseWhitespace(joined), joined };
}

async function main() {
  const env = getEnv();
  const provider = getProvider();
  const mock = provider.name === "mock";
  const started = new Date();
  const commit = gitCommit();
  const cli = mock ? "n/a (mock)" : cliVersion();
  const meds = (JSON.parse(fs.readFileSync("eval/meds.json", "utf8")) as { meds: string[] }).meds.filter((m) => !only || only.includes(m));
  const truth = JSON.parse(fs.readFileSync("eval/interaction-truth.json", "utf8")) as {
    version?: number;
    pairs: TruthPair[];
    checked_by: string;
    rule: string;
    frozen_before_scoring?: string;
    pairs_sha256?: string;
  };

  console.log(`[eval] provider=${provider.name} writer=${provider.modelFor("writer")} review=${provider.modelFor("review")} meds=${meds.length}`);

  // Labels first (cache or openFDA), so a label problem is not blamed on the model.
  const resolved = new Map<string, ResolvedLabel>();
  for (const m of meds) resolved.set(m, await resolveLabel(m));

  const rows: DrugRow[] = await Promise.all(
    meds.map(async (name): Promise<DrugRow> => {
      const t0 = Date.now();
      let beforeGate: CardSentence[] = [];
      try {
        const r = resolved.get(name)!;
        const { card } = await buildCard(
          { medKey: name, typedName: name },
          {
            provider,
            reviewEnabled: env.REVIEW_ENABLED,
            maxRepairRounds: env.MAX_REPAIR_ROUNDS,
            meaningGate: env.MEANING_GATE_ENABLED,
            onBeforeGate: (list) => (beforeGate = list),
            resolve: async () => r,
            onStep: (s) => console.log(`[eval] ${name}: ${s}`),
          },
        );
        if (!env.MEANING_GATE_ENABLED) beforeGate = card.sentences;
        let verbatim = 0;
        let byteExact = 0;
        for (const s of card.sentences) {
          const raw = rawSectionText(r, s.section);
          if (raw.collapsed.includes(s.quote)) verbatim++;
          if (raw.joined.includes(s.quote)) byteExact++;
        }
        const seconds = (Date.now() - t0) / 1000;
        let judge: JudgeRow | null = null;
        if (!mock && beforeGate.length > 0) {
          // One call: every sentence as it reached the gate, plus each final sentence the gate rewrote.
          const beforeById = new Map(beforeGate.map((x) => [x.id, x]));
          const rewritten = card.sentences.filter((x) => beforeById.has(x.id) && beforeById.get(x.id)!.text !== x.text);
          const afterId = (x: CardSentence) => (rewritten.includes(x) ? `${x.id}-rewritten` : x.id);
          const toJudge = [...beforeGate, ...rewritten.map((x) => ({ ...x, id: afterId(x) }))];
          try {
            const j = await judgeSentences(toJudge, provider, "judge");
            const note = (x: CardSentence, id: string): JudgeNote => ({ id, part: x.part, text: x.text, quote: x.quote, verdict: j.verdicts.get(id)!.verdict, reason: j.verdicts.get(id)!.reason });
            const finalIds = card.sentences.map(afterId);
            judge = {
              model: j.model,
              before: tallyOf(beforeGate.map((x) => x.id), j.verdicts),
              after: tallyOf(finalIds, j.verdicts),
              error: null,
              notes: card.sentences.filter((x) => j.verdicts.get(afterId(x)) && j.verdicts.get(afterId(x))!.verdict !== "supported").map((x) => note(x, afterId(x))),
              before_notes: beforeGate
                .filter((x) => j.verdicts.get(x.id) && j.verdicts.get(x.id)!.verdict !== "supported")
                .map((x) => {
                  const final = card.sentences.find((y) => y.id === x.id);
                  return { ...note(x, x.id), gate_outcome: !final ? "removed" : final.text === x.text ? "kept" : "rewritten" };
                }),
            };
          } catch (err) {
            const empty = (n: number): Tally => ({ sentences: n, supported: 0, partial: 0, unsupported: 0, unjudged: n });
            judge = { model: "", before: empty(beforeGate.length), after: empty(card.sentences.length), error: (err as Error).message.slice(0, 200), notes: [], before_notes: [] };
          }
          console.log(`[eval] ${name}: judged ${judge.before.supported}/${judge.before.sentences} supported before the gate, ${judge.after.supported}/${judge.after.sentences} after`);
        }
        return { name, ok: true, card, verbatim_raw: verbatim, byte_exact_raw: byteExact, flagged_partners: [], seconds, judge, before_gate: beforeGate };
      } catch (err) {
        console.log(`[eval] ${name}: FAILED ${(err as Error).message}`);
        return { name, ok: false, error: (err as Error).message, verbatim_raw: 0, byte_exact_raw: 0, flagged_partners: [], seconds: (Date.now() - t0) / 1000, judge: null, before_gate: beforeGate };
      }
    }),
  );

  // Interaction flags among the medicines evaluated.
  const drugs: DrugForMatching[] = meds.map((m) => {
    const r = resolved.get(m)!;
    return toMatchingDrug(m, m, r.label, r.classes, r.class_terms ?? []);
  });
  const findings = findInteractions(drugs);
  for (const row of rows) {
    row.flagged_partners = findings
      .filter((f) => f.flagged && f.pair.includes(row.name))
      .map((f) => (f.pair[0] === row.name ? f.pair[1] : f.pair[0]))
      .sort();
  }

  // Matcher vs. the hand-checked pairs.
  const labelFor = new Map<string, ResolvedLabel>();
  for (const p of truth.pairs) for (const n of [p.a, p.b]) if (!labelFor.has(n)) labelFor.set(n, resolved.get(n) ?? (await resolveLabel(n)));
  let evidenceTotal = 0;
  let evidenceFound = 0;
  const evidenceMissing: string[] = [];
  for (const p of truth.pairs) {
    for (const e of p.evidence) {
      evidenceTotal++;
      const text = labelFor.get(e.label)?.label.sections[e.section]?.text ?? "";
      if (text.includes(e.quote)) evidenceFound++;
      else evidenceMissing.push(`${e.label}/${e.section}: "${e.quote}"`);
    }
  }
  const scoreWith = (version: MatcherVersion) => {
    const scored = truth.pairs.map((p) => {
      const da = labelFor.get(p.a)!;
      const db = labelFor.get(p.b)!;
      const pair: PairFinding | undefined = findInteractions(
        [toMatchingDrug(p.a, p.a, da.label, da.classes, da.class_terms ?? []), toMatchingDrug(p.b, p.b, db.label, db.classes, db.class_terms ?? [])],
        version,
      )[0];
      const predicted = Boolean(pair?.flagged);
      const outcome = predicted && p.interacts ? "TP" : predicted && !p.interacts ? "FP" : !predicted && p.interacts ? "FN" : "TN";
      const top = pair?.flags.find((f) => f.polarity === "caution");
      const set = pair?.flags.find((f) => f.polarity !== "caution");
      const evidence = top
        ? `${top.a} label, ${top.section_title}: "${top.matched_text}"`
        : set
          ? `mention only (${set.polarity === "not_co_use" ? "not about co-use" : "no-effect sentence"}): ${set.a} label, "${set.matched_text}"`
          : "none";
      return { ...p, predicted, outcome, matcher_evidence: evidence };
    });
    const count = (o: string) => scored.filter((x) => x.outcome === o).length;
    const tp = count("TP");
    const fp = count("FP");
    const fn = count("FN");
    const tn = count("TN");
    return { version, scored, tp, fp, fn, tn, precision: tp / Math.max(1, tp + fp), recall: tp / Math.max(1, tp + fn) };
  };
  const v2 = scoreWith(MATCHER_VERSION);
  const v1 = scoreWith("v1");
  const scored = v2.scored;
  const { tp, fp, fn, tn } = v2;

  const okRows = rows.filter((r) => r.ok && r.card);
  const sum = (f: (r: DrugRow) => number) => okRows.reduce((a, r) => a + f(r), 0);
  const kept = sum((r) => r.card!.stats.kept);
  const verb = sum((r) => r.verbatim_raw);
  const exact = sum((r) => r.byte_exact_raw);
  const reasons = new Map<string, number>();
  okRows.forEach((r) => r.card!.removed.forEach((f) => reasons.set(f.reason, (reasons.get(f.reason) ?? 0) + 1)));
  const firstReasons = new Map<string, number>();
  okRows.forEach((r) =>
    Object.entries(r.card!.stats.first_check_failures ?? {}).forEach(([k, v]) => firstReasons.set(k, (firstReasons.get(k) ?? 0) + (v ?? 0))),
  );
  const fmtReasons = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`).join(", ") || "none";
  const models = new Set<string>();
  okRows.forEach((r) => Object.values(r.card!.models).forEach((m) => m && models.add(m)));
  const finished = new Date();
  const minutes = ((finished.getTime() - started.getTime()) / 60_000).toFixed(1);

  const md: string[] = [];
  md.push(`# Carepool evaluation v1${mock ? " (MOCK PROVIDER: not model output)" : ""}`);
  md.push("");
  md.push(`Generated by \`npm run eval\` on ${finished.toISOString()}. Do not edit by hand; re-run the script.`);
  md.push("");
  md.push("| | |");
  md.push("|---|---|");
  md.push(`| Commit | \`${commit}\` |`);
  md.push(`| Provider | \`${provider.name}\`${mock ? " (scripted template, for offline checks only)" : ` via the local Claude Code CLI (${cli})`} |`);
  md.push(`| Models (as reported by the CLI) | ${[...models].join(", ") || "none"} |`);
  md.push(`| Writer / reviewer requested | \`${provider.modelFor("writer")}\` / \`${provider.modelFor("review")}\` (review ${env.REVIEW_ENABLED ? "on" : "off"}, repair rounds ≤ ${env.MAX_REPAIR_ROUNDS}) |`);
  md.push(`| Meaning gate / eval judge requested | ${env.MEANING_GATE_ENABLED ? `\`${provider.modelFor("gate")}\`` : "off"} / \`${provider.modelFor("judge")}\` |`);
  md.push(`| Labels | openFDA drug/label, read from the committed cache in \`data/label-cache/\` |`);
  md.push(`| Medicines | ${meds.length} (${rows.filter((r) => r.ok).length} cards produced, ${rows.filter((r) => !r.ok).length} failed) |`);
  md.push(`| Wall time | ${minutes} min, at most ${env.CARD_CONCURRENCY} model calls at once |`);
  md.push(`| Tokens (input / output) | ${sum((r) => r.card!.usage.input_tokens).toLocaleString("en-US")} / ${sum((r) => r.card!.usage.output_tokens).toLocaleString("en-US")} |`);
  md.push("");
  md.push(`## 1. Card grounding (N = ${meds.length} medicines)`);
  md.push("");
  md.push("| Medicine | Label used (effective date, version) | Generated | Passed 1st check | Fixed by repair | Removed | Kept | Kept quotes verbatim | Byte-exact in raw field | Review: reworded / reverted | Flagged with (among these ${meds.length}) | Time |");
  md.push("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|");
  for (const r of rows) {
    if (!r.ok || !r.card) {
      md.push(`| ${r.name} | ${resolved.get(r.name)?.term ?? "?"} | FAILED: ${r.error?.replace(/\|/g, "/").slice(0, 160)} | | | | | | | | ${r.flagged_partners.join(", ") || "none"} | ${r.seconds.toFixed(0)} s |`);
      continue;
    }
    const c = r.card;
    md.push(
      `| ${r.name} | ${labelTitle(c.label)} (${c.label.effective_date ?? "?"}, v${c.label.version ?? "?"}) | ${c.stats.generated} | ${c.stats.passed_first_check} | ${c.stats.recovered_by_repair} | ${c.removed.length} | ${c.stats.kept} | ${r.verbatim_raw}/${c.stats.kept} (${pct(r.verbatim_raw, c.stats.kept)}) | ${r.byte_exact_raw}/${c.stats.kept} | ${c.review.changed} / ${c.review.reverted} | ${r.flagged_partners.join(", ") || "none"} | ${r.seconds.toFixed(0)} s |`,
    );
  }
  md.push(
    `| **Total** | | **${sum((r) => r.card!.stats.generated)}** | **${sum((r) => r.card!.stats.passed_first_check)}** | **${sum((r) => r.card!.stats.recovered_by_repair)}** | **${sum((r) => r.card!.removed.length)}** | **${kept}** | **${verb}/${kept} (${pct(verb, kept)})** | **${exact}/${kept}** | **${sum((r) => r.card!.review.changed)} / ${sum((r) => r.card!.review.reverted)}** | | |`,
  );
  md.push("");
  md.push(`Failed the first check, by reason (before repair): ${fmtReasons(firstReasons)}.`);
  md.push("");
  md.push(`Removed in the end (repair could not fix them), by reason: ${fmtReasons(reasons)}.`);
  md.push("");
  md.push("How to read this table:");
  md.push("");
  md.push("- **Kept quotes verbatim** is 100% by construction: the checker deletes any sentence whose quote is not word-for-word in its label section. The column shows it anyway, re-checked here against the raw openFDA field in the cache file (joined, whitespace collapsed) rather than the app's own parsed copy.");
  md.push("- **Byte-exact in raw field** is stricter: the quote appears in the raw field with no whitespace change at all. A gap between the two columns means a quote spans a line break or double space in the original label.");
  md.push("- **Failed the first check** counts sentences the writer got wrong on its first try; each one was sent back once with the checker's reason. QUOTE_NOT_FOUND means the quote was paraphrased instead of copied; DOSE_MENTION means the sentence or its quote carried a dose amount or a dosing frequency, which cards never show; WRONG_PART means the section cannot support that part of the card. **Removed** sentences never reach the family.");
  md.push(
    mock
      ? "- **Not measured in mock mode:** whether each plain-language sentence means the same thing as its quote (Part 4 runs only with the real model)."
      : "- **What the checker cannot see:** whether each plain-language sentence means the same thing as its quote. The checker proves the quote is real and in the right section; Part 4 is a first, model-judged measure of meaning, and the app always shows the quote next to the sentence so a reader can compare.",
  );
  md.push("");
  md.push(`## 2. Interaction flags among these ${meds.length} medicines`);
  md.push("");
  md.push("Found by the deterministic matcher (no model). A pair is flagged when one label's Drug Interactions, Boxed Warning, Contraindications or Warnings/Precautions section names the other medicine or its class.");
  md.push("");
  const flagged = findings.filter((f) => f.flagged);
  for (const f of flagged) {
    const firstCaution = f.flags.filter((x) => x.polarity === "caution");
    md.push(`- **${f.pair.join(" + ")}**: ${firstCaution.map((x) => `${x.a} label, ${x.section_title}, names "${x.matched_text}"`).join("; ")}`);
  }
  const mentions = findings.filter((f) => !f.flagged);
  if (mentions.length > 0) md.push(`- Mentioned but not flagged (a "no meaningful interaction" sentence, or advice that is not about using them together): ${mentions.map((f) => f.pair.join(" + ")).join(", ")}`);
  md.push("");
  md.push(`${flagged.length} flagged pair(s) out of ${(meds.length * (meds.length - 1)) / 2} possible pairs. These flags are not all checked by hand; Part 3 measures the matcher on a hand-checked subset.`);
  md.push("");
  md.push(`## 3. The matcher against ${truth.pairs.length} hand-checked pairs: v1 (baseline) and ${MATCHER_VERSION}`);
  md.push("");
  md.push(`Ground truth: \`eval/interaction-truth.json\` (version ${truth.version ?? 1}${truth.pairs_sha256 ? `, pairs fingerprint \`${truth.pairs_sha256.slice(0, 16)}…\`, checked by \`npm run truth:check\`` : ""}). ${truth.checked_by}`);
  md.push("");
  if (truth.frozen_before_scoring) {
    md.push(`Held out: ${truth.frozen_before_scoring}`);
    md.push("");
  }
  md.push(`Rule: ${truth.rule}`);
  md.push("");
  md.push(`Evidence quotes in the truth file found verbatim in the cached labels: **${evidenceFound}/${evidenceTotal}**.${evidenceMissing.length ? ` Missing: ${evidenceMissing.join("; ")}` : ""}`);
  md.push("");
  md.push("| | TP | FP | FN | TN | Precision | Recall |");
  md.push("|---|---:|---:|---:|---:|---:|---:|");
  for (const r of [v1, v2]) {
    md.push(`| Matcher ${r.version}${r.version === "v1" ? " (baseline)" : ""} | ${r.tp} | ${r.fp} | ${r.fn} | ${r.tn} | **${pct(r.tp, r.tp + r.fp)}** (${r.tp}/${r.tp + r.fp}) | **${pct(r.tp, r.tp + r.fn)}** (${r.tp}/${r.tp + r.fn}) |`);
  }
  md.push("");
  const kinds = [...new Set(truth.pairs.map((p) => p.kind).filter((k): k is string => Boolean(k)))];
  if (kinds.length > 0) {
    md.push("By how the label states it (the truth file's `kind`):");
    md.push("");
    md.push(`| Kind | Pairs | v1 right | ${MATCHER_VERSION} right |`);
    md.push("|---|---:|---:|---:|");
    for (const k of kinds) {
      const idx = truth.pairs.map((p, i) => (p.kind === k ? i : -1)).filter((i) => i >= 0);
      const right = (r: typeof v1) => idx.filter((i) => r.scored[i].outcome === "TP" || r.scored[i].outcome === "TN").length;
      md.push(`| ${k} | ${idx.length} | ${right(v1)} | ${right(v2)} |`);
    }
    md.push("");
  }
  const changed = truth.pairs.map((_, i) => i).filter((i) => v1.scored[i].outcome !== v2.scored[i].outcome);
  md.push(
    changed.length
      ? `Pairs whose outcome changed from v1 to ${MATCHER_VERSION}: ${changed.map((i) => `${truth.pairs[i].a} + ${truth.pairs[i].b} (${v1.scored[i].outcome} → ${v2.scored[i].outcome})`).join("; ")}.`
      : `No pair's outcome changed from v1 to ${MATCHER_VERSION}.`,
  );
  md.push("");
  md.push(`| Pair | Hand-checked | Kind | v1 | ${MATCHER_VERSION} | ${MATCHER_VERSION}'s evidence | Note |`);
  md.push("|---|---|---|---|---|---|---|");
  const cell3 = (t: string) => t.replace(/\|/g, "/").replace(/\s+/g, " ");
  truth.pairs.forEach((p, i) => {
    md.push(`| ${p.a} + ${p.b} | ${p.interacts ? "interacts" : "no"} | ${p.kind ?? ""} | ${v1.scored[i].outcome} | **${v2.scored[i].outcome}** | ${cell3(v2.scored[i].matcher_evidence)} | ${cell3(p.why)} |`);
  });
  md.push("");
  md.push(`- **Precision** (${MATCHER_VERSION}) = TP / (TP + FP) = ${tp} / ${tp + fp} = **${pct(tp, tp + fp)}**`);
  md.push(`- **Recall** (${MATCHER_VERSION}) = TP / (TP + FN) = ${tp} / ${tp + fn} = **${pct(tp, tp + fn)}**`);
  md.push("");
  md.push(
    `${truth.pairs.length} pairs, checked by reading label text, not by a pharmacist. One error moves precision or recall by several points. Misses are listed as they are and were not fixed after the scores were seen.`,
  );
  md.push("");

  const gateRows = okRows.filter((r) => r.card!.gate);
  const gsum = (f: (g: NonNullable<CardResult["gate"]>) => number) => gateRows.reduce((a, r) => a + f(r.card!.gate!), 0);
  if (env.MEANING_GATE_ENABLED) {
    md.push("## 4. The meaning gate");
    md.push("");
    md.push(
      `After the citation checker and the review, every kept sentence goes to the meaning gate (\`${provider.modelFor("gate")}\`): a separate call that reads each sentence next to its own quote, and only the quote, and answers supported, partial (the core is supported but the sentence adds a claim, cause or condition) or unsupported. Supported stays. Partial goes back for one rewrite with the gate's reason, must pass the citation checker again, and is judged again; if it is still not supported it is removed. Unsupported is removed.`,
    );
    md.push("");
    md.push("| Medicine | Reached the gate | Gate: supported / partial / unsupported / no verdict | Rewritten and passed | Removed: partial / unsupported / no verdict | On the card |");
    md.push("|---|---:|---:|---:|---:|---:|");
    for (const r of gateRows) {
      const g = r.card!.gate!;
      md.push(
        `| ${r.name} | ${g.checked} | ${g.first.supported} / ${g.first.partial} / ${g.first.unsupported} / ${g.first.unjudged}${g.status === "failed" ? ` (gate failed: ${(g.note ?? "").replace(/\|/g, "/").slice(0, 120)})` : ""} | ${g.repaired} | ${g.removed.partial} / ${g.removed.unsupported} / ${g.removed.unchecked} | ${r.card!.stats.kept} |`,
      );
    }
    md.push(
      `| **Total** | **${gsum((g) => g.checked)}** | **${gsum((g) => g.first.supported)} / ${gsum((g) => g.first.partial)} / ${gsum((g) => g.first.unsupported)} / ${gsum((g) => g.first.unjudged)}** | **${gsum((g) => g.repaired)}** | **${gsum((g) => g.removed.partial)} / ${gsum((g) => g.removed.unsupported)} / ${gsum((g) => g.removed.unchecked)}** | **${kept}** |`,
    );
    md.push("");
    md.push(`Gate failed to run on ${gateRows.filter((r) => r.card!.gate!.status === "failed").length} card(s); those cards keep their checked sentences and say so on screen.`);
    md.push("");
  }

  if (!mock) {
    const judged = okRows.filter((r) => r.judge && !r.judge.error);
    const jsum = (f: (j: JudgeRow) => number) => judged.reduce((a, r) => a + f(r.judge!), 0);
    const judgeModel = judged[0]?.judge?.model ?? "?";
    const bN = jsum((j) => j.before.sentences);
    const bS = jsum((j) => j.before.supported);
    const aN = jsum((j) => j.after.sentences);
    const aS = jsum((j) => j.after.supported);
    md.push(`## ${env.MEANING_GATE_ENABLED ? 5 : 4}. Meaning, measured before and after the gate (model-judged)`);
    md.push("");
    md.push(
      `The measuring judge (\`${judgeModel}\`, role \`judge\`) uses the same instructions as the gate but is ${provider.modelFor("judge") === provider.modelFor("gate") ? "**the same model as the gate**, so the after-gate number partly measures the gate agreeing with itself" : "a different model from the gate, so the gate is not grading its own work"}. It judges, in one call per medicine, every sentence as it reached the gate and every sentence the gate rewrote: before and after are scored by the same instrument, on the same drafts, in the same run. This is a model's opinion, not a pharmacist's; it points to where a person should look, and it was not used to tune anything.`,
    );
    md.push("");
    md.push("| Medicine | Before the gate: sentences | Supported | Partial | Unsupported | After the gate: sentences | Supported | Partial | Unsupported | Not judged (before / after) |");
    md.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
    for (const r of okRows) {
      const j = r.judge;
      if (!j) continue;
      md.push(
        `| ${r.name} | ${j.before.sentences} | ${j.before.supported} | ${j.before.partial} | ${j.before.unsupported} | ${j.after.sentences} | ${j.after.supported} | ${j.after.partial} | ${j.after.unsupported} | ${j.before.unjudged} / ${j.after.unjudged}${j.error ? ` (judge failed: ${j.error.replace(/\|/g, "/")})` : ""} |`,
      );
    }
    md.push(
      `| **Total** | **${bN}** | **${bS} (${pct(bS, bN)})** | **${jsum((j) => j.before.partial)}** | **${jsum((j) => j.before.unsupported)}** | **${aN}** | **${aS} (${pct(aS, aN)})** | **${jsum((j) => j.after.partial)}** | **${jsum((j) => j.after.unsupported)}** | **${jsum((j) => j.before.unjudged)} / ${jsum((j) => j.after.unjudged)}** |`,
    );
    md.push("");
    md.push(
      `Fully supported, as the judge sees it: **${bS}/${bN} (${pct(bS, bN)}) before the gate → ${aS}/${aN} (${pct(aS, aN)}) after**. Sentences lost to the gate: **${bN - aN}** of ${bN} (${pct(bN - aN, bN)}).`,
    );
    md.push("");
    const cell = (t: string) => t.replace(/\|/g, "/").replace(/\s+/g, " ");
    const beforeNotes = judged.flatMap((r) => r.judge!.before_notes.map((n) => ({ ...n, drug: r.name })));
    if (beforeNotes.length > 0) {
      md.push("Every sentence the judge did not call supported before the gate, and what the gate did with it:");
      md.push("");
      md.push("| Medicine | Judge's verdict | Sentence | Its quote | Judge's reason | Gate |");
      md.push("|---|---|---|---|---|---|");
      for (const n of beforeNotes) md.push(`| ${n.drug} | ${n.verdict} | ${cell(n.text)} | "${cell(n.quote)}" | ${cell(n.reason)} | ${n.gate_outcome} |`);
      md.push("");
    }
    const notes = judged.flatMap((r) => r.judge!.notes.map((n) => ({ ...n, drug: r.name })));
    if (notes.length > 0) {
      md.push("Sentences on the final cards that the judge still did not call supported:");
      md.push("");
      md.push("| Medicine | Verdict | Sentence | Its quote | Judge's reason |");
      md.push("|---|---|---|---|---|");
      for (const n of notes) md.push(`| ${n.drug} | ${n.verdict} | ${cell(n.text)} | "${cell(n.quote)}" | ${cell(n.reason)} |`);
      md.push("");
    }
    md.push("Next: pharmacist raters on a sample, to see how far either model's opinion can be trusted.");
    md.push("");
  }

  md.push("## How to reproduce");
  md.push("");
  md.push("```bash");
  md.push(`git clone https://github.com/ROROK20/carepool && cd carepool && git checkout ${commit.split(" ")[0]}`);
  md.push("npm ci");
  md.push("npm run truth:check            # the truth list's own quotes are in the cached labels");
  md.push("CAREPOOL_OFFLINE=1 npm run eval # labels from the committed cache; model steps through your signed-in Claude Code CLI");
  md.push("CAREPOOL_PROVIDER=mock CAREPOOL_OFFLINE=1 npm run eval  # no model at all: Parts 2-3 are deterministic and must match exactly");
  md.push("```");
  md.push("");
  md.push(
    "Parts 2 and 3 (interaction flags and the matcher's score) use no model and must come out the same on any machine. Parts 1, 4 and 5 call models, so the counts move from run to run; this file records the run it came from.",
  );
  md.push("");

  const outBase = mock ? "eval/results-mock" : "eval/results";
  fs.writeFileSync(`${outBase}.md`, `${md.join("\n")}\n`);
  fs.writeFileSync(
    `${outBase}.json`,
    `${JSON.stringify(
      {
        generated_at: finished.toISOString(),
        commit,
        cli_version: cli,
        provider: provider.name,
        gate_model: env.MEANING_GATE_ENABLED ? provider.modelFor("gate") : null,
        judge_model: provider.modelFor("judge"),
        models: [...models],
        minutes: Number(minutes),
        cards: rows.map((r) => ({
          name: r.name,
          ok: r.ok,
          error: r.error ?? null,
          label: r.card?.label ?? null,
          stats: r.card?.stats ?? null,
          review: r.card?.review ?? null,
          removed: r.card?.removed ?? [],
          sentences: r.card?.sentences ?? [],
          verbatim_raw: r.verbatim_raw,
          byte_exact_raw: r.byte_exact_raw,
          flagged_partners: r.flagged_partners,
          seconds: r.seconds,
          gate: r.card?.gate ?? null,
          before_gate: r.before_gate,
          meaning_check: r.judge,
        })),
        interactions: findings,
        matcher_version: MATCHER_VERSION,
        truth_version: truth.version ?? 1,
        truth_pairs_sha256: truth.pairs_sha256 ?? null,
        matcher_vs_truth: { tp, fp, fn, tn, precision: v2.precision, recall: v2.recall, pairs: scored },
        matcher_v1_vs_truth: { tp: v1.tp, fp: v1.fp, fn: v1.fn, tn: v1.tn, precision: v1.precision, recall: v1.recall, pairs: v1.scored },
      },
      null,
      1,
    )}\n`,
  );
  console.log(`[eval] wrote ${path.resolve(`${outBase}.md`)}`);
  console.log(`[eval] kept ${kept} sentences, verbatim ${verb}/${kept}; matcher v1 precision ${pct(v1.tp, v1.tp + v1.fp)} recall ${pct(v1.tp, v1.tp + v1.fn)}; ${MATCHER_VERSION} precision ${pct(tp, tp + fp)} recall ${pct(tp, tp + fn)}`);
  if (rows.some((r) => !r.ok)) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
