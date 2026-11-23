import { expect, test } from "@playwright/test";

/** The logo in the header and the icons in <head>. Independent of the database. */

test("header: the Carepool mark and wordmark, named for screen readers, linked home, and growing with large text", async ({ page }) => {
  await page.goto("/schedule");
  const brand = page.getByRole("link", { name: "Carepool", exact: true });
  await expect(brand).toHaveAttribute("href", "/");
  await expect(brand.locator("svg")).toHaveCount(2);
  const markWidth = () => brand.locator("svg").first().evaluate((el) => el.getBoundingClientRect().width);
  const before = await markWidth();
  expect(before).toBeGreaterThan(30);
  await page.getByRole("button", { name: "Larger text" }).click();
  await expect.poll(markWidth).toBeGreaterThan(before * 1.2);
  await brand.click();
  await expect(page).toHaveURL(/\/$/);
});

test("icons: the favicon and the home-screen icon are linked and served", async ({ page, request }) => {
  await page.goto("/");
  const icon = page.locator('head link[rel="icon"][type="image/svg+xml"]');
  await expect(icon).toHaveCount(1);
  const svg = await request.get((await icon.getAttribute("href"))!);
  expect(svg.ok()).toBe(true);
  expect(svg.headers()["content-type"]).toContain("image/svg+xml");
  expect(await svg.text()).toContain("<title>Carepool</title>");

  const apple = page.locator('head link[rel="apple-touch-icon"]');
  await expect(apple).toHaveCount(1);
  await expect(apple).toHaveAttribute("sizes", "180x180");
  const png = await request.get((await apple.getAttribute("href"))!);
  expect(png.ok()).toBe(true);
  expect(png.headers()["content-type"]).toContain("image/png");
});
