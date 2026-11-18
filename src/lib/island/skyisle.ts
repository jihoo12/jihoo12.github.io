// Cloudrest: islands floating high over the sea past the summit. The great one hangs over the coast
// on a crag of rock fifty metres deep, ringed with cloud; on its grass are a ring temple, a lake that
// spills off the edge in two long waterfalls, blossom trees, and a path of arches and lanterns up
// from where the wind brings her. Over its far edge floats a smaller, higher island with a spire on
// it and a chest, and its own waterfall falling past the great one into the sky; round about, three
// little islands make stepping stones to glide between.
//
// She gets up on the Windspout: a column of wind on the hillside below that blows straight up, and
// carries her glider up past the edge. A second one, on the great island, lifts her to the spire.
// There's a reason to come back: sky shards grow on the crystals here (gathered, they grow back
// after a while), and fish live in the lake that live nowhere else.
//
// The islands are floors over the heightfield, so the ground is no longer one height everywhere:
// under them, it depends how high she is. `skyGround` is an island's grass for anyone on (or
// falling onto) it, and `skyCeiling` the rock over the head of anyone below; features.ts folds both
// into `groundAt` and `ceilingAt`. The ruins are Blender models (tools/island-sky).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Feature } from './features';
import type { Inventory } from './inventory';
import type { Offer } from './interact';
import { colored, glowTexture, type Toon } from './look';
import { loadJSON, saveJSON } from './save';
import { terrainAt } from './terrain';
import type { Theme } from './theme';
import { TAU, clamp, damp, fbm, noise, rng, smoothstep } from './util';

/** One floating island: its middle, the height of its grass at the edge, its radius (give or take),
 * how deep its rock hangs below, how much its grass domes up in the middle, and a seed for its shape. */
export interface Isle {
	id: string;
	x: number;
	z: number;
	y: number;
	r: number;
	depth: number;
	dome: number;
	seed: number;
}

/** How far below the grass her feet can be and still count as up on an island (she lands on it from
 * up to this far under; below that it's rock over her head). Wider than a step, so that even a fast
 * fall can't skip past it in one frame. */
export const STAND = 1.5;

// The great island hangs out over the coast; "out" is the way away from the middle of the island
// below, and "across" the way round it.
const CENTRE = { x: -62, z: -84 };
const OUT = (() => {
	const d = Math.hypot(CENTRE.x, CENTRE.z);
	return { x: CENTRE.x / d, z: CENTRE.z / d };
})();
const ACROSS = { x: -OUT.z, z: OUT.x };
/** A point `out` along OUT and `across` along ACROSS from the great island's middle. */
const at = (out: number, across: number) => ({ x: CENTRE.x + OUT.x * out + ACROSS.x * across, z: CENTRE.z + OUT.z * out + ACROSS.z * across });

export const MAIN: Isle = { id: 'main', ...CENTRE, y: 56, r: 40, depth: 46, dome: 2.2, seed: 0 };
/** The upper island, over the great one's far edge. */
export const CROWN: Isle = { id: 'crown', ...at(30, 0), y: 80, r: 14, depth: 16, dome: 1.2, seed: 1 };
const LITTLE: Isle[] = [
	{ id: 'east', ...at(10, 53), y: 66, r: 6.5, depth: 9, dome: 0.6, seed: 2 },
	{ id: 'west', ...at(14, -50), y: 64, r: 7, depth: 10, dome: 0.6, seed: 3 },
	{ id: 'far', ...at(62, 0), y: 50, r: 5.5, depth: 8, dome: 0.5, seed: 4 },
];
export const ISLES: Isle[] = [MAIN, CROWN, ...LITTLE];

/** An island's edge, how far out from its middle at angle `a`: ragged, but the same all the way round. */
function rimAt(isle: Isle, a: number) {
	const c = Math.cos(a);
	const s = Math.sin(a);
	const k = isle.seed * 7.3;
	return isle.r * (1 + 0.14 * noise(c * 1.3 + 4.1 + k, s * 1.3 - 2.3) + 0.06 * noise(c * 3.7 - 1, s * 3.7 + 6 + k));
}

/** How far out (x, z) is on `isle`: 0 in the middle, 1 at the edge. */
function reach(isle: Isle, x: number, z: number) {
	const dx = x - isle.x;
	const dz = z - isle.z;
	if (dx * dx + dz * dz > isle.r * isle.r * 1.6) return 2;
	return Math.hypot(dx, dz) / rimAt(isle, Math.atan2(dz, dx));
}

// ---------- the great island's grass: a flat for the temple, a lake, and channels to the edge ----------

/** The temple, on the near half, where the path from the Windspout leads to it. */
export const TEMPLE = { ...at(-6, -15), r: 12 };
const domeAt = (isle: Isle, t: number) => isle.y + isle.dome * (1 - t * t);
const TEMPLE_FLOOR = domeAt(MAIN, reach(MAIN, TEMPLE.x, TEMPLE.z)) + 0.3;

function grassAt(isle: Isle, x: number, z: number, t: number) {
	let g = domeAt(isle, t) + 0.35 * fbm(x * 0.12 + 3 + isle.seed * 11, z * 0.12 - 8, 2) - 0.8 * smoothstep(0.85, 1, t);
	if (isle === MAIN) {
		const d = Math.hypot(x - TEMPLE.x, z - TEMPLE.z);
		g = THREE.MathUtils.lerp(g, TEMPLE_FLOOR, smoothstep(TEMPLE.r + 4, TEMPLE.r - 1, d));
	}
	return g;
}

export const LAKE = (() => {
	const c = at(2, 15);
	const r = 9;
	// The water stands a little below the lowest of the grass round it, so it never spills.
	let low = Infinity;
	for (let k = 0; k < 24; k++) {
		const a = (k / 24) * TAU;
		const x = c.x + Math.cos(a) * r * 1.3;
		const z = c.z + Math.sin(a) * r * 1.3;
		low = Math.min(low, grassAt(MAIN, x, z, reach(MAIN, x, z)));
	}
	return { ...c, r, level: low - 0.25 };
})();

/** The lake's two outflows, from its edge to the island's, each falling away as a waterfall. */
const OUTFLOWS = [0.32, -0.2].map((turn) => {
	const a = Math.atan2(ACROSS.z, ACROSS.x) + turn;
	const from = { x: LAKE.x + Math.cos(a) * LAKE.r * 0.8, z: LAKE.z + Math.sin(a) * LAKE.r * 0.8 };
	// Out to the edge, walking along until the grass ends.
	let s = 0;
	while (reach(MAIN, from.x + Math.cos(a) * s, from.z + Math.sin(a) * s) < 0.995) s += 0.25;
	return { a, from, to: { x: from.x + Math.cos(a) * s, z: from.z + Math.sin(a) * s }, length: s };
});

