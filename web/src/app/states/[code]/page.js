import Link from "next/link";
import { DollarSign, FileText, Clock, MapPin } from "lucide-react";
import StatCard from "@/components/StatCard";
import TrustBox from "@/components/TrustBox";
import { getState } from "@/lib/api";
import { formatCurrency, formatDateShort, truncate, daysUntil, urgencyColor, stateNames, sectorLabels } from "@/lib/format";

export const revalidate = 3600;

const STATES = Object.keys(stateNames());
const SECTORS = sectorLabels();

export async function generateStaticParams() {
  return STATES.map((code) => ({ code }));
}

export async function generateMetadata({ params }) {
  const { code } = await params;
  const names = stateNames();
  const name = names[code] || code;
  return {
    title: `Federal Contracts in ${name} | Awardopedia`,
    description: `Browse federal government contracts awarded in ${name}. Top agencies, contractors, and expiring contracts.`,
  };
}

export default async function StatePage({ params }) {
  const { code } = await params;
  const names = stateNames();
  const stateName = names[code] || code;

  let data = null;
  try {
    data = await getState(code);
  } catch {
    return (
      <div className="container" style={{ padding: "var(--space-12) 0", textAlign: "center" }}>
        <h1 style={{ fontSize: "var(--font-size-2xl)", marginBottom: "var(--space-4)" }}>
          Federal Contracts in {stateName}
        </h1>
        <p style={{ color: "var(--color-muted)", fontSize: "var(--font-size-lg)" }}>
          Data loading soon. This state page is being built out.
        </p>
      </div>
    );
  }

  return (
    <div className="container" style={{ padding: "var(--space-8) 0" }}>
      <h1 style={{ fontSize: "var(--font-size-2xl)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-6)" }}>
        Federal Contracts in {stateName}
      </h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "var(--space-4)", marginBottom: "var(--space-8)" }}>
        <StatCard label="Total Spend" value={formatCurrency(data.total_value)} icon={DollarSign} />
        <StatCard label="Awards" value={(data.award_count || 0).toLocaleString()} icon={FileText} />
        <StatCard label="Active Contracts" value={(data.active_count || 0).toLocaleString()} icon={MapPin} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: "var(--space-6)", marginBottom: "var(--space-8)" }}>
        {data.top_agencies?.length > 0 && (
          <section>
            <h2 style={{ fontSize: "var(--font-size-lg)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-4)" }}>
              Top Agencies
            </h2>
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Agency</th>
                    <th className="text-right">Value</th>
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
          <section>
            <h2 style={{ fontSize: "var(--font-size-lg)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-4)" }}>
              Top Contractors
            </h2>
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Contractor</th>
                    <th className="text-right">Value</th>
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
      </div>

      {data.expiring?.length > 0 && (
        <section style={{ marginBottom: "var(--space-8)" }}>
          <h2 style={{ fontSize: "var(--font-size-lg)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-4)" }}>
            <Clock size={18} style={{ verticalAlign: "text-bottom", marginRight: 6 }} />
            Expiring Soon
          </h2>
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Agency</th>
                  <th className="text-right">Value</th>
                  <th>Expires</th>
                </tr>
              </thead>
              <tbody>
                {data.expiring.map((a) => {
                  const days = daysUntil(a.end_date);
                  return (
                    <tr key={a.id}>
                      <td>
                        <Link href={`/awards/${a.id}`} style={{ color: "var(--color-navy)" }}>
                          {truncate(a.description, 50)}
                        </Link>
                      </td>
                      <td>{a.agency}</td>
                      <td className="text-right mono">{formatCurrency(a.value)}</td>
                      <td style={{ whiteSpace: "nowrap", color: urgencyColor(days) }}>
                        {days != null ? `${days}d` : formatDateShort(a.end_date)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section style={{ marginBottom: "var(--space-8)" }}>
        <h2 style={{ fontSize: "var(--font-size-lg)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-4)" }}>
          Browse by Sector
        </h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
          {Object.entries(SECTORS).map(([key, label]) => (
            <Link
              key={key}
              href={`/states/${code}/${key}`}
              style={{
                display: "inline-block",
                padding: "var(--space-1) var(--space-3)",
                borderRadius: "999px",
                fontSize: "var(--font-size-sm)",
                background: "var(--color-navy-light)",
                color: "var(--color-navy)",
                textDecoration: "none",
              }}
            >
              {label}
            </Link>
          ))}
        </div>
      </section>

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
