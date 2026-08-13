import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { App, type UpdateSafety } from "./App";

const updateServiceWorker = vi.fn(async () => undefined);

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({
    needRefresh: [true, vi.fn()],
    offlineReady: [false, vi.fn()],
    updateServiceWorker,
  }),
}));

type MediaListener = (event: MediaQueryListEvent) => void;
let reduceMotion = false;
const mediaListeners = new Set<MediaListener>();

function installMatchMedia(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" && reduceMotion,
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: MediaListener) => mediaListeners.add(listener),
      removeEventListener: (_type: string, listener: MediaListener) => mediaListeners.delete(listener),
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
    })),
  });
}

function renderApp(path = "/", updateSafety?: UpdateSafety) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App updateSafety={updateSafety} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  reduceMotion = false;
  mediaListeners.clear();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-reduced-motion");
  updateServiceWorker.mockClear();
  installMatchMedia();
});

afterEach(() => {
  cleanup();
});

describe("Pro application shell", () => {
  it("exposes the credited race-control shell through semantic landmarks", () => {
    renderApp();

    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Race control" })).toBeTruthy();
    expect(screen.getByRole("main")).toHaveProperty("id", "main-content");
    expect(screen.getByRole("contentinfo")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Skip to race control" }).getAttribute("href")).toBe(
      "#main-content",
    );
    expect(screen.getByText("RR · 3", { selector: ".product-mark" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Round Robin Race Control Pro" })).toBeTruthy();
    expect(screen.getByText("Made by Cesar Lacsamana and Ahsan Ali")).toBeTruthy();
    expect(screen.getByText("No event loaded")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Load demo rehearsal" })).toBeTruthy();
    expect(screen.getByText(/demo rehearsal is separate from your real event/i)).toBeTruthy();
    expect(screen.getByRole("status", { name: "Application updates" })).toBeTruthy();
    expect(screen.getByRole("alert", { name: "Application errors" })).toBeTruthy();
  });

  it("links every operator destination and renders every route directly", () => {
    const routes = [
      ["Dashboard", "/", "Event dashboard"],
      ["Registration", "/registration", "Registration & fees"],
      ["Schedule Lab", "/schedule", "Schedule Lab"],
      ["Race Command", "/race", "Race Command Center"],
      ["Standings", "/standings", "Standings"],
      ["Finals", "/finals", "Finals"],
      ["Reports", "/reports", "Reports"],
      ["Settings", "/settings", "Settings"],
      ["Diagnostics", "/diagnostics", "Diagnostics"],
    ] as const;

    const first = renderApp();
    const navigation = screen.getByRole("navigation", { name: "Race control" });
    for (const [label, href] of routes) {
      expect(within(navigation).getByRole("link", { name: label }).getAttribute("href")).toBe(href);
    }
    first.unmount();

    for (const [, path, heading] of routes) {
      const route = renderApp(path);
      expect(screen.getByRole("heading", { name: heading, level: 2 })).toBeTruthy();
      route.unmount();
    }

    const presentation = renderApp("/present");
    expect(screen.getByRole("heading", { name: "Presentation board", level: 2 })).toBeTruthy();
    expect(screen.getByText(/read-only presentation in this browser/i)).toBeTruthy();
    presentation.unmount();
  });

  it("persists explicit theme choices and can return to the system preference", async () => {
    localStorage.setItem("rr3.pro.theme", "dark");
    const user = userEvent.setup();
    renderApp();

    const theme = screen.getByRole("combobox", { name: "Color theme" });
    expect((theme as HTMLSelectElement).value).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    await user.selectOptions(theme, "light");
    expect(localStorage.getItem("rr3.pro.theme")).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    await user.selectOptions(theme, "system");
    expect(localStorage.getItem("rr3.pro.theme")).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("system");
  });

  it("reflects the user's reduced-motion preference for motion and CSS consumers", () => {
    reduceMotion = true;
    renderApp();

    expect(document.documentElement.dataset.reducedMotion).toBe("reduce");
    expect(screen.getByText("Motion reduced")).toBeTruthy();
  });

  it("mounts a prompt update action but defers it during live or dirty official work", async () => {
    const user = userEvent.setup();
    const safe = renderApp();

    const apply = screen.getByRole("button", { name: "Apply update" });
    expect((apply as HTMLButtonElement).disabled).toBe(false);
    await user.click(apply);
    expect(screen.getByRole("status", { name: "Application updates" }).textContent).toMatch(
      /update requested/i,
    );
    safe.unmount();

    const blockedStates: UpdateSafety[] = [
      { isRaceRunning: true, isOfficialResultDirty: false },
      { isRaceRunning: false, isOfficialResultDirty: true },
    ];

    for (const updateSafety of blockedStates) {
      const blocked = renderApp("/", updateSafety);
      expect((screen.getByRole("button", { name: "Apply update" }) as HTMLButtonElement).disabled).toBe(
        true,
      );
      expect(screen.getByText(/update held until the live race and result form are safe/i)).toBeTruthy();
      blocked.unmount();
    }
  });

  it("opens native command and about dialogs and restores trigger focus on close", async () => {
    const user = userEvent.setup();
    renderApp();

    const commandTrigger = screen.getByRole("button", { name: "Open command palette" });
    await user.click(commandTrigger);
    const commandDialog = screen.getByRole("dialog", { name: "Command palette" });
    expect(commandDialog.hasAttribute("open")).toBe(true);
    await user.click(within(commandDialog).getByRole("button", { name: "Close command palette" }));
    expect(commandDialog.hasAttribute("open")).toBe(false);
    expect(document.activeElement).toBe(commandTrigger);

    const aboutTrigger = screen.getByRole("button", { name: "About Round Robin Race Control Pro" });
    await user.click(aboutTrigger);
    const aboutDialog = screen.getByRole("dialog", { name: "About Round Robin Race Control Pro" });
    expect(within(aboutDialog).getByText("Made by Cesar Lacsamana and Ahsan Ali")).toBeTruthy();
  });
});
