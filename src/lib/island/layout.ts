// Where things go: where she starts, and the places to come across (a lighthouse, a campfire,
// standing stones, a flag on the summit, an islet out at sea, her garden, the sky island…). Some sit at fixed spots
// round the coast; the rest are picked, the same every visit, from ground that suits them.
import * as THREE from 'three';
import { groundAt } from './features';
import { CROWN, MAIN, TEMPLE, WINDSPOUT } from './skyisle';
import { COAST, H, HALF, ISLET, N, PIER, PIER_ANGLE, PIER_DIR, STEP, islandHeight, mainHeight, slopeUp, terrainAt } from './terrain';
import { TAU, rng } from '../nixkit/util';

export interface Place {
	id: string;
	name: string;
	x: number;
	z: number;
	/** How close she comes before it counts as being there. */
	r: number;
	/** How far round it to keep clear of trees and rocks. */
	clear: number;
	/** How high she has to be for it to count, for a place up in the sky. */
	above?: number;
}

export type Layout = ReturnType<typeof planIsland>;

export function planIsland() {
	// Where she starts: on the beach by the pier.
	const startAlong = COAST - 8;
	const START = new THREE.Vector3(PIER_DIR.x * startAlong - PIER_DIR.z * 3, 0, PIER_DIR.z * startAlong + PIER_DIR.x * 3);
	START.y = groundAt(START.x, START.z);

	const BUOY = (() => {
		const a = PIER_ANGLE + 2.5;
		const dir = { x: Math.cos(a), z: Math.sin(a) };
		let r = 45;
		while (r < 96 && islandHeight(dir.x * r, dir.z * r) > -1.6) r += 0.5;
		r = Math.min(r + 6, 105);
		return new THREE.Vector3(dir.x * r, 0, dir.z * r);
	})();

	const places: Place[] = [];
	/** The places' random stream. The standing stones carry on drawing from it after the places are
	 * picked, so it's handed on rather than started afresh. */
	const prand = rng(31);
	const farFromPlaces = (x: number, z: number, gap: number) => places.every((p) => Math.hypot(p.x - x, p.z - z) > gap);
	const farFromStart = (x: number, z: number, gap: number) => Math.hypot(x - START.x, z - START.z) > gap;
	const flatAround = (x: number, z: number, radius: number, tolerance: number) => {
		const g = terrainAt(x, z);
		for (let k = 0; k < 8; k++) {
			const a = (k * TAU) / 8;
			if (Math.abs(terrainAt(x + Math.cos(a) * radius, z + Math.sin(a) * radius) - g) > tolerance) return false;
		}
		return true;
	};
	const findSpot = (ok: (x: number, z: number, g: number) => boolean, fallback: { x: number; z: number }) => {
		for (let tries = 0; tries < 4000; tries++) {
			const a = prand() * TAU;
			const r = Math.sqrt(prand()) * 87;
			const x = Math.cos(a) * r;
			const z = Math.sin(a) * r;
			if (ok(x, z, terrainAt(x, z))) return { x, z };
		}
		return fallback;
	};

	places.push({ id: 'pier', name: 'The Old Pier', x: PIER_DIR.x * (PIER.to - 2), z: PIER_DIR.z * (PIER.to - 2), r: 5, clear: 0 });
	const SUMMIT = (() => {
		let top = { x: 0, z: 0, h: -Infinity };
		for (let j = 0; j <= N; j++)
			for (let i = 0; i <= N; i++) if (H(i, j) > top.h) top = { x: -HALF + i * STEP, z: -HALF + j * STEP, h: H(i, j) };
		return top;
	})();
	places.push({ id: 'summit', name: 'Snowcap Summit', x: SUMMIT.x, z: SUMMIT.z, r: 9, clear: 3 });
	// The lighthouse stands on the last high ground before the sea, round the coast from the pier.
	const LIGHT = (() => {
		const a = PIER_ANGLE - 1.75;
		const dir = { x: Math.cos(a), z: Math.sin(a) };
		let edge = 60;
		for (let r = 30; r < 150; r += 0.5) if (mainHeight(dir.x * r, dir.z * r) > 2.2) edge = r;
		return { x: dir.x * (edge - 2), z: dir.z * (edge - 2) };
	})();
	places.push({ id: 'lighthouse', name: 'Lighthouse Point', ...LIGHT, r: 9, clear: 4.5 });
	const CAMP = findSpot(
		(x, z, g) => g > 2.4 && g < 6.5 && slopeUp(x, z) > 0.95 && flatAround(x, z, 4, 0.8) && farFromStart(x, z, 22) && farFromPlaces(x, z, 24),
		{ x: -45, z: 38 },
	);
	places.push({ id: 'camp', name: 'Campfire Clearing', ...CAMP, r: 7, clear: 5.5 });
	const STONES = findSpot(
		(x, z, g) => g > 4 && g < 12 && slopeUp(x, z) > 0.9 && flatAround(x, z, 5.2, 1.4) && farFromStart(x, z, 22) && farFromPlaces(x, z, 22),
		{ x: 15, z: -52 },
	);
	places.push({ id: 'stones', name: 'The Standing Stones', ...STONES, r: 8, clear: 7 });
	places.push({ id: 'islet', name: 'Lonely Islet', x: ISLET.x, z: ISLET.z, r: ISLET.r * 0.75, clear: 0 });
	places.push({ id: 'buoy', name: 'The Far Buoy', x: BUOY.x, z: BUOY.z, r: 5, clear: 0 });
	// Her garden, on flat grass a short walk inland from where she starts, its plots facing the beach.
	const GARDEN = findSpot(
		(x, z, g) => {
			const d = Math.hypot(x - START.x, z - START.z);
			return d > 14 && d < 40 && g > 1.6 && g < 5.5 && slopeUp(x, z) > 0.9 && flatAround(x, z, 6.5, 0.9) && farFromPlaces(x, z, 18);
		},
		{ x: START.x * 0.7, z: START.z * 0.7 },
	);
	const GARDEN_ANGLE = Math.atan2(START.x - GARDEN.x, START.z - GARDEN.z);
	places.push({ id: 'garden', name: "Nixchan's Garden", ...GARDEN, r: 8, clear: 8.5 });
	// The trees and rocks were laid out before there was a sky island, and keep to the places above
	// so that none of them moves. The Windspout stands where none of them is in its way.
	const scattered = [...places];
	places.push({ id: 'windspout', name: 'The Windspout', x: WINDSPOUT.x, z: WINDSPOUT.z, r: WINDSPOUT.r, clear: 0 });
	places.push({ id: 'sky', name: 'Cloudrest', x: MAIN.x, z: MAIN.z, r: MAIN.r * 0.75, clear: 0, above: MAIN.y - 3 });
	places.push({ id: 'temple', name: 'Temple of the Winds', x: TEMPLE.x, z: TEMPLE.z, r: 8, clear: 0, above: MAIN.y - 3 });
	places.push({ id: 'spire', name: 'The Sky Spire', x: CROWN.x, z: CROWN.z, r: CROWN.r * 0.8, clear: 0, above: CROWN.y - 3 });

	return {
		START,
		BUOY,
		SUMMIT,
		LIGHT,
		CAMP,
		STONES,
		GARDEN,
		GARDEN_ANGLE,
		places,
		prand,
		/** Whether (x, z) is clear of every place by `gap` beyond the room it keeps round itself. */
		clearOfPlaces: (x: number, z: number, gap: number) => scattered.every((p) => Math.hypot(p.x - x, p.z - z) > p.clear + gap),
		clearOfStart: (x: number, z: number, gap: number) => Math.hypot(x - START.x, z - START.z) > gap,
	};
}
