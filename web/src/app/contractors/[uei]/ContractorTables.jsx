"use client";

import Link from "next/link";
import DataTable from "@/components/DataTable";
import { formatCurrency, formatDateShort } from "@/lib/format";

export default function ContractorTables({ contractor }) {
  const awards = contractor.awards || [];
  const agencyBreakdown = contractor.agency_breakdown || [];

  const awardColumns = [
    {
      key: "description",
      label: "Description",
      render: (row) => (
        <Link href={`/awards/${row.award_id}`} style={{ color: "var(--color-navy)" }}>
          {(row.description || row.award_id_piid || "\u2014").slice(0, 60)}
        </Link>
      ),
    },
    { key: "agency_name", label: "Agency" },
    { key: "federal_action_obligation", label: "Value", align: "right", mono: true, render: (row) => formatCurrency(row.federal_action_obligation) },
    { key: "action_date", label: "Date", render: (row) => formatDateShort(row.action_date) },
  ];

  const agencyColumns = [
    {
      key: "agency_name",
      label: "Agency",
      render: (row) => row.agency_code
        ? <Link href={`/agencies/${row.agency_code}`} style={{ color: "var(--color-navy)" }}>{row.agency_name}</Link>
        : row.agency_name,
    },
    { key: "count", label: "Awards", align: "right", mono: true, render: (row) => (row.count || 0).toLocaleString() },
    { key: "total", label: "Total", align: "right", mono: true, render: (row) => formatCurrency(row.total) },
  ];

  return (
    <>
      {agencyBreakdown.length > 0 && (
        <section style={{ marginBottom: "var(--space-8)" }}>
          <h2 style={{ fontSize: "var(--font-size-lg)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-4)" }}>
            Agency Breakdown
          </h2>
          <DataTable columns={agencyColumns} data={agencyBreakdown} />
        </section>
      )}
      <section>
        <h2 style={{ fontSize: "var(--font-size-lg)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-4)" }}>
          Awards
        </h2>
        <DataTable columns={awardColumns} data={awards} />
      </section>
    </>
  );
}
