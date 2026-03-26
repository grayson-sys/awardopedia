import { useState, useEffect } from 'react'
import InfoIcon from '../components/InfoIcon'

// Common NAICS shown as quick picks (user can also search)
const NAICS_QUICK = [
  ['561720', 'Janitorial'],
  ['561730', 'Landscaping'],
  ['541512', 'IT Systems'],
  ['541611', 'Consulting'],
  ['541330', 'Engineering'],
  ['238220', 'HVAC'],
  ['561612', 'Security'],
  ['236220', 'Construction'],
]

const SET_ASIDES = [
  ['SBA', 'Small Business'],
  ['SDVOSB', 'Service-Disabled Veteran-Owned'],
  ['WOSB', 'Women-Owned Small Business'],
  ['8A', '8(a) Minority-Owned'],
  ['HZC', 'HUBZone'],
]

const STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
  'NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
  'VT','VA','WA','WV','WI','WY'
]

export default function Dashboard({ user, token, onBack }) {
  const [tab, setTab] = useState('matches')
  const [profile, setProfile] = useState(null)
  const [matches, setMatches] = useState([])
  const [saved, setSaved] = useState([])
  const [lists, setLists] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [naicsSearch, setNaicsSearch] = useState('')
  const [naicsResults, setNaicsResults] = useState([])
  const [naicsLabels, setNaicsLabels] = useState({})  // code -> description lookup
  const [apiKeys, setApiKeys] = useState([])
  const [newKeyName, setNewKeyName] = useState('')
  const [generatedKey, setGeneratedKey] = useState(null)

  useEffect(() => {
    if (!token) {
      setLoading(false)
      return
    }
    const headers = { Authorization: `Bearer ${token}` }
    Promise.all([
      fetch('/api/profile', { headers }).then(r => r.ok ? r.json() : null),
      fetch('/api/matches', { headers }).then(r => r.ok ? r.json() : []),
      fetch('/api/saved', { headers }).then(r => r.ok ? r.json() : []),
      fetch('/api/lists', { headers }).then(r => r.ok ? r.json() : []),
      fetch('/api/agent/keys', { headers }).then(r => r.ok ? r.json() : { keys: [] }),
    ]).then(([p, m, s, l, k]) => {
      setProfile(p)
      setMatches(m || [])
      setSaved(s || [])
      setLists(l || [])
      setApiKeys(k?.keys || [])
      setLoading(false)
    }).catch((e) => {
      console.error('Dashboard load error:', e)
      setLoading(false)
    })
  }, [token])

  const updateProfile = async (updates) => {
    setSaving(true)
    await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(updates)
    })
    setProfile(p => ({ ...p, ...updates }))
    setSaving(false)
  }

  const createList = async () => {
    if (!newListName.trim()) return
    const res = await fetch('/api/lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: newListName.trim() })
    })
    if (res.ok) {
      const list = await res.json()
      setLists([...lists, list])
      setNewListName('')
    }
  }

  const toggleArrayItem = (field, item) => {
    const current = profile[field] || []
    const updated = current.includes(item)
      ? current.filter(x => x !== item)
      : [...current, item]
    updateProfile({ [field]: updated })
  }

  // NAICS search
  useEffect(() => {
    if (naicsSearch.length < 2) { setNaicsResults([]); return }
    const timer = setTimeout(() => {
      fetch(`/api/naics/search?q=${encodeURIComponent(naicsSearch)}`)
        .then(r => r.json())
        .then(results => {
          setNaicsResults(results || [])
          // Cache labels for display
          const newLabels = { ...naicsLabels }
          results.forEach(r => { newLabels[r.code] = r.description })
          setNaicsLabels(newLabels)
        })
        .catch(() => setNaicsResults([]))
    }, 200)
    return () => clearTimeout(timer)
  }, [naicsSearch])

  const addNaics = (code, desc) => {
    if (!(profile.alert_naics || []).includes(code)) {
      updateProfile({ alert_naics: [...(profile.alert_naics || []), code] })
      setNaicsLabels({ ...naicsLabels, [code]: desc })
    }
    setNaicsSearch('')
    setNaicsResults([])
  }

  const removeNaics = (code) => {
    updateProfile({ alert_naics: (profile.alert_naics || []).filter(c => c !== code) })
  }

  if (loading) return <div className="container" style={{ padding: 40, textAlign: 'center' }}>Loading...</div>
  if (!profile) return <div className="container" style={{ padding: 40 }}>Please sign in to access your dashboard.</div>

  return (
    <div className="dashboard">
      <div className="container" style={{ padding: '24px 24px 60px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1B3A6B', margin: 0 }}>
            {profile.first_name ? `${profile.first_name}'s Dashboard` : 'My Dashboard'}
          </h1>
          <button className="btn btn-ghost" onClick={onBack}>Back to Search</button>
        </div>

        {/* Tabs */}
        <div className="tabs" style={{ marginBottom: 24 }}>
          <button className={`tab ${tab === 'matches' ? 'active' : ''}`} onClick={() => setTab('matches')}>
            Smart Matches {matches.length > 0 && <span className="tab-count">{matches.length}</span>}
          </button>
          <button className={`tab ${tab === 'saved' ? 'active' : ''}`} onClick={() => setTab('saved')}>
            Saved {saved.length > 0 && <span className="tab-count">{saved.length}</span>}
          </button>
          <button className={`tab ${tab === 'profile' ? 'active' : ''}`} onClick={() => setTab('profile')}>
            Business Profile
          </button>
          <button className={`tab ${tab === 'alerts' ? 'active' : ''}`} onClick={() => setTab('alerts')}>
            Alert Settings
          </button>
          <button className={`tab ${tab === 'api' ? 'active' : ''}`} onClick={() => setTab('api')}>
            API Keys
          </button>
        </div>

        {/* Smart Matches */}
        {tab === 'matches' && (
          <div>
            <div className="card" style={{ marginBottom: 24 }}>
              <p style={{ margin: 0, color: '#374151' }}>
                <strong style={{ color: '#1B3A6B' }}>Finally, a good use for an algorithm.</strong><br/>
                We analyze every new federal opportunity against your business profile and surface the best matches.
                Set up your profile and alert preferences to get started.
              </p>
            </div>

            {matches.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: 40 }}>
                <p style={{ color: '#6B7280', marginBottom: 16 }}>No matches yet. Complete your business profile to start receiving smart recommendations.</p>
                <button className="btn btn-navy" onClick={() => setTab('profile')}>Set Up Profile</button>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 16 }}>
                {matches.map(m => (
                  <div key={m.notice_id} className="card" style={{ borderLeft: '4px solid #E9A820' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 16 }}>
                      <div style={{ flex: 1 }}>
                        <h3 style={{ margin: '0 0 8px', fontSize: 16, color: '#1B3A6B' }}>{m.title}</h3>
                        <p style={{ margin: '0 0 8px', fontSize: 13, color: '#6B7280' }}>
                          {m.agency_name} | {m.place_of_performance_state}
                        </p>
                        {m.llama_summary && (
                          <p style={{ margin: '0 0 12px', fontSize: 14, color: '#374151' }}>
                            {m.llama_summary.slice(0, 150)}...
                          </p>
                        )}
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {(m.match_reasons || []).slice(0, 3).map((r, i) => (
                            <span key={i} style={{ background: '#F3F4F6', padding: '4px 8px', borderRadius: 4, fontSize: 12 }}>{r}</span>
                          ))}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ background: '#E9A820', color: '#1B3A6B', padding: '8px 12px', borderRadius: 20, fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
                          {m.match_score}% match
                        </div>
                        <a href={`/opportunity/${m.notice_id}`} className="btn btn-navy btn-sm">View</a>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Saved Opportunities */}
        {tab === 'saved' && (
          <div>
            <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
              <div style={{ width: 200 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: '#6B7280' }}>Lists</h3>
                {lists.map(l => (
                  <div key={l.id} style={{ padding: '8px 12px', marginBottom: 4, background: '#F8F9FB', borderRadius: 6, cursor: 'pointer' }}>
                    <span style={{ color: l.color, marginRight: 8 }}>●</span>
                    {l.name}
                    <span style={{ float: 'right', color: '#9CA3AF', fontSize: 12 }}>{l.opportunity_count}</span>
                  </div>
                ))}
                <div style={{ marginTop: 12 }}>
                  <input
                    type="text"
                    placeholder="New list..."
                    value={newListName}
                    onChange={e => setNewListName(e.target.value)}
                    onKeyPress={e => e.key === 'Enter' && createList()}
                    style={{ width: '100%', padding: '6px 10px', fontSize: 13, border: '1px solid #E2E4E9', borderRadius: 4 }}
                  />
                </div>
              </div>

              <div style={{ flex: 1 }}>
                {saved.length === 0 ? (
                  <div className="card" style={{ textAlign: 'center', padding: 40 }}>
                    <p style={{ color: '#6B7280' }}>No saved opportunities yet. Click the bookmark icon on any opportunity to save it.</p>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 12 }}>
                    {saved.map(s => (
                      <div key={s.id} className="card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                          <div>
                            <span style={{ color: s.list_color, marginRight: 8, fontSize: 10 }}>●</span>
                            <span style={{ fontSize: 12, color: '#9CA3AF' }}>{s.list_name}</span>
                            <h3 style={{ margin: '4px 0 8px', fontSize: 15, color: '#1B3A6B' }}>{s.title}</h3>
                            <p style={{ margin: 0, fontSize: 13, color: '#6B7280' }}>{s.agency_name}</p>
                          </div>
                          <div>
                            <span className={`badge badge-${s.status === 'pursuing' ? 'amber' : s.status === 'won' ? 'success' : 'ghost'}`}>
                              {s.status}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Business Profile */}
        {tab === 'profile' && (
          <div className="card">
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20, color: '#1B3A6B' }}>Tell us about your business</h2>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 500, fontSize: 13 }}>Company Name</label>
                <input
                  type="text"
                  value={profile.company_name || ''}
                  onChange={e => updateProfile({ company_name: e.target.value })}
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E4E9', borderRadius: 6 }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 500, fontSize: 13 }}>
                  SAM.gov UEI <InfoIcon text="Your Unique Entity Identifier from SAM.gov registration" />
                </label>
                <input
                  type="text"
                  value={profile.company_uei || ''}
                  onChange={e => updateProfile({ company_uei: e.target.value })}
                  placeholder="e.g., K7M9X3EXAMPLE"
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E4E9', borderRadius: 6 }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 500, fontSize: 13 }}>Company Size</label>
                <select
                  value={profile.company_size || ''}
                  onChange={e => updateProfile({ company_size: e.target.value })}
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E4E9', borderRadius: 6 }}
                >
                  <option value="">Select...</option>
                  <option value="1-10">1-10 employees</option>
                  <option value="11-50">11-50 employees</option>
                  <option value="51-200">51-200 employees</option>
                  <option value="201-1000">201-1000 employees</option>
                  <option value="1000+">1000+ employees</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 500, fontSize: 13 }}>Headquarters State</label>
                <select
                  value={profile.company_state || ''}
                  onChange={e => updateProfile({ company_state: e.target.value })}
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E4E9', borderRadius: 6 }}
                >
                  <option value="">Select...</option>
                  {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div style={{ marginTop: 20 }}>
              <label style={{ display: 'block', marginBottom: 6, fontWeight: 500, fontSize: 13 }}>
                What does your company do? <InfoIcon text="Describe your services, capabilities, and what makes you competitive. This helps us match you with the right opportunities." />
              </label>
              <textarea
                value={profile.company_description || ''}
                onChange={e => updateProfile({ company_description: e.target.value })}
                placeholder="e.g., We provide commercial janitorial and facilities maintenance services to federal buildings across the Southwest. Our team specializes in secure environments including courthouses and federal offices..."
                rows={4}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E4E9', borderRadius: 6, resize: 'vertical' }}
              />
            </div>

            <div style={{ marginTop: 20 }}>
              <label style={{ display: 'block', marginBottom: 6, fontWeight: 500, fontSize: 13 }}>Primary NAICS Code</label>
              <select
                value={profile.company_naics || ''}
                onChange={e => updateProfile({ company_naics: e.target.value })}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E4E9', borderRadius: 6 }}
              >
                <option value="">Select your primary industry...</option>
                {NAICS_COMMON.map(([code, desc]) => (
                  <option key={code} value={code}>{code} — {desc}</option>
                ))}
              </select>
            </div>

            <div style={{ marginTop: 20 }}>
              <label style={{ display: 'block', marginBottom: 6, fontWeight: 500, fontSize: 13 }}>Certifications</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {SET_ASIDES.map(([code, label]) => (
                  <button
                    key={code}
                    onClick={() => toggleArrayItem('company_certifications', code)}
                    className={`btn btn-sm ${(profile.company_certifications || []).includes(code) ? 'btn-navy' : 'btn-ghost'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {saving && <p style={{ marginTop: 16, color: '#6B7280', fontSize: 13 }}>Saving...</p>}
          </div>
        )}

        {/* Alert Settings */}
        {tab === 'alerts' && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: '#1B3A6B' }}>Smart Matching</h2>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={profile.alerts_enabled || false}
                  onChange={e => updateProfile({ alerts_enabled: e.target.checked })}
                />
                <span style={{ fontWeight: 500 }}>Email me matches</span>
              </label>
            </div>

            <p style={{ marginBottom: 24, color: '#6B7280', fontSize: 14 }}>
              Tell us what you're looking for and we'll surface the best opportunities. Everything is optional — add what's relevant to you.
            </p>

            {/* Keywords - most important, put first */}
            <div style={{ marginBottom: 28, padding: 20, background: '#F8F9FB', borderRadius: 8 }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, fontSize: 14, color: '#1B3A6B' }}>
                Keywords <span style={{ fontWeight: 400, color: '#6B7280' }}>(strongly boost matching)</span>
              </label>
              <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 12 }}>
                Add words that should flag opportunities for you. If you're a janitorial company, add "janitorial", "custodial", "cleaning", etc.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                {(profile.alert_keywords || []).map((kw, i) => (
                  <span key={i} style={{ background: '#E9A820', color: '#1B3A6B', padding: '6px 12px', borderRadius: 16, fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {kw}
                    <button onClick={() => {
                      const updated = (profile.alert_keywords || []).filter((_, idx) => idx !== i)
                      updateProfile({ alert_keywords: updated })
                    }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 16, lineHeight: 1 }}>×</button>
                  </span>
                ))}
              </div>
              <input
                type="text"
                placeholder="Type a keyword and press Enter..."
                onKeyPress={e => {
                  if (e.key === 'Enter' && e.target.value.trim()) {
                    const kw = e.target.value.trim().toLowerCase()
                    if (!(profile.alert_keywords || []).includes(kw)) {
                      updateProfile({ alert_keywords: [...(profile.alert_keywords || []), kw] })
                    }
                    e.target.value = ''
                  }
                }}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E4E9', borderRadius: 6, fontSize: 14 }}
              />
            </div>

            {/* Office Locations */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 500, fontSize: 13 }}>
                Office Locations <span style={{ fontWeight: 400, color: '#9CA3AF' }}>(select all states where you have offices or can perform work)</span>
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {STATES.map(s => (
                  <button
                    key={s}
                    onClick={() => toggleArrayItem('alert_states', s)}
                    className={`btn btn-sm ${(profile.alert_states || []).includes(s) ? 'btn-navy' : 'btn-ghost'}`}
                    style={{ minWidth: 44 }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Industries */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 500, fontSize: 13 }}>
                Industries <span style={{ fontWeight: 400, color: '#9CA3AF' }}>(search or pick from common)</span>
              </label>

              {/* Selected NAICS codes */}
              {(profile.alert_naics || []).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                  {(profile.alert_naics || []).map(code => (
                    <span key={code} style={{ background: '#1B3A6B', color: '#fff', padding: '6px 12px', borderRadius: 16, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {naicsLabels[code] || code}
                      <button onClick={() => removeNaics(code)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 16, lineHeight: 1, color: '#fff' }}>×</button>
                    </span>
                  ))}
                </div>
              )}

              {/* Search input */}
              <div style={{ position: 'relative', marginBottom: 12 }}>
                <input
                  type="text"
                  value={naicsSearch}
                  onChange={e => setNaicsSearch(e.target.value)}
                  placeholder="Search industries... (e.g., janitorial, IT, construction)"
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E4E9', borderRadius: 6, fontSize: 14 }}
                />
                {naicsResults.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #E2E4E9', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 10, maxHeight: 200, overflow: 'auto' }}>
                    {naicsResults.map(r => (
                      <button
                        key={r.code}
                        onClick={() => addNaics(r.code, r.description)}
                        style={{ display: 'block', width: '100%', padding: '10px 12px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #F3F4F6' }}
                        onMouseOver={e => e.target.style.background = '#F8F9FB'}
                        onMouseOut={e => e.target.style.background = 'none'}
                      >
                        <span style={{ color: '#1B3A6B', fontWeight: 500 }}>{r.code}</span>
                        <span style={{ color: '#6B7280' }}> — {r.description}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Quick picks */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <span style={{ fontSize: 12, color: '#9CA3AF', lineHeight: '28px' }}>Quick:</span>
                {NAICS_QUICK.map(([code, desc]) => (
                  <button
                    key={code}
                    onClick={() => addNaics(code, desc)}
                    className={`btn btn-sm ${(profile.alert_naics || []).includes(code) ? 'btn-navy' : 'btn-ghost'}`}
                    disabled={(profile.alert_naics || []).includes(code)}
                  >
                    {desc}
                  </button>
                ))}
              </div>
            </div>

            {/* Set-asides */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 500, fontSize: 13 }}>
                Certifications <span style={{ fontWeight: 400, color: '#9CA3AF' }}>(set-asides you qualify for)</span>
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {SET_ASIDES.map(([code, label]) => (
                  <button
                    key={code}
                    onClick={() => toggleArrayItem('alert_set_asides', code)}
                    className={`btn btn-sm ${(profile.alert_set_asides || []).includes(code) ? 'btn-navy' : 'btn-ghost'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Alert frequency */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 500, fontSize: 13 }}>Email frequency</label>
              <select
                value={profile.alert_frequency || 'daily'}
                onChange={e => updateProfile({ alert_frequency: e.target.value })}
                style={{ padding: '10px 12px', border: '1px solid #E2E4E9', borderRadius: 6 }}
              >
                <option value="instant">Instant (as they come in)</option>
                <option value="daily">Daily digest</option>
                <option value="weekly">Weekly digest</option>
              </select>
            </div>

            {saving && <p style={{ color: '#6B7280', fontSize: 13 }}>Saving...</p>}
          </div>
        )}

        {/* API Keys */}
        {tab === 'api' && (
          <div className="card">
            <div style={{ marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px', color: '#1B3A6B' }}>API Keys</h2>
              <p style={{ color: '#6B7280', margin: 0, fontSize: 14 }}>
                Use API keys to integrate Awardopedia with AI agents, scripts, or your own applications.
                Each key gets 10 searches per day.
              </p>
            </div>

            {/* Generated key display (one-time view) */}
            {generatedKey && (
              <div style={{ background: '#FFFBEB', border: '1px solid #F59E0B', borderRadius: 8, padding: 16, marginBottom: 20 }}>
                <p style={{ margin: '0 0 8px', fontWeight: 600, color: '#92400E' }}>Your new API key (save it now!):</p>
                <code style={{ display: 'block', background: '#FEF3C7', padding: 12, borderRadius: 4, fontSize: 14, wordBreak: 'break-all', fontFamily: 'monospace' }}>
                  {generatedKey}
                </code>
                <p style={{ margin: '12px 0 0', fontSize: 13, color: '#92400E' }}>
                  This key will only be shown once. Copy it now and store it securely.
                </p>
                <button
                  onClick={() => { navigator.clipboard.writeText(generatedKey); setGeneratedKey(null) }}
                  className="btn btn-navy"
                  style={{ marginTop: 12 }}
                >
                  Copy & Dismiss
                </button>
              </div>
            )}

            {/* Create new key */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
              <input
                type="text"
                value={newKeyName}
                onChange={e => setNewKeyName(e.target.value)}
                placeholder="Key name (e.g., My AI Agent)"
                style={{ flex: 1, padding: '10px 12px', border: '1px solid #E2E4E9', borderRadius: 6 }}
              />
              <button
                onClick={async () => {
                  if (apiKeys.length >= 3) {
                    alert('Maximum 3 keys allowed. Revoke an existing key first.')
                    return
                  }
                  const res = await fetch('/api/agent/keys', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ name: newKeyName || 'Default' })
                  })
                  const data = await res.json()
                  if (data.api_key) {
                    setGeneratedKey(data.api_key)
                    setNewKeyName('')
                    // Refresh key list
                    const keysRes = await fetch('/api/agent/keys', { headers: { Authorization: `Bearer ${token}` } })
                    const keysData = await keysRes.json()
                    setApiKeys(keysData.keys || [])
                  } else {
                    alert(data.error || 'Failed to create key')
                  }
                }}
                className="btn btn-navy"
                disabled={apiKeys.length >= 3}
              >
                Create Key
              </button>
            </div>

            {/* Existing keys */}
            {apiKeys.length > 0 ? (
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: '#374151' }}>Your Keys</h3>
                {apiKeys.map(k => (
                  <div key={k.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #E2E4E9' }}>
                    <div>
                      <p style={{ margin: 0, fontWeight: 500 }}>{k.name}</p>
                      <code style={{ fontSize: 12, color: '#6B7280' }}>{k.key_prefix}...</code>
                      <span style={{ marginLeft: 8, fontSize: 12, color: '#9CA3AF' }}>
                        {k.searches_today || 0}/10 today
                      </span>
                    </div>
                    <button
                      onClick={async () => {
                        if (!confirm('Revoke this key? Any integrations using it will stop working.')) return
                        await fetch(`/api/agent/keys/${k.id}`, {
                          method: 'DELETE',
                          headers: { Authorization: `Bearer ${token}` }
                        })
                        setApiKeys(apiKeys.filter(x => x.id !== k.id))
                      }}
                      className="btn btn-ghost"
                      style={{ color: '#DC2626' }}
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: '#6B7280', fontSize: 14 }}>No API keys yet. Create one above to get started.</p>
            )}

            {/* Documentation link */}
            <div style={{ marginTop: 24, padding: 16, background: '#F8F9FB', borderRadius: 8 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#1B3A6B' }}>Quick Start</h3>
              <p style={{ margin: '0 0 8px', fontSize: 13, color: '#374151' }}>
                Send a GET request with your API key:
              </p>
              <pre style={{ background: '#1B3A6B', color: '#fff', padding: 12, borderRadius: 4, fontSize: 12, overflow: 'auto' }}>
{`curl -H "X-API-Key: ak_your_key_here" \\
  "https://awardopedia.com/api/agent/search?q=cybersecurity&state=VA"`}
              </pre>
              <p style={{ margin: '12px 0 0', fontSize: 13 }}>
                <a href="/llms.txt" target="_blank" style={{ color: '#1B3A6B', fontWeight: 500 }}>View full API documentation</a>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
