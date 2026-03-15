import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import SearchBar from '../components/SearchBar';
import FilterPanel from '../components/FilterPanel';
import DataTable from '../components/DataTable';
import { useSEO } from '../utils/seo';
import { searchAwards } from '../utils/api';
import { formatCurrency, formatDateShort } from '../utils/format';

const EMPTY_FILTERS = { agency: '', state: '', dateFrom: '', dateTo: '', minValue: '', maxValue: '', type: '', naics: '' };

export default function Awards() {
  const { SEOHead } = useSEO({ title: 'Search Awards', path: '/awards' });
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const page = parseInt(params.get('page') || '1', 10);

  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState('action_date');
  const [sortDir, setSortDir] = useState('desc');

  function fetchData() {
    setLoading(true);
    const apiParams = { page, limit: 25, sort: sortKey, dir: sortDir };
    if (q) apiParams.q = q;
    Object.entries(filters).forEach(([k, v]) => { if (v) apiParams[k] = v; });

    searchAwards(apiParams)
      .then((res) => {
        setData(res.data || []);
        setTotal(res.total || 0);
      })
      .catch(() => { setData([]); setTotal(0); })
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchData(); }, [q, page, sortKey, sortDir]);

  function handleSearch(query) {
    setParams({ q: query });
  }

  function handleSort(key, dir) {
    setSortKey(key);
    setSortDir(dir);
  }

  function handleApplyFilters() {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('page', '1');
      return next;
    });
    fetchData();
  }

  const totalPages = Math.ceil(total / 25);

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

  return (
    <>
      <SEOHead />
      <div className="container" style={{ padding: 'var(--space-8) 0' }}>
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <SearchBar initialValue={q} onSearch={handleSearch} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 'var(--space-6)', alignItems: 'start' }}>
          <FilterPanel
            filters={filters}
            onChange={setFilters}
            onApply={handleApplyFilters}
            onReset={() => { setFilters({ ...EMPTY_FILTERS }); fetchData(); }}
          />

          <div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-muted)', marginBottom: 'var(--space-3)' }}>
              {loading ? 'Searching...' : `${total.toLocaleString()} results`}
              {q && ` for "${q}"`}
            </div>

            <DataTable
              columns={columns}
              data={data}
              loading={loading}
              onSort={handleSort}
              sortKey={sortKey}
              sortDir={sortDir}
            />

            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-6)' }}>
                <button
                  className="btn-secondary"
                  disabled={page <= 1}
                  onClick={() => setParams({ q, page: page - 1 })}
                >
                  <ChevronLeft size={16} /> Previous
                </button>
                <span style={{ display: 'flex', alignItems: 'center', fontSize: 'var(--font-size-sm)', color: 'var(--color-muted)', padding: '0 var(--space-4)' }}>
                  Page {page} of {totalPages}
                </span>
                <button
                  className="btn-secondary"
                  disabled={page >= totalPages}
                  onClick={() => setParams({ q, page: page + 1 })}
                >
                  Next <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
