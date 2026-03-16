export function formatCurrency(value) {
  if (value == null) return "\u2014";
  const num = Number(value);
  if (isNaN(num)) return "\u2014";
  if (Math.abs(num) >= 1e9) return `$${(num / 1e9).toFixed(1)}B`;
  if (Math.abs(num) >= 1e6) return `$${(num / 1e6).toFixed(1)}M`;
  if (Math.abs(num) >= 1e3) return `$${(num / 1e3).toFixed(0)}K`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(num);
}

export function formatDate(dateStr) {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export function formatDateShort(dateStr) {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  const now = new Date();
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}

export function urgencyColor(days) {
  if (days == null) return "var(--color-muted)";
  if (days <= 30) return "var(--color-error)";
  if (days <= 90) return "var(--color-warning)";
  return "var(--color-success)";
}

export function naicsLabel(code, description) {
  if (!code) return "\u2014";
  return description ? `${code} \u2014 ${description}` : code;
}

export function truncate(str, n = 80) {
  if (!str) return "";
  return str.length > n ? str.slice(0, n) + "\u2026" : str;
}

export function stateNames() {
  return {
    AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
    CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
    HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
    KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
    MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
    MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
    NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
    OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
    SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
    VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
    DC: "District of Columbia",
  };
}

export function sectorLabels() {
  return {
    technology: "Technology & IT",
    defense: "Defense & National Security",
    healthcare: "Healthcare & Life Sciences",
    construction: "Construction & Infrastructure",
    professional: "Professional Services",
    manufacturing: "Manufacturing & Industrial",
    energy: "Energy & Environment",
    transportation: "Transportation & Logistics",
    education: "Education & Training",
    finance: "Finance & Administration",
    agriculture: "Agriculture & Natural Resources",
    telecommunications: "Telecommunications",
  };
}
