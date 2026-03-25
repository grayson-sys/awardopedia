export default function Nav({ activePage, user, onHome, onNavigate }) {
  return (
    <nav className="nav">
      <button className="nav-logo" onClick={onHome}>
        <img src="/logo-icon-navy-clean.jpg" alt="" width={24} height={24} style={{ borderRadius: 4 }} />
        <span className="nav-logo-text">Award<span>opedia</span></span>
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
            <span style={{ color: '#E2E4E9', fontSize: 12 }}>|</span>
            {user.role === 'admin' && <button onClick={() => onNavigate?.('admin')}>Admin</button>}
            <button onClick={() => onNavigate?.('credits')} style={{ fontSize: 12 }}>{user.credits ?? 0} credits</button>
            <button style={{ color: '#1B3A6B', fontWeight: 600 }}>{user.first_name || user.email?.split('@')[0]}</button>
            <button onClick={() => onNavigate?.('logout')} style={{ fontSize: 12, opacity: 0.6 }}>Logout</button>
          </>
        ) : (
          <button onClick={() => onNavigate?.('auth')} style={{ color: '#1B3A6B', fontWeight: 600 }}>Sign In</button>
        )}
      </div>
    </nav>
  )
}
