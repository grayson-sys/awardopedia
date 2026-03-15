import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip } from 'chart.js';
import { DollarSign, FileText, TrendingUp } from 'lucide-react';
import StatCard from '../components/StatCard';
import DataTable from '../components/DataTable';
import TrustBox from '../components/TrustBox';
import { useSEO } from '../utils/seo';
import { getNaics } from '../utils/api';
import { formatCurrency, formatDateShort } from '../utils/format';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

export default function NaicsProfile() {
  const { code } = useParams();
  const [naics, setNaics] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getNaics(code)
      .then((res) => setNaics(res))
      .catch(() => setNaics(null))
      .finally(() => setLoading(false));
  }, [code]);

  const { SEOHead } = useSEO({
    title: naics ? `NAICS ${naics.naics_code} — ${naics.title}` : 'NAICS Code',
    path: `/naics/${code}`,
  });

  if (loading) {
    return (
      <div className="container" style={{ padding: 'var(--space-12) 0' }}>
        <div className="skeleton" style={{ height: 32, width: 300, marginBottom: 'var(--space-4)' }} />
        <div className="skeleton" style={{ height: 200 }} />
      </div>
    );
  }

  if (!naics) {
    return (
      <div className="container" style={{ padding: 'var(--space-12) 0', textAlign: 'center' }}>
        <h1 style={{ fontSize: 'var(--font-size-2xl)' }}>NAICS code not found</h1>
      </div>
    );
  }

  const topAgencies = naics.top_agencies || [];
  const topContractors = naics.top_contractors || [];
  const recentAwards = naics.recent_awards || [];

  const chartData = {
    labels: topAgencies.slice(0, 8).map((a) => a.name?.slice(0, 25) || a.code),
    datasets: [{
      label: 'Award Value',
      data: topAgencies.slice(0, 8).map((a) => a.total || 0),
      backgroundColor: '#1B3A6B',
      hoverBackgroundColor: '#D4940A',
      borderRadius: 4,
    }],
  };

  const chartOptions = {
    responsive: true,
    plugins: { legend: { display: false } },
    scales: { y: { ticks: { callback: (v) => formatCurrency(v) } } },
  };

  const awardColumns = [
    {
      key: 'description',
      label: 'Description',
      render: (row) => (
        <Link to={`/awards/${row.award_id}`} style={{ color: 'var(--color-navy)' }}>
          {(row.description || '—').slice(0, 60)}
        </Link>
      ),
    },
    { key: 'agency_name', label: 'Agency' },
    { key: 'recipient_name', label: 'Contractor' },
    {
      key: 'federal_action_obligation',
      label: 'Value',
      align: 'right',
      mono: true,
      render: (row) => formatCurrency(row.federal_action_obligation),
    },
  ];

  return (
    <>
      <SEOHead />
      <div className="container" style={{ padding: 'var(--space-8) 0' }}>
        <h1 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-medium)', marginBottom: 'var(--space-2)' }}>
          NAICS {naics.naics_code}
        </h1>
        <p style={{ fontSize: 'var(--font-size-lg)', color: 'var(--color-muted)', marginBottom: 'var(--space-6)' }}>
          {naics.title}
        </p>
        {naics.description && (
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-muted)', marginBottom: 'var(--space-6)', maxWidth: 700 }}>
            {naics.description}
          </p>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-4)', marginBottom: 'var(--space-8)' }}>
          <StatCard label="Total Awards" value={(naics.award_count || 0).toLocaleString()} icon={FileText} />
          <StatCard label="Total Awarded" value={formatCurrency(naics.total_awarded)} icon={DollarSign} />
          <StatCard label="Avg Award" value={formatCurrency(naics.avg_award_value)} icon={TrendingUp} />
        </div>

        {topAgencies.length > 0 && (
          <section style={{ marginBottom: 'var(--space-8)' }}>
            <h2 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-medium)', marginBottom: 'var(--space-4)' }}>
              Top Agencies
            </h2>
            <div className="card">
              <Bar data={chartData} options={chartOptions} />
            </div>
          </section>
        )}

        {topContractors.length > 0 && (
          <section style={{ marginBottom: 'var(--space-8)' }}>
            <h2 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-medium)', marginBottom: 'var(--space-4)' }}>
              Top Contractors
            </h2>
            <DataTable
              columns={[
                {
                  key: 'name',
                  label: 'Contractor',
                  render: (row) => row.uei
                    ? <Link to={`/contractors/${row.uei}`} style={{ color: 'var(--color-navy)' }}>{row.name}</Link>
                    : row.name,
                },
                { key: 'total', label: 'Total', align: 'right', mono: true, render: (row) => formatCurrency(row.total) },
              ]}
              data={topContractors}
            />
          </section>
        )}

        <section>
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
