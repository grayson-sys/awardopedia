import { useState, useEffect } from 'react'
import { ArrowLeft, FileText, Loader, Bell, BellRing, Download } from 'lucide-react'
import InfoIcon from './InfoIcon'

// Detect FAR competition exceptions and return appropriate tooltip field
function getFarExceptionField(competitionType) {
  if (!competitionType) return null
  const upper = competitionType.toUpperCase()
  if (upper.includes('6.302-1') || upper.includes('ONLY ONE')) return 'FAR6302-1'
  if (upper.includes('6.302-2') || upper.includes('URGENCY')) return 'FAR6302-2'
  if (upper.includes('6.302-3') || upper.includes('INDUSTRIAL')) return 'FAR6302-3'
  if (upper.includes('6.302-4') || upper.includes('INTERNATIONAL')) return 'FAR6302-4'
  if (upper.includes('6.302-5') || upper.includes('STATUTE')) return 'FAR6302-5'
  if (upper.includes('6.302-6') || upper.includes('SECURITY')) return 'FAR6302-6'
  if (upper.includes('6.302-7') || upper.includes('PUBLIC INTEREST')) return 'FAR6302-7'
  return null
}

function fmt(n) {
  if (!n) return '—'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function daysLeft(dateStr) {
  if (!dateStr) return null
  const diff = Math.ceil((new Date(dateStr) - new Date()) / 86400000)
  return diff
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC'
  })
}

function formatTimeAgo(days) {
  const absDays = Math.abs(days)
  if (absDays < 30) return `${absDays}d`
  if (absDays < 365) return `${Math.round(absDays / 30)}mo`
  const years = (absDays / 365).toFixed(1)
  return years.endsWith('.0') ? `${Math.round(absDays / 365)}y` : `${years}y`
}

