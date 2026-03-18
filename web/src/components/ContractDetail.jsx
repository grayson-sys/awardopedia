import { useState, useEffect } from 'react'
import { ArrowLeft, FileText, Loader } from 'lucide-react'

function fmt(n) {
  if (!n) return '—'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function daysLeft(dateStr) {
  if (!dateStr) return null
  const diff = Math.ceil((new Date(dateStr) - new Date()) / 86400000)
  return diff
}

function ExpiryLabel({ days }) {
  if (days === null) return <span>—</span>
  if (days < 0) return <span className="expiry-danger">Expired {Math.abs(days)}d ago</span>
  if (days <= 30) return <span className="expiry-danger">{days} days</span>
  if (days <= 90) return <span className="expiry-warn">{days} days</span>
  return <span>{days} days</span>
}

const SECTION_LABELS = {
  executive_summary: 'Executive Summary',
  award_details: 'Award Details',
  competitive_landscape: 'Competitive Landscape',
  incumbent_analysis: 'Incumbent Analysis',
  recompete_assessment: 'Recompete Assessment',
  recommended_action: 'Recommended Action',
  attribution: null, // rendered separately
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
      <div style={{
        fontSize: 11,
        color: 'var(--color-muted)',
        fontStyle: 'italic',
        marginBottom: 14,
        lineHeight: 1.5
      }}>
        Verified data from USASpending.gov. Market analysis and recommendations are AI-generated assessments — not verified competitive intelligence.
      </div>

      {/* Recommended Action — prominent first */}
      {sections.recommended_action && (
        <div className="card" style={{ borderLeft: '3px solid var(--color-navy)', marginBottom: 12 }}>
          <div className="section-title">Recommended Action</div>
          <p style={{ fontSize: 13, lineHeight: 1.6 }}>{sections.recommended_action}</p>
        </div>
      )}

      {/* Remaining sections */}
      {Object.entries(SECTION_LABELS)
        .filter(([key, label]) => label && key !== 'recommended_action' && sections[key])
        .map(([key, label]) => (
          <div key={key} className="card" style={{ marginBottom: 12 }}>
            <div className="section-title">{label}</div>
            <p style={{ fontSize: 13, lineHeight: 1.6 }}>{sections[key]}</p>
          </div>
        ))
      }

      {/* Attribution */}
      {sections.attribution && (
        <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 8, fontStyle: 'italic' }}>
          {sections.attribution}
        </div>
      )}
    </div>
  )
}

