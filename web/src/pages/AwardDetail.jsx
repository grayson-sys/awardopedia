import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ExternalLink, Building2, Calendar, MapPin, Tag, DollarSign } from 'lucide-react';
import AiBadge from '../components/AiBadge';
import TrustBox from '../components/TrustBox';
import ContractCard from '../components/ContractCard';
import { useSEO } from '../utils/seo';
import { getAward, analyzeWithAI } from '../utils/api';
import { formatCurrency, formatDate, naicsLabel } from '../utils/format';

export default function AwardDetail() {
  const { id } = useParams();
  const [award, setAward] = useState(null);
  const [related, setRelated] = useState([]);
  const [loading, setLoading] = useState(true);
  const [aiResult, setAiResult] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getAward(id)
      .then((res) => {
        setAward(res.award);
        setRelated(res.related || []);
      })
      .catch(() => setAward(null))
      .finally(() => setLoading(false));
  }, [id]);

  const { SEOHead } = useSEO({
    title: award ? (award.description || award.award_id_piid) : 'Award Detail',
    description: award ? `${award.agency_name} — ${formatCurrency(award.federal_action_obligation)}` : undefined,
    path: `/awards/${id}`,
  });

  async function handleAnalyze() {
    setAiLoading(true);
    try {
      const res = await analyzeWithAI(id);
      setAiResult(res.analysis);
    } catch (err) {
      alert(err.message);
    } finally {
      setAiLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="container" style={{ padding: 'var(--space-12) 0' }}>
        <div className="skeleton" style={{ height: 32, width: 300, marginBottom: 'var(--space-4)' }} />
        <div className="skeleton" style={{ height: 200, marginBottom: 'var(--space-4)' }} />
      </div>
    );
  }

  if (!award) {
    return (
      <div className="container" style={{ padding: 'var(--space-12) 0', textAlign: 'center' }}>
        <h1 style={{ fontSize: 'var(--font-size-2xl)' }}>Award not found</h1>
        <Link to="/awards" className="btn-primary" style={{ marginTop: 'var(--space-4)', display: 'inline-flex' }}>
          Back to Awards
        </Link>
      </div>
    );
  }

  const details = [
    { label: 'PIID', value: award.award_id_piid },
    { label: 'Award Type', value: award.award_type },
    { label: 'Action Type', value: award.action_type },
    { label: 'Contract Type', value: award.contract_type },
    { label: 'NAICS', value: naicsLabel(award.naics_code, award.naics_description), link: award.naics_code ? `/naics/${award.naics_code}` : null },
    { label: 'PSC', value: award.psc_code ? `${award.psc_code} — ${award.psc_description || ''}` : null },
    { label: 'Action Date', value: formatDate(award.action_date) },
    { label: 'Period Start', value: formatDate(award.period_of_performance_start) },
    { label: 'Period End', value: formatDate(award.period_of_performance_current_end) },
    { label: 'Federal Obligation', value: formatCurrency(award.federal_action_obligation) },
    { label: 'Current Total Value', value: formatCurrency(award.current_total_value) },
    { label: 'Potential Total Value', value: formatCurrency(award.potential_total_value) },
  ];

  return (
    <>
      <SEOHead />
      <div className="container" style={{ padding: 'var(--space-8) 0' }}>
        <div style={{ marginBottom: 'var(--space-2)', fontSize: 'var(--font-size-sm)' }}>
          <Link to="/awards" style={{ color: 'var(--color-muted)' }}>Awards</Link>
          <span style={{ color: 'var(--color-muted)' }}> / </span>
          <span style={{ color: 'var(--color-text)' }}>{award.award_id_piid || `#${id}`}</span>
        </div>

        <h1 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-medium)', marginBottom: 'var(--space-6)' }}>
          {award.description || award.award_id_piid || 'Untitled Award'}
        </h1>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 'var(--space-6)', alignItems: 'start' }}>
          <div>
            <div className="card" style={{ marginBottom: 'var(--space-6)' }}>
              <h2 style={{ fontSize: 'var(--font-size-base)', fontWeight: 'var(--font-weight-medium)', marginBottom: 'var(--space-4)' }}>
                Award Details
              </h2>
              <dl style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 'var(--space-2) var(--space-4)', fontSize: 'var(--font-size-sm)' }}>
                {details.map((d) => d.value && (
                  <div key={d.label} style={{ display: 'contents' }}>
                    <dt style={{ color: 'var(--color-muted)' }}>{d.label}</dt>
                    <dd style={{ fontFamily: d.label.includes('Value') || d.label.includes('Obligation') ? 'var(--font-mono)' : undefined }}>
                      {d.link ? <Link to={d.link} style={{ color: 'var(--color-navy)' }}>{d.value}</Link> : d.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            {award.usaspending_url && (
              <a href={award.usaspending_url} target="_blank" rel="noopener noreferrer" className="btn-secondary" style={{ marginBottom: 'var(--space-6)', display: 'inline-flex' }}>
                <ExternalLink size={14} /> View on USASpending.gov
              </a>
            )}

            <div style={{ marginTop: 'var(--space-6)' }}>
              <AiBadge onClick={handleAnalyze} loading={aiLoading} />
              {aiResult && (
                <div className="card" style={{ marginTop: 'var(--space-4)', whiteSpace: 'pre-wrap', fontSize: 'var(--font-size-sm)', lineHeight: 'var(--line-height-relaxed)' }}>
                  {aiResult}
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
              <h3 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)', marginBottom: 'var(--space-3)', color: 'var(--color-muted)' }}>
                Agency
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                <Building2 size={16} style={{ color: 'var(--color-navy)' }} />
                {award.agency_code ? (
                  <Link to={`/agencies/${award.agency_code}`} style={{ fontWeight: 'var(--font-weight-medium)' }}>
                    {award.agency_name}
                  </Link>
                ) : (
                  <span>{award.agency_name || '—'}</span>
                )}
              </div>
              {award.sub_agency_name && (
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-muted)', paddingLeft: 24 }}>
                  {award.sub_agency_name}
                </div>
              )}
            </div>

            <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
              <h3 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)', marginBottom: 'var(--space-3)', color: 'var(--color-muted)' }}>
                Contractor
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                <Tag size={16} style={{ color: 'var(--color-navy)' }} />
                {award.recipient_uei ? (
                  <Link to={`/contractors/${award.recipient_uei}`} style={{ fontWeight: 'var(--font-weight-medium)' }}>
                    {award.recipient_name}
                  </Link>
                ) : (
                  <span>{award.recipient_name || '—'}</span>
                )}
              </div>
              {(award.recipient_city || award.recipient_state) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--font-size-sm)', color: 'var(--color-muted)', paddingLeft: 24 }}>
                  <MapPin size={12} />
                  {[award.recipient_city, award.recipient_state].filter(Boolean).join(', ')}
                </div>
              )}
            </div>

            <div className="card">
              <h3 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)', marginBottom: 'var(--space-3)', color: 'var(--color-muted)' }}>
                Financials
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-muted)' }}>Federal Obligation</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-lg)', color: 'var(--color-navy)' }}>
                    {formatCurrency(award.federal_action_obligation)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-muted)' }}>Potential Total</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-base)' }}>
                    {formatCurrency(award.potential_total_value)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {related.length > 0 && (
          <section style={{ marginTop: 'var(--space-10)' }}>
            <h2 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-medium)', marginBottom: 'var(--space-4)' }}>
              Related Awards
            </h2>
            <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
              {related.map((r) => <ContractCard key={r.award_id} award={r} />)}
            </div>
          </section>
        )}

        <TrustBox />
      </div>
    </>
  );
}
