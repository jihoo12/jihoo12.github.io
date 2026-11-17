// Nixchan's garden: twelve plots of soil by the beach, a water barrel and a market stand. Seeds
// bought at the stand go in the bag; standing on a plot, E plants one, waters it, and when it's ripe
// harvests it. A crop grows a stage at a time (seed, sprout, leaves, ripe), each stage only while
// the soil is wet, so it wants watering again after each one. It grows by the clock, so the garden
// carries on while the page is closed. Crops and fish sell at the stand for coins, which buy more
// seeds. The crops, the stand, the barrel and the can are Blender models (tools/island-farm).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { NixClip, NixFigure } from '../experimental/nix-figure';
import type { Inventory } from './inventory';
import type { Offer } from './interact';
import type { Toon } from './look';
import { loadJSON, saveJSON } from './save';
import { thumbnail } from './thumbnail';
import { clamp, damp } from './util';

interface Crop {
	id: string;
	name: string;
	/** The models: its leaves as it grows, and the crop itself. */
	leaves: string;
	item: string;
	/** Minutes a stage takes, once watered. */
	minutes: number;
	/** How many a harvest gives, and whether the plant stays to fruit again. */
	yield: number;
	regrow?: boolean;
	cost: number;
	sell: number;
	color: string;
	about: string;
	eat: string;
}

export const CROPS: Crop[] = [
	{ id: 'turnip', name: 'Turnip', leaves: 'TurnipLeaves', item: 'Turnip', minutes: 1, yield: 1, cost: 10, sell: 25, color: '#c98ad0', about: 'Quick to grow and hard to get wrong. A good first crop.', eat: 'Crunchy, and a bit peppery.' },
	{ id: 'carrot', name: 'Carrot', leaves: 'CarrotLeaves', item: 'Carrot', minutes: 2, yield: 1, cost: 20, sell: 50, color: '#f28c3a', about: 'Sweet and bright orange, from feathery leaves.', eat: 'Sweet and crunchy!' },
	{ id: 'strawberry', name: 'Strawberry', leaves: 'StrawberryBush', item: 'Strawberry', minutes: 3, yield: 3, regrow: true, cost: 40, sell: 30, color: '#ef4a5c', about: 'A little bush that fruits again and again after its first harvest.', eat: 'So sweet!' },
	{ id: 'pumpkin', name: 'Pumpkin', leaves: 'PumpkinVine', item: 'Pumpkin', minutes: 4, yield: 1, cost: 80, sell: 240, color: '#f29a3a', about: 'Takes its time, but grows into a whopper worth a lot at the stand.', eat: 'Too big to eat in one go… but she tries.' },
];

const ROWS = 3;
const COLS = 4;
const PLOT = 1.5;
const GAP = 1.95;
/** How many waterings the can holds, until it's made sturdier at the forge. */
const CAN_HOLDS = 5;
/** The crops are modelled true to size; grown up a bit, they read better from where the camera is. */
const PLANT_SCALE = 1.7;

interface Plot {
	crop: string | null;
	/** 0 seed, 1 sprout, 2 leaves, 3 ripe. */
	stage: number;
	wet: boolean;
	/** When it was last watered (ms since the epoch). */
	since: number;
}
interface Saved {
	plots: Plot[];
	water: number;
	coins: number;
	gifted: boolean;
	seed: string | null;
}

export interface FarmContext {
	renderer: THREE.WebGLRenderer;
	scene: THREE.Scene;
	figure: NixFigure;
	toon: Toon;
	inventory: Inventory;
	modelUrl: string;
	/** The middle of the garden, and the way its front (where the plots face the beach) points. */
	centre: { x: number; z: number };
	angle: number;
	groundAt: (x: number, z: number) => number;
	addFeature: (f: { x: number; z: number; r: number }) => void;
	/** How many waterings the can holds now (more once it's upgraded at the forge). */
	canHolds?: () => number;
	pos: THREE.Vector3;
	/** The way that would face her to the camera, to show off a harvest. */
	towardCamera: () => number;
	/** Whether she's free to garden: on her feet, not fishing, no menu open. */
	canAct: () => boolean;
	toast: (text: string) => void;
	/** Who keeps the stand: talking to them is how she gets to the market (without, it just opens). */
	keeper?: { name: string; talk: () => void };
	/** Something bought or sold at the stand. */
	onTrade?: () => void;
}


