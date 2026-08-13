import { Link, Route, Routes } from "react-router-dom";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { RegistrationPage } from "../features/registration/RegistrationPage";

export const operatorDestinations = [
  { label: "Dashboard", path: "/" },
  { label: "Registration", path: "/registration" },
  { label: "Schedule Lab", path: "/schedule" },
  { label: "Race Command", path: "/race" },
  { label: "Standings", path: "/standings" },
  { label: "Finals", path: "/finals" },
  { label: "Reports", path: "/reports" },
  { label: "Settings", path: "/settings" },
  { label: "Diagnostics", path: "/diagnostics" },
] as const;

type PlaceholderPageProps = {
  eyebrow: string;
  heading: string;
  description: string;
};

function PlaceholderPage({ eyebrow, heading, description }: PlaceholderPageProps) {
  return (
    <section className="page-frame" aria-labelledby="page-title">
      <p className="eyebrow">{eyebrow}</p>
      <h2 id="page-title">{heading}</h2>
      <p className="page-intro">{description}</p>
      <div className="empty-panel">
        <strong>Ready for event data</strong>
        <p>This workspace is intentionally empty until you create or load an event.</p>
      </div>
    </section>
  );
}

function PresentationPage() {
  return (
    <section className="page-frame presentation-placeholder" aria-labelledby="page-title">
      <p className="eyebrow">Projector surface</p>
      <h2 id="page-title">Presentation board</h2>
      <p className="page-intro">
        This is a read-only presentation in this browser. It does not claim cloud or cross-device sync.
      </p>
      <div className="empty-panel" role="note">
        <strong>Waiting for a live event</strong>
        <p>The spectator surface will show only validated local event snapshots.</p>
      </div>
    </section>
  );
}

function NotFoundPage() {
  return (
    <section className="page-frame" aria-labelledby="page-title">
      <p className="eyebrow">Route unavailable</p>
      <h2 id="page-title">Control surface not found</h2>
      <p><Link to="/">Return to the event dashboard</Link>.</p>
    </section>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/registration" element={<RegistrationPage />} />
      <Route
        path="/schedule"
        element={
          <PlaceholderPage
            eyebrow="Fair race planning"
            heading="Schedule Lab"
            description="Compare exact presets and deterministic schedule candidates here."
          />
        }
      />
      <Route
        path="/race"
        element={
          <PlaceholderPage
            eyebrow="Live operations"
            heading="Race Command Center"
            description="Current heat, lane controls, result receipts, and recovery tools will live here."
          />
        }
      />
      <Route
        path="/standings"
        element={
          <PlaceholderPage
            eyebrow="Official projection"
            heading="Standings"
            description="Rankings remain empty until an official result exists."
          />
        }
      />
      <Route
        path="/finals"
        element={
          <PlaceholderPage
            eyebrow="Qualification and championship"
            heading="Finals"
            description="Finalists and champions will require explicit, auditable decisions."
          />
        }
      />
      <Route
        path="/reports"
        element={
          <PlaceholderPage
            eyebrow="Portable event evidence"
            heading="Reports"
            description="Printable views and local event exports will live here."
          />
        }
      />
      <Route
        path="/settings"
        element={
          <PlaceholderPage
            eyebrow="Race policy"
            heading="Settings"
            description="Competition, timing, finals, presentation, and appearance controls will live here."
          />
        }
      />
      <Route
        path="/diagnostics"
        element={
          <PlaceholderPage
            eyebrow="Local health"
            heading="Diagnostics"
            description="Storage, offline, version, and sanitized error checks will live here."
          />
        }
      />
      <Route path="/present" element={<PresentationPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
