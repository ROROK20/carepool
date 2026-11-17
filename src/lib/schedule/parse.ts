/**
 * Reading what a family member typed or pasted. Nothing here guesses:
 * a time is taken only when it is written as a clock time ("8:00 AM", "8am",
 * "20:00", "noon", "midnight"). Words like "morning" or "twice daily" are left
 * for the person to turn into times; the parser says so instead of choosing.
 * The dose is kept exactly as written.
 */

export interface ParsedMedLine {
  /** The line exactly as pasted. */
  as_written: string;
  name: string;
  /** The rest of the line after the name, as written (only leading separators trimmed). */
  dose: string;
  /** 24-hour HH:MM, sorted, unique: only times written as clock times. */
  times: string[];
  /** Plain-language notes for the person, e.g. that no time was found. */
  warnings: string[];
}

const pad2 = (n: number) => String(n).padStart(2, "0");

const AMPM_RE = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([ap])\.?\s?m\.?(?![a-z])/gi;
const H24_RE = /\b([01]?\d|2[0-3]):([0-5]\d)\b(?!\s*[ap]\.?\s?m)/gi;
const NOON_RE = /\bnoon\b/gi;
const MIDNIGHT_RE = /\bmidnight\b/gi;
const BARE_AT_RE = /\bat\s+(1[0-2]|0?[1-9])\b(?!\s*(?::|[ap]\.?\s?m|o'?clock))/i;
const VAGUE_RE = /\b(morning|evening|night|bedtime|noon-ish|afternoon|daily|twice|three times|every \d+ hours?)\b/i;

/** Every clock time written in text, as 24-hour HH:MM, sorted and unique. */
export function parseTimes(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(AMPM_RE)) {
    let h = Number(m[1]) % 12;
    if (m[3].toLowerCase() === "p") h += 12;
    out.add(`${pad2(h)}:${m[2] ?? "00"}`);
  }
  for (const m of text.matchAll(H24_RE)) out.add(`${pad2(Number(m[1]))}:${m[2]}`);
  if (NOON_RE.test(text)) out.add("12:00");
  if (MIDNIGHT_RE.test(text)) out.add("00:00");
  NOON_RE.lastIndex = 0;
  MIDNIGHT_RE.lastIndex = 0;
  return [...out].sort();
}

/** True for a valid 24-hour "HH:MM". */
export function isClockTime(t: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

/** "08:00" → "8:00 AM". */
export function formatTime(t: string): string {
  if (!isClockTime(t)) return t;
  const [h, m] = t.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad2(m)} ${suffix}`;
}

/** Medicine name at the start of a line: the words before the first digit or separator. */
export function leadingName(line: string): string {
  const head = line.split(/[\d,;|(—–:]|\s-\s/)[0] ?? "";
  return head.replace(/\s+/g, " ").trim();
}

export function parseMedLine(line: string): ParsedMedLine | null {
  const asWritten = line.replace(/\s+$/, "");
  const trimmed = asWritten.trim().replace(/^[-*•\d.)\s]+(?=[A-Za-z])/, "");
  if (!trimmed) return null;
  const name = leadingName(trimmed);
  if (!name || !/[A-Za-z]{3,}/.test(name)) return null;
  const dose = trimmed.slice(trimmed.indexOf(name) + name.length).replace(/^[\s,;|:—–-]+/, "").trim();
  const times = parseTimes(trimmed);
  const warnings: string[] = [];
  const bare = BARE_AT_RE.exec(trimmed);
  if (bare) warnings.push(`"at ${bare[1]}" has no AM or PM, so it was not used. Add the time as written on the label, like ${bare[1]}:00 AM.`);
  if (times.length === 0) {
    const vague = VAGUE_RE.exec(trimmed);
    warnings.push(
      vague
        ? `No clock time found ("${vague[0]}" is not a time). Add the times you give this medicine; Carepool will not pick them.`
        : "No clock time found. Add the times you give this medicine; Carepool will not pick them.",
    );
  }
  if (!dose) warnings.push("No dose found on this line. Add it exactly as the prescription label says.");
  return { as_written: asWritten, name, dose, times, warnings };
}

/** One entry per non-empty line that starts with a medicine name. */
export function parsePastedList(text: string): ParsedMedLine[] {
  return text
    .split(/\r?\n/)
    .map((l) => parseMedLine(l))
    .filter((x): x is ParsedMedLine => x !== null);
}
