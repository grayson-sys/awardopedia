import { ArrowLeft } from 'lucide-react'

export default function About({ onBack }) {
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

        <p style={{ marginBottom: 20 }}>
          For questions, feedback, or press inquiries, please reach out via the contact form
          or email <a href="mailto:hello@awardopedia.com" style={{ color: '#4F46E5' }}>hello@awardopedia.com</a>.
        </p>

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
