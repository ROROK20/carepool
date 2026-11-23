import { describe, expect, it } from "vitest";
import { buildCard } from "@/lib/cards/pipeline";
import { explainFlags, flagsToExplain } from "@/lib/interactions/explain";
import { findInteractions, type DrugForMatching } from "@/lib/interactions/match";
import type { ResolvedLabel } from "@/lib/labels/openfda";
import { parseLabel } from "@/lib/labels/parse";
import { getProvider, type Provider } from "@/lib/model";
import { MOCK_ADDED_CLAIM, MOCK_UNSUPPORTED_ID } from "@/lib/model/mock";
import type { ModelRequest } from "@/lib/model/types";

const raw = {
  id: "label-1",
  set_id: "set-1",
  version: "3",
  effective_time: "20261105",
  openfda: { generic_name: ["TESTOPRIL"], brand_name: ["Testopril"], manufacturer_name: ["Example Labs"] },
  indications_and_usage: ["Testopril is indicated for the treatment of hypertension in adults."],
  adverse_reactions: ["The most common adverse reactions are headache, dizziness and cough. Rarely, a rash was reported in 2% of patients."],
  dosage_and_administration: ["The usual dose is 10 mg once daily. Testopril may be taken with or without food."],
  warnings_and_cautions: ["Angioedema of the face, lips and tongue has been reported. Stop and seek help right away if this happens."],
  drug_interactions: ["Potassium-sparing diuretics (spironolactone) can increase the risk of hyperkalemia."],
};
const label = parseLabel(raw);
const resolved: ResolvedLabel = {
  query: "Testopril",
  matched_by: "generic",
  term: "TESTOPRIL",
  label,
  raw,
  cache_files: ["label-generic__testopril.json"],
  fetched_at: "2026-11-17T00:00:00.000Z",
  classes: ["Angiotensin Converting Enzyme Inhibitor"],
  class_source: "ndc",
  formulation_wanted: null,
  formulation_mismatch: false,
  route_wanted: "oral",
  route_mismatch: false,
};
const resolve = async () => resolved;

/** A scripted model: per role, a function from request to output. */
function scripted(script: Partial<Record<ModelRequest["role"], (req: ModelRequest) => unknown>>): Provider {
  return {
    name: "claude-cli",
    modelFor: () => "scripted",
    model: async (req) => {
      const fn = script[req.role];
      if (!fn) throw new Error(`no script for ${req.role}`);
      return { output: fn(req), model: `scripted-${req.role}`, duration_ms: 1, usage: { input_tokens: 10, output_tokens: 5 } };
    },
  };
}

const goodDraft = {
  sentences: [
    { part: "uses", text: "It treats high blood pressure in adults.", section: "indications_and_usage", quote: "indicated for the treatment of hypertension in adults" },
    { part: "side_effects", text: "Headache, dizziness and cough are common.", section: "adverse_reactions", quote: "headache, dizziness and cough" },
    { part: "side_effects", text: "A rash happened in 5% of people.", section: "adverse_reactions", quote: "a rash was reported in 2% of patients" },
    { part: "how_to_take", text: "Take 10 mg each morning.", section: "dosage_and_administration", quote: "The usual dose is 10 mg once daily." },
    { part: "warnings", text: "Swelling of the face, lips or tongue can happen.", section: "warnings_and_cautions", quote: "Angioedema of the face, lips and tongue has been reported." },
  ],
};

