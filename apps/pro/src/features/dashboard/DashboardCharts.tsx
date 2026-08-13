import type { ReactNode } from "react";
import { Bar, BarChart, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";

type Datum = { name: string; value: number };
type WinDatum = { name: string; wins: number };

type DashboardChartsProps = {
  completionData: Datum[];
  paymentData: Datum[];
  categoryData: Datum[];
  winGapData: WinDatum[];
  completionTakeaway: string;
  paymentTakeaway: string;
  categoryTakeaway: string;
  winGapTakeaway: string;
};

export default function DashboardCharts({
  completionData,
  paymentData,
  categoryData,
  winGapData,
  completionTakeaway,
  paymentTakeaway,
  categoryTakeaway,
  winGapTakeaway,
}: DashboardChartsProps) {
  return (
    <div className="chart-grid">
      <ChartFrame label="Completion chart" takeaway={completionTakeaway}>
        <PieChart width={220} height={150}><Pie data={completionData} dataKey="value" cx="50%" cy="50%" innerRadius={35} outerRadius={60}>{completionData.map((item, index) => <Cell key={item.name} fill={index === 0 ? "var(--lime)" : "var(--border)"} />)}</Pie></PieChart>
      </ChartFrame>
      <ChartFrame label="Payment chart" takeaway={paymentTakeaway}>
        <BarChart width={240} height={150} data={paymentData}><XAxis dataKey="name" /><YAxis hide /><Bar dataKey="value" fill="var(--cyan)" /></BarChart>
      </ChartFrame>
      <ChartFrame label="Category chart" takeaway={categoryTakeaway}>
        <PieChart width={220} height={150}><Pie data={categoryData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} fill="var(--podium-gold)" /></PieChart>
      </ChartFrame>
      <ChartFrame label="Win gap chart" takeaway={winGapTakeaway}>
        <BarChart width={280} height={150} data={winGapData}><XAxis dataKey="name" /><YAxis hide /><Bar dataKey="wins" fill="var(--lime)" /></BarChart>
      </ChartFrame>
    </div>
  );
}

function ChartFrame({ label, takeaway, children }: { label: string; takeaway: string; children: ReactNode }) {
  return <figure className="chart-card"><div className="chart-graphic" role="img" aria-label={label}>{children}</div><figcaption>{takeaway}</figcaption></figure>;
}
