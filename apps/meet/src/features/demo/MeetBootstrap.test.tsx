import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MeetBootstrap } from "./MeetBootstrap";

describe("MeetBootstrap", () => {
  it("opens query-string demo without loading official Auth, Supabase or repositories", async () => {
    const loadOfficialRuntime = vi.fn(async () => { throw new Error("official runtime must stay unloaded"); });
    render(<MeetBootstrap search="?demo=1" loadOfficialRuntime={loadOfficialRuntime} />);

    expect(await screen.findByRole("heading", { name: /demo championship meet/i })).not.toBeNull();
    expect(screen.getAllByTestId("bracket-sheet")).toHaveLength(7);
    const bracketIndex = screen.getByRole("complementary", { name: /bracket and stage index/i });
    expect(within(bracketIndex).getByRole("link", { name: /qualifier 4/i })).not.toBeNull();
    expect(within(bracketIndex).getByRole("link", { name: /semifinal 2/i })).not.toBeNull();
    expect(within(bracketIndex).getByRole("link", { name: (name) => name.includes("Finalfinal") && !name.includes("Semifinal") })).not.toBeNull();
    expect(screen.getAllByText(/12 active cars/i)).toHaveLength(4);
    expect(screen.getAllByText(/6 active cars/i)).toHaveLength(3);
    expect(screen.getByText(/tie decision/i)).not.toBeNull();
    expect(screen.getByText(/read-only viewer/i)).not.toBeNull();
    expect(screen.queryByRole("button", { name: /confirm winner|meet setup|registration|activate schedule/i })).toBeNull();
    expect(loadOfficialRuntime).not.toHaveBeenCalled();
  });

  it("starts with an explicit local-demo or official-workspace choice and loads official code only after selection", async () => {
    const loadOfficialRuntime = vi.fn(async () => ({ ok: false as const, message: "Official environment unavailable" }));
    render(<MeetBootstrap search="" loadOfficialRuntime={loadOfficialRuntime} />);
    expect(screen.getByRole("heading", { name: /choose how to open meet edition/i })).not.toBeNull();
    expect(loadOfficialRuntime).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /open official workspace/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/official environment unavailable/i);
    expect(loadOfficialRuntime).toHaveBeenCalledOnce();
  });
});
