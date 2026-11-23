import { expect, test } from "@playwright/test";

/** Phone-sized pass: the safety banner and the main screens fit without sideways scrolling. */

const PATHS = ["/", "/meds", "/interactions", "/schedule", "/circle", "/today/member-ana", "/sheet"];

for (const path of PATHS) {
  test(`fits a phone screen: ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByTestId("safety-banner")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

for (const path of PATHS) {
  test(`large text still fits a phone screen: ${path}`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("carepool:large-text", "1"));
    await page.goto(path);
    await expect(page.getByRole("button", { name: "Larger text" })).toHaveAttribute("aria-pressed", "true");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test("the safety notice stays on screen while scrolling", async ({ page }) => {
  await page.goto("/meds");
  const scrolled = await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
    return window.scrollY;
  });
  expect(scrolled).toBeGreaterThan(500);
  await page.waitForTimeout(300);
  const box = await page.getByTestId("safety-banner").boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeLessThanOrEqual(1);
  await expect(page.getByTestId("safety-banner")).toContainText("pharmacist or doctor");
});
