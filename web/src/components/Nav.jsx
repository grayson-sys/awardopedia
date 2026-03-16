"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";

const links = [
  { href: "/awards", label: "Awards" },
  { href: "/agencies", label: "Agencies" },
  { href: "/expiring", label: "Expiring" },
  { href: "/map", label: "Map" },
  { href: "/about", label: "About" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav className="nav">
      <div className="nav__inner">
        <Link href="/" className="nav__logo">
          <img src="/assets/logo-horizontal.jpg" alt="Awardopedia" style={{ height: 36, width: "auto" }} />
        </Link>
        <div className="nav__links">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`nav__link${pathname === l.href || pathname.startsWith(l.href + "/") ? " nav__link--active" : ""}`}
            >
              {l.label}
            </Link>
          ))}
          <Link href="/credits" className="btn-amber" style={{ fontSize: "0.8125rem", padding: "6px 14px" }}>
            <Sparkles size={14} />
            Get AI Credits
          </Link>
        </div>
      </div>
    </nav>
  );
}
