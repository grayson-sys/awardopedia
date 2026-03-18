import { useState, useEffect } from 'react'
import Nav from './components/Nav'
import ContractDetail from './components/ContractDetail'
import OpportunityDetail from './components/OpportunityDetail'
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

function ExpiryCell({ dateStr, warnDays = 90, dangerDays = 30 }) {
  if (!dateStr) return <span>—</span>
  const days = daysLeft(dateStr)
  const date = new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  const label = days != null ? `${date} (${days}d)` : date
  if (days == null) return <span>{date}</span>
  if (days < 0) return <span className="expiry-danger">{date} (expired)</span>
  if (days <= dangerDays) return <span className="expiry-danger">{label}</span>
  if (days <= warnDays) return <span className="expiry-warn">{label}</span>
  return <span>{label}</span>
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

  const activeTab = view === 'contracts' || view === 'contract-detail' ? 'contracts' : 'opportunities'

  return (
    <div>
      <Nav
        activePage={activeTab}
        onHome={() => setView('contracts')}
        onNavigate={(page) => {
          if (page === 'contracts' || page === 'opportunities') setView(page)
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
                    <th>Agency</th>
                    <th>Recipient</th>
                    <th>NAICS</th>
                    <th>Set-Aside</th>
                    <th>State</th>
                    <th>End Date</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {contracts.map(c => (
                    <tr key={c.piid} onClick={() => { setSelectedContract(c); setView('contract-detail') }}>
                      <td>
                        <div>{c.agency_name || '—'}</div>
                        {c.sub_agency_name && <div className="text-muted text-sm">{c.sub_agency_name}</div>}
                      </td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{c.recipient_name || '—'}</div>
                        <div className="piid">{c.piid}</div>
                      </td>
                      <td>{c.naics_code ? <span className="badge badge-muted">{c.naics_code}</span> : '—'}</td>
                      <td>{c.set_aside_type ? <span className="badge badge-navy" style={{ fontSize: 10 }}>{c.set_aside_type}</span> : '—'}</td>
                      <td>{c.recipient_state || '—'}</td>
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
                    <th>Agency</th>
                    <th>Title</th>
                    <th>NAICS</th>
                    <th>Set-Aside</th>
                    <th>Est. Value</th>
                    <th>Deadline</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {opportunities.map(o => (
                    <tr key={o.notice_id} onClick={() => { setSelectedOpp(o); setView('opp-detail') }}>
                      <td>{o.agency_name || '—'}</td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{o.title}</div>
                        <div className="piid">{o.notice_id}</div>
                      </td>
                      <td>{o.naics_code ? <span className="badge badge-muted">{o.naics_code}</span> : '—'}</td>
                      <td>{o.set_aside_type ? <span className="badge badge-navy" style={{ fontSize: 10 }}>{o.set_aside_type}</span> : '—'}</td>
                      <td className="mono" style={{ fontSize: 12 }}>{fmt(o.estimated_value_max)}</td>
                      <td><ExpiryCell dateStr={o.response_deadline} warnDays={14} dangerDays={5} /></td>
                      <td>{o.is_recompete
                        ? <span className="badge badge-amber">RECOMPETE</span>
                        : <span className="badge badge-muted">New</span>}
                      </td>
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

      {/* Footer */}
      {(view === 'contracts' || view === 'opportunities') && (
        <footer className="footer">
          <div className="container">
            <div className="footer-inner">
              <span><strong>Awardopedia</strong> — The encyclopedia of federal contract awards.</span>
              <span>Data from USASpending.gov and SAM.gov · <a href="#">API</a> · <a href="#">Terms</a></span>
            </div>
          </div>
        </footer>
      )}
    </div>
  )
}
