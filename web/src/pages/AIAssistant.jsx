export default function AIAssistant() {
  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '40px 24px' }}>
      {/* Hero */}
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <h1 style={{ fontSize: 36, fontWeight: 700, color: '#1B3A6B', marginBottom: 16 }}>
          The Future of Federal Contract Search
        </h1>
        <p style={{ fontSize: 18, color: '#6B7280', lineHeight: 1.6 }}>
          Stop scrolling through endless grids. Just tell your AI assistant what you're looking for.
        </p>
      </div>

      {/* The Problem */}
      <div className="card" style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: '#1B3A6B', marginBottom: 16 }}>
          Grid search is dead
        </h2>
        <p style={{ color: '#374151', lineHeight: 1.7, marginBottom: 16 }}>
          For decades, finding federal contracts meant the same thing: log into SAM.gov, set 15 filters,
          scroll through pages of results, click into each one, squint at PDFs. Repeat daily.
        </p>
        <p style={{ color: '#374151', lineHeight: 1.7 }}>
          That's not how humans naturally find things. You don't "filter" when you ask a colleague for help.
          You say: <em>"Hey, know of any IT contracts coming up in Virginia? Ideally small business set-asides."</em>
        </p>
      </div>

      {/* The Future */}
      <div className="card" style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: '#1B3A6B', marginBottom: 16 }}>
          Talk to your AI, not a search box
        </h2>
        <p style={{ color: '#374151', lineHeight: 1.7, marginBottom: 16 }}>
          With Awardopedia's MCP server, your AI assistant becomes your government contracts researcher.
          Just ask Claude:
        </p>
        <div style={{ background: '#F8F9FB', borderRadius: 8, padding: 20, marginBottom: 16 }}>
          <p style={{ fontStyle: 'italic', color: '#1B3A6B', margin: '0 0 12px' }}>
            "Find me cybersecurity contracts in the DC area due in the next 30 days"
          </p>
          <p style={{ fontStyle: 'italic', color: '#1B3A6B', margin: '0 0 12px' }}>
            "What SDVOSB opportunities are available for construction?"
          </p>
          <p style={{ fontStyle: 'italic', color: '#1B3A6B', margin: 0 }}>
            "Search for janitorial services contracts in Colorado under $500K"
          </p>
        </div>
        <p style={{ color: '#374151', lineHeight: 1.7 }}>
          Claude searches Awardopedia, reads the solicitations, and gives you a summary. No clicking. No scrolling.
          No deciphering cryptic government acronyms.
        </p>
      </div>

      {/* What is MCP */}
      <div className="card" style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: '#1B3A6B', marginBottom: 16 }}>
          What is MCP?
        </h2>
        <p style={{ color: '#374151', lineHeight: 1.7, marginBottom: 16 }}>
          <strong>Model Context Protocol (MCP)</strong> is Anthropic's open standard for connecting AI assistants
          to external data sources. Think of it as giving Claude the ability to "plug in" to services like Awardopedia.
        </p>
        <p style={{ color: '#374151', lineHeight: 1.7 }}>
          When you install the Awardopedia MCP server, Claude can directly search our database of federal opportunities
          — no copy-pasting, no switching tabs. Just conversation.
        </p>
      </div>

      {/* Setup Instructions */}
      <div className="card" style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: '#1B3A6B', marginBottom: 16 }}>
          Set it up in 2 minutes
        </h2>

        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
            1. Get your free API key
          </h3>
          <p style={{ color: '#6B7280', marginBottom: 8 }}>
            <a href="/signup" style={{ color: '#1B3A6B', fontWeight: 500 }}>Sign up for Awardopedia</a> (free),
            then go to Dashboard → API Keys and create a key.
          </p>
        </div>

        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
            2. Add to Claude Desktop
          </h3>
          <p style={{ color: '#6B7280', marginBottom: 12 }}>
            Edit your Claude Desktop config file:
          </p>
          <p style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 8 }}>
            <strong>Mac:</strong> ~/Library/Application Support/Claude/claude_desktop_config.json<br/>
            <strong>Windows:</strong> %APPDATA%\Claude\claude_desktop_config.json
          </p>
          <pre style={{ background: '#1B3A6B', color: '#fff', padding: 16, borderRadius: 8, fontSize: 13, overflow: 'auto' }}>
{`{
  "mcpServers": {
    "awardopedia": {
      "command": "npx",
      "args": ["-y", "awardopedia-mcp"],
      "env": {
        "AWARDOPEDIA_API_KEY": "ak_your_key_here"
      }
    }
  }
}`}
          </pre>
        </div>

        <div>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
            3. Restart Claude Desktop
          </h3>
          <p style={{ color: '#6B7280' }}>
            That's it. Ask Claude about federal contracts and watch the magic happen.
          </p>
        </div>
      </div>

      {/* Rate Limits */}
      <div className="card" style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: '#1B3A6B', marginBottom: 16 }}>
          Free tier limits
        </h2>
        <ul style={{ color: '#374151', lineHeight: 1.8, paddingLeft: 20 }}>
          <li><strong>10 searches per day</strong> — enough for daily prospecting</li>
          <li><strong>25 results per search</strong> — focused, relevant matches</li>
          <li>Full access to opportunity details, PDFs, and contact info</li>
        </ul>
        <p style={{ color: '#6B7280', marginTop: 16, fontSize: 14 }}>
          Need more? Contact <a href="mailto:api@awardopedia.com" style={{ color: '#1B3A6B' }}>api@awardopedia.com</a>
        </p>
      </div>

      {/* Vision */}
      <div className="card" style={{ background: '#1B3A6B', color: '#fff' }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>
          Finally, a good use for an algorithm
        </h2>
        <p style={{ lineHeight: 1.7, opacity: 0.9 }}>
          We built Awardopedia because small businesses deserve the same intelligence tools that big contractors have.
          AI shouldn't just serve advertisers — it should help you find real opportunities to grow your business.
        </p>
        <p style={{ lineHeight: 1.7, opacity: 0.9, marginTop: 16, marginBottom: 0 }}>
          The grid search era is ending. The conversation era is here.
        </p>
      </div>

      {/* Beta note */}
      <p style={{ textAlign: 'center', color: '#9CA3AF', fontSize: 13, marginTop: 32 }}>
        Beta — We're actively cleaning and adding data every day. Results improve continuously.
      </p>
    </div>
  )
}
