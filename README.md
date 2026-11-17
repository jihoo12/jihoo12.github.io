# Jihoo — Personal Website

A clean, responsive personal website and journal, built with Astro and published on GitHub Pages.

## Pages

- **Home** — welcoming introduction, original hero artwork, and journal preview.
- **About** — a short personal introduction.
- **Journal** — a simple post index with a friendly empty state.
- **Projects** and **Comics**.
- **Experimental** (`/experimental/`) — a 3D Nixchan.
- **Island** (`/island/`) — Nixchan's island, a small three.js game (see below).

Previous blog posts have been removed as part of this redesign. New Markdown posts can be added under `src/content/blog/`, using the existing Astro content collection.

## Development

Tools come from the Nix flake (`nix develop`), which provides Node.js:

```sh
nix develop
npm ci
astro dev --background   # stop with `astro dev stop`
npm run build
```

## Nixchan's Island

A toon island for Nixchan to roam: places to find, a map that fills in as she explores, a glider, fishing, a garden, Pebble the otter at the market stand, the Old Forge (iron ore to mine, tools to make better, and machines that look after the garden), and Cloudrest, islands floating in the sky that the Windspout's wind carries her glider up to: a ring temple, a lake with fish of its own, a spire, and crystals that grow back after she gathers their sky shards. It is TypeScript and three.js, with no physics engine: the island is a heightfield, so all movement asks is how high the ground is (and, under the sky island, how high she is).

The page is `src/pages/island/index.astro` (HTML/CSS for the menus and prompts), and the game is in `src/lib/island/`:

| Module | What it does |
| --- | --- |
| `game.ts` | Puts the island together and runs the frame |
| `terrain.ts`, `features.ts` | Heightfield, pier, and what stands on the ground (`groundAt`) |
| `layout.ts`, `scatter.ts` | Where the places go; rocks, trees and flowers |
| `sky.ts`, `water.ts`, `theme.ts` | Light, sky, sea, and day/night (parts register with `theme.on`) |
| `landmarks.ts` | Lighthouse, campfire, standing stones, chest, buoy |
| `skyisle.ts` | Cloudrest, the islands in the sky, and the Windspouts that lift her up to them |
| `player.ts`, `camera.ts`, `controls.ts` | Nixchan's movement, the follow camera, keys and touch |
| `interact.ts` | What E does: sources register offers |
| `explore.ts`, `menu.ts` | Places found, the maps, the menu |
| `fishing.ts`, `farm.ts`, `npc.ts`, `inventory.ts` | Things to do, and her bag |
| `forge.ts` | The smithy: ore veins, smelting, and the upgrades made at the anvil |
| `machines.ts` | Sprinklers and Sprocket the clockwork helper, looking after the garden |
| `save.ts` | Every localStorage key the island uses |

To add something she can do, register it with `interactions.add(() => ({ label, go }))`. To add a landmark, add a function to `landmarks.ts`.

The fish, garden, otter, sky ruin and forge models are made in Blender by the scripts in `tools/` (`nix develop .#blender -c blender -b -P tools/<name>/build.py -- <out.glb>`).

## Deployment

GitHub Actions builds and publishes the site at [jihoo12.github.io](https://jihoo12.github.io/). The canonical site URL is set in `astro.config.mjs`.

## Artwork

All the artwork is Nixchan, drawn and modelled by jihoo for this site:

- **Illustrations** — `src/assets/nixchan/*.png`, used across the site and optimized at build time by `astro:assets`.
- **Live Nixchan** — `src/assets/nixchan/live/`, the parts (body, eyes, legs) of the Nixchan who perches on cards on the home and 404 pages.
- **3D Nixchan** — `src/assets/nixchan/nixchan-3d.glb`, built by `tools/nixchan-3d/build.py`, for `/experimental/` and the island.
- **Island models** — `src/assets/island/` (fish, garden, market stand and the garden's machines, Pebble the otter, the ruins on Cloudrest, the forge), built by the scripts in `tools/island-*/`.

## License

- **Code** (including the Blender scripts in `tools/`) — [Apache License 2.0](LICENSE).
- **Artwork** (`src/assets/nixchan/`, `src/assets/island/`) — [CC BY 4.0](LICENSE-ARTWORK). Use and adapt it freely, with credit: "Nixchan by jihoo, CC BY 4.0".
