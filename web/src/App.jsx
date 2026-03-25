import { useState, useEffect, useMemo, useRef } from 'react'
import Nav from './components/Nav'
import ContractDetail from './components/ContractDetail'
import OpportunityDetail from './components/OpportunityDetail'
import InfoIcon from './components/InfoIcon'
import Terms from './pages/Terms'
import ApiKeys from './pages/ApiKeys'
import Admin from './pages/Admin'
import Auth from './pages/Auth'
import Credits from './pages/Credits'
import Jurisdictions from './pages/Jurisdictions'
import { topAgencyLabel as topAgency } from './utils/agencyNorm'
import { toTitleCase } from './utils/textNorm'
import './index.css'

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n) {
  if (n == null) return '—'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function fmtOppValue(o) {
  if (o.estimated_value_max) return fmt(o.estimated_value_max)
  if (o.intel_estimated_value && o.intel_estimated_value !== 'Not published') return o.intel_estimated_value
  return '—'
}

function daysLeft(dateStr) {
  if (!dateStr) return null
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000)
}

function dateColor(dateStr) {
  const d = daysLeft(dateStr)
  if (d == null) return undefined
  if (d < 0) return '#dc3545'       // past → red
  if (d < 90) return '#E9A820'      // today through 3 months → yellow
  return '#28a745'                    // 3+ months → green
}

function ExpiryCell({ dateStr }) {
  if (!dateStr) return <span style={{ color: '#aab' }}>—</span>
  const date = new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
  const color = dateColor(dateStr)
  return <span style={color ? { color, fontWeight: 500 } : undefined}>{date}</span>
}

function DeadlineBadge({ dateStr }) {
  const d = daysLeft(dateStr)
  if (d == null) return null
  if (d < 0) return <span className="badge badge-danger">Closed</span>
  if (d === 0) return <span className="badge badge-danger">Closes today</span>
  if (d <= 7) return <span className="badge badge-danger">{d}d left</span>
  if (d <= 30) return <span className="badge badge-amber">{d}d left</span>
  return null
}

// Set-aside code → plain English (same map as OpportunityDetail)
const SET_ASIDE_LABELS = {
  'SBA':       'Small Business',
  'SBP':       'Small Business',
  'SDVOSBC':   'Service-Disabled Veteran-Owned',
  'SDVOSB':    'Service-Disabled Veteran-Owned',
  'WOSBC':     'Women-Owned Small Business',
  'WOSB':      'Women-Owned Small Business',
  'EDWOSBC':   'Econ. Disadvantaged Women-Owned',
  'EDWOSB':    'Econ. Disadvantaged Women-Owned',
  'HZC':       'HUBZone',
  'HZS':       'HUBZone',
  '8AN':       '8(a) (Minority-Owned)',
  '8A':        '8(a) (Minority-Owned)',
  'VSA':       'Veteran-Owned',
  'VSB':       'Veteran-Owned',
  'TOTAL':     'Total Small Business',
  'Small Business': 'Small Business',
}
function expandSetAside(raw) {
  if (!raw) return null
  return SET_ASIDE_LABELS[raw] || SET_ASIDE_LABELS[raw.toUpperCase()] || raw
}

// Build unique sorted option lists from data
function uniqueVals(arr, key, transform) {
  const set = new Set()
  for (const item of arr) {
    let v = item[key]
    if (v != null && v !== '') {
      if (transform) v = transform(v)
      set.add(v)
    }
  }
  return [...set].sort()
}

