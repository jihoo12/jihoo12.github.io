# Nixkit

A small kit for making 3D games with Nixchan in them. It came out of Nixchan's island (`/island`):
the island and every Nixkit game share the same Nixchan, the same way of moving her about, the
same camera and controls, and the same toon look.

The first game made with it is **Cloud Hop** (`/play/cloudhop/`, `src/games/cloudhop/`), an
obstacle course in the sky. The **gallery** (`/gallery`, `src/lib/gallery/gallery.ts`) is made
with it too: a plaza where Nixchan walks among portals to the games.

## Adding a game

Games live in `src/games/<id>/`: a `meta.ts` (its name, who made it, its portal's colours) and a
`game.ts` (the game). Each one gets a page at `/play/<id>/` and a portal in the gallery, both made
from `meta.ts`. `CONTRIBUTING.md` says how, and what a game may and mayn't do;
`src/games/_template/` is where to start.

## Making a game

A game's `game.ts` is given `createGame`, which sets up everything round the page's canvas:

```ts
import * as THREE from 'three';
import type { GameContext } from '../../lib/nixkit/meta';

export default function start({ createGame, store }: GameContext) {
	const game = createGame({ spawn: { pos: new THREE.Vector3(0, 0, 0), heading: 0 } });
	if (!game) return;
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

`createGame` also takes `canGlide` and `canDash` (both off unless given) and `onKey` (keys that
aren't for moving: `e` waves and `q` dashes unless the game uses them). What it gives back:

| | |
| --- | --- |
| `parts` | the world: parts, pickups, checkpoints (below) |
| `hud` | `stat(text)` a counter along the top, `banner(title, note)`, `toast(text)`, `button(label, fn)`, `flash()` |
| `player` | Nixchan: `pos`, `vel`, `grounded`, `airborne`, `launch(speed)`, `respawn()` |
| `onUpdate(fn)` | `fn(dt, time)` every frame, after the parts and she have moved |
| `teleport(pos, heading)` | puts her somewhere, and makes it where she comes back to |
| `scene`, `camera`, `toon` | for adding anything else three.js can draw (`toon` makes a material in the kit's shading) |
| `loaded`, `start()`, `paused` | settles once she's here; starts the loop; stops everything |

`store.get(key)` and `store.set(key, value)` remember things for the game between visits.

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
- `meta.ts`, `runner.ts`: what a game in `src/games/` is, its `store`, and what runs it on its page
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
