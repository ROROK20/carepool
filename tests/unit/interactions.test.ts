import { describe, expect, it } from "vitest";
import { derivedClassPhrases } from "@/lib/interactions/classes";
import {
  MATCHER_VERSION,
  classPhrasesFor,
  findInteractions,
  identityNames,
  isAdjectivalUse,
  isStepUpAdvice,
  matchDirection,
  polarityOf,
  sentenceSpan,
  termRegex,
  type DrugForMatching,
} from "@/lib/interactions/match";
import { resolveLabel } from "@/lib/labels/openfda";

const section = (key: string, text: string) => ({ [key]: { key, title: key, text } });

const drug = (over: Partial<DrugForMatching> & { key: string }): DrugForMatching => ({
  display: over.key,
  names: [over.key],
  classes: [],
  sections: {},
  ...over,
});

describe("term matching", () => {
  it("is word-bounded, handles plurals and hyphen/space variants", () => {
    const re = termRegex("potassium-sparing diuretic");
    expect("Potassium sparing diuretics (spironolactone)".match(re)?.[0]).toBe("Potassium sparing diuretics");
    expect(termRegex("statin").test("atorvastatin")).toBe(false);
    expect(termRegex("thiazide").test("hydrochlorothiazide")).toBe(false);
  });

  it("matches acronyms case-sensitively", () => {
    expect(termRegex("ARB").test("ARBs may raise potassium")).toBe(true);
    expect(termRegex("ARB").test("an arbitrary note")).toBe(false);
    expect(termRegex("ACE inhibitor").test("ace inhibitors")).toBe(true);
  });

  it("identity names drop short and combination names", () => {
    expect(identityNames("Warfarin", ["WARFARIN SODIUM"], ["Jantoven", "Warfarin Sodium", "ASA/Warfarin"])).toEqual(["warfarin", "Jantoven", "Warfarin Sodium"]);
  });
});

describe("matchDirection", () => {
  const lisinopril = drug({
    key: "lisinopril",
    classes: ["Angiotensin Converting Enzyme Inhibitor"],
    sections: section(
      "drug_interactions",
      "7.1 Diuretics Patients on diuretics may experience hypotension. Potassium-sparing diuretics (spironolactone, amiloride, triamterene, and others) can increase the risk of hyperkalemia. 7.4 Other ACE inhibitors, including lisinopril, should not be combined.",
    ),
  });
  const spironolactone = drug({ key: "spironolactone", classes: ["Aldosterone Antagonist"] });

  it("flags a name and quotes the verbatim sentence around it", () => {
    const flags = matchDirection(lisinopril, spironolactone);
    expect(flags).toHaveLength(1);
    const f = flags[0];
    expect(f.kind).toBe("name");
    expect(f.quote).toBe("Potassium-sparing diuretics (spironolactone, amiloride, triamterene, and others) can increase the risk of hyperkalemia.");
    expect(lisinopril.sections.drug_interactions.text.includes(f.quote)).toBe(true);
    expect(f.polarity).toBe("caution");
  });

  it("flags by class phrase when the name is absent", () => {
    const enalaprilLike = drug({
      key: "spironolactone",
      sections: section("drug_interactions", "Check serum potassium levels when ACE inhibitor or ARB therapy is altered."),
    });
    const f = matchDirection(enalaprilLike, drug({ key: "lisinopril", classes: ["Angiotensin Converting Enzyme Inhibitor"] }));
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe("class");
    expect(f[0].class_name).toBe("Angiotensin Converting Enzyme Inhibitor");
    expect(f[0].matched_text).toBe("ACE inhibitor");
  });

  it("skips a class phrase both drugs share (a label naming its own class)", () => {
    const enalapril = drug({ key: "enalapril", classes: ["Angiotensin Converting Enzyme Inhibitor"] });
    expect(matchDirection(lisinopril, enalapril)).toEqual([]);
  });

  it("ignores sections outside the interaction and warning set", () => {
    const a = drug({ key: "a", sections: section("adverse_reactions", "Use with warfarin was common.") });
    expect(matchDirection(a, drug({ key: "warfarin" }))).toEqual([]);
  });

  it("does not treat an adjective as a class mention", () => {
    expect(isAdjectivalUse("reduce the diuretic, natriuretic and antihypertensive effect", "reduce the diuretic".length)).toBe(true);
    const spiro = drug({ key: "spironolactone", sections: section("drug_interactions", "NSAIDs: May reduce the diuretic, natriuretic and antihypertensive effect of spironolactone.") });
    expect(matchDirection(spiro, drug({ key: "furosemide", classes: ["Loop Diuretic"] }))).toEqual([]);
  });

  it("marks 'no meaningful interaction' sentences as no_effect_noted, not cautions", () => {
    expect(polarityOf("Atorvastatin had no clinically significant effect on prothrombin time when given with warfarin.")).toBe("no_effect_noted");
    expect(polarityOf("Coadministration did not alter the pharmacokinetics of warfarin.")).toBe("no_effect_noted");
    expect(polarityOf("Concomitant use with warfarin may increase the risk of bleeding.")).toBe("caution");
    const a = drug({ key: "a", sections: section("drug_interactions", "Coadministration did not alter the pharmacokinetics of warfarin.") });
    const pairs = findInteractions([a, drug({ key: "warfarin" })]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].flagged).toBe(false);
    expect(pairs[0].flags[0].polarity).toBe("no_effect_noted");
  });
});

