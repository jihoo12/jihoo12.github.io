# Jihoo — Personal Website

A clean, responsive personal website and journal built with Astro, published on GitHub Pages.

## Pages

- **Home**: introduction, hero illustration, and journal preview.
- **About**: a short personal introduction.
- **Journal**: a minimal post index with a friendly empty state.

Previous sample and archived posts have been removed from this redesign. New Markdown posts can be added to `src/content/blog/` using the existing content collection schema.

## Development

```sh
npm ci
npm run dev
npm run build
```

## Deployment

GitHub Actions builds and publishes the site to [jihoo12.github.io](https://jihoo12.github.io/). The canonical site URL is configured in `astro.config.mjs`.

## Image

The hero artwork was supplied by the site owner and is stored as an optimized JPEG in `public/images/jihoo-hero.svg`.
