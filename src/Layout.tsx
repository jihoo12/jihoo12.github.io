import { type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTheme } from "./ThemeContext";

const NAV = [
  { to: "/", label: "home" },
  { to: "/current", label: "current" },
  { to: "/repo", label: "repos" },
  { to: "/learn", label: "learn" },
  { to: "/orgs", label: "orgs" },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { dark, toggle } = useTheme();
  const { pathname } = useLocation();
  return (
    <>
      <nav className="site-nav">
        <Link to="/" className="nav-logo">jihoo</Link>
        <div className="nav-links">
          {NAV.map(n => (
            <Link key={n.to} to={n.to} className={pathname === n.to ? "active" : ""}>
              {n.label}
            </Link>
          ))}
        </div>
      </nav>
      <div className="page-content">{children}</div>
      <button className="theme-toggle-btn" onClick={toggle}>
        {dark ? "🌙" : "☀️"}
      </button>
    </>
  );
}