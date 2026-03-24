import { useState, useEffect } from 'react'

export default function Admin({ onBack, onJurisdictions }) {
  const [qualityRuns, setQualityRuns] = useState([])
  const [feedback, setFeedback] = useState([])
  const [pipelineRules, setPipelineRules] = useState([])
  const [stats, setStats] = useState(null)

  function loadData() {
    fetch('/api/admin/quality-runs').then(r => r.json()).then(setQualityRuns).catch(() => {})
    fetch('/api/admin/feedback').then(r => r.json()).then(setFeedback).catch(() => {})
    fetch('/api/admin/pipeline-feedback').then(r => r.json()).then(setPipelineRules).catch(() => {})
    fetch('/api/admin/stats').then(r => r.json()).then(setStats).catch(() => {})
  }

  useEffect(loadData, [])

  async function handleRuleAction(id, status) {
    await fetch('/api/admin/approve-rule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status })
    })
    loadData()
  }

  const latestScore = qualityRuns[0]?.score != null ? Number(qualityRuns[0].score) : null
  const scoreColor = latestScore >= 90 ? '#059669' : latestScore >= 80 ? '#E9A820' : '#dc3545'
  const pendingRules = pipelineRules.filter(r => r.status === 'pending')
  const approvedRules = pipelineRules.filter(r => r.status === 'approved')

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

      {/* SLED Jurisdictions Link */}
      {onJurisdictions && (
        <div
          className="card"
          onClick={onJurisdictions}
          style={{
            marginBottom: 24,
            cursor: 'pointer',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: 20,
            background: 'linear-gradient(135deg, #1a3a5c 0%, #2e5a8a 100%)',
            color: '#fff',
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
              Jurisdictions & Pipeline Rules
            </div>
            <div style={{ fontSize: 13, opacity: 0.9 }}>
              Manage Federal, State, and Local data sources
            </div>
          </div>
          <div style={{ fontSize: 24 }}>→</div>
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
              <span style={{ fontSize: 36, fontWeight: 700, color: scoreColor }}>{latestScore != null ? latestScore.toFixed(1) : '—'}</span>
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

      {/* Proposed Pipeline Rules — needs human approval */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="section-title">
          Proposed Pipeline Rules
          {pendingRules.length > 0 && <span className="badge badge-amber" style={{ marginLeft: 8 }}>{pendingRules.length} pending</span>}
        </div>
        <p className="text-muted text-sm" style={{ marginBottom: 12 }}>
          Rules proposed by humans (via record editing) and AI (via QA checks). Nothing goes into the pipeline without your approval.
        </p>

        {pipelineRules.length === 0 ? (
          <p className="text-muted text-sm">No proposed rules yet. Edit a record or run the QA script to generate proposals.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pipelineRules.map(rule => (
              <div key={rule.id} style={{
                padding: '12px 14px', borderRadius: 6, fontSize: 13,
                background: rule.status === 'pending' ? '#FFFBEB' : rule.status === 'approved' ? '#F0FDF4' : '#FEF2F2',
                border: `1px solid ${rule.status === 'pending' ? '#FDE68A' : rule.status === 'approved' ? '#BBF7D0' : '#FECACA'}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className={`badge ${rule.source === 'human' ? 'badge-navy' : 'badge-amber'}`}>
                      {rule.source === 'human' ? 'Human' : 'AI'}
                    </span>
                    <span style={{ fontWeight: 600 }}>{rule.field_name}</span>
                    {rule.scope === 'pipeline' && <span className="badge badge-navy" style={{ fontSize: 10 }}>Pipeline Rule</span>}
                    {rule.scope === 'record' && <span className="badge badge-muted" style={{ fontSize: 10 }}>Record Fix</span>}
                    <span className={`badge ${rule.status === 'pending' ? 'badge-amber' : rule.status === 'approved' ? 'badge-success' : 'badge-danger'}`}>
                      {rule.status}
                    </span>
                  </div>
                  <span className="text-muted" style={{ fontSize: 11 }}>
                    {new Date(rule.created_at).toLocaleDateString()}
                  </span>
                </div>

                {rule.old_value && (
                  <div style={{ fontSize: 12, color: '#991B1B', marginBottom: 4 }}>
                    Was: {rule.old_value.slice(0, 80)}
                  </div>
                )}
                {rule.new_value && (
                  <div style={{ fontSize: 12, color: '#065F46', marginBottom: 4 }}>
                    Now: {rule.new_value.slice(0, 80)}
                  </div>
                )}
                <div style={{ marginBottom: 4 }}>{rule.explanation}</div>
                {rule.proposed_rule && (
                  <div style={{ fontSize: 12, color: '#1B3A6B', fontStyle: 'italic', marginTop: 4, padding: '6px 8px', background: 'rgba(27,58,107,0.05)', borderRadius: 4 }}>
                    Proposed rule: {rule.proposed_rule}
                  </div>
                )}
                {rule.ai_generated_rule && rule.ai_generated_rule !== 'NEEDS_MANUAL_REVIEW' && (
                  <details style={{ marginTop: 6 }}>
                    <summary style={{ fontSize: 12, color: '#1B3A6B', cursor: 'pointer', fontWeight: 600 }}>
                      AI-drafted pipeline code
                    </summary>
                    <pre style={{ fontSize: 11, background: '#1A1A2E', color: '#E2E8F0', padding: '10px 12px', borderRadius: 4, marginTop: 4, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                      {rule.ai_generated_rule}
                    </pre>
                  </details>
                )}

                {rule.status === 'pending' && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button className="btn btn-navy btn-sm" onClick={() => handleRuleAction(rule.id, 'approved')}>
                      Approve
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => handleRuleAction(rule.id, 'rejected')}>
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
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
