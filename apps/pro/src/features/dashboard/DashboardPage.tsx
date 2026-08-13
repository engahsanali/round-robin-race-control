import { lazy, Suspense } from "react";
import { motion } from "motion/react";
import { calculateEventAccounts, calculateStandings } from "@rr3/domain";
import { useOptionalEventState } from "../../state/EventProvider";
import { formatMoney } from "../payments/AccountPanel";
import { RecoveryPanel } from "../shared/RecoveryPanel";
import { SetupWizard } from "../setup/SetupWizard";

const DashboardCharts = lazy(() => import("./DashboardCharts"));

export function DashboardPage() {
  const eventState = useOptionalEventState();
  if (!eventState) return <EmptyDashboard />;
  if (eventState.loading) return <p role="status">Loading event dashboard…</p>;
  if (!eventState.state) {
    return (
      <section className="page-frame dashboard-page" aria-labelledby="page-title">
        <p className="eyebrow">Local race control</p>
        <h2 id="page-title">Event dashboard</h2>
        <EmptyEventSummary />
        <SetupWizard />
        <RecoveryPanel persistenceStatus={eventState.persistenceStatus} snapshotCount={eventState.snapshots.length} portableBackupStatus="not-downloaded" />
      </section>
    );
  }

  const state = eventState.state;
  const scheduled = state.matches.filter(({ status }) => status === "scheduled");
  const current = scheduled[0] ?? null;
  const next = scheduled[1] ?? null;
  const completed = state.matches.filter(({ status, winnerEntryId }) => status === "completed" && winnerEntryId !== null).length;
  const total = state.matches.length;
  const activeCars = state.entries.filter(({ active }) => active);
  const accounts = calculateEventAccounts(state);
  const standings = calculateStandings(state, "preliminary");
  const maxWins = Math.max(0, ...standings.map(({ totalWins }) => totalWins));
  const leaders = maxWins === 0 ? [] : standings.filter(({ totalWins }) => totalWins === maxWins);
  const secondWins = Math.max(0, ...standings.filter(({ totalWins }) => totalWins < maxWins).map(({ totalWins }) => totalWins));
  const categoryCounts = Object.entries(activeCars.reduce<Record<string, number>>((counts, entry) => {
    counts[entry.categoryId] = (counts[entry.categoryId] ?? 0) + 1;
    return counts;
  }, {}));
  const completionData = [{ name: "Complete", value: completed }, { name: "Remaining", value: Math.max(0, total - completed) }];
  const paymentData = [{ name: "Collected", value: accounts.collectedCents }, { name: "Outstanding", value: Math.max(0, accounts.balanceCents) }];
  const categoryData = categoryCounts.map(([name, value]) => ({ name, value }));
  const winGapData = standings.map(({ carNumber, totalWins }) => ({ name: `Car ${carNumber}`, wins: totalWins }));

  return (
    <section className="page-frame dashboard-page" aria-labelledby="page-title">
      <p className="eyebrow">Local race control</p>
      <h2 id="page-title">Event dashboard</h2>
      <p className="workspace-label">{state.event.id.startsWith("demo-rehearsal-") || state.event.id.startsWith("event-demo-") ? "Demo rehearsal — isolated practice" : "Real event — official workspace"}</p>
      <div className="dashboard-facts" aria-label="Event-day facts">
        <motion.section className="fact-card" layout><h3>Race position</h3><p>Current heat: {current?.id ?? "none scheduled"}</p><p>Next heat: {next?.id ?? "none scheduled"}</p></motion.section>
        <motion.section className="fact-card" layout><h3>Progress</h3><p>{completed} of {total} heats complete</p><p>{activeCars.length} active cars</p></motion.section>
        <motion.section className="fact-card" layout><h3>Accounts</h3><p>Collected {formatMoney(accounts.collectedCents)} · Outstanding {formatMoney(Math.max(0, accounts.balanceCents))}</p><p>Current charges {formatMoney(accounts.chargeCents)}</p></motion.section>
        <motion.section className="fact-card" layout><h3>Competition</h3><p>{leaders.length ? `Leaders: ${leaders.map(({ carNumber }) => `Car ${carNumber}`).join(" and ")}` : "Leader: waiting for an official result"}</p><p>{leaders.length ? `${maxWins - secondWins} win gap to the next score` : "No competitive rank is inferred yet"}</p></motion.section>
      </div>

      {completed > 0 ? (
        <section className="dashboard-analytics" aria-labelledby="dashboard-analytics-title">
          <h3 id="dashboard-analytics-title">Event pulse</h3>
          <Suspense fallback={<ChartFallbacks takeaways={[
            `${completed === total ? "All" : completed * 2 === total ? "Half" : `${Math.round((completed / total) * 100)}%`} of scheduled heats have official winners.`,
            `${formatMoney(accounts.collectedCents)} collected against ${formatMoney(accounts.chargeCents)} in current charges.`,
            `${activeCars.length} active cars across ${categoryData.length} ${categoryData.length === 1 ? "category" : "categories"}.`,
            `${leaders.length} ${leaders.length === 1 ? "leader holds" : "leaders share"} ${maxWins} official wins.`,
          ]} />}>
            <DashboardCharts
              completionData={completionData}
              paymentData={paymentData}
              categoryData={categoryData}
              winGapData={winGapData}
              completionTakeaway={`${completed === total ? "All" : completed * 2 === total ? "Half" : `${Math.round((completed / total) * 100)}%`} of scheduled heats have official winners.`}
              paymentTakeaway={`${formatMoney(accounts.collectedCents)} collected against ${formatMoney(accounts.chargeCents)} in current charges.`}
              categoryTakeaway={`${activeCars.length} active cars across ${categoryData.length} ${categoryData.length === 1 ? "category" : "categories"}.`}
              winGapTakeaway={`${leaders.length} ${leaders.length === 1 ? "leader holds" : "leaders share"} ${maxWins} official wins.`}
            />
          </Suspense>
          <table className="chart-data-table" aria-label="Dashboard chart data">
            <caption>Accessible values for dashboard charts</caption>
            <thead><tr><th scope="col">Measure</th><th scope="col">Value</th></tr></thead>
            <tbody>
              <tr><th scope="row">Completed heats</th><td>{completed}</td></tr>
              <tr><th scope="row">Remaining heats</th><td>{total - completed}</td></tr>
              <tr><th scope="row">Collected cents</th><td>{accounts.collectedCents}</td></tr>
              <tr><th scope="row">Outstanding cents</th><td>{Math.max(0, accounts.balanceCents)}</td></tr>
              {categoryData.map((item) => <tr key={item.name}><th scope="row">Category {item.name}</th><td>{item.value}</td></tr>)}
              {winGapData.map((item) => <tr key={item.name}><th scope="row">{item.name} wins</th><td>{item.wins}</td></tr>)}
            </tbody>
          </table>
        </section>
      ) : <p className="feature-note">Charts will appear after the first official result; no leader or win gap is inferred before then.</p>}

      <RecoveryPanel persistenceStatus={eventState.persistenceStatus} snapshotCount={eventState.snapshots.length} portableBackupStatus="not-downloaded" />
    </section>
  );
}

function EmptyDashboard() {
  return <section className="page-frame dashboard-page" aria-labelledby="page-title"><p className="eyebrow">Local race control</p><h2 id="page-title">Event dashboard</h2><EmptyEventSummary /><SetupWizard /></section>;
}

function ChartFallbacks({ takeaways }: { takeaways: readonly string[] }) {
  const labels = ["Completion chart", "Payment chart", "Category chart", "Win gap chart"];
  return (
    <div className="chart-grid" aria-label="Charts loading">
      {labels.map((label, index) => (
        <figure className="chart-card" key={label}>
          <div className="chart-graphic chart-pending" role="img" aria-label={label}>Preparing local chart</div>
          <figcaption>{takeaways[index]}</figcaption>
        </figure>
      ))}
    </div>
  );
}

function EmptyEventSummary() {
  return <div className="empty-event"><div><p className="status-kicker">Empty real event</p><h3>No event loaded</h3><p>Create a real event when you are ready to register cars and arm a schedule.</p></div><div className="demo-callout"><p><strong>Practise safely first.</strong></p><p>The demo rehearsal is separate from your real event and will always be clearly labeled.</p><button type="button" className="secondary-action">Load demo rehearsal</button></div></div>;
}
