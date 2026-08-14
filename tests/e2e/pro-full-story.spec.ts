import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const proUrl = process.env.RR3_PRO_URL ?? "http://127.0.0.1:4174";

test("runs a clean local event from setup through payment, racing, finals, transfer, and guarded replay", async ({ page }) => {
  await page.goto(proUrl);
  await page.getByLabel("Event name").fill("Clean release race");
  await page.getByLabel("Event date").fill("2026-08-14");
  await page.getByLabel("Venue").fill("Release Hall");
  await page.getByRole("button", { name: "Next: Categories" }).click();
  await page.getByRole("button", { name: "Next: Entrants" }).click();
  await page.getByLabel("Participant name").fill("Release Driver");
  for (let index = 1; index <= 3; index += 1) {
    if (index > 1) await page.getByRole("button", { name: "Add another car" }).click();
    await page.getByLabel(`Car ${index} name`).fill(`Release Car ${index}`);
  }
  await page.getByRole("button", { name: "Next: Competition" }).click();
  await page.getByRole("button", { name: "Review event" }).click();
  await page.getByRole("button", { name: "Create real event" }).click();
  await expect(page.getByRole("region", { name: "Event status" })).toContainText("Clean release race");

  await page.getByRole("link", { name: "Registration", exact: true }).click();
  await expect(page.getByRole("table", { name: "Registered cars" }).getByRole("row")).toHaveCount(4);
  await page.getByRole("button", { name: "Manage account Release Driver" }).first().click();
  await page.getByLabel("Amount in cents").fill("3600");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByRole("region", { name: "Release Driver account" })).toContainText("Paid");

  await page.getByRole("link", { name: "Schedule Lab", exact: true }).click();
  await page.getByRole("radio", { name: "Custom seeded search" }).check();
  await page.getByRole("spinbutton", { name: "Matches" }).fill("1");
  await page.getByRole("button", { name: "Generate three candidates" }).click();
  await page.getByRole("button", { name: "Activate selected schedule" }).click();
  await page.getByRole("button", { name: "Confirm activation" }).click();
  await expect(page.getByRole("status", { name: "Schedule activation status" })).toContainText("Activated 1 heats");

  await page.getByRole("link", { name: "Race Command", exact: true }).click();
  await page.keyboard.press("1");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Result receipt" })).toContainText("Recorded Car");
  await page.getByRole("link", { name: "Standings", exact: true }).click();
  await expect(page.getByRole("table", { name: "Preliminary standings" })).toContainText("Release Driver");

  await page.getByRole("link", { name: "Finals", exact: true }).click();
  await page.getByRole("button", { name: "Generate and activate finals" }).click();
  await expect(page.getByText("Activated 1 finals heats.")).toBeVisible();
  await page.getByRole("link", { name: "Race Command", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Heat navigation" })).toContainText("2 of 2");
  await page.getByRole("button", { name: /Lane 1 · Car .* wins/ }).click();
  await page.getByRole("button", { name: "Confirm result" }).click();
  await expect(page.getByRole("status", { name: "Command status" })).toContainText("Official result committed");
  await page.getByRole("link", { name: "Finals", exact: true }).click();
  await page.getByRole("button", { name: "Seal official champion" }).click();
  await expect(page.getByText(/Official champion:/)).toBeVisible();

  await page.getByRole("link", { name: "Reports", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Prepare Event Pack" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error("Event JSON download did not produce a local file");
  const exported = await readFile(downloadPath, "utf8");

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByLabel("Ranking mode").selectOption("dense");
  await page.getByRole("button", { name: "Save competition settings" }).click();
  await page.getByRole("link", { name: "Reports", exact: true }).click();
  await page.getByLabel("Compatible event JSON").fill(exported);
  await page.getByRole("button", { name: "Import compatible event" }).click();
  await expect(page.getByText("Imported compatible event JSON atomically.")).toBeVisible();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Ranking mode")).toHaveValue("competition");

  await page.getByRole("link", { name: "Reports", exact: true }).click();
  const previewButton = page.getByRole("button", { name: /Preview Updated competition settings/ }).first();
  await previewButton.click();
  await expect(page.getByRole("region", { name: "Revision preview" })).toContainText("setting");
  await page.getByRole("button", { name: "Restore this revision" }).click();
  await expect(page.getByRole("alertdialog", { name: "Confirm revision restore" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm restore" }).click();
  await expect(page.getByText("Restored Updated competition settings.")).toBeVisible();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Ranking mode")).toHaveValue("dense");
});

test("serves the configured CSP without blocking runtime styles", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/content security policy|refused to apply inline style/i.test(message.text())) violations.push(message.text());
  });
  const response = await page.goto(proUrl);
  expect(response?.headers()["content-security-policy"]).toContain("style-src-attr 'unsafe-inline'");
  await page.getByRole("button", { name: "Load demo rehearsal" }).click();
  await page.getByRole("link", { name: "Standings", exact: true }).click();
  await expect(page.locator(".insight-graphic span").first()).toHaveAttribute("style", /inline-size/);
  expect(violations).toEqual([]);
});

test("announces a real waiting service-worker update, blocks unsafe reloads, and applies when safe", async ({ page }) => {
  await page.goto(proUrl);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/__rr3-e2e-update-sw.js", { scope: "/" });
  });
  await expect(page.getByRole("status", { name: "Application updates" })).toContainText("Update ready");
  const apply = page.getByRole("button", { name: "Apply update" });
  await expect(apply).toBeEnabled();

  await page.getByRole("button", { name: "Load demo rehearsal" }).click();
  await expect(apply).toBeDisabled();
  await expect(page.getByRole("status", { name: "Application updates" })).toContainText("Update held");
  await page.getByRole("button", { name: "Return to empty official workspace" }).click();
  await expect(apply).toBeEnabled();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("rr3:result-dirty", { detail: true })));
  await expect(apply).toBeDisabled();
  await expect(page.getByRole("status", { name: "Application updates" })).toContainText("Update held");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("rr3:result-dirty", { detail: false })));
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(page.getByRole("status", { name: "Application updates" })).toContainText("Update requested");
});
