import { expect, test } from "@playwright/test";

const proUrl = process.env.RR3_PRO_URL ?? "http://127.0.0.1:4174";

test("supports 320px, keyboard focus, dialogs, reduced motion, and long Unicode event text", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(proUrl);

  await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "reduce");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to race control" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();

  const paletteTrigger = page.getByRole("button", { name: "Open command palette" });
  await paletteTrigger.click();
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(paletteTrigger).toBeFocused();

  await page.getByLabel("Event name").fill("Perth 三 Lane Championship — César Lacsamana & Ahsan Ali ".repeat(2));
  await page.getByLabel("Event date").fill("2026-08-14");
  await page.getByRole("button", { name: "Next: Categories" }).click();
  await page.getByRole("button", { name: "Next: Entrants" }).click();
  await page.getByLabel("Participant name").fill("Zoë Nguyễn الطويل");
  await page.getByLabel("Car 1 name").fill("RR 三 — Éclair");
  await page.getByRole("button", { name: "Next: Competition" }).click();
  await page.getByRole("button", { name: "Review event" }).click();
  await page.getByRole("button", { name: "Create real event" }).click();
  await expect(page.getByRole("region", { name: "Event status" })).toContainText("Perth 三 Lane Championship");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  for (const viewport of [
    { width: 768, height: 900 },
    { width: 1280, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
});

test("announces precise empty-form errors without moving focus away from the operator", async ({ page }) => {
  await page.goto(proUrl);
  const next = page.getByRole("button", { name: "Next: Categories" });
  await next.focus();
  await next.click();
  await expect(page.getByRole("alert")).toContainText("Event name is required");
  await expect(page.getByRole("alert")).toContainText("Event date is required");
  await expect(next).toBeFocused();
});
