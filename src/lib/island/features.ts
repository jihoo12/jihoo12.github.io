// Things standing on the island that she walks round, climbs onto or glides past, kept in a grid
// of cells so each frame only looks at the few nearby. With the terrain, the pier and the sky island
// they answer the one question movement asks: how high is what she'd stand on here? Under the sky
// island that depends on how high she is, so movement asks it with her height.
import { blockGround } from './blocks';
import { STAND, skyCeiling, skyGround } from './skyisle';
import { deckAt, terrainAt } from './terrain';

/** A trunk she walks round, a rock she can climb onto (a dome in the heightfield), or a flat-topped
 * plinth she can step or jump up onto (a pad). A tree's trunk stops at `top`, and its leaves are a
 * ball (`crown`) that she glides round rather than through, and that the camera won't sit inside. */
export interface Feature {
	x: number;
	z: number;
	r: number;
	dome?: { base: number; top: number };
	pad?: number;
	top?: number;
	crown?: { x: number; y: number; z: number; r: number };
	/** For something up on the sky island: the height it stands at. It's only there for her when
	 * she's up there too, and not for anything on the ground far below it. */
	floor?: number;
}

/** Whether a feature is there at all for someone at height `y` (unknown: down on the ground). */
export const within = (f: Feature, y: number | undefined) => f.floor === undefined || (y !== undefined && y >= f.floor - STAND);

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
 * stack of her blocks, or the sky island. Without `y` (how high she is) it's what's down on the ground, ignoring the sky. */
export function groundAt(x: number, z: number, y?: number) {
	let g = Math.max(terrainAt(x, z), deckAt(x, z), blockGround(x, z));
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
