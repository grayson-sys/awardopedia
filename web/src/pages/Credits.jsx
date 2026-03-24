import { useState, useEffect } from 'react'
import { ArrowLeft, CreditCard, Zap, Star, Rocket } from 'lucide-react'

const PACK_ICONS = { starter: Zap, pro: Star, power: Rocket }

export default function Credits({ user, token, onBack }) {
  const [packs, setPacks] = useState([])
  const [credits, setCredits] = useState(user?.credits ?? null)
  const [history, setHistory] = useState([])
  const [purchasing, setPurchasing] = useState(null)
  const [error, setError] = useState(null)

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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 32 }}>
        {packs.map(p => {
          const Icon = PACK_ICONS[p.key] || Zap
          const isPopular = p.key === 'pro'
          return (
            <div
              key={p.key}
              className="card"
              style={{
                textAlign: 'center',
                padding: 24,
                border: isPopular ? '2px solid var(--color-navy)' : undefined,
                position: 'relative',
              }}
            >
              {isPopular && (
                <div style={{
                  position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)',
                  background: 'var(--color-navy)', color: '#fff', fontSize: 10, fontWeight: 700,
                  padding: '2px 10px', borderRadius: 10, textTransform: 'uppercase'
                }}>
                  Most Popular
                </div>
              )}
              <Icon size={28} style={{ color: 'var(--color-navy)', marginBottom: 8 }} />
              <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 4 }}>{p.price}</div>
              <div style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 4 }}>{p.credits} credits</div>
              <div style={{ fontSize: 11, color: 'var(--color-muted)', marginBottom: 16 }}>
                ${(parseInt(p.price.replace('$', '')) / p.credits).toFixed(2)}/report
              </div>
              <button
                className={`btn ${isPopular ? 'btn-navy' : 'btn-outline'}`}
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => buyPack(p.key)}
                disabled={purchasing === p.key}
              >
                {purchasing === p.key ? 'Redirecting...' : `Buy ${p.label.split('—')[0].trim()}`}
              </button>
            </div>
          )
        })}
      </div>

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
