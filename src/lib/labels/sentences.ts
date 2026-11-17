/**
 * Sentence boundaries in collapsed label text. Labels are prose mixed with
 * flattened tables and bullets, so a boundary is a full stop, "!" or "?"
 * followed by a space and a capital, digit, "(" or bullet, unless the word
 * before it is a known abbreviation ("e.g.", "approx."), or a bullet "•".
 */

const ABBREVIATIONS = new Set(["e.g", "i.e", "etc", "vs", "approx", "dr", "no", "fig", "u.s", "inc", "ca", "al"]);

export function isBoundary(text: string, i: number): boolean {
  const c = text[i];
  if (c === "•") return true;
  if (c !== "." && c !== "!" && c !== "?") return false;
  if (text[i + 1] !== " ") return false;
  const next = text[i + 2] ?? "";
  if (!/[A-Z0-9("•]/.test(next)) return false;
  const before = text.slice(0, i).split(" ").pop() ?? "";
  return !ABBREVIATIONS.has(before.toLowerCase());
}

export interface TextSpan {
  start: number;
  end: number;
}

/** Every sentence in text as [start, end) spans, full stop included, surrounding spaces and bullets excluded. */
export function splitSentences(text: string): TextSpan[] {
  const out: TextSpan[] = [];
  let start = 0;
  const push = (s: number, e: number) => {
    while (s < e && (text[s] === " " || text[s] === "•")) s++;
    while (e > s && text[e - 1] === " ") e--;
    if (e > s) out.push({ start: s, end: e });
  };
  for (let i = 0; i < text.length; i++) {
    if (!isBoundary(text, i)) continue;
    if (text[i] === "•") {
      push(start, i);
      start = i + 1;
    } else {
      push(start, i + 1);
      start = i + 1;
    }
  }
  push(start, text.length);
  return out;
}
