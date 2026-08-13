import { expect, test } from "@playwright/test";

const proUrl = process.env.RR3_PRO_URL ?? "http://127.0.0.1:4174";

test("compares and inspects a schedule at phone width with keyboard-reachable controls", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(proUrl);
  await page.getByRole("button", { name: "Load demo rehearsal" }).click();
  await page.getByRole("link", { name: "Schedule Lab", exact: true }).focus();
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { name: "Schedule Lab" })).toBeFocused();
  await page.getByRole("radio", { name: "Custom seeded search" }).check();
  await page.getByRole("textbox", { name: "Schedule seed" }).fill("playwright-proof");
  await page.getByRole("spinbutton", { name: "Matches" }).fill("4");
  await page.getByRole("button", { name: "Generate three candidates" }).click();

  await expect(page.getByRole("table", { name: "Schedule candidate comparison" }).getByRole("row"))
    .toHaveCount(4);
  await page.getByRole("radio", { name: "Choose candidate 2" }).check();
  await expect(page.getByLabel("Selected schedule seed")).toHaveText("playwright-proof-2");
  await expect(page.getByRole("table", { name: "Opponent pair frequency" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Lane balance data" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(await page.getByRole("button", { name: "Activate selected schedule" }).evaluate((element) => {
    const style = getComputedStyle(element);
    return Math.max(element.getBoundingClientRect().height, Number.parseFloat(style.minHeight));
  })).toBeGreaterThanOrEqual(48);
});
