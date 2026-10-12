# Jihoo — Personal Website

A clean, responsive personal website and journal, built with Astro and published on GitHub Pages.

## Pages

- **Home** — welcoming introduction, original hero artwork, and journal preview.
- **About** — a short personal introduction.
- **Journal** — a simple post index with a friendly empty state.

Previous blog posts have been removed as part of this redesign. New Markdown posts can be added under `src/content/blog/`, using the existing Astro content collection.

## Development

```sh
npm ci
npm run dev
npm run build
```

## Deployment

GitHub Actions builds and publishes the site at [jihoo12.github.io](https://jihoo12.github.io/). The canonical site URL is set in `astro.config.mjs`.

## Artwork

The home and about pages use the site owner's submitted illustration, optimized as a WebP image in `public/images/jihoo-hero.webp`. The prior placeholder SVG has been removed.