describe("buildCard", () => {
  it("keeps only checked sentences, repairs what it can, and records why the rest were removed", async () => {
    const provider = scripted({
      writer: () => goodDraft,
      repair: () => ({
        sentences: [
          // s3 repaired correctly; s4 "repaired" but still states a dose.
          { id: "s3", part: "side_effects", text: "A rash happened in 2% of people.", section: "adverse_reactions", quote: "a rash was reported in 2% of patients" },
          { id: "s4", part: "how_to_take", text: "It can be taken with or without food.", section: "dosage_and_administration", quote: "The usual dose is 10 mg once daily." },
          // an id that never failed is ignored
          { id: "s1", part: "uses", text: "Invented.", section: "indications_and_usage", quote: "nothing like this" },
        ],
      }),
      review: (req) => ({
        sentences: (req.context.role === "review" ? req.context.sentences : []).map((s) =>
          s.id === "s2" ? { id: s.id, text: "Common side effects are headache, dizziness and cough." } : s.id === "s5" ? { id: s.id, text: "Swelling happens in 50% of people." } : s,
        ),
      }),
    });
    const { card } = await buildCard({ medKey: "m1", typedName: "Testopril" }, { provider, reviewEnabled: true, maxRepairRounds: 1, resolve });

    expect(card.stats).toMatchObject({ generated: 5, passed_first_check: 3, recovered_by_repair: 1, repair_rounds: 1, kept: 4, verbatim_kept: 4 });
    expect(card.sentences.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s5"]);
    expect(card.removed.map((f) => [f.id, f.reason])).toEqual([["s4", "DOSE_MENTION"]]);
    // review: s2 accepted, s5 reverted (it added an ungrounded number)
    expect(card.review).toMatchObject({ status: "applied", changed: 1, reverted: 1, reverted_ids: ["s5"] });
    expect(card.sentences.find((s) => s.id === "s2")?.text).toBe("Common side effects are headache, dizziness and cough.");
    expect(card.sentences.find((s) => s.id === "s5")?.text).toBe("Swelling of the face, lips or tongue can happen.");
    for (const s of card.sentences) expect(label.sections[s.section].text.includes(s.quote)).toBe(true);
    expect(card.label).toMatchObject({ effective_date: "2026-11-05", version: "3", set_id: "set-1" });
    expect(card.models).toEqual({ writer: "scripted-writer", repair: "scripted-repair", review: "scripted-review", gate: null });
    expect(card.gate?.status).toBe("disabled");
    expect(card.usage).toEqual({ input_tokens: 30, output_tokens: 15 });
  });

  it("a review that throws keeps the checked wording", async () => {
    const provider = scripted({
      writer: () => ({ sentences: goodDraft.sentences.slice(0, 2) }),
      review: () => {
        throw new Error("usage limit reached");
      },
    });
    const { card } = await buildCard({ medKey: "m1", typedName: "Testopril" }, { provider, reviewEnabled: true, maxRepairRounds: 0, resolve });
    expect(card.review.status).toBe("failed");
    expect(card.sentences.map((s) => s.text)).toEqual(goodDraft.sentences.slice(0, 2).map((s) => s.text));
  });

  it("rejects a malformed writer answer instead of guessing", async () => {
    const provider = scripted({ writer: () => ({ sentences: [{ part: "uses", text: "x" }] }) });
    await expect(buildCard({ medKey: "m1", typedName: "T" }, { provider, reviewEnabled: false, maxRepairRounds: 0, resolve })).rejects.toThrow(/schema/);
  });

  it("the mock provider runs the real checker and its planted sentence is removed", async () => {
    const { card } = await buildCard({ medKey: "m1", typedName: "Testopril" }, { provider: getProvider("mock"), reviewEnabled: true, maxRepairRounds: 1, resolve });
    expect(card.provider).toBe("mock");
    expect(card.removed.map((r) => r.reason)).toContain("QUOTE_NOT_FOUND");
    expect(card.removed.find((r) => r.text.includes("common cold"))).toBeTruthy();
    expect(card.sentences.length).toBeGreaterThan(0);
    expect(card.sentences.every((s) => s.id !== MOCK_UNSUPPORTED_ID)).toBe(true);
    expect(card.stats.verbatim_kept).toBe(card.stats.kept);
  });
});

describe("explainFlags", () => {
  const a: DrugForMatching = { key: "testopril", display: "Testopril", names: ["testopril"], classes: [], sections: label.sections };
  const b: DrugForMatching = { key: "spironolactone", display: "Spironolactone", names: ["spironolactone"], classes: [], sections: {} };
  const drugs = new Map([a, b].map((d) => [d.key, d]));
  const flags = flagsToExplain(findInteractions([a, b]));

  it("explains only the flags it was given and checks every quote", async () => {
    expect(flags).toHaveLength(1);
    const provider = scripted({
      explain: () => ({
        explanations: [
          {
            flag_id: flags[0].id,
            sentences: [
              { text: "Taking them together can raise potassium.", quote: "can increase the risk of hyperkalemia" },
              // a second claim with no support in its quote is dropped, the first is kept
              { text: "Potassium should be checked within 3 days.", quote: "can increase the risk of hyperkalemia" },
            ],
          },
          { flag_id: "made-up>flag", sentences: [{ text: "These two also interact.", quote: "can increase the risk of hyperkalemia" }] },
        ],
      }),
    });
    const r = await explainFlags(flags, drugs, provider);
    expect(r.explanations).toEqual([
      { flag_id: flags[0].id, sentences: [{ text: "Taking them together can raise potassium.", quote: "can increase the risk of hyperkalemia" }] },
    ]);
    expect(r.dropped.map((d) => d.reason).sort()).toEqual(["UNKNOWN_FLAG", "UNGROUNDED_TOKEN"].sort());
  });

  it("drops an explanation whose quote is not in the flagged section", async () => {
    const provider = scripted({ explain: () => ({ explanations: [{ flag_id: flags[0].id, sentences: [{ text: "Potassium may rise.", quote: "potassium may rise a lot" }] }] }) });
    const r = await explainFlags(flags, drugs, provider);
    expect(r.explanations).toEqual([]);
    expect(r.dropped[0].reason).toBe("QUOTE_NOT_FOUND");
  });
});

describe("duplicate quotes", () => {
  it("two sentences citing the same words keep only the first", async () => {
    const provider = scripted({
      writer: () => ({
        sentences: [
          { part: "uses", text: "It treats high blood pressure in adults.", section: "indications_and_usage", quote: "indicated for the treatment of hypertension in adults" },
          { part: "uses", text: "Adults take it for high blood pressure.", section: "indications_and_usage", quote: "indicated for the treatment of hypertension in adults" },
        ],
      }),
    });
    const { card } = await buildCard({ medKey: "m1", typedName: "Testopril" }, { provider, reviewEnabled: false, maxRepairRounds: 0, resolve });
    expect(card.sentences.map((s) => s.id)).toEqual(["s1"]);
    expect(card.removed.map((r) => [r.id, r.reason])).toEqual([["s2", "DUPLICATE_QUOTE"]]);
  });
});

describe("meaning gate", () => {
  const draft = {
    sentences: [
      { part: "uses", text: "It treats high blood pressure in adults.", section: "indications_and_usage", quote: "indicated for the treatment of hypertension in adults" },
      { part: "side_effects", text: "Headache, dizziness and cough are common.", section: "adverse_reactions", quote: "headache, dizziness and cough" },
      { part: "side_effects", text: "Cough happens because the medicine irritates the throat.", section: "adverse_reactions", quote: "The most common adverse reactions are headache, dizziness and cough." },
      { part: "warnings", text: "Swelling of the face can happen, mostly in older adults.", section: "warnings_and_cautions", quote: "Angioedema of the face, lips and tongue has been reported." },
      { part: "warnings", text: "Seek help right away if this happens.", section: "warnings_and_cautions", quote: "Stop and seek help right away if this happens." },
      { part: "uses", text: "It cures kidney disease.", section: "indications_and_usage", quote: "Testopril is indicated for the treatment of hypertension in adults." },
    ],
  };

  it("keeps supported sentences, rewrites partial ones once, and removes what still fails, with the check's reason", async () => {
    let gateCalls = 0;
    const seen: string[][] = [];
    const before: string[] = [];
    const provider = scripted({
      writer: () => draft,
      repair: () => ({
        sentences: [
          // s3 rewritten to match its quote; s4 rewritten but still adds a claim.
          { id: "s3", part: "side_effects", text: "Cough is one of the most common side effects.", section: "adverse_reactions", quote: "The most common adverse reactions are headache, dizziness and cough." },
          { id: "s4", part: "warnings", text: "Swelling of the face, mostly in older adults, has been reported.", section: "warnings_and_cautions", quote: "Angioedema of the face, lips and tongue has been reported." },
        ],
      }),
      gate: (req) => {
        gateCalls++;
        const sentences = req.context.role === "gate" ? req.context.sentences : [];
        seen.push(sentences.map((x) => x.id));
        if (gateCalls === 1)
          return {
            verdicts: [
              { id: "s1", verdict: "supported", reason: "" },
              { id: "s2", verdict: "supported", reason: "" },
              { id: "s3", verdict: "partial", reason: "The quote gives no cause for the cough." },
              { id: "s4", verdict: "partial", reason: "The quote does not say older adults." },
              // s5 left out: no verdict on the first call
              { id: "s6", verdict: "unsupported", reason: "The quote says hypertension, not kidney disease." },
            ],
          };
        return {
          verdicts: [
            { id: "s3", verdict: "supported", reason: "" },
            { id: "s4", verdict: "partial", reason: "Still says older adults." },
            { id: "s5", verdict: "supported", reason: "" },
          ],
        };
      },
    });
    const { card } = await buildCard(
      { medKey: "m1", typedName: "Testopril" },
      { provider, reviewEnabled: false, maxRepairRounds: 1, meaningGate: true, resolve, onBeforeGate: (list) => before.push(...list.map((x) => x.id)) },
    );

    expect(before).toEqual(["s1", "s6", "s2", "s3", "s4", "s5"]);
    // second call: the two rewrites (both pass the citation checker) and the sentence skipped the first time
    expect(seen).toEqual([["s1", "s6", "s2", "s3", "s4", "s5"], ["s3", "s4", "s5"]]);
    expect(card.sentences.map((x) => x.id)).toEqual(["s1", "s2", "s3", "s5"]);
    expect(card.sentences.find((x) => x.id === "s3")?.text).toBe("Cough is one of the most common side effects.");
    expect(card.removed.map((f) => [f.id, f.reason, f.detail])).toEqual([
      ["s6", "MEANING_UNSUPPORTED", "The quote says hypertension, not kidney disease."],
      ["s4", "MEANING_PARTIAL", "Still says older adults."],
    ]);
    // The family-facing removed entry keeps the sentence as it was written, not the failed rewrite.
    expect(card.removed.find((f) => f.id === "s4")?.text).toBe("Swelling of the face can happen, mostly in older adults.");
    expect(card.gate).toMatchObject({
      status: "applied",
      model: "scripted-gate",
      checked: 6,
      first: { supported: 2, partial: 2, unsupported: 1, unjudged: 1 },
      repaired: 1,
      removed: { partial: 1, unsupported: 1, unchecked: 0 },
      note: null,
    });
    expect(card.stats.kept).toBe(4);
    expect(card.models.gate).toBe("scripted-gate");
    // writer + gate + repair + gate
    expect(card.usage).toEqual({ input_tokens: 40, output_tokens: 20 });
    for (const x of card.sentences) expect(label.sections[x.section].text.includes(x.quote)).toBe(true);
  });

  it("a rewrite must pass the citation checker again before it is judged", async () => {
    let gateCalls = 0;
    const provider = scripted({
      writer: () => ({ sentences: draft.sentences.slice(2, 3) }),
      // the rewrite paraphrases its quote: the citation checker rejects it, so it is never re-judged
      repair: () => ({ sentences: [{ id: "s1", part: "side_effects", text: "Cough is common.", section: "adverse_reactions", quote: "cough is common" }] }),
      gate: () => {
        gateCalls++;
        return { verdicts: [{ id: "s1", verdict: "partial", reason: "No cause in the quote." }] };
      },
    });
    const { card } = await buildCard({ medKey: "m1", typedName: "Testopril" }, { provider, reviewEnabled: false, maxRepairRounds: 1, meaningGate: true, resolve });
    expect(gateCalls).toBe(1);
    expect(card.sentences).toEqual([]);
    expect(card.removed.map((f) => [f.id, f.reason, f.detail])).toEqual([["s1", "MEANING_PARTIAL", "No cause in the quote."]]);
  });

  it("with no repair rounds a partial sentence is removed without a rewrite", async () => {
    const provider = scripted({
      writer: () => ({ sentences: draft.sentences.slice(0, 3) }),
      gate: (req) => ({
        verdicts: (req.context.role === "gate" ? req.context.sentences : []).map((x) => ({ id: x.id, verdict: x.id === "s3" ? "partial" : "supported", reason: x.id === "s3" ? "Adds a cause." : "" })),
      }),
    });
    const { card } = await buildCard({ medKey: "m1", typedName: "Testopril" }, { provider, reviewEnabled: false, maxRepairRounds: 0, meaningGate: true, resolve });
    expect(card.sentences.map((x) => x.id)).toEqual(["s1", "s2"]);
    expect(card.removed.map((f) => f.reason)).toEqual(["MEANING_PARTIAL"]);
    expect(card.gate?.repaired).toBe(0);
  });

  it("a gate that throws keeps the checked sentences and says the meaning check did not run", async () => {
    const provider = scripted({
      writer: () => ({ sentences: draft.sentences.slice(0, 2) }),
      gate: () => {
        throw new Error("usage limit reached");
      },
    });
    const { card } = await buildCard({ medKey: "m1", typedName: "Testopril" }, { provider, reviewEnabled: false, maxRepairRounds: 1, meaningGate: true, resolve });
    expect(card.sentences.map((x) => x.id)).toEqual(["s1", "s2"]);
    expect(card.gate?.status).toBe("failed");
    expect(card.gate?.note).toMatch(/did not run \(usage limit reached\)/);
    expect(card.removed).toEqual([]);
  });

  it("a sentence the gate never judges, twice, is removed as unchecked", async () => {
    const provider = scripted({
      writer: () => ({ sentences: draft.sentences.slice(0, 2) }),
      gate: () => ({ verdicts: [{ id: "s1", verdict: "supported", reason: "" }] }),
    });
    const { card } = await buildCard({ medKey: "m1", typedName: "Testopril" }, { provider, reviewEnabled: false, maxRepairRounds: 1, meaningGate: true, resolve });
    expect(card.sentences.map((x) => x.id)).toEqual(["s1"]);
    expect(card.removed.map((f) => [f.id, f.reason])).toEqual([["s2", "MEANING_UNCHECKED"]]);
    expect(card.gate?.removed.unchecked).toBe(1);
  });

  it("the mock provider's added-claim sentence passes the citation checker and is removed by the gate", async () => {
    const raw2 = {
      ...raw,
      warnings_and_cautions: [`${raw.warnings_and_cautions[0]} Low blood pressure can happen in patients who are dehydrated or also take diuretics.`],
    };
    const resolved2: ResolvedLabel = { ...resolved, raw: raw2, label: parseLabel(raw2) };
    const { card } = await buildCard(
      { medKey: "m1", typedName: "Testopril" },
      { provider: getProvider("mock"), reviewEnabled: true, maxRepairRounds: 1, meaningGate: true, resolve: async () => resolved2 },
    );
    const removed = card.removed.find((r) => r.text.endsWith(MOCK_ADDED_CLAIM));
    expect(removed?.reason).toBe("MEANING_PARTIAL");
    expect(card.sentences.some((x) => x.text.endsWith(MOCK_ADDED_CLAIM))).toBe(false);
    expect(card.gate).toMatchObject({ status: "applied", first: { partial: 1, unsupported: 0 }, removed: { partial: 1 } });
  });
});
