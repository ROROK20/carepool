/**
 * How labels name a drug class in running text.
 *
 * The class itself is data: openFDA's established pharmacologic class (EPC)
 * for drug B, from B's label or the NDC directory. Label prose rarely uses the
 * EPC wording ("Angiotensin Converting Enzyme Inhibitor"); it says "ACE
 * inhibitors". This hand-written table maps an EPC (lower case) to the
 * phrases labels use for it. It is the one curated part of the matcher, and it
 * is listed as such in the README and the eval.
 *
 * All-caps acronyms (ACE, ARB, SSRI, PPI, NSAID) match case-sensitively;
 * everything else matches case-insensitively. Plurals are handled by the
 * matcher, so list the singular.
 */
export const CLASS_PHRASES: Record<string, readonly string[]> = {
  "angiotensin converting enzyme inhibitor": [
    "ACE inhibitor",
    "angiotensin converting enzyme inhibitor",
    "angiotensin-converting enzyme inhibitor",
    "angiotensin converting enzyme (ACE) inhibitor",
    "angiotensin-converting enzyme (ACE) inhibitor",
  ],
  "angiotensin 2 receptor blocker": [
    "angiotensin receptor blocker",
    "angiotensin II receptor blocker",
    "angiotensin II receptor antagonist",
    "ARB",
  ],
  "aldosterone antagonist": [
    "aldosterone antagonist",
    "potassium-sparing diuretic",
    "potassium sparing diuretic",
    "mineralocorticoid receptor antagonist",
  ],
  "vitamin k antagonist": ["vitamin K antagonist", "anticoagulant", "coumarin"],
  "factor xa inhibitor": ["factor Xa inhibitor", "anticoagulant"],
  biguanide: ["biguanide", "antidiabetic", "oral hypoglycemic", "hypoglycemic agent"],
  "hmg-coa reductase inhibitor": ["statin", "HMG-CoA reductase inhibitor"],
  "serotonin reuptake inhibitor": [
    "SSRI",
    "selective serotonin reuptake inhibitor",
    "serotonin reuptake inhibitor",
  ],
  "dihydropyridine calcium channel blocker": ["calcium channel blocker", "dihydropyridine"],
  "calcium channel blocker": ["calcium channel blocker", "calcium antagonist"],
  "beta-adrenergic blocker": ["beta-blocker", "beta blocker", "beta-adrenergic blocker", "beta-adrenergic blocking agent"],
  "loop diuretic": ["loop diuretic", "diuretic"],
  "thiazide diuretic": ["thiazide", "diuretic"],
  "proton pump inhibitor": ["proton pump inhibitor", "PPI"],
  "p2y12 platelet inhibitor": ["P2Y12 inhibitor", "platelet inhibitor", "antiplatelet"],
  "l-thyroxine": ["thyroid hormone"],
  "anti-epileptic agent": ["antiepileptic", "anticonvulsant"],
  "cholinesterase inhibitor": ["cholinesterase inhibitor"],
  "nonsteroidal anti-inflammatory drug": [
    "NSAID",
    "nonsteroidal anti-inflammatory",
    "non-steroidal anti-inflammatory",
  ],
};

export function classPhrases(epcClass: string): readonly string[] {
  return CLASS_PHRASES[epcClass.toLowerCase().trim()] ?? [epcClass];
}
