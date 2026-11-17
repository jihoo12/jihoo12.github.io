// Things standing on the island that she walks round, climbs onto or glides past, kept in a grid
// of cells so each frame only looks at the few nearby. With the terrain and the pier they answer
// the one question movement asks: how high is what she'd stand on here?
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
}

const CELL = 4;
const cells = new Map<number, Feature[]>();
const cellKey = (cx: number, cz: number) => (cx + 1000) * 4096 + (cz + 1000);

export function addFeature(f: Feature) {
	const c = f.crown;
	const reach = Math.max(f.r, c ? Math.hypot(c.x - f.x, c.z - f.z) + c.r : 0) + 1;
	for (let cx = Math.floor((f.x - reach) / CELL); cx <= Math.floor((f.x + reach) / CELL); cx++)
		for (let cz = Math.floor((f.z - reach) / CELL); cz <= Math.floor((f.z + reach) / CELL); cz++) {
			const k = cellKey(cx, cz);
			const list = cells.get(k);
			if (list) list.push(f);
			else cells.set(k, [f]);
		}
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

/** The height of whatever she'd stand on at (x, z): the ground, the pier, or the top of a rock. */
export function groundAt(x: number, z: number) {
	let g = Math.max(terrainAt(x, z), deckAt(x, z));
	for (const f of nearby(x, z)) {
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
