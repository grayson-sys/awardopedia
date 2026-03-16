import Link from "next/link";
import { DollarSign, FileText, TrendingUp } from "lucide-react";
import StatCard from "@/components/StatCard";
import TrustBox from "@/components/TrustBox";
import { getNaics } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import NaicsChartAndTables from "./NaicsChartAndTables";

export const revalidate = 86400;

export async function generateMetadata({ params }) {
  const { code } = await params;
  try {
    const naics = await getNaics(code);
    return {
      title: `NAICS ${naics.naics_code} \u2014 ${naics.title} Government Contracts`,
      description: `Government contracts under NAICS ${naics.naics_code} (${naics.title}). ${formatCurrency(naics.total_awarded)} total awarded.`,
    };
  } catch {
    return { title: "NAICS Code" };
  }
}

export default async function NaicsProfilePage({ params }) {
  const { code } = await params;
  let naics = null;
  try {
    naics = await getNaics(code);
  } catch {
    return (
      <div className="container" style={{ padding: "var(--space-12) 0", textAlign: "center" }}>
        <h1 style={{ fontSize: "var(--font-size-2xl)" }}>NAICS code not found</h1>
      </div>
    );
  }

  return (
    <div className="container" style={{ padding: "var(--space-8) 0" }}>
      <h1 style={{ fontSize: "var(--font-size-2xl)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-2)" }}>
        NAICS {naics.naics_code}
      </h1>
      <p style={{ fontSize: "var(--font-size-lg)", color: "var(--color-muted)", marginBottom: "var(--space-6)" }}>
        {naics.title}
      </p>
      {naics.description && (
        <p style={{ fontSize: "var(--font-size-sm)", color: "var(--color-muted)", marginBottom: "var(--space-6)", maxWidth: 700 }}>
          {naics.description}
        </p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "var(--space-4)", marginBottom: "var(--space-8)" }}>
        <StatCard label="Total Awards" value={(naics.award_count || 0).toLocaleString()} icon={FileText} />
        <StatCard label="Total Awarded" value={formatCurrency(naics.total_awarded)} icon={DollarSign} />
        <StatCard label="Avg Award" value={formatCurrency(naics.avg_award_value)} icon={TrendingUp} />
      </div>

      <NaicsChartAndTables naics={naics} />
      <TrustBox />
    </div>
  );
}
