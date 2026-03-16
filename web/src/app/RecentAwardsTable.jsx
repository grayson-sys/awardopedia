"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import DataTable from "@/components/DataTable";
import { formatCurrency, formatDateShort } from "@/lib/format";

const columns = [
  {
    key: "description",
    label: "Description",
    render: (row) => (
      <Link href={`/awards/${row.award_id}`} style={{ color: "var(--color-navy)" }}>
        {(row.description || row.award_id_piid || "\u2014").slice(0, 80)}
      </Link>
    ),
  },
  { key: "agency_name", label: "Agency" },
  {
    key: "federal_action_obligation",
    label: "Value",
    align: "right",
    mono: true,
    render: (row) => formatCurrency(row.federal_action_obligation),
  },
  {
    key: "action_date",
    label: "Date",
    render: (row) => formatDateShort(row.action_date),
  },
];

export default function RecentAwardsTable({ data: initialData = [], clientLoad = false }) {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(clientLoad);

  useEffect(() => {
    if (!clientLoad) return;
    fetch("/api/awards?sort=federal_action_obligation&dir=desc&limit=10")
      .then((r) => r.json())
      .then((d) => { setData(d.data || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [clientLoad]);

  return <DataTable columns={columns} data={data} loading={loading} />;
}