// ── Pagination ─────────────────────────────────────────────────────────────
function Pagination({ total, page, pageSize, onChange }) {
  const totalPages = Math.ceil(total / pageSize)
  if (totalPages <= 1) return null
  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  // Generate page options for dropdown
  const pageOptions = []
  for (let i = 1; i <= totalPages; i++) pageOptions.push(i)

  return (
    <div className="pagination">
      <span className="text-muted text-sm">Showing {start}–{end} of {total}</span>
      <div className="pagination-btns">
        <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => onChange(1)} title="First page">&laquo;</button>
        <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>Prev</button>
        <select
          value={page}
          onChange={e => onChange(Number(e.target.value))}
          style={{ padding: '4px 8px', fontSize: 13, border: '1px solid #E2E4E9', borderRadius: 4, margin: '0 4px' }}
        >
          {pageOptions.map(p => <option key={p} value={p}>Page {p}</option>)}
        </select>
        <span className="text-sm text-muted" style={{ padding: '0 4px' }}>of {totalPages}</span>
        <button className="btn btn-ghost btn-sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>Next</button>
        <button className="btn btn-ghost btn-sm" disabled={page >= totalPages} onClick={() => onChange(totalPages)} title="Last page">&raquo;</button>
      </div>
    </div>
  )
}

// ── US States + territories + military codes ──────────────────────────────
const US_STATES = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',
  CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',
  GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',
  IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',
  MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',
  MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',
  NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',
  OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',
  SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',
  VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',
  // Territories
  GU:'Guam',PR:'Puerto Rico',VI:'U.S. Virgin Islands',AS:'American Samoa',MP:'Northern Mariana Islands',
  // Military
  AE:'Armed Forces Europe',AP:'Armed Forces Pacific',AA:'Armed Forces Americas',
  // Foreign (SAM.gov uses ISO country codes in place_of_performance_state)
  PH:'Philippines',DE:'Germany',JP:'Japan',KR:'South Korea',IT:'Italy',
  GB:'United Kingdom',AU:'Australia',MX:'Mexico',BG:'Bulgaria',RO:'Romania',
  KW:'Kuwait',QA:'Qatar',BH:'Bahrain',JO:'Jordan',IQ:'Iraq',TR:'Turkey',
  ES:'Spain',BE:'Belgium',NL:'Netherlands',NO:'Norway',PL:'Poland',GR:'Greece',
}
function stateName(code) { return US_STATES[code] || code || '—' }

// ── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [view, setView] = useState('home')
  const [selectedContract, setSelectedContract] = useState(null)
  const [selectedOpp, setSelectedOpp] = useState(null)

  const [contracts, setContracts] = useState([])
  const [opportunities, setOpportunities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Auth
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(() => localStorage.getItem('token'))

  // Restore session on mount
  useEffect(() => {
    if (!token) return
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => setUser(data))
      .catch(() => { localStorage.removeItem('token'); setToken(null) })
  }, [token])

  function handleLogin(member, newToken) {
    setUser(member)
    setToken(newToken)
    setView('home')
  }

  function handleLogout() {
    localStorage.removeItem('token')
    setUser(null)
    setToken(null)
    setView('home')
  }

  // Search & filters
  const [query, setQuery] = useState('')
  const [activeTab, setActiveTab] = useState('opportunities') // default to opportunities
  const [filterState, setFilterState] = useState('')
  const [filterSetAside, setFilterSetAside] = useState('')
  const [filterNaics, setFilterNaics] = useState('')
  const [filterAgency, setFilterAgency] = useState('')
  const [filterDataSource, setFilterDataSource] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const PAGE_SIZE = 50
  const [totalContracts, setTotalContracts] = useState(0)
  const [totalOpportunities, setTotalOpportunities] = useState(0)
  const [hasMoreContracts, setHasMoreContracts] = useState(false)
  const [hasMoreOpportunities, setHasMoreOpportunities] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const searchRef = useRef(null)

  // Build query string from filters
  const buildQuery = (extra = {}) => {
    const params = new URLSearchParams()
    if (filterState) params.set('state', filterState)
    if (filterAgency) params.set('agency', filterAgency)
    if (filterNaics) params.set('naics', filterNaics)
    if (filterSetAside) params.set('set_aside', filterSetAside)
    if (filterDataSource) params.set('data_source', filterDataSource)
    if (query) params.set('q', query)
    Object.entries(extra).forEach(([k, v]) => params.set(k, v))
    return params.toString()
  }

  // ── Data loading (paginated) ────────────────────────────────────────────
  async function loadData(append = false) {
    try {
      if (!append) setLoading(true)
      else setLoadingMore(true)
      setError(null)

      const offset = append ? (activeTab === 'opportunities' ? opportunities.length : contracts.length) : 0
      const qs = buildQuery({ limit: PAGE_SIZE, offset })

      if (activeTab === 'opportunities') {
        const res = await fetch(`/api/opportunities?${qs}`)
        if (!res.ok) throw new Error(`Opportunities API: ${res.status}`)
        const data = await res.json()
        setOpportunities(append ? [...opportunities, ...data.data] : data.data)
        setTotalOpportunities(data.meta.total)
        setHasMoreOpportunities(data.meta.hasMore)
      } else {
        const res = await fetch(`/api/contracts?${qs}`)
        if (!res.ok) throw new Error(`Contracts API: ${res.status}`)
        const data = await res.json()
        setContracts(append ? [...contracts, ...data.data] : data.data)
        setTotalContracts(data.meta.total)
        setHasMoreContracts(data.meta.hasMore)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  // Load data when on results view, or when filters/tabs change
  useEffect(() => {
    // Only load data if we're in results view (not home)
    // Note: query changes don't auto-trigger - user must click Search or press Enter
    if (view === 'results') {
      loadData(false)
    }
  }, [view, activeTab, filterState, filterAgency, filterNaics, filterSetAside, filterDataSource])

  // Deep-link support (on mount only)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const oppId = params.get('opp')
    const contractId = params.get('contract')
    if (oppId) {
      fetch(`/api/opportunities/${oppId}`)
        .then(r => r.ok ? r.json() : null)
        .then(opp => { if (opp) { setSelectedOpp(opp); setView('opp-detail') } })
        .catch(() => {})
    } else if (contractId) {
      fetch(`/api/contracts/${contractId}`)
        .then(r => r.ok ? r.json() : null)
        .then(c => { if (c) { setSelectedContract(c); setView('contract-detail') } })
        .catch(() => {})
    }
  }, [])

  // ── Filter options (derived from data) ─────────────────────────────────
  const stateOptions = useMemo(() => {
    const states = new Set()
    contracts.forEach(c => { if (c.recipient_state) states.add(c.recipient_state) })
    opportunities.forEach(o => { if (o.place_of_performance_state) states.add(o.place_of_performance_state) })
    return [...states].filter(s => US_STATES[s]).sort()
  }, [contracts, opportunities])

  const setAsideOptions = useMemo(() => {
    const vals = new Set()
    contracts.forEach(c => { if (c.set_aside_type) vals.add(c.set_aside_type) })
    opportunities.forEach(o => { if (o.set_aside_type) vals.add(o.set_aside_type) })
    return [...vals].sort()
  }, [contracts, opportunities])

  const agencyOptions = useMemo(() => {
    const vals = new Set()
    contracts.forEach(c => vals.add(topAgency(c.agency_name)))
    opportunities.forEach(o => vals.add(topAgency(o.agency_name)))
    vals.delete('—')
    return [...vals].sort()
  }, [contracts, opportunities])

  const naicsOptions = useMemo(() => {
    const map = new Map()
    const addNaics = (code, desc) => {
      if (code && !map.has(code)) {
        map.set(code, desc ? toTitleCase(desc) : code)
      }
    }
    contracts.forEach(c => addNaics(c.naics_code, c.naics_description))
    opportunities.forEach(o => addNaics(o.naics_code, o.naics_description))
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [contracts, opportunities])

  // ── Filtering logic ────────────────────────────────────────────────────
  const q = query.toLowerCase().trim()

  // Server does filtering now - just use data directly
  const filteredContracts = contracts
  const filteredOpportunities = opportunities

  const hasActiveFilters = filterState || filterSetAside || filterNaics || filterAgency || filterDataSource
  const clearFilters = () => { setFilterState(''); setFilterSetAside(''); setFilterNaics(''); setFilterAgency(''); setFilterDataSource('') }

  // History management for back button
  useEffect(() => {
    const handlePopState = () => {
      // On back button, return to list view
      setView('list')
      setSelectedOpp(null)
      setSelectedContract(null)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // ── Navigation helpers ─────────────────────────────────────────────────
  function goSearch() {
    // Auto-select the tab that has results for the current query
    if (q) {
      const oppCount = filteredOpportunities.length
      const conCount = filteredContracts.length
      if (oppCount === 0 && conCount > 0) setActiveTab('contracts')
      else if (conCount === 0 && oppCount > 0) setActiveTab('opportunities')
      // If both have results, keep current tab
    }
    setView('results')
  }

  async function openContract(c) {
    // Set initial data from list, then fetch full details with company profile
    setSelectedContract(c)
    setView('contract-detail')
    window.history.pushState({ view: 'contract-detail', id: c.piid }, '', `?contract=${c.piid}`)

    // Fetch full contract details (includes recipient enrichment)
    try {
      const res = await fetch(`/api/contracts/${c.piid}`)
      if (res.ok) {
        const full = await res.json()
        setSelectedContract(full)
      }
    } catch (e) {
      console.error('Error fetching contract details:', e)
    }
  }

  function openOpp(o) {
    setSelectedOpp(o)
    setView('opp-detail')
    window.history.pushState({ view: 'opp-detail', id: o.notice_id }, '', `?opp=${o.notice_id}`)
  }

  function goHome() {
    setView('home')
    setQuery('')
    clearFilters()
    window.history.replaceState(null, '', '/')
  }

  function handleSearchSubmit(e) {
    e.preventDefault()
    goSearch()
  }

  const navPage = view === 'contract-detail' ? 'contracts'
    : view === 'opp-detail' ? 'opportunities'
    : view === 'results' ? activeTab
    : view === 'api' ? 'api'
    : view === 'terms' ? 'terms'
    : null

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="app">
      {view !== 'home' && view !== 'auth' && (
        <Nav
          activePage={navPage}
          user={user}
          onHome={goHome}
          onNavigate={(page) => {
            if (page === 'contracts') { setActiveTab('contracts'); setView('results') }
            else if (page === 'opportunities') { setActiveTab('opportunities'); setView('results') }
            else if (page === 'api') setView('api')
            else if (page === 'terms') setView('terms')
            else if (page === 'admin') setView('admin')
            else if (page === 'credits') setView('credits')
            else if (page === 'auth') setView('auth')
            else if (page === 'logout') handleLogout()
          }}
        />
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          HOME — Search-first landing page
          ═══════════════════════════════════════════════════════════════════ */}
      {view === 'home' && (
        <div className="home">
          {/* Sign in link top-right on home page */}
          <div style={{ position: 'absolute', top: 16, right: 24 }}>
            {user ? (
              <span style={{ fontSize: 13, color: '#6B7280' }}>{user.first_name || user.email?.split('@')[0]}</span>
            ) : (
              <a href="#" onClick={e => { e.preventDefault(); setView('auth') }} style={{ fontSize: 13, fontWeight: 600, color: '#1B3A6B' }}>Sign In</a>
            )}
          </div>

          <div className="home-hero">
            <div className="home-brand">
              <img src="/logo-icon-navy-clean.jpg" alt="Awardopedia" width={48} height={48} style={{ borderRadius: 8 }} />
              <h1>Award<span>opedia</span></h1>
            </div>
            <p className="home-subtitle">130,000+ federal & state contracts. Free for small businesses.</p>

            <form className="home-search" onSubmit={handleSearchSubmit}>
              <input
                ref={searchRef}
                type="text"
                placeholder="Search contracts and opportunities — try &quot;janitorial&quot;, &quot;IT services&quot;, or a NAICS code"
                value={query}
                onChange={e => setQuery(e.target.value)}
                autoFocus
              />
              <button type="submit" className="btn btn-navy">Search</button>
            </form>

            <div className="home-quick">
              <button onClick={() => { setActiveTab('opportunities'); goSearch() }}>
                Browse Open Opportunities
              </button>
              <button onClick={() => { setActiveTab('contracts'); goSearch() }}>
                Browse Past Awards
              </button>
            </div>
          </div>

          <footer className="home-footer">
            <span>Data from <a href="https://usaspending.gov" target="_blank" rel="noopener">USASpending.gov</a> and <a href="https://sam.gov" target="_blank" rel="noopener">SAM.gov</a></span>
            <span>
              <a href="#" onClick={e => { e.preventDefault(); setView('api') }}>API</a>
              {' · '}
              <a href="#" onClick={e => { e.preventDefault(); setView('terms') }}>Terms</a>
            </span>
          </footer>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          RESULTS — Search results with tabs and filters
          ═══════════════════════════════════════════════════════════════════ */}
      {view === 'results' && (
        <div className="results-page">
          {/* Header bar (sticky) */}
          <div className="results-header">
            <div className="container">
              <div className="results-header-inner">
                {/* Logo */}
                <button className="results-logo" onClick={goHome}>
                  <img src="/logo-icon-navy-clean.jpg" alt="Awardopedia" width={32} height={32} style={{ borderRadius: 6 }} />
                  <span className="results-logo-text">Award<span>opedia</span></span>
                </button>

                {/* Search */}
                <form className="results-search" onSubmit={e => { e.preventDefault(); loadData(false) }}>
                  <input
                    type="text"
                    placeholder="Search by keyword, notice ID, or solicitation number..."
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                  />
                  <button type="submit" className="btn btn-navy btn-sm" disabled={loading}>
                    {loading ? <span className="spinner" /> : 'Search'}
                  </button>
                  <button
                    type="button"
                    className={`btn btn-ghost btn-sm ${showFilters ? 'active' : ''}`}
                    onClick={() => setShowFilters(!showFilters)}
                  >
                    Filters {hasActiveFilters && <span className="filter-dot" />}
                  </button>
                </form>

                {/* Sign in */}
                <div className="results-header-right">
                  {user ? (
                    <span style={{ color: '#6B7280', fontSize: 13 }}>{user.first_name || user.email?.split('@')[0]}</span>
                  ) : (
                    <a href="#" onClick={e => { e.preventDefault(); setView('auth') }} style={{ fontWeight: 600, color: '#1B3A6B', fontSize: 13 }}>Sign In</a>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Filters panel */}
          {showFilters && (
            <div className="filters-panel">
              <div className="container">
                <div className="filters-grid">
                  <div className="filter-group">
                    <label>State</label>
                    <select value={filterState} onChange={e => setFilterState(e.target.value)}>
                      <option value="">All states</option>
                      {stateOptions.map(s => <option key={s} value={s}>{s} — {US_STATES[s]}</option>)}
                    </select>
                  </div>
                  <div className="filter-group">
                    <label>Set-Aside</label>
                    <select value={filterSetAside} onChange={e => setFilterSetAside(e.target.value)}>
                      <option value="">All set-asides</option>
                      {setAsideOptions.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="filter-group">
                    <label>Agency</label>
                    <select value={filterAgency} onChange={e => setFilterAgency(e.target.value)}>
                      <option value="">All agencies</option>
                      {agencyOptions.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                  <div className="filter-group">
                    <label>NAICS Industry</label>
                    <select value={filterNaics} onChange={e => setFilterNaics(e.target.value)}>
                      <option value="">All industries</option>
                      {naicsOptions.map(([code, desc]) => <option key={code} value={code}>{code} — {desc}</option>)}
                    </select>
                  </div>
                  <div className="filter-group">
                    <label>Jurisdiction</label>
                    <select value={filterDataSource} onChange={e => setFilterDataSource(e.target.value)}>
                      <option value="">All (Federal + State)</option>
                      <option value="federal">Federal Only</option>
                      <option value="tx">Texas (TxDOT)</option>
                    </select>
                  </div>
                </div>
                <div className="filters-actions mt-8">
                  <button className="btn btn-navy btn-sm" onClick={() => loadData(false)} disabled={loading}>
                    {loading ? <span className="spinner" /> : 'Apply Filters'}
                  </button>
                  {hasActiveFilters && (
                    <button className="btn btn-ghost btn-sm" onClick={clearFilters}>Clear all</button>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="container mt-16">
            {/* Tabs */}
            <div className="tabs">
              <button className={`tab ${activeTab === 'opportunities' ? 'active' : ''}`} onClick={() => setActiveTab('opportunities')}>
                Open Opportunities <span className="tab-count">{totalOpportunities.toLocaleString()}</span>
              </button>
              <button className={`tab ${activeTab === 'contracts' ? 'active' : ''}`} onClick={() => setActiveTab('contracts')}>
                Past Contracts <span className="tab-count">{totalContracts.toLocaleString()}</span>
              </button>
            </div>

            {/* ── Opportunities table ── */}
            {activeTab === 'opportunities' && (
              <>
                {filteredOpportunities.length === 0 ? (
                  <div className="empty-state">
                    <p>No open opportunities match your search{hasActiveFilters && ' and filters'}.</p>
                    {hasActiveFilters && <button className="btn btn-ghost btn-sm mt-8" onClick={clearFilters}>Clear filters</button>}
                  </div>
                ) : (
                  <>
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Opportunity <InfoIcon field="Agency" /></th>
                            <th>Industry <InfoIcon field="NAICS" /></th>
                            <th>Where <InfoIcon field="State" /></th>
                            <th>Deadline <InfoIcon field="Window" /></th>
                            <th style={{ textAlign: 'right' }}>Value <InfoIcon field="EstValue" /></th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredOpportunities.map(o => (
                            <tr key={o.notice_id} onClick={() => openOpp(o)}>
                              <td>
                                <div className="row-title">{o.title || '—'}</div>
                                <div className="row-meta">{topAgency(o.agency_name)}</div>
                                {o.set_aside_type && <span className="badge badge-navy" style={{ marginTop: 3 }}>{expandSetAside(o.set_aside_type)}</span>}
                              </td>
                              <td>
                                {o.naics_description
                                  ? <span title={`${toTitleCase(o.naics_description)} (${o.naics_code})`}>{toTitleCase(o.naics_description).slice(0, 36)}{toTitleCase(o.naics_description).length > 36 ? '...' : ''}</span>
                                  : <span className="text-muted">{o.naics_code || '—'}</span>
                                }
                              </td>
                              <td>{stateName(o.place_of_performance_state)}</td>
                              <td>
                                <ExpiryCell dateStr={o.response_deadline} />
                                <DeadlineBadge dateStr={o.response_deadline} />
                              </td>
                              <td><div className="amount">{fmtOppValue(o)}</div></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {hasMoreOpportunities && (
                      <div style={{ textAlign: 'center', padding: 16 }}>
                        <button className="btn btn-navy" onClick={() => loadData(true)} disabled={loadingMore}>
                          {loadingMore ? 'Loading...' : `Load More (${opportunities.length} of ${totalOpportunities})`}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {/* ── Contracts table ── */}
            {activeTab === 'contracts' && (
              <>
                {filteredContracts.length === 0 ? (
                  <div className="empty-state">
                    <p>No contracts match your search{hasActiveFilters && ' and filters'}.</p>
                    {hasActiveFilters && <button className="btn btn-ghost btn-sm mt-8" onClick={clearFilters}>Clear filters</button>}
                  </div>
                ) : (
                  <>
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Contractor & Agency <InfoIcon field="Agency" /></th>
                            <th>Industry <InfoIcon field="NAICS" /></th>
                            <th>Where <InfoIcon field="State" /></th>
                            <th>Period <InfoIcon field="Period" /></th>
                            <th style={{ textAlign: 'right' }}>Amount <InfoIcon field="Amount" /></th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredContracts.map(c => (
                            <tr key={c.piid} onClick={() => openContract(c)}>
                              <td>
                                <div className="row-title">{c.recipient_name || '—'}</div>
                                <div className="row-meta">{topAgency(c.agency_name)}</div>
                                {c.data_source && c.data_source !== 'usaspending' && (
                                  <span className="badge badge-state" style={{ marginTop: 3, marginRight: 4, background: '#2e7d32', color: '#fff' }}>
                                    {c.data_source.toUpperCase()}
                                  </span>
                                )}
                                {c.set_aside_type && <span className="badge badge-navy" style={{ marginTop: 3 }}>{expandSetAside(c.set_aside_type)}</span>}
                              </td>
                              <td>
                                {c.naics_description
                                  ? <span title={`${toTitleCase(c.naics_description)} (${c.naics_code})`}>{toTitleCase(c.naics_description).slice(0, 36)}{toTitleCase(c.naics_description).length > 36 ? '...' : ''}</span>
                                  : <span className="text-muted">{c.naics_code || '—'}</span>
                                }
                              </td>
                              <td>{stateName(c.recipient_state)}</td>
                              <td>
                                <ExpiryCell dateStr={c.start_date} />
                                <span style={{ color: '#aab', margin: '0 4px' }}>-</span>
                                <ExpiryCell dateStr={c.end_date} />
                              </td>
                              <td><div className="amount">{fmt(c.award_amount)}</div></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {hasMoreContracts && (
                      <div style={{ textAlign: 'center', padding: 16 }}>
                        <button className="btn btn-navy" onClick={() => loadData(true)} disabled={loadingMore}>
                          {loadingMore ? 'Loading...' : `Load More (${contracts.length} of ${totalContracts})`}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <footer className="footer">
            <div className="container">
              <div className="footer-inner">
                <span><strong>Awardopedia</strong> — Free federal contract intelligence for small businesses.</span>
                <span>Data from USASpending.gov and SAM.gov · <a href="#" onClick={e => { e.preventDefault(); setView('api') }}>API</a> · <a href="#" onClick={e => { e.preventDefault(); setView('terms') }}>Terms</a> · <a href="#" onClick={e => { e.preventDefault(); setView('admin') }}>Admin</a></span>
              </div>
            </div>
          </footer>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          DETAIL VIEWS
          ═══════════════════════════════════════════════════════════════════ */}
      {view === 'contract-detail' && selectedContract && (
        <ContractDetail
          contract={selectedContract}
          user={user}
          token={token}
          onBuyCredits={() => setView('credits')}
          onBack={() => { setView('results'); window.history.replaceState(null, '', '/') }}
        />
      )}
      {view === 'opp-detail' && selectedOpp && (
        <OpportunityDetail
          opp={selectedOpp}
          user={user}
          token={token}
          onBuyCredits={() => setView('credits')}
          onSignIn={() => setView('auth')}
          onBack={() => { setView('results'); window.history.replaceState(null, '', '/') }}
        />
      )}

      {/* API & Terms */}
      {view === 'api' && <ApiKeys onBack={(target) => target === 'terms' ? setView('terms') : goHome()} />}
      {view === 'terms' && <Terms onBack={goHome} />}
      {view === 'admin' && <Admin onBack={goHome} onJurisdictions={() => setView('jurisdictions')} />}
      {view === 'jurisdictions' && <Jurisdictions onBack={() => setView('admin')} />}
      {view === 'credits' && <Credits user={user} token={token} onBack={goHome} />}
      {view === 'auth' && <Auth onLogin={handleLogin} />}
    </div>
  )
}
