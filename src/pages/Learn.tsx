import Layout from "../Layout";

interface LearnRepo {
  href: string;
  label: string;
}

const learnRepos: LearnRepo[] = [
  { href: "https://github.com/jihoo12/learn-haskell", label: "learn-haskell" },
  { href: "https://github.com/jihoo12/learn-go", label: "learn-go" },
  { href: "https://github.com/jihoo12/learn-ocaml", label: "learn-ocaml" },
  { href: "https://github.com/jihoo12/learn-rocq", label: "learn-rocq" },
  { href: "https://github.com/jihoo12/learn-agda-new", label: "learn-agda" },
  { href: "https://github.com/jihoo12/learn-category-theory", label: "learn-category-theory" },
  { href: "https://github.com/jihoo12/learn-type-theory", label: "learn-type-theory" },
];

export default function Learn() {
  return (
    <Layout>
      <h1 className="page-title">learn</h1>
      <div className="chip-grid">
        {learnRepos.map(r => (
          <a key={r.href} href={r.href} className="chip">{r.label}</a>
        ))}
      </div>
    </Layout>
  );
}