export default function ContractDetail({ contract, onBack }) {
  const days = daysLeft(contract.end_date)
  const [report, setReport] = useState(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState(null)

  // Auto-load cached report on mount
  useEffect(() => {
    if (!contract.piid) return
    fetch(`/api/reports/contract/${contract.piid}`)
      .then(r => r.json())
      .then(data => { if (data.found) setReport({ sections: data.sections, generated_at: data.generated_at }) })
      .catch(() => {})
  }, [contract.piid])

  async function generateReport() {
    setReportLoading(true)
    setReportError(null)
    try {
      const res = await fetch('/api/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ piid: contract.piid })
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

  function openPrint() {
    window.open(`/api/reports/print/${contract.piid}`, '_blank')
  }

  return (
    <div>
      <div className="detail-header">
        <div className="container">
          <button className="back-btn" onClick={onBack}>
            <ArrowLeft size={14} /> Back to contracts
          </button>
          <h1>{contract.recipient_name}</h1>
          <div className="detail-header-meta">
            <span className="mono">{contract.piid}</span>
            <span>·</span>
            <span>{contract.agency_name}</span>
            <span>·</span>
            <span className="mono">{fmt(contract.award_amount)}</span>
          </div>
        </div>
      </div>

      <div className="container">
        <div className="detail-layout">
          {/* Main content */}
          <div>
            {/* AI Summary */}
            {contract.llama_summary && (
              <div className="card" style={{ borderLeft: '3px solid var(--color-amber)', marginBottom: 16 }}>
                <div className="section-title">AI Summary</div>
                <p style={{ fontSize: 14 }}>{contract.llama_summary}</p>
                <div className="text-muted text-sm mt-4">Generated by llama3.2:3b · local model · not advice</div>
              </div>
            )}
            {!contract.llama_summary && (
              <div className="card" style={{ borderLeft: '3px solid var(--color-border)', marginBottom: 16 }}>
                <div className="section-title">AI Summary</div>
                <p className="text-muted text-sm">Summary will be generated in Phase 3.</p>
              </div>
            )}

            {/* Contract Overview */}
            <div className="card">
              <div className="section-title">Contract Overview</div>
              <div className="field-grid">
                <div className="field">
                  <span className="field-label">Agency</span>
                  <span className="field-value">{contract.agency_name || '—'}</span>
                </div>
                <div className="field">
                  <span className="field-label">Sub-Agency</span>
                  <span className="field-value">{contract.sub_agency_name || '—'}</span>
                </div>
                <div className="field">
                  <span className="field-label">PIID</span>
                  <span className="field-value mono">{contract.piid}</span>
                </div>
                <div className="field">
                  <span className="field-label">Contract Type</span>
                  <span className="field-value">{contract.contract_type || '—'}</span>
                </div>
                <div className="field">
                  <span className="field-label">NAICS</span>
                  <span className="field-value">{contract.naics_code} {contract.naics_description ? `— ${contract.naics_description}` : ''}</span>
                </div>
                <div className="field">
                  <span className="field-label">PSC</span>
                  <span className="field-value">{contract.psc_code || '—'}</span>
                </div>
              </div>
              {contract.description && (
                <div className="field mt-16">
                  <span className="field-label">Description</span>
                  <span className="field-value" style={{ fontWeight: 400 }}>{contract.description}</span>
                </div>
              )}
            </div>

            {/* Award Details */}
            <div className="card">
              <div className="section-title">Award Details</div>
              <div className="field-grid">
                <div className="field">
                  <span className="field-label">Award Amount</span>
                  <span className="field-value mono">{fmt(contract.award_amount)}</span>
                </div>
                <div className="field">
                  <span className="field-label">Base Amount</span>
                  <span className="field-value mono">{fmt(contract.base_amount)}</span>
                </div>
                <div className="field">
                  <span className="field-label">Ceiling Amount</span>
                  <span className="field-value mono">{fmt(contract.ceiling_amount)}</span>
                </div>
                <div className="field">
                  <span className="field-label">Federal Obligation</span>
                  <span className="field-value mono">{fmt(contract.federal_obligation)}</span>
                </div>
                <div className="field">
                  <span className="field-label">Total Outlayed</span>
                  <span className="field-value mono">{fmt(contract.total_outlayed)}</span>
                </div>
              </div>
            </div>

            {/* Timeline */}
            <div className="card">
              <div className="section-title">Timeline</div>
              <div className="field-grid">
                <div className="field">
                  <span className="field-label">Start Date</span>
                  <span className="field-value">{contract.start_date || '—'}</span>
                </div>
                <div className="field">
                  <span className="field-label">End Date</span>
                  <span className="field-value">{contract.end_date || '—'}</span>
                </div>
                <div className="field">
                  <span className="field-label">Days Remaining</span>
                  <span className="field-value" style={{ fontSize: 18, fontWeight: 700 }}>
                    <ExpiryLabel days={days} />
                  </span>
                </div>
                <div className="field">
                  <span className="field-label">Fiscal Year</span>
                  <span className="field-value">{contract.fiscal_year || '—'}</span>
                </div>
              </div>
            </div>

            {/* How it was awarded */}
            <div className="card">
              <div className="section-title">How It Was Awarded</div>
              <div className="field-grid">
                <div className="field">
                  <span className="field-label">Set-Aside Type</span>
                  <span className="field-value">{contract.set_aside_type || '—'}</span>
                </div>
                <div className="field">
                  <span className="field-label">Competition Type</span>
                  <span className="field-value">{contract.competition_type || '—'}</span>
                </div>
                <div className="field">
                  <span className="field-label">Extent Competed</span>
                  <span className="field-value">{contract.extent_competed || '—'}</span>
                </div>
                <div className="field">
                  <span className="field-label">Number of Offers</span>
                  <span className="field-value mono">{contract.number_of_offers ?? '—'}</span>
                </div>
                <div className="field">
                  <span className="field-label">Contracting Officer</span>
                  <span className="field-value">{contract.contracting_officer || '—'}</span>
                </div>
              </div>
            </div>

            {/* Contractor */}
            <div className="card">
              <div className="section-title">Contractor</div>
              <div className="field-grid">
                <div className="field">
                  <span className="field-label">Recipient</span>
                  <span className="field-value fw-600">{contract.recipient_name || '—'}</span>
                </div>
                <div className="field">
                  <span className="field-label">UEI</span>
                  <span className="field-value mono">{contract.recipient_uei || '—'}</span>
                </div>
                <div className="field">
                  <span className="field-label">Business Size</span>
                  <span className="field-value">{contract.business_size || '—'}</span>
                </div>
                <div className="field">
                  <span className="field-label">Small Business</span>
                  <span className="field-value">
                    {contract.is_small_business === true ? '✓ Yes' : contract.is_small_business === false ? 'No' : '—'}
                  </span>
                </div>
                <div className="field">
                  <span className="field-label">City / State</span>
                  <span className="field-value">{[contract.recipient_city, contract.recipient_state].filter(Boolean).join(', ') || '—'}</span>
                </div>
              </div>
            </div>

            {/* AI Report — expands in main column when generated */}
            {report?.sections && (
              <ReportView
                sections={report.sections}
                generatedAt={report.generated_at}
              />
            )}
          </div>

          {/* Sidebar */}
          <div>
            {/* Source */}
            <div className="trust-box">
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Source & Verification</div>
              This record is sourced from USASpending.gov, the official US federal spending database.
              <div className="mono" style={{ marginTop: 8, fontSize: 11 }}>PIID: {contract.piid}</div>
              <div style={{ marginTop: 8 }}>
                {contract.usaspending_alive !== false ? (
                  <a href={`https://www.usaspending.gov/award/${contract.piid}`} target="_blank" rel="noopener noreferrer">
                    View on USASpending.gov ↗
                  </a>
                ) : (
                  <>
                    Original URL no longer available.{' '}
                    <a href={`https://www.usaspending.gov/search?query=${contract.piid}`} target="_blank" rel="noopener noreferrer">
                      Search USASpending.gov →
                    </a>
                  </>
                )}
              </div>
            </div>

            {/* Report CTA */}
            <div className="card mt-16">
              <div className="section-title">AI Analysis Report</div>

              {!report && !reportLoading && (
                <>
                  <p style={{ fontSize: 13, marginBottom: 12 }}>
                    Competitive landscape · Incumbent analysis · Recompete assessment · Bid recommendation
                  </p>
                  <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 12 }}>
                    Powered by Claude · 1 credit ($0.33)
                  </div>
                  {reportError && (
                    <div style={{ fontSize: 12, color: 'var(--color-danger)', marginBottom: 8 }}>
                      Error: {reportError}
                    </div>
                  )}
                  <button
                    className="btn btn-amber"
                    style={{ width: '100%', justifyContent: 'center' }}
                    onClick={generateReport}
                  >
                    <FileText size={14} /> Generate Report — 1 Credit
                  </button>
                </>
              )}

              {reportLoading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0', color: 'var(--color-muted)', fontSize: 13 }}>
                  <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />
                  Analyzing contract data...
                </div>
              )}

              {report && (
                <div>
                  <span className="badge badge-success" style={{ marginBottom: 8, display: 'inline-block' }}>
                    Report Ready
                  </span>
                  <div className="text-sm text-muted mt-4" style={{ marginBottom: 12 }}>
                    Generated {new Date(report.generated_at).toLocaleDateString()}
                  </div>
                  <button
                    className="btn btn-navy"
                    style={{ width: '100%', justifyContent: 'center' }}
                    onClick={openPrint}
                  >
                    <FileText size={14} /> Print / Save PDF
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
