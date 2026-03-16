"use client";
import { useState, useEffect } from "react";
import { DollarSign, FileText, Building2, Clock } from "lucide-react";
import StatCard from "@/components/StatCard";
import { formatCurrency } from "@/lib/format";

export default function HomeStats() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "var(--space-4)" }}>
      <StatCard label="Total Awards"   value={stats ? stats.total_awards?.toLocaleString() : "…"} subtext="In database"         icon={FileText}   />
      <StatCard label="Total Value"    value={stats ? formatCurrency(stats.total_value)      : "…"} subtext="Federal obligations" icon={DollarSign}  />
      <StatCard label="Agencies"       value={stats ? stats.total_agencies?.toLocaleString() : "…"} subtext="Awarding agencies"   icon={Building2}   />
      <StatCard label="Expiring Soon"  value={stats ? stats.expiring_count?.toLocaleString() : "…"} subtext="Within 180 days"    icon={Clock}       />
    </div>
  );
}
