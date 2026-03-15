import { useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import SkeletonRow from './SkeletonRow';

export default function DataTable({ columns, data, loading, onSort, sortKey, sortDir, emptyMessage }) {
  const [localSort, setLocalSort] = useState({ key: sortKey || '', dir: sortDir || 'asc' });

  function handleSort(key) {
    if (!key) return;
    const newDir = localSort.key === key && localSort.dir === 'asc' ? 'desc' : 'asc';
    setLocalSort({ key, dir: newDir });
    if (onSort) onSort(key, newDir);
  }

  const activeKey = sortKey ?? localSort.key;
  const activeDir = sortDir ?? localSort.dir;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`${col.align === 'right' ? 'text-right' : ''} ${activeKey === col.key ? 'sort-active' : ''}`}
                onClick={() => col.sortable !== false && handleSort(col.key)}
                style={{ cursor: col.sortable !== false ? 'pointer' : 'default' }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {col.label}
                  {activeKey === col.key && (
                    activeDir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <SkeletonRow key={i} columns={columns.length} />
            ))
          ) : data && data.length > 0 ? (
            data.map((row, i) => (
              <tr key={row.id || row.award_id || i}>
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={col.mono ? 'mono' : col.align === 'right' ? 'text-right' : ''}
                  >
                    {col.render ? col.render(row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length} className="data-table__empty">
                {emptyMessage || 'No results found'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
