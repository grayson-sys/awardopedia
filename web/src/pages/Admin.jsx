import { useState, useEffect } from 'react'

export default function Admin({ onBack }) {
  const [qualityRuns, setQualityRuns] = useState([])
  const [feedback, setFeedback] = useState([])
  const [stats, setStats] = useState(null)

  useEffect(() => {
    fetch('/api/admin/quality-runs').then(r => r.json()).then(setQualityRuns).catch(() => {})
    fetch('/api/admin/feedback').then(r => r.json()).then(setFeedback).catch(() => {})
    fetch('/api/admin/stats').then(r => r.json()).then(setStats).catch(() => {})
  }, [])

  const latestScore = qualityRuns[0]?.score
  const scoreColor = latestScore >= 90 ? '#059669' : latestScore >= 80 ? '#E9A820' : '#dc3545'

  return (
    <div className="container" style={{ padding: '24px' }}>
      <button className="back-btn" onClick={onBack}>Back</button>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1B3A6B', marginBottom: 24 }}>Admin Dashboard</h1>

      {/* Stats cards */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Opportunities', value: stats.opportunities },
            { label: 'Contracts', value: stats.contracts },
            { label: 'Intel Records', value: stats.intel },
            { label: 'Office Codes', value: stats.office_codes },
            { label: 'NAICS Codes', value: stats.naics },
            { label: 'PSC Codes', value: stats.psc },
          ].map(({ label, value }) => (
            <div key={label} className="card" style={{ textAlign: 'center', padding: 16 }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#1B3A6B' }}>{(value || 0).toLocaleString()}</div>
              <div style={{ fontSize: 12, color: '#6B7280' }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Data Quality Trend */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="section-title">Data Quality Trend</div>
        {qualityRuns.length === 0 ? (
          <p className="text-muted text-sm">No quality runs yet. Run: python3 scripts/qa_data_quality.py</p>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
              <span style={{ fontSize: 36, fontWeight: 700, color: scoreColor }}>{latestScore?.toFixed(1)}</span>
              <span style={{ fontSize: 14, color: '#6B7280' }}>/ 100 latest score</span>
            </div>
            <table className="data-table" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Score</th>
                  <th>Sample</th>
                  <th>Issues</th>
                  <th>Fixed</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {qualityRuns.map((run, i) => (
                  <tr key={i}>
                    <td>{new Date(run.run_date).toLocaleDateString()}</td>
                    <td style={{ fontWeight: 600, color: run.score >= 90 ? '#059669' : run.score >= 80 ? '#E9A820' : '#dc3545' }}>
                      {Number(run.score).toFixed(1)}
                    </td>
                    <td>{run.sample_size} / {run.total_records}</td>
                    <td>{run.issues_found}</td>
                    <td>{run.issues_fixed}</td>
                    <td>{run.run_type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* User Feedback */}
      <div className="card">
        <div className="section-title">User Feedback ({feedback.length})</div>
        {feedback.length === 0 ? (
          <p className="text-muted text-sm">No feedback yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {feedback.map((f, i) => (
              <div key={i} style={{ padding: '10px 12px', background: '#F9FAFB', borderRadius: 6, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span className="mono text-muted" style={{ fontSize: 11 }}>{f.notice_id?.slice(0, 16) || 'general'}</span>
                  <span className="text-muted" style={{ fontSize: 11 }}>{new Date(f.ts).toLocaleDateString()}</span>
                </div>
                <div>{f.message}</div>
                {f.email && <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>{f.email}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