function ExpiryLabel({ days }) {
  if (days === null) return <span>—</span>
  if (days < 0) return <span className="expiry-danger">Expired {formatTimeAgo(days)} ago</span>
  if (days <= 30) return <span className="expiry-danger">{formatTimeAgo(days)} left</span>
  if (days <= 90) return <span className="expiry-warn">{formatTimeAgo(days)} left</span>
  return <span>{formatTimeAgo(days)} left</span>
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

export default function ContractDetail({ contract, onBack, user, token, onBuyCredits }) {
  const days = daysLeft(contract.end_date)
  const [report, setReport] = useState(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState(null)
  const [watching, setWatching] = useState(false)
  const [watchLoading, setWatchLoading] = useState(false)

  // Auto-load cached report on mount
  useEffect(() => {
    if (!contract.piid) return
    fetch(`/api/reports/contract/${contract.piid}`)
      .then(r => r.json())
      .then(data => { if (data.found) setReport({ sections: data.sections, generated_at: data.generated_at }) })
      .catch(() => {})
  }, [contract.piid])

  async function generateReport() {
    if (!token) {
      setReportError('Please sign in to generate reports.')
      return
    }
    setReportLoading(true)
    setReportError(null)
    try {
      const res = await fetch('/api/member/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ piid: contract.piid })
      })
      const data = await res.json()
      if (res.status === 402) {
        setReportError('No credits remaining.')
        return
      }
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

  async function toggleWatch() {
    setWatchLoading(true)
    try {
      const res = await fetch('/api/watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ piid: contract.piid, action: watching ? 'unwatch' : 'watch' })
      })
      if (res.ok) {
        setWatching(!watching)
      }
    } catch (e) {
      console.error('Watch error:', e)
    } finally {
      setWatchLoading(false)
    }
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
                  <span className="field-label">Contract Type</span>
                  <span className="field-value">{contract.contract_type || '—'}</span>
                </div>
                <div className="field">
                  <span className="field-label">NAICS</span>
                  <span className="field-value">{contract.naics_code} {contract.naics_description ? `— ${contract.naics_description}` : ''}</span>
                </div>
                <div className="field">
                  <span className="field-label">PSC</span>
                  <span className="field-value">{contract.psc_code || '—'}{contract.psc_description ? ` — ${contract.psc_description}` : ''}</span>
                </div>
                {contract.solicitation_number && (
                  <div className="field">
                    <span className="field-label">Solicitation #</span>
                    <span className="field-value mono">
                      <a href={`https://sam.gov/search/?keywords=${contract.solicitation_number}&index=opp`}
                         target="_blank" rel="noreferrer"
                         style={{ color: 'var(--color-navy)' }}>
                        {contract.solicitation_number} ↗
                      </a>
                    </span>
                  </div>
                )}
                {contract.major_program && (
                  <div className="field">
                    <span className="field-label">Major Program</span>
                    <span className="field-value">{contract.major_program}</span>
                  </div>
                )}
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
                  <span className="field-value">{formatDate(contract.start_date)}</span>
                </div>
                <div className="field">
                  <span className="field-label">End Date</span>
                  <span className="field-value">{formatDate(contract.end_date)}</span>
                </div>
                <div className="field">
                  <span className="field-label">Days Remaining</span>
                  <span className="field-value" style={{ fontSize: 18, fontWeight: 700 }}>
                    <ExpiryLabel days={days} />
                  </span>
                </div>
                <div className="field">
                  <span className="field-label">Date Signed</span>
                  <span className="field-value">{formatDate(contract.date_signed)}</span>
                </div>
                <div className="field">
                  <span className="field-label">Last Modified</span>
                  <span className="field-value">{formatDate(contract.last_modified_date)}</span>
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
                  <span className="field-label">Competition Type {getFarExceptionField(contract.competition_type) && <InfoIcon field={getFarExceptionField(contract.competition_type)} />}</span>
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
                {contract.sole_source_authority && (
                  <div className="field">
                    <span className="field-label">Legal Basis</span>
                    <span className="field-value">{contract.sole_source_authority}</span>
                  </div>
                )}
                {contract.solicitation_procedures && (
                  <div className="field">
                    <span className="field-label">Solicitation Procedures</span>
                    <span className="field-value">{contract.solicitation_procedures}</span>
                  </div>
                )}
                {contract.commercial_item && (
                  <div className="field">
                    <span className="field-label">Commercial Item</span>
                    <span className="field-value">{contract.commercial_item}</span>
                  </div>
                )}
                {contract.subcontracting_plan && (
                  <div className="field">
                    <span className="field-label">Subcontracting Plan</span>
                    <span className="field-value">{contract.subcontracting_plan}</span>
                  </div>
                )}
                <div className="field">
                  <span className="field-label">Labor Standards</span>
                  <span className="field-value">{contract.labor_standards === true ? 'Yes' : contract.labor_standards === false ? 'No' : '—'}</span>
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
                  <span className="field-label">UEI <InfoIcon field="UEI" /></span>
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
                  <span className="field-label">Address</span>
                  <span className="field-value">
                    {[contract.recipient_address, contract.recipient_city, contract.recipient_state, contract.recipient_zip].filter(Boolean).join(', ') || '—'}
                  </span>
                </div>
                {contract.recipient_county && (
                  <div className="field">
                    <span className="field-label">County</span>
                    <span className="field-value">{contract.recipient_county}</span>
                  </div>
                )}
                {contract.recipient_congressional_district && (
                  <div className="field">
                    <span className="field-label">Congressional District</span>
                    <span className="field-value">
                      {contract.recipient_congress_url ? (
                        <a href={contract.recipient_congress_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-navy)' }}>
                          {contract.recipient_state}-{contract.recipient_congressional_district} — Contact your representative ↗
                        </a>
                      ) : (
                        `${contract.recipient_state}-${contract.recipient_congressional_district}`
                      )}
                    </span>
                  </div>
                )}
              </div>
              {contract.business_categories && (
                <div className="field mt-16">
                  <span className="field-label">Business Classifications</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {(Array.isArray(contract.business_categories)
                      ? contract.business_categories
                      : JSON.parse(contract.business_categories)
                    ).map(cat => (
                      <span key={cat} style={{
                        background: 'var(--color-bg)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 4,
                        padding: '2px 8px',
                        fontSize: 11,
                        color: 'var(--color-muted)'
                      }}>{cat}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Company Profile — only show if we have enriched data */}
            {(contract.is_public_company || contract.company_brief || contract.recipient_hq_city) && (
              <div className="card">
                <div className="section-title">Company Profile</div>
                <div className="field-grid">
                  {contract.recipient_hq_city && (
                    <div className="field">
                      <span className="field-label">Headquarters</span>
                      <span className="field-value">
                        {[contract.recipient_hq_address, contract.recipient_hq_city, contract.recipient_hq_state, contract.recipient_hq_zip].filter(Boolean).join(', ')}
                      </span>
                    </div>
                  )}
                  {contract.recipient_website && (
                    <div className="field">
                      <span className="field-label">Website</span>
                      <span className="field-value">
                        <a href={contract.recipient_website.startsWith('http') ? contract.recipient_website : `https://${contract.recipient_website}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-navy)' }}>
                          {contract.recipient_website.replace(/^https?:\/\//, '')} ↗
                        </a>
                      </span>
                    </div>
                  )}
                  {contract.is_public_company && (
                    <>
                      <div className="field">
                        <span className="field-label">Stock Ticker</span>
                        <span className="field-value mono">
                          <a href={`https://finance.yahoo.com/quote/${contract.stock_ticker}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-navy)' }}>
                            {contract.stock_ticker} ↗
                          </a>
                        </span>
                      </div>
                      {contract.market_cap && (
                        <div className="field">
                          <span className="field-label">Market Cap</span>
                          <span className="field-value mono">${(contract.market_cap / 1e9).toFixed(1)}B</span>
                        </div>
                      )}
                    </>
                  )}
                  {contract.employee_count && (
                    <div className="field">
                      <span className="field-label">Employees</span>
                      <span className="field-value">{contract.employee_count.toLocaleString()}</span>
                    </div>
                  )}
                  {contract.parent_name && (
                    <div className="field">
                      <span className="field-label">Parent Company</span>
                      <span className="field-value">{contract.parent_name}</span>
                    </div>
                  )}
                </div>
                {contract.company_brief && (
                  <p style={{ fontSize: 13, marginTop: 12, lineHeight: 1.6 }}>{contract.company_brief}</p>
                )}
                {contract.executive_compensation && (
                  <div style={{ marginTop: 16 }}>
                    <span className="field-label">Executive Leadership</span>
                    <div style={{ marginTop: 8 }}>
                      {(typeof contract.executive_compensation === 'string'
                        ? JSON.parse(contract.executive_compensation)
                        : contract.executive_compensation
                      ).slice(0, 5).map((exec, i) => (
                        <div key={i} style={{ fontSize: 12, marginBottom: 4 }}>
                          <span style={{ fontWeight: 500 }}>{exec.name}</span>
                          {exec.title && <span style={{ color: 'var(--color-muted)' }}> — {exec.title}</span>}
                          {exec.total_pay && <span style={{ color: 'var(--color-muted)' }}> · ${(exec.total_pay / 1e6).toFixed(1)}M</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Place of Performance */}
            {contract.pop_city && (
              <div className="card">
                <div className="section-title">Place of Performance</div>
                <p style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 12, fontStyle: 'italic' }}>
                  Where the work actually happens — may differ from contractor's home office.
                </p>
                <div className="field-grid">
                  <div className="field">
                    <span className="field-label">City / State</span>
                    <span className="field-value">{[contract.pop_city, contract.pop_state, contract.pop_zip].filter(Boolean).join(', ')}</span>
                  </div>
                  {contract.pop_county && (
                    <div className="field">
                      <span className="field-label">County</span>
                      <span className="field-value">{contract.pop_county}</span>
                    </div>
                  )}
                  {contract.pop_congressional_district && (
                    <div className="field">
                      <span className="field-label">Congressional District</span>
                      <span className="field-value">
                        {contract.pop_congress_url ? (
                          <a href={contract.pop_congress_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-navy)' }}>
                            {contract.pop_state}-{contract.pop_congressional_district} — Contact your representative ↗
                          </a>
                        ) : (
                          `${contract.pop_state}-${contract.pop_congressional_district}`
                        )}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Successor Contract — what replaced this when it ended */}
            {contract.successor_piid && (
              <div className="card" style={{ borderLeft: `3px solid ${contract.incumbent_retained ? 'var(--color-success)' : 'var(--color-danger)'}` }}>
                <div className="section-title">
                  {contract.incumbent_retained ? '✓ Contract Renewed' : '✗ Recompete Lost'}
                </div>
                <p style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 12, fontStyle: 'italic' }}>
                  {contract.incumbent_retained
                    ? 'The incumbent won the follow-on contract — continuity of service.'
                    : 'A different contractor won the recompete — potential disruption or improvement.'}
                </p>
                <div className="field-grid">
                  <div className="field">
                    <span className="field-label">Successor Contract</span>
                    <span className="field-value mono">
                      <a href={`https://www.usaspending.gov/search/?keywords=${contract.successor_piid}`}
                         target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-navy)' }}>
                        {contract.successor_piid} ↗
                      </a>
                    </span>
                  </div>
                  <div className="field">
                    <span className="field-label">New Awardee</span>
                    <span className="field-value fw-600">{contract.successor_recipient || '—'}</span>
                  </div>
                  <div className="field">
                    <span className="field-label">Successor Value</span>
                    <span className="field-value mono">{fmt(contract.successor_amount)}</span>
                  </div>
                  {contract.successor_start_date && (
                    <div className="field">
                      <span className="field-label">Successor Start</span>
                      <span className="field-value">{formatDate(contract.successor_start_date)}</span>
                    </div>
                  )}
                  <div className="field">
                    <span className="field-label">Match Confidence</span>
                    <span className="field-value">
                      {contract.successor_confidence >= 0.8 ? 'High' :
                       contract.successor_confidence >= 0.5 ? 'Medium' : 'Low'}
                      {' '}({Math.round(contract.successor_confidence * 100)}%)
                    </span>
                  </div>
                </div>
              </div>
            )}

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
                    Powered by Claude · 1 credit
                    {user && <span> · Balance: {user.credits ?? '?'}</span>}
                  </div>
                  {reportError && (
                    <div style={{ fontSize: 12, color: 'var(--color-danger)', marginBottom: 8 }}>
                      {reportError}
                      {reportError.includes('No credits') && onBuyCredits && (
                        <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={onBuyCredits}>
                          Buy Credits
                        </button>
                      )}
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
                    style={{ width: '100%', justifyContent: 'center', marginBottom: 8 }}
                    onClick={openPrint}
                  >
                    <FileText size={14} /> Print / Save PDF
                  </button>
                  <a
                    href={`/api/reports/csv/contract/${contract.piid}`}
                    className="btn btn-outline"
                    style={{ width: '100%', justifyContent: 'center', textDecoration: 'none' }}
                    download
                  >
                    <Download size={14} /> Download CSV
                  </a>
                </div>
              )}
            </div>

            {/* Watch for Recompete */}
            {days !== null && (
              <div className="card mt-16">
                <div className="section-title">Track This Contract</div>
                <p style={{ fontSize: 13, marginBottom: 12 }}>
                  {days > 0
                    ? `This contract expires in ${formatTimeAgo(days)}. Get notified when a recompete is posted.`
                    : `This contract has ended. Watch for the successor award.`}
                </p>
                <button
                  className={`btn ${watching ? 'btn-success' : 'btn-outline'}`}
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={toggleWatch}
                  disabled={watchLoading}
                >
                  {watching ? <BellRing size={14} /> : <Bell size={14} />}
                  {watching ? ' Watching — Click to Stop' : ' Watch for Recompete'}
                </button>
                {watching && (
                  <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 8 }}>
                    We'll email you when a recompete solicitation is posted on SAM.gov.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
