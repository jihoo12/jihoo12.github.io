import Layout from "../Layout";

interface Repo {
  href: string;
  label: string;
}

const repos: Repo[] = [
  { href: "https://github.com/jihoo12/ploty", label: "Ploty" },
  { href: "https://github.com/jihoo12/tinyasm", label: "tinyasm" },
  { href: "https://github.com/jihoo12/vii", label: "vii" },
  { href: "https://github.com/jihoo12/rlogind", label: "rlogind" },
  { href: "https://github.com/jihoo12/widget", label: "widget" },
  { href: "https://github.com/jihoo12/oas", label: "oas" },
  { href: "https://github.com/jihoo12/ros", label: "ros" },
  { href: "https://github.com/jihoo12/mylang", label: "mylang" },
  { href: "https://github.com/jihoo12/rust-wgpu-2d-physics", label: "rust wgpu 2d physics" },
  { href: "https://github.com/jihoo12/SSG", label: "SSG" },
  { href: "https://github.com/jihoo12/ai-RAG", label: "ai RAG" },
  { href: "https://github.com/bug-free-octo-couscous/octo", label: "octo" },
  { href: "https://github.com/bug-free-octo-couscous/haskell-blockchain", label: "haskell-blockchain" },
];

export default function Repo() {
  return (
    <Layout>
      <h1 className="page-title">my repository</h1>
      <p className="page-subtitle">things i've built</p>
      <p className="section-label">projects</p>
      <div className="chip-grid">
        {repos.map(r => (
          <a key={r.href} href={r.href} className="chip">{r.label}</a>
        ))}
      </div>
    </Layout>
  );
}