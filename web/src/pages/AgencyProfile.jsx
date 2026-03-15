import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js';
import { DollarSign, FileText, TrendingUp } from 'lucide-react';
import StatCard from '../components/StatCard';
import DataTable from '../components/DataTable';
import TrustBox from '../components/TrustBox';
import { useSEO } from '../utils/seo';
import { getAgency } from '../utils/api';
import { formatCurrency, formatDateShort } from '../utils/format';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

export default function AgencyProfile() {
  const { code } = useParams();
  const [agency, setAgency] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getAgency(code)
      .then((res) => setAgency(res))
      .catch(() => setAgency(null))
      .finally(() => setLoading(false));
  }, [code]);

  const { SEOHead } = useSEO({
    title: agency?.agency_name || 'Agency',
    path: `/agencies/${code}`,
  });

  if (loading) {
    return (
      <div className="container" style={{ padding: 'var(--space-12) 0' }}>
        <div className="skeleton" style={{ height: 32, width: 300, marginBottom: 'var(--space-4)' }} />
        <div className="skeleton" style={{ height: 200 }} />
      </div>
    );
  }

  if (!agency) {
    return (
      <div className="container" style={{ padding: 'var(--space-12) 0', textAlign: 'center' }}>
        <h1 style={{ fontSize: 'var(--font-size-2xl)' }}>Agency not found</h1>
      </div>
    );
  }

  const topNaics = agency.top_naics || [];
  const topContractors = agency.top_contractors || [];
  const recentAwards = agency.recent_awards || [];

  const chartData = {
    labels: topNaics.slice(0, 8).map((n) => n.name?.slice(0, 30) || n.code),
    datasets: [{
      label: 'Award Value',
      data: topNaics.slice(0, 8).map((n) => n.total || 0),
      backgroundColor: '#1B3A6B',
      hoverBackgroundColor: '#D4940A',
      borderRadius: 4,
    }],
  };

  const chartOptions = {
    responsive: true,
    plugins: { legend: { display: false } },
    scales: {
      y: { ticks: { callback: (v) => formatCurrency(v) } },
      x: { ticks: { maxRotation: 45 } },
    },
  };

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
    { key: 'recipient_name', label: 'Contractor' },
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

  const contractorColumns = [
    {
      key: 'name',
      label: 'Contractor',
      render: (row) => row.uei
        ? <Link to={`/contractors/${row.uei}`} style={{ color: 'var(--color-navy)' }}>{row.name}</Link>
        : row.name,
    },
    {
      key: 'total',
      label: 'Total Awarded',
      align: 'right',
      mono: true,
      render: (row) => formatCurrency(row.total),
    },
  ];

  return (
    <>
      <SEOHead />
      <div className="container" style={{ padding: 'var(--space-8) 0' }}>
        <div style={{ marginBottom: 'var(--space-2)', fontSize: 'var(--font-size-sm)' }}>
          <Link to="/agencies" style={{ color: 'var(--color-muted)' }}>Agencies</Link>
          <span style={{ color: 'var(--color-muted)' }}> / </span>
        </div>
        <h1 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-medium)', marginBottom: 'var(--space-6)' }}>
          {agency.agency_name}
        </h1>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-4)', marginBottom: 'var(--space-8)' }}>
          <StatCard label="Total Awards" value={(agency.award_count || 0).toLocaleString()} icon={FileText} />
          <StatCard label="Total Awarded" value={formatCurrency(agency.total_awarded)} icon={DollarSign} />
          <StatCard label="Avg Award" value={formatCurrency(agency.avg_award_value)} icon={TrendingUp} />
        </div>

        {topNaics.length > 0 && (
          <section style={{ marginBottom: 'var(--space-8)' }}>
            <h2 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-medium)', marginBottom: 'var(--space-4)' }}>
              Top NAICS Categories
            </h2>
            <div className="card" style={{ maxHeight: 400 }}>
              <Bar data={chartData} options={chartOptions} />
            </div>
          </section>
        )}

        {topContractors.length > 0 && (
          <section style={{ marginBottom: 'var(--space-8)' }}>
            <h2 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-medium)', marginBottom: 'var(--space-4)' }}>
              Top Contractors
            </h2>
            <DataTable columns={contractorColumns} data={topContractors} />
          </section>
        )}

        <section style={{ marginBottom: 'var(--space-8)' }}>
          <h2 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-medium)', marginBottom: 'var(--space-4)' }}>
            Recent Awards
          </h2>
          <DataTable columns={awardColumns} data={recentAwards} />
        </section>

        <TrustBox />
      </div>
    </>
  );
}
