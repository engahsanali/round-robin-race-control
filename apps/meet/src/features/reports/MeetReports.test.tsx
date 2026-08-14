import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MeetEventPackFile } from "@rr3/meet-domain";
import { createDemoMeetBundle } from "../demo/demoMeet";
import { MeetReports } from "./MeetReports";

describe("MeetReports", () => {
  afterEach(() => vi.restoreAllMocks());
  it("revokes every report object URL when a browser download click throws", async () => {
    const createDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    const revokeDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
    const revokeUrl = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:report") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeUrl });
    try {
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => { throw new Error("blocked download"); });
      render(<MeetReports open bundle={createDemoMeetBundle()} onClose={() => undefined} />);
      await userEvent.click(screen.getByRole("button", { name: /build operations event pack/i }));
      await userEvent.click(await screen.findByRole("button", { name: /download 13 operations files/i })).catch(() => undefined);
      expect(revokeUrl).toHaveBeenCalledWith("blob:report");
      expect((await screen.findByRole("alert")).textContent).toMatch(/download could not start/i);
    } finally {
      createDescriptor ? Object.defineProperty(URL, "createObjectURL", createDescriptor) : delete (URL as unknown as Record<string, unknown>).createObjectURL;
      revokeDescriptor ? Object.defineProperty(URL, "revokeObjectURL", revokeDescriptor) : delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
    }
  });

  it("removes its print iframe and reports failure when browser printing throws", async () => {
    const original = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow");
    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", { configurable: true, get: () => ({ focus: () => undefined, print: () => { throw new Error("blocked print"); } }) });
    try {
      render(<MeetReports open bundle={createDemoMeetBundle()} onClose={() => undefined} />);
      await userEvent.click(screen.getByRole("button", { name: /build operations event pack/i }));
      await userEvent.click(await screen.findByRole("button", { name: /print operations report/i })).catch(() => undefined);
      expect(document.querySelector("iframe")).toBeNull();
      expect((await screen.findByRole("alert")).textContent).toMatch(/print could not start/i);
    } finally {
      if (original) Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", original);
    }
  });

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
