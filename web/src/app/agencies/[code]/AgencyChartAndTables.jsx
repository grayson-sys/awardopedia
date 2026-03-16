"use client";

import Link from "next/link";
import BarChart from "@/components/BarChart";
import DataTable from "@/components/DataTable";
import { formatCurrency, formatDateShort } from "@/lib/format";

export default function AgencyChartAndTables({ agency }) {
  const topNaics = agency.top_naics || [];
  const topContractors = agency.top_contractors || [];
  const recentAwards = agency.recent_awards || [];

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
    { key: "recipient_name", label: "Contractor" },
    { key: "federal_action_obligation", label: "Value", align: "right", mono: true, render: (row) => formatCurrency(row.federal_action_obligation) },
    { key: "action_date", label: "Date", render: (row) => formatDateShort(row.action_date) },
  ];

  const contractorColumns = [
    {
      key: "name",
      label: "Contractor",
      render: (row) => row.uei
        ? <Link href={`/contractors/${row.uei}`} style={{ color: "var(--color-navy)" }}>{row.name}</Link>
        : row.name,
    },
    { key: "total", label: "Total Awarded", align: "right", mono: true, render: (row) => formatCurrency(row.total) },
  ];

  return (
    <>
      {topNaics.length > 0 && (
        <section style={{ marginBottom: "var(--space-8)" }}>
          <h2 style={{ fontSize: "var(--font-size-lg)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-4)" }}>
            Top NAICS Categories
          </h2>
          <div className="card" style={{ maxHeight: 400 }}>
            <BarChart
              labels={topNaics.slice(0, 8).map((n) => n.name?.slice(0, 30) || n.code)}
              values={topNaics.slice(0, 8).map((n) => n.total || 0)}
            />
          </div>
        </section>
      )}

      {topContractors.length > 0 && (
        <section style={{ marginBottom: "var(--space-8)" }}>
          <h2 style={{ fontSize: "var(--font-size-lg)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-4)" }}>
            Top Contractors
          </h2>
          <DataTable columns={contractorColumns} data={topContractors} />
        </section>
      )}

      <section style={{ marginBottom: "var(--space-8)" }}>
        <h2 style={{ fontSize: "var(--font-size-lg)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-4)" }}>
          Recent Awards
        </h2>
        <DataTable columns={awardColumns} data={recentAwards} />
      </section>
    </>
  );
}
