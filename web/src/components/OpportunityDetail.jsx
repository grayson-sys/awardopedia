import { useState, useEffect } from 'react'
import { ArrowLeft } from 'lucide-react'
import InfoIcon from './InfoIcon'
import { parseAgencyHierarchy } from '../utils/agencyNorm'
import { fmtAddress } from '../utils/fmtAddress'
import { toTitleCase } from '../utils/textNorm'

// ── Set-aside code → plain English ──────────────────────────────────────────
const SET_ASIDE_LABELS = {
  'SBA':       'Small Business Set-Aside',
  'SBP':       'Small Business Set-Aside',
  'SDVOSBC':   'Service-Disabled Veteran-Owned Small Business',
  'SDVOSB':    'Service-Disabled Veteran-Owned Small Business',
  'WOSBC':     'Women-Owned Small Business',
  'WOSB':      'Women-Owned Small Business',
  'EDWOSBC':   'Economically Disadvantaged Women-Owned Small Business',
  'EDWOSB':    'Economically Disadvantaged Women-Owned Small Business',
  'HZC':       'HUBZone Small Business',
  'HZS':       'HUBZone Small Business',
  '8AN':       '8(a) Sole Source (Minority-Owned)',
  '8A':        '8(a) Set-Aside (Minority-Owned)',
  'ISBEE':     'Indian Small Business Economic Enterprise',
  'BICiv':     'Buy Indian Set-Aside',
  'VSA':       'Veteran-Owned Small Business',
  'VSB':       'Veteran-Owned Small Business',
  'TOTAL':     'Total Small Business Set-Aside',
  'Small Business': 'Small Business Set-Aside',
}
function expandSetAside(raw) {
  if (!raw) return 'Full & Open Competition'
  return SET_ASIDE_LABELS[raw] || SET_ASIDE_LABELS[raw.toUpperCase()] || raw
}

// ── Report section config (standardized order) ─────────────────────────────
const REPORT_SECTIONS = [
  { key: 'executive_summary',    label: 'Executive Summary',           icon: '1' },
  { key: 'bid_recommendation',   label: 'Bid / No-Bid Recommendation', icon: '2' },
  { key: 'scope_of_work',        label: 'Scope of Work',              icon: '3' },
  { key: 'competitive_landscape', label: 'Competitive Landscape',      icon: '4' },
  { key: 'incumbent_analysis',   label: 'Incumbent & Recompete Analysis', icon: '5' },
  { key: 'pricing_analysis',     label: 'Pricing & Cost Analysis',     icon: '6' },
  { key: 'teaming_strategy',     label: 'Teaming Strategy',           icon: '7' },
  { key: 'risk_assessment',      label: 'Risk Assessment',            icon: '8' },
  { key: 'action_plan',          label: 'Action Plan',                icon: '9' },
]
// Legacy keys that map to the same sections
const LEGACY_MAP = {
  recompete_intelligence: 'incumbent_analysis',
  risk_factors: 'risk_assessment',
  action_items: 'action_plan',
}
function normalizeSections(raw) {
  const out = { ...raw }
  for (const [old, nw] of Object.entries(LEGACY_MAP)) {
    if (out[old] && !out[nw]) { out[nw] = out[old]; delete out[old] }
  }
  return out
}

// ── Render clean prose (paragraphs + numbered lists, no bold/markdown) ──────
function RenderProse({ text }) {
  if (!text) return null
  // Strip any residual markdown bold markers
  const clean = text.replace(/\*\*/g, '')
  // Split into paragraphs on double newlines or numbered list boundaries
  const blocks = clean.split(/\n{2,}|\n(?=\d+\.\s)/).filter(b => b.trim())
  return blocks.map((block, i) => {
    const trimmed = block.trim()
    // Numbered list item: "1. Something"
    const listMatch = trimmed.match(/^(\d+)\.\s+(.+)/s)
    if (listMatch) {
      return (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <span style={{ color: '#1B3A6B', minWidth: 20, flexShrink: 0 }}>{listMatch[1]}.</span>
          <span>{listMatch[2]}</span>
        </div>
      )
    }
    return <p key={i} style={{ marginBottom: 10 }}>{trimmed}</p>
  })
}

// ── Report modal — full-page overlay with cover page + spinning ─────────────

