import { beforeAll, describe, expect, it } from "vitest";
import type { ResolvedLabel } from "@/lib/labels/openfda";
import { parseLabel } from "@/lib/labels/parse";
import { createMed, replaceExplanations, resetAll, saveLabel, setRecipient } from "@/lib/repo";
import { interactionsView, pharmacistQuestion, sheetView } from "@/lib/views";

/**
 * The doctor-visit sheet's data: every medicine exactly as typed, and only
 * the pairs that are really flagged. The Nana Rosa seed has no pair whose
 * only mention is "no meaningful interaction", so that case is built here.
 */

function labelFor(query: string, generic: string, drugInteractions?: string): ResolvedLabel {
  const raw: Record<string, unknown> = {
    id: `label-${generic.toLowerCase()}`,
    set_id: `set-${generic.toLowerCase()}`,
    version: "1",
    effective_time: "20261101",
    openfda: { generic_name: [generic], manufacturer_name: ["Example Labs"] },
    indications_and_usage: [`${generic} is indicated for testing.`],
    ...(drugInteractions ? { drug_interactions: [drugInteractions] } : {}),
  };
  return {
    query,
    matched_by: "generic",
    term: generic,
    label: parseLabel(raw),
    raw,
    cache_files: [],
    fetched_at: "2026-11-01T00:00:00.000Z",
    classes: [],
    class_source: "none",
    formulation_wanted: null,
    formulation_mismatch: false,
    route_wanted: "oral",
    route_mismatch: false,
  };
}

const CAUTION = "Potassium-sparing diuretics (spironolactone) can increase the risk of hyperkalemia.";
const NO_EFFECT = "Coadministration did not alter the pharmacokinetics of warfarin.";

beforeAll(() => {
  resetAll();
  setRecipient({ name: "Test Person", age: 80, fictional: true, notice: null });
  createMed({ id: "med-testopril", name: "Testopril", dose: "10 mg tablet, once daily", times: ["08:00"], notes: "with water" });
  createMed({ id: "med-spironolactone", name: "Spironolactone", dose: "25 mg tablet", times: ["08:00", "20:00"] });
  createMed({ id: "med-warfarin", name: "Warfarin", dose: "", times: [] });
  createMed({ id: "med-mystery", name: "Mystery drops", dose: "2 drops", times: [] });
  saveLabel("med-testopril", labelFor("Testopril", "TESTOPRIL", `${CAUTION} ${NO_EFFECT}`));
  saveLabel("med-spironolactone", labelFor("Spironolactone", "SPIRONOLACTONE"));
  saveLabel("med-warfarin", labelFor("Warfarin", "WARFARIN"));
});

describe("sheetView", () => {
  it("lists every medicine exactly as typed, in order, a blank dose included", () => {
    const v = sheetView();
    expect(v.recipient?.name).toBe("Test Person");
    expect(v.meds.map(({ med }) => [med.name, med.dose, med.times, med.notes])).toEqual([
      ["Testopril", "10 mg tablet, once daily", ["08:00"], "with water"],
      ["Spironolactone", "25 mg tablet", ["08:00", "20:00"], ""],
      ["Warfarin", "", [], ""],
      ["Mystery drops", "2 drops", [], ""],
    ]);
    // No card has been made, so no medicine claims a card label.
    expect(v.meds.every((m) => m.label === null)).toBe(true);
    expect(v.meds_without_label.map((m) => m.name)).toEqual(["Mystery drops"]);
    expect(v.checked_meds).toBe(3);
  });

  it("shows only flagged pairs: a pair whose only mention is 'no meaningful interaction' is not a flag", () => {
    const all = interactionsView().pairs;
    expect(all.map((p) => [p.names.join(" + "), p.flagged])).toEqual([
      ["Spironolactone + Testopril", true],
      ["Testopril + Warfarin", false],
    ]);
    expect(all[1].flags.map((f) => f.polarity)).toEqual(["no_effect_noted"]);

    const v = sheetView();
    expect(v.questions.map((q) => q.names)).toEqual([["Spironolactone", "Testopril"]]);
    expect(v.questions[0].flags.map((f) => [f.a_name, f.section_title, f.quote])).toEqual([["Testopril", "Drug Interactions", CAUTION]]);
    expect(JSON.stringify(v.questions)).not.toContain(NO_EFFECT);
  });

  it("asks what the home page asks: which label names which term, while there is no checked explanation", () => {
    const [q] = sheetView().questions;
    expect(q.question).toEqual({ text: "The Testopril label names spironolactone.", explanation: null });
  });

  it("uses a checked explanation, and ignores one whose quote is not in the label", () => {
    const flagId = sheetView().questions[0].flags[0].id;
    replaceExplanations([{ flag_id: flagId, sentences: [{ text: "The Testopril label says spironolactone can raise potassium.", quote: CAUTION }], model: "test-model" }], "claude-cli");
    let [q] = sheetView().questions;
    expect(q.question.text).toBe("The Testopril label says spironolactone can raise potassium.");
    expect(q.question.explanation?.model).toBe("test-model");
    expect(pharmacistQuestion(q)).toEqual(q.question);

    replaceExplanations([{ flag_id: flagId, sentences: [{ text: "Invented.", quote: "This sentence is not in the label." }], model: "test-model" }], "claude-cli");
    [q] = sheetView().questions;
    expect(q.question).toEqual({ text: "The Testopril label names spironolactone.", explanation: null });
  });
});
