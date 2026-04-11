import { useState, useEffect } from 'react'
import { ArrowLeft, CreditCard } from 'lucide-react'

export default function Credits({ user, token, onBack }) {
  const [packs, setPacks] = useState([])
  const [selectedPack, setSelectedPack] = useState(null)
  const [credits, setCredits] = useState(user?.credits ?? null)
  const [history, setHistory] = useState([])
  const [purchasing, setPurchasing] = useState(null)
  const [error, setError] = useState(null)

  // When packs load, select the default
  useEffect(() => {
    if (packs.length && !selectedPack) {
      const def = packs.find(p => p.isDefault) || packs[0]
      setSelectedPack(def.key)
    }
  }, [packs])

  useEffect(() => {
    fetch('/api/credits/packs').then(r => r.json()).then(setPacks).catch(() => {})
    if (token) {
      fetch('/api/credits', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json()).then(d => setCredits(d.credits)).catch(() => {})
      fetch('/api/credits/history', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json()).then(setHistory).catch(() => {})
    }
  }, [token])

  // Check URL for success/cancel on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('credits') === 'success') {
      // Refresh credit balance
      if (token) {
        fetch('/api/credits', { headers: { Authorization: `Bearer ${token}` } })
          .then(r => r.json()).then(d => setCredits(d.credits)).catch(() => {})
      }
    }
  }, [token])

  async function buyPack(packKey) {
    if (!token) {
      setError('Please sign in to purchase credits.')
      return
    }
    setPurchasing(packKey)
    setError(null)
    try {
      const res = await fetch('/api/credits/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pack: packKey })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Purchase failed')
      // Redirect to Stripe Checkout
      window.location.href = data.url
    } catch (e) {
      setError(e.message)
    } finally {
      setPurchasing(null)
    }
  }

  return (
    <div className="container" style={{ maxWidth: 800, padding: '32px 16px' }}>
      <button className="back-btn" onClick={onBack} style={{ marginBottom: 24 }}>
        <ArrowLeft size={14} /> Back
      </button>

      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Report Credits</h1>
      <p style={{ color: 'var(--color-muted)', marginBottom: 24 }}>
        Credits power AI-generated bid intelligence reports. Each report costs 1 credit and includes
        competitive landscape, incumbent analysis, pricing insights, and a step-by-step action plan.
      </p>

      {credits !== null && (
        <div className="card" style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
          <CreditCard size={20} style={{ color: 'var(--color-navy)' }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{credits} credits</div>
            <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>Your current balance</div>
          </div>
        </div>
      )}

      {error && (
        <div style={{ color: 'var(--color-danger)', marginBottom: 16, fontSize: 13 }}>{error}</div>
      )}

      {(() => {
        const current = packs.find(p => p.key === selectedPack)
        if (!current) return null
        const perReport = (current.cents / 100 / current.credits).toFixed(2)
        return (
          <div className="card" style={{
            padding: 32,
            marginBottom: 32,
            border: '2px solid var(--color-navy)',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 48, fontWeight: 700, color: 'var(--color-navy)', lineHeight: 1 }}>
              {current.price}
            </div>
            <div style={{ fontSize: 16, marginTop: 8, color: 'var(--color-text)' }}>
              {current.credits} reports · ${perReport}/report
            </div>

            <div style={{ marginTop: 20 }}>
              <select
                value={selectedPack}
                onChange={e => setSelectedPack(e.target.value)}
                style={{
                  padding: '8px 14px',
                  fontSize: 14,
                  border: '1px solid var(--color-border)',
                  borderRadius: 6,
                  background: 'var(--color-white)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {packs.map(p => (
                  <option key={p.key} value={p.key}>
                    {p.price} — {p.credits} reports{p.isDefault ? ' (recommended)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <button
              className="btn btn-navy"
              style={{ marginTop: 20, padding: '12px 32px', fontSize: 15, justifyContent: 'center' }}
              onClick={() => buyPack(current.key)}
              disabled={purchasing === current.key}
            >
              {purchasing === current.key ? 'Redirecting to checkout...' : `Buy ${current.credits} report${current.credits > 1 ? 's' : ''} for ${current.price}`}
            </button>
          </div>
        )
      })()}

      {/* Purchase history */}
      {history.length > 0 && (
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Purchase History</h2>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Pack</th>
                  <th>Credits</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i}>
                    <td>{new Date(h.created_at).toLocaleDateString()}</td>
                    <td style={{ textTransform: 'capitalize' }}>{h.pack_name}</td>
                    <td>{h.credits}</td>
                    <td style={{ textAlign: 'right' }}>${(h.amount_cents / 100).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ marginTop: 32, fontSize: 12, color: 'var(--color-muted)' }}>
        Payments processed securely by Stripe. Credits never expire. Reports are cached for 90 days —
        generating a report for the same record twice uses the cached version at no extra cost.
      </div>
    </div>
  )
}
