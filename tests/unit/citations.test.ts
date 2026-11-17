import { describe, expect, it } from "vitest";
import {
  checkCardSentences,
  checkSentence,
  cleanQuote,
  doseMention,
  extractGroundedTokens,
  findVerbatim,
  isVerbatim,
  type CardSentence,
} from "@/lib/cards/citations";
import type { LabelSection } from "@/lib/labels/parse";

const sections: Record<string, LabelSection> = {
  indications_and_usage: {
    key: "indications_and_usage",
    title: "Indications and Usage",
    text: "1 INDICATIONS AND USAGE Lisinopril tablets are indicated for the treatment of hypertension in adult patients and pediatric patients 6 years of age and older to lower blood pressure.",
  },
  adverse_reactions: {
    key: "adverse_reactions",
    title: "Adverse Reactions",
    text: "The most common adverse reactions (incidence >5%) are headache, dizziness and cough. Patients’ symptoms – such as angioedema – may occur at any time.",
  },
  dosage_and_administration: {
    key: "dosage_and_administration",
    title: "Dosage and Administration",
    text: "The recommended initial dose is 10 mg once a day. Lisinopril can be taken with or without food.",
  },
  drug_interactions: { key: "drug_interactions", title: "Drug Interactions", text: "Diuretics: excessive drop in blood pressure." },
};

const s = (over: Partial<CardSentence>): CardSentence => ({
  id: "s1",
  part: "side_effects",
  text: "Headache, dizziness and cough are the most common side effects.",
  section: "adverse_reactions",
  quote: "headache, dizziness and cough",
  ...over,
});

const reason = (x: CardSentence) => {
  const r = checkSentence(x, sections);
  return r.ok ? "OK" : r.failure.reason;
};

describe("checkSentence: what passes", () => {
  it("keeps a sentence whose quote is verbatim in an allowed section", () => {
    const r = checkSentence(s({}), sections);
    expect(r.ok).toBe(true);
  });

  it("keeps a number in the text when the quote has it", () => {
    expect(
      reason(
        s({
          part: "uses",
          section: "indications_and_usage",
          text: "It treats high blood pressure in adults and children 6 and older.",
          quote: "pediatric patients 6 years of age and older",
        }),
      ),
    ).toBe("OK");
  });

  it("repairs curly quotes and dashes to the exact label substring, and nothing else", () => {
    const r = checkSentence(s({ text: "Symptoms such as angioedema may occur at any time.", quote: "Patients' symptoms - such as angioedema - may occur" }), sections);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sentence.quote).toBe("Patients’ symptoms – such as angioedema – may occur");
      expect(sections.adverse_reactions.text.includes(r.sentence.quote)).toBe(true);
    }
  });

  it("tidies wrapping quote marks and edge ellipses from a model's quote", () => {
    expect(cleanQuote('"headache, dizziness and cough"')).toBe("headache, dizziness and cough");
    expect(cleanQuote("… headache, dizziness and cough...")).toBe("headache, dizziness and cough");
  });
});

describe("checkSentence: what is removed, and why", () => {
  it("NO_CITATION when the quote or section is missing", () => {
    expect(reason(s({ quote: "" }))).toBe("NO_CITATION");
    expect(reason(s({ section: " " }))).toBe("NO_CITATION");
  });

  it("UNKNOWN_SECTION when the label has no such section", () => {
    expect(reason(s({ section: "boxed_warning" }))).toBe("UNKNOWN_SECTION");
  });

  it("WRONG_PART when the section cannot back the card part", () => {
    expect(reason(s({ part: "uses" }))).toBe("WRONG_PART");
    expect(reason(s({ part: "warnings", section: "drug_interactions", quote: "excessive drop in blood pressure" }))).toBe("WRONG_PART");
  });

  it("QUOTE_NOT_FOUND for an invented, paraphrased or case-changed quote", () => {
    expect(reason(s({ quote: "headache, nausea and cough" }))).toBe("QUOTE_NOT_FOUND");
    expect(reason(s({ quote: "Headache, dizziness and cough" }))).toBe("QUOTE_NOT_FOUND");
    expect(reason(s({ quote: "headache and dizziness and cough" }))).toBe("QUOTE_NOT_FOUND");
  });

  it("QUOTE_NOT_FOUND when the quote is real but from a different section", () => {
    expect(reason(s({ quote: "can be taken with or without food" }))).toBe("QUOTE_NOT_FOUND");
  });

  it("QUOTE_TOO_SHORT and QUOTE_TOO_LONG", () => {
    expect(reason(s({ quote: "cough" }))).toBe("QUOTE_TOO_SHORT");
    expect(reason(s({ quote: "x ".repeat(250) }))).toBe("QUOTE_TOO_LONG");
  });

  it("UNGROUNDED_TOKEN when the text has a number its quote does not", () => {
    const r = checkSentence(s({ text: "About 7% of people get a headache, dizziness or cough." }), sections);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.reason).toBe("UNGROUNDED_TOKEN");
      expect(r.failure.token).toBe("7%");
    }
  });

  it("UNGROUNDED_TOKEN for a double-quoted phrase the quote does not contain", () => {
    expect(reason(s({ text: 'The label calls them "very common".' }))).toBe("UNGROUNDED_TOKEN");
  });

  it("DOSE_MENTION when the quote carries a dose, even if the text does not", () => {
    const r = checkSentence(
      s({ part: "how_to_take", section: "dosage_and_administration", text: "Follow the prescription for the dose.", quote: "The recommended initial dose is 10 mg once a day." }),
      sections,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.reason).toBe("DOSE_MENTION");
  });

  it("DOSE_MENTION when the text adds a dose or a frequency", () => {
    expect(reason(s({ part: "how_to_take", section: "dosage_and_administration", text: "Take 1 tablet with or without food.", quote: "Lisinopril can be taken with or without food." }))).toBe(
      "DOSE_MENTION",
    );
    expect(
      reason(s({ part: "how_to_take", section: "dosage_and_administration", text: "Take it twice a day, with or without food.", quote: "Lisinopril can be taken with or without food." })),
    ).toBe("DOSE_MENTION");
  });

  it("a non-dose how-to-take sentence passes", () => {
    expect(
      reason(s({ part: "how_to_take", section: "dosage_and_administration", text: "It can be taken with or without food.", quote: "Lisinopril can be taken with or without food." })),
    ).toBe("OK");
  });
});

