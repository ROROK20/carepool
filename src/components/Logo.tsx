import { BRAND_COLORS, MARK_SIZE, MARK_TILE_RADIUS, RING, WORD, heartPath, ringPath, wordmarkLayout } from "@/lib/brand";

/** The Carepool mark and wordmark for the page header. Geometry from lib/brand.ts; sizes in rem so they follow large text. */

const RING_D = ringPath();
const HEART_D = heartPath();
const WORDMARK = wordmarkLayout();
const WORDMARK_HEIGHT = WORDMARK.bottom - WORDMARK.top;

export function LogoMark({ size = 2.25 }: { size?: number }) {
  return (
    <svg viewBox={`0 0 ${MARK_SIZE} ${MARK_SIZE}`} style={{ width: `${size}rem`, height: `${size}rem` }} aria-hidden focusable="false" className="shrink-0">
      <rect width={MARK_SIZE} height={MARK_SIZE} rx={MARK_TILE_RADIUS} fill={BRAND_COLORS.teal} />
      <path d={RING_D} fill="none" stroke={BRAND_COLORS.white} strokeWidth={RING.width} strokeLinecap="round" />
      <path d={HEART_D} fill={BRAND_COLORS.warm} />
    </svg>
  );
}

export function Wordmark({ height = 1.45 }: { height?: number }) {
  const stroke = { fill: "none", strokeWidth: WORD.stroke, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return (
    <svg
      viewBox={`0 ${WORDMARK.top} ${WORDMARK.width} ${WORDMARK_HEIGHT}`}
      style={{ height: `${height}rem`, width: `${(height * WORDMARK.width) / WORDMARK_HEIGHT}rem` }}
      aria-hidden
      focusable="false"
      className="shrink-0"
    >
      <path d={WORDMARK.care} stroke={BRAND_COLORS.ink} {...stroke} />
      <path d={WORDMARK.pool} stroke={BRAND_COLORS.teal} {...stroke} />
    </svg>
  );
}
