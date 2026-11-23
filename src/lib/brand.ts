/**
 * The Carepool mark and wordmark, as geometry. One source for the header
 * (components/Logo.tsx), the favicon (app/icon.svg) and the exported files in
 * docs/brand/, which `npm run brand` writes from here; a unit test fails if a
 * committed file drifts from this module.
 *
 * Mark: an open ring, the family's care circle (and a "C"), around a warm
 * heart, on a rounded teal tile. Wordmark: monoline geometric lowercase built
 * from circles and straight strokes with round ends, no font involved, so it
 * renders the same everywhere. All shapes are original.
 */

export const BRAND_COLORS = {
  teal: "#0f766e",
  ink: "#1c2430",
  /** The yellow the app uses to highlight label quotes. */
  warm: "#f2c94c",
  white: "#ffffff",
} as const;

const fmt = (n: number) => String(Math.round(n * 100) / 100);
type Pt = { x: number; y: number };
const at = (c: Pt, r: number, deg: number): Pt => ({ x: c.x + r * Math.cos((deg * Math.PI) / 180), y: c.y + r * Math.sin((deg * Math.PI) / 180) });
const p = (q: Pt) => `${fmt(q.x)} ${fmt(q.y)}`;

// ── mark (64 × 64) ───────────────────────────────────────────────────

export const MARK_SIZE = 64;
export const MARK_TILE_RADIUS = 15;
export const RING = { cx: 32, cy: 32, r: 19, width: 7.5, gapDeg: 44 } as const;
export const HEART = { cx: 32, cy: 29.4, r: 6, overlap: 0.72, tipY: 41.8, tipRound: 1.7 } as const;

/** The open ring: from the upper end of the gap, round through the left, to the lower end. */
export function ringPath(ring: typeof RING = RING): string {
  const c = { x: ring.cx, y: ring.cy };
  return `M ${p(at(c, ring.r, -ring.gapDeg))} A ${fmt(ring.r)} ${fmt(ring.r)} 0 1 0 ${p(at(c, ring.r, ring.gapDeg))}`;
}

/**
 * A heart from two overlapping circles and the two lines tangent to them
 * that meet at the tip, with the tip slightly rounded.
 */
export function heartPath(h: typeof HEART = HEART): string {
  const offset = h.overlap * h.r;
  const left = { x: h.cx - offset, y: h.cy };
  const right = { x: h.cx + offset, y: h.cy };
  const notch = { x: h.cx, y: h.cy - Math.sqrt(h.r * h.r - offset * offset) };
  const tip = { x: h.cx, y: h.tipY };
  const tangent = (c: Pt, outer: 1 | -1): { pt: Pt; deg: number } => {
    const d = Math.hypot(tip.x - c.x, tip.y - c.y);
    const base = Math.atan2(tip.y - c.y, tip.x - c.x);
    const off = Math.acos(h.r / d);
    const options = [base + off, base - off].map((a) => ({ pt: at(c, h.r, (a * 180) / Math.PI), deg: (a * 180) / Math.PI }));
    return options.sort((m, n) => outer * (n.pt.x - m.pt.x))[0];
  };
  const tl = tangent(left, -1);
  const tr = tangent(right, 1);
  const toward = (from: Pt, to: Pt, s: number): Pt => {
    const d = Math.hypot(to.x - from.x, to.y - from.y);
    return { x: from.x + ((to.x - from.x) * s) / d, y: from.y + ((to.y - from.y) * s) / d };
  };
  // Counter-clockwise sweep from the notch to each tangent point: large-arc when it passes 180°.
  const degOf = (c: Pt, q: Pt) => (Math.atan2(q.y - c.y, q.x - c.x) * 180) / Math.PI;
  const ccw = (fromDeg: number, toDeg: number) => (((fromDeg - toDeg) % 360) + 360) % 360;
  const largeLeft = ccw(degOf(left, notch), tl.deg) > 180 ? 1 : 0;
  const largeRight = ccw(tr.deg, degOf(right, notch)) > 180 ? 1 : 0;
  const r = fmt(h.r);
  return [
    `M ${p(notch)}`,
    `A ${r} ${r} 0 ${largeLeft} 0 ${p(tl.pt)}`,
    `L ${p(toward(tip, tl.pt, h.tipRound))}`,
    `Q ${p(tip)} ${p(toward(tip, tr.pt, h.tipRound))}`,
    `L ${p(tr.pt)}`,
    `A ${r} ${r} 0 ${largeRight} 0 ${p(notch)}`,
    "Z",
  ].join(" ");
}

