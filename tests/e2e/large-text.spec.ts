import { expect, test, type Page } from "@playwright/test";

/**
 * The large-text toggle: a real button with aria-pressed, the whole app
 * scales, the choice survives a reload, it applies before the first paint,
 * and nothing breaks when storage is blocked. Independent of the database.
 */

const KEY = "carepool:large-text";

const rootPx = (page: Page) => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
const h1Px = (page: Page) => page.getByRole("heading", { level: 1 }).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

/** Collect hydration errors and uncaught page errors. */
function watchErrors(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /hydrat|did not match|server rendered/i.test(m.text())) problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(e.message));
  return problems;
}

test("large text: a real toggle button that enlarges the whole app and is remembered across reloads", async ({ page }) => {
  const problems = watchErrors(page);
  await page.goto("/schedule");
  const toggle = page.getByRole("button", { name: "Larger text" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(await rootPx(page)).toBe(17);
  const h1Before = await h1Px(page);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => rootPx(page)).toBe(21);
  expect(await h1Px(page)).toBeGreaterThan(h1Before * 1.2);
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe("1");

  await page.reload();
  await expect(page.getByRole("button", { name: "Larger text" })).toHaveAttribute("aria-pressed", "true");
  expect(await rootPx(page)).toBe(21);

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Medicines" }).click();
  await expect(page).toHaveURL(/\/meds$/);
  await expect(page.getByRole("button", { name: "Larger text" })).toHaveAttribute("aria-pressed", "true");
  expect(await rootPx(page)).toBe(21);

  await page.getByRole("button", { name: "Larger text" }).click();
  await expect(page.getByRole("button", { name: "Larger text" })).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => rootPx(page)).toBe(17);
  await page.reload();
  await expect(page.getByRole("button", { name: "Larger text" })).toHaveAttribute("aria-pressed", "false");
  expect(await rootPx(page)).toBe(17);
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();

  expect(problems).toEqual([]);
});

test("large text is on before the first paint: the class is set while the HTML is still being parsed", async ({ page }) => {
  const problems = watchErrors(page);
  await page.addInitScript((key) => {
    localStorage.setItem(key, "1");
    const w = window as unknown as { __atBody?: { large: boolean; readyState: string } };
    new MutationObserver((_, observer) => {
      if (!document.body || w.__atBody) return;
      w.__atBody = { large: document.documentElement.classList.contains("large-text"), readyState: document.readyState };
      observer.disconnect();
    }).observe(document, { childList: true, subtree: true });
  }, KEY);
  await page.goto("/");
  const atBody = await page.evaluate(() => (window as unknown as { __atBody?: { large: boolean; readyState: string } }).__atBody);
  expect(atBody).toEqual({ large: true, readyState: "loading" });
  await expect(page.getByRole("button", { name: "Larger text" })).toHaveAttribute("aria-pressed", "true");
  expect(problems).toEqual([]);
});

test("blocked storage: pages still load and the toggle still works for the visit", async ({ page }) => {
  const problems = watchErrors(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
  });
  await page.goto("/");
  await expect(page.getByTestId("safety-banner")).toBeVisible();
  const toggle = page.getByRole("button", { name: "Larger text" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => rootPx(page)).toBe(21);
  expect(problems).toEqual([]);
});