function topAt(isle: Isle, x: number, z: number, t: number) {
	let g = grassAt(isle, x, z, t);
	if (isle === MAIN) {
		// The lake bed, shelving down to a metre and a half deep in the middle.
		const dd = Math.hypot(x - LAKE.x, z - LAKE.z) / LAKE.r;
		if (dd < 1.6) g = Math.min(g, LAKE.level + (dd - 1) * 1.6);
		// The channels the outflows run down, a little lower the further they've come.
		for (const o of OUTFLOWS) {
			const dx = x - o.from.x;
			const dz = z - o.from.z;
			const along = dx * Math.cos(o.a) + dz * Math.sin(o.a);
			if (along < -1 || along > o.length + 1) continue;
			const side = Math.abs(-dx * Math.sin(o.a) + dz * Math.cos(o.a));
			if (side > 1.6) continue;
			const s = clamp(along / o.length, 0, 1);
			g = Math.min(g, LAKE.level - 0.2 - s * 0.6 + (side / 1.6) ** 2 * 1.2);
		}
	}
	return g;
}

function underAt(isle: Isle, x: number, z: number, t: number) {
	// Rounded under the edge, then down to a craggy point, ridged so it looks broken off the hills.
	const depth = isle.depth * Math.pow(Math.max(0, 1 - Math.pow(t, 1.5)), 0.85);
	const k = isle.seed * 13;
	const crag = 0.75 + 0.35 * noise(x * 0.12 + 9 + k, z * 0.12) + 0.3 * Math.abs(noise(x * 0.35 + k, z * 0.35 - 4));
	return isle.y - 1.9 - depth * crag;
}

/** The height of the grass at (x, z) on whichever island is there (the highest, if two are), or null. */
export function skyTopAt(x: number, z: number) {
	let top: number | null = null;
	for (const isle of ISLES) {
		const t = reach(isle, x, z);
		if (t < 1) top = Math.max(top ?? -Infinity, topAt(isle, x, z, t));
	}
	return top;
}

/** The grass under her feet at (x, z), if she's up on an island (or high enough to land on one). */
export function skyGround(x: number, z: number, y: number) {
	let g = -Infinity;
	for (const isle of ISLES) {
		const t = reach(isle, x, z);
		if (t >= 1) continue;
		const top = topAt(isle, x, z, t);
		if (y >= top - STAND) g = Math.max(g, top);
	}
	return g;
}

/** The underside of an island over her head at (x, z), if she's below one. */
export function skyCeiling(x: number, z: number, y: number) {
	let c = Infinity;
	for (const isle of ISLES) {
		const t = reach(isle, x, z);
		if (t >= 1 || y >= topAt(isle, x, z, t) - STAND) continue;
		c = Math.min(c, underAt(isle, x, z, t));
	}
	return c;
}

/** The lake's surface at (x, z), if that's lake water and she's up there with it; otherwise null. */
export function skyWaterAt(x: number, z: number, y: number) {
	if (y < MAIN.y - 8 || Math.hypot(x - LAKE.x, z - LAKE.z) > LAKE.r * 1.6) return null;
	const t = reach(MAIN, x, z);
	return t < 1 && topAt(MAIN, x, z, t) < LAKE.level - 0.05 ? LAKE.level : null;
}

/** How deep the lake is at (x, z), for her wading in from the shore (0 where it's dry). */
export function skyWaterDepth(x: number, z: number, y: number) {
	const w = skyWaterAt(x, z, y);
	return w === null ? 0 : w - topAt(MAIN, x, z, reach(MAIN, x, z));
}

// ---------- the Windspouts ----------

export interface Spout {
	x: number;
	z: number;
	r: number;
	base: number;
	top: number;
}
const SPOUT_R = 4.6;
/** One up from the hillside below to the great island's near edge, at a spot picked to be clear of
 * the trees and rocks scattered there (scatter.ts), which would catch her glider; and one on the
 * great island up to the spire's island, beside its edge. */
export const SPOUTS: Spout[] = (() => {
	const a1 = Math.atan2(-OUT.z, -OUT.x) + 0.07;
	const o1 = rimAt(MAIN, a1) + 10;
	const x1 = MAIN.x + Math.cos(a1) * o1;
	const z1 = MAIN.z + Math.sin(a1) * o1;
	const a2 = Math.atan2(MAIN.z - CROWN.z, MAIN.x - CROWN.x) + 0.35;
	const o2 = rimAt(CROWN, a2) + 6.5;
	const x2 = CROWN.x + Math.cos(a2) * o2;
	const z2 = CROWN.z + Math.sin(a2) * o2;
	return [
		{ x: x1, z: z1, r: SPOUT_R, base: terrainAt(x1, z1), top: MAIN.y + 6 },
		{ x: x2, z: z2, r: SPOUT_R, base: skyTopAt(x2, z2) ?? MAIN.y, top: CROWN.y + 6 },
	];
})();
export const WINDSPOUT = SPOUTS[0];
const RISE = 10;

/** How fast the wind would carry her glider up at (x, z, y): strongest in the middle of a column,
 * and dying away over the top of it so she comes out level, a little above the island it's beside. */
export function windLift(x: number, z: number, y: number) {
	for (const s of SPOUTS) {
		const d = Math.hypot(x - s.x, z - s.z);
		if (d > s.r || y < s.base - 1 || y > s.top + 3) continue;
		return RISE * smoothstep(s.r, s.r * 0.45, d) * smoothstep(s.top + 3, s.top - 4, y);
	}
	return 0;
}

// ---------- building it ----------

export interface SkyIsleContext {
	scene: THREE.Scene;
	toon: Toon;
	theme: Theme;
	inventory: Inventory;
	modelUrl: string;
	/** Where she is. */
	pos: THREE.Vector3;
	addFeature: (f: Feature) => void;
	toast: (text: string) => void;
}

const SHARD = 'sky-shard';
const SHARDS_IN_CHEST = 3;
/** A starbloom seed (farm.ts), and how often one comes away with a gathered shard. */
const STARBLOOM_SEED = 'seed-starbloom';
const STARBLOOM_CHANCE = 0.25;
/** How long a gathered crystal takes to grow back. */
const REGROW_MS = 12 * 60 * 1000;

/** A shader for running water and rising wind: streaks that scroll along a surface, from its uv's
 * v = 0 end towards v = 1 at `flow`, fading out over the first `fadeIn` and the last `fadeOut` of it,
 * over a faint sheet of `body` between the streaks. */
