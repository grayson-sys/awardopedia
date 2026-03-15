import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import SearchBar from '../components/SearchBar';
import DataTable from '../components/DataTable';
import { useSEO } from '../utils/seo';
import { getAgencies } from '../utils/api';
import { formatCurrency } from '../utils/format';

export default function Agencies() {
  const { SEOHead } = useSEO({ title: 'Federal Agencies', path: '/agencies' });
  const [agencies, setAgencies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('total_awarded');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    setLoading(true);
    getAgencies({ sort: sortKey, dir: sortDir, q: search })
      .then((res) => setAgencies(res.data || []))
      .catch(() => setAgencies([]))
      .finally(() => setLoading(false));
  }, [sortKey, sortDir, search]);

  const columns = [
    {
      key: 'agency_name',
      label: 'Agency',
      render: (row) => (
        <Link to={`/agencies/${row.agency_code}`} style={{ color: 'var(--color-navy)', fontWeight: 'var(--font-weight-medium)' }}>
          {row.agency_name}
        </Link>
      ),
    },
    {
      key: 'award_count',
      label: 'Awards',
      align: 'right',
      mono: true,
      render: (row) => (row.award_count || 0).toLocaleString(),
    },
    {
      key: 'total_awarded',
      label: 'Total Awarded',
      align: 'right',
      mono: true,
      render: (row) => formatCurrency(row.total_awarded),
    },
    {
      key: 'avg_award_value',
      label: 'Avg Award',
      align: 'right',
      mono: true,
      render: (row) => formatCurrency(row.avg_award_value),
    },
  ];

  return (
    <>
      <SEOHead />
      <div className="container" style={{ padding: 'var(--space-8) 0' }}>
        <h1 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-medium)', marginBottom: 'var(--space-6)' }}>
          Federal Agencies
        </h1>
        <div style={{ maxWidth: 'var(--max-width-narrow)', marginBottom: 'var(--space-6)' }}>
          <SearchBar
            initialValue={search}
            onSearch={setSearch}
            placeholder="Search agencies..."
          />
        </div>
        <DataTable
          columns={columns}
          data={agencies}
          loading={loading}
          onSort={(key, dir) => { setSortKey(key); setSortDir(dir); }}
          sortKey={sortKey}
          sortDir={sortDir}
        />
      </div>
    </>
  );
}
