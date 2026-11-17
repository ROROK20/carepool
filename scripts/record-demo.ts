/**
 * Records a SILENT screen capture of the demo, one Playwright video per
 * scene, cut to the beats of DEMO_SCRIPT.md and joined with ffmpeg. The
 * founder records the narration over it (no synthetic voice).
 *
 * Adapted from Dispute Defender's scripts/record-demo.ts (same author, MIT):
 * per-scene browser and video, trimming the blank frames before content
 * paints, normalizing to 1280x720 30 fps, ffmpeg concat. Removed: macOS
 * `say` narration, captions and speed-up; scenes are fixed-length instead.
 *
 * Run it against a server on its own database (scene 6 clicks through a
 * cover hand-off):
 *
 *   DATABASE_PATH=./data/demo-video.db CAREPOOL_OFFLINE=1 npx tsx scripts/setup.ts --reset --with-cards
 *   DATABASE_PATH=./data/demo-video.db CAREPOOL_OFFLINE=1 npx next dev -p 3330
 *   DEMO_BASE_URL=http://localhost:3330 npm run record
 *
 * Output: demo/out/carepool-demo-silent.mp4 (+ .json with scene timings). Nothing is uploaded.
 */
import { chromium, type Page } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:3330";
const DAY = process.env.DEMO_DATE ?? "2026-11-20";
const OUT = path.resolve("demo/out");
const WORK = path.resolve("demo/work");
const SIZE = { width: 1280, height: 720 };

interface Scene {
  id: string;
  /** Seconds in the final cut (matches DEMO_SCRIPT.md). */
  seconds: number;
  run: (page: Page, ready: () => void) => Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function open(page: Page, url: string, ready: () => void) {
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle", timeout: 180_000 });
  await page.getByTestId("safety-banner").waitFor({ timeout: 90_000 });
  await sleep(500);
  ready();
}

async function glide(page: Page, px: number, steps = 14, pauseMs = 160) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, px / steps);
    await sleep(pauseMs);
  }
}

const SCENES: Scene[] = [
  {
    id: "01-home",
    seconds: 13,
    run: async (page, ready) => {
      await open(page, `/?date=${DAY}`, ready);
      await sleep(3500);
      await page.mouse.move(640, 400);
      await glide(page, 520);
      await sleep(3000);
    },
  },
  {
    id: "02-card",
    seconds: 27,
    run: async (page, ready) => {
      await open(page, "/meds/med-lisinopril", ready);
      await sleep(3500);
      await glide(page, 360);
      const sentences = page.getByTestId("card-sentence");
      for (const i of [0, 3]) {
        const s = sentences.nth(i);
        await s.scrollIntoViewIfNeeded();
        await sleep(800);
        await s.getByText("Label says").click();
        await sleep(4500);
      }
      await glide(page, 700, 16, 200);
      await sleep(2500);
    },
  },
  {
    id: "03-interactions",
    seconds: 17,
    run: async (page, ready) => {
      await open(page, "/interactions", ready);
      await sleep(3000);
      const pair = page.getByTestId("flag-pair").filter({ hasText: "Spironolactone" }).first();
      await pair.scrollIntoViewIfNeeded();
      await sleep(5000);
      await glide(page, 600, 14, 220);
      await sleep(2500);
    },
  },
  {
    id: "04-schedule",
    seconds: 12,
    run: async (page, ready) => {
      await open(page, "/schedule", ready);
      await sleep(4000);
      await glide(page, 400);
      await sleep(3000);
    },
  },
  {
    id: "05-care-circle",
    seconds: 22,
    run: async (page, ready) => {
      await open(page, `/today/member-maya?date=${DAY}`, ready);
      await sleep(2500);
      const evening = page.getByTestId("task-task-evening-dose-check");
      await evening.scrollIntoViewIfNeeded();
      await sleep(1500);
      const cant = evening.getByRole("button", { name: "I can't today" });
      if (await cant.count()) await cant.click();
      await sleep(2500);
      await page.goto(`${BASE}/today/member-luis?date=${DAY}`, { waitUntil: "networkidle" });
      await sleep(2500);
      const take = page.getByTestId("up-for-grabs").getByRole("button", { name: "I'll take it" });
      if (await take.count()) await take.click();
      await sleep(2500);
      const done = page.getByTestId("covering").getByRole("button", { name: "Mark done" });
      if (await done.count()) await done.click();
      await sleep(3000);
    },
  },
  {
    id: "06-how-it-works",
    seconds: 16,
    run: async (page, ready) => {
      await open(page, "/how-it-works", ready);
      await sleep(3000);
      await glide(page, 650, 16, 220);
      await sleep(4000);
    },
  },
];

/** Decoded length in seconds (Playwright webm files carry no duration header). */
function duration(file: string): number {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-f", "null", "-"], { encoding: "utf8" });
  const last = [...String(r.stderr).matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].at(-1);
  if (!last) throw new Error(`could not read the duration of ${file}`);
  return Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });
  const parts: string[] = [];
  const timings: { id: string; capture_s: number; trimmed_s: number; final_s: number }[] = [];

  for (const scene of SCENES) {
    const dir = path.join(WORK, scene.id);
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, recordVideo: { dir, size: SIZE } });
    const page = await context.newPage();
    const t0 = Date.now();
    let readyAt = 0;
    console.log(`[record] ${scene.id} …`);
    await scene.run(page, () => {
      if (!readyAt) readyAt = (Date.now() - t0) / 1000;
    });
    const video = await page.video()!.path();
    await context.close();
    await browser.close();

    const trim = Math.max(0, readyAt - 0.3);
    const out = path.join(WORK, `${scene.id}.mp4`);
    execFileSync("ffmpeg", [
      "-y", "-ss", trim.toFixed(2), "-i", video,
      "-vf", `scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0xfaf8f4,fps=30,tpad=stop_mode=clone:stop_duration=${scene.seconds}`,
      "-t", String(scene.seconds), "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "20", out,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    parts.push(out);
    timings.push({ id: scene.id, capture_s: +duration(video).toFixed(1), trimmed_s: +trim.toFixed(1), final_s: scene.seconds });
  }

  const list = path.join(WORK, "parts.txt");
  fs.writeFileSync(list, parts.map((p) => `file '${p}'`).join("\n"));
  const final = path.join(OUT, "carepool-demo-silent.mp4");
  execFileSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", final], { stdio: ["ignore", "pipe", "pipe"] });
  const manifest = { file: final, seconds: Math.round(duration(final)), scenes: timings, base_url: BASE, date_shown: DAY };
  fs.writeFileSync(path.join(OUT, "carepool-demo-silent.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log("[record] done", JSON.stringify(manifest));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
