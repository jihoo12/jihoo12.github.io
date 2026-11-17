// Cloudrest, a little island floating high over the coast past the summit, and the Windspout, a
// column of wind on the hillside below it that blows straight up. Opening her glider in the wind
// lifts Nixchan up past the island's edge, and from there she sails over onto its grass: blossom
// trees, an old ring of pillars round a sky-blue crystal, a pond that spills off the edge in a long
// waterfall, and a chest with sky shards in it (kept for a forge, one day).
//
// The island is a second floor over the heightfield, so the ground is no longer one height
// everywhere: here, under the island, it depends how high she is. `skyGround` is the island's grass
// for anyone standing on (or falling onto) it, and `skyCeiling` the rock over the head of anyone
// below it. Both are folded into `groundAt` and `ceilingAt` in features.ts.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Feature } from './features';
import type { Inventory } from './inventory';
import type { Offer } from './interact';
import { colored, glowTexture, type Toon } from './look';
import { loadJSON, saveJSON } from './save';
import { terrainAt } from './terrain';
import { TAU, clamp, damp, fbm, noise, smoothstep } from './util';

/** Where the island floats: its middle, the height of its grass, and its radius, give or take. */
export const SKY = { x: -27, z: -60, y: 40, r: 17 };
/** How far below the grass her feet can be and still count as up on the island (she lands on it
 * from up to this far under, and below that it's rock over her head). Wider than a step, so that
 * even a fast fall from above can't skip past it in one frame. */
export const STAND = 1.5;

/** The island's edge, how far out from its middle at angle `a`: ragged, but the same all the way round. */
function rimAt(a: number) {
	const c = Math.cos(a);
	const s = Math.sin(a);
	return SKY.r * (1 + 0.14 * noise(c * 1.3 + 4.1, s * 1.3 - 2.3) + 0.06 * noise(c * 3.7 - 1, s * 3.7 + 6));
}

/** How far out (x, z) is: 0 in the middle, 1 at the edge. */
function reach(x: number, z: number) {
	const dx = x - SKY.x;
	const dz = z - SKY.z;
	return Math.hypot(dx, dz) / rimAt(Math.atan2(dz, dx));
}

/** The knoll in the middle that the pillars stand on. */
const KNOLL = { x: SKY.x + 2, z: SKY.z - 1.5 };

function topAt(x: number, z: number, t: number) {
	const knoll = 1.6 * Math.exp(-((x - KNOLL.x) ** 2 + (z - KNOLL.z) ** 2) / 40);
	return SKY.y + 0.9 * (1 - t * t) + knoll + 0.35 * fbm(x * 0.12 + 3, z * 0.12 - 8, 2) - 0.8 * smoothstep(0.82, 1, t);
}

function underAt(x: number, z: number, t: number) {
	// Rounded under the edge, then down to a craggy point, ridged so it looks broken off the hills.
	const depth = 17 * Math.pow(Math.max(0, 1 - Math.pow(t, 1.5)), 0.85);
	const crag = 0.8 + 0.35 * noise(x * 0.16 + 9, z * 0.16) + 0.25 * Math.abs(noise(x * 0.45, z * 0.45 - 4));
	return SKY.y - 1.9 - depth * crag;
}

/** The height of the island's grass at (x, z), or null off its edge. */
export function skyTopAt(x: number, z: number) {
	const t = reach(x, z);
	return t < 1 ? topAt(x, z, t) : null;
}

/** The island's grass under her feet at (x, z), if she's up on it (or high enough to land on it). */
export function skyGround(x: number, z: number, y: number) {
	const t = reach(x, z);
	if (t >= 1) return -Infinity;
	const top = topAt(x, z, t);
	return y >= top - STAND ? top : -Infinity;
}

/** The underside of the island over her head at (x, z), if she's below it. */
export function skyCeiling(x: number, z: number, y: number) {
	const t = reach(x, z);
	if (t >= 1 || y >= topAt(x, z, t) - STAND) return Infinity;
	return underAt(x, z, t);
}

// ---------- the Windspout ----------

