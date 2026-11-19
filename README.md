# Jihoo — Personal Website

A clean, responsive personal website and journal, built with Astro and published on GitHub Pages.

## Pages

- **Home** — welcoming introduction, original hero artwork, and journal preview.
- **About** — a short personal introduction.
- **Journal** — a simple post index with a friendly empty state.
- **Projects** and **Comics**.

Nixchan's world (her island, her house, the grey place, the 3D path, the gallery and its games,
Nixkit, her snow magic and her own page) is a site of its own now:
[jihoo12.github.io/nixchan](https://jihoo12.github.io/nixchan/), from
[jihoo12/nixchan](https://github.com/jihoo12/nixchan). The old addresses here (`/island/`,
`/gallery/`, `/play/cloudhop/`, …) redirect to it (`astro.config.mjs`), and
`/home-scene.json` gives its 3D path the projects, notes and comics it walks past.

## Development

Tools come from the Nix flake (`nix develop`), which provides Node.js:

```sh
nix develop
npm ci
astro dev --background   # stop with `astro dev stop`
npm run build
```

## Deployment

GitHub Actions builds and publishes the site at [jihoo12.github.io](https://jihoo12.github.io/). The canonical site URL is set in `astro.config.mjs`.

## Artwork

The illustrations are Nixchan, drawn by jihoo:

- **Illustrations** — `src/assets/nixchan/*.png`, used across the site and optimized at build time by `astro:assets`.
- **Live Nixchan** — `src/assets/nixchan/live/`, the parts (body, eyes, legs) of the Nixchan who perches on cards on the home and 404 pages.

Her 3D model and her world's models are in [jihoo12/nixchan](https://github.com/jihoo12/nixchan).

## License

- **Code** — [Apache License 2.0](LICENSE).
- **Artwork** (`src/assets/nixchan/`) — [CC BY 4.0](LICENSE-ARTWORK). Use and adapt it freely, with credit: "Nixchan by jihoo, CC BY 4.0".
