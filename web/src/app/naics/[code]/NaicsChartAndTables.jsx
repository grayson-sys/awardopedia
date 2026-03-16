"use client";

import Link from "next/link";
import BarChart from "@/components/BarChart";
import DataTable from "@/components/DataTable";
import { formatCurrency } from "@/lib/format";

export default function NaicsChartAndTables({ naics }) {
  const topAgencies = naics.top_agencies || [];
  const topContractors = naics.top_contractors || [];
  const recentAwards = naics.recent_awards || [];

  const awardColumns = [
    {
      key: "description",
      label: "Description",
      render: (row) => (
        <Link href={`/awards/${row.award_id}`} style={{ color: "var(--color-navy)" }}>
          {(row.description || "\u2014").slice(0, 60)}
        </Link>
      ),
    },
    { key: "agency_name", label: "Agency" },
    { key: "recipient_name", label: "Contractor" },
    { key: "federal_action_obligation", label: "Value", align: "right", mono: true, render: (row) => formatCurrency(row.federal_action_obligation) },
  ];

  return (
    <>
      {topAgencies.length > 0 && (
        <section style={{ marginBottom: "var(--space-8)" }}>
          <h2 style={{ fontSize: "var(--font-size-lg)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-4)" }}>
            Top Agencies
          </h2>
          <div className="card">
            <BarChart
              labels={topAgencies.slice(0, 8).map((a) => a.name?.slice(0, 25) || a.code)}
              values={topAgencies.slice(0, 8).map((a) => a.total || 0)}
            />
          </div>
        </section>
      )}

      {topContractors.length > 0 && (
        <section style={{ marginBottom: "var(--space-8)" }}>
          <h2 style={{ fontSize: "var(--font-size-lg)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-4)" }}>
            Top Contractors
          </h2>
          <DataTable
            columns={[
              {
                key: "name",
                label: "Contractor",
                render: (row) => row.uei
                  ? <Link href={`/contractors/${row.uei}`} style={{ color: "var(--color-navy)" }}>{row.name}</Link>
                  : row.name,
              },
              { key: "total", label: "Total", align: "right", mono: true, render: (row) => formatCurrency(row.total) },
            ]}
            data={topContractors}
          />
        </section>
      )}

      <section>
        <h2 style={{ fontSize: "var(--font-size-lg)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-4)" }}>
          Recent Awards
        </h2>
        <DataTable columns={awardColumns} data={recentAwards} />
      </section>
    </>
  );
}