describe("doseMention", () => {
  it.each([
    ["10 mg", "10 mg"],
    ["take 2.5mg daily", "2.5mg"],
    ["5 to 10 mg", "5 to 10 mg"],
    ["100 mcg", "100 mcg"],
    ["1 tablet", "1 tablet"],
    ["two capsules at bedtime", "two capsules"],
    ["once daily", "once daily"],
    ["twice a day", "twice a day"],
    ["every 12 hours", "every 12 hours"],
    ["three times daily", "three times daily"],
    ["b.i.d.", "b.i.d"],
    // bypasses found in review, now closed
    ["a 10-mg tablet", "10-mg"],
    ["ten milligrams", "ten milligrams"],
    ["½ tablet", "½ tablet"],
    ["1½ tablets", "1½ tablets"],
    ["2 tabs", "2 tabs"],
    ["5 cc", "5 cc"],
    ["1 teaspoonful", "1 teaspoonful"],
    ["apply 1 patch", "1 patch"],
    ["20 mEq", "20 mEq"],
    ["every other day", "every other day"],
    ["on alternate days", "on alternate days"],
  ])("finds %s", (input, found) => {
    expect(doseMention(input)?.toLowerCase().replace(/\.$/, "")).toBe(found.toLowerCase());
  });

  it.each([
    "Take it at the same time every day.",
    "eGFR below 30 mL/min/1.73 m2",
    "in patients 65 years and older",
    "potassium above 5.5 mEq/L",
    "the dose may change",
    "blood sugar below 70 mg/dL",
    "a half-life of about 12 hours",
    "Do not crush or chew the tablet.",
    "1 in 10 people",
  ])(
    "does not flag %s",
    (input) => {
      expect(doseMention(input)).toBeNull();
    },
  );
});

describe("helpers", () => {
  it("extracts numbers, dates and quoted phrases", () => {
    const kinds = extractGroundedTokens('On 2026-11-05 about 5% said "dizzy" twice.').map((t) => `${t.kind}:${t.raw}`);
    expect(kinds).toEqual(['quote:"dizzy"', "date:2026-11-05", "number:5%"]);
  });

  it("findVerbatim returns the exact label substring or null", () => {
    expect(findVerbatim("A’s text — here", "A's text - here")).toBe("A’s text — here");
    expect(findVerbatim("abc def ghi", "abc  def")).toBe("abc def");
    expect(findVerbatim("abc def", "xyz")).toBeNull();
  });

  it("isVerbatim is a plain substring test", () => {
    expect(isVerbatim("abc def", "c d")).toBe(true);
    expect(isVerbatim("abc def", "")).toBe(false);
  });

  it("checkCardSentences splits passed and failed and never returns a failed sentence as passed", () => {
    const res = checkCardSentences([s({ id: "a" }), s({ id: "b", quote: "made up words here" }), s({ id: "c", quote: "cough" })], sections);
    expect(res.passed.map((x) => x.id)).toEqual(["a"]);
    expect(res.failed.map((x) => [x.id, x.reason])).toEqual([
      ["b", "QUOTE_NOT_FOUND"],
      ["c", "QUOTE_TOO_SHORT"],
    ]);
    for (const p of res.passed) expect(sections[p.section].text.includes(p.quote)).toBe(true);
  });
});
