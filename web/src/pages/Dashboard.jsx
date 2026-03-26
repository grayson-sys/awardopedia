import { useState, useEffect } from 'react'
import InfoIcon from '../components/InfoIcon'

const NAICS_COMMON = [
  ['561720', 'Janitorial Services'],
  ['561730', 'Landscaping Services'],
  ['541512', 'Computer Systems Design'],
  ['541611', 'Management Consulting'],
  ['541330', 'Engineering Services'],
  ['238220', 'Plumbing & HVAC'],
  ['561612', 'Security Guards'],
  ['561210', 'Facilities Support'],
  ['541519', 'IT Services'],
  ['236220', 'Commercial Construction'],
  ['541990', 'Other Professional Services'],
  ['532120', 'Truck Rental'],
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
    ]).then(([p, m, s, l]) => {
      setProfile(p)
      setMatches(m || [])
      setSaved(s || [])
      setLists(l || [])
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
        </div>

        {/* Smart Matches */}
        {tab === 'matches' && (
          <div>
            <div className="card" style={{ marginBottom: 24 }}>
              <p style={{ margin: 0, color: '#374151' }}>
                <strong style={{ color: '#1B3A6B' }}>Better than TikTok at serving you opportunities.</strong><br/>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: '#1B3A6B' }}>Email Alerts</h2>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={profile.alerts_enabled || false}
                  onChange={e => updateProfile({ alerts_enabled: e.target.checked })}
                />
                <span style={{ fontWeight: 500 }}>Enable alerts</span>
              </label>
            </div>

            <p style={{ marginBottom: 24, color: '#6B7280' }}>
              Get notified when opportunities match your criteria. We'll send you a digest with opportunity cards — you can generate full reports from there.
            </p>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 500, fontSize: 13 }}>Industries (NAICS)</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {NAICS_COMMON.map(([code, desc]) => (
                  <button
                    key={code}
                    onClick={() => toggleArrayItem('alert_naics', code)}
                    className={`btn btn-sm ${(profile.alert_naics || []).includes(code) ? 'btn-navy' : 'btn-ghost'}`}
                  >
                    {desc}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 500, fontSize: 13 }}>States you operate in</label>
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

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 500, fontSize: 13 }}>Set-asides you qualify for</label>
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

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 500, fontSize: 13 }}>Alert frequency</label>
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
      </div>
    </div>
  )
}
