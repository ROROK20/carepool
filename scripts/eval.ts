/**
 * Evaluation v0.
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
 * Part 2 scores the deterministic interaction matcher against the 10
 * hand-checked pairs in eval/interaction-truth.json (precision and recall),
 * after confirming every evidence quote in that file is itself verbatim in
 * the cached labels.
 *
 * Nothing is tuned here and nothing is retried to look better: a medicine
 * whose card fails is reported as failed.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildCard, labelTitle, type CardResult } from "../src/lib/cards/pipeline";
import { getEnv } from "../src/lib/env";
import { findInteractions, toMatchingDrug, type DrugForMatching, type PairFinding } from "../src/lib/interactions/match";
import { readCachedLabelRaw, resolveLabel, type ResolvedLabel } from "../src/lib/labels/openfda";
import { collapseWhitespace } from "../src/lib/labels/parse";
import { getProvider } from "../src/lib/model";

interface TruthPair {
  a: string;
  b: string;
  interacts: boolean;
  why: string;
  evidence: { label: string; section: string; quote: string }[];
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
}

const args = process.argv.slice(2);
const onlyArg = args.find((a) => a.startsWith("--only"));
const only = onlyArg ? (onlyArg.includes("=") ? onlyArg.split("=")[1] : args[args.indexOf(onlyArg) + 1]).split(",") : null;

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(n === d ? 0 : 1)}%`;
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
  const meds = (JSON.parse(fs.readFileSync("eval/meds.json", "utf8")) as { meds: string[] }).meds.filter((m) => !only || only.includes(m));
  const truth = JSON.parse(fs.readFileSync("eval/interaction-truth.json", "utf8")) as { pairs: TruthPair[]; checked_by: string; rule: string };

  console.log(`[eval] provider=${provider.name} writer=${provider.modelFor("writer")} review=${provider.modelFor("review")} meds=${meds.length}`);

  // Labels first (cache or openFDA), so a label problem is not blamed on the model.
  const resolved = new Map<string, ResolvedLabel>();
  for (const m of meds) resolved.set(m, await resolveLabel(m));

  const rows: DrugRow[] = await Promise.all(
    meds.map(async (name): Promise<DrugRow> => {
      const t0 = Date.now();
      try {
        const r = resolved.get(name)!;
        const { card } = await buildCard(
          { medKey: name, typedName: name },
          {
            provider,
            reviewEnabled: env.REVIEW_ENABLED,
            maxRepairRounds: env.MAX_REPAIR_ROUNDS,
            resolve: async () => r,
            onStep: (s) => console.log(`[eval] ${name}: ${s}`),
          },
        );
        let verbatim = 0;
        let byteExact = 0;
        for (const s of card.sentences) {
          const raw = rawSectionText(r, s.section);
          if (raw.collapsed.includes(s.quote)) verbatim++;
          if (raw.joined.includes(s.quote)) byteExact++;
        }
        return { name, ok: true, card, verbatim_raw: verbatim, byte_exact_raw: byteExact, flagged_partners: [], seconds: (Date.now() - t0) / 1000 };
      } catch (err) {
        console.log(`[eval] ${name}: FAILED ${(err as Error).message}`);
        return { name, ok: false, error: (err as Error).message, verbatim_raw: 0, byte_exact_raw: 0, flagged_partners: [], seconds: (Date.now() - t0) / 1000 };
      }
    }),
  );

  // Interaction flags among the medicines evaluated.
  const drugs: DrugForMatching[] = meds.map((m) => {
    const r = resolved.get(m)!;
    return toMatchingDrug(m, m, r.label, r.classes);
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
  const scored = truth.pairs.map((p) => {
    for (const e of p.evidence) {
      evidenceTotal++;
      const text = labelFor.get(e.label)?.label.sections[e.section]?.text ?? "";
      if (text.includes(e.quote)) evidenceFound++;
      else evidenceMissing.push(`${e.label}/${e.section}: "${e.quote}"`);
    }
    const da = labelFor.get(p.a)!;
    const db = labelFor.get(p.b)!;
    const pair: PairFinding | undefined = findInteractions([toMatchingDrug(p.a, p.a, da.label, da.classes), toMatchingDrug(p.b, p.b, db.label, db.classes)])[0];
    const predicted = Boolean(pair?.flagged);
    const outcome = predicted && p.interacts ? "TP" : predicted && !p.interacts ? "FP" : !predicted && p.interacts ? "FN" : "TN";
    const top = pair?.flags.find((f) => f.polarity === "caution");
    return { ...p, predicted, outcome, matcher_evidence: top ? `${top.a} label, ${top.section_title}: "${top.matched_text}"` : "none" };
  });
  const count = (o: string) => scored.filter((s) => s.outcome === o).length;
  const tp = count("TP");
  const fp = count("FP");
  const fn = count("FN");
  const tn = count("TN");

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
  md.push(`# Carepool evaluation v0${mock ? " (MOCK PROVIDER: not model output)" : ""}`);
  md.push("");
  md.push(`Generated by \`npm run eval\` on ${finished.toISOString()}. Do not edit by hand; re-run the script.`);
  md.push("");
  md.push("| | |");
  md.push("|---|---|");
  md.push(`| Provider | \`${provider.name}\`${mock ? " (scripted template, for offline checks only)" : ` via the local Claude Code CLI (${cliVersion()})`} |`);
  md.push(`| Models (as reported by the CLI) | ${[...models].join(", ") || "none"} |`);
  md.push(`| Writer / reviewer requested | \`${provider.modelFor("writer")}\` / \`${provider.modelFor("review")}\` (review ${env.REVIEW_ENABLED ? "on" : "off"}, repair rounds ≤ ${env.MAX_REPAIR_ROUNDS}) |`);
  md.push(`| Labels | openFDA drug/label, read from the committed cache in \`data/label-cache/\` |`);
  md.push(`| Medicines | ${meds.length} (${rows.filter((r) => r.ok).length} cards produced, ${rows.filter((r) => !r.ok).length} failed) |`);
  md.push(`| Wall time | ${minutes} min, at most ${env.CARD_CONCURRENCY} model calls at once |`);
  md.push(`| Tokens (input / output) | ${sum((r) => r.card!.usage.input_tokens).toLocaleString("en-US")} / ${sum((r) => r.card!.usage.output_tokens).toLocaleString("en-US")} |`);
  md.push("");
  md.push(`## 1. Card grounding (N = ${meds.length} medicines)`);
  md.push("");
  md.push("| Medicine | Label used (effective date, version) | Generated | Passed 1st check | Fixed by repair | Removed | Kept | Kept quotes verbatim | Byte-exact in raw field | Review: reworded / reverted | Flagged with (among these 10) | Time |");
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
  md.push("- **Not measured here:** whether each plain-language sentence means the same thing as its quote. The checker proves the quote is real and in the right section; it cannot prove the paraphrase is faithful. That is why the app always shows the quote next to the sentence. A meaning check (human raters or a separate judge model, sampled) is the next evaluation step.");
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
  if (mentions.length > 0) md.push(`- Mentioned with a "no meaningful interaction" sentence (not flagged): ${mentions.map((f) => f.pair.join(" + ")).join(", ")}`);
  md.push("");
  md.push(`${flagged.length} flagged pair(s) out of ${(meds.length * (meds.length - 1)) / 2} possible pairs. These flags are not all checked by hand; Part 3 measures the matcher on a hand-checked subset.`);
  md.push("");
  md.push("## 3. The matcher against 10 hand-checked pairs");
  md.push("");
  md.push(`Ground truth: \`eval/interaction-truth.json\`. ${truth.checked_by}`);
  md.push("");
  md.push(`Rule: ${truth.rule}`);
  md.push("");
  md.push(`Evidence quotes in the truth file found verbatim in the cached labels: **${evidenceFound}/${evidenceTotal}**.${evidenceMissing.length ? ` Missing: ${evidenceMissing.join("; ")}` : ""}`);
  md.push("");
  md.push("| Pair | Hand-checked | Matcher | Outcome | Matcher's evidence | Note |");
  md.push("|---|---|---|---|---|---|");
  for (const s of scored) {
    md.push(`| ${s.a} + ${s.b} | ${s.interacts ? "interacts" : "no"} | ${s.predicted ? "flagged" : "not flagged"} | **${s.outcome}** | ${s.matcher_evidence} | ${s.why} |`);
  }
  md.push("");
  md.push(`TP ${tp} · FP ${fp} · FN ${fn} · TN ${tn}`);
  md.push("");
  md.push(`- **Precision** = TP / (TP + FP) = ${tp} / ${tp + fp} = **${pct(tp, tp + fp)}**`);
  md.push(`- **Recall** = TP / (TP + FN) = ${tp} / ${tp + fn} = **${pct(tp, tp + fn)}**`);
  md.push("");
  md.push("Ten pairs is a seed, not a benchmark: one more error moves either number by more than ten points. The misses are listed as they are, not fixed after the fact, so the numbers are not tuned to this list.");
  md.push("");

  const outBase = mock ? "eval/results-mock" : "eval/results";
  fs.writeFileSync(`${outBase}.md`, `${md.join("\n")}\n`);
  fs.writeFileSync(
    `${outBase}.json`,
    `${JSON.stringify(
      {
        generated_at: finished.toISOString(),
        provider: provider.name,
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
        })),
        interactions: findings,
        matcher_vs_truth: { tp, fp, fn, tn, precision: tp / Math.max(1, tp + fp), recall: tp / Math.max(1, tp + fn), pairs: scored },
      },
      null,
      1,
    )}\n`,
  );
  console.log(`[eval] wrote ${path.resolve(`${outBase}.md`)}`);
  console.log(`[eval] kept ${kept} sentences, verbatim ${verb}/${kept}; matcher precision ${pct(tp, tp + fp)} recall ${pct(tp, tp + fn)}`);
  if (rows.some((r) => !r.ok)) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
