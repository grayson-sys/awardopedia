import { useState } from 'react'

export default function ApiKeys({ onBack }) {
  const [form, setForm] = useState({ name: '', email: '', organization: '', use_case: '' })
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  function update(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/v1/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Registration failed')
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const inputStyle = {
    width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius)', fontSize: 14, fontFamily: 'var(--font-sans)',
    background: 'var(--color-white)'
  }
  const labelStyle = {
    display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4, color: 'var(--color-text)'
  }

  return (
    <div className="container" style={{ maxWidth: 720, padding: '40px 24px 80px' }}>
      <button
        onClick={onBack}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--color-navy)', fontWeight: 500, fontSize: 13,
          marginBottom: 24, padding: 0
        }}
      >
        &larr; Back
      </button>

      <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-navy)', marginBottom: 8 }}>
        Awardopedia API
      </h1>
      <p style={{ color: 'var(--color-muted)', fontSize: 14, marginBottom: 32, lineHeight: 1.6 }}>
        Free access to federal contract and opportunity data. Register below
        to get your API key — no credit card required.
      </p>

      {/* API docs summary */}
      <div className="card" style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-navy)', marginBottom: 12 }}>
          Endpoints
        </h2>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 2 }}>
          <div><span style={{ color: 'var(--color-success)', fontWeight: 600 }}>GET</span> /api/v1/contracts</div>
          <div><span style={{ color: 'var(--color-success)', fontWeight: 600 }}>GET</span> /api/v1/contracts/:piid</div>
          <div><span style={{ color: 'var(--color-success)', fontWeight: 600 }}>GET</span> /api/v1/opportunities</div>
          <div><span style={{ color: 'var(--color-success)', fontWeight: 600 }}>GET</span> /api/v1/opportunities/:notice_id</div>
          <div><span style={{ color: 'var(--color-success)', fontWeight: 600 }}>GET</span> /api/v1/stats</div>
        </div>
        <div style={{ marginTop: 16, fontSize: 13, color: 'var(--color-muted)' }}>
          <strong>Auth:</strong> Pass your key via <code style={{ background: 'var(--color-navy-light)', padding: '2px 6px', borderRadius: 3 }}>X-Awardopedia-Key</code> header<br />
          <strong>Rate limits:</strong> 1,000 requests/day &middot; 5,000 requests/week<br />
          <strong>Base URL:</strong> <code style={{ background: 'var(--color-navy-light)', padding: '2px 6px', borderRadius: 3 }}>https://api.awardopedia.com/v1/</code>
        </div>
      </div>

      {/* Filters reference */}
      <div className="card" style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-navy)', marginBottom: 12 }}>
          Query Filters
        </h2>
        <div style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--color-text)' }}>
          <strong>/contracts</strong> — <code>agency</code>, <code>naics</code>, <code>state</code>, <code>set_aside</code>, <code>expiring_within_days</code>, <code>min_amount</code>, <code>max_amount</code>, <code>q</code> (full text), <code>page</code>, <code>limit</code><br />
          <strong>/opportunities</strong> — <code>agency</code>, <code>naics</code>, <code>state</code>, <code>set_aside</code>, <code>deadline_within_days</code>, <code>is_recompete</code>, <code>q</code>, <code>page</code>, <code>limit</code>
        </div>
      </div>

      {/* Registration form */}
      {result ? (
        <div className="card" style={{ background: 'var(--color-navy-light)', borderLeft: '4px solid var(--color-navy)' }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-navy)', marginBottom: 8 }}>
            Your API Key
          </h2>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 600,
            background: 'var(--color-white)', padding: '12px 16px', borderRadius: 'var(--radius)',
            border: '1px solid var(--color-border)', marginBottom: 12, wordBreak: 'break-all'
          }}>
            {result.api_key}
          </div>
          <p style={{ fontSize: 13, color: 'var(--color-muted)', lineHeight: 1.6 }}>
            Copy this key now — it will not be shown again. A copy has also been
            sent to <strong>{form.email}</strong>. Pass it via the
            <code style={{ background: 'var(--color-white)', padding: '2px 6px', borderRadius: 3, margin: '0 2px' }}>X-Awardopedia-Key</code> header.
          </p>
        </div>
      ) : (
        <div className="card">
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-navy)', marginBottom: 16 }}>
            Register for an API Key
          </h2>
          {error && (
            <div style={{ background: '#FEF2F2', color: 'var(--color-danger)', padding: '10px 14px', borderRadius: 'var(--radius)', fontSize: 13, marginBottom: 16 }}>
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Full name *</label>
              <input style={inputStyle} required value={form.name} onChange={e => update('name', e.target.value)} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Email *</label>
              <input style={inputStyle} type="email" required value={form.email} onChange={e => update('email', e.target.value)} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Organization</label>
              <input style={inputStyle} value={form.organization} onChange={e => update('organization', e.target.value)} placeholder="Optional" />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={labelStyle}>What will you build? *</label>
              <textarea
                style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
                required
                value={form.use_case}
                onChange={e => update('use_case', e.target.value)}
                placeholder="e.g., Dashboard for small business contract discovery"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              style={{
                background: 'var(--color-navy)', color: 'var(--color-white)',
                border: 'none', borderRadius: 'var(--radius)', padding: '10px 24px',
                fontSize: 14, fontWeight: 600, cursor: submitting ? 'wait' : 'pointer',
                opacity: submitting ? 0.7 : 1
              }}
            >
              {submitting ? 'Generating key...' : 'Get API Key'}
            </button>
          </form>
          <p style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 16 }}>
            By registering you agree to our <a href="#" onClick={(e) => { e.preventDefault(); onBack?.('terms') }} style={{ color: 'var(--color-navy)' }}>Terms of Service</a>.
          </p>
        </div>
      )}
    </div>
  )
}
