import { expect, test } from "@playwright/test";

test.describe("Meet workbook root workspace", () => {
  const meetUrl = process.env.RR3_MEET_URL ?? "http://127.0.0.1:4399";

  test("keeps one document route, contained overflow and keyboard race controls", async ({ page }) => {
    await page.goto(meetUrl);
    await page.getByRole("button", { name: /explore read-only demo/i }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("main")).toHaveCSS("overflow-x", /visible|clip|hidden/);
    await expect(page.getByText("Made by Cesar Lacsamana and Ahsan Ali").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /^advancement$/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /audit timeline/i })).toBeVisible();
    await expect(page.getByRole("status", { name: /workspace status/i })).toContainText(/offline|connected|reconnecting/i);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test("keeps advancement and accountability summaries in the printable workbook", async ({ page }) => {
    await page.goto(meetUrl);
    await page.getByRole("button", { name: /explore read-only demo/i }).click();
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("heading", { name: /^advancement$/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /audit timeline/i })).toBeVisible();
  });

  test("runs the populated demo and public Event Pack without any Supabase traffic", async ({ page }) => {
    const supabaseRequests: string[] = [];
    page.on("request", (request) => { if (/supabase\.co|\/auth\/v1|\/rest\/v1|\/realtime\/v1/i.test(request.url())) supabaseRequests.push(request.url()); });
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto(`${meetUrl}?demo=1`);
    await expect(page.getByTestId("bracket-sheet")).toHaveCount(7);
    await expect(page.getByText(/tie decision scenario/i)).toBeVisible();
    await page.getByRole("button", { name: /reports & event pack/i }).click();
    await page.getByRole("radio", { name: /public pack/i }).click();
    await page.getByRole("button", { name: /build public event pack/i }).click();
    await expect(page.getByRole("button", { name: /download 12 public files/i })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(supabaseRequests).toEqual([]);
  });

  for (const size of [{ name: "mobile", width: 320, height: 740 }, { name: "tablet", width: 768, height: 900 }, { name: "desktop", width: 1440, height: 900 }]) {
    test(`has no whole-document overflow at ${size.name} size`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(meetUrl);
      await page.getByRole("button", { name: /explore read-only demo/i }).click();
      expect(await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }))).toEqual({ document: size.width, viewport: size.width });
      if (size.width <= 768) await expect(page.getByLabel("Active bracket")).toBeVisible();
      else await expect(page.getByRole("complementary", { name: /bracket and stage index/i })).toBeVisible();
      const printTarget = page.getByRole("button", { name: /print selected/i });
      const target = await printTarget.boundingBox();
      expect(target?.height ?? 0).toBeGreaterThanOrEqual(44);
      await page.getByRole("link", { name: /qualifier 2/i }).focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/$/);
    });
  }
});
