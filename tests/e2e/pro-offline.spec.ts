import { expect, test } from "@playwright/test";

const proUrl = process.env.RR3_PRO_URL ?? "http://127.0.0.1:4174";

test("installs a local service worker and reopens a deep route offline", async ({ context, page }) => {
  await page.goto(`${proUrl}/diagnostics`);
  await expect(page.getByRole("heading", { name: "Diagnostics", exact: true })).toBeVisible();

  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Diagnostics", exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "Network status" })).toContainText("Offline");
  await expect(page.getByText(/local event data stays on this device/i)).toBeVisible();
  await context.setOffline(false);
});
