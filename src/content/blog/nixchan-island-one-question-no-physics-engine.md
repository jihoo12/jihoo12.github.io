---
title: "Nixchan's Island: One Question Instead of a Physics Engine"
description: "A small three.js game where Nixchan walks, swims, climbs, glides and rides the wind up to islands in the sky, and every one of those moves comes down to asking how high the ground is."
pubDate: 2026-11-17
heroImage: "../../assets/nixchan/nixchan-island-3d-01.png"
---

There's a little game on this site now. At [/island](/island/), Nixchan has a toon island to run about on. She can swim off the beach, fish from the pier, grow turnips, sell them to Pebble the otter at the market stand, mine ore at the Old Forge, and glide up on a column of wind to Cloudrest, a cluster of islands floating in the sky.

It started as one evening's idea: the 3D Nixchan from the [experimental homepage](/experimental/) could already walk and jump, so what if she had somewhere to go? It grew one thing at a time. The game is about 7,000 lines of TypeScript on three.js, and it has no physics engine. This post is about how it gets away without one.

## The one question

A physics engine solves a general problem: any shape against any other shape, with forces, friction and collisions. My island needs much less. Nixchan is always standing on something, swimming in something, or falling towards something. So every frame, movement asks just one question:

> How high is whatever she'd stand on here?

The island is a **heightfield**, a grid of heights 336 cells across, and the terrain mesh is drawn from that same grid. To find the ground under any point, you find which triangle of the grid it's in and read the height off it. Since the mesh and the lookup use the same triangles, her feet always land exactly on the grass you can see.

The heights come from a function: a flat top that falls away through the beach to the sea floor, some noise for hills, and one bump for the snowy peak.

```ts
export function mainHeight(x: number, z: number) {
	const d = Math.hypot(x, z) / R + fbm(x * 0.018 + 31, z * 0.018 - 7, 3) * 0.3;
	const base = 1.3 - 7.3 * smoothstep(0.52, 1.0, d);
	const inland = smoothstep(0.62, 0.36, d);
	const hills = (fbm(x * 0.03 + 5, z * 0.03 + 9, 4) * 0.5 + 0.5) * 6 * inland;
	const pd = Math.hypot(x - PEAK.x, z - PEAK.z);
	const peak = 16 * Math.exp(-(pd * pd) / 620) * smoothstep(0.75, 0.4, d);
	return base + hills + peak;
}
```

Noise is added to the distance from the middle, which pushes the coast in and out so the island isn't a circle.

## Everything is ground

The heightfield is just the start. Anything Nixchan can stand on gets folded into that same answer. `groundAt` takes the highest of:

- the terrain,
- the pier's deck,
- the top of a rock, treated as a dome over a circle,
- the flat top of a plinth she can jump onto,
- and the grass of a sky island, if she's high enough to be on it.

```ts
export function groundAt(x: number, z: number, y?: number) {
	let g = Math.max(terrainAt(x, z), deckAt(x, z));
	if (y !== undefined) g = Math.max(g, skyGround(x, z, y));
	for (const f of nearby(x, z)) {
		// rocks are domes, plinths are pads
	}
	return g;
}
```

Rocks and trees sit in a grid of 4-metre cells, so each frame only looks at the few things nearby instead of all of them.

Once everything is "ground", every move becomes a comparison between that height and her own:

- **Walking**: she can step to a new spot if the ground there is no more than half a metre higher, plus a little for the length of the step. So she takes slopes in her stride, but a cliff stops her.
- **Falling**: if the ground drops more than 0.6 m below her feet, she has stepped off an edge, and gravity takes over until she lands.
- **Swimming**: when the sea floor drops below −1.35 m she starts swimming, and she finds her feet again above −1.2 m. The gap between those two numbers keeps her from flickering between walking and swimming at the waterline.
- **Gliding**: jump again in mid-air and the glider opens. She sinks slowly and only lands where the ground comes up to meet her.

Trees are the one thing that isn't ground. A trunk is a circle she gets pushed out of. When she's pushed, the part of her speed that was carrying her into the trunk is removed, so she slides round it instead of pressing against it and juddering. In the air, a tree's leaves are a ball that she glides round.

If a move is blocked, she tries moving in x alone, then in z alone. That one trick is why she slides along a cliff instead of sticking to it.

## When the ground depends on how high you are

A heightfield has one height at every point, and Cloudrest broke that. The great sky island hangs over the coast on a crag of rock fifty metres deep. Under it there are two things to stand on at the same (x, z): the beach far below, and the grass far above.

The fix was to let the question take one more argument: how high she is. `skyGround(x, z, y)` returns a sky island's grass only if she's at or above it, so it's there for her when she's up there and not when she's on the beach underneath. Its partner, `skyCeiling`, returns the underside of the rock for anyone below it, so she can't glide up through the island from beneath.

The features up there work the same way. A tree on Cloudrest has a `floor`, the height it stands at, and it only exists for someone who's up there too. Otherwise Nixchan on the beach would bump into the trunk of a tree fifty metres over her head.

To get her up there, there's the **Windspout**, a column of wind on the hillside. `windLift(x, z, y)` returns how fast it carries her glider up: strongest in the middle of the column, and fading out over the top so she comes out level, just above the island's edge. It's yet another function of position.

## The pieces

Everything else is built from the same few patterns.

**What E does.** Anything on the island that she can do something with registers an offer source. Each frame, the first source with something to say wins: its label goes in the prompt, and pressing E runs it. The fishing rod, the garden, Pebble, the anvil and the sky chest don't know about each other. Adding a new thing to do is one call:

```ts
interactions.add(() => (nearChest() ? { label: 'Open the chest', go: openChest } : null));
```

**Saving.** The island remembers your bag, garden, fish book, map and forge in `localStorage`, and every key lives in one file, `save.ts`. When the island grew and old maps no longer lined up, bumping one key to `island-map-v2` was enough. Reading never throws, and saved values are checked before they're used, because they might come from an older version or be edited by hand.

**Models.** The fish, the garden, Pebble, the sky ruins and the forge are made in Blender, but not by hand. Each one is built by a Python script in `tools/`, run headless:

```sh
nix develop .#blender -c blender -b -P tools/island-otter/build.py -- otter.glb
```

The scripts model in three.js's coordinates and metres, so a model drops into the scene with no fixing up. Their materials carry flat colours that the page turns into toon materials with a three-step shading ramp, so everything on the island shares one look. And since they're scripts, a model can be changed and rebuilt like any other code.

**Icons.** The pictures in the bag and at the market, like a fish or a turnip, aren't image files. The game renders each 3D model once into an offscreen target and keeps the result as an image.

## What I'd tell myself at the start

Pick the question the game actually asks before reaching for a general solution. For a character on an island, that question was "how high is the ground here?", and swimming, climbing, gliding and even floating islands all fit as answers to it. The one time the island didn't fit, the answer was to add an argument to the question, not to replace it.

It does have limits. Nothing pushes back on Nixchan, nothing tumbles, and two moving things never collide. For this island, that's fine.

Go and [visit her](/island/). It works on computers and phones, and it remembers her bag, her garden and the places she has found.
