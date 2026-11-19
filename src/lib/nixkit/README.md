# Nixkit

A small kit for making 3D games with Nixchan in them. It came out of Nixchan's island (`/island`):
the island and every Nixkit game share the same Nixchan, the same way of moving her about, the
same camera and controls, and the same toon look.

The first game made with it is **Cloud Hop** (`/cloudhop`, `src/lib/cloudhop/course.ts`), an
obstacle course in the sky. The **gallery** (`/gallery`, `src/lib/gallery/gallery.ts`) is made
with it too: a plaza where Nixchan walks among portals to the games.

## Adding a game to the gallery

Add a line to `PORTALS` in `src/lib/gallery/gallery.ts`:

```ts
{ id: 'mygame', title: 'My Game', note: 'What it is, in a few words', href: '/mygame/', colors: ['#ff8ad8', '#5fd3ff'] },
```

and have the game link back with `/gallery/?from=mygame`, so she steps out of its portal. A portal
without `href` stays dim (the "Coming soon" one).

## Making a game

A game is a page with a canvas and one script:

```ts
import * as THREE from 'three';
import { createGame } from '../nixkit/game';

const canvas = document.querySelector<HTMLCanvasElement>('[data-stage]')!;
const game = createGame({ canvas, modelUrl: canvas.dataset.model!, spawn: { pos: new THREE.Vector3(0, 0, 0), heading: 0 } });
if (game) {
	const { parts, hud } = game;
	parts.add({ at: [0, -0.5, 0], size: [10, 1, 10] });                                   // somewhere to stand
	parts.add({ at: [0, -0.5, 9], size: [3, 1, 3], move: { by: [6, 0, 0], period: 4 } }); // a moving platform
	parts.add({ at: [0, -0.5, 14], size: [3, 1, 3], kill: true });                       // lava
	parts.checkpoint([0, -0.5, 20], [4, 1, 4]);
	const coins = hud.stat('0 coins');
	let n = 0;
	parts.pickup({ at: [0, 1, 9], onPick: () => coins.set(`${++n} coins`) });
	game.onUpdate((dt, time) => { /* the game's own rules */ });
	game.start();
}
```

The page passes Nixchan's model in (`import nixModel from '../../assets/nixchan/nixchan-3d.glb?url'`
and `data-model={nixModel}` on the canvas). The HUD (touch stick, jump button, banners, toasts and
counters) makes its own elements.

## Parts

`parts.add(spec)` makes a box (or, with `shape: 'cylinder'`, a cylinder) with its middle at `at`
and `size` across. What it does is up to the spec:

| field | what it does |
| --- | --- |
| `move: { by, period, phase? }` | slides out by `by` and back once every `period` seconds, carrying her along |
| `conveyor: [vx, vz]` | carries whoever stands on it, like a belt |
| `bounce: speed` | throws her up into the air (16 is about 5 m) |
| `vanish: { after, back }` | fades away `after` seconds once she's stepped on it, back `back` seconds later |
| `kill: true` | sends her back to the last checkpoint |
| `checkpoint: true` | becomes where she comes back to (`parts.checkpoint()` adds a flag too) |
| `solid: false` | not there to stand on: for show, or for `kill` / `onTouch` (a sweeping bar) |
| `onTouch(part)` | called each time she steps onto it (or into it) |

`parts.pickup({ at, onPick })` is a spinning gem to collect. `parts.reset(pos, heading)` starts
over.

How far she can jump, for laying out a course: about 1.4 m up, and 4 to 5 m across at a run
(2 m at a walk). A part's footprint reaches 0.3 m past its edge, for her feet.

## Worlds

What Nixchan and the camera know of where they are is a `World` (`world.ts`): how high the ground
is at a point, how low the ceiling, what obstacles stand near, whether there's a sea to swim in.
The parts are one world; the island's terrain, rocks, trees and sky island are another
(`island/features.ts`, `islandWorld`). A game can bring its own by passing `world` to `createGame`.

## What's in the kit

- `game.ts`: `createGame`, which sets up the renderer, sky and light, Nixchan, the camera, controls, HUD and parts, and runs the loop
- `player.ts`: Nixchan and how she moves: walk, run, jump, swim, glide, dash
- `camera.ts`: the camera that follows her
- `controls.ts`: keyboard, mouse and touch
- `parts.ts`: parts and pickups, and the world they make
- `world.ts`: what a world is
- `hud.ts`: what's shown over the game
- `portal.ts`: portals to other pages
- `scenery.ts`: clouds
- `interact.ts`: "press E to …" offers
- `look.ts`, `util.ts`: toon materials, and small maths
