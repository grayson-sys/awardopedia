import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer style={{
      background: 'var(--color-navy)',
      color: 'var(--color-white)',
      padding: 'var(--space-12) 0 var(--space-8)',
      marginTop: 'var(--space-16)',
    }}>
      <div className="container" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 'var(--space-8)',
      }}>
        <div>
          <h3 style={{ fontSize: 'var(--font-size-lg)', marginBottom: 'var(--space-4)', fontWeight: 'var(--font-weight-medium)' }}>
            Awardopedia
          </h3>
          <p style={{ fontSize: 'var(--font-size-sm)', opacity: 0.7, lineHeight: 'var(--line-height-relaxed)' }}>
            Free access to federal contract award data sourced from USASpending.gov.
          </p>
        </div>
        <div>
          <h4 style={{ fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-3)', fontWeight: 'var(--font-weight-medium)' }}>
            Explore
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <Link to="/awards" style={{ color: 'var(--color-white)', opacity: 0.7, fontSize: 'var(--font-size-sm)' }}>Awards</Link>
            <Link to="/agencies" style={{ color: 'var(--color-white)', opacity: 0.7, fontSize: 'var(--font-size-sm)' }}>Agencies</Link>
            <Link to="/expiring" style={{ color: 'var(--color-white)', opacity: 0.7, fontSize: 'var(--font-size-sm)' }}>Expiring Contracts</Link>
            <Link to="/about" style={{ color: 'var(--color-white)', opacity: 0.7, fontSize: 'var(--font-size-sm)' }}>About</Link>
          </div>
        </div>
        <div>
          <h4 style={{ fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-3)', fontWeight: 'var(--font-weight-medium)' }}>
            Data Source
          </h4>
          <p style={{ fontSize: 'var(--font-size-sm)', opacity: 0.7, lineHeight: 'var(--line-height-relaxed)' }}>
            All contract data sourced from{' '}
            <a href="https://www.usaspending.gov" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-white)', textDecoration: 'underline' }}>
              USASpending.gov
            </a>
            , the official source for federal spending data as mandated by the{' '}
            Federal Funding Accountability and Transparency Act (FFATA).
          </p>
        </div>
      </div>
      <div className="container" style={{
        marginTop: 'var(--space-8)',
        paddingTop: 'var(--space-4)',
        borderTop: '1px solid rgba(255,255,255,0.15)',
        fontSize: 'var(--font-size-xs)',
        opacity: 0.5,
      }}>
        &copy; {new Date().getFullYear()} Awardopedia. Not affiliated with USASpending.gov or any government agency.
      </div>
    </footer>
  );
}
