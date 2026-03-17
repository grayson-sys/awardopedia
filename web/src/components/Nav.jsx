export default function Nav({ activePage }) {
  return (
    <nav className="nav">
      <div className="nav-logo">Award<span>opedia</span></div>
      <div className="nav-links">
        <a href="#contracts" className={activePage === 'contracts' ? 'active' : ''}>Contracts</a>
        <a href="#opportunities" className={activePage === 'opportunities' ? 'active' : ''}>Opportunities</a>
        <a href="#expiring" className={activePage === 'expiring' ? 'active' : ''}>Expiring</a>
        <a href="#api">API</a>
      </div>
    </nav>
  )
}
