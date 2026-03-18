import { useState, useEffect } from 'react'
import { ArrowLeft } from 'lucide-react'

const OPP_SECTION_LABELS = {
  executive_summary:       'Executive Summary',
  bid_recommendation:      'Bid / No-Bid Recommendation',
  competitive_landscape:   'Competitive Landscape',
  recompete_intelligence:  'Recompete Intelligence',
  teaming_strategy:        'Teaming Strategy',
  risk_factors:            'Risk Factors',
  action_items:            'Action Items',
}

function ReportView({ sections, generatedAt }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span className="badge badge-success">Report Ready</span>
        {generatedAt && (
          <span className="text-sm text-muted">
            Generated {new Date(generatedAt).toLocaleDateString()}
          </span>
        )}
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-muted)', fontStyle: 'italic', marginBottom: 14, lineHeight: 1.5 }}>
        Verified data from SAM.gov. Bid analysis and recommendations are AI-generated assessments — not verified competitive intelligence.
      </div>

      {sections.bid_recommendation && (
        <div className="card" style={{ borderLeft: '3px solid var(--color-navy)', marginBottom: 12 }}>
          <div className="section-title">Bid / No-Bid Recommendation</div>
          <p style={{ fontSize: 13, lineHeight: 1.6 }}>{sections.bid_recommendation}</p>
        </div>
      )}

      {Object.entries(OPP_SECTION_LABELS)
        .filter(([key]) => key !== 'bid_recommendation' && key !== 'attribution' && sections[key])
        .map(([key, label]) => (
          <div key={key} className="card" style={{ marginBottom: 12 }}>
            <div className="section-title">{label}</div>
            <p style={{ fontSize: 13, lineHeight: 1.6 }}>{sections[key]}</p>
          </div>
        ))
      }

      {sections.attribution && (
        <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 8, fontStyle: 'italic' }}>
          {sections.attribution}
        </div>
      )}
    </div>
  )
}

function fmt(n) {
  if (!n) return '—'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function daysUntil(dateStr) {
  if (!dateStr) return null
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000)
}

function DeadlineLabel({ days }) {
  if (days === null) return <span>—</span>
  if (days < 0) return <span className="expiry-danger">Closed {Math.abs(days)}d ago</span>
  if (days <= 5) return <span className="expiry-danger">{days} days</span>
  if (days <= 14) return <span className="expiry-warn">{days} days</span>
  return <span>{days} days</span>
}

