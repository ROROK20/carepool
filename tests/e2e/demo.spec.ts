import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

/**
 * The demo loop, end to end, in mock-provider offline mode on the fictional
 * Nana Rosa seed. The tests share one database and run in order.
 */

const seed = JSON.parse(fs.readFileSync("data/seed/nana-rosa.json", "utf8")) as { meds: { name: string; dose: string; times: string[]; notes: string }[] };
const DAY = "2026-11-20";

/** A dose amount or a dosing frequency: things only the family may type. */
const DOSE_TOKEN =
  /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|g|ml|units?|iu|tablets?|tabs?|capsules?|caps?|pills?|puffs?|drops?|sprays?|patch(?:es)?)\b|\b(?:once|twice|three times|four times)\s+(?:a\s+)?(?:day|daily|weekly)\b|\bevery\s+\d+\s+hours?\b/gi;
const CLOCK_TIME = /\b\d{1,2}:\d{2}\b/g;
/** "18:00" → "6:00 PM", written out here independently of the app's formatter. */
const clock = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
const TYPED_FIELDS = ["sheet-dose", "sheet-times", "sheet-notes"];

/** The sheet's text with the family's own fields (dose, times, notes) left out. */
async function sheetTextOutsideTypedFields(page: Page): Promise<string> {
  return page.getByTestId("doctor-sheet").evaluate((root, skip) => {
    const parts: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.parentElement?.closest(skip.map((id) => `[data-testid="${id}"]`).join(","))) parts.push(n.textContent ?? "");
    }
    return parts.join(" ");
  }, TYPED_FIELDS);
}

function sheetRow(page: Page, name: string) {
  return page.getByTestId("sheet-med").filter({ has: page.getByTestId("sheet-med-name").getByText(name, { exact: true }) });
}

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

test("doctor-visit sheet: all five medicines, with exactly the doses and times the family typed and the label each card used", async ({ page }) => {
  await page.goto("/sheet");
  const sheet = page.getByTestId("doctor-sheet");
  await expect(sheet.getByTestId("sheet-recipient")).toHaveText("Nana Rosa's medicines");
  await expect(sheet.getByTestId("sheet-printed-date")).toHaveText(/^Printed [A-Z][a-z]+ \d{1,2}, \d{4}$/);
  await expect(sheet.getByTestId("sheet-safety")).toContainText("Not medical advice.");
  await expect(sheet.getByTestId("sheet-safety")).toContainText("Always confirm medicines, doses and interactions with a pharmacist or doctor.");

  await expect(sheet.getByTestId("sheet-med")).toHaveCount(seed.meds.length);
  for (const m of seed.meds) {
    const row = sheetRow(page, m.name);
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId("sheet-dose")).toHaveText(m.dose);
    await expect(row.getByTestId("sheet-times")).toHaveText(m.times.map(clock).join(", "));
    if (m.notes) await expect(row.getByTestId("sheet-notes")).toHaveText(m.notes);
    else await expect(row.getByTestId("sheet-notes")).toHaveCount(0);
    await expect(row.getByTestId("sheet-label")).toContainText(/Label the card used: .+, version \S+, effective [A-Z][a-z]+ \d{1,2}, \d{4}\./);
    await expect(row.getByTestId("sheet-dailymed")).toHaveText(/^DailyMed: https:\/\/dailymed\.nlm\.nih\.gov\/dailymed\/lookup\.cfm\?setid=[0-9a-f-]{36}$/);
  }

  // Every dose on the sheet is one the seed typed, word for word, and nothing else carries a dose, a frequency or a clock time.
  expect((await sheet.getByTestId("sheet-dose").allInnerTexts()).sort()).toEqual(seed.meds.map((m) => m.dose).sort());
  const typedTokens = new Set(seed.meds.flatMap((m) => m.dose.match(DOSE_TOKEN) ?? []).map((t) => t.toLowerCase()));
  expect([...typedTokens]).toEqual(expect.arrayContaining(["10 mg", "500 mg", "1 tablet", "once daily", "twice daily"]));
  expect((await sheet.innerText()).match(CLOCK_TIME)).toEqual(expect.arrayContaining(["8:00", "6:00"]));
  for (const t of (await sheet.innerText()).match(DOSE_TOKEN) ?? []) expect(typedTokens, `"${t}" is not a dose the family typed`).toContain(t.toLowerCase());
  const rest = await sheetTextOutsideTypedFields(page);
  expect(rest.match(DOSE_TOKEN)).toBeNull();
  expect(rest.match(CLOCK_TIME)).toBeNull();
});

