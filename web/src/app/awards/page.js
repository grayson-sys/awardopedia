"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import SearchBar from "@/components/SearchBar";
import FilterPanel from "@/components/FilterPanel";
import DataTable from "@/components/DataTable";
import { searchAwardsClient } from "@/lib/api";
import { formatCurrency, formatDateShort } from "@/lib/format";

const EMPTY_FILTERS = { agency: "", state: "", dateFrom: "", dateTo: "", minValue: "", maxValue: "", type: "", naics: "" };

function AwardsInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const q = searchParams.get("q") || "";
  const page = parseInt(searchParams.get("page") || "1", 10);

  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState("action_date");
  const [sortDir, setSortDir] = useState("desc");

  const fetchData = useCallback(() => {
    setLoading(true);
    const apiParams = { page, limit: 25, sort: sortKey, dir: sortDir };
    if (q) apiParams.q = q;
    Object.entries(filters).forEach(([k, v]) => { if (v) apiParams[k] = v; });

    searchAwardsClient(apiParams)
      .then((res) => { setData(res.data || []); setTotal(res.total || 0); })
      .catch(() => { setData([]); setTotal(0); })
      .finally(() => setLoading(false));
  }, [q, page, sortKey, sortDir, filters]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function handleSearch(query) {
    router.push(`/awards?q=${encodeURIComponent(query)}`);
  }

  function handleSort(key, dir) {
    setSortKey(key);
    setSortDir(dir);
  }

  function handleApplyFilters() {
    const params = new URLSearchParams(searchParams);
    params.set("page", "1");
    router.push(`/awards?${params.toString()}`);
    fetchData();
  }

  function goToPage(p) {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(p));
    if (q) params.set("q", q);
    router.push(`/awards?${params.toString()}`);
  }

  const totalPages = Math.ceil(total / 25);

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
    { key: "recipient_name", label: "Contractor" },
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

  return (
    <div className="container" style={{ padding: "var(--space-8) 0" }}>
      <div style={{ marginBottom: "var(--space-6)" }}>
        <SearchBar initialValue={q} onSearch={handleSearch} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: "var(--space-6)", alignItems: "start" }}>
        <FilterPanel
          filters={filters}
          onChange={setFilters}
          onApply={handleApplyFilters}
          onReset={() => { setFilters({ ...EMPTY_FILTERS }); fetchData(); }}
        />
        <div>
          <div style={{ fontSize: "var(--font-size-sm)", color: "var(--color-muted)", marginBottom: "var(--space-3)" }}>
            {loading ? "Searching..." : `${total.toLocaleString()} results`}
            {q && ` for "${q}"`}
          </div>

          <DataTable columns={columns} data={data} loading={loading} onSort={handleSort} sortKey={sortKey} sortDir={sortDir} />

          {totalPages > 1 && (
            <div style={{ display: "flex", justifyContent: "center", gap: "var(--space-2)", marginTop: "var(--space-6)" }}>
              <button className="btn-secondary" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
                <ChevronLeft size={16} /> Previous
              </button>
              <span style={{ display: "flex", alignItems: "center", fontSize: "var(--font-size-sm)", color: "var(--color-muted)", padding: "0 var(--space-4)" }}>
                Page {page} of {totalPages}
              </span>
              <button className="btn-secondary" disabled={page >= totalPages} onClick={() => goToPage(page + 1)}>
                Next <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AwardsPage() {
  return (
    <Suspense fallback={<div className="container" style={{ padding: "var(--space-8) 0", color: "var(--color-muted)" }}>Loading…</div>}>
      <AwardsInner />
    </Suspense>
  );
}
