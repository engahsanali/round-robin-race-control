import { expect, test, type Page } from "@playwright/test";

const meetUrl = process.env.RR3_MEET_URL ?? "http://127.0.0.1:4399";

async function openLocalDemo(page: Page, direct = true) {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== new URL(meetUrl).origin) externalRequests.push(request.url());
  });
  await page.goto(direct ? `${meetUrl}/?demo=1` : meetUrl);
  if (!direct) await page.getByRole("button", { name: /explore local read-only demo/i }).click();
  await expect(page.getByRole("main")).toBeVisible();
  return externalRequests;
}

test.describe("Meet production release", () => {
  test("fails closed when hosted account configuration is unavailable", async ({ page }) => {
    await page.goto(meetUrl);
    await expect(page.getByRole("heading", { name: /choose how to open meet edition/i })).toBeVisible();
    await page.getByRole("button", { name: /open official workspace/i }).click();
    await expect(page.getByRole("alert")).toContainText(/Supabase URL|publishable key|environment unavailable/i);
    await expect(page.getByRole("button", { name: /explore local read-only demo/i })).toBeEnabled();
  });

  test("serves a populated zero-network demo with progression, history, audit and reports", async ({ page }) => {
    const externalRequests = await openLocalDemo(page);
    await expect(page.getByTestId("bracket-sheet")).toHaveCount(7);
    await expect(page.getByRole("table", { name: /progression connections/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^advancement$/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /audit timeline/i })).toBeVisible();
    await expect(page.getByRole("region", { name: /qualifier 2 advancement history/i })).toContainText(/Current|Superseded|stale/i);
    await expect(page.getByText("Made by Cesar Lacsamana and Ahsan Ali").first()).toBeVisible();

    const trigger = page.getByRole("button", { name: /reports & event pack/i });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: /meet reports and event pack/i });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(externalRequests).toEqual([]);
  });

  for (const size of [
    { name: "mobile", width: 320, height: 740 },
    { name: "tablet", width: 768, height: 900 },
    { name: "desktop", width: 1440, height: 900 },
    { name: "projector", width: 1920, height: 1080 },
  ]) {
    test(`contains horizontal overflow and preserves touch targets at ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openLocalDemo(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const table = page.locator(".table-scroll").first();
      await expect(table).toHaveCSS("overflow-x", "auto");
      if (size.width <= 768) await expect(page.getByLabel("Active bracket")).toBeVisible();
      else await expect(page.getByRole("complementary", { name: /bracket and stage index/i })).toBeVisible();
      const printButton = page.getByRole("button", { name: /print selected/i });
      const box = await printButton.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    });
  }

  test("supports keyboard anchor navigation and reduced-motion preferences", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openLocalDemo(page, false);
    const qualifierLink = page.getByRole("complementary", { name: /bracket and stage index/i }).getByRole("link", { name: /qualifier 2/i });
    await qualifierLink.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("[id^=bracket-title-]:focus")).toContainText(/Qualifier 2/i);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe("auto");
    expect(await qualifierLink.evaluate((element) => Number.parseFloat(getComputedStyle(element).transitionDuration))).toBeLessThanOrEqual(0.001);
  });

  test("keeps advancement, audit and exact credit in a print-safe layout", async ({ page }) => {
    await openLocalDemo(page);
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("heading", { name: /^advancement$/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /audit timeline/i })).toBeVisible();
    await expect(page.getByText("Made by Cesar Lacsamana and Ahsan Ali").first()).toBeVisible();
    await expect(page.locator(".meet-toolbar")).toBeHidden();
    await expect(page.locator(".race-control").first()).toBeHidden();
  });
});