test("doctor-visit sheet: every flagged pair with its verbatim label quotes and source, and the same questions as the home page", async ({ page }) => {
  // What the interaction page shows for each flagged pair.
  await page.goto("/interactions");
  const expected: { title: string; quotes: string[] }[] = [];
  for (const pair of await page.getByTestId("flag-pair").all()) {
    expected.push({
      title: (await pair.getByRole("heading", { level: 2 }).innerText()).trim(),
      quotes: (await pair.getByTestId("flag-quote").locator(".label-quote").allInnerTexts()).map((q) => q.trim()),
    });
  }
  expect(expected).toHaveLength(3);
  await page.goto("/");
  const homeQuestions = (await page.getByTestId("pharmacist-question-text").allInnerTexts()).map((q) => q.trim());

  await page.goto("/sheet");
  const pairs = page.getByTestId("sheet-pair");
  await expect(pairs).toHaveCount(expected.length);
  expect((await pairs.getByRole("heading", { level: 3 }).allInnerTexts()).map((t) => t.trim())).toEqual(expected.map((e) => e.title));
  for (const e of expected) {
    const block = pairs.filter({ has: page.getByRole("heading", { level: 3, name: e.title, exact: true }) });
    expect((await block.getByTestId("sheet-quote-text").allInnerTexts()).map((q) => q.trim())).toEqual(e.quotes);
    for (const source of await block.getByTestId("sheet-quote-source").allInnerTexts()) {
      expect(source).toMatch(/^\S+ FDA label, .+ section, version \S+ \(\d{4}-\d{2}-\d{2}\)\. It names “.+”/);
    }
  }
  const lisSpiro = pairs.filter({ hasText: "Lisinopril + Spironolactone" });
  await expect(lisSpiro.getByTestId("sheet-quote-text").first()).toHaveText(
    "Potassium-sparing diuretics (spironolactone, amiloride, triamterene, and others) can increase the risk of hyperkalemia.",
  );
  await expect(lisSpiro.getByTestId("sheet-quote-source").first()).toContainText("Lisinopril FDA label, Drug Interactions section, version");
  expect((await page.getByTestId("sheet-question-text").allInnerTexts()).map((q) => q.trim())).toEqual(homeQuestions);
});

test("doctor-visit sheet on paper: black on white, no navigation or buttons, safety line kept, no medicine or pair split", async ({ page }) => {
  await page.goto("/sheet");
  await expect(page.getByTestId("print-button")).toHaveText("Print this sheet");
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  await expect(page.getByTestId("print-button")).toBeHidden();
  await expect(page.getByTestId("large-text-toggle")).toBeHidden();
  await expect(page.getByTestId("sheet-safety")).toBeVisible();
  await expect(page.getByTestId("sheet-safety")).toContainText("Not medical advice.");
  await expect(page.getByTestId("safety-banner")).toBeHidden(); // the sheet carries its own copy
  await expect(page.getByTestId("mock-banner")).toBeVisible();
  await expect(page.getByTestId("fictional-banner")).toBeVisible();
  const paper = await page.evaluate(() => {
    const cs = (el: Element) => getComputedStyle(el);
    const blocks = [...document.querySelectorAll('[data-testid="sheet-med"], [data-testid="sheet-pair"]')];
    const texts = [...document.querySelectorAll("#doctor-sheet *")].filter((el) => el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim()));
    return {
      body: cs(document.body).backgroundColor,
      colors: [...new Set(texts.map((el) => cs(el).color))],
      backgrounds: [...new Set([...document.querySelectorAll("#doctor-sheet, #doctor-sheet *")].map((el) => cs(el).backgroundColor))],
      breaks: [...new Set(blocks.map((el) => cs(el).breakInside))],
      blocks: blocks.length,
    };
  });
  expect(paper.body).toBe("rgb(255, 255, 255)");
  expect(paper.colors).toEqual(["rgb(0, 0, 0)"]);
  expect(paper.backgrounds).toEqual(["rgba(0, 0, 0, 0)"]);
  expect(paper.blocks).toBe(8);
  expect(paper.breaks).toEqual(["avoid"]);
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

test("the sheet says 'not entered' instead of filling in a missing time, and marks a medicine without a card", async ({ page }) => {
  await page.goto("/sheet");
  const row = sheetRow(page, "Atorvastatin");
  await expect(row.getByTestId("sheet-dose")).toHaveText("ask pharmacist (bottle smudged)");
  await expect(row.getByTestId("sheet-times")).toHaveText("not entered");
  await expect(row.getByTestId("sheet-label")).toHaveText("Label the card used: No card yet.");
  await expect(page.getByTestId("sheet-unchecked")).toContainText("Not checked yet: Atorvastatin.");
  expect((await sheetTextOutsideTypedFields(page)).match(CLOCK_TIME)).toBeNull();
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

test("a medicine with no dose typed: the sheet says 'not entered' and never fills one in", async ({ page }) => {
  await page.goto("/meds");
  const form = page.getByTestId("add-med-form");
  await form.getByLabel("Medicine name").fill("Furosemide");
  await form.getByRole("button", { name: "Add medicine" }).click();
  await expect(form.getByRole("status")).toContainText("Added Furosemide");
  await page.goto("/sheet");
  const row = sheetRow(page, "Furosemide");
  await expect(row.getByTestId("sheet-dose")).toHaveText("not entered");
  await expect(row.getByTestId("sheet-times")).toHaveText("not entered");
  expect((await row.innerText()).match(DOSE_TOKEN)).toBeNull();
  expect((await sheetTextOutsideTypedFields(page)).match(DOSE_TOKEN)).toBeNull();
});
