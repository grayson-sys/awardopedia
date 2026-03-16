import Link from "next/link";
import { DollarSign, FileText } from "lucide-react";
import StatCard from "@/components/StatCard";
import TrustBox from "@/components/TrustBox";
import { getStateSector } from "@/lib/api";
import { formatCurrency, formatDateShort, truncate, stateNames, sectorLabels } from "@/lib/format";

export const revalidate = 3600;

const STATES = Object.keys(stateNames());
const SECTORS = Object.keys(sectorLabels());

export async function generateStaticParams() {
  const combos = [];
  for (const code of STATES) {
    for (const sector of SECTORS) {
      combos.push({ code, sector });
    }
  }
  return combos;
}

export async function generateMetadata({ params }) {
  const { code, sector } = await params;
  const names = stateNames();
  const labels = sectorLabels();
  const stateName = names[code] || code;
  const sectorLabel = labels[sector] || sector;
  return {
    title: `${sectorLabel} Contracts in ${stateName} | Awardopedia`,
    description: `Browse ${sectorLabel} federal contracts awarded in ${stateName}.`,
  };
}

export default async function StateSectorPage({ params }) {
  const { code, sector } = await params;
  const names = stateNames();
  const labels = sectorLabels();
  const stateName = names[code] || code;
  const sectorLabel = labels[sector] || sector;

  let data = null;
  try {
    data = await getStateSector(code, sector);
  } catch {
    return (
      <div className="container" style={{ padding: "var(--space-12) 0", textAlign: "center" }}>
        <h1 style={{ fontSize: "var(--font-size-2xl)", marginBottom: "var(--space-4)" }}>
          {sectorLabel} Contracts in {stateName}
        </h1>
        <p style={{ color: "var(--color-muted)", fontSize: "var(--font-size-lg)" }}>
          Data loading soon. This page is being built out.
        </p>
        <div style={{ marginTop: "var(--space-6)", display: "flex", gap: "var(--space-4)", justifyContent: "center" }}>
          <Link href={`/states/${code}`} className="btn-secondary">Back to {stateName}</Link>
          <Link href={`/sectors/${sector}`} className="btn-secondary">Back to {sectorLabel}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ padding: "var(--space-8) 0" }}>
      <div style={{ marginBottom: "var(--space-2)", fontSize: "var(--font-size-sm)", color: "var(--color-muted)" }}>
        <Link href="/states" style={{ color: "var(--color-muted)" }}>States</Link>
        <span> / </span>
        <Link href={`/states/${code}`} style={{ color: "var(--color-muted)" }}>{stateName}</Link>
        <span> / </span>
        <span>{sectorLabel}</span>
      </div>

      <h1 style={{ fontSize: "var(--font-size-2xl)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-6)" }}>
        {sectorLabel} Contracts in {stateName}
      </h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "var(--space-4)", marginBottom: "var(--space-8)" }}>
        <StatCard label="Total Spend" value={formatCurrency(data.total_value)} icon={DollarSign} />
        <StatCard label="Awards" value={(data.award_count || 0).toLocaleString()} icon={FileText} />
      </div>

      {data.awards?.length > 0 && (
        <section style={{ marginBottom: "var(--space-8)" }}>
          <h2 style={{ fontSize: "var(--font-size-lg)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-4)" }}>
            Awards
          </h2>
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Agency</th>
                  <th>Contractor</th>
                  <th className="text-right">Value</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {data.awards.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/awards/${a.id}`} style={{ color: "var(--color-navy)" }}>
                        {truncate(a.description, 50)}
                      </Link>
                    </td>
                    <td>{a.agency}</td>
                    <td>{a.contractor}</td>
                    <td className="text-right mono">{formatCurrency(a.value)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{formatDateShort(a.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div style={{ display: "flex", gap: "var(--space-4)", marginBottom: "var(--space-8)" }}>
        <Link href={`/states/${code}`} className="btn-secondary">
          &larr; All contracts in {stateName}
        </Link>
        <Link href={`/sectors/${sector}`} className="btn-secondary">
          All {sectorLabel} contracts &rarr;
        </Link>
      </div>

      <TrustBox />
    </div>
  );
}