/** The column of wind: on the hillside towards the summit, just off the island's edge, at a spot
 * picked to be clear of the trees and rocks scattered there (scatter.ts), which would catch her glider. */
export const WINDSPOUT = (() => {
	const a = 1.77;
	const out = rimAt(a) + 6.5;
	const x = SKY.x + Math.cos(a) * out;
	const z = SKY.z + Math.sin(a) * out;
	return { x, z, r: 4.6, base: terrainAt(x, z), top: SKY.y + 6 };
})();
const RISE = 10;

/** How fast the wind would carry her glider up at (x, z, y): strongest in the middle of the column,
 * and dying away over the top of it so she comes out level, a little above the island. */
export function windLift(x: number, z: number, y: number) {
	const d = Math.hypot(x - WINDSPOUT.x, z - WINDSPOUT.z);
	if (d > WINDSPOUT.r || y < WINDSPOUT.base - 1) return 0;
	return RISE * smoothstep(WINDSPOUT.r, WINDSPOUT.r * 0.45, d) * smoothstep(WINDSPOUT.top + 3, WINDSPOUT.top - 4, y);
}

// ---------- building it ----------

export interface SkyIsleContext {
	scene: THREE.Scene;
	toon: Toon;
	inventory: Inventory;
	/** Where she is. */
	pos: THREE.Vector3;
	/** Puts something in the ground's grid (her path round a trunk, a step up onto stone). */
	addFeature: (f: Feature) => void;
	/** Where she starts, down on the beach, which the waterfall faces. */
	start: { x: number; z: number };
	toast: (text: string) => void;
}

