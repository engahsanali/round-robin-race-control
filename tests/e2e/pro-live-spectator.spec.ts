import { expect, test } from "@playwright/test";

const proUrl = process.env.RR3_PRO_URL ?? "http://127.0.0.1:4174";

test("runs a keyboard result and mirrors only a same-browser read-only spectator snapshot", async ({ context }) => {
  const operator = await context.newPage();
  await operator.setViewportSize({ width: 320, height: 900 });
  await operator.goto(proUrl);
  await operator.getByRole("button", { name: "Load demo rehearsal" }).click();
  await operator.getByRole("link", { name: "Race Command", exact: true }).focus();
  await operator.keyboard.press("Enter");
  await expect(operator.getByRole("heading", { name: "Race Command Center" })).toBeFocused();

  const spectator = await context.newPage();
  await spectator.goto(`${proUrl}/present`);
  await expect(spectator.getByText(/same browser and device.*not cloud or cross-device/i)).toBeVisible();
  const pause = spectator.getByRole("button", { name: "Pause rotation" });
  await pause.focus();
  await expect(spectator.getByRole("table", { name: "Live standings" })).toContainText("Car 1");

  await operator.keyboard.press("2");
  await expect(operator.getByRole("status", { name: "Pending result" })).toContainText("Car 6");
  await operator.keyboard.press("Enter");
  await expect(operator.getByRole("region", { name: "Result receipt" })).toContainText("Car 6");

  await expect(spectator.getByRole("heading", { name: "Spectator Board" })).toBeVisible();
  await expect(spectator.getByText(/Latest result.*Car 6/i)).toBeVisible();
  await expect(spectator.getByText(/Provisional/i)).toBeVisible();
  await expect(spectator.getByRole("table", { name: "Live standings" })).toBeVisible();
  await expect(spectator.getByRole("button", { name: "Confirm result" })).toHaveCount(0);
  await expect(pause).toBeFocused();

  await pause.click();
  await expect(spectator.getByRole("button", { name: "Resume rotation" })).toBeFocused();
  await spectator.getByRole("button", { name: "Next presentation panel" }).click();
  await spectator.getByRole("button", { name: "Previous presentation panel" }).click();
  await spectator.getByRole("combobox", { name: "Rotation interval" }).selectOption("5");
  await expect(spectator.getByRole("status", { name: "Rotation status" })).toContainText("paused");

  expect(await operator.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(await operator.getByRole("button", { name: /Lane 1/ }).evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48);
});
