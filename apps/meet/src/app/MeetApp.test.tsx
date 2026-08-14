import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MeetApp } from "./MeetApp";
import type { MeetRepository } from "../data/meetRepository";

describe("Meet application shell", () => {
  it("enters read-only demo without any production auth, query, rpc or realtime call", async () => {
    const production = new Proxy({}, { get: () => vi.fn(() => { throw new Error("production call attempted"); }) }) as MeetRepository;
    render(<MeetApp productionRepository={production} auth={null} initialMode="welcome" />);
    await userEvent.click(screen.getByRole("button", { name: /explore read-only demo/i }));
    expect(screen.getByRole("heading", { name: /demo championship meet/i })).not.toBeNull();
    expect(screen.getAllByText(/read-only/i).length).toBeGreaterThan(0);
  });

  it("requires a signed-in session and active membership for official work", () => {
    render(<MeetApp productionRepository={null} auth={null} initialMode="welcome" />);
    expect(screen.getByRole("heading", { name: /sign in to meet edition/i })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: /official workspace/i })).toBeNull();
  });
});
