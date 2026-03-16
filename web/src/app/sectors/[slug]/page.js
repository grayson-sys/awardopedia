import Link from "next/link";
import { DollarSign, FileText, TrendingUp } from "lucide-react";
import StatCard from "@/components/StatCard";
import TrustBox from "@/components/TrustBox";
import { getSector } from "@/lib/api";
import { formatCurrency, formatDateShort, truncate, sectorLabels } from "@/lib/format";

export const revalidate = 3600;

const SECTORS = Object.keys(sectorLabels());

export async function generateStaticParams() {
  return SECTORS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const labels = sectorLabels();
  const label = labels[slug] || slug;
  return {
    title: `${label} Government Contracts | Awardopedia`,
    description: `Browse federal government contracts in the ${label} sector. Top agencies, contractors, and recent awards.`,
  };
}

export default async function SectorPage({ params }) {
  const { slug } = await params;
  const labels = sectorLabels();
  const label = labels[slug] || slug;

  let data = null;
  try {
    data = await getSector(slug);
  } catch {
    return (
      <div className="container" style={{ padding: "var(--space-12) 0", textAlign: "center" }}>
        <h1 style={{ fontSize: "var(--font-size-2xl)", marginBottom: "var(--space-4)" }}>{label}</h1>
        <p style={{ color: "var(--color-muted)", fontSize: "var(--font-size-lg)" }}>
          Data loading soon. This sector page is being built out.
        </p>
      </div>
    );
  }

  return (
    <div className="container" style={{ padding: "var(--space-8) 0" }}>
      <h1 style={{ fontSize: "var(--font-size-2xl)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-6)" }}>
        {label}
      </h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "var(--space-4)", marginBottom: "var(--space-8)" }}>
        <StatCard label="Total Value" value={formatCurrency(data.total_value)} icon={DollarSign} />
        <StatCard label="Awards" value={(data.award_count || 0).toLocaleString()} icon={FileText} />
        <StatCard label="Avg Award" value={formatCurrency(data.avg_value)} icon={TrendingUp} />
      </div>

      {data.top_agencies?.length > 0 && (
        <section style={{ marginBottom: "var(--space-8)" }}>
          <h2 style={{ fontSize: "var(--font-size-lg)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-4)" }}>
            Top Agencies
          </h2>
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Agency</th>
                  <th className="text-right">Total Value</th>
                  <th className="text-right">Awards</th>
                </tr>
              </thead>
              <tbody>
                {data.top_agencies.map((a, i) => (
                  <tr key={i}>
                    <td>{a.agency_name}</td>
                    <td className="text-right mono">{formatCurrency(a.total_value)}</td>
                    <td className="text-right">{(a.award_count || 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {data.top_contractors?.length > 0 && (
        <section style={{ marginBottom: "var(--space-8)" }}>
          <h2 style={{ fontSize: "var(--font-size-lg)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-4)" }}>
            Top Contractors
          </h2>
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Contractor</th>
                  <th className="text-right">Total Value</th>
                  <th className="text-right">Awards</th>
                </tr>
              </thead>
              <tbody>
                {data.top_contractors.map((c, i) => (
                  <tr key={i}>
                    <td>{c.recipient_name}</td>
                    <td className="text-right mono">{formatCurrency(c.total_value)}</td>
                    <td className="text-right">{(c.award_count || 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {data.recent_awards?.length > 0 && (
        <section style={{ marginBottom: "var(--space-8)" }}>
          <h2 style={{ fontSize: "var(--font-size-lg)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-4)" }}>
            Recent Awards
          </h2>
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Agency</th>
                  <th className="text-right">Value</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_awards.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/awards/${a.id}`} style={{ color: "var(--color-navy)" }}>
                        {truncate(a.description, 60)}
                      </Link>
                    </td>
                    <td>{a.agency}</td>
                    <td className="text-right mono">{formatCurrency(a.value)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{formatDateShort(a.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <TrustBox />
    </div>
  );
}
