// Things standing on the island that she walks round, climbs onto or glides past, kept in a grid
// of cells so each frame only looks at the few nearby. With the terrain, the pier and the sky island
// they answer the one question movement asks: how high is what she'd stand on here? Under the sky
// island that depends on how high she is, so movement asks it with her height.
import { within, type Obstacle, type World } from '../nixkit/world';
import { blockGround } from './blocks';
import { beltGround } from './power';
import { skyCeiling, skyGround, skyWaterDepth, windLift } from './skyisle';
import { SWIM_IN, SWIM_OUT, WORLD_EDGE, deckAt, terrainAt } from './terrain';

/** A trunk, rock, plinth or tree: what Nixkit calls an obstacle (nixkit/world.ts). */
export type Feature = Obstacle;
export { within };

const CELL = 4;
const cells = new Map<number, Feature[]>();
const cellKey = (cx: number, cz: number) => (cx + 1000) * 4096 + (cz + 1000);

function cellsOf(f: Feature, each: (key: number) => void) {
	const c = f.crown;
	const reach = Math.max(f.r, c ? Math.hypot(c.x - f.x, c.z - f.z) + c.r : 0) + 1;
	for (let cx = Math.floor((f.x - reach) / CELL); cx <= Math.floor((f.x + reach) / CELL); cx++)
		for (let cz = Math.floor((f.z - reach) / CELL); cz <= Math.floor((f.z + reach) / CELL); cz++) each(cellKey(cx, cz));
}

export function addFeature(f: Feature) {
	cellsOf(f, (k) => {
		const list = cells.get(k);
		if (list) list.push(f);
		else cells.set(k, [f]);
	});
}

/** Takes away something that was added (as when a sprinkler is picked up). */
export function removeFeature(f: Feature) {
	cellsOf(f, (k) => {
		const list = cells.get(k);
		const i = list?.indexOf(f) ?? -1;
		if (list && i >= 0) list.splice(i, 1);
	});
}

/** Everything that might reach (x, z). */
export const nearby = (x: number, z: number) => cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL))) ?? [];

/** Whether nothing stands within `gap` of (x, z). */
export function roomy(x: number, z: number, gap: number) {
	for (let cx = -1; cx <= 1; cx++)
		for (let cz = -1; cz <= 1; cz++)
			for (const f of cells.get(cellKey(Math.floor(x / CELL) + cx, Math.floor(z / CELL) + cz)) ?? [])
				if (Math.hypot(x - f.x, z - f.z) < f.r + gap) return false;
	return true;
}

/** The height of whatever she'd stand on at (x, z): the ground, the pier, the top of a rock, a
 * stack of her blocks, a belt, or the sky island. Without `y` (how high she is) it's what's down on the ground, ignoring the sky. */
export function groundAt(x: number, z: number, y?: number) {
	let g = Math.max(terrainAt(x, z), deckAt(x, z), blockGround(x, z), beltGround(x, z));
	if (y !== undefined) g = Math.max(g, skyGround(x, z, y));
	for (const f of nearby(x, z)) {
		if (!within(f, y)) continue;
		if (f.pad !== undefined) {
			if ((x - f.x) ** 2 + (z - f.z) ** 2 < f.r * f.r) g = Math.max(g, f.pad);
			continue;
		}
		if (!f.dome) continue;
		const d2 = ((x - f.x) ** 2 + (z - f.z) ** 2) / (f.r * f.r);
		if (d2 < 1) g = Math.max(g, f.dome.base + f.dome.top * Math.sqrt(1 - d2));
	}
	return g;
}

/** How high she can be at (x, z) before her head meets something over it: the sky island's rock,
 * for anyone under it, and otherwise nothing. */
export const ceilingAt = (x: number, z: number, y: number) => skyCeiling(x, z, y);

/** The island as a Nixkit world, for Nixchan and the camera to move about in. */
export const islandWorld: World = {
	groundAt,
	ceilingAt,
	nearby,
	inside: (x, z) => Math.hypot(x, z) <= WORLD_EDGE,
	sea: { swimIn: SWIM_IN, swimOut: SWIM_OUT },
	wadeDepth: skyWaterDepth,
	windLift,
	fallOut: -4,
};