const SHARD = 'sky-shard';
const SHARDS_IN_CHEST = 3;

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
	const darkStone = toon({ color: '#a29cc4' });
	const glowTex = glowTexture();
	const glowSprite = (scale: number, opacity: number, color: string) => {
		const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, depthWrite: false, opacity, blending: THREE.AdditiveBlending, fog: false }));
		s.scale.setScalar(scale);
		return s;
	};
	const ground = (x: number, z: number) => skyTopAt(x, z) ?? SKY.y;

	// ---------- the rock itself ----------

	// One faceted mesh, like the island below: rings out from the middle for the grass, the same
	// rings again for the rock underneath, and a band of cliff joining them round the edge.
	{
		const RINGS = 24;
		const SEGS = 84;
		const COLORS = {
			grass: new THREE.Color('#9ad67f'),
			grassLight: new THREE.Color('#a9df8a'),
			grassDark: new THREE.Color('#86c972'),
			dirt: new THREE.Color('#b9aa8a'),
			rock: [new THREE.Color('#a8a3c8'), new THREE.Color('#9890bb'), new THREE.Color('#b4aed0')],
			root: new THREE.Color('#9a8a73'),
		};
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
			const wrong = facing === 'up' ? n.y < 0 : facing === 'down' ? n.y > 0 : n.x * (cx - SKY.x) + n.z * (cz - SKY.z) < 0;
			const [a, b, c] = wrong ? [p, r, q] : [p, q, r];
			const ny = Math.abs(n.normalize().y);
			const col = color(ny, cy, cx, cz);
			for (const v of [a, b, c]) {
				positions.push(v.x, v.y, v.z);
				colors.push(col.r, col.g, col.b);
			}
		};
		const rim = Array.from({ length: SEGS }, (_, j) => rimAt((j / SEGS) * TAU));
		const point = (i: number, j: number, surface: 'top' | 'under') => {
			const a = ((j % SEGS) / SEGS) * TAU;
			const t = i / RINGS;
			const r = t * rim[j % SEGS] * 0.9999;
			const x = SKY.x + Math.cos(a) * r;
			const z = SKY.z + Math.sin(a) * r;
			return new THREE.Vector3(x, surface === 'top' ? topAt(x, z, t) : underAt(x, z, t), z);
		};
		const grassColor = (ny: number, _y: number, x: number, z: number) => {
			if (ny < 0.8) return COLORS.dirt;
			const k = noise(x * 0.15, z * 0.15);
			return k > 0.25 ? COLORS.grassLight : k < -0.3 ? COLORS.grassDark : COLORS.grass;
		};
		const rockColor = (_ny: number, y: number, x: number, z: number) => {
			// Strata: bands of stone by height, wavering a little, with earth and roots round the edge
			// just under the grass (by how far out, not how high, so its lower edge doesn't zigzag).
			if (reach(x, z) > 0.955) return COLORS.root;
			const band = Math.floor((SKY.y - y) / 2.4 + noise(x * 0.2, z * 0.2) * 0.6);
			return COLORS.rock[((band % 3) + 3) % 3];
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
		const rock = new THREE.Mesh(geo, toon({ vertexColors: true }));
		rock.castShadow = rock.receiveShadow = true;
		scene.add(rock);
	}

	// A few lumps of rock drifting round the island, bobbing gently, as if broken off it.
	{
		const lump = new THREE.DodecahedronGeometry(1, 0);
		[
			{ a: 0.6, out: 1.45, y: -4, s: 1.6 },
			{ a: 2.3, out: 1.35, y: -9, s: 1.1 },
			{ a: 3.9, out: 1.55, y: -2, s: 2.1 },
			{ a: 5.2, out: 1.3, y: -12, s: 0.9 },
		].forEach(({ a, out, y, s }, i) => {
			const r = rimAt(a) * out;
			const m = mesh(lump, i % 2 ? darkStone : stone, SKY.x + Math.cos(a) * r, SKY.y + y, SKY.z + Math.sin(a) * r);
			m.scale.set(s, s * 0.8, s);
			// A tuft of grass on top of the bigger ones.
			if (s > 1.4) m.add(mesh(colored(new THREE.IcosahedronGeometry(0.75, 0), '#9ad67f'), toon({ vertexColors: true }), 0, 0.7, 0));
			scene.add(m);
			const at = m.position.clone();
			ticks.push((time) => {
				m.position.y = at.y + Math.sin(time * 0.6 + i * 1.7) * 0.5;
				m.rotation.y = time * 0.05 * (i % 2 ? 1 : -1) + i;
			});
		});
	}

	// ---------- on top ----------

	// Blossom trees: round trees like the ones below, but pink.
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
		const mat = toon({ vertexColors: true });
		for (const [a, t, s] of [
			[0.4, 0.62, 1.05],
			[1.5, 0.55, 0.9],
			[2.6, 0.66, 1.15],
			[3.5, 0.5, 0.85],
			[4.7, 0.64, 1.0],
		]) {
			const r = rimAt(a) * t;
			const x = SKY.x + Math.cos(a) * r;
			const z = SKY.z + Math.sin(a) * r;
			const g = ground(x, z) - 0.1;
			const tree = mesh(geo, mat, x, g, z);
			tree.scale.setScalar(s);
			tree.rotation.y = a * 3;
			scene.add(tree);
			ctx.addFeature({ x, z, r: 0.4 * s, floor: g, top: g + 3.6 * s, crown: { x, y: g + 3.6 * s, z, r: 1.7 * s } });
		}
		// Petals drifting down round them.
		const PETALS = 70;
		const petalGeo = new THREE.PlaneGeometry(0.16, 0.12);
		const petals = new THREE.InstancedMesh(petalGeo, new THREE.MeshBasicMaterial({ color: '#ffc0d8', side: THREE.DoubleSide }), PETALS);
		const seeds = Array.from({ length: PETALS }, (_, i) => ({ a: (i * 2.399) % TAU, r: 2 + ((i * 7.31) % 1) * SKY.r * 0.9, phase: (i * 0.618) % 1, spin: 1 + (i % 5) }));
		const m4 = new THREE.Matrix4();
		const q = new THREE.Quaternion();
		const e = new THREE.Euler();
		const v = new THREE.Vector3();
		const one = new THREE.Vector3(1, 1, 1);
		scene.add(petals);
		ticks.push((time) => {
			seeds.forEach((p, i) => {
				const life = (time * 0.08 + p.phase) % 1;
				const x = SKY.x + Math.cos(p.a + life) * p.r;
				const z = SKY.z + Math.sin(p.a + life) * p.r;
				v.set(x + Math.sin(time + i) * 0.4, ground(x, z) + 5 - life * 5.2, z);
				q.setFromEuler(e.set(time * p.spin, time * 0.7 * p.spin, i));
				petals.setMatrixAt(i, m4.compose(v, q, one));
			});
			petals.instanceMatrix.needsUpdate = true;
		});
	}

	// The ring of old pillars on the knoll, some fallen short, round a crystal like the one at the
	// standing stones below, and the chest on the step in front of it.
	const chest = { x: 0, z: 0, y: 0 };
	{
		const g = ground(KNOLL.x, KNOLL.z);
		const floor = g + 0.35;
		const base = mesh(new THREE.CylinderGeometry(3.2, 3.5, 1.4, 10), stone, KNOLL.x, floor - 0.7, KNOLL.z);
		scene.add(base);
		ctx.addFeature({ x: KNOLL.x, z: KNOLL.z, r: 3.25, floor: g, pad: floor });
		const heights = [3.6, 2.2, 3.9, 1.3, 3.4, 3.8, 0.9];
		heights.forEach((h, i) => {
			const a = (i / heights.length) * TAU + 0.3;
			const x = KNOLL.x + Math.cos(a) * 5.4;
			const z = KNOLL.z + Math.sin(a) * 5.4;
			const pg = ground(x, z) - 0.2;
			const pillar = mesh(new THREE.CylinderGeometry(0.42, 0.5, h, 8), i % 3 ? stone : darkStone, x, pg + h / 2, z);
			pillar.rotation.z = (i % 2 ? 1 : -1) * 0.04;
			scene.add(pillar);
			if (h > 3) scene.add(mesh(new THREE.BoxGeometry(1.25, 0.3, 1.25), stone, x, pg + h + 0.15, z));
			ctx.addFeature({ x, z, r: 0.55, floor: pg, top: pg + h + 0.3 });
		});
		const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.6, 0), new THREE.MeshBasicMaterial({ color: '#9fe3ff' }));
		crystal.scale.y = 1.5;
		const halo = glowSprite(4.2, 0.65, '#9fe3ff');
		scene.add(crystal, halo);
		ticks.push((time) => {
			crystal.position.set(KNOLL.x, floor + 2.6 + Math.sin(time * 1.2) * 0.2, KNOLL.z);
			crystal.rotation.y = time * 0.8;
			halo.position.copy(crystal.position);
			halo.material.opacity = 0.55 + 0.15 * Math.sin(time * 2.1);
		});

		// The chest, on the platform a step in from its edge, facing out the way she'll come up.
		const facing = Math.atan2(WINDSPOUT.x - KNOLL.x, WINDSPOUT.z - KNOLL.z);
		chest.x = KNOLL.x + Math.sin(facing) * 1.9;
		chest.z = KNOLL.z + Math.cos(facing) * 1.9;
		chest.y = floor;
	}

	let opened = loadJSON('skyChest') === true;
	{
		const group = new THREE.Group();
		group.position.set(chest.x, chest.y - 0.02, chest.z);
		group.rotation.y = Math.atan2(WINDSPOUT.x - KNOLL.x, WINDSPOUT.z - KNOLL.z);
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
			// It glimmers until it's opened, then shines for a moment, then settles.
			glow.material.opacity = opened ? open * 0.3 : 0.25 + 0.2 * Math.sin(time * 3);
		});
	}

	// A pond near the edge, spilling over it in a waterfall that falls away into spray. It faces the
	// beach she starts on, so it's what catches her eye from down there.
	{
		const a = Math.atan2(ctx.start.z - SKY.z, ctx.start.x - SKY.x);
		const R = rimAt(a);
		const pond = { x: SKY.x + Math.cos(a) * R * 0.66, z: SKY.z + Math.sin(a) * R * 0.66, r: 2.3 };
		let level = -Infinity;
		for (let k = 0; k < 12; k++) {
			const b = (k / 12) * TAU;
			level = Math.max(level, ground(pond.x + Math.cos(b) * pond.r, pond.z + Math.sin(b) * pond.r));
		}
		level = Math.max(level, ground(pond.x, pond.z)) + 0.06;
		const waterMat = toon({ color: '#7fd3ec', transparent: true, opacity: 0.9 });
		scene.add(mesh(new THREE.CircleGeometry(pond.r, 20).rotateX(-Math.PI / 2), waterMat, pond.x, level, pond.z));
		// A ring of stones holding it in.
		for (let k = 0; k < 11; k++) {
			const b = (k / 11) * TAU;
			const s = mesh(new THREE.DodecahedronGeometry(0.42, 0), stone, pond.x + Math.cos(b) * (pond.r + 0.2), level - 0.1, pond.z + Math.sin(b) * (pond.r + 0.2));
			s.rotation.set(k, k * 2, 0);
			if (k !== 0) scene.add(s);
		}
		// The stream from the pond to the edge: a ribbon laid on the grass, gap in the stones at k = 0.
		const from = new THREE.Vector2(pond.x + Math.cos(a) * pond.r, pond.z + Math.sin(a) * pond.r);
		const lipR = R * 0.995;
		const lip = new THREE.Vector2(SKY.x + Math.cos(a) * lipR, SKY.z + Math.sin(a) * lipR);
		const flowMat = streakMaterial('#dff6ff', 0.85, { flow: 1.6, stretch: 3, across: 5, twist: 0, fadeIn: 0.15, fadeOut: 0, body: 0.45 });
		const side = new THREE.Vector2(-Math.sin(a), Math.cos(a));
		/** A strip through `pts`, `width(s)` either side of them across the stream (s runs 0 … 1 along it). */
		const ribbon = (pts: THREE.Vector3[], width: (s: number) => number) => {
			const p: number[] = [];
			const uv: number[] = [];
			const idx: number[] = [];
			pts.forEach((c, i) => {
				const w = width(i / (pts.length - 1));
				p.push(c.x - side.x * w, c.y, c.z - side.y * w, c.x + side.x * w, c.y, c.z + side.y * w);
				const v = i / (pts.length - 1);
				uv.push(0, v, 1, v);
				if (i > 0) idx.push((i - 1) * 2, (i - 1) * 2 + 1, i * 2, (i - 1) * 2 + 1, i * 2 + 1, i * 2);
			});
			const g = new THREE.BufferGeometry();
			g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
			g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
			g.setIndex(idx);
			return g;
		};
		const streamPts: THREE.Vector3[] = [];
		for (let k = 0; k <= 10; k++) {
			const s = k / 10;
			const x = THREE.MathUtils.lerp(from.x, lip.x, s);
			const z = THREE.MathUtils.lerp(from.y, lip.y, s);
			streamPts.push(new THREE.Vector3(x, Math.min(level, ground(x, z) + 0.07), z));
		}
		const stream = new THREE.Mesh(ribbon(streamPts, () => 0.55), flowMat);
		stream.renderOrder = 1;
		scene.add(stream);
		// The fall: out over the edge and down, widening as it goes, until it's all spray.
		const FALL = 30;
		const top = streamPts[streamPts.length - 1];
		const fallPts: THREE.Vector3[] = [];
		for (let k = 0; k <= 30; k++) {
			const s = (k / 30) * FALL;
			const outward = 0.4 + Math.sqrt(s) * 0.9;
			fallPts.push(new THREE.Vector3(top.x + Math.cos(a) * outward, top.y - s, top.z + Math.sin(a) * outward));
		}
		// The same strip, hung from the lip: still across the stream, so it falls as a sheet.
		const fallMat = streakMaterial('#e8f8ff', 0.8, { flow: 2.2, stretch: 6, across: 7, twist: 0, fadeIn: 0, fadeOut: 0.55, body: 0.6 });
		const fall = new THREE.Mesh(ribbon(fallPts, (s) => 0.7 + s * 2.2), fallMat);
		fall.renderOrder = 1;
		scene.add(fall);
		const spray = glowSprite(6, 0.2, '#ffffff');
		spray.position.copy(fallPts[fallPts.length - 8]);
		const lipSpray = glowSprite(2.2, 0.5, '#ffffff');
		lipSpray.position.copy(fallPts[2]);
		scene.add(spray, lipSpray);
		ticks.push((time) => {
			flowMat.uniforms.uTime.value = time;
			fallMat.uniforms.uTime.value = time;
			spray.material.opacity = 0.18 + 0.04 * Math.sin(time * 1.7);
		});
	}

	// ---------- the Windspout ----------

	{
		const { x, z, r, base, top } = WINDSPOUT;
		const h = top - base + 2;
		const group = new THREE.Group();
		group.position.set(x, base - 1, z);
		scene.add(group);
		// Two open tubes of streaks winding upwards, the inner one quicker.
		const mats = [
			streakMaterial('#ffffff', 0.4, { additive: true, flow: 0.9, stretch: 5, across: 36, twist: 2, fadeIn: 0.15, fadeOut: 0.3, body: 0.04 }),
			streakMaterial('#e6f6ff', 0.35, { additive: true, flow: 1.5, stretch: 7, across: 24, twist: -3, fadeIn: 0.15, fadeOut: 0.3, body: 0.03 }),
		];
		[r * 0.95, r * 0.55].forEach((radius, i) => {
			const tube = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.85, h, 28, 1, true).translate(0, h / 2, 0), mats[i]);
			tube.renderOrder = 2;
			group.add(tube);
		});
		// Leaves whirling up through it.
		const LEAVES = 36;
		const leaves = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.22, 0.14), new THREE.MeshBasicMaterial({ color: '#9ad67f', side: THREE.DoubleSide }), LEAVES);
		const tints = ['#9ad67f', '#ffd84d', '#78bf68', '#ffb3d1'];
		const c = new THREE.Color();
		for (let i = 0; i < LEAVES; i++) leaves.setColorAt(i, c.set(tints[i % tints.length]));
		group.add(leaves);
		const m4 = new THREE.Matrix4();
		const q = new THREE.Quaternion();
		const e = new THREE.Euler();
		const v = new THREE.Vector3();
		const one = new THREE.Vector3(1, 1, 1);
		// A swirl of dust round its foot.
		const swirl = new THREE.Mesh(
			new THREE.RingGeometry(r * 0.4, r * 1.05, 32, 1).rotateX(-Math.PI / 2),
			streakMaterial('#fff6d8', 0.25, { additive: true, flow: 0.6, stretch: 1, across: 12, twist: 3, fadeIn: 0, fadeOut: 0, body: 0.1 }),
		);
		swirl.position.y = 1.15;
		group.add(swirl);
		ticks.push((time) => {
			for (const mat of mats) mat.uniforms.uTime.value = time;
			(swirl.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
			swirl.rotation.y = time * 1.2;
			for (let i = 0; i < LEAVES; i++) {
				const life = (time * 0.13 + i / LEAVES) % 1;
				const a = i * 2.4 + time * (1.4 + (i % 3) * 0.3);
				const rr = r * (0.3 + 0.5 * ((i * 0.37) % 1));
				v.set(Math.cos(a) * rr, 1 + life * h * 0.95, Math.sin(a) * rr);
				q.setFromEuler(e.set(time * 3 + i, time * 2 + i * 0.5, i));
				const s = clamp(Math.min(life * 8, (1 - life) * 8), 0, 1);
				leaves.setMatrixAt(i, m4.compose(v, q, one.set(s, s, s)));
			}
			leaves.instanceMatrix.needsUpdate = true;
		});
	}

	// ---------- the sky shards ----------

	ctx.inventory.register({
		id: SHARD,
		name: 'Sky Shard',
		kind: 'material',
		description: "A sliver of sky-blue crystal from the chest on Cloudrest, cool to the touch and humming faintly. Someone handy with a forge could make something of it.",
		color: '#9fe3ff',
	});

	const up = () => ctx.pos.y > SKY.y - 3;
	return {
		/** E by the chest, up on the island. */
		offer: (): Offer | null => {
			if (opened || !up() || Math.hypot(ctx.pos.x - chest.x, ctx.pos.z - chest.z) > 2.2) return null;
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
		/** Whether she's up on the island (where there's no fishing: the sea's too far down). */
		get aboard() {
			return up();
		},
		update(time: number, dt: number) {
			for (const tick of ticks) tick(time, dt);
		},
	};
}
