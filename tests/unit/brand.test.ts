import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { HEART, RING, heartPath, iconSvg, logoSquareSvg, logoSvg, ringPath, translatePath, wordmarkLayout } from "@/lib/brand";

/** The logo files are generated from src/lib/brand.ts by `npm run brand`; these tests keep them in step. */

function pngSize(file: string): { width: number; height: number } {
  const b = fs.readFileSync(file);
  expect(b.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

const numbers = (d: string) => d.split(/[\s,]+/).filter((t) => !/^[A-Za-z]$/.test(t)).map(Number);

describe("committed logo files", () => {
  it("are exactly what src/lib/brand.ts generates (run `npm run brand` after changing it)", () => {
    expect(fs.readFileSync("src/app/icon.svg", "utf8")).toBe(iconSvg());
    expect(fs.readFileSync("docs/brand/logo.svg", "utf8")).toBe(logoSvg());
    expect(fs.readFileSync("docs/brand/logo-square.svg", "utf8")).toBe(logoSquareSvg());
  });

  it("PNG exports have the promised sizes", () => {
    expect(pngSize("docs/brand/logo.png").width).toBeGreaterThanOrEqual(1024);
    expect(pngSize("docs/brand/logo-square.png")).toEqual({ width: 1024, height: 1024 });
    expect(pngSize("src/app/apple-icon.png")).toEqual({ width: 180, height: 180 });
  });
});

describe("geometry", () => {
  it("the heart sits inside the ring with room to spare", () => {
    const inner = RING.r - RING.width / 2;
    const offset = HEART.overlap * HEART.r;
    const lobeReach = Math.hypot(offset, HEART.cy - RING.cy) + HEART.r;
    const tipReach = HEART.tipY - RING.cy;
    expect(Math.max(lobeReach, tipReach)).toBeLessThan(inner - 2);
  });

  it("paths are well formed: finite numbers, a closed heart starting at its notch on the centre line", () => {
    for (const d of [ringPath(), heartPath(), wordmarkLayout().care, wordmarkLayout().pool]) {
      expect(numbers(d).every(Number.isFinite)).toBe(true);
    }
    expect(heartPath()).toMatch(new RegExp(`^M ${HEART.cx} [\\d.]+ A .* Z$`));
  });

  it("translatePath moves x coordinates only", () => {
    expect(translatePath("M 1 2 L 3 4 H 5 V 6 A 7 8 0 1 0 9 10 Q 11 12 13 14", 100)).toBe("M 101 2 L 103 4 H 105 V 6 A 7 8 0 1 0 109 10 Q 111 12 113 14");
  });

  it("the wordmark is wider than tall and spells eight letters", () => {
    const w = wordmarkLayout();
    expect(w.width).toBeGreaterThan(4 * (w.bottom - w.top));
    // "care" is c, a (circle + stem), r (stem + shoulder), e: one move per stroke.
    expect(w.care.match(/M /g)).toHaveLength(1 + 2 + 2 + 1);
    // "pool" is p (circle + stem), o, o, l.
    expect(w.pool.match(/M /g)).toHaveLength(2 + 1 + 1 + 1);
  });
});
