import { describe, expect, it } from "vitest";
import fixture from "../fixtures/lisinopril-label.json";
import { collapseWhitespace, dailyMedUrl, formatEffectiveTime, parseLabel, stripClassSuffix } from "@/lib/labels/parse";
import { baseName, epcClasses, isCombination, pickTerm } from "@/lib/labels/openfda";

describe("parseLabel on a real openFDA label (lisinopril, cached 2026-11-17)", () => {
  const label = parseLabel(fixture);

  it("keeps identity and version fields", () => {
    expect(label.id).toBe(fixture.id);
    expect(label.set_id).toBe(fixture.set_id);
    expect(label.version).toBe(fixture.version);
    expect(label.effective_time).toBe(fixture.effective_time);
    expect(label.effective_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(label.generic_names).toEqual(["LISINOPRIL"]);
  });

  it("keeps cited sections with titles and drops HTML table fields", () => {
    expect(Object.keys(label.sections).sort()).toEqual(["adverse_reactions", "boxed_warning", "drug_interactions", "indications_and_usage"]);
    expect(label.sections.adverse_reactions_table).toBeUndefined();
    expect(label.sections.drug_interactions.title).toBe("Drug Interactions");
  });

  it("section text is the openFDA text with whitespace collapsed and nothing else changed", () => {
    for (const key of Object.keys(label.sections)) {
      const raw = (fixture as Record<string, unknown>)[key] as string[];
      expect(label.sections[key].text).toBe(collapseWhitespace(raw.join(" ")));
      expect(label.sections[key].text).not.toMatch(/\s{2,}|^\s|\s$/);
    }
  });

  it("a known label sentence is findable verbatim in the parsed section", () => {
    expect(label.sections.drug_interactions.text).toContain(
      "Potassium-sparing diuretics (spironolactone, amiloride, triamterene, and others) can increase the risk of hyperkalemia.",
    );
  });
});

describe("parseLabel edge cases", () => {
  it("rejects a label without id or set_id", () => {
    expect(() => parseLabel({ set_id: "x" })).toThrow(/no id or set_id/);
    expect(() => parseLabel(null)).toThrow();
  });

  it("handles a missing effective_time and empty sections", () => {
    const l = parseLabel({ id: "a", set_id: "b", warnings: ["   "], purpose: ["Pain reliever"] });
    expect(l.effective_date).toBeNull();
    expect(l.sections.warnings).toBeUndefined();
    expect(l.sections.purpose.text).toBe("Pain reliever");
  });

  it("joins multi-part sections with one space", () => {
    const l = parseLabel({ id: "a", set_id: "b", adverse_reactions: ["First part.\n\n", "  Second\tpart."] });
    expect(l.sections.adverse_reactions.text).toBe("First part. Second part.");
  });

  it("formats effective_time and rejects malformed values", () => {
    expect(formatEffectiveTime("20261105")).toBe("2026-11-05");
    expect(formatEffectiveTime("20261305")).toBeNull();
    expect(formatEffectiveTime("2026115")).toBeNull();
    expect(formatEffectiveTime(null)).toBeNull();
  });

  it("strips EPC suffixes and builds a DailyMed link", () => {
    expect(stripClassSuffix("Vitamin K Antagonist [EPC]")).toBe("Vitamin K Antagonist");
    expect(dailyMedUrl("abc-123")).toBe("https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=abc-123");
  });
});

describe("choosing the right label name", () => {
  it("base names drop salts, strengths and dosage forms", () => {
    expect(baseName("METFORMIN HYDROCHLORIDE")).toBe("metformin");
    expect(baseName("Lisinopril 10 mg tablet")).toBe("lisinopril");
    expect(baseName("Warfarin Sodium")).toBe("warfarin");
    expect(baseName("potassium chloride")).toBe("potassium chloride");
  });

  it("detects combination products", () => {
    expect(isCombination("LISINOPRIL AND HYDROCHLOROTHIAZIDE")).toBe(true);
    expect(isCombination("LISINOPRIL/HCTZ")).toBe(true);
    expect(isCombination("LISINOPRIL")).toBe(false);
  });

  it("never picks a combination label for a single-ingredient name (the openFDA limit=1 trap)", () => {
    const terms = [
      { term: "LISINOPRIL AND HYDROCHLOROTHIAZIDE TABLETS", count: 300 },
      { term: "LISINOPRIL AND HYDROCHLOROTHIAZIDE", count: 40 },
      { term: "LISINOPRIL", count: 154 },
    ];
    expect(pickTerm("lisinopril", terms)).toBe("LISINOPRIL");
  });

  it("matches salt forms and prefers the most common exact name", () => {
    const terms = [
      { term: "METFORMIN HCL", count: 27 },
      { term: "METFORMIN HYDROCHLORIDE", count: 266 },
      { term: "GLIPIZIDE AND METFORMIN HYDROCHLORIDE", count: 9 },
    ];
    expect(pickTerm("Metformin", terms)).toBe("METFORMIN HYDROCHLORIDE");
    expect(pickTerm("glipizide", terms)).toBeNull();
  });

  it("keeps established pharmacologic classes only, deduplicated", () => {
    expect(
      epcClasses([
        { term: "Angiotensin Converting Enzyme Inhibitor [EPC]", count: 370 },
        { term: "Angiotensin-converting Enzyme Inhibitor [EPC]", count: 3 },
        { term: "Angiotensin-converting Enzyme Inhibitors [MoA]", count: 370 },
      ]),
    ).toEqual(["Angiotensin Converting Enzyme Inhibitor"]);
  });
});

describe("release form", () => {
  it("reads the release form from the label text", async () => {
    const { labelFormulation } = await import("@/lib/labels/parse");
    expect(labelFormulation({ description: ["Metformin hydrochloride extended-release tablets, USP contain"] })).toBe("extended");
    expect(labelFormulation({ package_label_principal_display_panel: ["DOSAGE: TABLET, EXTENDED RELEASE"] })).toBe("extended");
    expect(labelFormulation({ description: ["Omeprazole delayed-release capsules"] })).toBe("delayed");
    expect(labelFormulation({ description: ["Metformin hydrochloride tablets, USP contain"] })).toBe("immediate");
  });

  it("an extended-release hint comes only from what the family typed", async () => {
    const { formulationHint, formulationMismatch } = await import("@/lib/labels/openfda");
    expect(formulationHint("Metformin ER 500 mg")).toBe("extended");
    expect(formulationHint("metoprolol succinate 24 hr tablet")).toBe("extended");
    expect(formulationHint("Metformin 500 mg tablet twice daily")).toBeNull();
    expect(formulationHint("Lisinopril 10 mg; ask Dr. Sanders")).toBeNull();
    expect(formulationMismatch(null, "extended")).toBe(true);
    expect(formulationMismatch(null, "immediate")).toBe(false);
    expect(formulationMismatch("extended", "immediate")).toBe(true);
    expect(formulationMismatch(null, "delayed")).toBe(false);
  });
});

describe("route of administration", () => {
  it("prefers by-mouth labels unless the entry names another route", async () => {
    const { routeHint, routeMismatch, filterOrder } = await import("@/lib/labels/openfda");
    expect(routeHint("Furosemide 20 mg tablet")).toBe("oral");
    expect(routeHint("Insulin glargine pen, 10 units at bedtime")).toBe("other");
    expect(routeHint("albuterol inhaler 2 puffs")).toBe("other");
    expect(routeHint("timolol eye drops")).toBe("other");
    expect(routeHint("Lisinopril 10 mg; take with water")).toBe("oral");
    expect(routeMismatch("oral", ["INTRAMUSCULAR", "INTRAVENOUS"])).toBe(true);
    expect(routeMismatch("oral", ["ORAL"])).toBe(false);
    expect(routeMismatch("other", ["ORAL"])).toBe(true);
    expect(routeMismatch("oral", [])).toBe(false);
    expect(filterOrder("ir", true)).toEqual([
      { form: "ir", oral: true },
      { form: null, oral: true },
      { form: "ir", oral: false },
      { form: null, oral: false },
    ]);
    expect(filterOrder("er", false)).toEqual([
      { form: "er", oral: false },
      { form: null, oral: false },
    ]);
  });
});
