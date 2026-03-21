export default function Nav({ activePage, onHome, onNavigate }) {
  return (
    <nav className="nav">
      <button className="nav-logo" onClick={onHome}>
        <img src="/logo-icon-navy-clean.jpg" alt="" width={24} height={24} style={{ borderRadius: 4 }} />
        Award<span>opedia</span>
      </button>
      <div className="nav-links">
        <button
          className={activePage === 'contracts' ? 'active' : ''}
          onClick={() => onNavigate?.('contracts')}
        >Past Contracts</button>
        <button
          className={activePage === 'opportunities' ? 'active' : ''}
          onClick={() => onNavigate?.('opportunities')}
        >Open Opportunities</button>
        <button onClick={() => onNavigate?.('api')}>API</button>
      </div>
    </nav>
  )
}
