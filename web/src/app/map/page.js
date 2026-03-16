"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/format";

// State name → 2-letter postal code (GeoJSON only has names)
const NAME_TO_ABBR = {
  "Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA",
  "Colorado":"CO","Connecticut":"CT","Delaware":"DE","Florida":"FL","Georgia":"GA",
  "Hawaii":"HI","Idaho":"ID","Illinois":"IL","Indiana":"IN","Iowa":"IA",
  "Kansas":"KS","Kentucky":"KY","Louisiana":"LA","Maine":"ME","Maryland":"MD",
  "Massachusetts":"MA","Michigan":"MI","Minnesota":"MN","Mississippi":"MS",
  "Missouri":"MO","Montana":"MT","Nebraska":"NE","Nevada":"NV","New Hampshire":"NH",
  "New Jersey":"NJ","New Mexico":"NM","New York":"NY","North Carolina":"NC",
  "North Dakota":"ND","Ohio":"OH","Oklahoma":"OK","Oregon":"OR","Pennsylvania":"PA",
  "Rhode Island":"RI","South Carolina":"SC","South Dakota":"SD","Tennessee":"TN",
  "Texas":"TX","Utah":"UT","Vermont":"VT","Virginia":"VA","Washington":"WA",
  "West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY","District of Columbia":"DC",
  "Puerto Rico":"PR",
};

const SECTORS = [
  { value: "", label: "All Sectors" },
  { value: "defense", label: "Defense" },
  { value: "technology", label: "Technology" },
  { value: "healthcare", label: "Healthcare" },
  { value: "construction", label: "Construction" },
  { value: "professional-services", label: "Professional Services" },
  { value: "energy", label: "Energy" },
  { value: "logistics", label: "Logistics" },
  { value: "research", label: "Research" },
];

function getColor(v) {
  if (!v || v <= 0) return "#f0f0f0";
  if (v > 200e9) return "#1B3A6B";
  if (v > 50e9)  return "#2D5BA0";
  if (v > 10e9)  return "#D4940A";
  if (v > 1e9)   return "#E8B84B";
  return "#FDF3D8";
}

const LEGEND = [
  ["#1B3A6B", ">$200B"], ["#2D5BA0", "$50–200B"], ["#D4940A", "$10–50B"],
  ["#E8B84B", "$1–10B"], ["#FDF3D8", "<$1B"], ["#f0f0f0", "No data"],
];