/** The mark's SVG elements (no <svg> wrapper). `fullBleed` drops the rounded corners (iOS masks its own). */
export function markElements(opts: { fullBleed?: boolean } = {}): string {
  const rx = opts.fullBleed ? 0 : MARK_TILE_RADIUS;
  return [
    `<rect width="${MARK_SIZE}" height="${MARK_SIZE}" rx="${rx}" fill="${BRAND_COLORS.teal}"/>`,
    `<path d="${ringPath()}" fill="none" stroke="${BRAND_COLORS.white}" stroke-width="${RING.width}" stroke-linecap="round"/>`,
    `<path d="${heartPath()}" fill="${BRAND_COLORS.warm}"/>`,
  ].join("");
}

// ── wordmark ─────────────────────────────────────────────────────────

/** Metrics, in wordmark units: x-height 40, ascender 60, descender 17, stroke 8. Baseline at y = 0. */
export const WORD = { xHeight: 40, ascender: 60, descender: 17, stroke: 8, gap: 7 } as const;

interface Glyph {
  d: string;
  /** Right edge of the ink, from the glyph's left edge. */
  width: number;
  /** Optical adjustment to the space after this glyph. */
  kern?: number;
}

function glyphs(): Record<"c" | "a" | "r" | "e" | "p" | "o" | "l", Glyph> {
  const half = WORD.stroke / 2;
  const ro = (WORD.xHeight - WORD.stroke) / 2;
  const c = { x: half + ro, y: -WORD.xHeight / 2 };
  const circle = `M ${p({ x: c.x + ro, y: c.y })} A ${ro} ${ro} 0 1 0 ${p({ x: c.x - ro, y: c.y })} A ${ro} ${ro} 0 1 0 ${p({ x: c.x + ro, y: c.y })}`;
  const top = -WORD.xHeight + half;
  const bottom = -half;
  const full = WORD.xHeight;
  const cGap = 48;
  return {
    c: { d: `M ${p(at(c, ro, -cGap))} A ${ro} ${ro} 0 1 0 ${p(at(c, ro, cGap))}`, width: at(c, ro, cGap).x + half, kern: -1 },
    a: { d: `${circle} M ${fmt(c.x + ro)} ${fmt(top)} V ${fmt(bottom)}`, width: full },
    r: {
      d: `M ${fmt(half)} ${fmt(top)} V ${fmt(bottom)} M ${fmt(half)} ${fmt(c.y)} A ${ro} ${ro} 0 0 1 ${p(at({ x: half + ro, y: c.y }, ro, -62))}`,
      width: at({ x: half + ro, y: c.y }, ro, -62).x + half,
      kern: -2,
    },
    e: { d: `M ${fmt(c.x - ro)} ${fmt(c.y)} H ${fmt(c.x + ro)} A ${ro} ${ro} 0 1 0 ${p(at(c, ro, 44))}`, width: full },
    p: { d: `${circle} M ${fmt(half)} ${fmt(top)} V ${fmt(WORD.descender - half)}`, width: full },
    o: { d: circle, width: full, kern: -1 },
    l: { d: `M ${fmt(half)} ${fmt(-WORD.ascender + half)} V ${fmt(bottom)}`, width: WORD.stroke },
  };
}

export interface WordmarkLayout {
  /** Stroke paths for "care" and for "pool", in wordmark units. */
  care: string;
  pool: string;
  width: number;
  /** Top of the ascender (negative) and bottom of the descender, relative to the baseline. */
  top: number;
  bottom: number;
}

export function wordmarkLayout(): WordmarkLayout {
  const g = glyphs();
  let x = 0;
  const parts: { word: "care" | "pool"; d: string }[] = [];
  const letters = "carepool".split("") as (keyof ReturnType<typeof glyphs>)[];
  letters.forEach((ch, i) => {
    const glyph = g[ch];
    parts.push({ word: i < 4 ? "care" : "pool", d: translatePath(glyph.d, x) });
    x += glyph.width + (i < letters.length - 1 ? WORD.gap + (glyph.kern ?? 0) : 0);
  });
  return {
    care: parts.filter((q) => q.word === "care").map((q) => q.d).join(" "),
    pool: parts.filter((q) => q.word === "pool").map((q) => q.d).join(" "),
    width: x,
    top: -WORD.ascender,
    bottom: WORD.descender,
  };
}