export default function OpportunityDetail({ opp, onBack }) {
  const days = daysUntil(opp.response_deadline)
  const [report, setReport]           = useState(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState(null)

  // Auto-load cached report on mount
  useEffect(() => {
    if (!opp.notice_id) return
    fetch(`/api/reports/opportunity/${opp.notice_id}`)
      .then(r => r.json())
      .then(data => { if (data.found) setReport({ sections: data.sections, generated_at: data.generated_at }) })
      .catch(() => {})
  }, [opp.notice_id])

  async function generateReport() {
    setReportLoading(true)
    setReportError(null)
    try {
      const res = await fetch('/api/reports/generate-opportunity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notice_id: opp.notice_id })
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Generation failed')
      setReport(data)
    } catch (e) {
      setReportError(e.message)
    } finally {
      setReportLoading(false)
    }
  }

  return (
    <div>
      <div className="detail-header">
        <div className="container">
          <button className="back-btn" onClick={onBack}>
            <ArrowLeft size={14} /> Back to opportunities
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1>{opp.title}</h1>
            {opp.is_recompete && <span className="badge badge-amber">RECOMPETE</span>}
          </div>
          <div className="detail-header-meta">
            <span className="mono">{opp.notice_id}</span>
            <span>·</span>
            <span>{opp.agency_name}</span>
            <span>·</span>
            <span>Deadline: {opp.response_deadline || '—'}</span>
          </div>
        </div>
      </div>

      <div className="container">
        <div className="detail-layout">
          <div>
            {/* AI Summary */}
            {opp.llama_summary ? (
              <div className="card" style={{ borderLeft: '3px solid var(--color-amber)', marginBottom: 16 }}>
                <div className="section-title">AI Summary</div>
                <p style={{ fontSize: 14 }}>{opp.llama_summary}</p>
                <div className="text-muted text-sm mt-4">Generated by llama3.2:3b · local model · not advice</div>
              </div>
            ) : (
              <div className="card" style={{ borderLeft: '3px solid var(--color-border)', marginBottom: 16 }}>
                <div className="section-title">AI Summary</div>
                <p className="text-muted text-sm">Summary will be generated in Phase 3.</p>
              </div>
            )}

            {/* Overview */}
            <div className="card">
              <div className="section-title">Opportunity Overview</div>
              <div className="field-grid">
                <div className="field">
                  <span className="field-label">Notice ID</span>
                  <span className="field-value mono">{opp.notice_id}</span>
                </div>
                <div className="field">
                  <span className="field-label">Notice Type</span>
                  <span className="field-value">{opp.notice_type || '—'}</span>
                </div>
                <div className="field">
                  <span className="field-label">NAICS</span>
                  <span className="field-value">{opp.naics_code} {opp.naics_description ? `— ${opp.naics_description}` : ''}</span>
                </div>
                <div className="field">
                  <span className="field-label">PSC Code</span>
                  <span className="field-value mono">{opp.psc_code || '—'}</span>
                </div>
              </div>
              {opp.description && (
                <div className="field mt-16">
                  <span className="field-label">Description</span>
                  <span className="field-value" style={{ fontWeight: 400 }}>{opp.description}</span>
                </div>
              )}
            </div>

            {/* Who is buying */}
            <div className="card">
              <div className="section-title">Who Is Buying</div>
              <div className="field-grid">
                <div className="field">
                  <span className="field-label">Agency</span>
                  <span className="field-value">{opp.agency_name || '—'}</span>
                </div>
                <div className="field">
                  <span className="field-label">Sub-Agency</span>
                  <span className="field-value">{opp.sub_agency_name || '—'}</span>
                </div>
                <div className="field">
                  <span className="field-label">Contracting Officer</span>
                  <span className="field-value">{opp.contracting_officer || '—'}</span>
                </div>
                {opp.contracting_officer_email && (
                  <div className="field">
                    <span className="field-label">Email</span>
                    <a href={`mailto:${opp.contracting_officer_email}`} className="field-value">{opp.contracting_officer_email}</a>
                  </div>
                )}
                {opp.contracting_officer_phone && (
                  <div className="field">
                    <span className="field-label">Phone</span>
                    <span className="field-value">{opp.contracting_officer_phone}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Timeline */}
            <div className="card">
              <div className="section-title">Timeline</div>
              <div className="field-grid">
                <div className="field">
                  <span className="field-label">Posted Date</span>
                  <span className="field-value">{opp.posted_date || '—'}</span>
                </div>
                <div className="field">
                  <span className="field-label">Response Deadline</span>
                  <span className="field-value fw-600">{opp.response_deadline || '—'}</span>
                </div>
                <div className="field">
                  <span className="field-label">Days to Respond</span>
                  <span className="field-value" style={{ fontSize: 18, fontWeight: 700 }}>
                    <DeadlineLabel days={days} />
                  </span>
                </div>
                <div className="field">
                  <span className="field-label">Archive Date</span>
                  <span className="field-value">{opp.archive_date || '—'}</span>
                </div>
              </div>
            </div>

            {/* What they want */}
            <div className="card">
              <div className="section-title">What They Want &amp; How</div>
              <div className="field-grid">
                <div className="field">
                  <span className="field-label">Estimated Value</span>
                  <span className="field-value mono">
                    {opp.estimated_value_min || opp.estimated_value_max
                      ? `${fmt(opp.estimated_value_min)} – ${fmt(opp.estimated_value_max)}`
                      : '—'}
                  </span>
                </div>
                <div className="field">
                  <span className="field-label">Set-Aside Type</span>
                  <span className="field-value">{opp.set_aside_type || '—'}</span>
                </div>
                <div className="field">
                  <span className="field-label">Contract Type</span>
                  <span className="field-value">{opp.contract_type || '—'}</span>
                </div>
                <div className="field">
                  <span className="field-label">Place of Performance</span>
                  <span className="field-value">{[opp.place_of_performance_city, opp.place_of_performance_state].filter(Boolean).join(', ') || '—'}</span>
                </div>
              </div>
            </div>

            {/* Incumbent & Competition */}
            <div className="card">
              <div className="section-title">Incumbent &amp; Competition</div>
              {opp.is_recompete ? (
                <div>
                  <span className="badge badge-amber" style={{ marginBottom: 10, display: 'inline-block' }}>Recompete Opportunity</span>
                  <div className="field-grid mt-8">
                    <div className="field">
                      <span className="field-label">Incumbent Contractor</span>
                      <span className="field-value fw-600">{opp.incumbent_name || 'Unknown'}</span>
                    </div>
                    {opp.incumbent_uei && (
                      <div className="field">
                        <span className="field-label">Incumbent UEI</span>
                        <span className="field-value mono">{opp.incumbent_uei}</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-muted text-sm">New requirement — no known incumbent.</p>
              )}
            </div>

            {/* Documents */}
            <div className="card">
              <div className="section-title">Documents &amp; Next Steps</div>
              {opp.sam_url_alive !== false ? (
                <a href={opp.sam_url || `https://sam.gov/opp/${opp.notice_id}/view`} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
                  View on SAM.gov ↗
                </a>
              ) : (
                <div className="trust-box">
                  This opportunity may have been archived.{' '}
                  <a href={`https://sam.gov/search/?keywords=${opp.notice_id}`} target="_blank" rel="noopener noreferrer">
                    Search SAM.gov →
                  </a>
                </div>
              )}
            </div>

            {/* Opportunity Report — expands in main column when generated */}
            {report?.sections && <ReportView sections={report.sections} generatedAt={report.generated_at} />}
          </div>

          {/* Sidebar */}
          <div>
            <div className="trust-box">
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Source</div>
              This opportunity is sourced from SAM.gov, the official US federal contracting portal.
              <div className="mono" style={{ marginTop: 8, fontSize: 11 }}>Notice ID: {opp.notice_id}</div>
            </div>

            <div className="card mt-16">
              <div className="section-title">Generate Report</div>
              <p style={{ fontSize: 13, marginBottom: 12 }}>
                Full opportunity analysis: bid/no-bid recommendation, who won similar contracts, teaming suggestions, risk factors.
              </p>
              <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 12 }}>
                Powered by Claude · PDF + CSV · 1 credit ($0.33)
              </div>
              {reportError && (
                <div style={{ fontSize: 12, color: 'var(--color-danger)', marginBottom: 10 }}>{reportError}</div>
              )}
              {report?.sections ? (
                <div style={{ fontSize: 12, color: 'var(--color-success)', textAlign: 'center', padding: '8px 0' }}>
                  ✓ Report loaded above
                </div>
              ) : (
                <button
                  className="btn btn-amber"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={generateReport}
                  disabled={reportLoading}
                >
                  {reportLoading ? 'Generating…' : 'Generate Report — 1 Credit'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
