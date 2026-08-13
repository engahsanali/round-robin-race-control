import { useEffect, useRef, useState, type RefObject } from "react";
import { MotionConfig } from "motion/react";
import { NavLink } from "react-router-dom";
import { useRegisterSW } from "virtual:pwa-register/react";
import { AppRoutes, operatorDestinations } from "./routes";

const THEME_STORAGE_KEY = "rr3.pro.theme";
const CREATOR_CREDIT = "Made by Cesar Lacsamana and Ahsan Ali";

type ThemePreference = "system" | "light" | "dark";

export type UpdateSafety = {
  isRaceRunning: boolean;
  isOfficialResultDirty: boolean;
};

type AppProps = {
  updateSafety?: UpdateSafety;
};

const idleUpdateSafety: UpdateSafety = {
  isRaceRunning: false,
  isOfficialResultDirty: false,
};

function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  } catch {
    return "system";
  }
}

function useReducedMotionPreference(): boolean {
  const [isReduced, setIsReduced] = useState(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return undefined;

    const update = (event: MediaQueryListEvent) => setIsReduced(event.matches);
    setIsReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = isReduced ? "reduce" : "full";
  }, [isReduced]);

  return isReduced;
}

function safelyOpenDialog(dialog: HTMLDialogElement | null): void {
  if (!dialog) return;
  try {
    dialog.showModal();
  } catch {
    dialog.setAttribute("open", "");
  }
}

function safelyCloseDialog(dialog: HTMLDialogElement | null): void {
  if (!dialog) return;
  try {
    dialog.close();
  } catch {
    dialog.removeAttribute("open");
  }
}

type DialogTrigger = HTMLButtonElement | null;

function closeAndRestoreFocus(
  dialog: RefObject<HTMLDialogElement | null>,
  trigger: RefObject<DialogTrigger>,
): void {
  safelyCloseDialog(dialog.current);
  trigger.current?.focus();
}

