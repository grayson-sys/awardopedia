import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { DollarSign, FileText, MapPin, Building2 } from 'lucide-react';
import StatCard from '../components/StatCard';
import DataTable from '../components/DataTable';
import TrustBox from '../components/TrustBox';
import { useSEO } from '../utils/seo';
import { getContractor } from '../utils/api';
import { formatCurrency, formatDateShort } from '../utils/format';

export default function ContractorProfile() {
  const { uei } = useParams();
  const [contractor, setContractor] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getContractor(uei)
      .then((res) => setContractor(res))
      .catch(() => setContractor(null))
      .finally(() => setLoading(false));
  }, [uei]);

  const { SEOHead } = useSEO({
    title: contractor?.name || 'Contractor',
    path: `/contractors/${uei}`,
  });

  if (loading) {
    return (
      <div className="container" style={{ padding: 'var(--space-12) 0' }}>
        <div className="skeleton" style={{ height: 32, width: 300, marginBottom: 'var(--space-4)' }} />
        <div className="skeleton" style={{ height: 200 }} />
      </div>
    );
  }

  if (!contractor) {
    return (
      <div className="container" style={{ padding: 'var(--space-12) 0', textAlign: 'center' }}>
        <h1 style={{ fontSize: 'var(--font-size-2xl)' }}>Contractor not found</h1>
      </div>
    );
  }

  const awards = contractor.awards || [];
  const agencyBreakdown = contractor.agency_breakdown || [];

  const awardColumns = [
    {
      key: 'description',
      label: 'Description',
      render: (row) => (
        <Link to={`/awards/${row.award_id}`} style={{ color: 'var(--color-navy)' }}>
          {(row.description || row.award_id_piid || '—').slice(0, 60)}
        </Link>
      ),
    },
    { key: 'agency_name', label: 'Agency' },
    {
      key: 'federal_action_obligation',
      label: 'Value',
      align: 'right',
      mono: true,
      render: (row) => formatCurrency(row.federal_action_obligation),
    },
    {
      key: 'action_date',
      label: 'Date',
      render: (row) => formatDateShort(row.action_date),
    },
  ];

  const agencyColumns = [
    {
      key: 'agency_name',
      label: 'Agency',
      render: (row) => row.agency_code
        ? <Link to={`/agencies/${row.agency_code}`} style={{ color: 'var(--color-navy)' }}>{row.agency_name}</Link>
        : row.agency_name,
    },
    { key: 'count', label: 'Awards', align: 'right', mono: true, render: (row) => (row.count || 0).toLocaleString() },
    { key: 'total', label: 'Total', align: 'right', mono: true, render: (row) => formatCurrency(row.total) },
  ];

  return (
    <>
      <SEOHead />
      <div className="container" style={{ padding: 'var(--space-8) 0' }}>
        <h1 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-medium)', marginBottom: 'var(--space-2)' }}>
          {contractor.name}
        </h1>
        {contractor.doing_business_as && (
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-muted)', marginBottom: 'var(--space-2)' }}>
            DBA: {contractor.doing_business_as}
          </p>
        )}
        {(contractor.city || contractor.state_code) && (
          <p style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--font-size-sm)', color: 'var(--color-muted)', marginBottom: 'var(--space-6)' }}>
            <MapPin size={14} />
            {[contractor.city, contractor.state_code, contractor.zip].filter(Boolean).join(', ')}
          </p>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-4)', marginBottom: 'var(--space-8)' }}>
          <StatCard label="Total Awards" value={(contractor.award_count || 0).toLocaleString()} icon={FileText} />
          <StatCard label="Total Awarded" value={formatCurrency(contractor.total_awarded)} icon={DollarSign} />
          <StatCard label="UEI" value={contractor.uei || '—'} icon={Building2} />
        </div>

        {agencyBreakdown.length > 0 && (
          <section style={{ marginBottom: 'var(--space-8)' }}>
            <h2 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-medium)', marginBottom: 'var(--space-4)' }}>
              Agency Breakdown
            </h2>
            <DataTable columns={agencyColumns} data={agencyBreakdown} />
          </section>
        )}

        <section>
          <h2 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-medium)', marginBottom: 'var(--space-4)' }}>
            Awards
          </h2>
          <DataTable columns={awardColumns} data={awards} />
        </section>

        <TrustBox />
      </div>
    </>
  );
}
