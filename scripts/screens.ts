/**
 * Screenshots of the main screens into docs/screens/.
 *
 * Run it against a server on its own database, because it clicks through
 * the cover hand-off to show it:
 *
 *   DATABASE_PATH=./data/screens.db CAREPOOL_OFFLINE=1 npx tsx scripts/setup.ts --reset --with-cards
 *   DATABASE_PATH=./data/screens.db CAREPOOL_OFFLINE=1 npx next dev -p 3320
 *   SCREENS_BASE_URL=http://localhost:3320 npm run screens
 */
import { chromium, devices, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.SCREENS_BASE_URL ?? "http://localhost:3320";
const OUT = path.resolve("docs/screens");
const DAY = process.env.SCREENS_DATE ?? "2026-11-20";

async function shot(page: Page, name: string, url: string, prepare?: (p: Page) => Promise<void>) {
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle", timeout: 180_000 });
  await page.getByTestId("safety-banner").waitFor({ timeout: 60_000 });
  if (prepare) await prepare(page);
  await page.waitForTimeout(400);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`[screens] ${file}`);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
  const page = await desktop.newPage();

  await shot(page, "01-home", `/?date=${DAY}`);
  await shot(page, "02-medicines", "/meds");
  await shot(page, "03-card-lisinopril", "/meds/med-lisinopril", async (p) => {
    const first = p.getByTestId("card-sentence").first();
    await first.getByText("Label says").click();
    await first.getByTestId("quote-highlight").waitFor();
  });
  await shot(page, "04-interactions", "/interactions");
  await shot(page, "05-schedule", "/schedule");
  await shot(page, "06-care-circle", "/circle");

  // The support loop: Maya can't do the evening check; Luis sees it and takes it.
  await page.goto(`${BASE}/today/member-maya?date=${DAY}`, { waitUntil: "networkidle" });
  const evening = page.getByTestId("task-task-evening-dose-check");
  const cant = evening.getByRole("button", { name: "I can't today" });
  if (await cant.count()) {
    await cant.click();
    await evening.getByText("needs cover").waitFor();
  }
  await shot(page, "07-today-luis-up-for-grabs", `/today/member-luis?date=${DAY}`);
  await shot(page, "08-how-it-works", "/how-it-works");

  const phone = await browser.newContext({ ...devices["Pixel 7"] });
  const mobile = await phone.newPage();
  await shot(mobile, "09-phone-card", "/meds/med-warfarin");
  await shot(mobile, "10-phone-today", `/today/member-ana?date=${DAY}`);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