export function createFarm(ctx: FarmContext) {
	const holds = () => ctx.canHolds?.() ?? CAN_HOLDS;
	const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel);
	const ui = {
		shop: $('[data-shop]'),
		coins: $('[data-coins]'),
		buy: $('[data-shop-buy]'),
		sell: $('[data-shop-sell]'),
		close: $<HTMLButtonElement>('[data-shop-close]'),
	};

	// ---------- what's growing, remembered ----------

	const fresh = (): Saved => ({ plots: Array.from({ length: ROWS * COLS }, () => ({ crop: null, stage: 0, wet: false, since: 0 })), water: 0, coins: 0, gifted: false, seed: null });
	const state: Saved = (() => {
		try {
			const saved = (loadJSON('garden') ?? null) as Partial<Saved> | null;
			const s = fresh();
			if (saved && Array.isArray(saved.plots))
				saved.plots.slice(0, s.plots.length).forEach((p, i) => {
					if (p && (p.crop === null || CROPS.some((c) => c.id === p.crop))) s.plots[i] = { crop: p.crop, stage: clamp(Math.floor(p.stage) || 0, 0, 3), wet: !!p.wet, since: Number(p.since) || 0 };
				});
			if (saved) {
				s.water = clamp(Number(saved.water) || 0, 0, holds());
				s.coins = Math.max(0, Math.floor(Number(saved.coins) || 0));
				s.gifted = !!saved.gifted;
				s.seed = typeof saved.seed === 'string' ? saved.seed : null;
			}
			return s;
		} catch {
			return fresh();
		}
	})();
	const save = () => saveJSON('garden', state);
	const crop = (id: string | null) => CROPS.find((c) => c.id === id);
	const stageMs = (c: Crop) => c.minutes * 60_000;

	// ---------- the garden's layout ----------

	const cos = Math.cos(ctx.angle);
	const sin = Math.sin(ctx.angle);
	/** Garden coordinates (x across, z towards the front) to the world's. */
	const world = (lx: number, lz: number) => ({ x: ctx.centre.x + lx * cos + lz * sin, z: ctx.centre.z - lx * sin + lz * cos });
	const plotAt = (i: number) => world((-(COLS - 1) / 2 + (i % COLS)) * GAP, (-(ROWS - 1) / 2 + Math.floor(i / COLS)) * GAP + 0.6);
	const BARREL = world(-5.2, 2.6);
	const STALL = world(0, -4.4);
	const STALL_FRONT = world(0, -3.2);
	ctx.addFeature({ x: BARREL.x, z: BARREL.z, r: 0.5 });
	for (const lx of [-0.9, 0, 0.9]) {
		const p = world(lx, -4.4);
		ctx.addFeature({ x: p.x, z: p.z, r: 0.6 });
	}

	// ---------- the models ----------

	const models = new Map<string, THREE.Object3D>();
	const ink = new THREE.MeshBasicMaterial({ color: '#1d1b3a', side: THREE.BackSide });
	ink.onBeforeCompile = (shader) => {
		shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normal * 0.012;');
	};
	const toonCache = new Map<string, THREE.Material>();
	/** A copy of one of the garden's models, in toon materials of its own colours (or `tint` for the packet's paper). */
	const make = (name: string, { tint, inked = false }: { tint?: string; inked?: boolean } = {}) => {
		const source = models.get(name);
		if (!source) return null;
		const copy = source.clone(true);
		copy.position.set(0, 0, 0);
		// Gathered first, since inking adds meshes of its own.
		const meshes: THREE.Mesh[] = [];
		copy.traverse((o) => o instanceof THREE.Mesh && meshes.push(o));
		for (const o of meshes) {
			const placeholder = o.material as THREE.MeshStandardMaterial;
			const color = tint && placeholder.name === 'Packet' ? tint : `#${placeholder.color.getHexString()}`;
			let mat = toonCache.get(color);
			if (!mat) toonCache.set(color, (mat = ctx.toon({ color, side: THREE.DoubleSide })));
			o.material = mat;
			o.castShadow = true;
			o.receiveShadow = true;
			if (inked) o.add(new THREE.Mesh(o.geometry, ink));
		}
		return copy;
	};

	const icons = new Map<string, string>();
	const iconOf = (key: string, build: () => THREE.Object3D | null, from: THREE.Vector3) => {
		const cached = icons.get(key);
		if (cached) return cached;
		const object = build();
		if (!object) return null;
		const url = thumbnail(ctx.renderer, object, from);
		icons.set(key, url);
		return url;
	};
	const seedPacket = (c: Crop) => {
		const packet = make('Packet', { tint: c.color });
		const item = make(c.item);
		if (!packet || !item) return null;
		const group = new THREE.Group();
		item.scale.setScalar(c.id === 'pumpkin' ? 0.16 : c.id === 'strawberry' ? 0.9 : 0.4);
		item.position.set(0, 0.075, 0.03);
		group.add(packet, item);
		return group;
	};

	// ---------- the bag's garden things ----------

	const inv = ctx.inventory;
	inv.register({
		id: 'tool-can',
		name: 'Watering can',
		kind: 'tool',
		description: 'For watering the garden. Fill it at the barrel there; the label on E says how much is left.',
		color: '#5fb0e8',
		icon: () => iconOf('can', () => make('Can'), new THREE.Vector3(1, 0.4, 0.6)),
	});
	for (const c of CROPS) {
		inv.register({
			id: `seed-${c.id}`,
			name: `${c.name} seeds`,
			kind: 'seed',
			description: `${c.about} Each stage takes about ${c.minutes} min once watered.`,
			color: c.color,
			icon: () => iconOf(`seed-${c.id}`, () => seedPacket(c), new THREE.Vector3(0.25, 0.15, 1)),
			actions: [
				{
					label: 'Plant these next',
					run: () => {
						state.seed = c.id;
						save();
						ctx.toast(`${c.name} seeds at the ready.`);
					},
				},
			],
		});
		inv.register({
			id: `crop-${c.id}`,
			name: c.name,
			kind: 'crop',
			description: c.about,
			color: c.color,
			sell: c.sell,
			icon: () => iconOf(`crop-${c.id}`, () => make(c.item), new THREE.Vector3(0.5, 0.35, 1)),
			actions: [
				{
					label: 'Eat one',
					run: (id) => {
						if (inv.remove(id)) ctx.toast(c.eat);
					},
				},
			],
		});
	}

	// ---------- the plots ----------

	const garden = new THREE.Group();
	ctx.scene.add(garden);
	const dry = new THREE.Color('#b8936a');
	const wet = new THREE.Color('#7d5c40');
	const soilGeo = new THREE.BoxGeometry(PLOT, 0.24, PLOT);
	const holeGeo = new THREE.CircleGeometry(0.17, 14).rotateX(-Math.PI / 2);
	const holeMat = new THREE.MeshBasicMaterial({ color: '#4e3424' });
	const moundGeo = new THREE.SphereGeometry(0.16, 10, 6);
	moundGeo.scale(1, 0.4, 1);
	const plots = state.plots.map((_, i) => {
		const { x, z } = plotAt(i);
		const g = ctx.groundAt(x, z);
		const mat = ctx.toon({ color: dry });
		const soil = new THREE.Mesh(soilGeo, mat);
		soil.position.set(x, g + 0.02, z);
		soil.rotation.y = ctx.angle;
		soil.receiveShadow = true;
		const plant = new THREE.Group();
		plant.position.set(x, g + 0.14, z);
		plant.rotation.y = ctx.angle + i * 1.7;
		// The hole she digs to plant a seed in.
		const hole = new THREE.Mesh(holeGeo, holeMat);
		hole.position.set(x, g + 0.145, z);
		hole.visible = false;
		garden.add(soil, plant, hole);
		return { x, z, mat, plant, hole, shown: '', wetMix: state.plots[i].wet ? 1 : 0, rise: 1 };
	});
	const moundMat = ctx.toon({ color: '#8a6446' });
	const mound = () => {
		const m = new THREE.Mesh(moundGeo, moundMat);
		m.castShadow = true;
		return m;
	};

	/** Put each plot's plant in the shape its stage calls for. */
	const drawPlot = (i: number) => {
		const p = state.plots[i];
		const view = plots[i];
		const c = crop(p.crop);
		const key = c ? `${c.id}:${p.stage}:${models.size > 0}` : 'empty';
		if (view.shown === key) return;
		view.shown = key;
		view.plant.clear();
		if (!c) return;
		if (p.stage === 0) {
			view.plant.add(mound());
		} else if (p.stage === 1) {
			view.plant.add(make('Sprout') ?? mound());
		} else {
			const leaves = make(c.leaves);
			if (leaves) {
				leaves.scale.setScalar(p.stage === 2 ? 0.6 : 1);
				view.plant.add(leaves);
			}
			if (p.stage === 3) {
				const add = (x: number, y: number, z: number, s = 1) => {
					const item = make(c.item, { inked: true });
					if (!item) return;
					item.position.set(x, y, z);
					item.scale.setScalar(s);
					view.plant.add(item);
				};
				if (c.id === 'turnip') add(0, -0.1, 0);
				else if (c.id === 'carrot') add(0, 0.02, 0, 1.1);
				else if (c.id === 'strawberry') for (let k = 0; k < 3; k++) add(Math.cos(k * 2.1) * 0.15, 0.06, Math.sin(k * 2.1) * 0.15);
				else add(0.18, -0.05, 0.12, 0.9);
			}
		}
	};

	/** Move each watered plant on a stage if it's had long enough; the soil dries out as it does. */
	const grow = () => {
		const now = Date.now();
		let changed = false;
		state.plots.forEach((p, i) => {
			const c = crop(p.crop);
			if (c && p.stage < 3 && p.wet && now - p.since >= stageMs(c)) {
				p.stage++;
				p.wet = false;
				changed = true;
			}
			drawPlot(i);
		});
		if (changed) save();
	};

	// ---------- the stand and the barrel ----------

	const fixtures = new THREE.Group();
	ctx.scene.add(fixtures);
	const placeFixtures = () => {
		fixtures.clear();
		const stall = make('Stall');
		if (stall) {
			stall.position.set(STALL.x, ctx.groundAt(STALL.x, STALL.z) - 0.05, STALL.z);
			// Its counter faces the plots.
			stall.rotation.y = ctx.angle;
			fixtures.add(stall);
		}
		const barrel = make('Barrel');
		if (barrel) {
			barrel.position.set(BARREL.x, ctx.groundAt(BARREL.x, BARREL.z) - 0.05, BARREL.z);
			fixtures.add(barrel);
		}
	};

	new GLTFLoader().loadAsync(ctx.modelUrl).then(
		(gltf) => {
			for (const child of [...gltf.scene.children]) models.set(child.name, child);
			placeFixtures();
			grow();
			inv.render();
			renderShop();
		},
		() => {
			// No models: the soil still shows, and crops still grow.
		},
	);
	grow();

	// ---------- water, dirt and dust ----------

	// Little bits flung about by the garden work: drops of water from the can (which splash where
	// they land), clods of dirt dug out of a hole, and puffs of dust as she pats it down.
	type BitKind = 'water' | 'splash' | 'dirt' | 'dust';
	const bitMats: Record<BitKind, THREE.Material> = {
		water: new THREE.MeshBasicMaterial({ color: '#8fd3f4' }),
		splash: new THREE.MeshBasicMaterial({ color: '#c4ecff' }),
		dirt: ctx.toon({ color: '#7a5236' }),
		dust: new THREE.MeshBasicMaterial({ color: '#e3cfae', transparent: true, opacity: 0.8 }),
	};
	const bitGeo = new THREE.IcosahedronGeometry(1, 0);
	const bits = Array.from({ length: 120 }, () => {
		const m = new THREE.Mesh(bitGeo, bitMats.water);
		m.visible = false;
		ctx.scene.add(m);
		return { m, v: new THREE.Vector3(), life: 0, age: 0, size: 0, kind: 'water' as BitKind };
	});
	let nextBit = 0;
	const spawn = (kind: BitKind, at: THREE.Vector3, v: THREE.Vector3, life: number, size: number) => {
		const b = bits[nextBit];
		nextBit = (nextBit + 1) % bits.length;
		b.kind = kind;
		b.m.material = bitMats[kind];
		b.m.position.copy(at);
		b.m.rotation.set(Math.random() * 6, Math.random() * 6, 0);
		b.v.copy(v);
		b.life = life;
		b.age = 0;
		b.size = size;
		b.m.scale.setScalar(size);
		b.m.visible = true;
	};
	const tmp = new THREE.Vector3();
	const vel = new THREE.Vector3();
	const updateBits = (dt: number) => {
		for (const b of bits) {
			if (!b.m.visible) continue;
			b.age += dt;
			const gravity = b.kind === 'dust' ? -0.6 : 9.8;
			b.v.y -= gravity * dt;
			if (b.kind === 'dust') b.v.multiplyScalar(1 - 2.5 * dt);
			b.m.position.addScaledVector(b.v, dt);
			const ground = ctx.groundAt(b.m.position.x, b.m.position.z) + 0.15;
			if (b.kind === 'dust') b.m.scale.setScalar(b.size * (1 + b.age * 2.5));
			if (b.m.position.y < ground && b.v.y < 0) {
				if (b.kind === 'water') {
					// A drop lands: a couple of tiny splashes bounce up off the soil.
					for (let k = 0; k < 2; k++)
						spawn('splash', b.m.position.setY(ground), vel.set((Math.random() - 0.5) * 1.2, 0.8 + Math.random() * 0.8, (Math.random() - 0.5) * 1.2), 0.25, 0.018);
					b.m.visible = false;
					continue;
				}
				if (b.kind === 'dirt') {
					// Clods come to rest on the soil and crumble away.
					b.m.position.y = ground;
					b.v.set(0, 0, 0);
				}
			}
			if (b.kind === 'dirt' && b.v.lengthSq() === 0) b.m.scale.setScalar(b.size * clamp(b.life / 0.4, 0, 1));
			b.life -= dt;
			if (b.life <= 0) b.m.visible = false;
		}
	};

	// ---------- what she can do here ----------

	interface Job {
		clip: NixClip;
		seconds: number;
		face: number;
		/** Each frame, with how far through it is (0 → 1). */
		tick?: (u: number, dt: number) => void;
		done: () => void;
		prop?: 'Can';
		show?: THREE.Object3D;
	}
	let job: Job | null = null;
	let jobAt = 0;
	/** Stepping over to where she'll work from, before the job itself. */
	let walk: { fx: number; fz: number; tx: number; tz: number; seconds: number; at: number; then: () => Job } | null = null;
	let shopOpen = false;
	const faceTo = (x: number, z: number) => Math.atan2(x - ctx.pos.x, z - ctx.pos.z);
	const fmt = (ms: number) => {
		const s = Math.max(1, Math.ceil(ms / 1000));
		return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
	};
	const heldSeed = () => {
		if (state.seed && inv.count(`seed-${state.seed}`) > 0) return crop(state.seed)!;
		return CROPS.find((c) => inv.count(`seed-${c.id}`) > 0) ?? null;
	};
	const begin = (j: Job) => {
		job = j;
		jobAt = performance.now();
	};
	/** A job facing (x, z), started where she stands. */
	const act = (clip: NixClip, seconds: number, x: number, z: number, done: () => void) => begin({ clip, seconds, face: faceTo(x, z), done });
	/** A job on plot i: she steps onto the near side of it first (close enough to reach its middle,
	 * and still standing on it, so it's the plot she's at when she's done), and turns to face the middle. */
	const atPlot = (i: number, make: (face: number) => Job) => {
		const view = plots[i];
		let dx = ctx.pos.x - view.x;
		let dz = ctx.pos.z - view.z;
		const d = Math.hypot(dx, dz);
		if (d < 0.05) {
			// Right in the middle: work from the front side, nearest the beach.
			dx = sin;
			dz = cos;
		} else {
			dx /= d;
			dz /= d;
		}
		const tx = view.x + dx * 0.45;
		const tz = view.z + dz * 0.45;
		const then = () => make(Math.atan2(view.x - tx, view.z - tz));
		const far = Math.hypot(tx - ctx.pos.x, tz - ctx.pos.z);
		if (far < 0.1) begin(then());
		else walk = { fx: ctx.pos.x, fz: ctx.pos.z, tx, tz, seconds: Math.max(0.2, far / 2.2), at: performance.now(), then };
	};
	const once = () => {
		const fired = new Set<string>();
		return (key: string, when: boolean) => {
			if (!when || fired.has(key)) return false;
			fired.add(key);
			return true;
		};
	};

	/** Where on the plot the water's heading: swept from side to side with her, as in the clip. */
	const SWEEP: [number, number][] = [
		[0, 0],
		[0.16, 0],
		[0.3, -1],
		[0.55, 1],
		[0.74, -0.5],
		[0.86, 0],
		[1, 0],
	];
	const sweepAt = (u: number) => {
		for (let k = 1; k < SWEEP.length; k++)
			if (u <= SWEEP[k][0]) {
				const [u0, a] = SWEEP[k - 1];
				const [u1, b] = SWEEP[k];
				return THREE.MathUtils.lerp(a, b, THREE.MathUtils.smoothstep(u, u0, u1));
			}
		return 0;
	};
	const spout = new THREE.Vector3();
	const waterJob = (i: number) => (face: number): Job => {
		const p = state.plots[i];
		const view = plots[i];
		const first = once();
		return {
			clip: 'Water',
			seconds: 1.8,
			face,
			prop: 'Can',
			tick: (u, dt) => {
				// The soil counts as watered once the water starts to land, and darkens as it soaks in.
				if (first('wet', u > 0.3)) {
					state.water--;
					Object.assign(p, { wet: true, since: Date.now() });
					save();
				}
				if (u < 0.24 || u > 0.84) return;
				const node = ctx.figure.node('CanSpout');
				if (!node) return;
				node.getWorldPosition(spout);
				const n = Math.floor(dt * 60 + Math.random());
				for (let k = 0; k < n; k++) {
					// Thrown from the spout to land on a spot swept across the plot, to her left and right.
					const side = sweepAt(u) * 0.45 + (Math.random() - 0.5) * 0.25;
					const ahead = (Math.random() - 0.5) * 0.35;
					tmp.set(view.x + Math.cos(face) * side + Math.sin(face) * ahead, ctx.groundAt(view.x, view.z) + 0.15, view.z - Math.sin(face) * side + Math.cos(face) * ahead);
					const T = 0.38 + Math.random() * 0.08;
					vel.set((tmp.x - spout.x) / T, (tmp.y - spout.y + 4.9 * T * T) / T, (tmp.z - spout.z) / T);
					spawn('water', spout, vel, 1, 0.022 + Math.random() * 0.012);
				}
			},
			done: () => {
				if (first('wet', true)) {
					state.water--;
					Object.assign(p, { wet: true, since: Date.now() });
					save();
				}
			},
		};
	};

	const seedMesh = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), ctx.toon({ color: '#e9c46a' }));
	seedMesh.scale.set(1, 0.7, 1.3);
	seedMesh.visible = false;
	ctx.scene.add(seedMesh);
	const plantJob = (i: number, seed: Crop) => (face: number): Job => {
		const p = state.plots[i];
		const view = plots[i];
		const fire = once();
		const holeAt = () => tmp.set(view.x, ctx.groundAt(view.x, view.z) + 0.16, view.z);
		const sow = () => {
			if (!fire('sow', true)) return;
			seedMesh.visible = false;
			if (!inv.remove(`seed-${seed.id}`)) return;
			Object.assign(p, { crop: seed.id, stage: 0, wet: false, since: 0 });
			save();
			view.rise = 0;
			drawPlot(i);
		};
		return {
			clip: 'Plant',
			seconds: 2.4,
			face,
			tick: (u) => {
				// Two scoops of dirt out of a hole that opens as she digs...
				view.hole.visible = u > 0.18 && u < 0.88;
				view.hole.scale.setScalar(Math.max(0.01, THREE.MathUtils.smoothstep(u, 0.18, 0.46) * (1 - THREE.MathUtils.smoothstep(u, 0.66, 0.86))));
				for (const [key, at] of [
					['dig1', 0.3],
					['dig2', 0.46],
				] as const)
					if (fire(key, u > at))
						for (let k = 0; k < 7; k++) {
							const a = Math.random() * Math.PI * 2;
							const out = 0.6 + Math.random() * 0.8;
							spawn('dirt', holeAt(), vel.set(Math.cos(a) * out, 1.4 + Math.random() * 1, Math.sin(a) * out), 1.2, 0.025 + Math.random() * 0.02);
						}
				// ...a seed held over it and let fall in...
				const hand = ctx.figure.node('HandR');
				if (u > 0.5 && u < 0.6 && hand) {
					hand.getWorldPosition(seedMesh.position);
					seedMesh.position.y -= 0.08;
					seedMesh.visible = true;
				} else if (u >= 0.6 && u < 0.65) {
					seedMesh.position.lerp(holeAt(), 0.35);
				} else if (u >= 0.65) {
					sow();
				}
				// ...then patted down into a little mound, with a puff of dust each time.
				view.rise = p.crop ? THREE.MathUtils.smoothstep(u, 0.66, 0.92) : view.rise;
				for (const [key, at] of [
					['pat1', 0.74],
					['pat2', 0.86],
				] as const)
					if (fire(key, u > at))
						for (let k = 0; k < 5; k++) {
							const a = Math.random() * Math.PI * 2;
							spawn('dust', holeAt(), vel.set(Math.cos(a) * 0.5, 0.3 + Math.random() * 0.3, Math.sin(a) * 0.5), 0.6, 0.03);
						}
			},
			done: () => {
				sow();
				view.rise = 1;
				view.hole.visible = false;
			},
		};
	};

	const nearestPlot = () => {
		let best = -1;
		let bestD = Infinity;
		plots.forEach((p, i) => {
			const d = Math.hypot(p.x - ctx.pos.x, p.z - ctx.pos.z);
			if (d < bestD) {
				bestD = d;
				best = i;
			}
		});
		return bestD < PLOT * 0.62 ? best : -1;
	};

	/** What pressing E would do right now, as a label (and the doing, if there is any). */
	const option = (): Offer | null => {
		if (job || walk || shopOpen || !ctx.canAct()) return null;
		if (Math.hypot(BARREL.x - ctx.pos.x, BARREL.z - ctx.pos.z) < 1.6) {
			if (!inv.has('tool-can')) return { label: 'A barrel of rainwater' };
			if (state.water >= holds()) return { label: 'The watering can is full' };
			return {
				label: 'Fill the watering can',
				go: () =>
					act('Tend', 0.9, BARREL.x, BARREL.z, () => {
						state.water = holds();
						save();
						ctx.toast('The can is full of water.');
					}),
			};
		}
		if (Math.hypot(STALL_FRONT.x - ctx.pos.x, STALL_FRONT.z - ctx.pos.z) < 1.8)
			return ctx.keeper ? { label: `Talk to ${ctx.keeper.name}`, go: ctx.keeper.talk } : { label: 'Open the market stand', go: () => openShop() };
		const i = nearestPlot();
		if (i < 0) return null;
		const p = state.plots[i];
		const view = plots[i];
		const c = crop(p.crop);
		if (!c) {
			const seed = heldSeed();
			if (!seed) return { label: 'No seeds: buy some at the stand' };
			return { label: `Plant ${seed.name.toLowerCase()} seeds (${inv.count(`seed-${seed.id}`)})`, go: () => atPlot(i, plantJob(i, seed)) };
		}
		if (p.stage === 3) {
			return {
				label: `Harvest the ${c.name.toLowerCase()}`,
				go: () =>
					atPlot(i, (face) => ({
						clip: 'Tend',
						seconds: 0.9,
						face,
						done: () => {
							if (!inv.fits(`crop-${c.id}`)) {
								ctx.toast('Your bag is full.');
								return;
							}
							inv.add(`crop-${c.id}`, c.yield);
							if (c.regrow) Object.assign(p, { stage: 2, wet: false, since: 0 });
							else Object.assign(p, { crop: null, stage: 0, wet: false, since: 0 });
							save();
							drawPlot(i);
							ctx.toast(c.yield > 1 ? `${c.yield} ${c.name.toLowerCase()}s, into the bag!` : `A ${c.name.toLowerCase()}, into the bag!`);
							// Then she holds it up to show it off, turned round to face the camera.
							const shown = make(c.item, { inked: true });
							if (shown) {
								shown.scale.setScalar(c.id === 'pumpkin' ? 0.55 : c.id === 'strawberry' ? 2.4 : 1.2);
								ctx.figure.group.add(shown);
							}
							begin({ clip: 'Show', seconds: 1.8, face: ctx.towardCamera(), done: () => {}, show: shown ?? undefined });
						},
					})),
			};
		}
		if (p.wet) return { label: `${c.name}: next stage in ${fmt(stageMs(c) - (Date.now() - p.since))}` };
		if (!inv.has('tool-can')) return { label: `The ${c.name.toLowerCase()} needs water` };
		if (state.water <= 0) return { label: 'The can is empty: fill it at the barrel' };
		return { label: `Water the ${c.name.toLowerCase()} (can ${state.water}/${holds()})`, go: () => atPlot(i, waterJob(i)) };
	};
	// ---------- the market stand ----------

	const row = (icon: string | null, color: string, name: string, sub: string, buttons: [string, boolean, () => void][]) => {
		const li = document.createElement('li');
		const pic = document.createElement('span');
		pic.className = 'shop-picture';
		if (icon) pic.style.backgroundImage = `url(${icon})`;
		else pic.style.backgroundColor = color;
		const text = document.createElement('span');
		text.className = 'shop-text';
		const strong = document.createElement('strong');
		strong.textContent = name;
		const small = document.createElement('small');
		small.textContent = sub;
		text.append(strong, small);
		li.append(pic, text);
		for (const [label, enabled, run] of buttons) {
			const b = document.createElement('button');
			b.type = 'button';
			b.textContent = label;
			b.disabled = !enabled;
			b.addEventListener('click', run);
			li.append(b);
		}
		return li;
	};
	function renderShop() {
		if (ui.coins) ui.coins.textContent = `${state.coins} coins`;
		if (ui.buy)
			ui.buy.replaceChildren(
				...CROPS.map((c) => {
					const id = `seed-${c.id}`;
					return row(inv.def(id)?.icon?.() ?? null, c.color, `${c.name} seeds`, `${c.cost} coins · about ${c.minutes * 3} min to grow`, [
						[
							'Buy',
							state.coins >= c.cost && inv.fits(id),
							() => {
								if (state.coins < c.cost || !inv.add(id)) return;
								state.coins -= c.cost;
								save();
								renderShop();
								inv.render();
								ctx.onTrade?.();
							},
						],
					]);
				}),
			);
		if (ui.sell) {
			const rows = inv
				.entries()
				.map(([id, n]) => ({ id, n, def: inv.def(id) }))
				.filter((e) => e.def?.sell)
				.map(({ id, n, def }) => {
					const each = def!.sell!;
					const sell = (k: number) => () => {
						if (!inv.remove(id, k)) return;
						state.coins += each * k;
						save();
						renderShop();
						inv.render();
						ctx.onTrade?.();
					};
					return row(def!.icon?.() ?? null, def!.color, `${def!.name} ×${n}`, `${each} coins each`, [
						['Sell 1', true, sell(1)],
						[`Sell all`, n > 1, sell(n)],
					]);
				});
			if (!rows.length) {
				const li = document.createElement('li');
				li.className = 'shop-empty';
				li.textContent = 'Nothing to sell yet. Fish and crops fetch coins here.';
				rows.push(li);
			}
			ui.sell.replaceChildren(...rows);
		}
	}
	function openShop() {
		if (!ui.shop) return;
		shopOpen = true;
		ui.shop.hidden = false;
		renderShop();
		ui.close?.focus();
	}
	const closeShop = () => {
		if (!ui.shop || !shopOpen) return;
		shopOpen = false;
		ui.shop.hidden = true;
		ui.close?.blur();
	};
	ui.close?.addEventListener('click', closeShop);
	ui.shop?.addEventListener('click', (e) => {
		if (e.target === ui.shop) closeShop();
	});

	// ---------- every frame ----------

	let growClock = 0;
	const mid = new THREE.Vector3();
	const other = new THREE.Vector3();
	const update = (dt: number) => {
		growClock -= dt;
		if (growClock <= 0) {
			growClock = 1;
			grow();
		}
		// The first time she comes by, there's a can and some seeds waiting for her.
		if (!state.gifted && Math.hypot(ctx.centre.x - ctx.pos.x, ctx.centre.z - ctx.pos.z) < 8 && ctx.canAct()) {
			state.gifted = true;
			state.water = holds();
			inv.add('tool-can');
			inv.add('seed-turnip', 3);
			save();
			ctx.toast('A watering can and turnip seeds, left out for her!');
		}

		// Stepping over to the plot, then the job itself.
		const now = performance.now();
		if (walk) {
			const u = Math.min(1, (now - walk.at) / (walk.seconds * 1000));
			ctx.pos.x = THREE.MathUtils.lerp(walk.fx, walk.tx, u);
			ctx.pos.z = THREE.MathUtils.lerp(walk.fz, walk.tz, u);
			if (u >= 1) {
				const then = walk.then;
				walk = null;
				begin(then());
			}
		}
		ctx.figure.setProp('Can', job?.prop === 'Can');
		if (job) {
			const u = Math.min(1, (now - jobAt) / (job.seconds * 1000));
			job.tick?.(u, dt);
			if (job.show) {
				const l = ctx.figure.node('HandL');
				const r = ctx.figure.node('HandR');
				if (l && r) {
					l.getWorldPosition(mid);
					r.getWorldPosition(other);
					mid.add(other).multiplyScalar(0.5);
					ctx.figure.group.worldToLocal(mid);
					job.show.position.copy(mid).add(other.set(0, -0.08, 0.14));
				}
			}
			if (u >= 1) {
				const finished = job;
				job = null;
				finished.show?.removeFromParent();
				finished.done();
			}
		}
		updateBits(dt);
		// Ripe crops bob a little, to say they're ready; a fresh mound rises as it's patted down;
		// watered soil darkens as the water soaks in.
		const t = now / 1000;
		state.plots.forEach((p, i) => {
			const view = plots[i];
			const s = PLANT_SCALE * view.rise * (p.stage === 3 ? 1 + Math.sin(t * 3 + i) * 0.04 : 1);
			view.plant.scale.set(s, Math.max(s, 0.001), s);
			view.wetMix = damp(view.wetMix, p.wet ? 1 : 0, p.wet ? 1.6 : 0.8, dt);
			view.mat.color.copy(dry).lerp(wet, view.wetMix);
		});
	};

	return {
		/** What pressing E would do in the garden right now, for the island's interactions. */
		offer: option,
		update,
		openShop,
		closeShop,
		/** Behind the stand's counter, where its keeper stands, facing the plots. */
		keeperSpot: { ...world(0, -5.2), angle: ctx.angle },
		/** How the garden's doing, for the keeper to talk about. */
		summary() {
			const growing = state.plots.filter((p) => p.crop);
			const thirsty = growing.find((p) => p.stage < 3 && !p.wet);
			const ripe = growing.find((p) => p.stage === 3);
			return { planted: growing.length, thirsty: thirsty ? crop(thirsty.crop)!.name : null, ripe: ripe ? crop(ripe.crop)!.name : null, coins: state.coins };
		},
		get shopOpen() {
			return shopOpen;
		},
		/** Busy at something, which keeps her on the spot and facing it. */
		get busy() {
			return job !== null || walk !== null;
		},
		get facing() {
			return walk ? Math.atan2(walk.tx - walk.fx, walk.tz - walk.fz) : (job?.face ?? 0);
		},
		get clip(): NixClip | null {
			return walk ? 'Walk' : (job?.clip ?? null);
		},
		get coins() {
			return state.coins;
		},
	};
}
