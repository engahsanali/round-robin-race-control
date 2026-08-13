import { expect, test } from "@playwright/test";

const proUrl = process.env.RR3_PRO_URL ?? "http://127.0.0.1:4174";

test("explores official standings, isolated what-if, finals decisions, and portable reports at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(proUrl);
  await page.getByRole("button", { name: "Load demo rehearsal" }).click();

  await page.getByRole("link", { name: "Standings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Standings" })).toBeFocused();
  await expect(page.getByRole("table", { name: "Preliminary standings" })).toBeVisible();
  await page.getByRole("button", { name: "Why is Car 1 ranked here?" }).click();
  await expect(page.getByRole("dialog", { name: "Why Car 1 is ranked here" })).toContainText("Competitive rank 1");
  await page.getByRole("button", { name: "Close rank proof" }).click();
  await page.getByRole("combobox", { name: "Hypothetical heat" }).selectOption("pre-m02-h03");
  await page.getByRole("combobox", { name: "Hypothetical winner" }).selectOption("car-06");
  await page.getByRole("button", { name: "Run what-if" }).click();
  await expect(page.getByRole("region", { name: "What-if — not official" })).toContainText("Car 6");

  await page.getByRole("link", { name: "Finals", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Finals" })).toBeFocused();
  await expect(page.getByRole("region", { name: "Qualification cutoff" })).toContainText("Automatic:");
  await expect(page.getByRole("button", { name: "Seal official champion" })).toBeDisabled();

  await page.getByRole("link", { name: "Reports", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Reports" })).toBeFocused();
  await page.getByRole("button", { name: "Prepare Event Pack" }).click();
  await expect(page.getByRole("list", { name: "Event Pack files" }).getByRole("listitem")).toHaveCount(8);
  await expect(page.getByRole("region", { name: "Share card preview" })).toContainText("Nine-Car Community Demo");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
