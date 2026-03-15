export function formatCurrency(value) {
  if (value == null) return '—';
  const num = Number(value);
  if (isNaN(num)) return '—';
  if (Math.abs(num) >= 1e9) return `$${(num / 1e9).toFixed(1)}B`;
  if (Math.abs(num) >= 1e6) return `$${(num / 1e6).toFixed(1)}M`;
  if (Math.abs(num) >= 1e3) return `$${(num / 1e3).toFixed(0)}K`;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num);
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatDateShort(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  const now = new Date();
  const diff = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
  return diff;
}

export function urgencyColor(days) {
  if (days == null) return 'var(--color-muted)';
  if (days <= 30) return 'var(--color-error)';
  if (days <= 90) return 'var(--color-warning)';
  return 'var(--color-success)';
}

export function naicsLabel(code, description) {
  if (!code) return '—';
  return description ? `${code} — ${description}` : code;
}
