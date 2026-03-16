"use client";

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

export default function RecentAwardsTable({ data }) {
  return <DataTable columns={columns} data={data} loading={false} />;
}
