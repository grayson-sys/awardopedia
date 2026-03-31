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
import Dashboard from './pages/Dashboard'
import AIAssistant from './pages/AIAssistant'
import AskAI from './pages/AskAI'
import Leaderboard from './pages/Leaderboard'
import About from './pages/About'
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
  const [view, setViewState] = useState('home')
  const [selectedContract, setSelectedContract] = useState(null)
  const [selectedOpp, setSelectedOpp] = useState(null)

  // URL-based routing: update browser history when view changes
  function setView(newView, pushHistory = true) {
    setViewState(newView)
    if (pushHistory) {
      const path = newView === 'home' ? '/'
        : newView === 'results' ? '/search'
        : newView === 'opp-detail' ? '/opportunity'
        : newView === 'contract-detail' ? '/contract'
        : `/${newView}`
      window.history.pushState({ view: newView }, '', path)
    }
  }

  // Handle browser back/forward buttons
  useEffect(() => {
    function handlePopState(e) {
      if (e.state?.view) {
        // For detail views, verify we have the data; otherwise go to results
        if (e.state.view === 'opp-detail' && !selectedOpp) {
          setViewState('results')
          window.history.replaceState({ view: 'results' }, '', '/search')
        } else if (e.state.view === 'contract-detail' && !selectedContract) {
          setViewState('results')
          window.history.replaceState({ view: 'results' }, '', '/search')
        } else {
          setViewState(e.state.view)
        }
      } else {
        // Parse URL to determine view
        const path = window.location.pathname
        if (path === '/' || path === '') setViewState('home')
        else if (path === '/search' || path === '/results') setViewState('results')
        else if (path === '/opportunity' || path === '/contract') {
          // Generic detail path without ID - redirect to results
          setViewState('results')
          window.history.replaceState({ view: 'results' }, '', '/search')
        }
        else if (path.startsWith('/')) setViewState(path.slice(1) || 'home')
      }
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [selectedOpp, selectedContract])

  // On initial load, read URL to set initial view (supports direct links)
  useEffect(() => {
    const path = window.location.pathname
    if (path === '/search' || path === '/results') {
      setViewState('results')
      window.history.replaceState({ view: 'results' }, '', path)
    } else if (path.startsWith('/opportunity/')) {
      // Direct link to opportunity: /opportunity/{notice_id}
      const noticeId = path.split('/opportunity/')[1]
      if (noticeId) {
        fetch(`/api/opportunities/${noticeId}`)
          .then(r => r.ok ? r.json() : null)
          .then(opp => {
            if (opp) {
              setSelectedOpp(opp)
              setViewState('opp-detail')
            } else {
              setViewState('home')
            }
          })
          .catch(() => setViewState('home'))
      }
    } else if (path.startsWith('/contract/')) {
      // Direct link to contract: /contract/{piid}
      const piid = path.split('/contract/')[1]
      if (piid) {
        fetch(`/api/contracts/${piid}`)
          .then(r => r.ok ? r.json() : null)
          .then(contract => {
            if (contract) {
              setSelectedContract(contract)
              setViewState('contract-detail')
            } else {
              setViewState('home')
            }
          })
          .catch(() => setViewState('home'))
      }
    } else if (path === '/opportunity' || path === '/contract') {
      // Generic detail path without ID - redirect to search results
      setViewState('results')
      window.history.replaceState({ view: 'results' }, '', '/search')
    } else if (path !== '/' && path !== '') {
      const viewFromPath = path.slice(1)
      if (['api', 'terms', 'admin', 'auth', 'credits', 'ai-assistant', 'ask-ai', 'leaderboard', 'dashboard'].includes(viewFromPath)) {
        setViewState(viewFromPath)
        window.history.replaceState({ view: viewFromPath }, '', path)
      }
    }
  }, [])

  const [contracts, setContracts] = useState([])
  const [opportunities, setOpportunities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Auth
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(() => {
    try { return localStorage.getItem('token') } catch { return null }
  })

  // Restore session on mount
  useEffect(() => {
    if (!token) return
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => setUser(data))
      .catch(() => { try { localStorage.removeItem('token') } catch {} setToken(null) })
  }, [token])

  function handleLogin(member, newToken) {
    setUser(member)
    setToken(newToken)
    setView('home')
  }

  function handleLogout() {
    try { localStorage.removeItem('token') } catch {}
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
  const [filterMinDate, setFilterMinDate] = useState('')
  const [searchTrigger, setSearchTrigger] = useState(0)  // Increment to force reload
  const [showFilters, setShowFilters] = useState(false)
  const PAGE_SIZE = 50
  const [totalContracts, setTotalContracts] = useState(0)
  const [totalOpportunities, setTotalOpportunities] = useState(0)
  const [totalPending, setTotalPending] = useState(0)
  const [hasMoreContracts, setHasMoreContracts] = useState(false)
  const [hasMoreOpportunities, setHasMoreOpportunities] = useState(false)
  const [hasMorePending, setHasMorePending] = useState(false)
  const [pendingOpportunities, setPendingOpportunities] = useState([])
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
    if (filterMinDate) params.set('min_date', filterMinDate)
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

      if (activeTab === 'opportunities') {
        const offset = append ? opportunities.length : 0
        const qs = buildQuery({ limit: PAGE_SIZE, offset, status: 'open' })
        const res = await fetch(`/api/opportunities?${qs}`)
        if (!res.ok) throw new Error(`Opportunities API: ${res.status}`)
        const data = await res.json()
        setOpportunities(append ? [...opportunities, ...data.data] : data.data)
        setTotalOpportunities(data.meta.total)
        setHasMoreOpportunities(data.meta.hasMore)
      } else if (activeTab === 'pending') {
        const offset = append ? pendingOpportunities.length : 0
        const qs = buildQuery({ limit: PAGE_SIZE, offset, status: 'pending' })
        const res = await fetch(`/api/opportunities?${qs}`)
        if (!res.ok) throw new Error(`Opportunities API: ${res.status}`)
        const data = await res.json()
        setPendingOpportunities(append ? [...pendingOpportunities, ...data.data] : data.data)
        setTotalPending(data.meta.total)
        setHasMorePending(data.meta.hasMore)
      } else {
        const offset = append ? contracts.length : 0
        const qs = buildQuery({ limit: PAGE_SIZE, offset })
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
  }, [view, activeTab, filterState, filterAgency, filterNaics, filterSetAside, filterDataSource, filterMinDate, searchTrigger])

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

  const hasActiveFilters = filterState || filterSetAside || filterNaics || filterAgency || filterDataSource || filterMinDate
  const clearFilters = () => { setFilterState(''); setFilterSetAside(''); setFilterNaics(''); setFilterAgency(''); setFilterDataSource(''); setFilterMinDate('') }

  // History management for back button
  useEffect(() => {
    const handlePopState = (event) => {
      // Check if we should go back to leaderboard
      if (event.state?.view === 'leaderboard') {
        setView('leaderboard')
        setFilterMinDate('')  // Clear leaderboard filter
        setQuery('')
      } else {
        // Default: return to list view
        setView('list')
        setSelectedOpp(null)
        setSelectedContract(null)
      }
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
    setViewState('results')
    const searchUrl = query ? `/search?q=${encodeURIComponent(query)}` : '/search'
    window.history.pushState({ view: 'results', query }, '', searchUrl)
  }

  async function openContract(c) {
    // Set initial data from list, then fetch full details with company profile
    setSelectedContract(c)
    setViewState('contract-detail')
    window.history.pushState({ view: 'contract-detail', id: c.piid }, '', `/contract/${encodeURIComponent(c.piid)}`)

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
    setViewState('opp-detail')
    window.history.pushState({ view: 'opp-detail', id: o.notice_id }, '', `/opportunity/${o.notice_id}`)
  }

  function goHome() {
    setViewState('home')
    setQuery('')
    clearFilters()
    window.history.pushState({ view: 'home' }, '', '/')
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
    : view === 'leaderboard' ? 'leaderboard'
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
            else if (page === 'about') setView('about')
            else if (page === 'admin') setView('admin')
            else if (page === 'credits') setView('credits')
            else if (page === 'dashboard') setView('dashboard')
            else if (page === 'auth') setView('auth')
            else if (page === 'ai-assistant') setView('ai-assistant')
            else if (page === 'ask-ai') setView('ask-ai')
            else if (page === 'leaderboard') setView('leaderboard')
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
              <button onClick={() => setView('leaderboard')}>
                Leaderboards
              </button>
            </div>
          </div>

          {/* Competitive comparison section */}
          <div className="compare-section">
            <h2>Same Data. Original Documents. No Contracts.</h2>
            <p className="compare-subtitle">
              We pull from the same government sources as the big players — SAM.gov, USASpending, FPDS.
              You get the original federal PDFs so you can verify everything yourself. AI helps you read them faster.
            </p>

            <div className="compare-grid">
              <div className="compare-card">
                <h3>Enterprise Platforms</h3>
                <p className="compare-desc">GovWin, Bloomberg Government, Deltek</p>
                <ul className="compare-list compare-them">
                  <li>$10,000–50,000/year subscriptions</li>
                  <li>Annual contracts required</li>
                  <li>Repackaged government data</li>
                  <li>Manual research and alerts</li>
                </ul>
              </div>

              <div className="compare-card">
                <h3>Bid Aggregators</h3>
                <p className="compare-desc">GovSpend, BidNet, Onvia</p>
                <ul className="compare-list compare-them">
                  <li>$200–500/month subscriptions</li>
                  <li>Data dumps without context</li>
                  <li>You still do the analysis</li>
                  <li>Limited AI or none at all</li>
                </ul>
              </div>

              <div className="compare-card compare-us">
                <h3>Awardopedia</h3>
                <p className="compare-desc">AI-powered. Pay as you go.</p>
                <ul className="compare-list compare-win">
                  <li>No subscription — pay per report</li>
                  <li>Original federal PDFs included</li>
                  <li>AI reads the solicitation for you</li>
                  <li>Don't trust us — verify the source</li>
                </ul>
              </div>
            </div>

            <div className="compare-table-wrap">
              <table className="compare-table">
                <thead>
                  <tr>
                    <th>Capability</th>
                    <th>Enterprise<br/>Platforms</th>
                    <th>Bid<br/>Aggregators</th>
                    <th className="highlight">Awardopedia</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Annual cost</td>
                    <td>$10K–50K</td>
                    <td>$2K–6K</td>
                    <td className="highlight">$0 + usage</td>
                  </tr>
                  <tr>
                    <td>Contract required</td>
                    <td><span className="icon-no"></span></td>
                    <td><span className="icon-no"></span></td>
                    <td className="highlight"><span className="icon-yes"></span> None</td>
                  </tr>
                  <tr>
                    <td>Federal opportunities</td>
                    <td><span className="icon-yes"></span></td>
                    <td><span className="icon-yes"></span></td>
                    <td className="highlight"><span className="icon-yes"></span></td>
                  </tr>
                  <tr>
                    <td>Historical awards</td>
                    <td><span className="icon-yes"></span></td>
                    <td><span className="icon-partial"></span></td>
                    <td className="highlight"><span className="icon-yes"></span></td>
                  </tr>
                  <tr>
                    <td>AI analysis of solicitations</td>
                    <td><span className="icon-no"></span></td>
                    <td><span className="icon-no"></span></td>
                    <td className="highlight"><span className="icon-yes"></span></td>
                  </tr>
                  <tr>
                    <td>Instant bid/no-bid reports</td>
                    <td><span className="icon-no"></span></td>
                    <td><span className="icon-no"></span></td>
                    <td className="highlight"><span className="icon-yes"></span></td>
                  </tr>
                </tbody>
              </table>
              <p className="compare-legend">
                <span className="icon-yes"></span> Full support
                <span className="icon-partial"></span> Limited
                <span className="icon-no"></span> Not available
              </p>
            </div>
          </div>

          <footer className="home-footer">
            <span>Data from <a href="https://usaspending.gov" target="_blank" rel="noopener">USASpending.gov</a> and <a href="https://sam.gov" target="_blank" rel="noopener">SAM.gov</a></span>
            <span>
              <a href="#" onClick={e => { e.preventDefault(); setView('ask-ai') }}>Ask AI</a>
              {' · '}
              <a href="#" onClick={e => { e.preventDefault(); setView('ai-assistant') }}>AI Setup</a>
              {' · '}
              <a href="#" onClick={e => { e.preventDefault(); setView('api') }}>API</a>
              {' · '}
              <a href="#" onClick={e => { e.preventDefault(); setView('terms') }}>Terms</a>
              {' · '}
              <a href="#" onClick={e => { e.preventDefault(); setView('about') }}>About</a>
            </span>
          </footer>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          RESULTS — Search results with tabs and filters
          ═══════════════════════════════════════════════════════════════════ */}
      {view === 'results' && (
        <div className="results-page">
          {/* Search bar */}
          <div className="results-search-bar">
            <div className="container">
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
                  {/* Jurisdiction dropdown hidden — all data is federal for now
                  <div className="filter-group">
                    <label>Jurisdiction</label>
                    <select value={filterDataSource} onChange={e => setFilterDataSource(e.target.value)}>
                      <option value="">All (Federal + State)</option>
                      <option value="federal">Federal Only</option>
                      <option value="tx">Texas (TxDOT)</option>
                    </select>
                  </div>
                  */}
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
                Open Opportunities {totalOpportunities > 0 && <span className="tab-count">{totalOpportunities.toLocaleString()}</span>}
              </button>
              <button className={`tab ${activeTab === 'pending' ? 'active' : ''}`} onClick={() => setActiveTab('pending')}>
                Pending Award {totalPending > 0 && <span className="tab-count">{totalPending.toLocaleString()}</span>}
              </button>
              <button className={`tab ${activeTab === 'contracts' ? 'active' : ''}`} onClick={() => setActiveTab('contracts')}>
                Past Contracts {totalContracts > 0 && <span className="tab-count">{totalContracts.toLocaleString()}</span>}
              </button>
            </div>

            {/* ── Opportunities table ── */}
            {activeTab === 'opportunities' && (
              <>
                {filteredOpportunities.length === 0 ? (
                  <div className="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                    </svg>
                    <p style={{ fontSize: 15, marginBottom: 4 }}>No open opportunities found</p>
                    <p style={{ fontSize: 13, opacity: 0.7 }}>Try adjusting your search or filters</p>
                    {hasActiveFilters && <button className="btn btn-ghost btn-sm mt-16" onClick={clearFilters}>Clear all filters</button>}
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

            {/* ── Pending Award table ── */}
            {activeTab === 'pending' && (
              <>
                {pendingOpportunities.length === 0 ? (
                  <div className="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                    </svg>
                    <p style={{ fontSize: 15, marginBottom: 4 }}>No pending awards found</p>
                    <p style={{ fontSize: 13, opacity: 0.7 }}>Check back soon for new award decisions</p>
                    {hasActiveFilters && <button className="btn btn-ghost btn-sm mt-16" onClick={clearFilters}>Clear all filters</button>}
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
                            <th>Closed <InfoIcon field="Window" /></th>
                            <th style={{ textAlign: 'right' }}>Value <InfoIcon field="EstValue" /></th>
                          </tr>
                        </thead>
                        <tbody>
                          {pendingOpportunities.map(o => (
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
                                <span className="text-muted">{o.response_deadline ? new Date(o.response_deadline).toLocaleDateString() : '—'}</span>
                              </td>
                              <td><div className="amount">{fmtOppValue(o)}</div></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {hasMorePending && (
                      <div style={{ textAlign: 'center', padding: 16 }}>
                        <button className="btn btn-navy" onClick={() => loadData(true)} disabled={loadingMore}>
                          {loadingMore ? 'Loading...' : `Load More (${pendingOpportunities.length} of ${totalPending})`}
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
                {loading ? (
                  <div className="empty-state">
                    <div className="spinner" style={{ width: 32, height: 32, marginBottom: 16 }} />
                    <p style={{ fontSize: 15, color: '#6B7280' }}>Loading contracts...</p>
                  </div>
                ) : filteredContracts.length === 0 ? (
                  <div className="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <p style={{ fontSize: 15, marginBottom: 4 }}>No contracts found</p>
                    <p style={{ fontSize: 13, opacity: 0.7 }}>Try a different search term or adjust your filters</p>
                    {hasActiveFilters && <button className="btn btn-ghost btn-sm mt-16" onClick={clearFilters}>Clear all filters</button>}
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
                <span>Data from USASpending.gov and SAM.gov · <a href="#" onClick={e => { e.preventDefault(); setView('api') }}>API</a> · <a href="#" onClick={e => { e.preventDefault(); setView('terms') }}>Terms</a> · <a href="#" onClick={e => { e.preventDefault(); setView('about') }}>About</a> · <a href="#" onClick={e => { e.preventDefault(); setView('admin') }}>Admin</a></span>
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
          onBack={() => {
            // Go back in history to preserve scroll position and results
            setSelectedContract(null)
            if (window.history.length > 1) {
              window.history.back()
            } else {
              setView('results')
            }
          }}
        />
      )}
      {view === 'opp-detail' && selectedOpp && (
        <OpportunityDetail
          opp={selectedOpp}
          user={user}
          token={token}
          onBuyCredits={() => setView('credits')}
          onSignIn={() => setView('auth')}
          onHome={goHome}
          onBack={() => {
            // Go back in history to preserve scroll position and results
            setSelectedOpp(null)
            if (window.history.length > 1) {
              window.history.back()
            } else {
              setView('results')
            }
          }}
        />
      )}

      {/* API & Terms */}
      {view === 'api' && <ApiKeys onBack={(target) => target === 'terms' ? setView('terms') : goHome()} />}
      {view === 'terms' && <Terms onBack={goHome} />}
      {view === 'about' && <About onBack={goHome} />}
      {view === 'admin' && <Admin onBack={goHome} onJurisdictions={() => setView('jurisdictions')} />}
      {view === 'jurisdictions' && <Jurisdictions onBack={() => setView('admin')} />}
      {view === 'credits' && <Credits user={user} token={token} onBack={goHome} />}
      {view === 'dashboard' && <Dashboard user={user} token={token} onBack={goHome} />}
      {view === 'auth' && <Auth onLogin={handleLogin} onHome={goHome} />}
      {view === 'ai-assistant' && <AIAssistant />}
      {view === 'ask-ai' && <AskAI />}
      {view === 'leaderboard' && <Leaderboard onBack={goHome} onSearchContracts={(companyName) => {
          // Set min_date to 365 days ago to match leaderboard trailing 12 months
          const minDate = new Date()
          minDate.setDate(minDate.getDate() - 365)
          setFilterMinDate(minDate.toISOString().split('T')[0])
          setQuery(companyName)
          setContracts([])  // Clear so loading state shows
          setLoading(true)  // Show loading immediately
          setActiveTab('contracts')
          setSearchTrigger(t => t + 1)  // Force reload with new query
          window.history.pushState({ view: 'leaderboard' }, '', '/leaderboard')  // For back button
          setView('results')
        }} />}
    </div>
  )
}
