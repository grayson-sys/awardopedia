"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState, useCallback } from "react";
import { formatCurrency, stateNames } from "@/lib/format";

const API = process.env.NEXT_PUBLIC_API_URL || "";

const SECTORS = [
  { value: "", label: "All Sectors" },
  { value: "defense", label: "Defense" },
  { value: "technology", label: "Technology" },
  { value: "healthcare", label: "Healthcare" },
  { value: "construction", label: "Construction" },
  { value: "professional", label: "Professional Services" },
  { value: "energy", label: "Energy" },
  { value: "transportation", label: "Logistics" },
  { value: "education", label: "Research" },
  { value: "agriculture", label: "Environment" },
  { value: "finance", label: "Financial" },
  { value: "manufacturing", label: "Other" },
];

function getColor(v) {
  if (!v || v <= 0) return "#f0f0f0";
  if (v > 200e9) return "#1B3A6B";
  if (v > 50e9) return "#2D5BA0";
  if (v > 10e9) return "#D4940A";
  if (v > 1e9) return "#E8B84B";
  return "#FDF3D8";
}

// Reverse lookup: full state name → 2-letter code
const NAME_TO_CODE = Object.fromEntries(
  Object.entries(stateNames()).map(([code, name]) => [name, code])
);

export default function MapPage() {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const geoLayer = useRef(null);
  const [sector, setSector] = useState("");
  const [stateData, setStateData] = useState({});
  const [selected, setSelected] = useState(null); // { code, name, total, count, awards }
  const [loading, setLoading] = useState(true);

  // Fetch aggregate state data
  const fetchStates = useCallback(async (sectorVal) => {
    setLoading(true);
    try {
      const url = sectorVal
        ? `${API}/geo/spend?sector=${sectorVal}`
        : `${API}/geo/spend`;
      const res = await fetch(url);
      const json = await res.json();
      const map = {};
      (json.states || []).forEach((s) => {
        map[s.state_code] = { total: s.total_awarded, count: s.award_count };
      });
      setStateData(map);
    } catch (e) {
      console.error("Failed to fetch geo data", e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch state detail (top 25 awards)
  const fetchDetail = useCallback(async (code, name, sectorVal) => {
    try {
      const url = sectorVal
        ? `${API}/geo/spend?state=${code}&sector=${sectorVal}`
        : `${API}/geo/spend?state=${code}`;
      const res = await fetch(url);
      const json = await res.json();
      const total = (json.awards || []).reduce(
        (s, a) => s + (a.federal_action_obligation || 0),
        0
      );
      setSelected({
        code,
        name,
        total: stateData[code]?.total || total,
        count: stateData[code]?.count || json.awards?.length || 0,
        awards: json.awards || [],
      });
    } catch (e) {
      console.error("Failed to fetch state detail", e);
    }
  }, [stateData]);

  // Init map
  useEffect(() => {
    if (mapInstance.current) return;
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || mapInstance.current) return;

      const map = L.map(mapRef.current, {
        center: [39, -96],
        zoom: 4,
        zoomControl: true,
        scrollWheelZoom: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        opacity: 0.3,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);

      mapInstance.current = map;

      // Load GeoJSON
      const geoRes = await fetch("/geo/us-states.json");
      const geoJson = await geoRes.json();
      geoLayer.current = L.geoJSON(geoJson, {
        style: () => ({
          fillColor: "#f0f0f0",
          weight: 1,
          color: "#999",
          fillOpacity: 0.8,
        }),
        onEachFeature: (feature, layer) => {
          const name = feature.properties.name;
          const code = NAME_TO_CODE[name];
          layer._stateCode = code;
          layer._stateName = name;
          layer.on("click", () => {
            if (code) {
              window.__mapClickState = { code, name };
              window.dispatchEvent(new Event("map-state-click"));
            }
          });
          layer.on("mouseover", (e) => {
            e.target.setStyle({ weight: 2, color: "#333" });
          });
          layer.on("mouseout", (e) => {
            geoLayer.current.resetStyle(e.target);
          });
        },
      }).addTo(map);

      fetchStates("");
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchStates]);

  // Listen for state clicks (bridge DOM events to React state)
  useEffect(() => {
    const handler = () => {
      const { code, name } = window.__mapClickState || {};
      if (code) fetchDetail(code, name, sector);
    };
    window.addEventListener("map-state-click", handler);
    return () => window.removeEventListener("map-state-click", handler);
  }, [fetchDetail, sector]);

  // Update choropleth colors when data changes
  useEffect(() => {
    if (!geoLayer.current) return;
    geoLayer.current.eachLayer((layer) => {
      const code = layer._stateCode;
      const val = stateData[code]?.total || 0;
      layer.setStyle({
        fillColor: getColor(val),
        weight: 1,
        color: "#999",
        fillOpacity: 0.8,
      });
      const display = val
        ? `${layer._stateName}: ${formatCurrency(val)}`
        : layer._stateName;
      layer.bindTooltip(display, { sticky: true });
    });
  }, [stateData]);

  // Sector change
  const onSectorChange = (e) => {
    const val = e.target.value;
    setSector(val);
    setSelected(null);
    fetchStates(val);
  };

  return (
    <div style={{ display: "flex", height: "calc(100vh - 60px)", position: "relative" }}>
      {/* Map */}
      <div style={{ flex: 1, position: "relative" }}>
        <div ref={mapRef} style={{ width: "100%", height: "100%" }} />

        {/* Sector filter */}
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 60,
            zIndex: 1000,
            background: "#fff",
            borderRadius: 6,
            padding: "6px 10px",
            boxShadow: "0 2px 6px rgba(0,0,0,.15)",
          }}
        >
          <select
            value={sector}
            onChange={onSectorChange}
            style={{
              border: "none",
              outline: "none",
              fontSize: 14,
              cursor: "pointer",
              background: "transparent",
            }}
          >
            {SECTORS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {/* Legend */}
        <div
          style={{
            position: "absolute",
            bottom: 30,
            left: 12,
            zIndex: 1000,
            background: "#fff",
            borderRadius: 6,
            padding: "10px 14px",
            boxShadow: "0 2px 6px rgba(0,0,0,.15)",
            fontSize: 12,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Total Awarded</div>
          {[
            { color: "#1B3A6B", label: "> $200B" },
            { color: "#2D5BA0", label: "$50B – $200B" },
            { color: "#D4940A", label: "$10B – $50B" },
            { color: "#E8B84B", label: "$1B – $10B" },
            { color: "#FDF3D8", label: "< $1B" },
            { color: "#f0f0f0", label: "No data" },
          ].map((item) => (
            <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              <span
                style={{
                  display: "inline-block",
                  width: 16,
                  height: 12,
                  background: item.color,
                  border: "1px solid #ccc",
                  borderRadius: 2,
                }}
              />
              <span>{item.label}</span>
            </div>
          ))}
        </div>

        {loading && (
          <div
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              zIndex: 1000,
              background: "#fff",
              borderRadius: 6,
              padding: "6px 12px",
              boxShadow: "0 2px 6px rgba(0,0,0,.15)",
              fontSize: 13,
            }}
          >
            Loading...
          </div>
        )}
      </div>

      {/* Sidebar */}
      <div
        style={{
          width: 340,
          borderLeft: "1px solid #e0e0e0",
          overflowY: "auto",
          background: "#fafafa",
        }}
      >
        {!selected ? (
          <div
            style={{
              padding: 32,
              textAlign: "center",
              color: "#888",
              marginTop: 80,
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 12 }}>&#x1F5FA;</div>
            <p>Click any state to see spending details</p>
          </div>
        ) : (
          <>
            <div
              style={{
                background: "#1B3A6B",
                color: "#fff",
                padding: "20px 18px",
              }}
            >
              <h2 style={{ margin: 0, fontSize: 20 }}>{selected.name}</h2>
              <div style={{ marginTop: 8, fontSize: 22, fontWeight: 700 }}>
                {formatCurrency(selected.total)}
              </div>
              <div style={{ marginTop: 4, fontSize: 13, opacity: 0.85 }}>
                {selected.count.toLocaleString()} awards
              </div>
              <a
                href={`/awards?state=${selected.code}`}
                style={{
                  display: "inline-block",
                  marginTop: 10,
                  color: "#E8B84B",
                  fontSize: 13,
                  textDecoration: "underline",
                }}
              >
                View all {selected.code} awards &rarr;
              </a>
            </div>
            <div style={{ padding: "12px 14px" }}>
              <h3 style={{ fontSize: 14, margin: "0 0 10px", color: "#555" }}>
                Top Contracts
              </h3>
              {selected.awards.length === 0 && (
                <p style={{ color: "#999", fontSize: 13 }}>No contracts found.</p>
              )}
              {selected.awards.map((a, i) => (
                <a
                  key={a.award_id || i}
                  href={`/awards/${a.award_id}`}
                  style={{
                    display: "block",
                    padding: "10px 10px",
                    marginBottom: 6,
                    background: "#fff",
                    borderRadius: 6,
                    border: "1px solid #eee",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#1B3A6B",
                      marginBottom: 3,
                    }}
                  >
                    {a.recipient_name || "Unknown Recipient"}
                  </div>
                  <div style={{ fontSize: 12, color: "#666", marginBottom: 2 }}>
                    {a.agency_name}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#D4940A" }}>
                    {formatCurrency(a.federal_action_obligation)}
                  </div>
                </a>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
