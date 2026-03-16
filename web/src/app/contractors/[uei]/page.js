import Link from "next/link";
import { DollarSign, FileText, MapPin, Building2 } from "lucide-react";
import StatCard from "@/components/StatCard";
import TrustBox from "@/components/TrustBox";
import { getContractor } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import ContractorTables from "./ContractorTables";

export const revalidate = 86400;

export async function generateMetadata({ params }) {
  const { uei } = await params;
  try {
    const contractor = await getContractor(uei);
    return {
      title: `${contractor.name} \u2014 Federal Contract History`,
      description: `Federal contract history for ${contractor.name}. ${formatCurrency(contractor.total_awarded)} total awarded across ${(contractor.award_count || 0).toLocaleString()} contracts.`,
    };
  } catch {
    return { title: "Contractor Profile" };
  }
}

export default async function ContractorProfilePage({ params }) {
  const { uei } = await params;
  let contractor = null;
  try {
    contractor = await getContractor(uei);
  } catch {
    return (
      <div className="container" style={{ padding: "var(--space-12) 0", textAlign: "center" }}>
        <h1 style={{ fontSize: "var(--font-size-2xl)" }}>Contractor not found</h1>
      </div>
    );
  }

  return (
    <div className="container" style={{ padding: "var(--space-8) 0" }}>
      <h1 style={{ fontSize: "var(--font-size-2xl)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-2)" }}>
        {contractor.name}
      </h1>
      {contractor.doing_business_as && (
        <p style={{ fontSize: "var(--font-size-sm)", color: "var(--color-muted)", marginBottom: "var(--space-2)" }}>
          DBA: {contractor.doing_business_as}
        </p>
      )}
      {(contractor.city || contractor.state_code) && (
        <p style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", fontSize: "var(--font-size-sm)", color: "var(--color-muted)", marginBottom: "var(--space-6)" }}>
          <MapPin size={14} />
          {[contractor.city, contractor.state_code, contractor.zip].filter(Boolean).join(", ")}
        </p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "var(--space-4)", marginBottom: "var(--space-8)" }}>
        <StatCard label="Total Awards" value={(contractor.award_count || 0).toLocaleString()} icon={FileText} />
        <StatCard label="Total Awarded" value={formatCurrency(contractor.total_awarded)} icon={DollarSign} />
        <StatCard label="UEI" value={contractor.uei || "\u2014"} icon={Building2} />
      </div>

      <ContractorTables contractor={contractor} />
      <TrustBox />
    </div>
  );
}
