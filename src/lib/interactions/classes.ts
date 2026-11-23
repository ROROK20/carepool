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

// ── Matcher v2: class phrases derived from openFDA's own class terms ───────────

/**
 * Enzyme and transporter mechanism classes ("Cytochrome P450 3A Inhibitors",
 * "P-Glycoprotein Inhibitors"). Labels qualify these by strength ("strong
 * CYP3A4 inhibitors") and then list the drugs they mean by name, which the
 * name matcher already reads. Matching the class itself would flag every
 * weak inhibitor, so v2 skips them.
 */
const MECHANISM_CLASS = /cytochrome|\bCYP\s?\d|p[\s-]?glycoprotein|transport(?:er|ing)|organic (?:anion|cation)|\bUDP\b|glucuronosyl|breast cancer resistance/i;

/** Trailing nouns openFDA adds to chemical-structure names that label prose leaves off ("Sulfonylurea Compounds"). */
const STRUCTURE_FILLER = /\s+(?:compounds?|derivatives?)$/i;

function singular(word: string): string {
  if (/ss$/i.test(word)) return word;
  if (/ies$/i.test(word)) return `${word.slice(0, -3)}y`;
  if (/s$/i.test(word) && word.length > 3) return word.slice(0, -1);
  return word;
}

/**
 * The phrases label prose may use for one openFDA class term, derived by rule,
 * not by hand: suffix removed, head noun made singular (the matcher adds
 * plurals), "2" also written "II" (openFDA writes "Angiotensin 2 Receptor";
 * labels write "angiotensin II receptor"), and "<Adjective> <subtype>-<Noun>"
 * also written "<subtype>-<adjective> <noun>" (openFDA: "Adrenergic
 * beta-Antagonists"; labels: "beta-adrenergic antagonists").
 *
 * Skipped: physiologic-effect terms [PE] (an effect, not a class a label
 * names), enzyme and transporter mechanisms (see MECHANISM_CLASS), and a
 * chemical-structure term [CS] that is not plural, because it names one
 * substance ("Thyroxine") rather than a family ("Thiazides").
 */
export function derivedClassPhrases(rawTerm: string): string[] {
  const m = rawTerm.trim().match(/^(.*?)\s*\[(EPC|MoA|CS|PE|EXT)\]$/i);
  const kind = (m?.[2] ?? "EPC").toUpperCase();
  let name = (m ? m[1] : rawTerm).replace(/\s+/g, " ").trim();
  if (!name || kind === "PE" || kind === "EXT") return [];
  if (MECHANISM_CLASS.test(name)) return [];
  if (kind === "CS") {
    const last = name.split(" ").pop() ?? "";
    if (!/s$/i.test(last)) return [];
    name = name.replace(STRUCTURE_FILLER, "");
  }
  const words = name.split(" ");
  words[words.length - 1] = singular(words[words.length - 1]);
  const base = words.join(" ");
  const out = new Set<string>([base]);
  if (/\b2\b/.test(base)) out.add(base.replace(/\b2\b/g, "II"));
  for (const v of [...out]) {
    const r = v.match(/^([A-Za-z]+) ([A-Za-z0-9]+)-([A-Za-z]+)$/);
    if (r) out.add(`${r[2]}-${r[1].toLowerCase()} ${r[3]}`);
  }
  return [...out].filter((p) => p.replace(/[^A-Za-z]/g, "").length >= 4);
}
