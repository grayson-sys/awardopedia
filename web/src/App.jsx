import { useState, useEffect } from 'react'
import Nav from './components/Nav'
import ContractDetail from './components/ContractDetail'
import OpportunityDetail from './components/OpportunityDetail'
import InfoIcon from './components/InfoIcon'
import Terms from './pages/Terms'
import ApiKeys from './pages/ApiKeys'
import './index.css'

// ── Helpers ────────────────────────────────────────────────────────────────
function fmt(n) {
  if (n == null) return '—'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function daysLeft(dateStr) {
  if (!dateStr) return null
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000)
}

function dateColor(dateStr) {
  const days = daysLeft(dateStr)
  if (days == null) return undefined
  if (days < 0) return '#dc3545'         // past → red
  if (days < 183) return '#E9A820'       // < ~6 months → amber
  return '#28a745'                        // 6+ months → green
}

function ExpiryCell({ dateStr }) {
  if (!dateStr) return <span>—</span>
  const date = new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  const color = dateColor(dateStr)
  return <span style={color ? { color } : undefined}>{date}</span>
}

// ── App ────────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState('contracts') // 'contracts' | 'opportunities' | 'contract-detail' | 'opp-detail'
  const [selectedContract, setSelectedContract] = useState(null)
  const [selectedOpp, setSelectedOpp] = useState(null)

  const [contracts, setContracts] = useState([])
  const [opportunities, setOpportunities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function load() {
      try {
        setLoading(true)
        setError(null)
        const [cRes, oRes] = await Promise.all([
          fetch('/api/contracts'),
          fetch('/api/opportunities'),
        ])
        if (!cRes.ok) throw new Error(`Contracts API: ${cRes.status}`)
        const cData = await cRes.json()
        setContracts(cData.data || [])

        if (oRes.ok) {
          const oData = await oRes.json()
          setOpportunities(oData.data || [])
        }
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const activeTab = view === 'contracts' || view === 'contract-detail' ? 'contracts'
    : view === 'opportunities' || view === 'opp-detail' ? 'opportunities'
    : view === 'api' ? 'api'
    : view === 'terms' ? 'terms'
    : 'contracts'

  return (
    <div>
      <Nav
        activePage={activeTab}
        onHome={() => setView('contracts')}
        onNavigate={(page) => {
          if (['contracts', 'opportunities', 'api', 'terms'].includes(page)) setView(page)
        }}
      />

      {/* Page header */}
      <div className="page-header">
        <div className="container">
          {(view === 'contracts' || view === 'opportunities') && (
            <>
              <h1>{view === 'contracts' ? 'Federal Contracts' : 'Upcoming Opportunities'}</h1>
              <p>{view === 'contracts'
                ? 'Awarded federal contracts from USASpending.gov'
                : 'Open solicitations from SAM.gov'}
              </p>
            </>
          )}
        </div>
      </div>

      {/* Tab strip */}
      {(view === 'contracts' || view === 'opportunities') && (
        <div className="container">
          <div className="tabs mt-16">
            <button className={`tab ${view === 'contracts' ? 'active' : ''}`} onClick={() => setView('contracts')}>
              Contracts {contracts.length > 0 && <span style={{ marginLeft: 4, fontSize: 11, opacity: 0.7 }}>({contracts.length})</span>}
            </button>
            <button className={`tab ${view === 'opportunities' ? 'active' : ''}`} onClick={() => setView('opportunities')}>
              Opportunities {opportunities.length > 0 && <span style={{ marginLeft: 4, fontSize: 11, opacity: 0.7 }}>({opportunities.length})</span>}
            </button>
          </div>
        </div>
      )}

      {/* ── Contracts table ── */}
      {view === 'contracts' && (
        <div className="container mt-16">
          {loading && <div className="text-muted" style={{ padding: '24px 0' }}>Loading contracts...</div>}
          {error && <div style={{ padding: '24px 0', color: 'var(--color-danger)' }}>Error: {error}</div>}
          {!loading && !error && contracts.length === 0 && (
            <div className="text-muted" style={{ padding: '24px 0' }}>No contracts yet.</div>
          )}
          {!loading && contracts.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Agency <InfoIcon field="Agency" /></th>
                    <th>NAICS <InfoIcon field="NAICS" /></th>
                    <th>State <InfoIcon field="State" /></th>
                    <th>Start Date <InfoIcon field="StartDate" /></th>
                    <th>End Date <InfoIcon field="EndDate" /></th>
                    <th style={{ textAlign: 'right' }}>Amount <InfoIcon field="Amount" /></th>
                  </tr>
                </thead>
                <tbody>
                  {contracts.map(c => (
                    <tr key={c.piid} onClick={() => { setSelectedContract(c); setView('contract-detail') }}>
                      <td>
                        <div>{c.agency_name || '—'}</div>
                        {c.sub_agency_name && <div className="text-muted text-sm">{c.sub_agency_name}</div>}
                      </td>
                      <td>{c.naics_code ? `${c.naics_code} — ${c.naics_description || ''}`.trim() : '—'}</td>
                      <td>{c.recipient_state || '—'}</td>
                      <td><ExpiryCell dateStr={c.start_date} /></td>
                      <td><ExpiryCell dateStr={c.end_date} /></td>
                      <td><div className="amount">{fmt(c.award_amount)}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Opportunities table ── */}
      {view === 'opportunities' && (
        <div className="container mt-16">
          {loading && <div className="text-muted" style={{ padding: '24px 0' }}>Loading opportunities...</div>}
          {!loading && opportunities.length === 0 && (
            <div className="text-muted" style={{ padding: '24px 0' }}>
              No opportunities yet — Phase 2 will fetch from SAM.gov.
            </div>
          )}
          {!loading && opportunities.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Agency <InfoIcon field="Agency" /></th>
                    <th>NAICS <InfoIcon field="NAICS" /></th>
                    <th>State <InfoIcon field="State" /></th>
                    <th>Posted <InfoIcon field="PostedDate" /></th>
                    <th>Deadline <InfoIcon field="ResponseDeadline" /></th>
                    <th style={{ textAlign: 'right' }}>Est. Value <InfoIcon field="EstValue" /></th>
                  </tr>
                </thead>
                <tbody>
                  {opportunities.map(o => (
                    <tr key={o.notice_id} onClick={() => { setSelectedOpp(o); setView('opp-detail') }}>
                      <td>
                        <div>{o.agency_name || '—'}</div>
                        {o.sub_agency_name && <div className="text-muted text-sm">{o.sub_agency_name}</div>}
                      </td>
                      <td>{o.naics_code ? `${o.naics_code} — ${o.naics_description || ''}`.trim() : '—'}</td>
                      <td>{o.place_of_performance_state || '—'}</td>
                      <td><ExpiryCell dateStr={o.posted_date} /></td>
                      <td><ExpiryCell dateStr={o.response_deadline} /></td>
                      <td><div className="amount">{fmt(o.estimated_value_max)}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Detail views ── */}
      {view === 'contract-detail' && selectedContract && (
        <ContractDetail
          contract={selectedContract}
          onBack={() => setView('contracts')}
        />
      )}
      {view === 'opp-detail' && selectedOpp && (
        <OpportunityDetail
          opp={selectedOpp}
          onBack={() => setView('opportunities')}
        />
      )}

      {/* ── API Keys page ── */}
      {view === 'api' && (
        <ApiKeys onBack={(target) => {
          if (target === 'terms') setView('terms')
          else setView('contracts')
        }} />
      )}

      {/* ── Terms page ── */}
      {view === 'terms' && (
        <Terms onBack={() => setView('contracts')} />
      )}

      {/* Footer */}
      {(view === 'contracts' || view === 'opportunities') && (
        <footer className="footer">
          <div className="container">
            <div className="footer-inner">
              <span><strong>Awardopedia</strong> — The encyclopedia of federal contract awards.</span>
              <span>Data from USASpending.gov and SAM.gov · <a href="#" onClick={(e) => { e.preventDefault(); setView('api') }}>API</a> · <a href="#" onClick={(e) => { e.preventDefault(); setView('terms') }}>Terms</a></span>
            </div>
          </div>
        </footer>
      )}
    </div>
  )
}
