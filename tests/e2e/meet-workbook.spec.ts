import { expect, test } from "@playwright/test";

test.describe("Meet workbook root workspace", () => {
  test.skip(!process.env.RR3_MEET_URL, "Task 7 owns the production Meet server lifecycle");

  test("keeps one document route, contained overflow and keyboard race controls", async ({ page }) => {
    await page.goto(process.env.RR3_MEET_URL!);
    await page.getByRole("button", { name: /explore read-only demo/i }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("main")).toHaveCSS("overflow-x", /visible|clip|hidden/);
    await expect(page.getByText("Made by Cesar Lacsamana and Ahsan Ali").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  for (const size of [{ name: "mobile", width: 320, height: 740 }, { name: "tablet", width: 768, height: 900 }, { name: "desktop", width: 1440, height: 900 }]) {
    test(`has no whole-document overflow at ${size.name} size`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(process.env.RR3_MEET_URL!);
      await page.getByRole("button", { name: /explore read-only demo/i }).click();
      expect(await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }))).toEqual({ document: size.width, viewport: size.width });
      if (size.width <= 768) await expect(page.getByLabel("Active bracket")).toBeVisible();
      else await expect(page.getByRole("complementary", { name: /bracket and stage index/i })).toBeVisible();
    });
  }
});
