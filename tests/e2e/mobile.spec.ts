import { expect, test } from "@playwright/test";

/** Phone-sized pass: the safety banner and the main screens fit without sideways scrolling. */

for (const path of ["/", "/meds", "/interactions", "/schedule", "/circle", "/today/member-ana"]) {
  test(`fits a phone screen: ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByTestId("safety-banner")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}
