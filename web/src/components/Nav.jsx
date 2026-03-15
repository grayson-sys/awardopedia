import { Link, NavLink } from 'react-router-dom';
import { Sparkles } from 'lucide-react';

const links = [
  { to: '/awards', label: 'Awards' },
  { to: '/agencies', label: 'Agencies' },
  { to: '/expiring', label: 'Expiring' },
  { to: '/about', label: 'About' },
];

export default function Nav() {
  return (
    <nav className="nav">
      <div className="nav__inner">
        <Link to="/" className="nav__logo">
          <img src="/assets/logo-horizontal.jpg" alt="Awardopedia" style={{ height: 36, width: 'auto' }} />
        </Link>
        <div className="nav__links">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) => `nav__link${isActive ? ' nav__link--active' : ''}`}
            >
              {l.label}
            </NavLink>
          ))}
          <Link to="/credits" className="btn-amber" style={{ fontSize: '0.8125rem', padding: '6px 14px' }}>
            <Sparkles size={14} />
            Get AI Credits
          </Link>
        </div>
      </div>
    </nav>
  );
}
