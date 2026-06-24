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
    href: "https://github.com/wplot/wplot",
    label: "wplot",
    lang: "Rust",
    langColor: "#ce422b",
    description:
      "A hardware-accelerated 3D data visualization engine. Renders mathematical surfaces, animated wave functions, and scatter plots with a clean builder-style API — no boilerplate required.",
    tags: [
      { label: "wgpu" },
      { label: "Vulkan / Metal / DX12" },
      { label: "GPU rendering" },
      { label: "3D plotting" },
    ],
    highlights: [
      "Static & animated surface plots from f(x,z,t) closures",
      "Scatter plots via point-list pipeline",
      "Orbit camera — drag, pan, scroll to zoom",
      "Axis tick labels & legend overlay via glyphon",
    ],
    docsHref: "https://wplot.github.io",
  },
  {
    href: "https://github.com/pi-lisp/pi-lisp",
    label: "pi-lisp",
    lang: "Rust",
    langColor: "#ce422b",
    description:
      "A lightweight, experimental Lisp interpreter with a cubical type theory flavor. Supports dependent function/pair types, paths, interval types, macros, and features an inline x86-64 JIT assembler.",
    tags: [
      { label: "Type Theory" },
      { label: "Compilers" },
      { label: "JIT Compilation" },
      { label: "x86-64 Assembly" },
    ],
    highlights: [
      "Bidirectional typechecker implementing Pi (Π), Sigma (Σ), and Glue type formers",
      "Two-stage pipeline compiling surface AST to core De Bruijn indices",
      "Inline JIT assembler (`asm`) that emits and executes native x86-64 machine code directly",
      "Parallel environments: Global name-to-value map and a local stack-based lexical environment",
    ],
    docsHref: "https://pi-lisp.github.io", // Points to your local documentation reference
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
