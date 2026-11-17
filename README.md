# Jihoo — Personal Website

A clean, responsive personal website and journal, built with Astro and published on GitHub Pages.

## Pages

- **Home** — welcoming introduction, original hero artwork, and journal preview.
- **About** — a short personal introduction.
- **Journal** — a simple post index with a friendly empty state.
- **Projects** and **Comics**.
- **Experimental** (`/experimental/`) — a 3D Nixchan.
- **Island** (`/island/`) — Nixchan's island, a small three.js game (see below).
- **Monochrome** (`/monochrome/`) — the grey place through the rift at the island's standing stones (see below).

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
| `forge.ts` | The smithy: ore veins, smelting (iron, and ashen ore from the grey place), and the upgrades made at the anvil |
| `machines.ts` | Sprinklers and Sprocket the clockwork helper, looking after the garden |
| `rift.ts` | The grey rift at the standing stones, through to `/monochrome/` |
| `lantern.ts` | The Grey Lantern at her shoulder, made at the forge |
| `power.ts` | Windmills, the drills they power on the ore veins, and belts that carry ore (and power) to the hopper by the forge: power is only ever on or off, and what's on a belt is worked out from when it set off |
| `save.ts` | Every localStorage key the island uses |

To add something she can do, register it with `interactions.add(() => ({ label, go }))`. To add a landmark, add a function to `landmarks.ts`.

The fish, garden, otter, sky ruin, forge and power models (and the grey place's walls and pieces, `tools/monochrome/`) are made in Blender by the scripts in `tools/` (`nix develop .#blender -c blender -b -P tools/<name>/build.py -- <out.glb>`).

## Monochrome

The grey place through the rift. The rift opens between the island's standing stones at night, once Nixchan has opened the chest at the top of Cloudrest. Through it, everything is grey but her, and the place doesn't fit together the way a map would: a hall that runs on for ever, a wood that goes round, three cells round an obelisk where there ought to be four, a house bigger inside than out, and a tower it takes two laps to get round. Three colour shards are hidden in it; each one brings a little colour back, and they colour the rift and the altar crystal on the island once they're home. She can leave snowflakes on the floor (Q) to know a place again. Dark rocks here and there grow ashen ore, which she chips off and carries home: at the island's forge it smelts into ashen ingots, for a Rift Compass (whose needle then knows the way back to the Threshold from anywhere), a Grey Lantern, and, once all three shards are found, the Prism Glider.

There's no map underneath it. The world is a graph of square cells, each side either walled or joined to a side of some other cell, turned any way. Each frame asks "which cell is she in, and where in it?": the cells round hers are laid out flat round her as far as the fog (where two ways round reach the same spot, the shorter wins), and when she steps over a side, the cell she steps into becomes the middle and everything shifts back by a cell.

The page is `src/pages/monochrome/index.astro`, and the code is in `src/lib/monochrome/`:

| Module | What it does |
| --- | --- |
| `world.ts` | The cells and how they're joined, and `place`, which lays them out round her |
| `blocks.ts` | What each cell looks like (merged from the Blender pieces) and what in it is solid |
| `game.ts` | Walking her from cell to cell, the camera, the shards, ashen ore, snowflakes and the compass |
| `rift.ts` | The rift's shader, shared with the island |

## Deployment

GitHub Actions builds and publishes the site at [jihoo12.github.io](https://jihoo12.github.io/). The canonical site URL is set in `astro.config.mjs`.

## Artwork

All the artwork is Nixchan, drawn and modelled by jihoo for this site:

- **Illustrations** — `src/assets/nixchan/*.png`, used across the site and optimized at build time by `astro:assets`.
- **Live Nixchan** — `src/assets/nixchan/live/`, the parts (body, eyes, legs) of the Nixchan who perches on cards on the home and 404 pages.
- **3D Nixchan** — `src/assets/nixchan/nixchan-3d.glb`, built by `tools/nixchan-3d/build.py`, for `/experimental/` and the island.
- **Island models** — `src/assets/island/` (fish, garden, market stand and the garden's machines, Pebble the otter, the ruins on Cloudrest, the forge, the windmill, the drill and the hopper), built by the scripts in `tools/island-*/`.
- **Monochrome models** — `src/assets/monochrome/` (walls, posts, columns, the obelisk and the rest of the grey place), built by `tools/monochrome/build.py`.

## License

- **Code** (including the Blender scripts in `tools/`) — [Apache License 2.0](LICENSE).
- **Artwork** (`src/assets/nixchan/`, `src/assets/island/`, `src/assets/monochrome/`) — [CC BY 4.0](LICENSE-ARTWORK). Use and adapt it freely, with credit: "Nixchan by jihoo, CC BY 4.0".