function ReportModal({ opp, onClose, token, onSignIn }) {
  const [status, setStatus] = useState('ready') // ready | generating | done | error
  const [report, setReport] = useState(null)
  const [error, setError] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const { agency } = parseAgencyHierarchy(opp.agency_name)

  useEffect(() => {
    if (status !== 'generating') return
    const t = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(t)
  }, [status])

  async function startGeneration(force = false) {
    setStatus('generating')
    setElapsed(0)
    setError(null)
    try {
      const endpoint = token ? '/api/member/reports/generate-opportunity' : '/api/reports/generate-opportunity-dev'
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ notice_id: opp.notice_id, force })
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Generation failed')
      const sections = typeof data.sections === 'string' ? JSON.parse(data.sections) : data.sections
      setReport({ ...data, sections })
      setStatus('done')
    } catch (e) {
      setError(e.message)
      setStatus('error')
    }
  }

  // Auto-check for cached report on mount
  useEffect(() => {
    fetch(`/api/reports/opportunity/${opp.notice_id}`)
      .then(r => r.json())
      .then(data => {
        if (data.found && data.sections) {
          const sections = typeof data.sections === 'string' ? JSON.parse(data.sections) : data.sections
          setReport({ sections, generated_at: data.generated_at })
          setStatus('done')
        }
      })
      .catch(() => {})
  }, [opp.notice_id])

  const stages = [
    { at: 0,  msg: 'Loading solicitation documents...' },
    { at: 8,  msg: 'Analyzing scope of work...' },
    { at: 18, msg: 'Drafting executive summary...' },
    { at: 28, msg: 'Evaluating bid/no-bid factors...' },
    { at: 40, msg: 'Assessing competitive landscape...' },
    { at: 55, msg: 'Analyzing pricing & cost drivers...' },
    { at: 70, msg: 'Drafting teaming strategy...' },
    { at: 85, msg: 'Compiling risk assessment...' },
    { at: 100, msg: 'Writing action plan...' },
    { at: 115, msg: 'Formatting final report...' },
  ]
  const currentStage = [...stages].reverse().find(s => elapsed >= s.at) || stages[0]
  // Estimate ~40 words/sec generation speed
  const estimatedWords = Math.min(Math.floor(elapsed * 40), 3000)
  const progressPct = Math.min(Math.round((elapsed / 120) * 100), 99)

  return (
    <div className="report-modal-overlay">
      <div className="report-modal">
        {/* Close button */}
        <button className="report-modal-close" onClick={onClose}>&times;</button>

        {/* ── Cover page / generating state ── */}
        {status !== 'done' && (
          <div className="report-cover">
            <div className="report-cover-inner">
              <div className="report-cover-logo">
                <img src="/logo-icon-navy-clean.jpg" alt="" width={40} height={40} style={{ borderRadius: 6 }} />
                <span>Award<em>opedia</em></span>
              </div>
              <div className="report-cover-type">Opportunity Intelligence Report</div>
              <h1 className="report-cover-title">{opp.title}</h1>
              <div className="report-cover-meta">
                <div>{agency}</div>
                <div>Solicitation: {opp.solicitation_number || opp.notice_id?.slice(0, 16)}</div>
                <div>{new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
              </div>

              {status === 'ready' && (
                <div className="report-cover-actions">
                  <p style={{ color: '#6B7280', marginBottom: 16, fontSize: 14 }}>
                    This report analyzes the full solicitation package including all attached documents, evaluation criteria, and competitive factors.
                  </p>
                  {token ? (
                    <button className="btn btn-amber" style={{ fontSize: 16, padding: '14px 32px' }} onClick={() => startGeneration(false)}>
                      Generate Report
                    </button>
                  ) : (
                    <button className="btn btn-amber" style={{ fontSize: 16, padding: '14px 32px' }} onClick={() => { onClose(); onSignIn && onSignIn() }}>
                      Sign In to Generate Report
                    </button>
                  )}
                </div>
              )}

              {status === 'generating' && (
                <div className="report-cover-actions">
                  <div className="report-spinner" />
                  <div style={{ color: '#1B3A6B', fontWeight: 600, fontSize: 15, marginTop: 20 }}>{currentStage.msg}</div>

                  {/* Progress bar */}
                  <div style={{ width: 280, height: 6, background: '#E2E4E9', borderRadius: 3, marginTop: 16, overflow: 'hidden' }}>
                    <div style={{ width: `${progressPct}%`, height: '100%', background: '#1B3A6B', borderRadius: 3, transition: 'width 1s linear' }} />
                  </div>

                  <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 13, color: '#9CA3AF' }}>
                    <span>~{estimatedWords.toLocaleString()} words generated</span>
                    <span>·</span>
                    <span>{elapsed}s / ~120s</span>
                  </div>

                  <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 16, maxWidth: 400, lineHeight: 1.5 }}>
                    Claude is reading the full solicitation package and writing a 9-section intelligence report. This typically takes about 2 minutes.
                  </div>
                </div>
              )}

              {status === 'error' && (
                <div className="report-cover-actions">
                  <div style={{ color: '#B91C1C', fontWeight: 600, marginBottom: 12 }}>Generation failed: {error}</div>
                  <button className="btn btn-ghost" onClick={() => startGeneration(false)}>Try Again</button>
                </div>
              )}
            </div>

            <div className="report-cover-footer">
              <div>Powered by Claude AI · Data from SAM.gov</div>
              <div>For informational purposes only · Not legal or bid-strategy advice</div>
            </div>
          </div>
        )}

        {/* ── Rendered report ── */}
        {status === 'done' && report?.sections && (() => {
          const s = normalizeSections(report.sections)
          return (
          <div className="report-document">
            {/* Header bar */}
            <div className="report-doc-header">
              <div className="report-doc-header-left">
                <img src="/logo-icon-navy-clean.jpg" alt="" width={24} height={24} style={{ borderRadius: 4 }} />
                <span style={{ fontWeight: 700, color: '#1B3A6B' }}>Awardopedia</span>
                <span style={{ color: '#9CA3AF', fontSize: 12 }}>Intelligence Report</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <a href={`/api/reports/csv/opportunity/${opp.notice_id}`} className="btn btn-ghost btn-sm" style={{ textDecoration: 'none' }} download>CSV</a>
                <button className="btn btn-ghost btn-sm" onClick={() => window.print()}>Print</button>
              </div>
            </div>

            {/* Title block */}
            <div className="report-doc-title-block">
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '1.5px', color: '#E9A820', fontWeight: 700, marginBottom: 6 }}>
                Opportunity Intelligence Report
              </div>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1B3A6B', lineHeight: 1.3, marginBottom: 8 }}>
                {opp.title}
              </h1>
              <div style={{ fontSize: 13, color: '#6B7280' }}>
                {agency} · {report.generated_at && new Date(report.generated_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </div>
            </div>

            {/* Quick reference table */}
            <div style={{ padding: '0 32px' }}>
              <table className="report-ref-table">
                <tbody>
                  <tr>
                    <td className="report-ref-label">Solicitation</td>
                    <td className="report-ref-value mono">{opp.solicitation_number || '—'}</td>
                    <td className="report-ref-label">Contracting Officer</td>
                    <td className="report-ref-value">{opp.contracting_officer || '—'}</td>
                  </tr>
                  <tr>
                    <td className="report-ref-label">Agency / Office</td>
                    <td className="report-ref-value">{agency}{opp.office_name ? ` — ${opp.office_name}` : ''}</td>
                    <td className="report-ref-label">CO Email</td>
                    <td className="report-ref-value">{opp.contracting_officer_email || '—'}</td>
                  </tr>
                  <tr>
                    <td className="report-ref-label">Set-Aside</td>
                    <td className="report-ref-value">{expandSetAside(opp.set_aside_type)}</td>
                    <td className="report-ref-label">CO Phone</td>
                    <td className="report-ref-value">{fmtPhone(opp.contracting_officer_phone) || '—'}</td>
                  </tr>
                  <tr>
                    <td className="report-ref-label">NAICS</td>
                    <td className="report-ref-value">{opp.naics_description ? toTitleCase(opp.naics_description) : '—'} <span className="text-muted">({opp.naics_code})</span></td>
                    <td className="report-ref-label">Posted</td>
                    <td className="report-ref-value">{fmtDate(opp.posted_date)}</td>
                  </tr>
                  <tr>
                    <td className="report-ref-label">Estimated Value</td>
                    <td className="report-ref-value">{opp.intel_estimated_value && opp.intel_estimated_value !== 'Not published' ? opp.intel_estimated_value : opp.estimated_value_max ? fmt(opp.estimated_value_max) : 'Not published'}</td>
                    <td className="report-ref-label">Deadline</td>
                    <td className="report-ref-value" style={{ fontWeight: 600 }}>{fmtDate(opp.response_deadline)}</td>
                  </tr>
                  <tr>
                    <td className="report-ref-label">Location</td>
                    <td className="report-ref-value">{fmtAddress(opp.performance_address, opp.place_of_performance_city, opp.place_of_performance_state) || '—'}</td>
                    <td className="report-ref-label">Award Basis</td>
                    <td className="report-ref-value">{opp.award_basis || '—'}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Report body — standardized sections */}
            <div className="report-doc-body">
              {REPORT_SECTIONS.map(({ key, label, icon }) => {
                const content = s[key]
                if (!content) return null
                const isHighlight = key === 'bid_recommendation'
                return (
                  <div key={key} className={`report-section ${isHighlight ? 'report-section-highlight' : ''}`}>
                    <h2><span className="report-section-num">{icon}</span> {label}</h2>
                    <div className="report-prose"><RenderProse text={content} /></div>
                  </div>
                )
              })}

              {s.attribution && (
                <div className="report-attribution">{s.attribution}</div>
              )}

              {/* Suggested research prompts */}
              <div className="report-section" style={{ marginTop: 24, borderTop: '2px solid var(--color-navy)', paddingTop: 20 }}>
                <h2>Continue Your Research</h2>
                <p style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 12 }}>
                  Copy these prompts into ChatGPT, Claude, or your preferred AI tool for deeper analysis:
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    `Who are the top contractors that have won ${opp.naics_description || opp.naics_code} contracts from ${agency} in the last 3 years? List company names, contract values, and locations.`,
                    `What are the typical evaluation factors and scoring weights for ${agency} ${opp.set_aside_type || ''} solicitations under NAICS ${opp.naics_code}? What does a winning technical approach look like?`,
                    opp.is_recompete && opp.incumbent_name
                      ? `Research ${opp.incumbent_name} — what federal contracts have they won recently? What are their strengths and weaknesses as an incumbent?`
                      : `What small businesses in ${opp.place_of_performance_state || 'this region'} specialize in ${opp.naics_description || 'this industry'}? Who would make a strong teaming partner?`,
                    `What are the biggest risks and common protest grounds for ${opp.psc_description || 'this type of'} federal contracts? What mistakes do small businesses typically make?`,
                    `Draft a technical approach outline for solicitation ${opp.solicitation_number || opp.notice_id?.slice(0,16)} — ${opp.title}. Focus on evaluation criteria and differentiators.`,
                  ].filter(Boolean).map((prompt, i) => (
                    <div key={i} className="research-prompt" onClick={() => navigator.clipboard?.writeText(prompt)}>
                      <div className="research-prompt-text">{prompt}</div>
                      <span className="research-prompt-copy">Copy</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="report-doc-footer">
              <div>Awardopedia.com · Free federal contract intelligence for small businesses</div>
              <div>Data sourced from SAM.gov · Analysis by Claude AI · For informational purposes only</div>
            </div>
          </div>
          )
        })()}
      </div>
    </div>
  )
}

