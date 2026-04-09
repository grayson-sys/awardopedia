import { useState, useRef, useEffect } from 'react'

export default function AskAI() {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: "Hi! I can search federal contract opportunities for you. Try asking:\n\n• \"Find cybersecurity contracts in Virginia\"\n• \"What SDVOSB opportunities are due this week?\"\n• \"Search for janitorial services under $500K\"" }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!input.trim() || loading) return

    const userMessage = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setLoading(true)

    try {
      const res = await fetch('/api/ai/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: userMessage })
      })
      const data = await res.json()

      if (data.error) {
        setMessages(prev => [...prev, { role: 'assistant', content: `Sorry, something went wrong: ${data.error}` }])
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: data.response, opportunities: data.opportunities }])
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I had trouble connecting. Please try again.' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px', height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1B3A6B', marginBottom: 8 }}>
          Ask AI
        </h1>
        <p style={{ color: '#6B7280', fontSize: 14 }}>
          Search federal contracts using natural language. Powered by Claude.
        </p>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', marginBottom: 16, padding: '0 4px' }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ marginBottom: 16 }}>
            <div style={{
              display: 'flex',
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start'
            }}>
              <div style={{
                maxWidth: '85%',
                padding: '12px 16px',
                borderRadius: 12,
                background: msg.role === 'user' ? '#1B3A6B' : '#F3F4F6',
                color: msg.role === 'user' ? '#fff' : '#374151',
                whiteSpace: 'pre-wrap',
                lineHeight: 1.5,
                fontSize: 14
              }}>
                {msg.content}
              </div>
            </div>

            {/* Opportunity cards */}
            {msg.opportunities && msg.opportunities.length > 0 && (
              <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
                {msg.opportunities.map((opp, j) => (
                  <a
                    key={j}
                    href={`/opportunity/${opp.slug || opp.notice_id}`}
                    style={{ textDecoration: 'none' }}
                  >
                    <div style={{
                      background: '#fff',
                      border: '1px solid #E2E4E9',
                      borderRadius: 8,
                      padding: 16,
                      transition: 'border-color 0.15s',
                      cursor: 'pointer'
                    }}
                    onMouseOver={e => e.currentTarget.style.borderColor = '#1B3A6B'}
                    onMouseOut={e => e.currentTarget.style.borderColor = '#E2E4E9'}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 8 }}>
                        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#1B3A6B', flex: 1 }}>
                          {opp.title}
                        </h3>
                        {opp.set_aside_type && (
                          <span style={{
                            background: '#E9A820',
                            color: '#1B3A6B',
                            padding: '2px 8px',
                            borderRadius: 12,
                            fontSize: 11,
                            fontWeight: 600,
                            marginLeft: 8,
                            whiteSpace: 'nowrap'
                          }}>
                            {opp.set_aside_type}
                          </span>
                        )}
                      </div>
                      <p style={{ margin: '0 0 8px', fontSize: 13, color: '#6B7280' }}>
                        {opp.agency_name}
                        {opp.response_deadline && ` · Due: ${new Date(opp.response_deadline).toLocaleDateString()}`}
                      </p>
                      {opp.llama_summary && (
                        <p style={{ margin: 0, fontSize: 13, color: '#374151', lineHeight: 1.5 }}>
                          {opp.llama_summary.slice(0, 200)}{opp.llama_summary.length > 200 ? '...' : ''}
                        </p>
                      )}
                      <div style={{ marginTop: 8, display: 'flex', gap: 12, fontSize: 12, color: '#9CA3AF' }}>
                        {opp.naics_code && <span>NAICS: {opp.naics_code}</span>}
                        {opp.place_of_performance_state && <span>{opp.place_of_performance_state}</span>}
                        {opp.estimated_value_max && <span>${Number(opp.estimated_value_max).toLocaleString()}</span>}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 16 }}>
            <div style={{
              padding: '12px 16px',
              borderRadius: 12,
              background: '#F3F4F6',
              color: '#6B7280',
              fontSize: 14
            }}>
              <span className="loading-dots">Searching</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 12 }}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask about federal contracts..."
          style={{
            flex: 1,
            padding: '14px 16px',
            fontSize: 15,
            border: '2px solid #E2E4E9',
            borderRadius: 12,
            outline: 'none',
            transition: 'border-color 0.15s'
          }}
          onFocus={e => e.target.style.borderColor = '#1B3A6B'}
          onBlur={e => e.target.style.borderColor = '#E2E4E9'}
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          style={{
            padding: '14px 24px',
            fontSize: 15,
            fontWeight: 600,
            background: loading || !input.trim() ? '#9CA3AF' : '#1B3A6B',
            color: '#fff',
            border: 'none',
            borderRadius: 12,
            cursor: loading || !input.trim() ? 'not-allowed' : 'pointer'
          }}
        >
          {loading ? '...' : 'Search'}
        </button>
      </form>

      {/* Footer note */}
      <p style={{ textAlign: 'center', fontSize: 12, color: '#9CA3AF', marginTop: 16 }}>
        Beta · Powered by Claude · <a href="/ai-assistant" style={{ color: '#6B7280' }}>Set up your own AI assistant</a>
      </p>

      <style>{`
        .loading-dots::after {
          content: '';
          animation: dots 1.5s infinite;
        }
        @keyframes dots {
          0%, 20% { content: '.'; }
          40% { content: '..'; }
          60%, 100% { content: '...'; }
        }
      `}</style>
    </div>
  )
}
