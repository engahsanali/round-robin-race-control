import { expect, test } from "@playwright/test";

const enabled = process.env.RR3_MEET_LIVE_E2E === "1";
const liveUrl = process.env.RR3_MEET_LIVE_URL;

test.describe("Meet live Supabase account boundary", () => {
  test.skip(!enabled, "Set RR3_MEET_LIVE_E2E=1 with an authorised local Supabase test project.");

  test("loads the explicitly configured hosted account flow", async ({ page }) => {
    test.skip(!liveUrl, "RR3_MEET_LIVE_URL is required for the opt-in live suite.");
    await page.goto(liveUrl!);
    await page.getByRole("button", { name: /open official workspace/i }).click();
    await expect(page.getByRole("heading", { name: /sign in|account/i })).toBeVisible();
  });
});
