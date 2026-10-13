# Jihoo — An Independent Notebook

An editorial, research-inspired personal website built with [Astro](https://astro.build/) and published on GitHub Pages.

The visual direction borrows from academic journals and archival catalogues: serif typography, restrained color, fine rules, numbered sections, a decorative inquiry diagram, and a chronological notebook index. It is a personal site, **not** a claim of academic affiliation or publication.

## Site structure

- **Index** (`/`) — introduction, areas of interest, recent notes, and a GitHub link.
- **Notebook** (`/blog/`) — a dated index of Markdown/MDX entries, with an intentional empty state until notes are published.
- **Profile** (`/about/`) — author introduction, working principles, and links.

Existing entries in `src/content/blog/` continue to render through the Astro content collection and `src/layouts/BlogPost.astro`. The pre-existing personal illustration is retained on the profile page and as the social preview image.

## Local development

Requirements: Node.js 22.12 or later, npm.

```sh
npm ci
npm run dev
npm run build
```

The site uses CSS and Google Fonts without an added UI framework. The font stacks include local fallbacks. The design includes a skip link, visible keyboard focus, responsive layouts, and reduced-motion support.

## Publishing

GitHub Actions builds and deploys the site to [jihoo12.github.io](https://jihoo12.github.io/). A pull request targeting `main` runs the `Verify website` build workflow. The canonical site URL is configured in `astro.config.mjs`.
