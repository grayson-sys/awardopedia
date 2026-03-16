"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Clock } from "lucide-react";
import FilterPanel from "@/components/FilterPanel";
import DataTable from "@/components/DataTable";
import { getExpiringClient } from "@/lib/api";
import { formatCurrency, formatDateShort, daysUntil, urgencyColor } from "@/lib/format";

const EMPTY_FILTERS = { agency: "", state: "", minValue: "", maxValue: "", naics: "", type: "", dateFrom: "", dateTo: "" };

export default function ExpiringPage() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });

  function fetchData() {
    setLoading(true);
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    getExpiringClient(params)
      .then((res) => setData(res.data || []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchData(); }, []);

  const columns = [
    {
      key: "days_remaining",
      label: "Urgency",
      render: (row) => {
        const days = row.days_remaining ?? daysUntil(row.end_date);
        return (
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-1)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--font-size-sm)",
            fontWeight: "var(--font-weight-medium)",
            color: urgencyColor(days),
          }}>
            <Clock size={14} />
            {days != null ? `${days}d` : "\u2014"}
          </span>
        );
      },
    },
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
    { key: "recipient_name", label: "Contractor" },
    {
      key: "potential_total_value",
      label: "Potential Value",
      align: "right",
      mono: true,
      render: (row) => formatCurrency(row.potential_total_value || row.federal_action_obligation),
    },
    {
      key: "end_date",
      label: "End Date",
      render: (row) => formatDateShort(row.end_date),
    },
  ];

  return (
    <div className="container" style={{ padding: "var(--space-8) 0" }}>
      <h1 style={{ fontSize: "var(--font-size-2xl)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-2)" }}>
        Expiring Contracts
      </h1>
      <p style={{ fontSize: "var(--font-size-sm)", color: "var(--color-muted)", marginBottom: "var(--space-6)" }}>
        Federal contracts with performance periods ending within 180 days. Every contract here is a recompete opportunity.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: "var(--space-6)", alignItems: "start" }}>
        <FilterPanel
          filters={filters}
          onChange={setFilters}
          onApply={fetchData}
          onReset={() => { setFilters({ ...EMPTY_FILTERS }); fetchData(); }}
        />
        <DataTable columns={columns} data={data} loading={loading} emptyMessage="No expiring contracts found" />
      </div>
    </div>
  );
}
