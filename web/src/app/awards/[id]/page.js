import Link from "next/link";
import { Building2, MapPin, ExternalLink } from "lucide-react";
import AwardDetailClient from "./AwardDetailClient";
import TrustBox from "@/components/TrustBox";
import ContractCard from "@/components/ContractCard";
import { getAward } from "@/lib/api";
import { formatCurrency, formatDate, toTitleCase, sectorLabels } from "@/lib/format";

export const dynamic = 'force-dynamic';

// ── Helpers ────────────────────────────────────────────────────────────────
function isGarbageDescription(s) {
  if (!s) return true;
  const t = s.trim().toUpperCase();
  return t === "" || t === "IGF::OT::IGF" || t === "NONE" || t.startsWith("IGF::");
}

function contractStatus(endDate) {
  if (!endDate) return null;
  return new Date(endDate) > new Date() ? "active" : "expired";
}

function daysRemaining(endDate) {
  if (!endDate) return null;
  const diff = Math.ceil((new Date(endDate) - new Date()) / 86400000);
  return diff;
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: "var(--space-6)" }}>
      <h2 style={{
        fontSize: "var(--font-size-xs)", fontWeight: 700, letterSpacing: "0.08em",
        textTransform: "uppercase", color: "var(--color-muted)",
        borderBottom: "1px solid var(--color-border)", paddingBottom: "var(--space-2)",
        marginBottom: "var(--space-4)"
      }}>{title}</h2>
      {children}
    </div>
  );
}

function Row({ label, value, mono, children }) {
  if (!value && !children) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: "var(--space-2)", marginBottom: "var(--space-2)", fontSize: "var(--font-size-sm)" }}>
      <span style={{ color: "var(--color-muted)" }}>{label}</span>
      <span style={{ fontFamily: mono ? "var(--font-mono, monospace)" : undefined }}>
        {children || value}
      </span>
    </div>
  );
}

