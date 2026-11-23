import { expect, test } from "@playwright/test";
import fs from "node:fs";

/**
 * The demo loop, end to end, in mock-provider offline mode on the fictional
 * Nana Rosa seed. The tests share one database and run in order.
 */

const seed = JSON.parse(fs.readFileSync("data/seed/nana-rosa.json", "utf8")) as { meds: { name: string; dose: string; times: string[] }[] };
const DAY = "2026-11-20";

test.describe.configure({ mode: "serial" });

test("home: safety, mock and fictional notices on the page; the seed is loaded", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("safety-banner")).toContainText("Not medical advice");
  await expect(page.getByTestId("safety-banner")).toContainText("pharmacist or doctor");
  await expect(page.getByTestId("mock-banner")).toBeVisible();
  await expect(page.getByTestId("fictional-banner")).toContainText("fictional");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nana Rosa's care");
  await expect(page.getByTestId("tile-meds")).toContainText("0 / 5");
});

test("making the cards: every medicine gets a card", async ({ page }) => {
  await page.goto("/meds");
  const list = page.getByTestId("med-list");
  for (const m of seed.meds) await expect(list).toContainText(m.name);
  await page.getByTestId("generate-button").first().click();
  await expect(page.getByText("card ready")).toHaveCount(5, { timeout: 120_000 });
});

test("a card: typed dose, quoted sentences, citation opens on the label text, checker removal shown", async ({ page }) => {
  await page.goto("/meds/med-lisinopril");
  await expect(page.getByTestId("card-typed-dose")).toHaveText(seed.meds[0].dose);
  await expect(page.getByTestId("label-meta")).toContainText("version");
  await expect(page.getByTestId("card-provenance")).toContainText("Mock card");
  await expect(page.getByTestId("card-provenance")).toContainText("quotes found word for word");
  const sentences = page.getByTestId("card-sentence");
  expect(await sentences.count()).toBeGreaterThan(3);
  const first = sentences.first();
  await first.getByText("Label says").click();
  await expect(first.getByTestId("quote-highlight")).toBeVisible();
  await expect(first.getByText("✓ word for word")).toBeVisible();
  const removed = page.getByTestId("removed-sentences");
  await removed.locator("summary").click();
  await expect(removed).toContainText("common cold");
  await expect(removed).toContainText("not in the label word for word");
  // The meaning gate: a sentence with a real quote that adds a claim is removed, with the check's reason shown.
  await expect(page.getByTestId("meaning-gate")).toContainText("meaning check");
  await expect(removed).toContainText("the meaning check found it says more than its quote");
  await expect(removed.getByTestId("meaning-reason").first()).toContainText("Its quote:");
  // No card sentence carries a dose amount.
  const texts = await sentences.allInnerTexts();
  for (const t of texts) expect(t).not.toMatch(/\b\d+\s*(mg|mcg|tablets?)\b/i);
});

test("interactions: the three label-stated pairs, with verbatim label quotes", async ({ page }) => {
  await page.goto("/interactions");
  await expect(page.getByTestId("flag-summary")).toContainText("5 medicines checked, 10 pairs, 3 flagged");
  const pairs = page.getByTestId("flag-pair");
  await expect(pairs).toHaveCount(3);
  const lisSpiro = pairs.filter({ hasText: "Lisinopril + Spironolactone" });
  await expect(lisSpiro).toContainText("Potassium-sparing diuretics (spironolactone, amiloride, triamterene, and others) can increase the risk of hyperkalemia.");
  await expect(lisSpiro.getByTestId("flag-explanation")).toBeVisible();
  await expect(pairs.filter({ hasText: "Warfarin" })).toContainText("warfarin");
  await expect(pairs.filter({ hasText: "Metformin" })).toContainText("antidiabetic");
});

test("schedule: only the doses and times that were typed, word for word", async ({ page }) => {
  await page.goto("/schedule");
  const doses = await page.getByTestId("schedule-dose").allInnerTexts();
  const expected = seed.meds.flatMap((m) => m.times.map(() => m.dose));
  expect(doses.sort()).toEqual(expected.sort());
  await expect(page.getByRole("heading", { name: "8:00 AM" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "6:00 PM" })).toBeVisible();
});

test("a medicine with no time is never placed on the schedule", async ({ page }) => {
  await page.goto("/meds");
  const form = page.getByTestId("add-med-form");
  await form.getByLabel("Medicine name").fill("Atorvastatin");
  await form.getByLabel("Dose, exactly as the prescription label says").fill("ask pharmacist (bottle smudged)");
  await form.getByRole("button", { name: "Add medicine" }).click();
  await expect(form.getByRole("status")).toContainText("Added Atorvastatin");
  await page.goto("/schedule");
  await expect(page.getByTestId("unscheduled")).toContainText("Atorvastatin");
  await expect(page.getByTestId("unscheduled")).toContainText("ask pharmacist (bottle smudged)");
  await expect(page.getByTestId("schedule")).not.toContainText("Atorvastatin");
});

test("the times field refuses words instead of guessing", async ({ page }) => {
  await page.goto("/meds");
  const form = page.getByTestId("add-med-form");
  await form.getByLabel("Medicine name").fill("Omeprazole");
  await form.getByLabel("Times you give it").fill("morning");
  await form.getByRole("button", { name: "Add medicine" }).click();
  await expect(form.getByRole("status")).toContainText("not a clock time");
});

test("pasting a list previews what will be saved and flags vague times", async ({ page }) => {
  await page.goto("/meds");
  await page.getByTestId("paste-box").fill("Furosemide 20 mg tablet every morning\nLevothyroxine 50 mcg tablet 7:00 AM");
  const preview = page.getByTestId("paste-preview");
  await expect(preview).toContainText("Furosemide");
  await expect(preview).toContainText("No clock time found");
  await expect(preview).toContainText("7:00 AM");
});

test("care circle: ask for cover, someone else takes it and marks it done", async ({ page }) => {
  await page.goto(`/today/member-maya?date=${DAY}`);
  const evening = page.getByTestId("task-task-evening-dose-check");
  await expect(evening).toContainText("Evening dose check");
  await expect(evening).toContainText("Warfarin");
  await expect(evening).toContainText(seed.meds[2].dose);
  await evening.getByRole("button", { name: "I can't today" }).click();
  await expect(evening).toContainText("needs cover");

  await page.goto(`/today/member-luis?date=${DAY}`);
  const grabs = page.getByTestId("up-for-grabs");
  await expect(grabs).toContainText("Evening dose check");
  await expect(grabs).toContainText("Maya can't make it");
  await grabs.getByRole("button", { name: "I'll take it" }).click();
  const covering = page.getByTestId("covering");
  await expect(covering).toContainText("covering for Maya");
  await covering.getByRole("button", { name: "Mark done" }).click();
  await expect(covering).toContainText("done");

  await page.goto(`/today/member-maya?date=${DAY}`);
  await expect(page.getByTestId("my-tasks")).not.toContainText("Evening dose check");
  await page.goto(`/?date=${DAY}`);
  await expect(page.getByTestId("tile-circle")).toContainText("1 / 4");
});

test("how it works: pipeline and measured results", async ({ page }) => {
  await page.goto("/how-it-works");
  await expect(page.getByTestId("pipeline")).toContainText("Check every sentence");
  await expect(page.getByTestId("eval-summary")).toContainText("precision");
});
