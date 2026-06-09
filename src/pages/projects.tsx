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
    href: "https://github.com/kaguyaos/kaguyaos",
    label: "kaguyaos",
    lang: "Rust",
    langColor: "#ce422b",
    description:
      "A custom Operating System targeting x86_64 UEFI, demonstrating key OS concepts including UEFI booting, graphical framebuffer, user-mode execution with Ring 3 isolation, system calls, and native device drivers for NVMe and xHCI (USB 3.0).",
    tags: [
      { label: "x86_64 UEFI" },
      { label: "Kernel / Userspace" },
      { label: "Device Drivers" },
      { label: "JIT Assembler" },
    ],
    highlights: [
      "UEFI booting with high-resolution graphical framebuffer",
      "Ring 3 user mode with syscall interface (print, keyboard, shutdown)",
      "Custom xHCI (USB 3.0) and NVMe driver implementations",
      "TinyASM — in-shell JIT assembler for dynamic x86_64 execution",
    ],
    docsHref: "https://kaguyaos.github.io",
  },
  {
    href: "https://github.com/bug-free-octo-couscous/octo",
    label: "octo",
    lang: "Haskell",
    langColor: "#5e5086",
    description:
      "A minimalist type checker for a Cubical Type Theory variant written in Haskell. Features interval algebra with DNF representation, dependent types, Path types, and advanced cubical primitives.",
    tags: [
      { label: "Type Theory" },
      { label: "Cubical λ-calculus" },
      { label: "Bidirectional inference" },
      { label: "REPL" },
    ],
    highlights: [
      "Interval algebra (i0, i1, and, or, not) normalized via DNF",
      "Dependent Π and Σ types with bidirectional checking",
      "hcomp, transport, Glue / unglue for univalence",
      "Modular: Parser → TypeChecker → Eval → Equality",
    ],
    docsHref: "https://bug-free-octo-couscous.github.io",
  },
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