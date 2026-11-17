// Nixchan's island: a little toon island in the sea for the 3D Nixchan to roam freely. There's no
// goal and no clock: just places to come across (a lighthouse, a campfire, standing stones, a flag on
// the summit, an islet out at sea), a map that fills in as she explores, and a glider for jumping off
// high ground. The island is a heightfield, so walking, wading, swimming, climbing and gliding are all
// one question — how high is the ground here? — and need no physics engine.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildNixFigure, type NixClip } from '../experimental/nix-figure';
import { createFishing, SPECIES } from './fishing';
import { createInventory } from './inventory';
import { createFarm } from './farm';
import { createNpc } from './npc';

const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const smoothstep = (e0: number, e1: number, x: number) => {
	const t = clamp((x - e0) / (e1 - e0), 0, 1);
	return t * t * (3 - 2 * t);
};
const damp = (from: number, to: number, rate: number, dt: number) => THREE.MathUtils.lerp(from, to, 1 - Math.exp(-rate * dt));

// ---------- noise ----------

function rng(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function lattice(ix: number, iy: number) {
	let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in -1 … 1. */
function noise(x: number, y: number) {
	const ix = Math.floor(x);
	const iy = Math.floor(y);
	const fx = x - ix;
	const fy = y - iy;
	const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
	const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
	const a = lattice(ix, iy);
	const b = lattice(ix + 1, iy);
	const c = lattice(ix, iy + 1);
	const d = lattice(ix + 1, iy + 1);
	return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

function fbm(x: number, y: number, octaves: number) {
	let sum = 0;
	let amp = 0.5;
	let freq = 1;
	for (let i = 0; i < octaves; i++) {
		sum += amp * noise(x * freq, y * freq);
		freq *= 2.03;
		amp *= 0.5;
	}
	return sum;
}

// ---------- the island's shape ----------

const R = 80; // the island's radius, give or take its ragged coast
const SIZE = 280; // the terrain mesh covers SIZE × SIZE, centred on the origin
const N = 224;
const STEP = SIZE / N;
const HALF = SIZE / 2;
const PEAK = { x: -18, z: -14 };
const SEA_FLOOR = -6;
/** She starts swimming where the sea floor drops below this, and finds her feet again above SWIM_OUT. */
const SWIM_IN = -1.35;
const SWIM_OUT = -1.2;
/** A little islet out at sea, a swim (or a glide) away from the main island. */
const ISLET = { x: Math.cos(-1.25) * 114, z: Math.sin(-1.25) * 114, r: 19 };
/** How far she can roam before the open sea turns her back. */
const WORLD_EDGE = 138;

function mainHeight(x: number, z: number) {
	// How far out from the middle, with the coast pushed in and out so it isn't a circle.
	const d = Math.hypot(x, z) / R + fbm(x * 0.018 + 31, z * 0.018 - 7, 3) * 0.3;
	// A flat top that falls away through the beach to the sea floor.
	const base = 1.3 - 7.3 * smoothstep(0.52, 1.0, d);
	const inland = smoothstep(0.62, 0.36, d);
	const hills = (fbm(x * 0.03 + 5, z * 0.03 + 9, 4) * 0.5 + 0.5) * 6 * inland;
	const pd = Math.hypot(x - PEAK.x, z - PEAK.z);
	const peak = 15 * Math.exp(-(pd * pd) / 300) * smoothstep(0.75, 0.4, d);
	return base + hills + peak;
}

function isletHeight(x: number, z: number) {
	const d = Math.hypot(x - ISLET.x, z - ISLET.z) / ISLET.r + fbm(x * 0.05 - 3, z * 0.05 + 11, 2) * 0.18;
	return 1.4 - 7.4 * smoothstep(0.45, 1.0, d) + 1.6 * smoothstep(0.5, 0.0, d);
}

function islandHeight(x: number, z: number) {
	return Math.max(mainHeight(x, z), isletHeight(x, z));
}

const heights = new Float32Array((N + 1) * (N + 1));
for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) heights[j * (N + 1) + i] = islandHeight(-HALF + i * STEP, -HALF + j * STEP);
const H = (i: number, j: number) => heights[j * (N + 1) + i];

/** The terrain's height at (x, z), read off the same triangles the mesh is drawn with. */
function terrainAt(x: number, z: number) {
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

function slopeUp(x: number, z: number) {
	const dx = terrainAt(x + 0.5, z) - terrainAt(x - 0.5, z);
	const dz = terrainAt(x, z + 0.5) - terrainAt(x, z - 0.5);
	return 1 / Math.sqrt(1 + dx * dx + dz * dz);
}

// ---------- the pier ----------

const PIER_ANGLE = 0.55;
const PIER_DIR = { x: Math.cos(PIER_ANGLE), z: Math.sin(PIER_ANGLE) };
const COAST = (() => {
	for (let r = 20; r < 110; r += 0.25) if (islandHeight(PIER_DIR.x * r, PIER_DIR.z * r) < 0.3) return r;
	return 60;
})();
const PIER = { from: COAST - 4, to: COAST + 16, half: 1.25, deck: 1.25 };

function deckAt(x: number, z: number) {
	const along = x * PIER_DIR.x + z * PIER_DIR.z;
	const across = -x * PIER_DIR.z + z * PIER_DIR.x;
	return along >= PIER.from && along <= PIER.to && Math.abs(across) <= PIER.half ? PIER.deck : -Infinity;
}

// ---------- things standing on the island ----------

/** A trunk she walks round, a rock she can climb onto (a dome in the heightfield), or a flat-topped
 * plinth she can step or jump up onto (a pad). */
interface Feature {
	x: number;
	z: number;
	r: number;
	dome?: { base: number; top: number };
	pad?: number;
}
const CELL = 4;
const cells = new Map<number, Feature[]>();
const cellKey = (cx: number, cz: number) => (cx + 1000) * 4096 + (cz + 1000);
function addFeature(f: Feature) {
	const reach = f.r + 1;
	for (let cx = Math.floor((f.x - reach) / CELL); cx <= Math.floor((f.x + reach) / CELL); cx++)
		for (let cz = Math.floor((f.z - reach) / CELL); cz <= Math.floor((f.z + reach) / CELL); cz++) {
			const k = cellKey(cx, cz);
			const list = cells.get(k);
			if (list) list.push(f);
			else cells.set(k, [f]);
		}
}
const nearby = (x: number, z: number) => cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL))) ?? [];
/** Whether nothing stands within `gap` of (x, z). */
function roomy(x: number, z: number, gap: number) {
	for (let cx = -1; cx <= 1; cx++)
		for (let cz = -1; cz <= 1; cz++)
			for (const f of cells.get(cellKey(Math.floor(x / CELL) + cx, Math.floor(z / CELL) + cz)) ?? [])
				if (Math.hypot(x - f.x, z - f.z) < f.r + gap) return false;
	return true;
}

/** The height of whatever she'd stand on at (x, z): the ground, the pier, or the top of a rock. */
function groundAt(x: number, z: number) {
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

// ---------- materials and little geometries ----------

function toonRamp(steps = [150, 215, 255]) {
	const ramp = new THREE.DataTexture(new Uint8Array(steps), steps.length, 1, THREE.RedFormat);
	ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
	ramp.needsUpdate = true;
	return ramp;
}

/** Bake one flat colour into a geometry, faceted, so pieces can be merged into one mesh. */
function colored(geo: THREE.BufferGeometry, hex: string) {
	const g = geo.index ? geo.toNonIndexed() : geo;
	const c = new THREE.Color(hex);
	const n = g.attributes.position.count;
	const arr = new Float32Array(n * 3);
	for (let i = 0; i < n; i++) c.toArray(arr, i * 3);
	g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
	g.deleteAttribute('uv');
	g.computeVertexNormals();
	return g;
}

function palmGeometry() {
	const trunk = new THREE.CylinderGeometry(0.16, 0.27, 5, 7, 6);
	trunk.translate(0, 2.5, 0);
	const p = trunk.attributes.position;
	for (let i = 0; i < p.count; i++) {
		const t = p.getY(i) / 5;
		p.setX(i, p.getX(i) + t * t * 1.1);
	}
	const parts = [colored(trunk, '#a7774e')];
	const top = new THREE.Vector3(1.1, 5, 0);
	for (let i = 0; i < 7; i++) {
		const frond = new THREE.BoxGeometry(0.75, 0.05, 2.7, 1, 1, 6);
		frond.translate(0, 0, 1.35);
		const fp = frond.attributes.position;
		for (let k = 0; k < fp.count; k++) {
			const t = fp.getZ(k) / 2.7;
			fp.setY(k, fp.getY(k) - t * t * 1.15);
			fp.setX(k, fp.getX(k) * (1 - t * 0.75));
		}
		frond.rotateX(-0.38);
		frond.rotateY((i * TAU) / 7 + 0.3);
		frond.translate(top.x, top.y, top.z);
		parts.push(colored(frond, i % 2 ? '#58b05a' : '#4a9e50'));
	}
	for (let i = 0; i < 3; i++) {
		const nut = new THREE.IcosahedronGeometry(0.17, 0);
		nut.translate(top.x + Math.cos(i * 2.1) * 0.22, top.y - 0.25, Math.sin(i * 2.1) * 0.22);
		parts.push(colored(nut, '#7a5236'));
	}
	return mergeGeometries(parts)!;
}

function roundTreeGeometry() {
	const trunk = new THREE.CylinderGeometry(0.18, 0.3, 2.4, 6);
	trunk.translate(0, 1.2, 0);
	const blob = (r: number, x: number, y: number, z: number, hex: string) => {
		const g = new THREE.IcosahedronGeometry(r, 1);
		g.scale(1, 0.88, 1);
		g.translate(x, y, z);
		return colored(g, hex);
	};
	return mergeGeometries([
		colored(trunk, '#8a5a3c'),
		blob(1.55, 0, 3.3, 0, '#6cc26a'),
		blob(1.1, 0.7, 4.3, 0.25, '#7fd07a'),
		blob(1.0, -0.75, 3.85, -0.35, '#5db35f'),
	])!;
}

function pineGeometry(snowy: boolean) {
	const trunk = new THREE.CylinderGeometry(0.14, 0.22, 1.4, 6);
	trunk.translate(0, 0.7, 0);
	const parts = [colored(trunk, '#7a5236')];
	[
		[1.5, 2.2, 1.9],
		[1.15, 1.9, 3.1],
		[0.75, 1.6, 4.2],
	].forEach(([r, h, y], i) => {
		const cone = new THREE.ConeGeometry(r, h, 7);
		cone.translate(0, y, 0);
		parts.push(colored(cone, snowy && i === 2 ? '#f6f5ff' : i % 2 ? '#3f8f62' : '#357f57'));
	});
	return mergeGeometries(parts)!;
}

function rockGeometry() {
	const g = new THREE.IcosahedronGeometry(1, 1);
	const p = g.attributes.position;
	const v = new THREE.Vector3();
	for (let i = 0; i < p.count; i++) {
		v.fromBufferAttribute(p, i);
		// Lumpy, but by position so the faces stay joined.
		v.multiplyScalar(0.9 + 0.12 * noise(v.x * 2.1 + 7, v.z * 2.1 + v.y * 3.3));
		p.setXYZ(i, v.x, v.y, v.z);
	}
	return colored(g, '#ffffff');
}

function canvasTexture(size: number, paint: (ctx: CanvasRenderingContext2D) => void) {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	paint(canvas.getContext('2d')!);
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}

const glowTexture = () =>
	canvasTexture(128, (ctx) => {
		const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
		g.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
		g.addColorStop(0.35, 'rgba(220, 235, 255, 0.45)');
		g.addColorStop(1, 'rgba(200, 220, 255, 0)');
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, 128, 128);
	});

