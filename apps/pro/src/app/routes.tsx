import { Link, Route, Routes } from "react-router-dom";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { RegistrationPage } from "../features/registration/RegistrationPage";
import { ScheduleLabPage } from "../features/schedule/ScheduleLabPage";
import { RaceCommandPage } from "../features/race/RaceCommandPage";
import { PresentationPage } from "../features/presentation/PresentationPage";

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
      <Route path="/schedule" element={<ScheduleLabPage />} />
      <Route path="/race" element={<RaceCommandPage />} />
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
