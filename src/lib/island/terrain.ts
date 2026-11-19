// The island's shape: a heightfield, so walking, wading, swimming, climbing and gliding are all one
// question (how high is the ground here?) and need no physics engine. Also the pier, which is the
// one bit of ground that isn't part of the heightfield.
import * as THREE from 'three';
import { fbm, noise, smoothstep } from '../nixkit/util';

export const R = 120; // the island's radius, give or take its ragged coast
export const SIZE = 420; // the terrain mesh covers SIZE × SIZE, centred on the origin
export const N = 336;
export const STEP = SIZE / N;
export const HALF = SIZE / 2;
const PEAK = { x: -27, z: -21 };
export const SEA_FLOOR = -6;
/** She starts swimming where the sea floor drops below this, and finds her feet again above SWIM_OUT. */
export const SWIM_IN = -1.35;
export const SWIM_OUT = -1.2;
/** A little islet out at sea, a swim (or a glide) away from the main island. */
export const ISLET = { x: Math.cos(-1.25) * 172, z: Math.sin(-1.25) * 172, r: 24 };
/** How far she can roam before the open sea turns her back. */
export const WORLD_EDGE = 208;

export function mainHeight(x: number, z: number) {
	// How far out from the middle, with the coast pushed in and out so it isn't a circle.
	const d = Math.hypot(x, z) / R + fbm(x * 0.018 + 31, z * 0.018 - 7, 3) * 0.3;
	// A flat top that falls away through the beach to the sea floor.
	const base = 1.3 - 7.3 * smoothstep(0.52, 1.0, d);
	const inland = smoothstep(0.62, 0.36, d);
	const hills = (fbm(x * 0.03 + 5, z * 0.03 + 9, 4) * 0.5 + 0.5) * 6 * inland;
	const pd = Math.hypot(x - PEAK.x, z - PEAK.z);
	const peak = 16 * Math.exp(-(pd * pd) / 620) * smoothstep(0.75, 0.4, d);
	return base + hills + peak;
}

function isletHeight(x: number, z: number) {
	const d = Math.hypot(x - ISLET.x, z - ISLET.z) / ISLET.r + fbm(x * 0.05 - 3, z * 0.05 + 11, 2) * 0.18;
	return 1.4 - 7.4 * smoothstep(0.45, 1.0, d) + 1.6 * smoothstep(0.5, 0.0, d);
}

/** Steepens the ground where it passes through the water line and leaves it alone elsewhere (the
 * bump is gone by a metre or so either side), so no beach runs almost level with the sea. Where it
 * did, sand and water fought over the same pixels and the surf swept metres back and forth. */
function shoreline(h: number) {
	return h + 1.5 * h * Math.exp(-(h * h) / 0.36);
}

export function islandHeight(x: number, z: number) {
	return shoreline(Math.max(mainHeight(x, z), isletHeight(x, z)));
}

/** The heightfield's vertices, row by row: (N + 1) × (N + 1) of them. */
export const heights = new Float32Array((N + 1) * (N + 1));
for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) heights[j * (N + 1) + i] = islandHeight(-HALF + i * STEP, -HALF + j * STEP);
export const H = (i: number, j: number) => heights[j * (N + 1) + i];

/** The terrain's height at (x, z), read off the same triangles the mesh is drawn with. */
export function terrainAt(x: number, z: number) {
	const fx = (x + HALF) / STEP;
	const fz = (z + HALF) / STEP;
	if (fx < 0 || fz < 0 || fx >= N || fz >= N) return SEA_FLOOR;
	const i = Math.floor(fx);
	const j = Math.floor(fz);
	const u = fx - i;
	const v = fz - j;
	const a = H(i, j);
	const b = H(i, j + 1);
	const c = H(i + 1, j + 1);
	const d = H(i + 1, j);
	return u + v <= 1 ? a + (d - a) * u + (b - a) * v : c + (b - c) * (1 - u) + (d - c) * (1 - v);
}

