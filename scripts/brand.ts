/**
 * Writes every logo file from src/lib/brand.ts:
 *
 *   src/app/icon.svg             favicon (the mark)
 *   src/app/apple-icon.png       180 x 180, full bleed, for a phone's home screen
 *   docs/brand/logo.svg          mark + wordmark, transparent background
 *   docs/brand/logo.png          the same, 1600 px wide, transparent
 *   docs/brand/logo-square.svg   1024 x 1024 on white, mark above wordmark
 *   docs/brand/logo-square.png   the same as a PNG (a Devpost thumbnail)
 *
 * PNGs are rendered by Playwright's Chromium (already a dev dependency), so
 * no image tool is needed. tests/unit/brand.test.ts fails if a committed SVG
 * differs from what this writes.
 *
 *   npm run brand
 */
import { chromium, type Browser } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { appleIconSvg, iconSvg, logoSquareSvg, logoSvg } from "../src/lib/brand";

const LOGO_PNG_WIDTH = 1600;

function write(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  console.log(`[brand] ${file}`);
}

function viewBoxSize(svg: string): { w: number; h: number } {
  const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!m) throw new Error("SVG without a 0-origin viewBox");
  return { w: Number(m[1]), h: Number(m[2]) };
}

async function png(browser: Browser, svg: string, file: string, width: number, transparent: boolean) {
  const { w, h } = viewBoxSize(svg);
  const height = Math.round((width * h) / w);
  const sized = svg.replace(/ width="[\d.]+" height="[\d.]+"/, ` width="${width}" height="${height}"`);
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${sized}</body></html>`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.locator("svg").screenshot({ path: file, omitBackground: transparent });
  await page.close();
  console.log(`[brand] ${file} (${width} x ${height})`);
}

async function main() {
  const logo = logoSvg();
  const square = logoSquareSvg();
  write("src/app/icon.svg", iconSvg());
  write("docs/brand/logo.svg", logo);
  write("docs/brand/logo-square.svg", square);

  const browser = await chromium.launch();
  try {
    await png(browser, logo, "docs/brand/logo.png", LOGO_PNG_WIDTH, true);
    await png(browser, square, "docs/brand/logo-square.png", 1024, false);
    await png(browser, appleIconSvg(), "src/app/apple-icon.png", 180, false);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
