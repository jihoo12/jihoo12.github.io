import { useState, useEffect } from "react";
import { type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTheme } from "./ThemeContext";

const NAV = [
  { to: "/", label: "home" },
  { to: "/repo", label: "repos" },
  { to: "/learn", label: "learn" },
  { to: "/orgs", label: "orgs" },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { dark, toggle } = useTheme();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close menu on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Prevent body scroll when menu is open
  useEffect(() => {
    document.body.classList.toggle("menu-open", menuOpen);
    return () => document.body.classList.remove("menu-open");
  }, [menuOpen]);

  return (
    <>
      <nav className="site-nav">
        <Link to="/" className="nav-logo">jihoo</Link>

        {/* Desktop links */}
        <div className="nav-links nav-links--desktop">
          {NAV.map(n => (
            <Link key={n.to} to={n.to} className={pathname === n.to ? "active" : ""}>
              {n.label}
            </Link>
          ))}
          <a href="https://github.com/jihoo12" target="_blank" rel="noopener noreferrer">
            github
          </a>
        </div>

        {/* Hamburger button */}
        <button
          className={`hamburger${menuOpen ? " hamburger--open" : ""}`}
          onClick={() => setMenuOpen(o => !o)}
          aria-label="Toggle navigation"
          aria-expanded={menuOpen}
        >
          <span />
          <span />
          <span />
        </button>
      </nav>

      {/* Mobile drawer */}
      <div className={`mobile-drawer${menuOpen ? " mobile-drawer--open" : ""}`}>
        <div className="mobile-drawer__inner">
          {NAV.map(n => (
            <Link
              key={n.to}
              to={n.to}
              className={`mobile-nav-link${pathname === n.to ? " active" : ""}`}
              onClick={() => setMenuOpen(false)}
            >
              {n.label}
            </Link>
          ))}
          <a
            href="https://github.com/jihoo12"
            target="_blank"
            rel="noopener noreferrer"
            className="mobile-nav-link"
            onClick={() => setMenuOpen(false)}
          >
            github ↗
          </a>
        </div>
      </div>

      {/* Overlay */}
      {menuOpen && (
        <div className="drawer-overlay" onClick={() => setMenuOpen(false)} />
      )}

      <div className="page-content">{children}</div>

      <button className="theme-toggle-btn" onClick={toggle} aria-label="Toggle theme">
        {dark ? "🌙" : "☀️"}
      </button>
    </>
  );
}