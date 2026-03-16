import Link from "next/link";
import { DollarSign, FileText, TrendingUp } from "lucide-react";
import StatCard from "@/components/StatCard";
import TrustBox from "@/components/TrustBox";
import { getAgency } from "@/lib/api";
import { formatCurrency, formatDateShort } from "@/lib/format";
import AgencyChartAndTables from "./AgencyChartAndTables";

export const revalidate = 86400;

export async function generateMetadata({ params }) {
  const { code } = await params;
  try {
    const agency = await getAgency(code);
    return {
      title: `${agency.agency_name} \u2014 Federal Contract Awards`,
      description: `View federal contract awards from ${agency.agency_name}. ${formatCurrency(agency.total_awarded)} total awarded across ${(agency.award_count || 0).toLocaleString()} contracts.`,
    };
  } catch {
    return { title: "Agency Profile" };
  }
}

export default async function AgencyProfilePage({ params }) {
  const { code } = await params;
  let agency = null;
  try {
    agency = await getAgency(code);
  } catch {
    return (
      <div className="container" style={{ padding: "var(--space-12) 0", textAlign: "center" }}>
        <h1 style={{ fontSize: "var(--font-size-2xl)" }}>Agency not found</h1>
      </div>
    );
  }

  return (
    <div className="container" style={{ padding: "var(--space-8) 0" }}>
      <div style={{ marginBottom: "var(--space-2)", fontSize: "var(--font-size-sm)" }}>
        <Link href="/agencies" style={{ color: "var(--color-muted)" }}>Agencies</Link>
        <span style={{ color: "var(--color-muted)" }}> / </span>
      </div>
      <h1 style={{ fontSize: "var(--font-size-2xl)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-6)" }}>
        {agency.agency_name}
      </h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "var(--space-4)", marginBottom: "var(--space-8)" }}>
        <StatCard label="Total Awards" value={(agency.award_count || 0).toLocaleString()} icon={FileText} />
        <StatCard label="Total Awarded" value={formatCurrency(agency.total_awarded)} icon={DollarSign} />
        <StatCard label="Avg Award" value={formatCurrency(agency.avg_award_value)} icon={TrendingUp} />
      </div>

      <AgencyChartAndTables agency={agency} />
      <TrustBox />
    </div>
  );
}
