// Nixchan's island: a little toon island in the sea for the 3D Nixchan to run about on, hunting for
// the snowflakes scattered over it. The island is a heightfield, so walking, wading, swimming and
// climbing are all one question — how high is the ground here? — and needs no physics engine.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildNixFigure, snowflakeTexture, type NixClip } from '../experimental/nix-figure';

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
const SIZE = 200; // the terrain mesh covers SIZE × SIZE, centred on the origin
const N = 160;
const STEP = SIZE / N;
const HALF = SIZE / 2;
const PEAK = { x: -18, z: -14 };
const SEA_FLOOR = -6;
/** She starts swimming where the sea floor drops below this, and finds her feet again above SWIM_OUT. */
const SWIM_IN = -1.35;
const SWIM_OUT = -1.2;

function islandHeight(x: number, z: number) {
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

/** A trunk she walks round, or a rock she can climb onto (a dome in the heightfield). */
interface Feature {
	x: number;
	z: number;
	r: number;
	dome?: { base: number; top: number };
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
		count: document.querySelector<HTMLElement>('[data-count]'),
		toast: document.querySelector<HTMLElement>('[data-toast]'),
		toastText: document.querySelector<HTMLElement>('[data-toast-text]'),
		again: document.querySelector<HTMLButtonElement>('[data-again]'),
		map: document.querySelector<HTMLCanvasElement>('[data-map]'),
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
					float alpha = max(mix(0.5, 0.94, smoothstep(0.0, 3.0, depth)), foam);
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
		if (t < -0.4 || nearPier(x, z, 2) || !clearOfStart(x, z, 6)) continue;
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

	// The snowflakes she's out to find.
	const flakeSpots: THREE.Vector3[] = [];
	{
		flakeSpots.push(new THREE.Vector3(PIER_DIR.x * (PIER.to - 1.5), PIER.deck + 1.2, PIER_DIR.z * (PIER.to - 1.5)));
		let top = { x: 0, z: 0, h: -Infinity };
		for (let j = 0; j <= N; j++)
			for (let i = 0; i <= N; i++) if (H(i, j) > top.h) top = { x: -HALF + i * STEP, z: -HALF + j * STEP, h: H(i, j) };
		flakeSpots.push(new THREE.Vector3(top.x, groundAt(top.x, top.z) + 1.2, top.z));
		// Two hang over big rocks, to be jumped for from on top.
		for (const rock of bigRocks.slice(0, 2)) flakeSpots.push(new THREE.Vector3(rock.x, rock.base + rock.top + 2.3, rock.z));
		// One floats on a buoy out at sea, round the far side, to be swum for.
		flakeSpots.push(BUOY.clone().setY(0.95));
		const spaced = (x: number, z: number) => flakeSpots.every((p) => Math.hypot(p.x - x, p.z - z) > 13);
		let high = 0;
		for (let tries = 0; tries < 4000 && flakeSpots.length < 12; tries++) {
			const { x, z } = randomLand(58);
			const g = groundAt(x, z);
			if (g < 0.6 || !spaced(x, z) || !roomy(x, z, 1.5) || !clearOfStart(x, z, 10)) continue;
			// A couple more float just out of reach, so she has to jump.
			const lift = high < 2 ? 2.4 : 1.2;
			high++;
			flakeSpots.push(new THREE.Vector3(x, g + lift, z));
		}
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
		const clearOfFlakes = (x: number, z: number, gap: number) => flakeSpots.every((p) => Math.hypot(p.x - x, p.z - z) > gap);
		for (let tries = 0; tries < 9000; tries++) {
			const { x, z } = randomLand(64);
			const g = terrainAt(x, z);
			if (g < 0.4 || nearPier(x, z, 2.5) || !clearOfStart(x, z, 4.5) || !clearOfFlakes(x, z, 2.5)) continue;
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
			if (g < 1.6 || g > 12 || nearPier(x, z, 1) || !roomy(x, z, 0.9)) continue;
			const s = 0.5 + rand() * 0.5;
			bushes.push(place(x, g - 0.05, z, s, s * 0.7));
		}
		const petals = ['#ffd84d', '#ff9ec7', '#ffffff', '#b9a6ff'];
		for (let tries = 0; tries < 4000 && flowers.length < 360; tries++) {
			const { x, z } = randomLand(60);
			const g = terrainAt(x, z);
			if (g < 1.8 || g > 11 || slopeUp(x, z) < 0.8 || fbm(x * 0.08, z * 0.08 + 70, 2) < 0.05) continue;
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

	// The buoy the sea snowflake floats over: a striped ring bobbing on the swell.
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

	// The snowflakes themselves.
	const flakeTex = snowflakeTexture();
	const glowTex = glowTexture();
	const flakeGeo = new THREE.PlaneGeometry(1.1, 1.1);
	interface Flake {
		group: THREE.Group;
		home: THREE.Vector3;
		mat: THREE.MeshBasicMaterial;
		glow: THREE.SpriteMaterial;
		got: boolean;
		fade: number;
		phase: number;
	}
	const flakes: Flake[] = flakeSpots.map((home, i) => {
		const group = new THREE.Group();
		const mat = new THREE.MeshBasicMaterial({ map: flakeTex, transparent: true, alphaTest: 0.05, side: THREE.DoubleSide, fog: false });
		const glow = new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, opacity: 0.8, fog: false });
		const sprite = new THREE.Sprite(glow);
		sprite.scale.setScalar(2.8);
		group.add(sprite, new THREE.Mesh(flakeGeo, mat));
		group.position.copy(home);
		scene.add(group);
		return { group, home, mat, glow, got: false, fade: 0, phase: i * 1.7 };
	});

	// Nixchan
	const root = new THREE.Group();
	const figure = buildNixFigure(canvas.dataset.model ?? '');
	root.add(figure.group);
	scene.add(root);
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
		for (const f of flakes) {
			f.glow.blending = p.night ? THREE.AdditiveBlending : THREE.NormalBlending;
			f.glow.needsUpdate = true;
		}
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
		if (MOVE_KEYS.includes(key)) {
			keys.add(key);
			if (key.startsWith('arrow')) e.preventDefault();
		} else if (key === ' ') {
			if (target?.closest('a, button')) return;
			e.preventDefault();
			jumpQueued = true;
		} else if (key === 'e' && !e.repeat) {
			waveQueued = true;
		}
	});
	addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
	addEventListener('blur', () => keys.clear());

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
	const GRAVITY = 26;
	const JUMP_SPEED = 8.6;
	const FLIGHT = (2 * JUMP_SPEED) / GRAVITY;
	const BODY_R = 0.45;
	const pos = START.clone();
	const vel = new THREE.Vector3();
	let vy = 0;
	let grounded = true;
	let swimming = false;
	let rippleClock = 0;
	let swimClock = 0;
	let jumped = false;
	let airTime = 0;
	let heading = Math.atan2(-PIER_DIR.x, -PIER_DIR.z) + 0.55;
	let turn = heading;
	let waving = 0;
	let nextBlink = 2;
	let found = 0;
	let started: number | null = null;
	let finished = false;
	root.position.copy(pos);

	const updateCount = () => {
		if (ui.count) ui.count.textContent = `${found} / ${flakes.length}`;
	};
	updateCount();
	const reset = () => {
		pos.copy(START);
		vel.set(0, 0, 0);
		vy = 0;
		grounded = true;
		swimming = false;
		found = 0;
		started = null;
		finished = false;
		for (const f of flakes) {
			f.got = false;
			f.fade = 0;
			f.group.visible = true;
			f.group.scale.setScalar(1);
			f.mat.opacity = 1;
			f.glow.opacity = 0.8;
		}
		updateCount();
		ui.toast?.setAttribute('hidden', '');
	};
	ui.again?.addEventListener('click', () => {
		reset();
		ui.again?.blur();
	});

	/** Whether she can move her feet from where she is to (x, z). */
	const canGo = (x: number, z: number) => {
		const g = groundAt(x, z);
		if (Math.hypot(x, z) > 105) return false;
		// Swimming, she goes round the pier and anything else standing up out of the water.
		if (swimming) return g < 0.05;
		const step = Math.hypot(x - pos.x, z - pos.z);
		// On her feet she takes steps and gentle slopes in her stride; in the air she clears what's beneath her.
		return grounded ? g - pos.y <= 0.5 + step * 1.3 : g <= pos.y + 0.05;
	};
	const pushOut = (p: THREE.Vector3) => {
		for (const f of nearby(p.x, p.z)) {
			if (f.dome) continue;
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
		const moving = steer.lengthSq() > 0.01;
		if (moving && started === null) started = performance.now();

		const wading = grounded && pos.y < 0.05;
		const speed = swimming ? (running ? SWIM_FAST : SWIM) : (running ? RUN : WALK) * (wading ? 0.6 : 1);
		// In the water she glides, and in the air she can only steer a little.
		const control = grounded ? 10 : swimming ? 4 : 3;
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

		// She can jump from her feet, or spring up out of the water: high enough to reach the pier.
		if (jumpQueued && (grounded || swimming)) {
			if (swimming) ripple(pos.x, pos.z, 1.2);
			vy = JUMP_SPEED;
			grounded = false;
			swimming = false;
			jumped = true;
			airTime = 0;
			waving = 0;
		}
		jumpQueued = false;
		const ground = groundAt(pos.x, pos.z);
		const intoWater = () => {
			// The swimming clips float her with the water line at her origin, which lines her
			// shoulders up with where they were standing chest deep, so she needn't jump.
			swimming = true;
			grounded = false;
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
			vy -= GRAVITY * dt;
			pos.y += vy * dt;
			if (pos.y <= 0 && ground < SWIM_IN && vy <= 0) {
				pos.y = 0;
				intoWater();
			} else if (pos.y <= ground && vy <= 0) {
				pos.y = ground;
				grounded = true;
				vy = 0;
			}
		}
		if (pos.y < -4) reset();
		root.position.copy(pos);

		const planar = Math.hypot(vel.x, vel.z);
		if (planar > 0.2) heading = Math.atan2(vel.x, vel.z);
		turn += Math.atan2(Math.sin(heading - turn), Math.cos(heading - turn)) * (1 - Math.exp(-10 * dt));
		figure.group.rotation.y = turn;

		if (waveQueued && grounded) waving = 3.2;
		waveQueued = false;
		if (moving) waving = 0;
		waving = Math.max(0, waving - dt);
		let clip: NixClip = swimming ? (planar > 0.3 ? 'Swim' : 'Tread') : planar > 3 ? 'Run' : planar > 0.25 ? 'Walk' : 'Idle';
		if (waving > 0) clip = 'Wave';
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
		const flight = airborne ? { t: jumped ? clamp(airTime / FLIGHT, 0, 0.97) : clamp(0.5 + airTime, 0.5, 0.97), clip: 'JumpStand' as const } : null;
		return { flight, airborne, swimming };
	};

	const finish = () => {
		finished = true;
		waving = 4;
		const secs = started === null ? 0 : (performance.now() - started) / 1000;
		const time = secs >= 60 ? `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s` : `${Math.round(secs)}s`;
		if (ui.toastText) ui.toastText.textContent = `Nixchan found every snowflake in ${time}!`;
		ui.toast?.removeAttribute('hidden');
	};

	// ---------- the minimap ----------

	const MAP_SPAN = 75;
	const mapCtx = ui.map?.getContext('2d') ?? null;
	const mapImage = (() => {
		const size = 128;
		const c = document.createElement('canvas');
		c.width = c.height = size;
		const ctx = c.getContext('2d')!;
		const img = ctx.createImageData(size, size);
		for (let y = 0; y < size; y++)
			for (let x = 0; x < size; x++) {
				const wx = ((x + 0.5) / size - 0.5) * 2 * MAP_SPAN;
				const wz = ((y + 0.5) / size - 0.5) * 2 * MAP_SPAN;
				const h = Math.max(terrainAt(wx, wz), deckAt(wx, wz));
				const [r, g, b, a] = h < 0 ? (h > -1.2 ? [134, 227, 214, 200] : [58, 134, 208, 0]) : h < 1.5 ? [244, 226, 174, 255] : h > 14.5 ? [246, 245, 255, 255] : [136, 204, 115 - Math.min(h, 12) * 3, 255];
				img.data.set([r, g, b, a], (y * size + x) * 4);
			}
		ctx.putImageData(img, 0, 0);
		return c;
	})();
	const drawMap = () => {
		if (!mapCtx || !ui.map) return;
		const s = ui.map.width;
		const toMap = (v: number) => ((v / MAP_SPAN) * 0.5 + 0.5) * s;
		mapCtx.clearRect(0, 0, s, s);
		mapCtx.drawImage(mapImage, 0, 0, s, s);
		mapCtx.fillStyle = '#ffd84d';
		mapCtx.strokeStyle = '#2c2a52';
		mapCtx.lineWidth = 1.5;
		for (const f of flakes) {
			if (f.got) continue;
			mapCtx.beginPath();
			mapCtx.arc(toMap(f.home.x), toMap(f.home.z), 3.5, 0, TAU);
			mapCtx.fill();
			mapCtx.stroke();
		}
		mapCtx.save();
		mapCtx.translate(toMap(pos.x), toMap(pos.z));
		mapCtx.rotate(-turn);
		mapCtx.fillStyle = '#2c2a52';
		mapCtx.strokeStyle = '#ffffff';
		mapCtx.beginPath();
		mapCtx.moveTo(0, 7);
		mapCtx.lineTo(4.5, -4.5);
		mapCtx.lineTo(-4.5, -4.5);
		mapCtx.closePath();
		mapCtx.fill();
		mapCtx.stroke();
		mapCtx.restore();
	};

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
	};
	resize();
	addEventListener('resize', resize);

	const camLook = pos.clone();
	camLook.y += 1.2;
	const camPos = new THREE.Vector3();
	const orbitDir = new THREE.Vector3();
	const look = new THREE.Vector3();
	let time = 0;
	let last = performance.now();
	let mapClock = 0;

	renderer.setAnimationLoop((now) => {
		const dt = Math.min(0.05, (now - last) / 1000);
		last = now;
		time += dt;

		if (ready) {
			const { flight, airborne, swimming } = step(dt);
			// Dropping into the water isn't a landing, so no bending of the knees.
			figure.tick(dt, time, { airborne, look: zero, still: false, jump: flight, landed: !swimming });
			nextBlink -= dt;
			if (nextBlink < 0) {
				const closed = nextBlink > -0.13;
				figure.setBlink(closed);
				if (!closed) nextBlink = 2.5 + Math.random() * 3;
			}
		}

		// Snowflakes bob and spin, and burst when she touches one.
		const chest = look.set(pos.x, pos.y + 1, pos.z);
		for (const f of flakes) {
			if (f.got) {
				if (f.fade < 1) {
					f.fade = Math.min(1, f.fade + dt * 2.2);
					f.group.scale.setScalar(1 + f.fade * 1.4);
					f.group.position.y = f.home.y + f.fade * 1.5;
					f.mat.opacity = 1 - f.fade;
					f.glow.opacity = 0.8 * (1 - f.fade);
					if (f.fade === 1) f.group.visible = false;
				}
				continue;
			}
			f.group.position.y = f.home.y + Math.sin(time * 2 + f.phase) * 0.18;
			f.group.children[1].rotation.y = time * 1.6 + f.phase;
			if (ready && chest.distanceTo(f.group.position) < 1.3) {
				f.got = true;
				found++;
				updateCount();
				if (found === flakes.length && !finished) finish();
			}
		}

		// The camera swings round behind her, and never dips under the ground or the sea.
		camLook.x = damp(camLook.x, pos.x, 10, dt);
		camLook.y = damp(camLook.y, pos.y + 1.2, 6, dt);
		camLook.z = damp(camLook.z, pos.z, 10, dt);
		orbitDir.set(Math.sin(orbitYaw) * Math.cos(orbitPitch), Math.sin(orbitPitch), Math.cos(orbitYaw) * Math.cos(orbitPitch));
		camPos.copy(camLook).addScaledVector(orbitDir, orbitDistance);
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
		if (mapClock <= 0) {
			mapClock = 0.1;
			drawMap();
		}
		renderer.render(scene, camera);
	});
}
