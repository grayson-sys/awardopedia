import { Sparkles } from 'lucide-react';
import { useCredits } from '../App';

export default function AiBadge({ onClick, loading }) {
  const { credits } = useCredits();

  return (
    <button
      className="btn-amber"
      onClick={onClick}
      disabled={loading}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        fontSize: 'var(--font-size-sm)',
        opacity: loading ? 0.7 : 1,
      }}
    >
      <Sparkles size={14} />
      {loading ? 'Analyzing...' : 'AI Analysis'}
      <span style={{
        background: 'rgba(255,255,255,0.2)',
        borderRadius: 'var(--border-radius-sm)',
        padding: '1px 6px',
        fontSize: 'var(--font-size-xs)',
      }}>
        1 credit
      </span>
      {credits > 0 && (
        <span style={{ fontSize: 'var(--font-size-xs)', opacity: 0.8 }}>
          ({credits} left)
        </span>
      )}
    </button>
  );
}
