import { KEPT_SECTIONS, sectionTitle } from "./sections";

/**
 * Label parser: one openFDA `drug/label` result → the fields Carepool uses.
 *
 * Section text is the openFDA strings joined with a space and with every run
 * of whitespace collapsed to one space. That collapsed text is THE text a
 * citation is checked against, shown in the UI, and re-checked by the eval,
 * so "verbatim" means the same thing everywhere. Nothing else is rewritten:
 * case, punctuation and wording stay exactly as the label has them.
 * HTML table fields (`*_table`) are skipped.
 */

export interface LabelSection {
  key: string;
  title: string;
  text: string;
}

export type Formulation = "extended" | "delayed" | "immediate";

export interface ParsedLabel {
  /** openFDA document id of this label version. */
  id: string;
  set_id: string;
  version: string | null;
  /** As openFDA gives it, YYYYMMDD. */
  effective_time: string | null;
  /** effective_time as YYYY-MM-DD, or null when missing or malformed. */
  effective_date: string | null;
  generic_names: string[];
  brand_names: string[];
  manufacturer: string | null;
  /** Established pharmacologic classes, without the " [EPC]" suffix. */
  pharm_classes: string[];
  /** Release form, read from the label's description, indications and package panel. */
  formulation: Formulation;
  /** Routes of administration from openFDA, e.g. ["ORAL"] or ["INTRAMUSCULAR", "INTRAVENOUS"]. */
  routes: string[];
  sections: Record<string, LabelSection>;
}

/** Collapse whitespace runs to one space and trim. The only normalization applied to label text. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string") return [value];
  return [];
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => collapseWhitespace(v)).filter(Boolean)));
}

export function formatEffectiveTime(raw: string | null | undefined): string | null {
  if (!raw || !/^\d{8}$/.test(raw)) return null;
  const y = raw.slice(0, 4);
  const m = raw.slice(4, 6);
  const d = raw.slice(6, 8);
  if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  return `${y}-${m}-${d}`;
}

export function stripClassSuffix(cls: string): string {
  return collapseWhitespace(cls.replace(/\s*\[(EPC|MoA|PE|CS|EXT)\]\s*$/i, ""));
}

/** Release form a label describes. Extended-release labels say so in their description or package panel. */
export function labelFormulation(r: Record<string, unknown>): Formulation {
  const text = ["description", "indications_and_usage", "package_label_principal_display_panel", "dosage_and_administration"]
    .map((k) => strings(r[k]).join(" ").slice(0, 4000))
    .join(" ");
  if (/extended[\s-]release|\bEXTENDED RELEASE\b/i.test(text)) return "extended";
  if (/delayed[\s-]release|\bDELAYED RELEASE\b/i.test(text)) return "delayed";
  return "immediate";
}

export function parseLabel(raw: unknown): ParsedLabel {
  if (!raw || typeof raw !== "object") throw new Error("parseLabel: expected an openFDA label object");
  const r = raw as Record<string, unknown>;
  const openfda = (r.openfda && typeof r.openfda === "object" ? r.openfda : {}) as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : "";
  const setId = typeof r.set_id === "string" ? r.set_id : "";
  if (!id || !setId) throw new Error("parseLabel: label has no id or set_id");

  const sections: Record<string, LabelSection> = {};
  for (const key of KEPT_SECTIONS) {
    const parts = strings(r[key]);
    if (parts.length === 0) continue;
    const text = collapseWhitespace(parts.join(" "));
    if (!text) continue;
    sections[key] = { key, title: sectionTitle(key), text };
  }

  const effective = typeof r.effective_time === "string" ? r.effective_time : null;
  return {
    id,
    set_id: setId,
    version: typeof r.version === "string" ? r.version : null,
    effective_time: effective,
    effective_date: formatEffectiveTime(effective),
    generic_names: uniq(strings(openfda.generic_name)),
    brand_names: uniq(strings(openfda.brand_name)),
    manufacturer: strings(openfda.manufacturer_name)[0] ?? null,
    pharm_classes: uniq(strings(openfda.pharm_class_epc).map(stripClassSuffix)),
    formulation: labelFormulation(r),
    routes: uniq(strings(openfda.route)).map((x) => x.toUpperCase()),
    sections,
  };
}

/** DailyMed page for this label's set id: where a reader can check the source. */
export function dailyMedUrl(setId: string): string {
  return `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${encodeURIComponent(setId)}`;
}
