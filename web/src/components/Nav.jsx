import { BookOpen } from 'lucide-react'

export default function Nav({ activePage, onHome, onNavigate }) {
  return (
    <nav className="nav">
      <button
        className="nav-logo"
        onClick={onHome}
        style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: 0 }}
      >
        <BookOpen size={22} strokeWidth={2} color="#E9A820" />
        Award<span>opedia</span>
      </button>
      <div className="nav-links">
        <button
          className={activePage === 'contracts' ? 'active' : ''}
          onClick={() => onNavigate?.('contracts')}
        >Contracts</button>
        <button
          className={activePage === 'opportunities' ? 'active' : ''}
          onClick={() => onNavigate?.('opportunities')}
        >Opportunities</button>
        <button
          className={activePage === 'expiring' ? 'active' : ''}
          onClick={() => onNavigate?.('expiring')}
        >Expiring</button>
        <button onClick={() => onNavigate?.('api')}>API</button>
      </div>
    </nav>
  )
}