function streakMaterial(
	color: string,
	opacity: number,
	opts: { additive?: boolean; flow: number; stretch: number; across: number; twist: number; fadeIn: number; fadeOut: number; body: number },
) {
	return new THREE.ShaderMaterial({
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide,
		fog: true,
		blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
		uniforms: THREE.UniformsUtils.merge([
			THREE.UniformsLib.fog,
			{ uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
		]),
		vertexShader: `
			#include <fog_pars_vertex>
			varying vec2 vUv;
			void main() {
				vUv = uv;
				vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
				gl_Position = projectionMatrix * mvPosition;
				#include <fog_vertex>
			}`,
		fragmentShader: `
			#include <fog_pars_fragment>
			uniform float uTime, uOpacity; uniform vec3 uColor; varying vec2 vUv;
			float hash(float n) { return fract(sin(n) * 43758.5453); }
			void main() {
				float lane = floor(vUv.x * ${opts.across.toFixed(1)});
				float along = vUv.y * ${opts.stretch.toFixed(1)} + vUv.x * ${opts.twist.toFixed(1)} - uTime * ${opts.flow.toFixed(2)} * (0.8 + 0.5 * hash(lane)) + hash(lane + 7.0) * 9.0;
				// Each lane is rounded off at its sides, so the streaks are soft threads, not shards.
				float soft = sin(3.14159 * fract(vUv.x * ${opts.across.toFixed(1)}));
				float streak = smoothstep(0.6, 0.95, fract(along)) * (0.55 + 0.45 * hash(lane + 3.0)) * soft;
				float edge = smoothstep(0.0, ${Math.max(opts.fadeIn, 1e-3).toFixed(3)}, vUv.y) * smoothstep(1.0, ${(1 - Math.max(opts.fadeOut, 1e-3)).toFixed(3)}, vUv.y);
				gl_FragColor = vec4(uColor, uOpacity * edge * (${opts.body.toFixed(2)} + streak));
				#include <colorspace_fragment>
				#include <fog_fragment>
			}`,
	});
}

/** A strip through `pts`, `width(s)` either side of them across the way they run (s runs 0 … 1). */
function ribbon(pts: THREE.Vector3[], across: THREE.Vector2, width: (s: number) => number) {
	const p: number[] = [];
	const uv: number[] = [];
	const idx: number[] = [];
	pts.forEach((c, i) => {
		const s = i / (pts.length - 1);
		const w = width(s);
		p.push(c.x - across.x * w, c.y, c.z - across.y * w, c.x + across.x * w, c.y, c.z + across.y * w);
		uv.push(0, s, 1, s);
		if (i > 0) idx.push((i - 1) * 2, (i - 1) * 2 + 1, i * 2, (i - 1) * 2 + 1, i * 2 + 1, i * 2);
	});
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
	g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	g.setIndex(idx);
	return g;
}

export function createSkyIsle(ctx: SkyIsleContext) {
	const { scene, toon } = ctx;
	const ticks: ((time: number, dt: number) => void)[] = [];
	const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
		const m = new THREE.Mesh(geo, mat);
		m.position.set(x, y, z);
		m.castShadow = m.receiveShadow = true;
		return m;
	};
	const stone = toon({ color: '#b9b3d6' });
	const darkStone = toon({ color: '#9890bb' });
	const glowTex = glowTexture();
	const glowSprite = (scale: number, opacity: number, color: string) => {
		const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, depthWrite: false, opacity, blending: THREE.AdditiveBlending, fog: false }));
		s.scale.setScalar(scale);
		return s;
	};
	const ground = (x: number, z: number) => skyTopAt(x, z) ?? MAIN.y;
	const nightGlows: THREE.Object3D[] = [];
	const rand = rng(77);
	/** Spots taken by something already, which trees keep clear of. */
	const taken: { x: number; z: number; r: number }[] = [
		{ ...TEMPLE, r: TEMPLE.r + 1 },
		{ x: LAKE.x, z: LAKE.z, r: LAKE.r * 1.35 },
		...SPOUTS.map((s) => ({ x: s.x, z: s.z, r: s.r + 2 })),
	];
	const free = (x: number, z: number, gap: number) => taken.every((t) => Math.hypot(t.x - x, t.z - z) > t.r + gap);

	// ---------- the rock itself ----------

	// Each island is one faceted mesh, like the island below: rings out from the middle for the
	// grass, the same rings again for the rock underneath, and a band of cliff joining them.
	const COLORS = {
		grass: new THREE.Color('#9ad67f'),
		grassLight: new THREE.Color('#a9df8a'),
		grassDark: new THREE.Color('#86c972'),
		dirt: new THREE.Color('#b9aa8a'),
		sand: new THREE.Color('#f4e2ae'),
		wet: new THREE.Color('#d9c38f'),
		rock: [new THREE.Color('#a8a3c8'), new THREE.Color('#9890bb'), new THREE.Color('#b4aed0'), new THREE.Color('#8c84b0')],
		root: new THREE.Color('#9a8a73'),
	};
	const rockMat = toon({ vertexColors: true });
	for (const isle of ISLES) {
		const RINGS = Math.max(8, Math.round(isle.r));
		const SEGS = clamp(Math.round((TAU * isle.r) / 1.6), 40, 160);
		const positions: number[] = [];
		const colors: number[] = [];
		const e1 = new THREE.Vector3();
		const e2 = new THREE.Vector3();
		const n = new THREE.Vector3();
		/** Adds a triangle, turned to face `facing` (up, down, or out from the middle). */
		const tri = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3, facing: 'up' | 'down' | 'out', color: (ny: number, y: number, x: number, z: number) => THREE.Color) => {
			n.crossVectors(e1.subVectors(q, p), e2.subVectors(r, p));
			if (n.lengthSq() < 1e-8) return;
			const cx = (p.x + q.x + r.x) / 3;
			const cy = (p.y + q.y + r.y) / 3;
			const cz = (p.z + q.z + r.z) / 3;
			const wrong = facing === 'up' ? n.y < 0 : facing === 'down' ? n.y > 0 : n.x * (cx - isle.x) + n.z * (cz - isle.z) < 0;
			const [a, b, c] = wrong ? [p, r, q] : [p, q, r];
			const col = color(Math.abs(n.normalize().y), cy, cx, cz);
			for (const v of [a, b, c]) {
				positions.push(v.x, v.y, v.z);
				colors.push(col.r, col.g, col.b);
			}
		};
		const rim = Array.from({ length: SEGS }, (_, j) => rimAt(isle, (j / SEGS) * TAU));
		const point = (i: number, j: number, surface: 'top' | 'under') => {
			const a = ((j % SEGS) / SEGS) * TAU;
			const t = i / RINGS;
			const r = t * rim[j % SEGS] * 0.9999;
			const x = isle.x + Math.cos(a) * r;
			const z = isle.z + Math.sin(a) * r;
			return new THREE.Vector3(x, surface === 'top' ? topAt(isle, x, z, t) : underAt(isle, x, z, t), z);
		};
		const grassColor = (ny: number, y: number, x: number, z: number) => {
			if (isle === MAIN && Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r * 1.6) {
				if (y < LAKE.level) return COLORS.wet;
				if (y < LAKE.level + 0.35) return COLORS.sand;
			}
			if (ny < 0.8) return COLORS.dirt;
			const k = noise(x * 0.15, z * 0.15);
			return k > 0.25 ? COLORS.grassLight : k < -0.3 ? COLORS.grassDark : COLORS.grass;
		};
		const rockColor = (_ny: number, y: number, x: number, z: number) => {
			// Strata: bands of stone by height, wavering a little, with a band of earth and roots round
			// the edge just under the grass (only the cliff joining the two, so its edge doesn't zigzag).
			if (reach(isle, x, z) > 1 - 0.5 / RINGS) return COLORS.root;
			const band = Math.floor((isle.y - y) / 2.6 + noise(x * 0.12, z * 0.12) * 0.7);
			return COLORS.rock[((band % 4) + 4) % 4];
		};
		for (const surface of ['top', 'under'] as const)
			for (let i = 0; i < RINGS; i++)
				for (let j = 0; j < SEGS; j++) {
					const a = point(i, j, surface);
					const b = point(i + 1, j, surface);
					const c = point(i + 1, j + 1, surface);
					const d = point(i, j + 1, surface);
					const facing = surface === 'top' ? 'up' : 'down';
					const color = surface === 'top' ? grassColor : rockColor;
					tri(a, b, c, facing, color);
					if (i > 0) tri(a, c, d, facing, color);
				}
		for (let j = 0; j < SEGS; j++) {
			const a = point(RINGS, j, 'top');
			const b = point(RINGS, j + 1, 'top');
			const c = point(RINGS, j + 1, 'under');
			const d = point(RINGS, j, 'under');
			tri(a, b, c, 'out', rockColor);
			tri(a, c, d, 'out', rockColor);
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
		geo.computeVertexNormals();
		const rock = new THREE.Mesh(geo, rockMat);
		rock.castShadow = rock.receiveShadow = true;
		scene.add(rock);
	}

	// Long crags of rock hanging under the great island and the spire's, so it looks torn up out of a
	// mountain; and roots and vines trailing from its edge.
	{
		const parts: THREE.BufferGeometry[] = [];
		const crag = (x: number, z: number, top: number, length: number, radius: number, hex: string) => {
			const g = new THREE.ConeGeometry(radius, length, 7, 4).toNonIndexed();
			g.rotateX(Math.PI);
			const p = g.attributes.position;
			for (let i = 0; i < p.count; i++) {
				const vx = p.getX(i);
				const vy = p.getY(i);
				const vz = p.getZ(i);
				const k = 1 + 0.22 * noise(vx * 0.6 + x, vy * 0.4 + vz * 0.6 + z);
				p.setXYZ(i, vx * k, vy, vz * k);
			}
			g.translate(x, top - length / 2, z);
			parts.push(colored(g, hex));
		};
		const under = (isle: Isle, x: number, z: number) => underAt(isle, x, z, reach(isle, x, z));
		for (const [isle, count, len, rad] of [
			[MAIN, 9, 30, 6],
			[CROWN, 3, 12, 3],
		] as const)
			for (let i = 0; i < count; i++) {
				const a = rand() * TAU;
				const t = 0.25 + rand() * 0.5;
				const r = rimAt(isle, a) * t;
				const x = isle.x + Math.cos(a) * r;
				const z = isle.z + Math.sin(a) * r;
				crag(x, z, under(isle, x, z) + rad * 0.6, len * (0.45 + rand() * 0.6) * (1 - t * 0.6), rad * (0.6 + rand() * 0.5), ['#a8a3c8', '#9890bb', '#8c84b0'][i % 3]);
			}
		const rocks = new THREE.Mesh(mergeGeometries(parts)!, toon({ vertexColors: true }));
		rocks.castShadow = true;
		scene.add(rocks);

		const VINES = 70;
		const vine = new THREE.CylinderGeometry(0.06, 0.03, 1, 4).translate(0, -0.5, 0);
		const vines = new THREE.InstancedMesh(vine, toon({ color: '#6aa85a' }), VINES);
		const m4 = new THREE.Matrix4();
		const tint = new THREE.Color();
		for (let i = 0; i < VINES; i++) {
			const isle = i < 50 ? MAIN : i < 62 ? CROWN : LITTLE[i % 3];
			const a = rand() * TAU;
			const r = rimAt(isle, a) * 0.985;
			const x = isle.x + Math.cos(a) * r;
			const z = isle.z + Math.sin(a) * r;
			const len = 2 + rand() * (isle === MAIN ? 9 : 4);
			vines.setMatrixAt(i, m4.compose(new THREE.Vector3(x, topAt(isle, x, z, 0.985) - 0.4, z), new THREE.Quaternion(), new THREE.Vector3(1, len, 1)));
			vines.setColorAt(i, tint.set(i % 3 ? '#6aa85a' : '#88c46f'));
		}
		scene.add(vines);
	}

	// Lumps of rock drifting round, bobbing gently, as if broken off; and a ring of cloud below the
	// great island's edge, turning slowly round it.
	{
		const lump = new THREE.DodecahedronGeometry(1, 0);
		const tuft = colored(new THREE.IcosahedronGeometry(0.75, 0), '#9ad67f');
		const tuftMat = toon({ vertexColors: true });
		for (let i = 0; i < 14; i++) {
			const a = (i / 14) * TAU + rand() * 0.3;
			const r = MAIN.r * (1.2 + rand() * 0.5);
			const y = MAIN.y - 4 - rand() * 26;
			const s = 1 + rand() * 2.6;
			const m = mesh(lump, i % 2 ? darkStone : stone, MAIN.x + Math.cos(a) * r, y, MAIN.z + Math.sin(a) * r);
			m.scale.set(s, s * 0.75, s);
			if (s > 2) m.add(mesh(tuft, tuftMat, 0, 0.7, 0));
			scene.add(m);
			const home = m.position.clone();
			ticks.push((time) => {
				m.position.y = home.y + Math.sin(time * 0.5 + i * 1.7) * 0.7;
				m.rotation.y = time * 0.04 * (i % 2 ? 1 : -1) + i;
			});
		}
		const cloudMat = toon({ color: '#ffffff' });
		const ring = new THREE.Group();
		ring.position.set(MAIN.x, 0, MAIN.z);
		const puff = new THREE.IcosahedronGeometry(1, 1);
		// Wisps, with gaps between them, low enough that the crags show above and through them.
		for (let i = 0; i < 12; i++) {
			const cloud = new THREE.Group();
			const puffs = 3 + Math.floor(rand() * 3);
			for (let k = 0; k < puffs; k++) {
				const p = new THREE.Mesh(puff, cloudMat);
				const s = 2.4 + rand() * 2.4;
				p.scale.set(s, s * 0.55, s);
				p.position.set((k - puffs / 2) * 3.6 + rand() * 1.5, rand() * 1.5, rand() * 3 - 1.5);
				cloud.add(p);
			}
			const a = (i / 12) * TAU + rand() * 0.3;
			const r = MAIN.r * (1.15 + rand() * 0.4);
			cloud.position.set(Math.cos(a) * r, MAIN.y - 22 - rand() * 18, Math.sin(a) * r);
			cloud.rotation.y = -a + Math.PI / 2;
			ring.add(cloud);
		}
		scene.add(ring);
		ticks.push((time) => (ring.rotation.y = time * 0.01));
		ctx.theme.on((p) => cloudMat.color.set(p.cloud));
	}

	// ---------- water ----------

	const flowing: THREE.ShaderMaterial[] = [];
	/** A waterfall from `lip`, out over the edge the way `a` points and down `length`, widening as it
	 * goes until it's all spray. */
	const waterfall = (lip: THREE.Vector3, a: number, length: number, width: number) => {
		const pts: THREE.Vector3[] = [];
		for (let k = 0; k <= 40; k++) {
			const s = (k / 40) * length;
			const outward = 0.4 + Math.sqrt(s) * 1.1;
			pts.push(new THREE.Vector3(lip.x + Math.cos(a) * outward, lip.y - s, lip.z + Math.sin(a) * outward));
		}
		const mat = streakMaterial('#e8f8ff', 0.85, { flow: 2.4, stretch: length / 5, across: 9, twist: 0, fadeIn: 0, fadeOut: 0.45, body: 0.55 });
		flowing.push(mat);
		const fall = new THREE.Mesh(
			ribbon(pts, new THREE.Vector2(-Math.sin(a), Math.cos(a)), (s) => width + s * width * 2.5),
			mat,
		);
		fall.renderOrder = 1;
		scene.add(fall);
		const lipSpray = glowSprite(width * 3, 0.45, '#ffffff');
		lipSpray.position.copy(pts[2]);
		const mist = glowSprite(width * 9, 0.18, '#ffffff');
		mist.position.copy(pts[24]);
		scene.add(lipSpray, mist);
	};
	/** Water running along a channel through `pts`. */
	const stream = (pts: THREE.Vector3[], a: number, width: number) => {
		const mat = streakMaterial('#dff6ff', 0.85, { flow: 1.6, stretch: pts.length / 3, across: 5, twist: 0, fadeIn: 0.05, fadeOut: 0, body: 0.5 });
		flowing.push(mat);
		const m = new THREE.Mesh(ribbon(pts, new THREE.Vector2(-Math.sin(a), Math.cos(a)), () => width), mat);
		m.renderOrder = 1;
		scene.add(m);
	};
	ticks.push((time) => {
		for (const m of flowing) m.uniforms.uTime.value = time;
	});

	// The lake, and its outflows down their channels and over the edge.
	{
		const water = mesh(new THREE.CircleGeometry(LAKE.r * 1.45, 40).rotateX(-Math.PI / 2), toon({ color: '#7fd3ec', transparent: true, opacity: 0.88 }), LAKE.x, LAKE.level, LAKE.z);
		water.receiveShadow = true;
		water.castShadow = false;
		scene.add(water);
		const sparkle = glowSprite(4, 0, '#ffffff');
		scene.add(sparkle);
		ticks.push((time) => {
			sparkle.position.set(LAKE.x + Math.sin(time * 0.3) * 3, LAKE.level + 0.3, LAKE.z + Math.cos(time * 0.23) * 3);
			sparkle.material.opacity = 0.25 + 0.15 * Math.sin(time * 1.3);
		});
		for (const o of OUTFLOWS) {
			const pts: THREE.Vector3[] = [];
			for (let k = 0; k <= 24; k++) {
				const s = k / 24;
				pts.push(new THREE.Vector3(o.from.x + Math.cos(o.a) * o.length * s, LAKE.level - 0.1 - s * 0.6, o.from.z + Math.sin(o.a) * o.length * s));
			}
			stream(pts, o.a, 0.9);
			waterfall(pts[pts.length - 1], o.a, 62, 1.1);
		}
	}

	// The spire's island has a spring of its own, in a ring of stones, falling off its far side
	// past the great island and on down into the sky.
	const SPRING = { a: Math.atan2(OUT.z, OUT.x) + 0.5, at: 0.55, r: 1.6 };
	{
		const a = SPRING.a;
		const R = rimAt(CROWN, a);
		const c = { x: CROWN.x + Math.cos(a) * R * SPRING.at, z: CROWN.z + Math.sin(a) * R * SPRING.at };
		let level = -Infinity;
		for (let k = 0; k < 12; k++) {
			const b = (k / 12) * TAU;
			level = Math.max(level, ground(c.x + Math.cos(b) * SPRING.r, c.z + Math.sin(b) * SPRING.r));
		}
		level += 0.06;
		scene.add(mesh(new THREE.CircleGeometry(SPRING.r, 18).rotateX(-Math.PI / 2), toon({ color: '#7fd3ec', transparent: true, opacity: 0.9 }), c.x, level, c.z));
		const pebble = new THREE.DodecahedronGeometry(0.38, 0);
		for (let k = 1; k < 10; k++) {
			const b = a + (k / 10) * TAU;
			const s = mesh(pebble, stone, c.x + Math.cos(b) * (SPRING.r + 0.2), level - 0.1, c.z + Math.sin(b) * (SPRING.r + 0.2));
			s.rotation.set(k, k * 2, 0);
			scene.add(s);
		}
		const lip = { x: CROWN.x + Math.cos(a) * R * 0.995, z: CROWN.z + Math.sin(a) * R * 0.995 };
		const pts: THREE.Vector3[] = [];
		for (let k = 0; k <= 10; k++) {
			const s = k / 10;
			const x = THREE.MathUtils.lerp(c.x + Math.cos(a) * SPRING.r, lip.x, s);
			const z = THREE.MathUtils.lerp(c.z + Math.sin(a) * SPRING.r, lip.z, s);
			pts.push(new THREE.Vector3(x, Math.min(level, ground(x, z) + 0.07), z));
		}
		stream(pts, a, 0.5);
		waterfall(pts[pts.length - 1], a, 75, 0.8);
		taken.push({ ...c, r: SPRING.r + 1.5 });
	}

	// ---------- the ruins (Blender models) and what she walks round on them ----------

	const models = new Map<string, THREE.Object3D>();
	const toonCache = new Map<string, THREE.Material>();
	const glowMat = new THREE.MeshBasicMaterial({ color: '#fff1b8' });
	/** Where each model goes, put in place once they're loaded. */
	const placements: { name: string; x: number; y: number; z: number; yaw: number; then?: (o: THREE.Object3D) => void }[] = [];
	const put = (name: string, x: number, y: number, z: number, yaw: number, then?: (o: THREE.Object3D) => void) => placements.push({ name, x, y, z, yaw, then });
	/** A point `side` across and `fwd` along from (x, z), turned `yaw`, as the models are. */
	const turned = (x: number, z: number, yaw: number, side: number, fwd: number) => ({
		x: x + Math.cos(yaw) * side + Math.sin(yaw) * fwd,
		z: z - Math.sin(yaw) * side + Math.cos(yaw) * fwd,
	});

	// The path from where the Windspout brings her (on the near edge) to the temple: stepping stones,
	// a pair of arches over it and lanterns along it.
	const landing = (() => {
		const s = SPOUTS[0];
		const a = Math.atan2(MAIN.z - s.z, MAIN.x - s.x);
		const r = Math.hypot(MAIN.x - s.x, MAIN.z - s.z) - rimAt(MAIN, Math.atan2(s.z - MAIN.z, s.x - MAIN.x));
		return { x: s.x + Math.cos(a) * (r + 5), z: s.z + Math.sin(a) * (r + 5) };
	})();
	{
		const dx = TEMPLE.x - landing.x;
		const dz = TEMPLE.z - landing.z;
		const len = Math.hypot(dx, dz) - TEMPLE.r + 1;
		const yaw = Math.atan2(dx, dz);
		const flat = new THREE.CylinderGeometry(0.55, 0.65, 0.3, 7);
		for (let s = 0; s < len; s += 1.5) {
			const p = turned(landing.x, landing.z, yaw, Math.sin(s * 0.7) * 0.4, s);
			const m = mesh(flat, s % 3 < 1.5 ? stone : darkStone, p.x, ground(p.x, p.z) - 0.08, p.z);
			m.rotation.y = s;
			m.castShadow = false;
			scene.add(m);
		}
		for (const s of [len * 0.3, len * 0.72]) {
			const p = turned(landing.x, landing.z, yaw, 0, s);
			const feet = [-2.2, 2.2].map((k) => turned(p.x, p.z, yaw, k, 0));
			const g = Math.min(ground(p.x, p.z), ...feet.map((q) => ground(q.x, q.z))) - 0.1;
			put('Arch', p.x, g, p.z, yaw);
			for (const q of feet) ctx.addFeature({ x: q.x, z: q.z, r: 0.5, floor: g, top: g + 6 });
			taken.push({ ...p, r: 3.5 });
		}
		for (let s = 3; s < len - 2; s += 7) {
			for (const k of [-2.4, 2.4]) {
				const q = turned(landing.x, landing.z, yaw, k, s + (k > 0 ? 3.5 : 0));
				const g = ground(q.x, q.z) - 0.05;
				put('Lantern', q.x, g, q.z, yaw, (o) => {
					const glow = glowSprite(2.2, 0.8, '#ffd38a');
					glow.position.set(0, 1.38, 0);
					o.add(glow);
					nightGlows.push(glow);
				});
				ctx.addFeature({ x: q.x, z: q.z, r: 0.35, floor: g, top: g + 2 });
				taken.push({ ...q, r: 1.2 });
			}
		}
	}

	// The temple: three steps up onto a round floor, a ring of columns (two fallen), and the altar,
	// with a crystal turning over it. Sizes as in tools/island-sky/build.py.
	{
		const yaw = Math.atan2(landing.x - TEMPLE.x, landing.z - TEMPLE.z);
		const y = TEMPLE_FLOOR - 0.05;
		put('Temple', TEMPLE.x, y, TEMPLE.z, yaw);
		for (const [r, top] of [
			[10.0, 0.4],
			[9.2, 0.8],
			[8.4, 1.2],
		])
			ctx.addFeature({ x: TEMPLE.x, z: TEMPLE.z, r, floor: y, pad: y + top });
		const floor = y + 1.2;
		for (let i = 0; i < 12; i++) {
			const a = (i * TAU) / 12;
			const p = turned(TEMPLE.x, TEMPLE.z, yaw, Math.sin(a) * 7.4, Math.cos(a) * 7.4);
			const fallen = i === 4 || i === 9;
			ctx.addFeature({ x: p.x, z: p.z, r: 0.6, floor, top: floor + (fallen ? 2.6 : 8.6) });
		}
		ctx.addFeature({ x: TEMPLE.x, z: TEMPLE.z, r: 1.5, floor, top: floor + 1.4 });
		const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), new THREE.MeshBasicMaterial({ color: '#9fe3ff' }));
		crystal.scale.y = 1.5;
		const halo = glowSprite(6, 0.65, '#9fe3ff');
		scene.add(crystal, halo);
		ticks.push((time) => {
			crystal.position.set(TEMPLE.x, floor + 3.6 + Math.sin(time * 1.1) * 0.25, TEMPLE.z);
			crystal.rotation.y = time * 0.7;
			halo.position.copy(crystal.position);
			halo.material.opacity = 0.55 + 0.15 * Math.sin(time * 2);
		});
	}

	// The spire on the upper island, with a crystal floating in its broken top, and the chest at its foot.
	const chest = { x: 0, y: 0, z: 0 };
	{
		const c = { x: CROWN.x - OUT.x * 1.5, z: CROWN.z - OUT.z * 1.5 };
		const y = ground(c.x, c.z) - 0.1;
		const yaw = Math.atan2(SPOUTS[1].x - c.x, SPOUTS[1].z - c.z);
		put('Spire', c.x, y, c.z, yaw);
		ctx.addFeature({ x: c.x, z: c.z, r: 3.6, floor: y, pad: y + 0.3 });
		ctx.addFeature({ x: c.x, z: c.z, r: 3.0, floor: y, pad: y + 0.6 });
		ctx.addFeature({ x: c.x, z: c.z, r: 2.6, floor: y, pad: y + 0.9 });
		ctx.addFeature({ x: c.x, z: c.z, r: 2.05, floor: y + 0.9, top: y + 19 });
		taken.push({ ...c, r: 5 });
		const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), new THREE.MeshBasicMaterial({ color: '#9fe3ff' }));
		crystal.scale.y = 1.5;
		const halo = glowSprite(7, 0.7, '#9fe3ff');
		scene.add(crystal, halo);
		ticks.push((time) => {
			crystal.position.set(c.x, y + 20 + Math.sin(time * 0.9) * 0.3, c.z);
			crystal.rotation.y = -time * 0.6;
			halo.position.copy(crystal.position);
		});
		const front = turned(c.x, c.z, yaw, 0, 2.2);
		Object.assign(chest, { x: front.x, z: front.z, y: y + 0.9 });
	}

	// The chest, on the spire's plinth, facing the way she comes up.
	let opened = loadJSON('skyChest') === true;
	{
		const group = new THREE.Group();
		group.position.set(chest.x, chest.y - 0.02, chest.z);
		group.rotation.y = Math.atan2(SPOUTS[1].x - chest.x, SPOUTS[1].z - chest.z);
		const wood = toon({ color: '#7fa8d8' });
		const trim = toon({ color: '#fdfbff' });
		group.add(mesh(new THREE.BoxGeometry(1.1, 0.6, 0.75), wood, 0, 0.3, 0));
		for (const side of [-0.35, 0.35]) group.add(mesh(new THREE.BoxGeometry(0.12, 0.62, 0.77), trim, side, 0.3, 0));
		group.add(new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.1, 0.6), new THREE.MeshBasicMaterial({ color: '#bff0ff' })).translateY(0.56));
		const lid = new THREE.Group();
		lid.position.set(0, 0.6, -0.375);
		lid.add(mesh(new THREE.BoxGeometry(1.1, 0.26, 0.75), wood, 0, 0.13, 0.375));
		for (const side of [-0.35, 0.35]) lid.add(mesh(new THREE.BoxGeometry(0.12, 0.28, 0.77), trim, side, 0.13, 0.375));
		const glow = glowSprite(2.4, 0, '#bff0ff');
		glow.position.y = 0.9;
		group.add(lid, glow);
		scene.add(group);
		ctx.addFeature({ x: chest.x, z: chest.z, r: 0.7, floor: chest.y });
		let open = opened ? 1 : 0;
		ticks.push((time, dt) => {
			open = damp(open, opened ? 1 : 0, 4, dt);
			lid.rotation.x = -open * 1.9;
			glow.material.opacity = opened ? open * 0.3 : 0.25 + 0.2 * Math.sin(time * 3);
		});
	}

	// ---------- crystals, which grow back ----------

	interface Node {
		id: string;
		x: number;
		y: number;
		z: number;
		crystal: THREE.Object3D | null;
		glow: THREE.Sprite;
	}
	const mined: Record<string, number> = {};
	{
		const saved = loadJSON('skyCrystals');
		if (saved && typeof saved === 'object') for (const [k, v] of Object.entries(saved)) if (typeof v === 'number') mined[k] = v;
	}
	const nodes: Node[] = [];
	{
		const spots: [Isle, number, number][] = [
			[MAIN, 2.2, 0.8],
			[MAIN, 3.6, 0.72],
			[MAIN, 5.4, 0.78],
			[CROWN, 4.2, 0.6],
			[LITTLE[0], 1, 0.3],
			[LITTLE[1], 2, 0.3],
			[LITTLE[2], 0.5, 0.2],
		];
		spots.forEach(([isle, a, t], i) => {
			// Turned round to the first free spot near where it's asked for.
			let x = 0;
			let z = 0;
			for (let k = 0; k < 24; k++) {
				const b = a + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.15;
				const r = rimAt(isle, b) * t;
				x = isle.x + Math.cos(b) * r;
				z = isle.z + Math.sin(b) * r;
				if (free(x, z, 1.5)) break;
			}
			const y = ground(x, z) - 0.1;
			const glow = glowSprite(3, 0.5, '#9fe3ff');
			glow.position.set(x, y + 1.4, z);
			scene.add(glow);
			nodes.push({ id: `${isle.id}-${i}`, x, y, z, crystal: null, glow });
			put('CrystalRock', x, y, z, a * 3);
			put('Crystal', x, y, z, a * 3, (o) => (nodes[i].crystal = o));
			ctx.addFeature({ x, z, r: 0.85, floor: y, dome: { base: y, top: 0.55 } });
			taken.push({ x, z, r: 2 });
		});
	}
	/** How far a crystal has grown back, 0 just gathered … 1 ready to gather again. */
	const grown = (n: Node) => (mined[n.id] === undefined ? 1 : clamp((Date.now() - mined[n.id]) / REGROW_MS, 0, 1));
	let growClock = 0;
	ticks.push((time, dt) => {
		growClock -= dt;
		for (const n of nodes) {
			if (growClock <= 0 && n.crystal) n.crystal.scale.setScalar(0.25 + 0.75 * grown(n));
			n.glow.material.opacity = grown(n) >= 1 ? 0.35 + 0.15 * Math.sin(time * 2 + n.x) : 0;
		}
		if (growClock <= 0) growClock = 1;
	});

	// ---------- blossom trees, and petals falling ----------

	{
		const geo = (() => {
			const trunk = new THREE.CylinderGeometry(0.18, 0.3, 2.4, 6);
			trunk.translate(0, 1.2, 0);
			const blob = (r: number, x: number, y: number, z: number, hex: string) => {
				const g = new THREE.IcosahedronGeometry(r, 1);
				g.scale(1, 0.88, 1);
				g.translate(x, y, z);
				return colored(g, hex);
			};
			return mergeGeometries([colored(trunk, '#8a5a3c'), blob(1.55, 0, 3.3, 0, '#ffb3d1'), blob(1.1, 0.7, 4.3, 0.25, '#ffc9de'), blob(1.0, -0.75, 3.85, -0.35, '#f59cc2')])!;
		})();
		const trees: { x: number; y: number; z: number; s: number }[] = [];
		const want: [Isle, number][] = [
			[MAIN, 22],
			[CROWN, 4],
			[LITTLE[0], 1],
			[LITTLE[1], 2],
		];
		const px = TEMPLE.x - landing.x;
		const pz = TEMPLE.z - landing.z;
		const onPath = (x: number, z: number) => {
			const along = ((x - landing.x) * px + (z - landing.z) * pz) / (px * px + pz * pz);
			return along > -0.1 && along < 1.1 && Math.abs((x - landing.x) * pz - (z - landing.z) * px) / Math.hypot(px, pz) < 4;
		};
		for (const [isle, count] of want) {
			let placed = 0;
			for (let tries = 0; tries < 400 && placed < count; tries++) {
				const a = rand() * TAU;
				const t = Math.sqrt(rand()) * 0.82;
				const r = rimAt(isle, a) * t;
				const x = isle.x + Math.cos(a) * r;
				const z = isle.z + Math.sin(a) * r;
				if (!free(x, z, 1.5) || trees.some((o) => Math.hypot(o.x - x, o.z - z) < 4.5) || (isle === MAIN && onPath(x, z))) continue;
				trees.push({ x, y: ground(x, z) - 0.1, z, s: 0.85 + rand() * 0.55 });
				placed++;
			}
		}
		const blossom = new THREE.InstancedMesh(geo, toon({ vertexColors: true }), trees.length);
		const m4 = new THREE.Matrix4();
		const q = new THREE.Quaternion();
		const up = new THREE.Vector3(0, 1, 0);
		trees.forEach((t, i) => {
			blossom.setMatrixAt(i, m4.compose(new THREE.Vector3(t.x, t.y, t.z), q.setFromAxisAngle(up, i * 2.1), new THREE.Vector3(t.s, t.s, t.s)));
			ctx.addFeature({ x: t.x, z: t.z, r: 0.4 * t.s, floor: t.y, top: t.y + 3.6 * t.s, crown: { x: t.x, y: t.y + 3.6 * t.s, z: t.z, r: 1.7 * t.s } });
		});
		blossom.castShadow = blossom.receiveShadow = true;
		scene.add(blossom);

		const PETALS = 140;
		const petals = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.16, 0.12), new THREE.MeshBasicMaterial({ color: '#ffc0d8', side: THREE.DoubleSide }), PETALS);
		const seeds = Array.from({ length: PETALS }, (_, i) => ({ tree: trees[i % trees.length], a: (i * 2.399) % TAU, r: 0.8 + ((i * 7.31) % 1) * 3, phase: (i * 0.618) % 1, spin: 1 + (i % 5) }));
		const e = new THREE.Euler();
		const v = new THREE.Vector3();
		const one = new THREE.Vector3(1, 1, 1);
		scene.add(petals);
		ticks.push((time) => {
			seeds.forEach((p, i) => {
				const life = (time * 0.09 + p.phase) % 1;
				const h = 4.2 * p.tree.s;
				v.set(p.tree.x + Math.cos(p.a + life * 2) * p.r + Math.sin(time + i) * 0.3, p.tree.y + h - life * h, p.tree.z + Math.sin(p.a + life * 2) * p.r);
				q.setFromEuler(e.set(time * p.spin, time * 0.7 * p.spin, i));
				petals.setMatrixAt(i, m4.compose(v, q, one));
			});
			petals.instanceMatrix.needsUpdate = true;
		});
	}

	// ---------- the Windspouts ----------

	for (const { x, z, r, base, top } of SPOUTS) {
		const h = top - base + 2;
		const group = new THREE.Group();
		group.position.set(x, base - 1, z);
		scene.add(group);
		// Two open tubes of streaks winding upwards, the inner one quicker.
		const mats = [
			streakMaterial('#ffffff', 0.4, { additive: true, flow: 0.9, stretch: h / 9, across: 36, twist: 2, fadeIn: 0.15, fadeOut: 0.3, body: 0.04 }),
			streakMaterial('#e6f6ff', 0.35, { additive: true, flow: 1.5, stretch: h / 6, across: 24, twist: -3, fadeIn: 0.15, fadeOut: 0.3, body: 0.03 }),
		];
		[r * 0.95, r * 0.55].forEach((radius, i) => {
			const tube = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.85, h, 28, 1, true).translate(0, h / 2, 0), mats[i]);
			tube.renderOrder = 2;
			group.add(tube);
		});
		// Leaves whirling up through it.
		const LEAVES = 36;
		const leaves = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.22, 0.14), new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide }), LEAVES);
		const tints = ['#9ad67f', '#ffd84d', '#78bf68', '#ffb3d1'];
		const c = new THREE.Color();
		for (let i = 0; i < LEAVES; i++) leaves.setColorAt(i, c.set(tints[i % tints.length]));
		group.add(leaves);
		const m4 = new THREE.Matrix4();
		const q = new THREE.Quaternion();
		const e = new THREE.Euler();
		const v = new THREE.Vector3();
		const size = new THREE.Vector3();
		ticks.push((time) => {
			for (const mat of mats) mat.uniforms.uTime.value = time;
			for (let i = 0; i < LEAVES; i++) {
				const life = (time * (5 / h) + i / LEAVES) % 1;
				const a = i * 2.4 + time * (1.4 + (i % 3) * 0.3);
				const rr = r * (0.3 + 0.5 * ((i * 0.37) % 1));
				v.set(Math.cos(a) * rr, 1 + life * h * 0.95, Math.sin(a) * rr);
				q.setFromEuler(e.set(time * 3 + i, time * 2 + i * 0.5, i));
				const s = clamp(Math.min(life * 8, (1 - life) * 8), 0, 1);
				leaves.setMatrixAt(i, m4.compose(v, q, size.set(s, s, s)));
			}
			leaves.instanceMatrix.needsUpdate = true;
		});
	}

	// ---------- the models, once loaded ----------

	let night = false;
	new GLTFLoader().loadAsync(ctx.modelUrl).then(
		(gltf) => {
			for (const child of [...gltf.scene.children]) models.set(child.name, child);
			for (const p of placements) {
				const source = models.get(p.name);
				if (!source) continue;
				const copy = source.clone(true);
				copy.traverse((o) => {
					if (!(o instanceof THREE.Mesh)) return;
					const placeholder = o.material as THREE.MeshStandardMaterial;
					if (placeholder.name === 'Glow') o.material = glowMat;
					else {
						const color = `#${placeholder.color.getHexString()}`;
						let mat = toonCache.get(color);
						if (!mat) toonCache.set(color, (mat = toon({ color })));
						o.material = mat;
					}
					o.castShadow = o.receiveShadow = true;
				});
				copy.position.set(p.x, p.y, p.z);
				copy.rotation.y = p.yaw;
				scene.add(copy);
				p.then?.(copy);
			}
			for (const g of nightGlows) g.visible = night;
		},
		() => {
			// No models: the islands are still there to walk on, just bare.
		},
	);

	ctx.theme.on((p) => {
		night = p.night;
		for (const g of nightGlows) g.visible = p.night;
		glowMat.color.set(p.night ? '#ffe39a' : '#f4ecd6');
	});

	// ---------- the sky shards ----------

	ctx.inventory.register({
		id: SHARD,
		name: 'Sky Shard',
		kind: 'material',
		description: 'A sliver of sky-blue crystal from Cloudrest, cool to the touch and humming faintly. The crystals there grow them back in time. Someone handy with a forge could make something of them.',
		color: '#9fe3ff',
	});

	/** Whether she's up on one of the islands (where it's the lake she'd fish in, not the sea far below). */
	const aboard = () => skyGround(ctx.pos.x, ctx.pos.z, ctx.pos.y) > -Infinity;
	return {
		/** E by a ripe crystal, or by the chest at the spire. */
		offer: (): Offer | null => {
			if (!aboard()) return null;
			for (const n of nodes) {
				if (Math.hypot(ctx.pos.x - n.x, ctx.pos.z - n.z) > 2 || Math.abs(ctx.pos.y - n.y) > 2.5) continue;
				if (grown(n) < 1) {
					const left = Math.ceil(((1 - grown(n)) * REGROW_MS) / 60000);
					return { label: `Still growing back (about ${left} min)` };
				}
				if (!ctx.inventory.fits(SHARD)) return { label: 'Your bag is too full' };
				return {
					label: 'Gather a sky shard',
					go: () => {
						const count = Math.random() < 0.3 ? 2 : 1;
						if (!ctx.inventory.add(SHARD, count)) return;
						mined[n.id] = Date.now();
						saveJSON('skyCrystals', mined);
						growClock = 0;
						// Now and then a starbloom seed is caught among the crystal, too.
						if (Math.random() < STARBLOOM_CHANCE && ctx.inventory.add(STARBLOOM_SEED)) {
							ctx.toast(`${count > 1 ? 'Two sky shards' : 'A sky shard'}, and tucked in the crystal, a starbloom seed!`);
							return;
						}
						ctx.toast(count > 1 ? 'Two sky shards came away in her hands!' : 'A sky shard came away in her hands.');
					},
				};
			}
			if (opened || Math.hypot(ctx.pos.x - chest.x, ctx.pos.z - chest.z) > 2.2) return null;
			if (!ctx.inventory.fits(SHARD)) return { label: 'Your bag is too full to open the chest' };
			return {
				label: 'Open the chest',
				go: () => {
					if (!ctx.inventory.add(SHARD, SHARDS_IN_CHEST)) return;
					opened = true;
					saveJSON('skyChest', true);
					ctx.toast(`Inside: ${SHARDS_IN_CHEST} Sky Shards, glowing faintly blue.`);
				},
			};
		},
		get aboard() {
			return aboard();
		},
		update(time: number, dt: number) {
			for (const tick of ticks) tick(time, dt);
		},
	};
}
