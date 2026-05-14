import { type ReactNode } from "react";
import { useTheme } from "./ThemeContext";

export default function Layout({ children }: { children: ReactNode }) {
  const { dark, toggle } = useTheme();
  return (
    <>
      {children}
      <button id="theme-toggle" className="theme-toggle-btn" onClick={toggle}>
        <span className="icon">{dark ? "🌙" : "☀️"}</span>
      </button>
    </>
  );
}