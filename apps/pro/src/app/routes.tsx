import { Link, Route, Routes } from "react-router-dom";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { RegistrationPage } from "../features/registration/RegistrationPage";
import { ScheduleLabPage } from "../features/schedule/ScheduleLabPage";
import { RaceCommandPage } from "../features/race/RaceCommandPage";
import { PresentationPage } from "../features/presentation/PresentationPage";
import { StandingsPage } from "../features/standings/StandingsPage";
import { FinalsPage } from "../features/finals/FinalsPage";
import { ReportsPage } from "../features/reports/ReportsPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { DiagnosticsPage } from "../features/diagnostics/DiagnosticsPage";

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
      <Route path="/standings" element={<StandingsPage />} />
      <Route path="/finals" element={<FinalsPage />} />
      <Route path="/reports" element={<ReportsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/diagnostics" element={<DiagnosticsPage />} />
      <Route path="/present" element={<PresentationPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
