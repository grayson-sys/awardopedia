import { useState } from 'react'
import Nav from './components/Nav'
import ContractDetail from './components/ContractDetail'
import OpportunityDetail from './components/OpportunityDetail'
import './index.css'

// ── Mock data ──────────────────────────────────────────────────────────────
const MOCK_CONTRACT = {
  piid: 'FA8773-24-C-0001',
  award_id: 'CONT_AWD_FA877324C0001',
  agency_name: 'Dept of Defense',
  sub_agency_name: 'Department of the Air Force',
  office_name: 'AFRL/RKT',
  recipient_name: 'Apex Federal Solutions LLC',
  recipient_uei: 'AVNCM7K3JK59',
  recipient_city: 'Dayton',
  recipient_state: 'OH',
  recipient_zip: '45431',
  business_size: 'Small Business',
  is_small_business: true,
  award_amount: 12500000,
  base_amount: 10000000,
  ceiling_amount: 15000000,
  federal_obligation: 12500000,
  total_outlayed: 8200000,
  start_date: '2024-03-01',
  end_date: '2025-06-30',
  fiscal_year: 2024,
  naics_code: '541512',
  naics_description: 'Computer Systems Design Services',
  psc_code: 'D307',
  psc_description: 'IT and Telecom — IT Systems Development',
  contract_type: 'Cost Plus Fixed Fee',
  award_type: 'Definitive Contract',
  set_aside_type: 'Small Business Set-Aside',
  competition_type: 'Full and Open Competition',
  extent_competed: 'Full and Open Competition',
  number_of_offers: 4,
  contracting_officer: 'Maj. Sarah T. Mitchell',
  description: 'Systems engineering and technical assistance for advanced command and control software modernization. Scope includes architecture design, agile development, and integration testing for AFRL mission systems.',
  llama_summary: null, // Phase 3 placeholder
  usaspending_alive: true,
  report_generated: false,
}

const MOCK_OPPORTUNITY = {
  notice_id: 'W912ER25R0042',
  solicitation_number: 'W912ER-25-R-0042',
  title: 'Cybersecurity Assessment and Authorization Support Services',
  agency_name: 'Dept of Defense',
  sub_agency_name: 'U.S. Army Corps of Engineers',
  office_name: 'USACE Great Lakes & Ohio River Division',
  contracting_officer: 'Patricia A. Wentworth',
  contracting_officer_email: 'patricia.a.wentworth@usace.army.mil',
  contracting_officer_phone: '502-315-6770',
  naics_code: '541519',
  naics_description: 'Other Computer Related Services',
  psc_code: 'D302',
  notice_type: 'Solicitation',
  estimated_value_min: 5000000,
  estimated_value_max: 10000000,
  posted_date: '2025-03-05',
  response_deadline: '2025-04-15',
  archive_date: '2025-05-15',
  set_aside_type: 'Service-Disabled Veteran-Owned Small Business',
  contract_type: 'Firm Fixed Price',
  place_of_performance_city: 'Cincinnati',
  place_of_performance_state: 'OH',
  is_recompete: true,
  incumbent_name: 'CyberPoint International LLC',
  incumbent_uei: 'QJDMK9S7L3P1',
  description: 'Provide cybersecurity assessment, authorization, and continuous monitoring support for USACE IT systems in accordance with NIST 800-53 Rev 5 and DoD RMF requirements.',
  llama_summary: null,
  sam_url_alive: true,
}
// ──────────────────────────────────────────────────────────────────────────

function fmt(n) {
  if (!n) return '—'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function daysLeft(dateStr) {
  if (!dateStr) return null
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000)
}

function ExpiryCell({ dateStr, warnDays = 90, dangerDays = 30 }) {
  const days = daysLeft(dateStr)
  if (days === null) return <span>—</span>
  if (days < 0) return <span className="expiry-danger">{dateStr}</span>
  if (days <= dangerDays) return <span className="expiry-danger">{dateStr} ({days}d)</span>
  if (days <= warnDays) return <span className="expiry-warn">{dateStr} ({days}d)</span>
  return <span>{dateStr}</span>
}