function UpdatePrompt({ updateSafety }: { updateSafety: UpdateSafety }) {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW();
  const [requestMessage, setRequestMessage] = useState("");
  const isBlocked = updateSafety.isRaceRunning || updateSafety.isOfficialResultDirty;

  const applyUpdate = () => {
    if (isBlocked) return;
    setRequestMessage("Update requested. Reloading when the new shell is ready.");
    void updateServiceWorker(true);
  };

  const dismissNotice = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
    setRequestMessage("");
  };

  let updateMessage = "The offline shell is checking for updates.";
  if (offlineReady) updateMessage = "Offline shell ready on this device.";
  if (needRefresh) updateMessage = "Update ready.";
  if (needRefresh && isBlocked) {
    updateMessage = "Update held until the live race and result form are safe.";
  }
  if (requestMessage) updateMessage = requestMessage;

  return (
    <section className="update-prompt" aria-label="Software update">
      <p role="status" aria-label="Application updates" aria-atomic="true">
        {updateMessage}
      </p>
      {needRefresh ? (
        <div className="update-actions">
          <button type="button" onClick={applyUpdate} disabled={isBlocked}>
            Apply update
          </button>
          <button type="button" className="quiet-action" onClick={dismissNotice}>
            Later
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function App({ updateSafety = idleUpdateSafety }: AppProps) {
  const [theme, setTheme] = useState<ThemePreference>(readThemePreference);
  const [aboutOpen, setAboutOpen] = useState(false);
  const isReducedMotion = useReducedMotionPreference();
  const commandDialog = useRef<HTMLDialogElement>(null);
  const aboutDialog = useRef<HTMLDialogElement>(null);
  const commandTrigger = useRef<HTMLButtonElement>(null);
  const aboutTrigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Appearance still applies for this session when browser storage is unavailable.
    }
  }, [theme]);

  const openAbout = () => {
    setAboutOpen(true);
    safelyOpenDialog(aboutDialog.current);
  };

  const closeAbout = () => {
    closeAndRestoreFocus(aboutDialog, aboutTrigger);
    setAboutOpen(false);
  };

  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.2 }}>
      <a className="skip-link" href="#main-content">Skip to race control</a>
      <div className="app-shell">
        <header className="command-header">
          <div className="brand-lockup">
            <span className="product-mark" aria-hidden="true">RR · 3</span>
            <div>
              <p className="edition-label">Pro edition · local-first</p>
              <h1>Round Robin Race Control Pro</h1>
            </div>
          </div>
          <div className="header-actions">
            <label className="theme-control">
              <span>Color theme</span>
              <select value={theme} onChange={(event) => setTheme(event.target.value as ThemePreference)}>
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <button
              ref={commandTrigger}
              type="button"
              className="command-trigger"
              onClick={() => safelyOpenDialog(commandDialog.current)}
            >
              <span aria-hidden="true">⌘</span>
              Open command palette
            </button>
          </div>
        </header>

        <section className="status-rail" aria-label="Event status">
          <dl>
            <div>
              <dt>Event</dt>
              <dd><span className="status-dot status-empty" aria-hidden="true" /> Empty real event</dd>
            </div>
            <div>
              <dt>Race</dt>
              <dd><span className="status-dot status-safe" aria-hidden="true" /> Not running</dd>
            </div>
            <div className="recovery-indicator">
              <dt>Recovery</dt>
              <dd><span className="status-dot status-warn" aria-hidden="true" /> No local save yet</dd>
            </div>
            <div>
              <dt>Motion</dt>
              <dd>{isReducedMotion ? "Motion reduced" : "Full motion"}</dd>
            </div>
          </dl>
          <NavLink className="presentation-link" to="/present">Open presentation board</NavLink>
        </section>

        <nav className="operator-nav" aria-label="Race control">
          <ul>
            {operatorDestinations.map((destination) => (
              <li key={destination.path}>
                <NavLink
                  to={destination.path}
                  end={destination.path === "/"}
                  className={({ isActive }) => (isActive ? "active" : undefined)}
                >
                  {destination.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main id="main-content" tabIndex={-1}>
          <AppRoutes />
        </main>

        <UpdatePrompt updateSafety={updateSafety} />
        <p className="error-region" role="alert" aria-label="Application errors" aria-atomic="true" />

        <footer>
          <p>{CREATOR_CREDIT}</p>
          <p>Private by default · event data stays on this device.</p>
          <button
            ref={aboutTrigger}
            type="button"
            className="quiet-action"
            onClick={openAbout}
          >
            About Round Robin Race Control Pro
          </button>
        </footer>
      </div>

      <dialog
        ref={commandDialog}
        aria-labelledby="command-dialog-title"
        onCancel={() => commandTrigger.current?.focus()}
      >
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">Keyboard-first control</p>
            <h2 id="command-dialog-title">Command palette</h2>
          </div>
          <button
            type="button"
            className="quiet-action"
            onClick={() => closeAndRestoreFocus(commandDialog, commandTrigger)}
          >
            Close command palette
          </button>
        </div>
        <p>Commands will become available as an event moves from setup to live racing.</p>
        <ul className="command-list">
          <li><NavLink to="/registration">Open registration</NavLink></li>
          <li><NavLink to="/schedule">Open Schedule Lab</NavLink></li>
          <li><NavLink to="/race">Open Race Command Center</NavLink></li>
        </ul>
      </dialog>

      <dialog
        ref={aboutDialog}
        aria-labelledby="about-dialog-title"
        onCancel={() => aboutTrigger.current?.focus()}
      >
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">Product identity</p>
            <h2 id="about-dialog-title">About Round Robin Race Control Pro</h2>
          </div>
          <button type="button" className="quiet-action" onClick={closeAbout}>Close about</button>
        </div>
        {aboutOpen ? (
          <>
            <p className="about-credit">{CREATOR_CREDIT}</p>
            <p>Installable, local-first race operations with no account, tracking, or backend.</p>
          </>
        ) : null}
      </dialog>
    </MotionConfig>
  );
}
