import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { DollarSign, FileText, Building2, Clock } from 'lucide-react';
import SearchBar from '../components/SearchBar';
import StatCard from '../components/StatCard';
import DataTable from '../components/DataTable';
import TrustBox from '../components/TrustBox';
import { useSEO } from '../utils/seo';
import { getStats, searchAwards } from '../utils/api';
import { formatCurrency, formatDateShort } from '../utils/format';

export default function Home() {
  const { SEOHead } = useSEO({ path: '/' });
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getStats().catch(() => null),
      searchAwards({ sort: 'date', limit: 10 }).catch(() => ({ data: [] })),
    ]).then(([s, r]) => {
      setStats(s);
      setRecent(r.data || []);
      setLoading(false);
    });
  }, []);

  const columns = [
    {
      key: 'description',
      label: 'Description',
      render: (row) => (
        <Link to={`/awards/${row.award_id}`} style={{ color: 'var(--color-navy)' }}>
          {(row.description || row.award_id_piid || '—').slice(0, 80)}
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

  return (
    <>
      <SEOHead />
      <section style={{ padding: 'var(--space-16) 0 var(--space-10)', textAlign: 'center' }}>
        <div className="container">
          <h1 style={{ fontSize: 'var(--font-size-4xl)', fontWeight: 'var(--font-weight-medium)', marginBottom: 'var(--space-4)', color: 'var(--color-navy)' }}>
            Federal Contract Awards
          </h1>
          <p style={{ fontSize: 'var(--font-size-lg)', color: 'var(--color-muted)', marginBottom: 'var(--space-8)', maxWidth: 600, margin: '0 auto var(--space-8)' }}>
            Search and analyze government contract data from USASpending.gov — free and open.
          </p>
          <SearchBar />
        </div>
      </section>

      <section className="container" style={{ marginBottom: 'var(--space-12)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-4)' }}>
          <StatCard
            label="Total Awards"
            value={stats?.total_awards?.toLocaleString() || '—'}
            subtext="In database"
            icon={FileText}
          />
          <StatCard
            label="Total Value"
            value={stats ? formatCurrency(stats.total_value) : '—'}
            subtext="Federal obligations"
            icon={DollarSign}
          />
          <StatCard
            label="Agencies"
            value={stats?.total_agencies?.toLocaleString() || '—'}
            subtext="Awarding agencies"
            icon={Building2}
          />
          <StatCard
            label="Expiring Soon"
            value={stats?.expiring_count?.toLocaleString() || '—'}
            subtext="Within 180 days"
            icon={Clock}
          />
        </div>
      </section>

      <section className="container" style={{ marginBottom: 'var(--space-12)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
          <h2 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-medium)' }}>Recent Awards</h2>
          <Link to="/awards" className="btn-secondary" style={{ fontSize: 'var(--font-size-sm)' }}>View All</Link>
        </div>
        <DataTable columns={columns} data={recent} loading={loading} />
        <TrustBox />
      </section>
    </>
  );
}