// ── Formatting helpers ──────────────────────────────────────────────────────

function fmt(n) {
  if (!n) return '—'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function fmtDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d)) return dateStr
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function fmtPhone(raw) {
  if (!raw) return null
  const str = String(raw)
  const extMatch = str.match(/ext\.?\s*(\d+)/i)
  const ext = extMatch ? ` ext ${extMatch[1]}` : ''
  const d = str.replace(/ext\.?\s*\d+/i, '').replace(/\D/g, '')
  if (!d || /^0+$/.test(d)) return null
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}${ext}`
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}${ext}`
  return raw
}

function daysUntil(dateStr) {
  if (!dateStr) return null
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000)
}

function DeadlineLabel({ days }) {
  if (days === null) return <span>—</span>
  if (days < 0)  return <span className="expiry-danger">Closed {Math.abs(days)}d ago</span>
  if (days === 0) return <span className="expiry-danger">Closes today</span>
  if (days <= 7)  return <span className="expiry-warn">{days} days left</span>
  if (days <= 14) return <span className="expiry-warn">{days} days left</span>
  return <span>{days} days</span>
}

function sizeStandardMeta(raw) {
  if (!raw) return null
  const empMatch = raw.match(/([\d,]+)\s+employees?/i)
  if (empMatch) {
    const count = parseInt(empMatch[1].replace(/,/g, ''), 10)
    const n = count.toLocaleString()
    if (count < 100) return { emoji: '🐟', tooltip: `🐟 Minnow territory — reserved for very small companies with fewer than ${n} employees.` }
    if (count <= 750) return { emoji: '🐠', tooltip: `🐠 Small business set-aside for companies with up to ${n} employees.` }
    return { emoji: '🐳', tooltip: `🐳 Competition extends to companies with up to ${n} employees.` }
  }
  const m = raw.match(/\$?([\d.,]+)\s*(M|million|B|billion)?/i)
  if (!m) return null
  let amount = parseFloat(m[1].replace(/,/g, ''))
  const unit = (m[2] || '').toLowerCase()
  if (unit === 'b' || unit === 'billion') amount *= 1000
  const display = raw.trim()
  if (amount < 12) return { emoji: '🐟', tooltip: `🐟 Minnow territory — reserved for businesses earning less than ${display}/year.` }
  if (amount <= 30) return { emoji: '🐠', tooltip: `🐠 Small business set-aside for companies earning up to ${display}/year.` }
  return { emoji: '🐳', tooltip: `🐳 Competition extends to companies earning up to ${display}/year.` }
}