export default function MapPage() {
  const mapRef      = useRef(null);
  const leafletMap  = useRef(null);
  const geoLayer    = useRef(null);
  const spendingRef = useRef({});

  const [spending,     setSpending]     = useState({});   // { CA: { award_count, total_awarded } }
  const [selected,     setSelected]     = useState(null); // { abbr, name, ...spending }
  const [stateAwards,  setStateAwards]  = useState([]);
  const [loadingAwards,setLoadingAwards]= useState(false);
  const [sector,       setSector]       = useState("");

  // Keep ref in sync so Leaflet event handlers always see latest state
  useEffect(() => { spendingRef.current = spending; }, [spending]);

  // Fetch state aggregates when sector changes
  useEffect(() => {
    const url = `/api/geo/spend${sector ? `?sector=${sector}` : ""}`;
    fetch(url).then(r => r.json()).then(d => {
      const map = {};
      (d.states || []).forEach(s => { map[s.state_code] = s; });
      setSpending(map);
    }).catch(() => {});
  }, [sector]);

  // Init map once
  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;
    // Load leaflet CSS dynamically
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
    import("leaflet").then(({ default: L }) => {
      // Fix Leaflet default icon issue with webpack
      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({ iconRetinaUrl: "", iconUrl: "", shadowUrl: "" });

      const map = L.map(mapRef.current, { zoomControl: true, scrollWheelZoom: true });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        opacity: 0.25,
      }).addTo(map);
      map.setView([39, -96], 4);
      leafletMap.current = map;
    });
    return () => {
      if (leafletMap.current) { leafletMap.current.remove(); leafletMap.current = null; }
    };
  }, []);

  // Rebuild choropleth when spending data or map changes
  useEffect(() => {
    if (!leafletMap.current || Object.keys(spending).length === 0) return;
    import("leaflet").then(({ default: L }) => {
      if (geoLayer.current) geoLayer.current.remove();
      fetch("/geo/us-states.json").then(r => r.json()).then(geojson => {
        const layer = L.geoJSON(geojson, {
          style: feature => {
            const abbr = NAME_TO_ABBR[feature.properties.name];
            const s = spendingRef.current[abbr];
            return {
              fillColor: getColor(s?.total_awarded),
              fillOpacity: 0.78,
              color: "#fff",
              weight: 1.2,
            };
          },
          onEachFeature: (feature, lyr) => {
            const name = feature.properties.name;
            const abbr = NAME_TO_ABBR[name];
            const s = spendingRef.current[abbr];
            lyr.bindTooltip(
              `<strong>${name}</strong><br/>${s
                ? formatCurrency(s.total_awarded) + " — " + s.award_count?.toLocaleString() + " awards"
                : "No data"}`,
              { sticky: true, className: "map-tooltip" }
            );
            lyr.on("click", () => {
              if (!abbr) return;
              setSelected({ abbr, name, ...(spendingRef.current[abbr] || {}) });
              setLoadingAwards(true);
              const url = `/api/geo/spend?state=${abbr}${sector ? "&sector=" + sector : ""}`;
              fetch(url).then(r => r.json())
                .then(d => { setStateAwards(d.awards || []); setLoadingAwards(false); })
                .catch(() => setLoadingAwards(false));
            });
          },
        }).addTo(leafletMap.current);
        geoLayer.current = layer;
      });
    });
  }, [spending]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display: "flex", height: "calc(100vh - 62px)", overflow: "hidden" }}>
      {/* ── Map ─────────────────────────────────────────── */}
      <div ref={mapRef} style={{ flex: 1, position: "relative" }}>
        {/* Sector filter */}
        <div style={{
          position: "absolute", top: 12, left: 12, zIndex: 1000,
          background: "#fff", borderRadius: 8, padding: "8px 12px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        }}>
          <select
            value={sector}
            onChange={e => setSector(e.target.value)}
            style={{ border: "none", outline: "none", fontSize: "var(--font-size-sm)", color: "var(--color-navy)", background: "transparent", cursor: "pointer", minWidth: 160 }}
          >
            {SECTORS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        {/* Legend */}
        <div style={{
          position: "absolute", bottom: 28, left: 12, zIndex: 1000,
          background: "#fff", borderRadius: 8, padding: "10px 14px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.12)", fontSize: "0.75rem",
        }}>
          <div style={{ fontWeight: 600, color: "var(--color-navy)", marginBottom: 6 }}>Contract Value</div>
          {LEGEND.map(([color, label]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              <div style={{ width: 14, height: 14, borderRadius: 3, background: color, border: "1px solid #ddd", flexShrink: 0 }} />
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Sidebar ──────────────────────────────────────── */}
      <div style={{
        width: 340, background: "#fff",
        borderLeft: "1px solid var(--color-border)",
        display: "flex", flexDirection: "column", overflow: "hidden",
        flexShrink: 0,
      }}>
        {selected ? (
          <>
            {/* Header */}
            <div style={{ background: "var(--color-navy)", color: "#fff", padding: "16px 20px", flexShrink: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: "1.0625rem", fontWeight: 600, marginBottom: 4 }}>{selected.name}</div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 700, lineHeight: 1.1 }}>
                    {selected.total_awarded ? formatCurrency(selected.total_awarded) : "—"}
                  </div>
                  <div style={{ fontSize: "0.8rem", opacity: 0.75, marginTop: 4 }}>
                    {selected.award_count ? selected.award_count.toLocaleString() + " awards" : ""}
                  </div>
                </div>
                <button
                  onClick={() => { setSelected(null); setStateAwards([]); }}
                  style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: "1.25rem", opacity: 0.7, padding: 0, lineHeight: 1 }}
                >✕</button>
              </div>
              <Link
                href={`/awards?state=${selected.abbr}`}
                style={{ display: "inline-block", marginTop: 10, fontSize: "0.8125rem", color: "var(--color-amber)", textDecoration: "underline" }}
              >
                View all {selected.name} awards →
              </Link>
            </div>

            {/* Awards list */}
            <div style={{ flex: 1, overflow: "auto" }}>
              <div style={{ padding: "10px 16px 4px", fontSize: "0.75rem", fontWeight: 600, color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Top Contracts
              </div>
              {loadingAwards ? (
                <div style={{ padding: "20px 16px", color: "var(--color-muted)", fontSize: "var(--font-size-sm)" }}>Loading…</div>
              ) : stateAwards.length === 0 ? (
                <div style={{ padding: "20px 16px", color: "var(--color-muted)", fontSize: "var(--font-size-sm)" }}>No contracts found</div>
              ) : stateAwards.map((a, i) => (
                <div key={i} style={{ padding: "10px 16px", borderBottom: "1px solid var(--color-border)" }}>
                  <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--color-navy)", marginBottom: 2, lineHeight: 1.3 }}>
                    {(a.recipient_name || "—").slice(0, 42)}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--color-muted)", marginBottom: 4 }}>
                    {(a.agency_name || "").slice(0, 42)}
                  </div>
                  <div style={{ fontSize: "0.8125rem", fontFamily: "var(--font-mono, monospace)", color: "var(--color-amber)", fontWeight: 700 }}>
                    {formatCurrency(a.federal_action_obligation)}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 28, textAlign: "center" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: 14 }}>🗺️</div>
            <div style={{ fontSize: "1rem", fontWeight: 600, color: "var(--color-navy)", marginBottom: 8 }}>
              Click any state
            </div>
            <div style={{ fontSize: "var(--font-size-sm)", color: "var(--color-muted)", lineHeight: 1.6 }}>
              See total contract spending and top contracts for each state
            </div>
            <div style={{ marginTop: 20, fontSize: "0.75rem", color: "var(--color-muted)" }}>
              Use the sector filter to narrow by industry
            </div>
          </div>
        )}
      </div>

      <style>{`
        .map-tooltip {
          background: var(--color-navy) !important;
          color: #fff !important;
          border: none !important;
          border-radius: 6px !important;
          font-size: 0.8125rem !important;
          padding: 6px 10px !important;
          box-shadow: 0 2px 8px rgba(0,0,0,0.25) !important;
        }
        .map-tooltip::before { display: none !important; }
      `}</style>
    </div>
  );
}
