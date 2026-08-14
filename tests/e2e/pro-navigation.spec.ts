import { expect, test } from "@playwright/test";

const proUrl = process.env.RR3_PRO_URL ?? "http://127.0.0.1:4174";

test("ships truthful metadata, deep routes, settings, diagnostics, and live shell status", async ({ page }) => {
  await page.goto(`${proUrl}/settings`);

  await expect(page).toHaveTitle("Round Robin Race Control Pro");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /local-first.*three-lane/i);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "Round Robin Race Control Pro");
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content", /local-first.*device/i);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");

  await expect(page.getByRole("heading", { name: "Settings", level: 2 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Competition settings" })).toContainText("Create or load an event");
  await expect(page.getByText(/cloud sync/i)).toContainText("not");

  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await page.getByRole("button", { name: "Load demo rehearsal" }).click();
  const status = page.getByRole("region", { name: "Event status" });
  await expect(status).toContainText("Nine-Car Community Demo");
  await expect(status).toContainText("Running");
  await expect(status).toContainText("Demo rehearsal — not saved");

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("checkbox", { name: "Record lane times" }).check();
  await page.getByRole("button", { name: "Save competition settings" }).click();
  await expect(page.getByRole("status", { name: "Settings result" })).toContainText("saved");

  await page.getByRole("link", { name: "Diagnostics", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Diagnostics", level: 2 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Release identity" })).toContainText(/Version 0\.1\.0/);
  await expect(page.getByRole("region", { name: "Local capability checks" })).toContainText(/Service worker/);
  await expect(page.getByText(/sanitized.*never raw stack traces/i)).toBeVisible();
});