export default function App() {
  const [view, setView] = useState('contracts') // 'contracts' | 'opportunities' | 'contract-detail' | 'opp-detail'

  return (
    <div>
      <Nav activePage={view === 'contracts' || view === 'contract-detail' ? 'contracts' : 'opportunities'} />

      <div className="page-header">
        <div className="container">
          {(view === 'contracts' || view === 'opportunities') && (
            <>
              <h1>
                {view === 'contracts' ? 'Federal Contracts' : 'Upcoming Opportunities'}
              </h1>
              <p>
                {view === 'contracts'
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
              Contracts
            </button>
            <button className={`tab ${view === 'opportunities' ? 'active' : ''}`} onClick={() => setView('opportunities')}>
              Opportunities
            </button>
          </div>
        </div>
      )}

      {/* ── Contracts table ── */}
      {view === 'contracts' && (
        <div className="container mt-16">
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
                <tr onClick={() => setView('contract-detail')}>
                  <td>
                    <div>{MOCK_CONTRACT.agency_name}</div>
                    <div className="text-muted text-sm">{MOCK_CONTRACT.sub_agency_name}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{MOCK_CONTRACT.recipient_name}</div>
                    <div className="piid">{MOCK_CONTRACT.piid}</div>
                  </td>
                  <td>
                    <span className="badge badge-muted">{MOCK_CONTRACT.naics_code}</span>
                  </td>
                  <td>{MOCK_CONTRACT.set_aside_type ? <span className="badge badge-navy">{MOCK_CONTRACT.set_aside_type}</span> : '—'}</td>
                  <td>{MOCK_CONTRACT.recipient_state}</td>
                  <td>
                    <ExpiryCell dateStr={MOCK_CONTRACT.end_date} />
                  </td>
                  <td>
                    <div className="amount">{fmt(MOCK_CONTRACT.award_amount)}</div>
                  </td>
                </tr>
              </tbody>
            </table>
            <div style={{ padding: '10px 16px', background: 'var(--color-navy-light)', fontSize: 12, color: 'var(--color-muted)', borderTop: '1px solid var(--color-border)' }}>
              Mock data — Phase 1 will populate with real USASpending records
            </div>
          </div>
        </div>
      )}

      {/* ── Opportunities table ── */}
      {view === 'opportunities' && (
        <div className="container mt-16">
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
                <tr onClick={() => setView('opp-detail')}>
                  <td>
                    <div>{MOCK_OPPORTUNITY.agency_name}</div>
                    <div className="text-muted text-sm">{MOCK_OPPORTUNITY.sub_agency_name}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 500, maxWidth: 280 }}>{MOCK_OPPORTUNITY.title}</div>
                    <div className="piid">{MOCK_OPPORTUNITY.notice_id}</div>
                  </td>
                  <td>
                    <span className="badge badge-muted">{MOCK_OPPORTUNITY.naics_code}</span>
                  </td>
                  <td>{MOCK_OPPORTUNITY.set_aside_type ? <span className="badge badge-navy" style={{ fontSize: 10 }}>{MOCK_OPPORTUNITY.set_aside_type}</span> : '—'}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{fmt(MOCK_OPPORTUNITY.estimated_value_max)}</td>
                  <td>
                    <ExpiryCell dateStr={MOCK_OPPORTUNITY.response_deadline} warnDays={14} dangerDays={5} />
                  </td>
                  <td>
                    {MOCK_OPPORTUNITY.is_recompete
                      ? <span className="badge badge-amber">RECOMPETE</span>
                      : <span className="badge badge-muted">New</span>}
                  </td>
                </tr>
              </tbody>
            </table>
            <div style={{ padding: '10px 16px', background: 'var(--color-navy-light)', fontSize: 12, color: 'var(--color-muted)', borderTop: '1px solid var(--color-border)' }}>
              Mock data — Phase 2 will populate with real SAM.gov records
            </div>
          </div>
        </div>
      )}

      {/* ── Detail views ── */}
      {view === 'contract-detail' && (
        <ContractDetail
          contract={MOCK_CONTRACT}
          onBack={() => setView('contracts')}
        />
      )}

      {view === 'opp-detail' && (
        <OpportunityDetail
          opp={MOCK_OPPORTUNITY}
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
