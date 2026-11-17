/**
 * The FDA label sections Carepool reads, by their openFDA field names.
 *
 * openFDA returns each section as an array of strings. Prescription labels in
 * the current (PLR) format use `warnings_and_cautions`; older ones use
 * `warnings` and `precautions`; over-the-counter labels use `purpose`,
 * `directions`, `do_not_use`, `ask_doctor` and friends. Every field we cite is
 * listed here with a reader-facing title.
 */

export const CARD_PARTS = ["uses", "how_to_take", "side_effects", "warnings"] as const;
export type CardPart = (typeof CARD_PARTS)[number];

export const CARD_PART_TITLES: Record<CardPart, string> = {
  uses: "What it is for",
  how_to_take: "How to take it",
  side_effects: "Common side effects",
  warnings: "Warnings",
};

export const SECTION_TITLES: Record<string, string> = {
  boxed_warning: "Boxed Warning",
  indications_and_usage: "Indications and Usage",
  purpose: "Purpose",
  dosage_and_administration: "Dosage and Administration",
  directions: "Directions",
  contraindications: "Contraindications",
  warnings_and_cautions: "Warnings and Precautions",
  warnings: "Warnings",
  precautions: "Precautions",
  general_precautions: "General Precautions",
  adverse_reactions: "Adverse Reactions",
  drug_interactions: "Drug Interactions",
  information_for_patients: "Patient Counseling Information",
  spl_patient_package_insert: "Patient Information",
  spl_medguide: "Medication Guide",
  instructions_for_use: "Instructions for Use",
  do_not_use: "Do Not Use",
  ask_doctor: "Ask a Doctor Before Use",
  ask_doctor_or_pharmacist: "Ask a Doctor or Pharmacist Before Use",
  stop_use: "Stop Use",
  when_using: "When Using This Product",
  geriatric_use: "Geriatric Use",
};

/** Sections a sentence in each card part may cite. The checker enforces this. */
export const PART_SECTIONS: Record<CardPart, readonly string[]> = {
  uses: ["indications_and_usage", "purpose"],
  how_to_take: [
    "dosage_and_administration",
    "directions",
    "information_for_patients",
    "spl_patient_package_insert",
    "spl_medguide",
    "instructions_for_use",
  ],
  side_effects: [
    "adverse_reactions",
    "information_for_patients",
    "spl_patient_package_insert",
    "spl_medguide",
    "stop_use",
  ],
  warnings: [
    "boxed_warning",
    "warnings_and_cautions",
    "warnings",
    "precautions",
    "general_precautions",
    "contraindications",
    "geriatric_use",
    "do_not_use",
    "ask_doctor",
    "ask_doctor_or_pharmacist",
    "stop_use",
    "when_using",
    "information_for_patients",
  ],
};

/** Sections the deterministic interaction matcher scans in drug A's label. */
export const INTERACTION_SECTIONS: readonly string[] = [
  "drug_interactions",
  "boxed_warning",
  "contraindications",
  "warnings_and_cautions",
  "warnings",
  "precautions",
  "do_not_use",
  "ask_doctor_or_pharmacist",
];

/** Every section the parser keeps (anything a card part or the matcher can cite). */
export const KEPT_SECTIONS: readonly string[] = Array.from(
  new Set([...Object.values(PART_SECTIONS).flat(), ...INTERACTION_SECTIONS]),
);

export function sectionTitle(key: string): string {
  return SECTION_TITLES[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