// ── Document tile ───────────────────────────────────────────────────────────

function DocTile({ att, index }) {
  const rawUrl = typeof att === 'string' ? att : att.url
  const name = typeof att === 'string' ? null : att.name
  const proxyUrl = `/api/proxy/attachment?url=${encodeURIComponent(rawUrl)}`
  const label = name || `Document ${index + 1}`
  const ext = (label.match(/\.(\w+)$/) || [])[1]?.toLowerCase()
  const isPdf = ext === 'pdf' || !ext
  const isDoc = ext === 'docx' || ext === 'doc'
  const isXls = ext === 'xlsx' || ext === 'xls' || ext === 'csv'
  const tileColor = isPdf ? '#dc3545' : isDoc ? '#2563EB' : isXls ? '#059669' : '#6B7280'
  const tileIcon = isPdf ? 'PDF' : isDoc ? 'DOC' : isXls ? 'XLS' : 'FILE'

  return (
    <a href={proxyUrl} target="_blank" rel="noopener noreferrer" className="doc-tile" title={label}>
      <div className="doc-tile-icon" style={{ background: tileColor }}><span>{tileIcon}</span></div>
      <div className="doc-tile-name">{label}</div>
    </a>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

export default function OpportunityDetail({ opp, onBack, user, token, onBuyCredits, onSignIn }) {
  const days = daysUntil(opp.response_deadline)
  const { agency, office: subAgency } = parseAgencyHierarchy(opp.agency_name)
  const [showReport, setShowReport] = useState(false)

  const hasPdfs = Array.isArray(opp.attachments) && opp.attachments.some(a => !a.type || a.type === 'file')

  return (
    <div>
      {showReport && <ReportModal opp={opp} token={token} onClose={() => setShowReport(false)} onSignIn={onSignIn} />}

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
            <span>{agency}{subAgency ? ` — ${subAgency}` : ''}</span>
            {opp.solicitation_number && <><span>·</span><span>Solicitation: {opp.solicitation_number}</span></>}
            <span>·</span>
            <span>Deadline: {fmtDate(opp.response_deadline)}</span>
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
                <p style={{ fontSize: 14, lineHeight: 1.7 }}>{opp.llama_summary}</p>
                <div className="text-muted text-sm mt-4">AI-generated summary · not bidding advice</div>
              </div>
            ) : (
              <div className="card" style={{ borderLeft: '3px solid var(--color-border)', marginBottom: 16 }}>
                <div className="section-title">AI Summary</div>
                <p className="text-muted text-sm">Summary pending — check back soon.</p>
              </div>
            )}

            {/* Overview */}
            <div className="card">
              <div className="section-title">Opportunity Overview</div>
              <div className="field-grid">
                <div className="field">
                  <span className="field-label">Solicitation # <InfoIcon field="SolicitationNumber" /></span>
                  <span className="field-value mono">{opp.solicitation_number || '—'}</span>
                </div>
                <div className="field">
                  <span className="field-label">Notice Type <InfoIcon field="NoticeType" /></span>
                  <span className="field-value">{opp.notice_type || '—'}</span>
                </div>
                <div className="field">
                  <span className="field-label">Industry <InfoIcon field="NAICS" /> {opp.naics_code && <span className="code-tag">{opp.naics_code}</span>}</span>
                  <span className="field-value">{opp.naics_description ? toTitleCase(opp.naics_description) : '—'}</span>
                </div>
                <div className="field">
                  <span className="field-label">Product/Service <InfoIcon field="PSC" /> {opp.psc_code && <span className="code-tag">{opp.psc_code}</span>}</span>
                  <span className="field-value">{opp.psc_description ? toTitleCase(opp.psc_description) : '—'}</span>
                </div>
                <div className="field">
                  <span className="field-label">Set-Aside <InfoIcon field="SetAside" /></span>
                  <span className="field-value">{expandSetAside(opp.set_aside_type)}</span>
                </div>
                {(() => {
                  const val = opp.estimated_value_min || opp.estimated_value_max
                    ? `${fmt(opp.estimated_value_min)} – ${fmt(opp.estimated_value_max)}`
                    : opp.intel_estimated_value && opp.intel_estimated_value !== 'Not published'
                      ? opp.intel_estimated_value : null
                  return (
                    <div className="field">
                      <span className="field-label">Estimated Value <InfoIcon field="EstValue" /></span>
                      {val
                        ? <span className="field-value mono" style={{ fontWeight: 600 }}>{val}</span>
                        : <span className="field-value text-muted">Not published</span>}
                    </div>
                  )
                })()}
              </div>
              {opp.description && !opp.description.startsWith('http') && (
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
                  <span className="field-value">{agency}</span>
                </div>
                {(subAgency || opp.sub_agency_name || opp.office_name) && (
                  <div className="field">
                    <span className="field-label">Office</span>
                    <span className="field-value">{opp.office_name || subAgency || opp.sub_agency_name}</span>
                  </div>
                )}
                <div className="field">
                  <span className="field-label">Contracting Officer <InfoIcon field="CO" /></span>
                  <span className="field-value fw-600">{opp.contracting_officer || '—'}</span>
                </div>
                <div className="field">
                  <span className="field-label">Email</span>
                  {opp.contracting_officer_email
                    ? <a href={`mailto:${opp.contracting_officer_email}`} style={{ fontSize: 13 }}>{opp.contracting_officer_email}</a>
                    : <span className="field-value text-muted">—</span>}
                </div>
                <div className="field">
                  <span className="field-label">Phone</span>
                  <span className="field-value">{fmtPhone(opp.contracting_officer_phone) || <span className="text-muted">Unavailable</span>}</span>
                </div>
              </div>
              {opp.alt_contact_name && (
                <>
                  <div style={{ borderTop: '1px solid var(--color-border)', margin: '16px 0' }} />
                  <div className="field-grid">
                    <div className="field">
                      <span className="field-label">Alternative Contact</span>
                      <span className="field-value fw-600">{opp.alt_contact_name}</span>
                    </div>
                    <div className="field">
                      <span className="field-label">Email</span>
                      {opp.alt_contact_email
                        ? <a href={`mailto:${opp.alt_contact_email}`} style={{ fontSize: 13 }}>{opp.alt_contact_email}</a>
                        : <span className="field-value text-muted">—</span>}
                    </div>
                    <div className="field">
                      <span className="field-label">Phone</span>
                      <span className="field-value">{fmtPhone(opp.alt_contact_phone) || <span className="text-muted">—</span>}</span>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Timeline */}
            <div className="card">
              <div className="section-title">Timeline</div>
              <div className="field-grid">
                <div className="field">
                  <span className="field-label">Posted <InfoIcon field="PostedDate" /></span>
                  <span className="field-value">{fmtDate(opp.posted_date)}</span>
                </div>
                <div className="field">
                  <span className="field-label">Response Deadline <InfoIcon field="ResponseDeadline" /></span>
                  <span className="field-value fw-600">{fmtDate(opp.response_deadline)}</span>
                </div>
                <div className="field">
                  <span className="field-label">Days to Respond</span>
                  <span className="field-value" style={{ fontSize: 18, fontWeight: 700 }}>
                    <DeadlineLabel days={days} />
                  </span>
                </div>
              </div>
            </div>

            {/* What they want */}
            <div className="card">
              <div className="section-title">What They Want &amp; How</div>
              <div className="field-grid">
                <div className="field">
                  {(() => {
                    const meta = sizeStandardMeta(opp.size_standard)
                    const blankTip = "We couldn't find the size standard in the solicitation documents. Check the SF-1449 form or contact the Contracting Officer to confirm eligibility."
                    return (<>
                      <span className="field-label">SBA Size Standard <InfoIcon text={meta?.tooltip || (!opp.size_standard ? blankTip : undefined)} /></span>
                      <span className="field-value">
                        {meta ? `${meta.emoji} ${opp.size_standard}` : opp.size_standard || <span className="text-muted">Not found in documents</span>}
                      </span>
                    </>)
                  })()}
                </div>
                <div className="field">
                  <span className="field-label">Contract Structure <InfoIcon field="ContractStructure" /></span>
                  <span className="field-value">{opp.contract_structure || '—'}</span>
                </div>
                <div className="field">
                  <span className="field-label">Award Basis <InfoIcon field="AwardBasis" /></span>
                  <span className="field-value">{opp.award_basis || '—'}</span>
                </div>
                <div className="field">
                  <span className="field-label">Place of Performance</span>
                  <span className="field-value">
                    {fmtAddress(opp.performance_address, opp.place_of_performance_city, opp.place_of_performance_state) || '—'}
                  </span>
                </div>
                {opp.wage_floor && (
                  <div className="field">
                    <span className="field-label">Prevailing Wage <InfoIcon field="WageDetermination" /></span>
                    <span className="field-value">{opp.wage_floor}</span>
                  </div>
                )}
                {opp.clearance_required && (
                  <div className="field">
                    <span className="field-label">Security Clearance</span>
                    <span className="field-value" style={{ color: 'var(--color-danger)', fontWeight: 600 }}>Required</span>
                  </div>
                )}
                {opp.sole_source && (
                  <div className="field">
                    <span className="field-label">Competition Restriction <InfoIcon text="This solicitation contains brand-name-only or sole-source language — meaning at least part of the work is restricted to a specific vendor or product. Read the solicitation carefully: sometimes the restriction applies to specific equipment (e.g. a particular fire alarm brand) rather than the entire contract. If the contract is also set aside for small businesses, you can still compete for the overall award." /></span>
                    <span className="field-value" style={{ color: 'var(--color-amber)', fontWeight: 600 }}>
                      Brand Name / Sole Source Language Detected
                    </span>
                    <span className="text-muted text-sm">Check the solicitation — this may apply to specific components, not the full contract</span>
                  </div>
                )}
                {opp.congressional_district && (
                  <div className="field">
                    <span className="field-label">Congressional District <InfoIcon field="CongressionalDistrict" /></span>
                    <span className="field-value">
                      {opp.congress_member_url
                        ? <a href={opp.congress_member_url} target="_blank" rel="noopener noreferrer">{opp.congressional_district} — Contact your representative ↗</a>
                        : opp.congressional_district}
                    </span>
                  </div>
                )}
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

            {/* Documents & Links — with ZIP download next to document count */}
            <div className="card">
              <div className="section-title">Documents &amp; Links</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {(() => {
                  const atts = Array.isArray(opp.attachments) ? opp.attachments : []
                  const fileAtts = atts.filter(a => !a.type || a.type === 'file')
                  const linkAtts = atts.filter(a => a.type === 'link')
                  return (
                    <>
                      {fileAtts.length > 0 && (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                            <span style={{ fontSize: 11, color: 'var(--color-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                              Documents ({fileAtts.length})
                            </span>
                            <a
                              href={`/api/reports/opportunity-pdfs/${opp.notice_id}`}
                              className="btn btn-ghost btn-sm"
                              style={{ textDecoration: 'none', padding: '2px 8px', fontSize: 11 }}
                            >
                              Download all (.zip)
                            </a>
                          </div>
                          <div className="doc-tiles">
                            {fileAtts.map((att, i) => <DocTile key={`file-${i}`} att={att} index={i} />)}
                          </div>
                        </div>
                      )}
                      {linkAtts.length > 0 && (
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--color-muted)', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            Related Links ({linkAtts.length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {linkAtts.map((lnk, i) => (
                              <a key={`link-${i}`} href={lnk.url} target="_blank" rel="noopener noreferrer"
                                style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 14 }}>🔗</span>
                                {lnk.name || 'External Link'}
                                <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>↗</span>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                      {fileAtts.length === 0 && linkAtts.length === 0 && (
                        <div style={{ fontSize: 13, color: 'var(--color-muted)', padding: '4px 0' }}>
                          No documents available — check SAM.gov for the full solicitation package.
                        </div>
                      )}
                    </>
                  )
                })()}
                {opp.sam_url_alive !== false ? (
                  <a href={opp.sam_url || `https://sam.gov/opp/${opp.notice_id}/view`} target="_blank" rel="noopener noreferrer" className="btn btn-navy btn-sm" style={{ alignSelf: 'flex-start' }}>
                    View full solicitation on SAM.gov ↗
                  </a>
                ) : (
                  <div className="trust-box">
                    This opportunity may have been archived.{' '}
                    <a href={`https://sam.gov/search/?keywords=${opp.notice_id}`} target="_blank" rel="noopener noreferrer">Search SAM.gov →</a>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div>
            <div className="trust-box">
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Source</div>
              This opportunity is sourced from SAM.gov, the official US federal contracting portal.
              <div style={{ marginTop: 10, fontSize: 11, color: 'var(--color-muted)' }}>
                <div>Notice ID</div>
                <div className="mono" style={{ fontSize: 10, wordBreak: 'break-all', marginTop: 2 }}>{opp.notice_id}</div>
              </div>
            </div>

            <div className="card mt-16">
              <div className="section-title">Intelligence Report</div>
              <p style={{ fontSize: 13, marginBottom: 12 }}>
                Full deep-dive analysis: bid/no-bid recommendation, competitive landscape, teaming strategy, risk factors, and specific action items.
              </p>
              <button
                className="btn btn-amber"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => setShowReport(true)}
              >
                Open Report
              </button>
            </div>

            <FeedbackForm noticeId={opp.notice_id} />
          </div>
        </div>
      </div>
    </div>
  )
}

function FeedbackForm({ noticeId }) {
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)

  function handleSubmit(e) {
    e.preventDefault()
    if (!message.trim()) return
    fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notice_id: noticeId, message: message.trim(), email: email.trim() || null })
    }).catch(() => {})
    setSubmitted(true)
  }

  if (submitted) {
    return (
      <div className="card mt-16" style={{ textAlign: 'center', padding: '16px' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-success)' }}>Thanks for the feedback.</div>
        <div className="text-muted text-sm mt-4">We read every submission.</div>
      </div>
    )
  }

  return (
    <div className="card mt-16">
      <div className="section-title">Report an Issue</div>
      <p style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 10 }}>
        See something wrong? Missing data? Have a feature idea?
      </p>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <textarea value={message} onChange={e => setMessage(e.target.value)}
          placeholder="What's wrong or what would make this better?" rows={3}
          style={{ width: '100%', padding: '8px 10px', fontSize: 13, fontFamily: 'inherit',
            border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', resize: 'vertical', outline: 'none' }} />
        <input type="email" value={email} onChange={e => setEmail(e.target.value)}
          placeholder="Email (optional, if you want a response)"
          style={{ width: '100%', padding: '8px 10px', fontSize: 13, fontFamily: 'inherit',
            border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', outline: 'none' }} />
        <button type="submit" className="btn btn-ghost btn-sm" disabled={!message.trim()} style={{ alignSelf: 'flex-start' }}>
          Send Feedback
        </button>
      </form>
    </div>
  )
}
