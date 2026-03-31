import { useState } from 'react'
import { ArrowLeft, Send } from 'lucide-react'

export default function About({ onBack }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!message.trim()) return
    setSending(true)
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notice_id: null,
          email: email || null,
          message: `[Contact Form] ${name ? `From: ${name}\n` : ''}${message}`
        })
      })
      setSent(true)
      setName('')
      setEmail('')
      setMessage('')
    } catch (err) {
      alert('Failed to send. Please try again.')
    }
    setSending(false)
  }

  return (
    <div className="page-container" style={{ maxWidth: 800, margin: '0 auto', padding: '32px 24px' }}>
      <button
        onClick={onBack}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'none', border: 'none', color: '#4F46E5',
          cursor: 'pointer', marginBottom: 24, padding: 0,
          fontSize: 14, fontWeight: 500
        }}
      >
        <ArrowLeft size={16} /> Back
      </button>

      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 24, color: '#1E3A5F' }}>
        About Awardopedia
      </h1>

      <div style={{ fontSize: 15, lineHeight: 1.7, color: '#374151' }}>
        <p style={{ marginBottom: 20 }}>
          Awardopedia is a free, searchable database that makes federal contract data easier to find and understand.
          It combines data from two official government sources—<a href="https://usaspending.gov" target="_blank" rel="noopener noreferrer" style={{ color: '#4F46E5' }}>USASpending.gov</a> (past contract awards)
          and <a href="https://sam.gov" target="_blank" rel="noopener noreferrer" style={{ color: '#4F46E5' }}>SAM.gov</a> (active contract opportunities)—into
          a single interface designed for speed and clarity.
        </p>

        <p style={{ marginBottom: 20 }}>
          The federal government awards over $700 billion in contracts each year, but the official databases
          can be difficult to navigate. Awardopedia aims to make this information more accessible
          to small businesses looking for opportunities, researchers studying federal spending patterns,
          and journalists covering government accountability.
        </p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 16, color: '#1E3A5F' }}>
          What you can do here
        </h2>

        <ul style={{ marginBottom: 20, paddingLeft: 24 }}>
          <li style={{ marginBottom: 8 }}>
            <strong>Search past awards</strong> — Find contracts by keyword, agency, recipient, or NAICS code.
            See award amounts, contract types, and performance periods.
          </li>
          <li style={{ marginBottom: 8 }}>
            <strong>Browse active opportunities</strong> — Discover upcoming solicitations with plain-English summaries.
            Filter by set-aside type, deadline, and estimated value.
          </li>
          <li style={{ marginBottom: 8 }}>
            <strong>View leaderboards</strong> — See which companies and agencies are most active in federal contracting.
          </li>
        </ul>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 16, color: '#1E3A5F' }}>
          About this project
        </h2>

        <p style={{ marginBottom: 20 }}>
          Awardopedia is a personal project by a journalist who covers federal spending and government transparency.
          It is not affiliated with USASpending.gov, SAM.gov, or any component of the U.S. government.
        </p>

        <p style={{ marginBottom: 20 }}>
          The data comes directly from official government APIs and is updated regularly.
          For active opportunities, we use AI to generate plain-English summaries from
          solicitation documents—these summaries are provided for convenience and should not
          be used as a substitute for reading the official documents.
        </p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 16, color: '#1E3A5F' }}>
          Contact
        </h2>

        <p style={{ marginBottom: 16 }}>
          For questions, feedback, or press inquiries, send us a note:
        </p>

        {sent ? (
          <div style={{
            padding: 16,
            background: '#F0FDF4',
            border: '1px solid #BBF7D0',
            borderRadius: 8,
            marginBottom: 20,
            color: '#065F46'
          }}>
            Thanks for reaching out! We'll get back to you soon.
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ marginBottom: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <input
                type="text"
                placeholder="Name (optional)"
                value={name}
                onChange={e => setName(e.target.value)}
                style={{
                  padding: '10px 12px',
                  border: '1px solid #D1D5DB',
                  borderRadius: 6,
                  fontSize: 14
                }}
              />
              <input
                type="email"
                placeholder="Email (optional)"
                value={email}
                onChange={e => setEmail(e.target.value)}
                style={{
                  padding: '10px 12px',
                  border: '1px solid #D1D5DB',
                  borderRadius: 6,
                  fontSize: 14
                }}
              />
            </div>
            <textarea
              placeholder="Your message..."
              value={message}
              onChange={e => setMessage(e.target.value)}
              required
              rows={4}
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #D1D5DB',
                borderRadius: 6,
                fontSize: 14,
                resize: 'vertical',
                marginBottom: 12,
                boxSizing: 'border-box'
              }}
            />
            <button
              type="submit"
              disabled={sending || !message.trim()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 20px',
                background: sending ? '#9CA3AF' : '#4F46E5',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 500,
                cursor: sending ? 'not-allowed' : 'pointer'
              }}
            >
              <Send size={16} />
              {sending ? 'Sending...' : 'Send Message'}
            </button>
          </form>
        )}

        <div style={{
          marginTop: 40,
          padding: 16,
          background: '#F3F4F6',
          borderRadius: 8,
          fontSize: 13,
          color: '#6B7280'
        }}>
          <strong>Disclaimer:</strong> This website is not affiliated with USASpending.gov, SAM.gov,
          the General Services Administration, or any other component of the U.S. government.
          All data is sourced from public government APIs. While we strive for accuracy,
          users should verify information against official sources before making business decisions.
        </div>
      </div>
    </div>
  )
}
