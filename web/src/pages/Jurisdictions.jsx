import { useState, useEffect } from 'react'
import { ArrowLeft, MapPin, Database, CheckCircle, Clock, AlertCircle, Settings, ChevronDown, ChevronRight } from 'lucide-react'

const STATUS_ICONS = {
  active: { icon: CheckCircle, color: '#28a745', label: 'Active' },
  testing: { icon: Clock, color: '#E9A820', label: 'Testing' },
  building: { icon: Settings, color: '#17a2b8', label: 'Building' },
  research: { icon: AlertCircle, color: '#6c757d', label: 'Research' },
  planned: { icon: Clock, color: '#aab', label: 'Planned' },
}

const TYPE_COLORS = {
  federal: '#1a3a5c',
  state: '#2e7d32',
  county: '#1565c0',
  city: '#7b1fa2',
  district: '#c62828',
}

export default function Jurisdictions({ onBack }) {
  const [jurisdictions, setJurisdictions] = useState([])
  const [rules, setRules] = useState([])
  const [selectedJurisdiction, setSelectedJurisdiction] = useState(null)
  const [expandedStages, setExpandedStages] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/jurisdictions').then(r => r.json()),
      fetch('/api/admin/pipeline-rules').then(r => r.json())
    ]).then(([j, r]) => {
      setJurisdictions(j)
      setRules(r)
      setLoading(false)
    }).catch(e => {
      console.error('Failed to load jurisdictions:', e)
      setLoading(false)
    })
  }, [])

  const selectedRules = selectedJurisdiction
    ? rules.filter(r => r.jurisdiction_code === selectedJurisdiction.code)
    : []

  const rulesByStage = selectedRules.reduce((acc, rule) => {
    const stage = rule.stage || 0
    if (!acc[stage]) acc[stage] = []
    acc[stage].push(rule)
    return acc
  }, {})

  const toggleStage = (stage) => {
    setExpandedStages(prev => ({ ...prev, [stage]: !prev[stage] }))
  }

  const stageNames = {
    1: 'Ingest & Parse',
    2: 'PDF Processing',
    3: 'Document Classification',
    4: 'Deterministic Extraction',
    5: 'AI Extraction',
    6: 'Summary Generation',
    7: 'Canonical Lookups',
    8: 'Successor Matching',
    9: 'Congressional Lookup',
  }

  if (loading) {
    return (
      <div className="container" style={{ padding: '32px 16px', maxWidth: 1200 }}>
        <p>Loading jurisdictions...</p>
      </div>
    )
  }

  return (
    <div className="container" style={{ padding: '32px 16px', maxWidth: 1400 }}>
      <button onClick={onBack} className="btn btn-link" style={{ marginBottom: 16, padding: 0 }}>
        <ArrowLeft size={16} style={{ marginRight: 4 }} /> Back to Admin
      </button>

      <h1 style={{ marginBottom: 8 }}>
        <MapPin size={28} style={{ marginRight: 8, verticalAlign: 'middle' }} />
        Jurisdictions & Pipeline Rules
      </h1>
      <p style={{ color: '#666', marginBottom: 24 }}>
        Manage data sources and cleaning rules for Federal, State, and Local government data.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '350px 1fr', gap: 24 }}>
        {/* Left: Jurisdiction List */}
        <div style={{ background: '#f8f9fa', borderRadius: 8, padding: 16 }}>
          <h3 style={{ marginBottom: 16, fontSize: 14, textTransform: 'uppercase', color: '#666' }}>
            Data Sources
          </h3>

          {jurisdictions.map(j => {
            const StatusIcon = STATUS_ICONS[j.pipeline_status]?.icon || Clock
            const statusColor = STATUS_ICONS[j.pipeline_status]?.color || '#aab'
            const isSelected = selectedJurisdiction?.code === j.code

            return (
              <div
                key={j.code}
                onClick={() => setSelectedJurisdiction(j)}
                style={{
                  padding: '12px 16px',
                  marginBottom: 8,
                  background: isSelected ? '#fff' : 'transparent',
                  border: isSelected ? '2px solid #1a3a5c' : '1px solid #ddd',
                  borderRadius: 8,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 6px',
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 600,
                      background: TYPE_COLORS[j.type] || '#666',
                      color: '#fff',
                      marginRight: 8,
                      textTransform: 'uppercase',
                    }}>
                      {j.type}
                    </span>
                    <strong>{j.name}</strong>
                    {j.state_abbr && j.type !== 'state' && (
                      <span style={{ color: '#666', marginLeft: 4 }}>({j.state_abbr})</span>
                    )}
                  </div>
                  <StatusIcon size={16} color={statusColor} />
                </div>

                <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                  {j.data_source_name || 'No data source configured'}
                </div>

                {j.contracts_count > 0 && (
                  <div style={{ fontSize: 11, color: '#28a745', marginTop: 4 }}>
                    <Database size={10} style={{ marginRight: 4 }} />
                    {j.contracts_count.toLocaleString()} contracts
                  </div>
                )}
              </div>
            )
          })}

          <div style={{ marginTop: 24, padding: 12, background: '#e8f4e8', borderRadius: 8, fontSize: 12 }}>
            <strong>Legend:</strong>
            <div style={{ marginTop: 8 }}>
              {Object.entries(STATUS_ICONS).map(([key, { icon: Icon, color, label }]) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <Icon size={12} color={color} />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Pipeline Rules */}
        <div>
          {selectedJurisdiction ? (
            <>
              <div style={{
                background: '#fff',
                border: '1px solid #ddd',
                borderRadius: 8,
                padding: 20,
                marginBottom: 24,
              }}>
                <h2 style={{ margin: 0 }}>{selectedJurisdiction.name}</h2>
                <p style={{ color: '#666', margin: '8px 0 0' }}>
                  {selectedJurisdiction.data_source_name}
                  {selectedJurisdiction.data_source_url && (
                    <a
                      href={selectedJurisdiction.data_source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ marginLeft: 8, fontSize: 12 }}
                    >
                      View Source ↗
                    </a>
                  )}
                </p>

                <div style={{ display: 'flex', gap: 24, marginTop: 16 }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase' }}>Status</div>
                    <div style={{ fontWeight: 600, color: STATUS_ICONS[selectedJurisdiction.pipeline_status]?.color }}>
                      {STATUS_ICONS[selectedJurisdiction.pipeline_status]?.label || selectedJurisdiction.pipeline_status}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase' }}>Data Type</div>
                    <div style={{ fontWeight: 600 }}>{selectedJurisdiction.data_source_type || 'Unknown'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase' }}>Contracts</div>
                    <div style={{ fontWeight: 600 }}>{(selectedJurisdiction.contracts_count || 0).toLocaleString()}</div>
                  </div>
                </div>
              </div>

              <h3 style={{ marginBottom: 16 }}>Pipeline Rules</h3>

              {Object.keys(rulesByStage).length === 0 ? (
                <div style={{ background: '#f8f9fa', padding: 24, borderRadius: 8, textAlign: 'center', color: '#666' }}>
                  No pipeline rules defined yet.
                  {selectedJurisdiction.code !== 'federal' && (
                    <p style={{ marginTop: 8, fontSize: 13 }}>
                      Rules will be adapted from federal pipeline as data is processed.
                    </p>
                  )}
                </div>
              ) : (
                Object.entries(rulesByStage)
                  .sort(([a], [b]) => Number(a) - Number(b))
                  .map(([stage, stageRules]) => (
                    <div key={stage} style={{ marginBottom: 12 }}>
                      <div
                        onClick={() => toggleStage(stage)}
                        style={{
                          background: '#1a3a5c',
                          color: '#fff',
                          padding: '10px 16px',
                          borderRadius: expandedStages[stage] ? '8px 8px 0 0' : 8,
                          cursor: 'pointer',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <div>
                          <strong>Stage {stage}:</strong> {stageNames[stage] || 'Processing'}
                          <span style={{ marginLeft: 12, opacity: 0.7, fontSize: 13 }}>
                            {stageRules.length} rule{stageRules.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                        {expandedStages[stage] ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      </div>

                      {expandedStages[stage] && (
                        <div style={{ border: '1px solid #ddd', borderTop: 0, borderRadius: '0 0 8px 8px' }}>
                          {stageRules.map((rule, idx) => (
                            <div
                              key={rule.id || idx}
                              style={{
                                padding: 16,
                                borderBottom: idx < stageRules.length - 1 ? '1px solid #eee' : 'none',
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                                <div>
                                  <strong style={{ color: '#1a3a5c' }}>{rule.rule_name}</strong>
                                  <span style={{
                                    marginLeft: 8,
                                    padding: '2px 6px',
                                    background: '#e8f4e8',
                                    borderRadius: 4,
                                    fontSize: 10,
                                    textTransform: 'uppercase',
                                  }}>
                                    {rule.rule_type}
                                  </span>
                                </div>
                                {rule.field_name && (
                                  <code style={{ fontSize: 11, background: '#f0f0f0', padding: '2px 6px', borderRadius: 4 }}>
                                    {rule.field_name}
                                  </code>
                                )}
                              </div>

                              <div style={{ marginTop: 12 }}>
                                <div style={{ fontSize: 12, color: '#dc3545', marginBottom: 4 }}>
                                  <strong>Problem:</strong> {rule.problem_description}
                                </div>
                                <div style={{ fontSize: 12, color: '#28a745' }}>
                                  <strong>Solution:</strong> {rule.solution_description}
                                </div>
                              </div>

                              {rule.records_affected > 0 && (
                                <div style={{ fontSize: 11, color: '#666', marginTop: 8 }}>
                                  Applied to {rule.records_affected.toLocaleString()} records
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
              )}
            </>
          ) : (
            <div style={{
              background: '#f8f9fa',
              padding: 48,
              borderRadius: 8,
              textAlign: 'center',
              color: '#666',
            }}>
              <MapPin size={48} style={{ marginBottom: 16, opacity: 0.3 }} />
              <h3>Select a Jurisdiction</h3>
              <p>Click on a data source to view its pipeline rules and configuration.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
