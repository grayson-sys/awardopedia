export default function Terms({ onBack }) {
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
        Terms of Service
      </h1>
      <p style={{ color: 'var(--color-muted)', fontSize: 13, marginBottom: 32 }}>
        Effective date: March 18, 2026
      </p>

      <div style={{ lineHeight: 1.7, color: 'var(--color-text)' }}>
        <Section title="1. What Awardopedia is">
          Awardopedia reorganizes public US government data from USASpending.gov, SAM.gov,
          and FPDS into a searchable, human-readable format. We do not create, verify, or
          modify the underlying government data. All data originates from official US
          government sources and is in the public domain.
        </Section>

        <Section title="2. Free access">
          The Awardopedia website and public API are free to use for searching, browsing,
          and individual record access. No account is required for basic use.
        </Section>

        <Section title="3. API usage">
          <p>Use of the Awardopedia API requires a free registration. You agree to:</p>
          <ul style={{ marginTop: 8, paddingLeft: 20 }}>
            <li>Stay within your rate limits (1,000 req/day, 5,000 req/week on the free tier)</li>
            <li>Attribute Awardopedia.com when displaying our data to end users</li>
            <li>Not use the API to bulk-download our database</li>
            <li>Not use API data to train machine learning models</li>
            <li>Not resell raw API data as a standalone product</li>
          </ul>
        </Section>

        <Section title="4. Paid reports">
          AI-generated reports are produced using Claude (by Anthropic) and are sold as a
          convenience service. Reports are based on public government data. Awardopedia
          makes no warranty as to the accuracy or completeness of AI-generated analysis.
          Reports are non-refundable once generated. Cached reports may be served for up
          to 90 days after initial generation.
        </Section>

        <Section title="5. Data accuracy">
          All data is sourced from official US government databases. Awardopedia does not
          independently verify government data. Known data quality issues include: duplicate
          records, missing agency submissions, amounts that do not reconcile. Source links
          to USASpending.gov and SAM.gov are provided on every record. If a source link is
          no longer available, we provide a PIID-based search fallback.
        </Section>

        <Section title="6. Prohibited uses">
          <p>You may not use Awardopedia to:</p>
          <ul style={{ marginTop: 8, paddingLeft: 20 }}>
            <li>Scrape or bulk-download our database</li>
            <li>Build a competing service using our organized data</li>
            <li>Train AI or machine learning models</li>
            <li>Bypass rate limits through multiple API keys</li>
            <li>Represent our AI-generated reports as professional legal or financial advice</li>
          </ul>
        </Section>

        <Section title="7. AI-generated content">
          Reports generated on Awardopedia are powered by Claude (Anthropic). The AI
          analysis is for informational purposes only and does not constitute legal,
          financial, or procurement advice. Always consult a qualified professional for
          important business decisions.
        </Section>

        <Section title="8. Contact">
          <a href="mailto:legal@awardopedia.com">legal@awardopedia.com</a>
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-navy)', marginBottom: 8 }}>
        {title}
      </h2>
      <div>{children}</div>
    </div>
  )
}