/** Shift an absolute path (M/L/H/V/A/Q commands only) right by dx. */
export function translatePath(d: string, dx: number): string {
  if (dx === 0) return d;
  const tokens = d.trim().split(/\s+/);
  const out: string[] = [];
  let cmd = "";
  let argIndex = 0;
  for (const t of tokens) {
    if (/^[A-Za-z]$/.test(t)) {
      cmd = t;
      argIndex = 0;
      out.push(t);
      continue;
    }
    const n = Number(t);
    // Which arguments of each command are x coordinates.
    const isX = cmd === "H" || ((cmd === "M" || cmd === "L" || cmd === "Q") && argIndex % 2 === 0) || (cmd === "A" && argIndex % 7 === 5);
    out.push(isX ? fmt(n + dx) : t);
    argIndex++;
  }
  return out.join(" ");
}

function wordmarkElements(w: WordmarkLayout, dx: number, baseline: number, scale: number): string {
  const stroke = `fill="none" stroke-width="${WORD.stroke}" stroke-linecap="round" stroke-linejoin="round"`;
  return (
    `<g transform="translate(${fmt(dx)} ${fmt(baseline)}) scale(${fmt(scale)})">` +
    `<path d="${w.care}" stroke="${BRAND_COLORS.ink}" ${stroke}/>` +
    `<path d="${w.pool}" stroke="${BRAND_COLORS.teal}" ${stroke}/>` +
    `</g>`
  );
}

// ── files ────────────────────────────────────────────────────────────

const svgOpen = (w: number, h: number, extra = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(w)} ${fmt(h)}" width="${fmt(w)}" height="${fmt(h)}"${extra}>`;

/** app/icon.svg: the mark alone. */
export function iconSvg(): string {
  return `${svgOpen(MARK_SIZE, MARK_SIZE)}<title>Carepool</title>${markElements()}</svg>\n`;
}

/** The apple-touch icon source: the mark, full bleed. */
export function appleIconSvg(): string {
  return `${svgOpen(MARK_SIZE, MARK_SIZE)}${markElements({ fullBleed: true })}</svg>\n`;
}

/** docs/brand/logo.svg: the mark and the wordmark side by side, with clear space around, transparent background. */
export function logoSvg(): string {
  const w = wordmarkLayout();
  const tile = 96;
  const gap = 24;
  const margin = 12;
  // Centre the x-height band on the tile.
  const baseline = margin + tile / 2 + WORD.xHeight / 2;
  const width = margin + tile + gap + w.width + margin;
  return (
    `${svgOpen(width, tile + 2 * margin, ' role="img" aria-label="Carepool"')}<title>Carepool</title>` +
    `<g transform="translate(${margin} ${margin}) scale(${fmt(tile / MARK_SIZE)})">${markElements()}</g>` +
    wordmarkElements(w, margin + tile + gap, baseline, 1) +
    `</svg>\n`
  );
}

/** docs/brand/logo-square.svg: 1024 × 1024 on white, the mark above the wordmark (a Devpost thumbnail). */
export function logoSquareSvg(): string {
  const size = 1024;
  const w = wordmarkLayout();
  const tile = 400;
  const wordScale = 620 / w.width;
  const space = 84;
  const block = tile + space + (w.bottom - w.top) * wordScale;
  const top = (size - block) / 2;
  const baseline = top + tile + space - w.top * wordScale;
  return (
    `${svgOpen(size, size, ' role="img" aria-label="Carepool"')}<title>Carepool</title>` +
    `<rect width="${size}" height="${size}" fill="${BRAND_COLORS.white}"/>` +
    `<g transform="translate(${fmt((size - tile) / 2)} ${fmt(top)}) scale(${fmt(tile / MARK_SIZE)})">${markElements()}</g>` +
    wordmarkElements(w, (size - w.width * wordScale) / 2, baseline, wordScale) +
    `</svg>\n`
  );
}
