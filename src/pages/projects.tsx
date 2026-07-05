import Layout from "../Layout";

interface Tag {
  label: string;
}

interface Project {
  href: string;
  label: string;
  lang: string;
  langColor: string;
  description: string;
  tags: Tag[];
  highlights: string[];
  docsHref?: string;
}

const projects: Project[] = [
  {
    href: "https://github.com/hokkaido-lang",
    label: "hokkaido-language",
    lang: "Rust",
    langColor: "#ce422b",
    description:
      "Hokkaido is a minimal systems-programming language that compiles to native code via LLVM. Inspired by Rust, C, and modern language design.",
    tags: [
      { label: "Type Theory" },
      { label: "Compilers" },
      { label: "zero cost abstraction" },
      { label: "llvm" },
    ],
    highlights: ["cubical type theory"];
    docsHref: "https://hokkaido-lang.github.io", // Points to your local documentation reference
  }
];

export default function ProjectPage() {
  return (
    <Layout>
      <h1 className="page-title">my projects</h1>
      <p className="page-subtitle">things i've built</p>

      <p className="section-label">projects</p>

      <div className="project-grid">
        {projects.map((p) => (
          <article key={p.href} className="project-card">
            {/* Header row */}
            <div className="project-card__header">
              <a href={p.href} className="project-card__name" target="_blank" rel="noopener noreferrer">
                {p.label}
                <span className="project-card__arrow">↗</span>
              </a>
              <span className="project-card__lang" style={{ "--lang-color": p.langColor } as React.CSSProperties}>
                {p.lang}
              </span>
            </div>

            {/* Description */}
            <p className="project-card__desc">{p.description}</p>

            {/* Tags */}
            <div className="project-card__tags">
              {p.tags.map((t) => (
                <span key={t.label} className="project-tag">{t.label}</span>
              ))}
            </div>

            {/* Highlights */}
            <ul className="project-card__highlights">
              {p.highlights.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>

            {/* Footer */}
            <div className="project-card__footer">
              <a href={p.href} className="project-card__btn" target="_blank" rel="noopener noreferrer">
                view on github
              </a>
              {p.docsHref && (
                <a href={p.docsHref} className="project-card__btn project-card__btn--secondary" target="_blank" rel="noopener noreferrer">
                  website ↗
                </a>
              )}
            </div>
          </article>
        ))}
      </div>
    </Layout>
  );
}