/** How upright the ground is at (x, z): 1 on the flat, less on a slope. */
export function slopeUp(x: number, z: number) {
	const dx = terrainAt(x + 0.5, z) - terrainAt(x - 0.5, z);
	const dz = terrainAt(x, z + 0.5) - terrainAt(x, z - 0.5);
	return 1 / Math.sqrt(1 + dx * dx + dz * dz);
}

// ---------- the pier ----------

export const PIER_ANGLE = 0.55;
export const PIER_DIR = { x: Math.cos(PIER_ANGLE), z: Math.sin(PIER_ANGLE) };
export const COAST = (() => {
	for (let r = 30; r < 170; r += 0.25) if (islandHeight(PIER_DIR.x * r, PIER_DIR.z * r) < 0.3) return r;
	return 90;
})();
export const PIER = { from: COAST - 4, to: COAST + 16, half: 1.25, deck: 1.25 };

/** The pier's deck height at (x, z), or -Infinity off it. */
export function deckAt(x: number, z: number) {
	const along = x * PIER_DIR.x + z * PIER_DIR.z;
	const across = -x * PIER_DIR.z + z * PIER_DIR.x;
	return along >= PIER.from && along <= PIER.to && Math.abs(across) <= PIER.half ? PIER.deck : -Infinity;
}

/** Whether (x, z) is within `gap` of the pier. */
export function nearPier(x: number, z: number, gap: number) {
	const along = x * PIER_DIR.x + z * PIER_DIR.z;
	const across = -x * PIER_DIR.z + z * PIER_DIR.x;
	return along > PIER.from - gap && along < PIER.to + gap && Math.abs(across) < PIER.half + gap;
}

// ---------- the mesh ----------

/** One faceted mesh, each triangle coloured by how high and how steep it is. */
export function terrainMesh(material: THREE.Material) {
	const COLORS = {
		seabed: new THREE.Color('#c9b48a'),
		wet: new THREE.Color('#e3cc95'),
		sand: new THREE.Color('#f4e2ae'),
		snow: new THREE.Color('#f6f5ff'),
		cliff: new THREE.Color('#a8a3c8'),
		dirt: new THREE.Color('#b9aa8a'),
		grassLight: new THREE.Color('#9ad67f'),
		grass: new THREE.Color('#88cc73'),
		grassDark: new THREE.Color('#78bf68'),
	};
	const pos = new Float32Array(N * N * 18);
	const col = new Float32Array(N * N * 18);
	const a = new THREE.Vector3();
	const b = new THREE.Vector3();
	const c = new THREE.Vector3();
	const e1 = new THREE.Vector3();
	const e2 = new THREE.Vector3();
	let o = 0;
	const tri = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3) => {
		const h = (p.y + q.y + r.y) / 3;
		const x = (p.x + q.x + r.x) / 3;
		const z = (p.z + q.z + r.z) / 3;
		const ny = e1.subVectors(q, p).cross(e2.subVectors(r, p)).normalize().y;
		const n = noise(x * 0.15, z * 0.15);
		const color =
			h < 0.55
				? h < -1.5
					? COLORS.seabed
					: COLORS.wet
				: h < 1.5 + n * 0.4
					? COLORS.sand
					: h > 14.5 + n * 1.5
						? COLORS.snow
						: ny < 0.74
							? h > 8
								? COLORS.cliff
								: COLORS.dirt
							: n > 0.25
								? COLORS.grassLight
								: n < -0.3
									? COLORS.grassDark
									: COLORS.grass;
		for (const v of [p, q, r]) {
			v.toArray(pos, o);
			color.toArray(col, o);
			o += 3;
		}
	};
	const at = (v: THREE.Vector3, i: number, j: number) => v.set(-HALF + i * STEP, H(i, j), -HALF + j * STEP);
	const d = new THREE.Vector3();
	for (let j = 0; j < N; j++)
		for (let i = 0; i < N; i++) {
			at(a, i, j);
			at(b, i, j + 1);
			at(c, i + 1, j + 1);
			at(d, i + 1, j);
			tri(a, b, d);
			tri(b, c, d);
		}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
	geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
	geo.computeVertexNormals();
	const terrain = new THREE.Mesh(geo, material);
	terrain.receiveShadow = true;
	terrain.castShadow = true;
	return terrain;
}