describe("sentenceSpan", () => {
  it("does not split on e.g. and keeps the full stop", () => {
    const text = "Intro. Drugs (e.g. warfarin) raise bleeding risk. Next one.";
    const at = text.indexOf("warfarin");
    const span = sentenceSpan(text, at, at + 8);
    expect(text.slice(span.start, span.end)).toBe("Drugs (e.g. warfarin) raise bleeding risk.");
  });

  it("windows very long sentences around the match and says so", () => {
    const text = `${"word ".repeat(200)}warfarin ${"word ".repeat(200)}end.`;
    const at = text.indexOf("warfarin");
    const span = sentenceSpan(text, at, at + 8);
    expect(span.end - span.start).toBeLessThanOrEqual(420);
    expect(text.slice(span.start, span.end)).toContain("warfarin");
    expect(span.clipped_start && span.clipped_end).toBe(true);
  });
});

describe("findInteractions on the cached Nana Rosa labels (real label text)", () => {
  it("finds exactly the three label-stated pairs and nothing else", async () => {
    const names = ["lisinopril", "spironolactone", "warfarin", "sertraline", "metformin"];
    const drugs: DrugForMatching[] = [];
    for (const n of names) {
      const r = await resolveLabel(n);
      drugs.push({ key: n, display: n, names: identityNames(n, r.label.generic_names, r.label.brand_names), classes: r.classes, sections: r.label.sections });
    }
    const found = findInteractions(drugs).filter((p) => p.flagged).map((p) => p.pair.join("+"));
    expect(found.sort()).toEqual(["lisinopril+metformin", "lisinopril+spironolactone", "sertraline+warfarin"]);
    for (const p of findInteractions(drugs)) {
      for (const f of p.flags) {
        const a = drugs.find((d) => d.key === f.a)!;
        expect(a.sections[f.section].text.includes(f.quote)).toBe(true);
      }
    }
  });
});

describe("matcher v2: class phrases derived from openFDA's own class terms", () => {
  it("derives the label's word order, singular head nouns and Roman numerals by rule", () => {
    expect(derivedClassPhrases("Adrenergic beta-Antagonists [MoA]")).toEqual(["Adrenergic beta-Antagonist", "beta-adrenergic Antagonist"]);
    expect(derivedClassPhrases("Angiotensin 2 Receptor Antagonists [MoA]")).toEqual(["Angiotensin 2 Receptor Antagonist", "Angiotensin II Receptor Antagonist"]);
    expect(derivedClassPhrases("Biguanides [CS]")).toEqual(["Biguanide"]);
    expect(derivedClassPhrases("Sulfonylurea Compounds [CS]")).toEqual(["Sulfonylurea"]);
    expect(derivedClassPhrases("Loop Diuretic [EPC]")).toEqual(["Loop Diuretic"]);
  });

  it("skips effects, enzyme and transporter mechanisms, and single-substance structure terms", () => {
    expect(derivedClassPhrases("Decreased Platelet Aggregation [PE]")).toEqual([]);
    expect(derivedClassPhrases("Cytochrome P450 3A Inhibitors [MoA]")).toEqual([]);
    expect(derivedClassPhrases("P-Glycoprotein Inhibitors [MoA]")).toEqual([]);
    expect(derivedClassPhrases("Thyroxine [CS]")).toEqual([]);
  });

  it("v2 reads a class named in the mechanism's words; v1 does not", () => {
    const a = drug({ key: "thyrox", sections: section("drug_interactions", "Actions of particular beta-adrenergic antagonists may be impaired when the patient is converted to the euthyroid state.") });
    const b = drug({ key: "betalol", classes: ["beta-Adrenergic Blocker"], class_terms: ["Adrenergic beta-Antagonists [MoA]", "beta-Adrenergic Blocker [EPC]"] });
    expect(matchDirection(a, b, "v1")).toEqual([]);
    const v2 = matchDirection(a, b, "v2");
    expect(v2).toHaveLength(1);
    expect(v2[0]).toMatchObject({ kind: "class", matched_text: "beta-adrenergic antagonists", polarity: "caution", class_name: "Adrenergic beta-Antagonists" });
    expect(classPhrasesFor(b, "v1").map((p) => p.phrase)).not.toContain("beta-adrenergic Antagonist");
  });

  it("v2 marks advice to step up the other therapy as not about co-use; v1 flags it", () => {
    const text = "Worsening heart failure may occur. If such symptoms occur, increase diuretics and restore clinical stability before advancing the dose of betalol.";
    const a = drug({ key: "betalol", sections: section("warnings_and_cautions", text) });
    const b = drug({ key: "loopa", classes: ["Loop Diuretic"], class_terms: ["Loop Diuretic [EPC]"] });
    expect(matchDirection(a, b, "v1")[0]?.polarity).toBe("caution");
    expect(matchDirection(a, b, "v2")[0]?.polarity).toBe("not_co_use");
    expect(findInteractions([a, b], "v2")[0]).toMatchObject({ flagged: false });
    expect(findInteractions([a, b], "v1")[0]).toMatchObject({ flagged: true });
  });

  it("step-up wording inside a co-use caution is still a caution", () => {
    const text = "When adding a diuretic in patients taking betalol, monitor blood pressure because the combination can lower it further.";
    expect(isStepUpAdvice(text, text.indexOf("diuretic"), text)).toBe(false);
    const a = drug({ key: "betalol", sections: section("drug_interactions", text) });
    const b = drug({ key: "loopa", classes: ["Loop Diuretic"], class_terms: ["Loop Diuretic [EPC]"] });
    expect(matchDirection(a, b, "v2")[0]?.polarity).toBe("caution");
  });

  it("the app's default matcher is v2", () => {
    expect(MATCHER_VERSION).toBe("v2");
  });
});
