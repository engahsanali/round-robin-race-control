import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MeetEventPackFile } from "@rr3/meet-domain";
import { createDemoMeetBundle } from "../demo/demoMeet";
import { MeetReports } from "./MeetReports";

describe("MeetReports", () => {
  it("builds a public Event Pack that excludes backup, contact and accountability secrets", async () => {
    const bundle = createDemoMeetBundle();
    bundle.state.brackets[0]!.event.participants[0]!.email = "private@example.com";
    bundle.state.brackets[0]!.event.participants[0]!.phone = "+61 400 000 000";
    const files: MeetEventPackFile[] = [];
    render(<MeetReports open bundle={bundle} onClose={() => undefined} onDownload={(file) => files.push(file)} />);
    await userEvent.click(screen.getByRole("radio", { name: /public pack/i }));
    expect(screen.getByRole("note").textContent).toMatch(/excludes email, phone, actor, reason, before and after values/i);
    await userEvent.click(screen.getByRole("button", { name: /build public event pack/i }));
    await userEvent.click(await screen.findByRole("button", { name: /download 12 public files/i }));

    expect(files.some((file) => file.name === "backup.json")).toBe(false);
    expect(files.every((file) => ["text/csv", "text/plain", "text/html", "application/json"].includes(file.type))).toBe(true);
    expect(files.map((file) => file.text).join("\n")).not.toMatch(/private@example\.com|\+61 400 000 000|Alpha Viewer|invitation/i);
    expect(files.find((file) => file.name === "audit.csv")?.text).not.toMatch(/Actor ID|Reason|Before JSON|After JSON/i);
  });

  it("builds an operations pack with deterministic backup and prints a credited readable report", async () => {
    const files: MeetEventPackFile[] = [];
    const print = vi.fn();
    render(<MeetReports open bundle={createDemoMeetBundle()} onClose={() => undefined} onDownload={(file) => files.push(file)} onPrint={print} />);
    await userEvent.click(screen.getByRole("button", { name: /build operations event pack/i }));
    await userEvent.click(await screen.findByRole("button", { name: /download 13 operations files/i }));
    expect(files.find((file) => file.name === "backup.json")?.type).toBe("application/json");
    await userEvent.click(screen.getByRole("button", { name: /print operations report/i }));
    expect(print).toHaveBeenCalledWith(expect.stringMatching(/Demo Championship Meet[\s\S]*Report audience: operations[\s\S]*Made by Cesar Lacsamana and Ahsan Ali/i));
  });
});
