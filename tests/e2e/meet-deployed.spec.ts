import { expect, test } from "@playwright/test";

const enabled = process.env.RR3_MEET_DEPLOYED_E2E === "1";
const deployedUrl = process.env.RR3_MEET_DEPLOYED_URL ?? "https://round-robin-race-control-meet.netlify.app/";

test.describe("Meet deployed smoke", () => {
  test.skip(!enabled, "Set RR3_MEET_DEPLOYED_E2E=1 to verify the public Netlify release.");

  test("returns the public Meet chooser and canonical metadata", async ({ page }) => {
    await page.goto(deployedUrl);
    await expect(page).toHaveTitle("Round Robin Race Control Meet Edition");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://round-robin-race-control-meet.netlify.app/");
    await expect(page.getByRole("heading", { name: /choose how to open meet edition/i })).toBeVisible();
  });
});