function StatBox({ label, value, sub, highlight }) {
  return (
    <div style={{
      padding: "var(--space-4)",
      background: highlight ? "var(--color-navy)" : "var(--color-bg-subtle, #f7f7f5)",
      borderRadius: "var(--radius-md, 8px)",
      border: highlight ? "none" : "1px solid var(--color-border)",
    }}>
      <div style={{ fontSize: "var(--font-size-xs)", color: highlight ? "rgba(255,255,255,0.7)" : "var(--color-muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "var(--font-size-xl, 1.25rem)", fontWeight: 700, color: highlight ? "#fff" : "var(--color-navy)", lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: "var(--font-size-xs)", color: highlight ? "rgba(255,255,255,0.6)" : "var(--color-muted)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ── Metadata ──────────────────────────────────────────────────────────────
export async function generateMetadata({ params }) {
  const { id } = await params;
  try {
    const { award } = await getAward(id);
    const name = toTitleCase(award.recipient_name) || "Unknown Contractor";
    const agency = toTitleCase(award.agency_name) || "Federal Agency";
    const value = formatCurrency(award.federal_action_obligation);
    const naics = award.naics_description ? ` — ${toTitleCase(award.naics_description)}` : "";
    const piid = award.award_id_piid || "";
    return {
      title: `${name} — ${value} ${agency} Contract | Awardopedia`,
      description: `${agency} awarded ${value} to ${name} under contract ${piid}${naics}. Free access to competition details, subawards, executive compensation, and solicitation history.`,
      openGraph: {
        title: `${name} — ${value} Federal Contract`,
        description: `${agency} contract awarded to ${name}: ${value} obligated${naics}. Full contract intelligence, free.`,
      },
    };
  } catch {
    return { title: "Contract Detail — Awardopedia" };
  }
}

// ── Page ──────────────────────────────────────────────────────────────────
export default async function AwardDetailPage({ params }) {
  const { id } = await params;
  let award = null;
  let related = [];

  try {
    const res = await getAward(id);
    award = res.award;
    related = res.related || [];
  } catch {
    return (
      <div className="container" style={{ padding: "var(--space-12) 0", textAlign: "center" }}>
        <h1>Award not found</h1>
        <Link href="/awards" className="btn-primary" style={{ marginTop: "var(--space-4)", display: "inline-flex" }}>Back to Awards</Link>
      </div>
    );
  }

  const status = contractStatus(award.period_of_performance_current_end);
  const days = daysRemaining(award.period_of_performance_current_end);
  const garbageDesc = isGarbageDescription(award.description);
  const piid = award.award_id_piid;

  // Normalize all ALL-CAPS government text to readable title case
  const tc = toTitleCase;
  const recipientName   = tc(award.recipient_name);
  const agencyName      = tc(award.agency_name);
  const subAgencyName   = tc(award.sub_agency_name);
  const officeName      = tc(award.office_name);
  const naicsDesc       = tc(award.naics_description);
  const pscDesc         = tc(award.psc_description);
  const competitionType = tc(award.competition_type);
  const pricingType     = tc(award.pricing_type);
  const setAsideType    = award.set_aside_type && !award.set_aside_type.match(/^NO SET ASIDE/i) ? tc(award.set_aside_type) : "None";
  const sectorLabel     = award.sector_slug && award.sector_slug !== "other"
    ? (sectorLabels()[award.sector_slug] || tc(award.sector_slug.replace(/-/g, ' ')))
    : null;
  const execOfficers    = (award.executive_officers || []).map(o => ({
    ...o, name: tc(o.name.replace(/\s+/g, ' ').trim())
  }));

  // External links
  const usaspendingUrl = award.usaspending_url || (award.usaspending_id ? `https://www.usaspending.gov/award/${award.usaspending_id}/` : null);
  const samUrl = award.solicitation_id ? `https://sam.gov/search/?keywords=${encodeURIComponent(award.solicitation_id)}&index=opp` : null;

  // Period label
  const periodLabel = [
    award.period_of_performance_start ? formatDate(award.period_of_performance_start) : null,
    award.period_of_performance_current_end ? formatDate(award.period_of_performance_current_end) : null,
  ].filter(Boolean).join(" – ") || "—";

  // Status badge text
  let statusText = null;
  if (status === "active" && days !== null) {
    statusText = days <= 90 ? `Expires in ${days} days` : "Active";
  } else if (status === "expired") {
    statusText = "Expired";
  }

  return (
    <div className="container" style={{ padding: "var(--space-6) 0 var(--space-12)" }}>
      {/* Print styles */}
      <style>{`
        @media print {
          nav, .no-print, footer { display: none !important; }
          .container { max-width: 100% !important; padding: 0 !important; }
          .card { box-shadow: none !important; border: 1px solid #ddd !important; }
          a { color: inherit !important; text-decoration: none !important; }
        }
      `}</style>

      {/* Breadcrumb */}
      <div className="no-print" style={{ marginBottom: "var(--space-3)", fontSize: "var(--font-size-sm)", color: "var(--color-muted)" }}>
        <Link href="/awards" style={{ color: "var(--color-muted)" }}>Awards</Link>
        {" / "}
        <span>{piid || `#${id}`}</span>
      </div>

      {/* ── Header ─────────────────────────────────────────── */}
      <div style={{ marginBottom: "var(--space-6)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap", marginBottom: "var(--space-2)" }}>
          <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "var(--font-size-sm)", color: "var(--color-muted)", background: "var(--color-bg-subtle, #f7f7f5)", padding: "2px 8px", borderRadius: 4, border: "1px solid var(--color-border)" }}>{piid}</span>
          {statusText && (
            <span style={{
              fontSize: "var(--font-size-xs)", fontWeight: 700, padding: "3px 10px",
              borderRadius: 20, textTransform: "uppercase", letterSpacing: "0.05em",
              background: status === "active" ? (days <= 90 ? "#FEF3C7" : "#DCFCE7") : "#F3F4F6",
              color: status === "active" ? (days <= 90 ? "#92400E" : "#166534") : "#6B7280",
            }}>{statusText}</span>
          )}
          {/* Print button handled in AwardDetailClient (needs window.print) */}
        </div>
        <h1 style={{ fontSize: "var(--font-size-2xl)", fontWeight: "var(--font-weight-medium)", lineHeight: 1.2, marginBottom: "var(--space-1)" }}>
          {recipientName || "Unknown Contractor"}
        </h1>
        <div style={{ fontSize: "var(--font-size-base)", color: "var(--color-muted)" }}>
          {agencyName}{subAgencyName && subAgencyName !== agencyName ? ` / ${subAgencyName}` : ""}
          {naicsDesc ? ` — ${naicsDesc}` : ""}
        </div>
      </div>

      {/* ── Key Metrics Strip ──────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "var(--space-3)", marginBottom: "var(--space-8)" }}>
        <StatBox label="Obligated" value={formatCurrency(award.federal_action_obligation)} highlight />
        <StatBox label="Ceiling" value={formatCurrency(award.base_exercised_options || award.potential_total_value)} sub={award.base_exercised_options && award.potential_total_value && award.base_exercised_options !== award.potential_total_value ? `Max: ${formatCurrency(award.potential_total_value)}` : null} />
        <StatBox label="Period" value={periodLabel} />
        {award.subaward_count > 0 && <StatBox label="Subawards" value={award.subaward_count?.toLocaleString()} sub={award.subaward_amount ? formatCurrency(award.subaward_amount) + " downstream" : null} />}
      </div>

      {/* ── Two-column layout ──────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: "var(--space-6)", alignItems: "start" }}>

        {/* Left: main content */}
        <div>

          {/* Description */}
          <Section title="About This Contract">
            {garbageDesc ? (
              <p style={{ fontSize: "var(--font-size-sm)", color: "var(--color-muted)", fontStyle: "italic", marginBottom: "var(--space-4)" }}>
                No plain-language description was published by the contracting agency.
                {award.description && <span style={{ display: "block", marginTop: 4, fontFamily: "var(--font-mono, monospace)", fontSize: "var(--font-size-xs)" }}>Raw gov field: "{award.description}"</span>}
              </p>
            ) : (
              <p style={{ fontSize: "var(--font-size-sm)", lineHeight: 1.7, marginBottom: "var(--space-4)" }}>{award.description}</p>
            )}
            {/* AI brief — client component handles credit gating */}
            <AwardDetailClient awardId={id} isEnriched={!!award.enriched_at} />
          </Section>

          {/* Classification */}
          <Section title="Classification">
            {award.naics_code && <Row label="NAICS Code">
              <Link href={`/naics/${award.naics_code}`} style={{ color: "var(--color-navy)" }}>{award.naics_code} — {naicsDesc || "—"}</Link>
            </Row>}
            {award.psc_code && <Row label="Product / Service Code" value={`${award.psc_code}${pscDesc ? ` — ${pscDesc}` : ""}`} />}
            {sectorLabel && <Row label="Sector"><Link href={`/sectors/${award.sector_slug}`} style={{ color: "var(--color-navy)" }}>{sectorLabel}</Link></Row>}
          </Section>

          {/* Competition & Procurement */}
          <Section title="Competition & Procurement">
            <Row label="Competition" value={competitionType || tc(award.extent_competed)} />
            <Row label="Offers Received" value={award.number_of_offers != null ? `${award.number_of_offers} offer${award.number_of_offers !== 1 ? "s" : ""}` : null} />
            <Row label="Pricing Type" value={pricingType} />
            <Row label="Set-Aside" value={setAsideType} />
            <Row label="Contract Type" value={tc(award.contract_type)} />
            {award.solicitation_id && (
              <Row label="Solicitation ID">
                <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{award.solicitation_id}</span>
                {samUrl && <a href={samUrl} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 8, color: "var(--color-navy)", fontSize: "var(--font-size-xs)" }}>Search SAM.gov ↗</a>}
              </Row>
            )}
          </Section>

          {/* Subawards */}
          {(award.subaward_count > 0 || award.subaward_amount > 0) && (
            <Section title="Subawards">
              <Row label="Number of Subawards" value={award.subaward_count?.toLocaleString()} />
              <Row label="Total Subaward Amount" value={formatCurrency(award.subaward_amount)} mono />
              <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)", marginTop: "var(--space-2)" }}>
                Federal contractors on this award are distributing work to subcontractors.{" "}
                <a href={usaspendingUrl + "#subawards"} target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-navy)" }}>View subawards on USASpending ↗</a>
              </p>
            </Section>
          )}

          {/* Executive Compensation */}
          {execOfficers.length > 0 && (
            <Section title="Executive Compensation (Disclosed)">
              <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)", marginBottom: "var(--space-3)" }}>
                Federal law requires contractors over $25M to disclose their five highest-paid executives.
              </p>
              <table style={{ width: "100%", fontSize: "var(--font-size-sm)", borderCollapse: "collapse" }}>
                <tbody>
                  {execOfficers.map((o, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--color-border)" }}>
                      <td style={{ padding: "6px 0", color: "var(--color-text)" }}>{o.name}</td>
                      <td style={{ padding: "6px 0", textAlign: "right", fontFamily: "var(--font-mono, monospace)", color: "var(--color-navy)" }}>{formatCurrency(o.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {/* External Links */}
          <Section title="Source Records">
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              {usaspendingUrl && (
                <a href={usaspendingUrl} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: "var(--font-size-sm)", color: "var(--color-navy)" }}>
                  <ExternalLink size={14} /> Full record on USASpending.gov
                </a>
              )}
              {samUrl && (
                <a href={samUrl} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: "var(--font-size-sm)", color: "var(--color-navy)" }}>
                  <ExternalLink size={14} /> Search original solicitation on SAM.gov
                </a>
              )}
            </div>
          </Section>
        </div>

        {/* Right: sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>

          {/* Agency */}
          <div className="card">
            <div style={{ fontSize: "var(--font-size-xs)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-muted)", marginBottom: "var(--space-3)" }}>Awarding Agency</div>
            <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-2)" }}>
              <Building2 size={15} style={{ color: "var(--color-navy)", flexShrink: 0, marginTop: 2 }} />
              <div>
                {award.agency_code ? (
                  <Link href={`/agencies/${award.agency_code}`} style={{ fontWeight: "var(--font-weight-medium)", color: "var(--color-navy)", fontSize: "var(--font-size-sm)" }}>{agencyName}</Link>
                ) : (
                  <span style={{ fontWeight: "var(--font-weight-medium)", fontSize: "var(--font-size-sm)" }}>{agencyName || "—"}</span>
                )}
                {subAgencyName && subAgencyName !== agencyName && (
                  <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)", marginTop: 2 }}>{subAgencyName}</div>
                )}
                {officeName && (
                  <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)", marginTop: 2 }}>{officeName}</div>
                )}
              </div>
            </div>
          </div>

          {/* Contractor */}
          <div className="card">
            <div style={{ fontSize: "var(--font-size-xs)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-muted)", marginBottom: "var(--space-3)" }}>Contractor</div>
            {award.recipient_uei ? (
              <Link href={`/contractors/${award.recipient_uei}`} style={{ fontWeight: "var(--font-weight-medium)", color: "var(--color-navy)", fontSize: "var(--font-size-sm)", display: "block", marginBottom: "var(--space-1)" }}>
                {recipientName}
              </Link>
            ) : (
              <div style={{ fontWeight: "var(--font-weight-medium)", fontSize: "var(--font-size-sm)", marginBottom: "var(--space-1)" }}>{recipientName || "—"}</div>
            )}
            {award.recipient_uei && (
              <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)", fontFamily: "var(--font-mono, monospace)", marginBottom: "var(--space-2)" }}>UEI: {award.recipient_uei}</div>
            )}
            {award.recipient_address && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 4, fontSize: "var(--font-size-xs)", color: "var(--color-muted)" }}>
                <MapPin size={11} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>{award.recipient_address}</span>
              </div>
            )}
            {award.congressional_district && (
              <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)", marginTop: 4 }}>Congressional District: {award.congressional_district}</div>
            )}
          </div>

          {/* Contract ID */}
          <div className="card">
            <div style={{ fontSize: "var(--font-size-xs)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-muted)", marginBottom: "var(--space-3)" }}>Contract ID</div>
            <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "var(--font-size-sm)", wordBreak: "break-all" }}>{piid}</div>
            {award.action_date && <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)", marginTop: "var(--space-2)" }}>Signed: {formatDate(award.action_date)}</div>}
          </div>

          {/* Financials */}
          <div className="card">
            <div style={{ fontSize: "var(--font-size-xs)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-muted)", marginBottom: "var(--space-3)" }}>Financials</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              <div>
                <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)" }}>Obligated (Actual Spend)</div>
                <div style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 700, color: "var(--color-navy)" }}>{formatCurrency(award.federal_action_obligation)}</div>
              </div>
              {award.base_exercised_options && (
                <div>
                  <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)" }}>Base + Exercised Options</div>
                  <div style={{ fontFamily: "var(--font-mono, monospace)" }}>{formatCurrency(award.base_exercised_options)}</div>
                </div>
              )}
              {award.potential_total_value && (
                <div>
                  <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)" }}>Maximum Ceiling</div>
                  <div style={{ fontFamily: "var(--font-mono, monospace)" }}>{formatCurrency(award.potential_total_value)}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Related Awards */}
      {related.length > 0 && (
        <section style={{ marginTop: "var(--space-10)" }} className="no-print">
          <h2 style={{ fontSize: "var(--font-size-lg)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-4)" }}>Related Awards</h2>
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            {related.map((r) => <ContractCard key={r.award_id} award={r} />)}
          </div>
        </section>
      )}

      <TrustBox sourceUrl={usaspendingUrl} className="no-print" />

      {/* JSON-LD structured data for Google */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "GovernmentService",
        "name": `${recipientName} — ${agencyName} Contract`,
        "identifier": piid,
        "provider": { "@type": "GovernmentOrganization", "name": agencyName },
        "serviceOperator": { "@type": "Organization", "name": recipientName },
        "offers": {
          "@type": "Offer",
          "price": String(award.federal_action_obligation),
          "priceCurrency": "USD"
        },
        "temporalCoverage": `${award.period_of_performance_start || ""}/${award.period_of_performance_current_end || ""}`,
        "description": garbageDesc
          ? `${agencyName} contract awarded to ${recipientName}. NAICS: ${award.naics_code} — ${naicsDesc}. PSC: ${award.psc_code} — ${pscDesc}.`
          : award.description,
        "url": `https://awardopedia.com/awards/${id}`,
      })}} />
    </div>
  );
}
