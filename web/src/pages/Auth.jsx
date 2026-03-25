import { useState } from 'react'

export default function Auth({ onLogin }) {
  const [mode, setMode] = useState('login') // 'login' | 'register' | 'forgot'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [profession, setProfession] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [companySize, setCompanySize] = useState('')
  const [companyState, setCompanyState] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      if (mode === 'forgot') {
        const res = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        })
        const data = await res.json()
        if (!res.ok || data.error) throw new Error(data.error)
        setResetSent(true)
        return
      }
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register'
      const body = mode === 'login'
        ? { email, password }
        : { email, password, first_name: firstName, last_name: lastName, profession, company_name: companyName, company_size: companySize, company_state: companyState }
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error)
      localStorage.setItem('token', data.token)
      onLogin(data.member, data.token)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 440, margin: '60px auto', padding: '0 24px' }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 8 }}>
          <img src="/logo-icon-navy-clean.jpg" alt="" width={36} height={36} style={{ borderRadius: 6 }} />
          <span style={{ fontSize: 24, fontWeight: 700, color: '#1B3A6B' }}>Award<span style={{ color: '#E9A820' }}>opedia</span></span>
        </div>
        <p style={{ color: '#6B7280', fontSize: 14 }}>
          {mode === 'login' ? 'Sign in to your account' : mode === 'register' ? 'Create your free account' : 'Reset your password'}
        </p>
      </div>

      <div className="card">
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mode === 'register' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={labelStyle}>First Name</label>
                  <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} style={inputStyle} required />
                </div>
                <div>
                  <label style={labelStyle}>Last Name</label>
                  <input type="text" value={lastName} onChange={e => setLastName(e.target.value)} style={inputStyle} required />
                </div>
              </div>
              <div>
                <label style={labelStyle}>Profession</label>
                <select value={profession} onChange={e => setProfession(e.target.value)} style={inputStyle}>
                  <option value="">Select...</option>
                  <option value="Small Business Owner">Small Business Owner</option>
                  <option value="Contracts Manager">Contracts Manager</option>
                  <option value="Business Development">Business Development</option>
                  <option value="Consultant">Government Contracts Consultant</option>
                  <option value="Journalist">Journalist / Researcher</option>
                  <option value="Government Employee">Government Employee</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Company Name <span style={{ color: '#9CA3AF' }}>(optional)</span></label>
                <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)} style={inputStyle} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={labelStyle}>Company Size</label>
                  <select value={companySize} onChange={e => setCompanySize(e.target.value)} style={inputStyle}>
                    <option value="">Select...</option>
                    <option value="1">Just me</option>
                    <option value="2-10">2-10 employees</option>
                    <option value="11-50">11-50</option>
                    <option value="51-200">51-200</option>
                    <option value="201-1000">201-1,000</option>
                    <option value="1000+">1,000+</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>State</label>
                  <input type="text" value={companyState} onChange={e => setCompanyState(e.target.value.toUpperCase().slice(0,2))} placeholder="CO" maxLength={2} style={inputStyle} />
                </div>
              </div>
            </>
          )}

          <div>
            <label style={labelStyle}>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} required autoFocus />
          </div>
          {mode !== 'forgot' && (
            <div>
              <label style={labelStyle}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} style={inputStyle} required minLength={8} />
              {mode === 'login' && (
                <div style={{ textAlign: 'right', marginTop: 6 }}>
                  <a href="#" onClick={e => { e.preventDefault(); setMode('forgot'); setError(null); setResetSent(false) }} style={{ fontSize: 12, color: '#6B7280' }}>Forgot password?</a>
                </div>
              )}
            </div>
          )}

          {mode === 'forgot' && resetSent && (
            <div style={{ padding: '16px', background: '#ECFDF5', borderRadius: 6, color: '#047857', fontSize: 13, lineHeight: 1.5 }}>
              Check your email for a password reset link. If you don't see it, check your spam folder.
            </div>
          )}

          {error && <div style={{ color: '#B91C1C', fontSize: 13 }}>{error}</div>}

          {!(mode === 'forgot' && resetSent) && (
            <button type="submit" className="btn btn-navy" style={{ width: '100%', justifyContent: 'center', padding: '12px', fontSize: 15 }} disabled={loading}>
              {loading ? 'Working...' : mode === 'login' ? 'Sign In' : mode === 'register' ? 'Create Account' : 'Send Reset Link'}
            </button>
          )}
        </form>

        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 13, color: '#6B7280' }}>
          {mode === 'login' ? (
            <>Don't have an account? <a href="#" onClick={e => { e.preventDefault(); setMode('register'); setError(null) }} style={{ color: '#1B3A6B', fontWeight: 600 }}>Sign up free</a></>
          ) : mode === 'register' ? (
            <>Already have an account? <a href="#" onClick={e => { e.preventDefault(); setMode('login'); setError(null) }} style={{ color: '#1B3A6B', fontWeight: 600 }}>Sign in</a></>
          ) : (
            <><a href="#" onClick={e => { e.preventDefault(); setMode('login'); setError(null); setResetSent(false) }} style={{ color: '#1B3A6B', fontWeight: 600 }}>Back to sign in</a></>
          )}
        </div>
      </div>

      {mode === 'register' && (
        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 12, color: '#9CA3AF', lineHeight: 1.5 }}>
          Everything is free except intelligence reports ($5 each).
          <br />We recommend starting with $20 in credits (4 reports).
        </div>
      )}
    </div>
  )
}

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 4 }
const inputStyle = { width: '100%', padding: '10px 12px', fontSize: 14, border: '1px solid #E2E4E9', borderRadius: 6, fontFamily: 'inherit', outline: 'none' }
