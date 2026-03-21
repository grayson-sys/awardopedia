export default function Nav({ activePage, user, onHome, onNavigate }) {
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
        {user ? (
          <>
            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>|</span>
            <button style={{ color: '#E9A820' }}>{user.first_name || user.email?.split('@')[0]}</button>
            <button onClick={() => onNavigate?.('logout')} style={{ fontSize: 12, opacity: 0.6 }}>Logout</button>
          </>
        ) : (
          <button onClick={() => onNavigate?.('auth')} style={{ color: '#E9A820' }}>Sign In</button>
        )}
      </div>
    </nav>
  )
}
