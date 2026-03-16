"use client";

import { useState } from "react";
import { X } from "lucide-react";

const AWARD_TYPES = [
  { value: "", label: "All Types" },
  { value: "Contract", label: "Contract" },
  { value: "Grant", label: "Grant" },
  { value: "Loan", label: "Loan" },
  { value: "Direct Payment", label: "Direct Payment" },
  { value: "Other", label: "Other" },
];

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

export default function FilterPanel({ filters, onChange, onApply, onReset }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  function update(key, value) {
    onChange({ ...filters, [key]: value });
  }

  const content = (
    <div className={`filter-panel ${mobileOpen ? "filter-panel--mobile open" : ""}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="filter-panel__title">Filters</div>
        <button className="btn-secondary" style={{ display: "none" }} onClick={() => setMobileOpen(false)}>
          <X size={14} />
        </button>
      </div>

      <div className="filter-panel__group">
        <label className="filter-panel__label">Agency</label>
        <input className="filter-panel__input" type="text" placeholder="Agency name..." value={filters.agency || ""} onChange={(e) => update("agency", e.target.value)} />
      </div>

      <div className="filter-panel__group">
        <label className="filter-panel__label">State</label>
        <select className="filter-panel__select" value={filters.state || ""} onChange={(e) => update("state", e.target.value)}>
          <option value="">All States</option>
          {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="filter-panel__group">
        <label className="filter-panel__label">Date From</label>
        <input className="filter-panel__input" type="date" value={filters.dateFrom || ""} onChange={(e) => update("dateFrom", e.target.value)} />
      </div>

      <div className="filter-panel__group">
        <label className="filter-panel__label">Date To</label>
        <input className="filter-panel__input" type="date" value={filters.dateTo || ""} onChange={(e) => update("dateTo", e.target.value)} />
      </div>

      <div className="filter-panel__group">
        <label className="filter-panel__label">Min Value ($)</label>
        <input className="filter-panel__input" type="number" placeholder="0" value={filters.minValue || ""} onChange={(e) => update("minValue", e.target.value)} />
      </div>

      <div className="filter-panel__group">
        <label className="filter-panel__label">Max Value ($)</label>
        <input className="filter-panel__input" type="number" placeholder="No limit" value={filters.maxValue || ""} onChange={(e) => update("maxValue", e.target.value)} />
      </div>

      <div className="filter-panel__group">
        <label className="filter-panel__label">Award Type</label>
        <select className="filter-panel__select" value={filters.type || ""} onChange={(e) => update("type", e.target.value)}>
          {AWARD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      <div className="filter-panel__group">
        <label className="filter-panel__label">NAICS Code</label>
        <input className="filter-panel__input" type="text" placeholder="e.g. 541511" value={filters.naics || ""} onChange={(e) => update("naics", e.target.value)} />
      </div>

      <div className="filter-panel__actions">
        <button className="btn-primary" onClick={onApply} style={{ flex: 1 }}>Apply</button>
        <button className="btn-secondary" onClick={onReset}>Reset</button>
      </div>
    </div>
  );

  return (
    <>
      {mobileOpen && <div className="filter-panel__overlay" onClick={() => setMobileOpen(false)} />}
      {content}
    </>
  );
}
