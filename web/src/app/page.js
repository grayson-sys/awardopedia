import Link from "next/link";
import { DollarSign, FileText, Building2, Clock } from "lucide-react";
import SearchBar from "@/components/SearchBar";
import StatCard from "@/components/StatCard";
import TrustBox from "@/components/TrustBox";
import { getStats, getAwards } from "@/lib/api";
import { formatCurrency, formatDateShort } from "@/lib/format";
import RecentAwardsTable from "./RecentAwardsTable";

export const revalidate = 3600;

export default async function Home() {
  let stats = null;
  let recent = [];
  try {
    [stats, { data: recent }] = await Promise.all([
      getStats().catch(() => null),
      getAwards({ sort: "federal_action_obligation", dir: "desc", limit: 10 }).catch(() => ({ data: [] })),
    ]);
  } catch {
    // graceful fallback
  }

  return (
    <>
      <section style={{ padding: "var(--space-16) 0 var(--space-10)", textAlign: "center" }}>
        <div className="container">
          <div style={{
            display: "inline-block",
            fontSize: "var(--font-size-sm)",
            fontWeight: "var(--font-weight-medium)",
            color: "var(--color-amber)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: "var(--space-3)",
          }}>
            Finally.
          </div>
          <h1 style={{ fontSize: "var(--font-size-4xl)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-4)", color: "var(--color-navy)", lineHeight: 1.2 }}>
            A Free Window Into<br />Government Contracts
          </h1>
          <p style={{ fontSize: "var(--font-size-lg)", color: "var(--color-muted)", maxWidth: 580, margin: "0 auto var(--space-5)" }}>
            The U.S. government spends over $700 billion a year on contracts. That data is legally
            public — but platforms like GovWin charge $200/month to search it.
          </p>
          <p style={{ fontSize: "var(--font-size-base)", color: "var(--color-text)", fontWeight: "var(--font-weight-medium)", maxWidth: 480, margin: "0 auto var(--space-8)" }}>
            Here it&rsquo;s free. Every award, every agency, every contractor.
          </p>
          <SearchBar />
          <div style={{
            display: "flex",
            justifyContent: "center",
            flexWrap: "wrap",
            gap: "var(--space-5)",
            marginTop: "var(--space-6)",
            fontSize: "var(--font-size-sm)",
            color: "var(--color-muted)",
          }}>
            {["Search all contracts", "Agency profiles", "Contractor history", "Expiring contracts", "State & sector breakdowns"].map((item) => (
              <span key={item} style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
                <span style={{ color: "var(--color-success)", fontWeight: "var(--font-weight-medium)" }}>✓</span>
                {item} — free
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="container" style={{ marginBottom: "var(--space-12)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "var(--space-4)" }}>
          <StatCard label="Total Awards" value={stats?.total_awards?.toLocaleString() || "\u2014"} subtext="In database" icon={FileText} />
          <StatCard label="Total Value" value={stats ? formatCurrency(stats.total_value) : "\u2014"} subtext="Federal obligations" icon={DollarSign} />
          <StatCard label="Agencies" value={stats?.total_agencies?.toLocaleString() || "\u2014"} subtext="Awarding agencies" icon={Building2} />
          <StatCard label="Expiring Soon" value={stats?.expiring_count?.toLocaleString() || "\u2014"} subtext="Within 180 days" icon={Clock} />
        </div>
      </section>

      <section className="container" style={{ marginBottom: "var(--space-12)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
          <h2 style={{ fontSize: "var(--font-size-xl)", fontWeight: "var(--font-weight-medium)" }}>Recent Awards</h2>
          <Link href="/awards" className="btn-secondary" style={{ fontSize: "var(--font-size-sm)" }}>View All</Link>
        </div>
        <RecentAwardsTable data={recent || []} />
        <TrustBox />
      </section>
    </>
  );
}
