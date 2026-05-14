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
      <h2 className="post-title">my repository</h2>
      <div className="post-container">
        {repos.map(r => (
          <a key={r.href} href={r.href}>{r.label}</a>
        ))}
      </div>
    </Layout>
  );
}