// ---------- day and night ----------

interface Palette {
	top: string;
	horizon: string;
	sunColor: string;
	sun: number;
	ambient: number;
	hemiSky: string;
	hemiGround: string;
	hemi: number;
	shallow: string;
	deep: string;
	foam: string;
	cloud: string;
	night: boolean;
}
const DAY: Palette = {
	top: '#6fa6ee',
	horizon: '#d9e3fd',
	sunColor: '#fff3dc',
	sun: 1.8,
	ambient: 1.05,
	hemiSky: '#e3ebff',
	hemiGround: '#b6cf96',
	hemi: 0.55,
	shallow: '#86e3d6',
	deep: '#3a86d0',
	foam: '#ffffff',
	cloud: '#ffffff',
	night: false,
};
const NIGHT: Palette = {
	top: '#0b0d2c',
	horizon: '#2e2c66',
	sunColor: '#c3ccff',
	sun: 0.7,
	ambient: 0.5,
	hemiSky: '#7d84d8',
	hemiGround: '#2c2a52',
	hemi: 0.45,
	shallow: '#3f86a6',
	deep: '#15264f',
	foam: '#c9d3ff',
	cloud: '#6e70a8',
	night: true,
};

// ---------- the game ----------

export async function startIsland() {
	const canvas = document.querySelector<HTMLCanvasElement>('[data-stage]');
	if (!canvas) return;
	const ui = {
		loading: document.querySelector<HTMLElement>('[data-loading]'),
		banner: document.querySelector<HTMLElement>('[data-banner]'),
		bannerName: document.querySelector<HTMLElement>('[data-banner-name]'),
		bannerNote: document.querySelector<HTMLElement>('[data-banner-note]'),
		map: document.querySelector<HTMLCanvasElement>('[data-map]'),
		atlas: document.querySelector<HTMLElement>('[data-atlas]'),
		atlasMap: document.querySelector<HTMLCanvasElement>('[data-atlas-map]'),
		atlasCount: document.querySelector<HTMLElement>('[data-atlas-count]'),
		atlasClose: document.querySelector<HTMLButtonElement>('[data-atlas-close]'),
		bag: document.querySelector<HTMLElement>('[data-bag]'),
		bagDetail: document.querySelector<HTMLElement>('[data-bag-detail]'),
		bagSummary: document.querySelector<HTMLElement>('[data-bag-summary]'),
		stick: document.querySelector<HTMLElement>('[data-stick]'),
		knob: document.querySelector<HTMLElement>('[data-knob]'),
		jump: document.querySelector<HTMLButtonElement>('[data-jump]'),
	};

	let renderer: THREE.WebGLRenderer;
	try {
		renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	} catch {
		document.documentElement.classList.add('no-3d');
		return;
	}
	renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;

	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
	const fog = new THREE.Fog('#ffffff', 80, 520);
	scene.fog = fog;
	const ramp = toonRamp();
	const toon = (params: THREE.MeshToonMaterialParameters = {}) => new THREE.MeshToonMaterial({ gradientMap: ramp, ...params });

	// Light
	const ambient = new THREE.AmbientLight('#ffffff', 1);
	const hemi = new THREE.HemisphereLight('#ffffff', '#ffffff', 0.5);
	const sun = new THREE.DirectionalLight('#ffffff', 1.8);
	const SUN_DIR = new THREE.Vector3(0.55, 0.72, 0.42).normalize();
	sun.castShadow = true;
	sun.shadow.mapSize.set(2048, 2048);
	Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 160 });
	sun.shadow.bias = -0.0006;
	sun.shadow.normalBias = 0.03;
	const lantern = new THREE.PointLight('#ffd38a', 0, 12, 1.4);
	scene.add(ambient, hemi, sun, sun.target, lantern);

	// Sky: a gradient dome with the sun (or the moon) in it, and stars that come out at night.
	const skyMat = new THREE.ShaderMaterial({
		side: THREE.BackSide,
		depthWrite: false,
		fog: false,
		uniforms: {
			uTop: { value: new THREE.Color() },
			uHorizon: { value: new THREE.Color() },
			uSunCol: { value: new THREE.Color() },
			uSunDir: { value: SUN_DIR },
		},
		vertexShader: `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
		fragmentShader: `
			uniform vec3 uTop, uHorizon, uSunCol, uSunDir; varying vec3 vDir;
			void main() {
				vec3 d = normalize(vDir);
				vec3 col = mix(uHorizon, uTop, smoothstep(-0.02, 0.55, d.y));
				float s = dot(d, uSunDir);
				col = mix(col, uSunCol, smoothstep(0.9975, 0.998, s));
				col += uSunCol * 0.22 * pow(max(s, 0.0), 48.0);
				gl_FragColor = vec4(col, 1.0);
				#include <colorspace_fragment>
			}`,
	});
	const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), skyMat);
	sky.renderOrder = -2;
	scene.add(sky);
	const stars = (() => {
		const rand = rng(99);
		const pos = new Float32Array(900 * 3);
		for (let i = 0; i < 900; i++) {
			const a = rand() * TAU;
			const y = 0.08 + rand() * 0.92;
			const r = Math.sqrt(1 - y * y);
			pos.set([Math.cos(a) * r * 850, y * 850, Math.sin(a) * r * 850], i * 3);
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
		return new THREE.Points(geo, new THREE.PointsMaterial({ color: '#fdfbff', size: 2, sizeAttenuation: false, fog: false, depthWrite: false }));
	})();
	scene.add(stars);

	// Terrain: one faceted mesh, each triangle coloured by how high and how steep it is.
	{
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
				h < 0.25
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
		const terrain = new THREE.Mesh(geo, toon({ vertexColors: true }));
		terrain.receiveShadow = true;
		terrain.castShadow = true;
		scene.add(terrain);
	}

	// Water: one big plane whose colour comes from how deep the sea floor is beneath it, so the
	// shallows glow turquoise and foam laps at the shore without any depth buffer tricks.
	const waterMat = (() => {
		const data = new Uint8Array((N + 1) * (N + 1));
		for (let k = 0; k < data.length; k++) data[k] = Math.round(clamp((heights[k] + 8) / 10, 0, 1) * 255);
		const depthTex = new THREE.DataTexture(data, N + 1, N + 1, THREE.RedFormat);
		depthTex.magFilter = depthTex.minFilter = THREE.LinearFilter;
		depthTex.needsUpdate = true;
		return new THREE.ShaderMaterial({
			transparent: true,
			uniforms: {
				uTime: { value: 0 },
				uHeight: { value: depthTex },
				// The texel centres sit on the grid's vertices.
				uBounds: { value: new THREE.Vector3(-HALF - STEP / 2, -HALF - STEP / 2, SIZE + STEP) },
				uShallow: { value: new THREE.Color() },
				uDeep: { value: new THREE.Color() },
				uFoam: { value: new THREE.Color() },
				uFogColor: { value: fog.color },
				uFogNear: { value: fog.near },
				uFogFar: { value: fog.far },
			},
			vertexShader: `varying vec3 vWorld; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
			fragmentShader: `
				uniform float uTime, uFogNear, uFogFar; uniform sampler2D uHeight; uniform vec3 uBounds, uShallow, uDeep, uFoam, uFogColor;
				varying vec3 vWorld;
				void main() {
					vec2 uv = (vWorld.xz - uBounds.xy) / uBounds.z;
					float h = -6.0;
					if (uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0) h = texture2D(uHeight, uv).r * 10.0 - 8.0;
					float depth = max(-h, 0.0);
					float dist = distance(cameraPosition, vWorld);
					float w = sin(vWorld.x * 0.35 + uTime * 1.1) * sin(vWorld.z * 0.3 - uTime * 0.9) + 0.5 * sin((vWorld.x + vWorld.z) * 0.6 + uTime * 1.7);
					vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 4.5, depth));
					col += step(1.1, w) * 0.07 * (1.0 - smoothstep(30.0, 140.0, dist));
					// A band of foam right at the water's edge, and rings of it rolling in over the shallows.
					float foam = 1.0 - smoothstep(0.03, 0.09, depth + 0.035 * sin(uTime * 1.6 + vWorld.x * 0.2 + vWorld.z * 0.15));
					float ring = step(0.9, fract(depth * 2.2 - uTime * 0.35)) * (1.0 - smoothstep(0.2, 0.9, depth));
					foam = max(foam, ring * 0.7);
					col = mix(col, uFoam, foam);
					// The deep sea is opaque, so nothing shows past the edge of the sea floor.
					float alpha = max(mix(0.5, 1.0, smoothstep(0.0, 5.0, depth)), foam);
					col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, dist));
					alpha = mix(alpha, 1.0, smoothstep(uFogNear, uFogFar, dist));
					gl_FragColor = vec4(col, alpha);
					#include <colorspace_fragment>
				}`,
		});
	})();
	{
		const geo = new THREE.PlaneGeometry(4000, 4000);
		geo.rotateX(-Math.PI / 2);
		scene.add(new THREE.Mesh(geo, waterMat));
	}

	// The pier, with a lamp at the far end.
	const pierLamp = new THREE.PointLight('#ffd38a', 0, 18, 1.5);
	const bulbMat = new THREE.MeshBasicMaterial({ color: '#fff6d8' });
	{
		const wood = toon({ color: '#b07a4f' });
		const darkWood = toon({ color: '#8d5d3b' });
		const group = new THREE.Group();
		group.rotation.y = -PIER_ANGLE;
		const planks: THREE.Vector3[] = [];
		for (let s = PIER.from; s <= PIER.to; s += 0.56) planks.push(new THREE.Vector3(s, PIER.deck - 0.08, 0));
		const plankMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.16, PIER.half * 2), wood, planks.length);
		const m = new THREE.Matrix4();
		const tint = new THREE.Color();
		planks.forEach((p, i) => {
			plankMesh.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z));
			plankMesh.setColorAt(i, tint.set(i % 3 === 0 ? '#e8d6c8' : '#ffffff'));
		});
		plankMesh.castShadow = plankMesh.receiveShadow = true;
		group.add(plankMesh);
		const posts: THREE.Vector3[] = [];
		for (let s = PIER.from + 0.4; s <= PIER.to; s += 3.2) for (const side of [-1, 1]) posts.push(new THREE.Vector3(s, PIER.deck - 3, side * (PIER.half - 0.15)));
		const postMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.13, 6.2, 7), darkWood, posts.length);
		posts.forEach((p, i) => postMesh.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
		postMesh.castShadow = true;
		group.add(postMesh);
		const lampPost = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.6, 7), toon({ color: '#2c2a52' }));
		lampPost.position.set(PIER.to - 0.4, PIER.deck + 1.3, PIER.half - 0.3);
		const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10), bulbMat);
		bulb.position.set(PIER.to - 0.4, PIER.deck + 2.7, PIER.half - 0.3);
		pierLamp.position.copy(bulb.position);
		group.add(lampPost, bulb, pierLamp);
		scene.add(group);
		// She walks round the lamp post rather than through it.
		const lampWorld = new THREE.Vector3(PIER.to - 0.4, 0, PIER.half - 0.3).applyAxisAngle(new THREE.Vector3(0, 1, 0), -PIER_ANGLE);
		addFeature({ x: lampWorld.x, z: lampWorld.z, r: 0.2 });
	}

	// Where she starts: on the beach by the pier.
	const startAlong = COAST - 8;
	const START = new THREE.Vector3(PIER_DIR.x * startAlong - PIER_DIR.z * 3, 0, PIER_DIR.z * startAlong + PIER_DIR.x * 3);
	START.y = groundAt(START.x, START.z);
	const nearPier = (x: number, z: number, gap: number) => {
		const along = x * PIER_DIR.x + z * PIER_DIR.z;
		const across = -x * PIER_DIR.z + z * PIER_DIR.x;
		return along > PIER.from - gap && along < PIER.to + gap && Math.abs(across) < PIER.half + gap;
	};

	const BUOY = (() => {
		const a = PIER_ANGLE + 2.5;
		const dir = { x: Math.cos(a), z: Math.sin(a) };
		let r = 30;
		while (r < 64 && islandHeight(dir.x * r, dir.z * r) > -1.6) r += 0.5;
		r = Math.min(r + 6, 70);
		return new THREE.Vector3(dir.x * r, 0, dir.z * r);
	})();

	// ---------- the places to come across ----------

	interface Place {
		id: string;
		name: string;
		x: number;
		z: number;
		/** How close she comes before it counts as being there. */
		r: number;
		/** How far round it to keep clear of trees and rocks. */
		clear: number;
	}
	const places: Place[] = [];
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
			const r = Math.sqrt(prand()) * 58;
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
		let edge = 40;
		for (let r = 20; r < 100; r += 0.5) if (mainHeight(dir.x * r, dir.z * r) > 2.2) edge = r;
		return { x: dir.x * (edge - 2), z: dir.z * (edge - 2) };
	})();
	places.push({ id: 'lighthouse', name: 'Lighthouse Point', ...LIGHT, r: 9, clear: 4.5 });
	const CAMP = findSpot(
		(x, z, g) => g > 2.4 && g < 6.5 && slopeUp(x, z) > 0.95 && flatAround(x, z, 4, 0.8) && farFromStart(x, z, 22) && farFromPlaces(x, z, 24),
		{ x: -30, z: 25 },
	);
	places.push({ id: 'camp', name: 'Campfire Clearing', ...CAMP, r: 7, clear: 5.5 });
	const STONES = findSpot(
		(x, z, g) => g > 4 && g < 12 && slopeUp(x, z) > 0.9 && flatAround(x, z, 5.2, 1.4) && farFromStart(x, z, 22) && farFromPlaces(x, z, 22),
		{ x: 10, z: -35 },
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
	const clearOfPlaces = (x: number, z: number, gap: number) => places.every((p) => Math.hypot(p.x - x, p.z - z) > p.clear + gap);

	// Scatter rocks first, since she can climb them; then the trees round them.
	const rand = rng(12);
	const randomLand = (radius: number) => {
		const a = rand() * TAU;
		const r = Math.sqrt(rand()) * radius;
		return { x: Math.cos(a) * r, z: Math.sin(a) * r };
	};
	const clearOfStart = (x: number, z: number, gap: number) => Math.hypot(x - START.x, z - START.z) > gap;

	const rocks: { x: number; z: number; r: number; top: number; base: number; rot: number }[] = [];
	const bigRocks: typeof rocks = [];
	for (let tries = 0; tries < 2000 && rocks.length < 46; tries++) {
		const { x, z } = randomLand(62);
		const t = terrainAt(x, z);
		if (t < -0.4 || nearPier(x, z, 2) || !clearOfStart(x, z, 6) || !clearOfPlaces(x, z, 3)) continue;
		// A handful are big flat-topped ones, each just low enough to jump up onto.
		const big = bigRocks.length < 6 && t > 1.5 && slopeUp(x, z) > 0.9;
		const r = big ? 1.8 + rand() * 0.6 : 0.5 + rand() * 1.1;
		if (!roomy(x, z, r + 1.5)) continue;
		const top = big ? 1.15 + rand() * 0.15 : r * (0.55 + rand() * 0.25);
		const rock = { x, z, r, top, base: t - 0.12, rot: rand() * TAU };
		rocks.push(rock);
		if (big) bigRocks.push(rock);
		addFeature({ x, z, r, dome: { base: rock.base, top } });
	}

	const palms: THREE.Matrix4[] = [];
	const trees: THREE.Matrix4[] = [];
	const pines: THREE.Matrix4[] = [];
	const snowyPines: THREE.Matrix4[] = [];
	const bushes: THREE.Matrix4[] = [];
	const flowers: { m: THREE.Matrix4; c: string }[] = [];
	{
		const q = new THREE.Quaternion();
		const up = new THREE.Vector3(0, 1, 0);
		const place = (x: number, y: number, z: number, s: number, sy = s) =>
			new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, rand() * TAU), new THREE.Vector3(s, sy, s));
		for (let tries = 0; tries < 9000; tries++) {
			const { x, z } = randomLand(64);
			const g = terrainAt(x, z);
			if (g < 0.4 || nearPier(x, z, 2.5) || !clearOfStart(x, z, 4.5) || !clearOfPlaces(x, z, 1)) continue;
			const up = slopeUp(x, z);
			const forest = fbm(x * 0.05 + 40, z * 0.05, 2);
			if (g < 2.4 && palms.length < 48 && rand() < 0.35) {
				if (!roomy(x, z, 2.2)) continue;
				const s = 0.85 + rand() * 0.35;
				palms.push(place(x, g - 0.1, z, s));
				addFeature({ x, z, r: 0.35 * s });
			} else if (g >= 2.4 && g < 8.5 && up > 0.78 && forest > -0.05 && trees.length < 120) {
				if (!roomy(x, z, 2.4)) continue;
				const s = 0.8 + rand() * 0.5;
				trees.push(place(x, g - 0.1, z, s));
				addFeature({ x, z, r: 0.4 * s });
			} else if (g >= 8.5 && g < 15.5 && up > 0.72 && pines.length + snowyPines.length < 70) {
				if (!roomy(x, z, 1.8)) continue;
				const s = 0.8 + rand() * 0.45;
				(g > 12.5 ? snowyPines : pines).push(place(x, g - 0.1, z, s));
				addFeature({ x, z, r: 0.3 * s });
			}
		}
		for (let tries = 0; tries < 4000 && bushes.length < 110; tries++) {
			const { x, z } = randomLand(62);
			const g = terrainAt(x, z);
			if (g < 1.6 || g > 12 || nearPier(x, z, 1) || !roomy(x, z, 0.9) || !clearOfPlaces(x, z, 0.5)) continue;
			const s = 0.5 + rand() * 0.5;
			bushes.push(place(x, g - 0.05, z, s, s * 0.7));
		}
		// The islet has a few palms of its own, leaning over the chest, and a couple of bushes.
		for (const [dx, dz, s] of [
			[3.4, -1.6, 1.05],
			[-2.8, 2.6, 0.9],
			[0.6, 4.4, 0.8],
		]) {
			const x = ISLET.x + dx;
			const z = ISLET.z + dz;
			palms.push(place(x, terrainAt(x, z) - 0.1, z, s));
			addFeature({ x, z, r: 0.35 * s });
		}
		for (const [dx, dz] of [
			[2.2, 2.0],
			[-3.4, -1.2],
		]) {
			const x = ISLET.x + dx;
			const z = ISLET.z + dz;
			bushes.push(place(x, terrainAt(x, z) - 0.05, z, 0.7, 0.5));
		}
		const petals = ['#ffd84d', '#ff9ec7', '#ffffff', '#b9a6ff'];
		for (let tries = 0; tries < 4000 && flowers.length < 360; tries++) {
			const { x, z } = randomLand(60);
			const g = terrainAt(x, z);
			if (g < 1.8 || g > 11 || slopeUp(x, z) < 0.8 || fbm(x * 0.08, z * 0.08 + 70, 2) < 0.05 || !clearOfPlaces(x, z, -1.5)) continue;
			flowers.push({ m: place(x, g + 0.12, z, 0.8 + rand() * 0.5), c: petals[Math.floor(rand() * petals.length)] });
		}
	}

	const world = toon({ vertexColors: true });
	const instanced = (geo: THREE.BufferGeometry, items: THREE.Matrix4[], mat: THREE.Material = world, shadow = true) => {
		if (!items.length) return null;
		const mesh = new THREE.InstancedMesh(geo, mat, items.length);
		items.forEach((m, i) => mesh.setMatrixAt(i, m));
		mesh.castShadow = shadow;
		mesh.receiveShadow = true;
		mesh.computeBoundingSphere();
		scene.add(mesh);
		return mesh;
	};
	instanced(palmGeometry(), palms);
	instanced(roundTreeGeometry(), trees);
	instanced(pineGeometry(false), pines);
	instanced(pineGeometry(true), snowyPines);
	instanced(colored(new THREE.IcosahedronGeometry(0.8, 1), '#5fae5c'), bushes);
	{
		const rockMesh = instanced(
			rockGeometry(),
			rocks.map((r) => new THREE.Matrix4().compose(new THREE.Vector3(r.x, r.base, r.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.rot), new THREE.Vector3(r.r, r.top, r.r))),
		);
		const tint = new THREE.Color();
		rocks.forEach((r, i) => rockMesh?.setColorAt(i, tint.set(r.r > 1.7 ? '#b4aed2' : i % 2 ? '#a29cc4' : '#9690b8')));
	}
	{
		const geo = colored(new THREE.OctahedronGeometry(0.13, 0), '#ffffff');
		const mesh = instanced(
			geo,
			flowers.map((f) => f.m),
			world,
			false,
		);
		const tint = new THREE.Color();
		flowers.forEach((f, i) => mesh?.setColorAt(i, tint.set(f.c)));
	}

	// Clouds drift slowly round the island.
	const cloudMat = toon({ color: '#ffffff' });
	const clouds = new THREE.Group();
	{
		const crand = rng(5);
		for (let i = 0; i < 16; i++) {
			const cloud = new THREE.Group();
			const puffs = 4 + Math.floor(crand() * 3);
			for (let k = 0; k < puffs; k++) {
				const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(3 + crand() * 3, 1), cloudMat);
				puff.position.set((k - puffs / 2) * 4 + crand() * 2, crand() * 2, crand() * 4 - 2);
				puff.scale.y = 0.65;
				cloud.add(puff);
			}
			const a = (i / 16) * TAU + crand();
			const r = 70 + crand() * 160;
			cloud.position.set(Math.cos(a) * r, 48 + crand() * 26, Math.sin(a) * r);
			cloud.rotation.y = crand() * TAU;
			clouds.add(cloud);
		}
	}
	scene.add(clouds);

	// A striped buoy bobbing on the swell, out past the far side of the island.
	const buoy = (() => {
		const geo = new THREE.TorusGeometry(0.85, 0.24, 10, 32).toNonIndexed();
		const p = geo.attributes.position;
		const col = new Float32Array(p.count * 3);
		const red = new THREE.Color('#f25f6b');
		const white = new THREE.Color('#fdfbff');
		for (let i = 0; i < p.count; i += 3) {
			// Colour each triangle by where its middle sits round the ring, in four stripes of each.
			const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
			const y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
			const c = Math.floor(((Math.atan2(y, x) + Math.PI) / TAU) * 8) % 2 ? red : white;
			for (let k = 0; k < 3; k++) c.toArray(col, (i + k) * 3);
		}
		geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
		geo.deleteAttribute('uv');
		geo.computeVertexNormals();
		geo.rotateX(-Math.PI / 2);
		const mesh = new THREE.Mesh(geo, toon({ vertexColors: true }));
		mesh.position.copy(BUOY);
		mesh.castShadow = true;
		scene.add(mesh);
		return mesh;
	})();

	// Ripples spread out on the water round her wherever she swims or wades.
	const ripples = Array.from({ length: 10 }, () => {
		const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false });
		const geo = new THREE.RingGeometry(0.82, 1, 40);
		geo.rotateX(-Math.PI / 2);
		const mesh = new THREE.Mesh(geo, mat);
		mesh.visible = false;
		mesh.renderOrder = 2;
		scene.add(mesh);
		return { mesh, mat, age: 0, size: 1 };
	});
	let nextRipple = 0;
	const ripple = (x: number, z: number, size: number) => {
		const r = ripples[nextRipple];
		nextRipple = (nextRipple + 1) % ripples.length;
		r.mesh.position.set(x, 0.04, z);
		r.mesh.visible = true;
		r.age = 0;
		r.size = size;
	};

	// ---------- the landmarks ----------

	const glowTex = glowTexture();
	/** Things that move every frame: flames, the flag, the lighthouse beam, the chest lid. */
	const animated: ((time: number, dt: number) => void)[] = [];
	/** Lights and glows that brighten (or only show) at night. */
	const nightLights: { light: THREE.PointLight; day: number; night: number }[] = [];
	const nightGlows: THREE.Object3D[] = [];
	const glowSprite = (scale: number, opacity: number, color = '#ffffff') => {
		const sprite = new THREE.Sprite(
			new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, depthWrite: false, opacity, blending: THREE.AdditiveBlending, fog: false }),
		);
		sprite.scale.setScalar(scale);
		return sprite;
	};
	const stoneMat = toon({ color: '#a29cc4' });
	const paleStone = toon({ color: '#b9b3d6' });
	const woodMat = toon({ color: '#8a5a3c' });
	const inkMat = toon({ color: '#2c2a52' });
	const goldMat = toon({ color: '#ffd84d' });
	const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
		const m = new THREE.Mesh(geo, mat);
		m.position.set(x, y, z);
		m.castShadow = m.receiveShadow = true;
		return m;
	};

	// The lighthouse: a striped tower on a stone plinth, with a beam that sweeps the sea at night.
	{
		const { x, z } = LIGHT;
		let low = Infinity;
		let high = terrainAt(x, z);
		for (let k = 0; k < 12; k++) {
			const a = (k * TAU) / 12;
			const h = terrainAt(x + Math.cos(a) * 2.6, z + Math.sin(a) * 2.6);
			low = Math.min(low, h);
			high = Math.max(high, h);
		}
		const floor = high + 0.3;
		const group = new THREE.Group();
		group.position.set(x, floor, z);
		const depth = floor - low + 1.5;
		group.add(mesh(new THREE.CylinderGeometry(2.6, 2.9, depth, 12), paleStone, 0, -depth / 2, 0));
		const TOWER = 9;
		const BANDS = 5;
		for (let i = 0; i < BANDS; i++) {
			const r0 = THREE.MathUtils.lerp(1.45, 1.0, i / BANDS);
			const r1 = THREE.MathUtils.lerp(1.45, 1.0, (i + 1) / BANDS);
			group.add(mesh(new THREE.CylinderGeometry(r1, r0, TOWER / BANDS, 16), toon({ color: i % 2 ? '#f25f6b' : '#fdfbff' }), 0, (TOWER / BANDS) * (i + 0.5), 0));
		}
		group.add(mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.22, 16), inkMat, 0, TOWER + 0.11, 0));
		const lampMat = new THREE.MeshBasicMaterial({ color: '#fff3c9' });
		group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 1.3, 12), lampMat).translateY(TOWER + 0.87));
		group.add(mesh(new THREE.ConeGeometry(1.08, 1.1, 12), toon({ color: '#f25f6b' }), 0, TOWER + 2.07, 0));
		// A door facing inland.
		const inland = new THREE.Vector2(-x, -z).normalize();
		const door = mesh(new THREE.BoxGeometry(0.7, 1.35, 0.2), inkMat, inland.x * 1.4, 0.67, inland.y * 1.4);
		door.rotation.y = Math.atan2(inland.x, inland.y);
		group.add(door);
		// The beam: two long faint cones from the lamp, turning slowly.
		const beam = new THREE.Group();
		beam.position.y = TOWER + 0.87;
		const beamMat = new THREE.MeshBasicMaterial({ color: '#fff1c4', transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
		for (const side of [1, -1]) {
			const cone = new THREE.ConeGeometry(3, 40, 20, 1, true);
			cone.translate(0, -20, 0);
			cone.rotateZ((side * Math.PI) / 2);
			beam.add(new THREE.Mesh(cone, beamMat));
		}
		const glow = glowSprite(6, 0.9, '#ffe9b0');
		glow.position.y = TOWER + 0.87;
		const light = new THREE.PointLight('#ffe3a0', 0, 34, 1.2);
		light.position.y = TOWER + 0.6;
		group.add(beam, glow, light);
		nightGlows.push(beam, glow);
		nightLights.push({ light, day: 0, night: 14 });
		animated.push((time) => (beam.rotation.y = time * 0.7));
		scene.add(group);
		addFeature({ x, z, r: 2.65, pad: floor });
		addFeature({ x, z, r: 1.5 });
	}

	// The flag on the summit, by a little cairn.
	{
		const { x, z } = SUMMIT;
		const g = terrainAt(x, z);
		scene.add(mesh(new THREE.CylinderGeometry(0.05, 0.07, 3.4, 6), inkMat, x, g + 1.6, z));
		const cloth = new THREE.PlaneGeometry(1.6, 0.95, 12, 4);
		cloth.translate(0.8, 0, 0);
		const flat = Float32Array.from(cloth.attributes.position.array);
		const flag = mesh(cloth, toon({ color: '#ff9ec7', side: THREE.DoubleSide }), x + 0.05, g + 2.8, z);
		scene.add(flag);
		animated.push((time) => {
			const p = cloth.attributes.position;
			for (let i = 0; i < p.count; i++) {
				const u = flat[i * 3];
				p.setZ(i, Math.sin(u * 3.2 - time * 5) * 0.16 * u + Math.sin(u * 5 - time * 7.3) * 0.03 * u);
				p.setY(i, flat[i * 3 + 1] - u * u * 0.04);
			}
			p.needsUpdate = true;
			cloth.computeVertexNormals();
		});
		[0.62, 0.45, 0.3].forEach((r, i) => {
			const s = mesh(new THREE.DodecahedronGeometry(r, 0), stoneMat, x + 0.9, g + 0.25 + i * 0.42, z + 0.5);
			s.rotation.y = i * 1.3;
			scene.add(s);
		});
		addFeature({ x, z, r: 0.1 });
		addFeature({ x: x + 0.9, z: z + 0.5, r: 0.6, dome: { base: g, top: 0.9 } });
	}

	// The campfire clearing: a fire that crackles all day and night, a tent and two logs to sit on.
	{
		const { x, z } = CAMP;
		const g = terrainAt(x, z);
		const group = new THREE.Group();
		group.position.set(x, g, z);
		const pebble = new THREE.DodecahedronGeometry(0.22, 0);
		for (let k = 0; k < 9; k++) {
			const a = (k * TAU) / 9;
			const s = mesh(pebble, stoneMat, Math.cos(a) * 0.75, 0.08, Math.sin(a) * 0.75);
			s.rotation.set(k, k * 2, 0);
			group.add(s);
		}
		for (const a of [0.5, -0.6]) {
			const log = mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.1, 6), woodMat, 0, 0.15, 0);
			log.rotation.set(0, a, Math.PI / 2);
			group.add(log);
		}
		const outer = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.1, 7), new THREE.MeshBasicMaterial({ color: '#ff8a3d' }));
		const inner = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.75, 7), new THREE.MeshBasicMaterial({ color: '#ffd84d' }));
		outer.position.y = 0.62;
		inner.position.y = 0.5;
		const glow = glowSprite(3.4, 0.55, '#ffb070');
		glow.position.y = 0.75;
		const light = new THREE.PointLight('#ffa64d', 0, 18, 1.3);
		light.position.y = 1.1;
		group.add(outer, inner, glow, light);
		nightLights.push({ light, day: 2, night: 9 });
		animated.push((time) => {
			const f = 1 + 0.18 * Math.sin(time * 9.3) + 0.1 * Math.sin(time * 23);
			outer.scale.set(1 + 0.08 * Math.sin(time * 13), f, 1 + 0.08 * Math.cos(time * 11));
			inner.scale.set(1, 1 + 0.2 * Math.sin(time * 12 + 1), 1);
			outer.rotation.y = time * 2;
			inner.rotation.y = -time * 3;
			light.intensity = (light.userData.base ?? 0) * (0.85 + 0.15 * Math.sin(time * 17));
		});
		const tentAt = { a: -0.3, r: 3.4 };
		const tent = mesh(new THREE.ConeGeometry(1.7, 2.3, 4), toon({ color: '#f2a65a' }), Math.cos(tentAt.a) * tentAt.r, 1.1, Math.sin(tentAt.a) * tentAt.r);
		tent.rotation.y = Math.PI / 4 + tentAt.a;
		group.add(tent);
		addFeature({ x: x + tent.position.x, z: z + tent.position.z, r: 1.35 });
		for (const [a, r] of [
			[1.6, 2.1],
			[3.0, 2.2],
		]) {
			const lx = Math.cos(a) * r;
			const lz = Math.sin(a) * r;
			const log = mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.8, 8), woodMat, lx, 0.24, lz);
			log.rotation.set(0, -a + Math.PI / 2, Math.PI / 2);
			group.add(log);
			// Two low humps along the log, so she can step up onto it.
			for (const t of [-0.55, 0.55])
				addFeature({ x: x + lx - Math.sin(a) * t, z: z + lz + Math.cos(a) * t, r: 0.5, dome: { base: terrainAt(x + lx, z + lz), top: 0.5 } });
		}
		scene.add(group);
		addFeature({ x, z, r: 0.85 });
	}

	// The standing stones: a ring on the hills round an altar, with a crystal turning over it.
	{
		const { x, z } = STONES;
		const g = terrainAt(x, z);
		for (let k = 0; k < 8; k++) {
			const a = (k * TAU) / 8 + 0.2;
			const sx = x + Math.cos(a) * 5.2;
			const sz = z + Math.sin(a) * 5.2;
			const h = 2.2 + prand() * 1.2;
			const stone = mesh(new THREE.BoxGeometry(1.0, h, 0.6), stoneMat, sx, terrainAt(sx, sz) + h / 2 - 0.3, sz);
			stone.rotation.set(0, -a, (prand() - 0.5) * 0.12);
			scene.add(stone);
			addFeature({ x: sx, z: sz, r: 0.55 });
		}
		scene.add(mesh(new THREE.CylinderGeometry(1.1, 1.3, 1.2, 8), paleStone, x, g - 0.05, z));
		addFeature({ x, z, r: 1.15, pad: g + 0.55 });
		const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), new THREE.MeshBasicMaterial({ color: '#9fe3ff' }));
		crystal.scale.y = 1.5;
		const glow = glowSprite(3, 0.7, '#9fe3ff');
		scene.add(crystal, glow);
		nightGlows.push(glow);
		animated.push((time) => {
			crystal.position.set(x, g + 2.3 + Math.sin(time * 1.4) * 0.15, z);
			crystal.rotation.y = time * 0.9;
			glow.position.copy(crystal.position);
		});
	}

	// A treasure chest on the islet, which opens as she comes up to it.
	{
		const x = ISLET.x - 1.2;
		const z = ISLET.z - 0.8;
		const group = new THREE.Group();
		group.position.set(x, terrainAt(x, z) - 0.05, z);
		group.rotation.y = Math.atan2(-x, -z);
		const chestWood = toon({ color: '#9a6a43' });
		group.add(mesh(new THREE.BoxGeometry(1.1, 0.6, 0.75), chestWood, 0, 0.3, 0));
		for (const side of [-0.35, 0.35]) group.add(mesh(new THREE.BoxGeometry(0.12, 0.62, 0.77), goldMat, side, 0.3, 0));
		group.add(new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.1, 0.6), new THREE.MeshBasicMaterial({ color: '#ffe066' })).translateY(0.56));
		const lid = new THREE.Group();
		lid.position.set(0, 0.6, -0.375);
		lid.add(mesh(new THREE.BoxGeometry(1.1, 0.26, 0.75), chestWood, 0, 0.13, 0.375));
		for (const side of [-0.35, 0.35]) lid.add(mesh(new THREE.BoxGeometry(0.12, 0.28, 0.77), goldMat, side, 0.13, 0.375));
		const glow = glowSprite(2.4, 0, '#ffe066');
		glow.position.y = 0.9;
		group.add(lid, glow);
		scene.add(group);
		addFeature({ x, z, r: 0.7 });
		let open = 0;
		animated.push((time, dt) => {
			open = damp(open, Math.hypot(pos.x - x, pos.z - z) < 3.2 ? 1 : 0, 4, dt);
			lid.rotation.x = -open * 1.9;
			glow.material.opacity = open * (0.75 + 0.15 * Math.sin(time * 3));
		});
	}

	// Nixchan
	const root = new THREE.Group();
	const figure = buildNixFigure(canvas.dataset.model ?? '');
	root.add(figure.group);
	scene.add(root);

	// Her glider: a striped wing on two struts, which she opens in mid-air.
	const glider = (() => {
		const rig = new THREE.Group();
		const geo = new THREE.BoxGeometry(3.6, 0.06, 1.25, 16, 1, 1).toNonIndexed();
		const p = geo.attributes.position;
		for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) - (p.getX(i) / 1.8) ** 2 * 0.42);
		const col = new Float32Array(p.count * 3);
		const colors = [new THREE.Color('#ffd84d'), new THREE.Color('#f25f6b')];
		for (let i = 0; i < p.count; i += 3) {
			const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
			const c = colors[Math.floor((x + 1.8) / 0.6) % 2];
			for (let k = 0; k < 3; k++) c.toArray(col, (i + k) * 3);
		}
		geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
		geo.deleteAttribute('uv');
		geo.computeVertexNormals();
		const wing = new THREE.Mesh(geo, toon({ vertexColors: true, side: THREE.DoubleSide }));
		wing.position.set(0, 3.05, 0.1);
		wing.rotation.x = 0.12;
		wing.castShadow = true;
		rig.add(wing);
		for (const side of [-1, 1]) {
			const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.5, 5), toon({ color: '#2c2a52' }));
			strut.position.set(side * 0.42, 2.3, 0.1);
			strut.rotation.z = side * 0.2;
			rig.add(strut);
		}
		rig.visible = false;
		rig.scale.setScalar(0.01);
		root.add(rig);
		return rig;
	})();
	let gliderOpen = 0;
	figure.group.traverse((o) => (o.castShadow = true));
	let ready = false;
	figure.ready.then(
		() => {
			ready = true;
			figure.group.traverse((o) => (o.castShadow = true));
			ui.loading?.setAttribute('hidden', '');
		},
		() => {
			if (ui.loading) ui.loading.textContent = "Nixchan couldn't make it to the island just now. Try reloading?";
		},
	);

	// ---------- theme ----------

	const applyTime = () => {
		const p = document.documentElement.dataset.time === 'night' ? NIGHT : DAY;
		skyMat.uniforms.uTop.value.set(p.top);
		skyMat.uniforms.uHorizon.value.set(p.horizon);
		skyMat.uniforms.uSunCol.value.set(p.sunColor);
		fog.color.set(p.horizon);
		sun.color.set(p.sunColor);
		sun.intensity = p.sun;
		ambient.intensity = p.ambient;
		hemi.color.set(p.hemiSky);
		hemi.groundColor.set(p.hemiGround);
		hemi.intensity = p.hemi;
		waterMat.uniforms.uShallow.value.set(p.shallow);
		waterMat.uniforms.uDeep.value.set(p.deep);
		waterMat.uniforms.uFoam.value.set(p.foam);
		cloudMat.color.set(p.cloud);
		for (const r of ripples) r.mat.color.set(p.foam);
		stars.visible = p.night;
		lantern.intensity = p.night ? 2.2 : 0;
		pierLamp.intensity = p.night ? 9 : 0;
		bulbMat.color.set(p.night ? '#ffe39a' : '#f4ecd6');
		for (const n of nightLights) n.light.intensity = n.light.userData.base = p.night ? n.night : n.day;
		for (const g of nightGlows) g.visible = p.night;
	};
	applyTime();
	addEventListener('site-time', applyTime);

	// ---------- input ----------

	const keys = new Set<string>();
	const stick = new THREE.Vector2();
	let jumpQueued = false;
	let waveQueued = false;
	const MOVE_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'];
	addEventListener('keydown', (e) => {
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		const target = e.target instanceof Element ? e.target : null;
		if (target?.closest('input, textarea, select, [contenteditable]')) return;
		const key = e.key.toLowerCase();
		// Talking with Pebble, the keys work the conversation.
		if (npc.talking) {
			if (key === ' ' || key.startsWith('arrow') || key === 'enter') e.preventDefault();
			if (!e.repeat) npc.key(key);
			return;
		}
		// With the menu open, only the keys that work the menu do anything.
		if (atlasOpen && !['m', 'i', 'h', '?', 'escape'].includes(key)) return;
		if (farm.shopOpen && key !== 'escape') return;
		if (MOVE_KEYS.includes(key)) {
			keys.add(key);
			if (key.startsWith('arrow')) e.preventDefault();
		} else if (key === ' ') {
			if (target?.closest('a, button')) return;
			e.preventDefault();
			jumpQueued = true;
		} else if (key === 'e' && !e.repeat) {
			// E does whatever there is to do in the garden, and otherwise she waves.
			if (!farm.press()) waveQueued = true;
		} else if (key === 'f') {
			if (!e.repeat) fishing.press();
		} else if (key === 'm' && !e.repeat) {
			toggleMenu('map');
		} else if (key === 'i' && !e.repeat) {
			toggleMenu('bag');
		} else if ((key === 'h' || key === '?') && !e.repeat) {
			toggleMenu('help');
		} else if (key === 'escape') {
			closeMenu();
			farm.closeShop();
		}
	});
	addEventListener('keyup', (e) => {
		const key = e.key.toLowerCase();
		keys.delete(key);
		if (key === 'f') fishing.release();
	});
	addEventListener('blur', () => {
		keys.clear();
		fishing.release();
	});

	// She starts with her back to the sea, looking inland, with the pier off to one side.
	let orbitYaw = Math.atan2(PIER_DIR.x, PIER_DIR.z) + 0.55;
	let orbitPitch = 0.32;
	let orbitDistance = 9;
	// A finger on the left of the screen is a joystick; anywhere else, or a mouse, swings the camera.
	const pointers = new Map<number, { kind: 'stick' | 'look'; x: number; y: number; ox: number; oy: number }>();
	canvas.addEventListener('pointerdown', (e) => {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		canvas.setPointerCapture(e.pointerId);
		const kind = e.pointerType !== 'mouse' && e.clientX < innerWidth * 0.45 ? 'stick' : 'look';
		pointers.set(e.pointerId, { kind, x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY });
		if (kind === 'stick' && ui.stick) {
			ui.stick.hidden = false;
			ui.stick.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
		}
	});
	canvas.addEventListener('pointermove', (e) => {
		const p = pointers.get(e.pointerId);
		if (!p) return;
		if (p.kind === 'look') {
			orbitYaw -= (e.clientX - p.x) * 0.006;
			orbitPitch = clamp(orbitPitch + (e.clientY - p.y) * 0.004, -0.05, 1.2);
		} else {
			stick.set(e.clientX - p.ox, e.clientY - p.oy);
			if (stick.length() > 60) stick.setLength(60);
			if (ui.knob) ui.knob.style.transform = `translate(${stick.x}px, ${stick.y}px)`;
			stick.divideScalar(60);
		}
		p.x = e.clientX;
		p.y = e.clientY;
	});
	const release = (e: PointerEvent) => {
		const p = pointers.get(e.pointerId);
		pointers.delete(e.pointerId);
		if (p?.kind === 'stick') {
			stick.set(0, 0);
			if (ui.stick) ui.stick.hidden = true;
			if (ui.knob) ui.knob.style.transform = '';
		}
	};
	canvas.addEventListener('pointerup', release);
	canvas.addEventListener('pointercancel', release);
	canvas.addEventListener(
		'wheel',
		(e) => {
			e.preventDefault();
			orbitDistance = clamp(orbitDistance * Math.exp(e.deltaY * 0.0012), 3.5, 26);
		},
		{ passive: false },
	);
	ui.jump?.addEventListener('pointerdown', (e) => {
		e.preventDefault();
		jumpQueued = true;
	});

	// ---------- the game state ----------

	const WALK = 3;
	const RUN = 7.5;
	const SWIM = 2.4;
	const SWIM_FAST = 3.6;
	const GLIDE = 8.5;
	const GLIDE_SINK = 2.3;
	const GRAVITY = 26;
	const JUMP_SPEED = 8.6;
	const FLIGHT = (2 * JUMP_SPEED) / GRAVITY;
	const BODY_R = 0.45;
	const pos = START.clone();
	const vel = new THREE.Vector3();
	let vy = 0;
	let grounded = true;
	let swimming = false;
	let gliding = false;
	let rippleClock = 0;
	let swimClock = 0;
	let jumped = false;
	let airTime = 0;
	let heading = Math.atan2(-PIER_DIR.x, -PIER_DIR.z) + 0.55;
	let turn = heading;
	let waving = 0;
	let nextBlink = 2;
	root.position.copy(pos);

	/** Back to the beach, should she ever fall out of the world. */
	const respawn = () => {
		pos.copy(START);
		vel.set(0, 0, 0);
		vy = 0;
		grounded = true;
		swimming = false;
		gliding = false;
	};

	/** Whether she can move her feet from where she is to (x, z). */
	const canGo = (x: number, z: number) => {
		const g = groundAt(x, z);
		if (Math.hypot(x, z) > WORLD_EDGE) return false;
		// Swimming, she goes round the pier and anything else standing up out of the water.
		if (swimming) return g < 0.05;
		const step = Math.hypot(x - pos.x, z - pos.z);
		// On her feet she takes steps and gentle slopes in her stride; in the air she clears what's beneath her.
		return grounded ? g - pos.y <= 0.5 + step * 1.3 : g <= pos.y + 0.05;
	};
	const pushOut = (p: THREE.Vector3) => {
		for (const f of nearby(p.x, p.z)) {
			if (f.dome || f.pad !== undefined) continue;
			const dx = p.x - f.x;
			const dz = p.z - f.z;
			const d = Math.hypot(dx, dz);
			const min = f.r + BODY_R;
			if (d < min && d > 1e-4) {
				p.x = f.x + (dx / d) * min;
				p.z = f.z + (dz / d) * min;
			}
		}
	};

	// Her bag. Only fish go in it so far; farming will bring seeds and crops.
	const inventory = createInventory({
		slots: 24,
		storageKey: 'island-bag',
		grid: ui.bag,
		detail: ui.bagDetail,
		summary: ui.bagSummary,
		note: () => `${farm.coins} coins`,
	});
	for (const s of SPECIES)
		inventory.register({
			id: `fish-${s.id}`,
			name: s.name,
			kind: 'fish',
			description: s.blurb,
			color: s.body,
			sell: s.price,
			icon: () => fishing.iconFor(s.id),
			actions: [
				{
					label: 'Let one go',
					run: (id) => {
						if (inventory.remove(id)) fishing.toast(`The ${s.name} swims off.`);
					},
				},
			],
		});

	const fishing = createFishing({
		renderer,
		scene,
		camera,
		figure,
		root,
		modelUrl: canvas.dataset.fishModel ?? '',
		toon,
		groundAt,
		ripple,
		pos,
		canStand: () => ready && grounded && !swimming && !farm.busy && !farm.shopOpen && !npc.talking && Math.hypot(vel.x, vel.z) < 0.6,
		heading: () => heading,
		towardCamera: () => Math.atan2(camera.position.x - pos.x, camera.position.z - pos.z),
		waters: (x, z) => ({
			deep: groundAt(x, z) < -3.5,
			islet: Math.hypot(x - ISLET.x, z - ISLET.z) < 48,
			pier: deckAt(pos.x, pos.z) > -Infinity,
		}),
		onCatch: (s) => inventory.add(`fish-${s.id}`),
		onIcons: () => inventory.render(),
	});

	const farm = createFarm({
		renderer,
		scene,
		figure,
		toon,
		inventory,
		modelUrl: canvas.dataset.farmModel ?? '',
		centre: GARDEN,
		angle: GARDEN_ANGLE,
		groundAt,
		addFeature,
		pos,
		towardCamera: () => Math.atan2(camera.position.x - pos.x, camera.position.z - pos.z),
		canAct: () => ready && grounded && !swimming && !fishing.active && !atlasOpen && !npc.talking,
		toast: (text) => fishing.toast(text),
		keeper: { name: 'Pebble', talk: () => npc.open() },
		onTrade: () => npc.cheer(),
	});

	// Pebble, who keeps the stand, behind its counter.
	const npc = createNpc({
		scene,
		camera,
		toon,
		modelUrl: canvas.dataset.otterModel ?? '',
		spot: farm.keeperSpot,
		groundAt,
		pos,
		openShop: () => farm.openShop(),
		facts: () => {
			const sellable = { count: 0, value: 0, name: null as string | null };
			let seeds = 0;
			for (const [id, n] of inventory.entries()) {
				const def = inventory.def(id);
				if (def?.sell) {
					sellable.count += n;
					sellable.value += def.sell * n;
					sellable.name ??= def.name;
				}
				if (def?.kind === 'seed') seeds += n;
			}
			return {
				night: document.documentElement.dataset.time === 'night',
				caughtKinds: fishing.caughtKinds(),
				fishKinds: SPECIES.length,
				hasCaught: fishing.hasCaught,
				found: (id: string) => discovered.has(id),
				sellable,
				seeds,
				garden: farm.summary(),
			};
		},
	});
	addFeature({ x: farm.keeperSpot.x, z: farm.keeperSpot.z, r: 0.4 });
	inventory.render();

	const steer = new THREE.Vector3();
	const zero = new THREE.Vector2();
	const step = (dt: number) => {
		const held = (...names: string[]) => (names.some((n) => keys.has(n)) ? 1 : 0);
		let forward = held('w', 'arrowup') - held('s', 'arrowdown');
		let right = held('d', 'arrowright') - held('a', 'arrowleft');
		let running = keys.has('shift');
		if (stick.lengthSq() > 0.01) {
			forward = -stick.y;
			right = stick.x;
			running = stick.length() > 0.85;
		}
		steer.set(-Math.sin(orbitYaw) * forward + Math.cos(orbitYaw) * right, 0, -Math.cos(orbitYaw) * forward - Math.sin(orbitYaw) * right);
		if (steer.lengthSq() > 1) steer.normalize();
		let moving = steer.lengthSq() > 0.01;
		// Fishing keeps her on the spot, facing the water: walking off (or jumping) puts the rod
		// away, except with a fish on the line.
		// So does chatting with Pebble, facing her.
		if (npc.talking) {
			steer.set(0, 0, 0);
			moving = false;
			jumpQueued = false;
			waveQueued = false;
			heading = npc.facing;
		}
		// So does tending the garden, until she's done.
		if (farm.busy) {
			steer.set(0, 0, 0);
			moving = false;
			jumpQueued = false;
			waveQueued = false;
			heading = farm.facing;
		}
		if (fishing.active) {
			if ((moving || jumpQueued) && !fishing.hooked) fishing.interrupt();
			if (fishing.active) {
				steer.set(0, 0, 0);
				moving = false;
				jumpQueued = false;
				waveQueued = false;
				heading = fishing.facing;
			}
		}
		// Gliding, she keeps sailing on the way she's facing even with nothing held.
		if (gliding && !moving) steer.set(Math.sin(heading) * 0.6, 0, Math.cos(heading) * 0.6);

		const wading = grounded && pos.y < 0.05;
		const speed = gliding ? GLIDE : swimming ? (running ? SWIM_FAST : SWIM) : (running ? RUN : WALK) * (wading ? 0.6 : 1);
		// In the water she glides, and in the air she can only steer a little (more so under the wing).
		const control = grounded ? 10 : swimming ? 4 : gliding ? 2.2 : 3;
		vel.x = damp(vel.x, steer.x * speed, control, dt);
		vel.z = damp(vel.z, steer.z * speed, control, dt);

		// Move, sliding along whatever stops her rather than sticking to it.
		const nx = pos.x + vel.x * dt;
		const nz = pos.z + vel.z * dt;
		if (canGo(nx, nz)) {
			pos.x = nx;
			pos.z = nz;
		} else if (canGo(nx, pos.z)) {
			pos.x = nx;
			vel.z = 0;
		} else if (canGo(pos.x, nz)) {
			pos.z = nz;
			vel.x = 0;
		} else {
			vel.x = vel.z = 0;
		}
		pushOut(pos);

		const ground = groundAt(pos.x, pos.z);
		// She can jump from her feet, or spring up out of the water: high enough to reach the pier.
		// Jumping again in mid-air opens the glider, and once more folds it away.
		if (jumpQueued && (grounded || swimming)) {
			if (swimming) ripple(pos.x, pos.z, 1.2);
			vy = JUMP_SPEED;
			grounded = false;
			swimming = false;
			jumped = true;
			airTime = 0;
			waving = 0;
		} else if (jumpQueued) {
			if (gliding) gliding = false;
			else if (airTime > 0.15 && pos.y - ground > 0.9) gliding = true;
		}
		jumpQueued = false;
		const intoWater = () => {
			// The swimming clips float her with the water line at her origin, which lines her
			// shoulders up with where they were standing chest deep, so she needn't jump.
			swimming = true;
			grounded = false;
			gliding = false;
			vy = 0;
			waving = 0;
			ripple(pos.x, pos.z, 1.5);
		};
		if (swimming) {
			if (ground > SWIM_OUT) {
				swimming = false;
				grounded = true;
				pos.y = ground;
			} else {
				swimClock += dt;
				pos.y = Math.sin(swimClock * 2.2) * 0.05;
			}
		} else if (grounded) {
			if (ground < SWIM_IN) {
				intoWater();
			} else if (ground < pos.y - 0.6) {
				// Stepped off an edge.
				grounded = false;
				jumped = false;
				vy = 0;
				airTime = 0;
			} else {
				pos.y = ground;
			}
		}
		if (!grounded && !swimming) {
			airTime += dt;
			if (gliding) vy = damp(vy, -GLIDE_SINK, 3, dt);
			else vy -= GRAVITY * dt;
			pos.y += vy * dt;
			if (pos.y <= 0 && ground < SWIM_IN && vy <= 0) {
				pos.y = 0;
				intoWater();
			} else if (pos.y <= ground && vy <= 0) {
				pos.y = ground;
				grounded = true;
				gliding = false;
				vy = 0;
			}
		}
		if (pos.y < -4) respawn();
		root.position.copy(pos);

		const planar = Math.hypot(vel.x, vel.z);
		if (planar > 0.2) heading = Math.atan2(vel.x, vel.z);
		turn += Math.atan2(Math.sin(heading - turn), Math.cos(heading - turn)) * (1 - Math.exp(-10 * dt));
		figure.group.rotation.y = turn;

		// The glider opens out over her head, and banks a little into her turns.
		gliderOpen = damp(gliderOpen, gliding ? 1 : 0, gliding ? 12 : 16, dt);
		glider.visible = gliderOpen > 0.02;
		glider.scale.setScalar(Math.max(gliderOpen, 0.01));
		glider.rotation.y = turn;
		glider.rotation.z = damp(glider.rotation.z, clamp(Math.atan2(Math.sin(heading - turn), Math.cos(heading - turn)) * -2, -0.35, 0.35), 5, dt);

		if (waveQueued && grounded) waving = 3.2;
		waveQueued = false;
		if (moving) waving = 0;
		waving = Math.max(0, waving - dt);
		let clip: NixClip = swimming ? (planar > 0.3 ? 'Swim' : 'Tread') : planar > 3 ? 'Run' : planar > 0.25 ? 'Walk' : 'Idle';
		if (waving > 0) clip = 'Wave';
		if (fishing.clip) clip = fishing.clip;
		if (farm.clip) clip = farm.clip;
		// The clips are cut for about 1.5 (walk), 4.2 (run) and 2.4 (swim) a second.
		const pace =
			clip === 'Run' ? clamp(planar / 4.2, 0.8, 2.4) : clip === 'Walk' ? clamp(planar / 1.5, 0.6, 1.8) : clip === 'Swim' ? clamp(planar / 2.4, 0.7, 1.6) : 1;
		figure.play(clip, pace);

		// Rings on the water: steadily as she swims, now and then as she treads water or wades.
		rippleClock -= dt;
		const wet = swimming || (grounded && pos.y < -0.15);
		if (wet && rippleClock <= 0) {
			ripple(pos.x, pos.z, swimming ? (planar > 0.3 ? 0.9 : 0.7) : 0.6);
			rippleClock = planar > 0.3 ? 0.4 : 1.1;
		}

		const airborne = !grounded && !swimming;
		// Under the glider she hangs in the middle of a jump, legs tucked.
		const t = gliding ? 0.5 : jumped ? clamp(airTime / FLIGHT, 0, 0.97) : clamp(0.5 + airTime, 0.5, 0.97);
		const flight = airborne ? { t, clip: 'JumpStand' as const } : null;
		return { flight, airborne, swimming };
	};

	// ---------- coming across places ----------

	const PLACES_KEY = 'island-places';
	const MAP_KEY = 'island-map';
	const discovered = new Set<string>();
	try {
		const saved: unknown = JSON.parse(localStorage.getItem(PLACES_KEY) ?? '[]');
		if (Array.isArray(saved)) for (const id of saved) if (places.some((p) => p.id === id)) discovered.add(id);
	} catch {
		// A fresh island, then.
	}
	let bannerTimer = 0;
	const announce = (name: string, note: string | null) => {
		if (!ui.banner || !ui.bannerName || !ui.bannerNote) return;
		ui.bannerName.textContent = name;
		ui.bannerNote.textContent = note ?? '';
		ui.bannerNote.hidden = !note;
		ui.banner.classList.remove('show');
		void ui.banner.offsetWidth;
		ui.banner.classList.add('show');
		clearTimeout(bannerTimer);
		bannerTimer = window.setTimeout(() => ui.banner?.classList.remove('show'), 3600);
	};
	let here: Place | null = null;
	const checkPlaces = () => {
		// She has to wander off a little way before the same place greets her again.
		if (here && Math.hypot(pos.x - here.x, pos.z - here.z) > here.r * 1.5 + 3) here = null;
		if (here) return;
		for (const p of places) {
			if (Math.hypot(pos.x - p.x, pos.z - p.z) > p.r) continue;
			here = p;
			const first = !discovered.has(p.id);
			if (first) {
				discovered.add(p.id);
				try {
					localStorage.setItem(PLACES_KEY, JSON.stringify([...discovered]));
				} catch {
					// It just won't be remembered next time.
				}
			}
			announce(p.name, first ? 'New place found' : null);
			updateAtlasCount();
			break;
		}
	};

	// ---------- the maps ----------

	// Both maps are drawn from one picture of the whole sea, uncovered as she explores it.
	const MAP_SPAN = WORLD_EDGE;
	const MAP_PX = 256;
	const toPx = (v: number) => ((v / MAP_SPAN) * 0.5 + 0.5) * MAP_PX;
	const FOG = '#d6dbe9';
	const mapImage = (() => {
		const c = document.createElement('canvas');
		c.width = c.height = MAP_PX;
		const ctx = c.getContext('2d')!;
		const img = ctx.createImageData(MAP_PX, MAP_PX);
		for (let y = 0; y < MAP_PX; y++)
			for (let x = 0; x < MAP_PX; x++) {
				const wx = ((x + 0.5) / MAP_PX - 0.5) * 2 * MAP_SPAN;
				const wz = ((y + 0.5) / MAP_PX - 0.5) * 2 * MAP_SPAN;
				const h = Math.max(terrainAt(wx, wz), deckAt(wx, wz));
				const rgb = h < 0 ? (h > -1.2 ? [134, 227, 214] : h > -4 ? [92, 170, 222] : [58, 134, 208]) : h < 1.5 ? [244, 226, 174] : h > 14.5 ? [246, 245, 255] : [136, 204, 115 - Math.min(h, 12) * 3];
				img.data.set([...rgb, 255], (y * MAP_PX + x) * 4);
			}
		ctx.putImageData(img, 0, 0);
		return c;
	})();
	const makeCanvas = () => {
		const c = document.createElement('canvas');
		c.width = c.height = MAP_PX;
		return [c, c.getContext('2d')!] as const;
	};
	const [mask, maskCtx] = makeCanvas();
	const [shown, shownCtx] = makeCanvas();
	const refreshShown = () => {
		shownCtx.globalCompositeOperation = 'source-over';
		shownCtx.clearRect(0, 0, MAP_PX, MAP_PX);
		shownCtx.drawImage(mapImage, 0, 0);
		shownCtx.globalCompositeOperation = 'destination-in';
		shownCtx.drawImage(mask, 0, 0);
		shownCtx.globalCompositeOperation = 'source-over';
	};
	let maskDirty = false;
	try {
		const saved = localStorage.getItem(MAP_KEY);
		if (saved?.startsWith('data:image/png')) {
			const img = new Image();
			img.onload = () => {
				maskCtx.drawImage(img, 0, 0);
				refreshShown();
			};
			img.src = saved;
		}
	} catch {
		// Start with the map blank.
	}
	const revealedAt = new THREE.Vector2(Infinity, Infinity);
	const reveal = () => {
		if (revealedAt.distanceTo(new THREE.Vector2(pos.x, pos.z)) < 2) return;
		revealedAt.set(pos.x, pos.z);
		// She sees further from high up.
		const metres = 22 + Math.max(0, pos.y) * 1.4;
		const r = (metres / MAP_SPAN) * 0.5 * MAP_PX;
		const cx = toPx(pos.x);
		const cy = toPx(pos.z);
		const g = maskCtx.createRadialGradient(cx, cy, 0, cx, cy, r);
		g.addColorStop(0, 'rgba(0, 0, 0, 1)');
		g.addColorStop(0.55, 'rgba(0, 0, 0, 1)');
		g.addColorStop(1, 'rgba(0, 0, 0, 0)');
		maskCtx.fillStyle = g;
		maskCtx.fillRect(cx - r, cy - r, r * 2, r * 2);
		refreshShown();
		maskDirty = true;
	};
	const saveMap = () => {
		if (!maskDirty) return;
		maskDirty = false;
		try {
			localStorage.setItem(MAP_KEY, mask.toDataURL('image/png'));
		} catch {
			// Too full, or not allowed: the map just won't be remembered.
		}
	};
	setInterval(saveMap, 5000);
	addEventListener('pagehide', saveMap);

	const drawArrow = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => {
		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(-turn);
		ctx.fillStyle = '#2c2a52';
		ctx.strokeStyle = '#ffffff';
		ctx.lineWidth = size * 0.25;
		ctx.beginPath();
		ctx.moveTo(0, size * 1.1);
		ctx.lineTo(size * 0.75, -size * 0.7);
		ctx.lineTo(-size * 0.75, -size * 0.7);
		ctx.closePath();
		ctx.stroke();
		ctx.fill();
		ctx.restore();
	};
	const drawMarker = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => {
		ctx.fillStyle = '#ffd84d';
		ctx.strokeStyle = '#2c2a52';
		ctx.lineWidth = size * 0.35;
		ctx.beginPath();
		ctx.moveTo(x, y - size);
		ctx.lineTo(x + size, y);
		ctx.lineTo(x, y + size);
		ctx.lineTo(x - size, y);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
	};

	// The minimap follows her about, showing the 80 m or so round her.
	const VIEW = 40;
	const mapCtx = ui.map?.getContext('2d') ?? null;
	const drawMap = () => {
		if (!mapCtx || !ui.map) return;
		const s = ui.map.width;
		const k = MAP_PX / (2 * MAP_SPAN);
		mapCtx.fillStyle = FOG;
		mapCtx.fillRect(0, 0, s, s);
		mapCtx.drawImage(shown, toPx(pos.x) - VIEW * k, toPx(pos.z) - VIEW * k, 2 * VIEW * k, 2 * VIEW * k, 0, 0, s, s);
		const toMini = (wx: number, wz: number) => [((wx - pos.x) / VIEW) * 0.5 * s + s / 2, ((wz - pos.z) / VIEW) * 0.5 * s + s / 2];
		for (const p of places) {
			if (!discovered.has(p.id)) continue;
			const [mx, my] = toMini(p.x, p.z);
			if (Math.hypot(mx - s / 2, my - s / 2) < s / 2 - 4) drawMarker(mapCtx, mx, my, s * 0.035);
		}
		drawArrow(mapCtx, s / 2, s / 2, s * 0.045);
	};

	// The big map shows the whole sea, with the names of the places she's been.
	let atlasOpen = false;
	const atlasCtx = ui.atlasMap?.getContext('2d') ?? null;
	const sans = getComputedStyle(document.documentElement).getPropertyValue('--sans').trim() || 'system-ui, sans-serif';
	const drawAtlas = () => {
		if (!atlasCtx || !ui.atlasMap) return;
		const s = ui.atlasMap.width;
		const toAtlas = (v: number) => ((v / MAP_SPAN) * 0.5 + 0.5) * s;
		atlasCtx.fillStyle = FOG;
		atlasCtx.fillRect(0, 0, s, s);
		atlasCtx.drawImage(shown, 0, 0, s, s);
		atlasCtx.font = `800 ${Math.round(s * 0.03)}px ${sans}`;
		atlasCtx.textAlign = 'center';
		atlasCtx.lineJoin = 'round';
		// Each name goes above its marker, or below it if that would cover a name already written.
		const taken: { x0: number; x1: number; y0: number; y1: number }[] = [];
		const line = s * 0.034;
		for (const p of places) {
			if (!discovered.has(p.id)) continue;
			const x = toAtlas(p.x);
			const y = toAtlas(p.z);
			drawMarker(atlasCtx, x, y, s * 0.014);
			const w = atlasCtx.measureText(p.name).width / 2 + s * 0.006;
			const box = (ty: number) => ({ x0: x - w, x1: x + w, y0: ty - line, y1: ty + line * 0.25 });
			const clash = (b: ReturnType<typeof box>) => taken.some((t) => b.x0 < t.x1 && b.x1 > t.x0 && b.y0 < t.y1 && b.y1 > t.y0);
			let ty = y - s * 0.025;
			if (clash(box(ty))) ty = y + s * 0.025 + line * 0.75;
			taken.push(box(ty));
			const tx = clamp(x, w, s - w);
			atlasCtx.lineWidth = s * 0.008;
			atlasCtx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
			atlasCtx.strokeText(p.name, tx, ty);
			atlasCtx.fillStyle = '#2c2a52';
			atlasCtx.fillText(p.name, tx, ty);
		}
		drawArrow(atlasCtx, toAtlas(pos.x), toAtlas(pos.z), s * 0.016);
	};
	function updateAtlasCount() {
		if (!ui.atlasCount) return;
		const left = places.length - discovered.size;
		ui.atlasCount.textContent =
			left === 0 ? `You've been everywhere on the map. Go wherever you like!` : `${discovered.size} of ${places.length} places found. Some are out at sea.`;
	}
	updateAtlasCount();
	const sizeAtlas = () => {
		if (!ui.atlasMap) return;
		const px = Math.round(ui.atlasMap.clientWidth * Math.min(devicePixelRatio, 2));
		if (px && ui.atlasMap.width !== px) ui.atlasMap.width = ui.atlasMap.height = px;
	};
	// ---------- the menu: her bag, the map, the fish book and help, a tab each ----------

	type Tab = 'bag' | 'map' | 'fish' | 'help';
	let menuTab: Tab = 'map';
	const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-tab]')];
	const panels = [...document.querySelectorAll<HTMLElement>('[data-panel]')];
	const showTab = (tab: Tab) => {
		menuTab = tab;
		for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.tab === tab));
		for (const panel of panels) panel.hidden = panel.dataset.panel !== tab;
		if (tab === 'map') {
			sizeAtlas();
			drawAtlas();
		}
	};
	const openMenu = (tab: Tab) => {
		if (!ui.atlas) return;
		atlasOpen = true;
		ui.atlas.hidden = false;
		keys.clear();
		fishing.release();
		showTab(tab);
		tabs.find((t) => t.dataset.tab === tab)?.focus();
	};
	function closeMenu() {
		if (!ui.atlas || !atlasOpen) return;
		atlasOpen = false;
		ui.atlas.hidden = true;
		(document.activeElement as HTMLElement | null)?.blur();
	}
	/** Opens the menu at a tab, or closes it if it's already showing that tab. */
	function toggleMenu(tab: Tab) {
		if (atlasOpen && menuTab === tab) closeMenu();
		else openMenu(tab);
	}
	for (const t of tabs) t.addEventListener('click', () => showTab(t.dataset.tab as Tab));
	for (const button of document.querySelectorAll<HTMLButtonElement>('[data-open]'))
		button.addEventListener('click', () => {
			toggleMenu(button.dataset.open as Tab);
			if (!atlasOpen) button.blur();
		});
	ui.map?.addEventListener('click', () => openMenu('map'));
	ui.atlasClose?.addEventListener('click', closeMenu);
	ui.atlas?.addEventListener('click', (e) => {
		if (e.target === ui.atlas) closeMenu();
	});
	// Help opens by itself the first time she arrives.
	const HELP_KEY = 'island-help-seen';
	const firstVisit = (() => {
		try {
			if (localStorage.getItem(HELP_KEY)) return false;
			localStorage.setItem(HELP_KEY, '1');
		} catch {
			// Can't tell; show it.
		}
		return true;
	})();

	// ---------- the loop ----------

	const resize = () => {
		const w = innerWidth;
		const h = innerHeight;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.fov = w < h ? 60 : 45;
		camera.updateProjectionMatrix();
		if (ui.map) {
			const px = Math.round(ui.map.clientWidth * Math.min(devicePixelRatio, 2));
			if (px && ui.map.width !== px) ui.map.width = ui.map.height = px;
		}
		if (atlasOpen) sizeAtlas();
	};
	resize();
	addEventListener('resize', resize);

	const camLook = pos.clone();
	camLook.y += 1.2;
	const camPos = new THREE.Vector3();
	const orbitDir = new THREE.Vector3();
	let time = 0;
	let last = performance.now();
	let mapClock = 0;
	let greeted = false;

	renderer.setAnimationLoop((now) => {
		const dt = Math.min(0.05, (now - last) / 1000);
		last = now;
		time += dt;

		if (ready) {
			if (!greeted) {
				greeted = true;
				announce("Nixchan's Island", 'Go wherever you like');
				if (firstVisit) openMenu('help');
			}
			const { flight, airborne, swimming } = step(dt);
			// Dropping into the water isn't a landing, so no bending of the knees.
			figure.tick(dt, time, { airborne, look: zero, still: false, jump: flight, landed: !swimming });
			fishing.update(dt, time);
			farm.update(dt);
			npc.update(dt);
			nextBlink -= dt;
			if (nextBlink < 0) {
				const closed = nextBlink > -0.13;
				figure.setBlink(closed);
				if (!closed) nextBlink = 2.5 + Math.random() * 3;
			}
		}
		for (const tick of animated) tick(time, dt);

		// The camera swings round behind her, and never dips under the ground or the sea.
		// Under the glider it hangs back a little, to show more of where she's heading.
		// Chatting with Pebble, it swings round to the side and closes in, to show the two of them.
		const chat = npc.talking ? npc.spot : null;
		if (chat) {
			const want = npc.facing + Math.PI + 0.9;
			orbitYaw += Math.atan2(Math.sin(want - orbitYaw), Math.cos(want - orbitYaw)) * (1 - Math.exp(-3 * dt));
			orbitPitch = damp(orbitPitch, 0.22, 3, dt);
			orbitDistance = damp(orbitDistance, 5.5, 3, dt);
		}
		camLook.x = damp(camLook.x, chat ? THREE.MathUtils.lerp(pos.x, chat.x, 0.45) : pos.x, chat ? 4 : 10, dt);
		camLook.y = damp(camLook.y, pos.y + 1.2, 6, dt);
		camLook.z = damp(camLook.z, chat ? THREE.MathUtils.lerp(pos.z, chat.z, 0.45) : pos.z, chat ? 4 : 10, dt);
		orbitDir.set(Math.sin(orbitYaw) * Math.cos(orbitPitch), Math.sin(orbitPitch), Math.cos(orbitYaw) * Math.cos(orbitPitch));
		camPos.copy(camLook).addScaledVector(orbitDir, orbitDistance * (1 + gliderOpen * 0.35));
		camPos.y = Math.max(camPos.y, groundAt(camPos.x, camPos.z) + 0.7, 0.6);
		camera.position.copy(camPos);
		camera.lookAt(camLook);

		sky.position.copy(camera.position);
		stars.position.copy(camera.position);
		sun.position.copy(pos).addScaledVector(SUN_DIR, 80);
		sun.target.position.copy(pos);
		lantern.position.set(pos.x + 0.5, pos.y + 2.2, pos.z + 0.8);
		clouds.rotation.y = time * 0.004;
		buoy.position.y = Math.sin(time * 1.8) * 0.06;
		buoy.rotation.z = Math.sin(time * 1.3) * 0.05;
		for (const r of ripples) {
			if (!r.mesh.visible) continue;
			r.age += dt;
			const t = r.age / 1.3;
			if (t >= 1) {
				r.mesh.visible = false;
				continue;
			}
			r.mesh.scale.setScalar(r.size * (0.6 + t * 2.2));
			r.mat.opacity = 0.75 * (1 - t) * (1 - t);
		}
		waterMat.uniforms.uTime.value = time;

		mapClock -= dt;
		if (mapClock <= 0 && ready) {
			mapClock = 0.1;
			checkPlaces();
			reveal();
			drawMap();
			if (atlasOpen && menuTab === 'map') drawAtlas();
		}
		renderer.render(scene, camera);
	});
}
