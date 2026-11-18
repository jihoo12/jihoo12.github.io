// Power, made at the forge: windmills, drills that mine the ore veins in the hills by themselves, and
// belts that carry the ore (and the power) to a hopper by the forge.
//
// Power here is never a number. A machine has it or it doesn't, and all it asks is "is there power
// here?": poweredAt(x, z) is whether a windmill stands within REACH, or a belt with power runs close
// by. A belt has power if any belt it's joined to (side by side, whichever way they run) is within
// REACH of a windmill: belts are the wires. A windmill wants wind, so it only goes up on high ground,
// where the veins are too.
//
// A drill goes over a vein. With power, it mines the ore each time it grows back, into the bin at
// its foot, until the bin is full; she collects it with E. If a belt starts by the bin and the belts
// from there run all the way to the hopper beside the forge, the ore goes down them instead (and
// what's in the bin follows it, a lump at a time). Nothing on a belt is simulated: a lump just
// arrives at the hopper the time it takes to travel that far after it set off, and what's shown on
// the belt is drawn from that.
//
// Power and the way to the hopper only change when she sets something down or picks it up, so
// between those times they stand still, and the clock alone says what's happened while the page
// was shut (as the garden does): before anything changes, each drill is worked up to now, and from
// then on goes by the new answer.
//
// She carries a windmill or a drill in her arms (taken out of the bag, or picked up from where it
// stood, to move it), a see-through one shows where it would go, and E sets it there. Belts she lays
// a cell at a time, the way she's facing. A belt is ground she can stand on, and one with power
// carries her along it (beltCarry: the one question movement asks, "how high is it here?", gets a
// second, "is it moving?"). The windmill, the drill and the hopper are Blender models
// (tools/island-power); the belts are drawn here.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { NixFigure } from '../experimental/nix-figure';
import type { Feature } from './features';
import type { Offer } from './interact';
import type { Inventory } from './inventory';
import type { Toon } from './look';
import { loadJSON, saveJSON } from './save';
import { slopeUp, terrainAt } from './terrain';
import { thumbnail } from './thumbnail';
import { TAU, damp } from './util';

export const WINDMILL = 'windmill';
export const DRILL = 'drill';
export const BELT = 'belt';
export const MAX_WINDMILLS = 6;
export const MAX_BELTS = 400;
/** How far a windmill's power reaches, and how far from a belt with power a machine has it too. */
export const REACH = 8;
const BELT_REACH = 1.5;
/** How high the ground has to be for there to be wind enough. */
const WINDY = 3;
/** How much ore a drill's bin holds, and the hopper. */
const BIN_HOLDS = 12;
const HOPPER_HOLDS = 99;
/** How fast a belt runs, in metres a second, and how far apart lumps go on from a bin. */
const BELT_SPEED = 1.2;
const DRIP_MS = 1500;
/** Which way the wind blows from: every windmill faces into it. */
const WIND_YAW = 0.6;
// Sizes from tools/island-power/build.py.
const HUB = new THREE.Vector3(0, 3.55, 0.42);
const TOWER_TOP = 3.2;
const LEG_R = 1.55;
const BIT_TOP = 1.95;
const BIN = { x: 0, z: 1.85 };
const HOPPER_FLOOR = 0.35;
/** How far in front of her a windmill she's carrying would go, and how far off a vein can be for
 * the drill she's carrying to go on it. */
const AHEAD = 2.2;
const DRILL_REACH = 3;
/** How close a belt has to start to a drill's bin to take its ore, and come to the hopper to give it. */
const PICK_UP = 1.3;
const HAND_IN = 1.0;
/** A belt's height over the ground. */
const BELT_H = 0.14;
/** The four ways a belt can run: +z, +x, -z, -x. */
const DIRS: [number, number][] = [
	[0, 1],
	[1, 0],
	[0, -1],
	[-1, 0],
];

export interface Vein {
	id: string;
	x: number;
	y: number;
	z: number;
}

/** What the forge tells the drills about its veins. */
export interface VeinSource {
	veins: () => Vein[];
	/** When the vein next has ore (or had it: it may be in the past). */
	ripeAt: (id: string) => number;
	/** The ore's been taken at time t: it grows back from then. */
	take: (id: string, t: number) => void;
	regrowMs: number;
}

export interface PowerContext {
	renderer: THREE.WebGLRenderer;
	scene: THREE.Scene;
	toon: Toon;
	inventory: Inventory;
	figure: NixFigure;
	modelUrl: string;
	ore: { id: string; color: string };
	veins: VeinSource;
	/** Where the hopper stands, by the forge. */
	hopper: { x: number; z: number; yaw: number };
	groundAt: (x: number, z: number) => number;
	addFeature: (f: Feature) => void;
	removeFeature: (f: Feature) => void;
	/** Where she is. */
	pos: THREE.Vector3;
	/** Whether she's on her feet and free (not busy, not swimming, not up on Cloudrest). */
	canAct: () => boolean;
	/** Whether she can keep carrying: out of the water, and down on the island. */
	canCarry: () => boolean;
	/** Whether a windmill may stand at (x, z): clear of trees, rocks, blocks and the kept-clear places. */
	open: (x: number, z: number) => boolean;
	/** Whether a belt may run through the cell whose middle is (x, z). */
	openForBelt: (x: number, z: number) => boolean;
	toast: (text: string) => void;
	closeMenu: () => void;
}

interface Windmill {
	x: number;
	z: number;
}
interface Drill {
	vein: string;
	yaw: number;
	/** The time from which it can next mine: when it got power, or when there was last room. */
	from: number;
	stored: number;
	/** When each lump it's sent down the belts gets to the hopper. */
	flight: number[];
}
interface Belt {
	i: number;
	j: number;
	dir: number;
}
interface Saved {
	windmills: Windmill[];
	drills: Drill[];
	belts: [number, number, number][];
	hopper: number;
}
/** The way from a drill's bin to the hopper: the cells it runs through, and how long it takes. */
interface Route {
	start: number;
	cells: Belt[];
	length: number;
	ms: number;
}

const key = (i: number, j: number) => (i + 1000) * 4096 + (j + 1000);
const centre = (b: { i: number; j: number }) => ({ x: b.i + 0.5, z: b.j + 0.5 });

// The belts, by cell, and which of them have power: kept out here, like the blocks' columns, so the
// ground can ask about them.
const belts = new Map<number, Belt>();
let live = new Set<number>();

/** The top of a belt at (x, z), or -Infinity where there's none: belts are ground she stands on. */
export function beltGround(x: number, z: number) {
	if (!belts.size || !belts.has(key(Math.floor(x), Math.floor(z)))) return -Infinity;
	return terrainAt(x, z) + BELT_H - 0.02;
}

/** How fast the ground under her feet at (x, z) is carrying her, if she's standing (at height y) on
 * a belt with power: along it, and a little in towards its middle, so she follows it round corners
 * rather than drifting off its edge. Null if nothing's carrying her. */
export function beltCarry(x: number, z: number, y: number) {
	const k = key(Math.floor(x), Math.floor(z));
	const b = belts.get(k);
	if (!b || !live.has(k) || Math.abs(y - beltGround(x, z)) > 0.06) return null;
	const [di, dj] = DIRS[b.dir];
	const c = centre(b);
	return { x: di * BELT_SPEED + (di === 0 ? (c.x - x) * 2 : 0), z: dj * BELT_SPEED + (dj === 0 ? (c.z - z) * 2 : 0) };
}

export function createPower(ctx: PowerContext) {
	const { inventory } = ctx;
	const veins = ctx.veins.veins();
	const veinOf = (id: string) => veins.find((v) => v.id === id);
	const num = (v: unknown, or: number) => (typeof v === 'number' && Number.isFinite(v) ? v : or);

	belts.clear();
	const state: Omit<Saved, 'belts'> = (() => {
		const s: Omit<Saved, 'belts'> = { windmills: [], drills: [], hopper: 0 };
		const saved = loadJSON('power') as Partial<Saved> | undefined;
		if (!saved || typeof saved !== 'object') return s;
		if (Array.isArray(saved.windmills))
			for (const w of saved.windmills)
				if (w && Number.isFinite(w.x) && Number.isFinite(w.z) && s.windmills.length < MAX_WINDMILLS) s.windmills.push({ x: w.x, z: w.z });
		if (Array.isArray(saved.drills))
			for (const d of saved.drills)
				if (d && typeof d.vein === 'string' && veinOf(d.vein) && !s.drills.some((o) => o.vein === d.vein))
					s.drills.push({
						vein: d.vein,
						yaw: num(d.yaw, 0),
						from: num(d.from, Date.now()),
						stored: Math.max(0, Math.min(BIN_HOLDS, Math.floor(num(d.stored, 0)))),
						flight: Array.isArray(d.flight) ? d.flight.filter((t) => Number.isFinite(t)).slice(0, HOPPER_HOLDS) : [],
					});
		if (Array.isArray(saved.belts))
			for (const b of saved.belts) {
				if (!Array.isArray(b)) continue;
				const [i, j, dir] = b;
				if (!Number.isInteger(i) || !Number.isInteger(j) || !Number.isInteger(dir) || dir < 0 || dir > 3) continue;
				if (Math.abs(i) > 400 || Math.abs(j) > 400 || belts.size >= MAX_BELTS) continue;
				belts.set(key(i, j), { i, j, dir });
			}
		s.hopper = Math.max(0, Math.floor(num(saved.hopper, 0)));
		return s;
	})();
	const save = () => saveJSON('power', { ...state, belts: [...belts.values()].map((b) => [b.i, b.j, b.dir]) });

	// ---------- where things are ----------

	/** A point in a drill's own frame (its bin towards +z), out in the world. */
	const drillPoint = (d: Drill, lx: number, lz: number) => {
		const v = veinOf(d.vein)!;
		return { x: v.x + Math.cos(d.yaw) * lx + Math.sin(d.yaw) * lz, z: v.z - Math.sin(d.yaw) * lx + Math.cos(d.yaw) * lz };
	};
	const hopperAt = new THREE.Vector3(ctx.hopper.x, terrainAt(ctx.hopper.x, ctx.hopper.z), ctx.hopper.z);
	ctx.addFeature({ x: hopperAt.x, z: hopperAt.z, r: 0.55, top: hopperAt.y + 0.9 });
	/** The height of a belt's top at (x, z). */
	const beltTop = (x: number, z: number) => beltGround(x, z) + 0.02;
	/** The belts near (x, z), within `r` of their middles. */
	const beltsNear = (x: number, z: number, r: number) => {
		const out: Belt[] = [];
		const reach = Math.ceil(r);
		for (let i = Math.floor(x) - reach; i <= Math.floor(x) + reach; i++)
			for (let j = Math.floor(z) - reach; j <= Math.floor(z) + reach; j++) {
				const b = belts.get(key(i, j));
				if (b && Math.hypot(i + 0.5 - x, j + 0.5 - z) <= r) out.push(b);
			}
		return out;
	};

	// ---------- the one question ----------

	/** The belts with power: every belt joined to one that's within reach of a windmill. */
	const routes = new Map<Drill, Route>();
	const nearWindmill = (x: number, z: number) => state.windmills.some((w) => Math.hypot(w.x - x, w.z - z) <= REACH);
	const poweredAt = (x: number, z: number) => nearWindmill(x, z) || beltsNear(x, z, BELT_REACH).some((b) => live.has(key(b.i, b.j)));
	/** A drill has power from a windmill near it, or from a belt with power that starts by its bin. */
	const powered = (d: Drill) => {
		const v = veinOf(d.vein);
		if (!v) return false;
		if (poweredAt(v.x, v.z)) return true;
		const bin = drillPoint(d, BIN.x, BIN.z);
		return beltsNear(bin.x, bin.z, PICK_UP).some((b) => live.has(key(b.i, b.j)));
	};
	/** Follows the belts from beside a drill's bin; a route if they run to the hopper. */
	const routeFrom = (d: Drill): Route | null => {
		const bin = drillPoint(d, BIN.x, BIN.z);
		let first: Belt | null = null;
		let best = PICK_UP;
		for (const b of beltsNear(bin.x, bin.z, PICK_UP)) {
			const c = centre(b);
			const dist = Math.hypot(c.x - bin.x, c.z - bin.z);
			if (dist <= best) {
				best = dist;
				first = b;
			}
		}
		if (!first) return null;
		const cells = [first];
		const seen = new Set([key(first.i, first.j)]);
		for (;;) {
			const last = cells[cells.length - 1];
			const [di, dj] = DIRS[last.dir];
			const k = key(last.i + di, last.j + dj);
			const next = belts.get(k);
			if (!next || seen.has(k)) break;
			seen.add(k);
			cells.push(next);
		}
		const last = cells[cells.length - 1];
		const c = centre(last);
		const [di, dj] = DIRS[last.dir];
		if (Math.hypot(c.x + di * 0.5 - hopperAt.x, c.z + dj * 0.5 - hopperAt.z) > HAND_IN) return null;
		const length = cells.length - 0.5;
		return { start: key(first.i, first.j), cells, length, ms: (length / BELT_SPEED) * 1000 };
	};
	/** Works out again which belts have power, and which drills' belts run to the hopper. */
	const rewire = () => {
		live = new Set();
		const queue: Belt[] = [];
		for (const b of belts.values()) {
			const c = centre(b);
			if (nearWindmill(c.x, c.z)) {
				live.add(key(b.i, b.j));
				queue.push(b);
			}
		}
		while (queue.length) {
			const b = queue.pop()!;
			for (const [di, dj] of DIRS) {
				const k = key(b.i + di, b.j + dj);
				if (belts.has(k) && !live.has(k)) {
					live.add(k);
					queue.push(belts.get(k)!);
				}
			}
		}
		routes.clear();
		for (const d of state.drills) {
			const r = routeFrom(d);
			if (r) routes.set(d, r);
		}
	};
	/** The way a drill's ore goes to the hopper, if it does (the belts there are, and have power). */
	const routeOf = (d: Drill) => {
		const r = routes.get(d);
		return r && live.has(r.start) ? r : null;
	};

	const inFlight = () => state.drills.reduce((n, d) => n + d.flight.length, 0);
	/** What's got to the hopper by now goes in it. */
	const deliver = (now: number) => {
		for (const d of state.drills) {
			const before = d.flight.length;
			d.flight = d.flight.filter((t) => t > now);
			state.hopper += before - d.flight.length;
		}
	};
	/** Works a drill up to now: each time its vein's had ore since it could last mine, it's mined it
	 * (while there's room for it), into its bin or down the belts. Returns how much it mined. */
	const settle = (d: Drill, now: number) => {
		if (!powered(d)) {
			d.from = now;
			return 0;
		}
		const r = routeOf(d);
		const room = () => (r ? state.hopper + inFlight() < HOPPER_HOLDS : d.stored < BIN_HOLDS);
		let got = 0;
		let t = Math.max(d.from, ctx.veins.ripeAt(d.vein));
		while (t <= now && room()) {
			if (r) d.flight.push(t + r.ms);
			else d.stored++;
			got++;
			ctx.veins.take(d.vein, t);
			t += ctx.veins.regrowMs;
		}
		// With nowhere for it to go, it's only waiting for room; it counts from when there is some.
		if (!room()) d.from = now;
		// What's in the bin goes down the belts after it, a lump at a time.
		if (r && d.stored > 0) {
			let next = Math.max(now, (d.flight.length ? Math.max(...d.flight) - r.ms : -Infinity) + DRIP_MS);
			while (d.stored > 0 && room()) {
				d.flight.push(next + r.ms);
				d.stored--;
				next += DRIP_MS;
			}
		}
		return got;
	};
	const settleAll = (now = Date.now()) => {
		deliver(now);
		let got = 0;
		for (const d of state.drills) got += settle(d, now);
		return got;
	};
	/** Changes something power or the belts depend on: everything's worked up to now first, by
	 * things as they were, and goes by the new answer from then. What was on its way along belts
	 * that no longer run to the hopper is counted as there. */
	const change = (fn: () => void) => {
		const now = Date.now();
		settleAll(now);
		const before = new Map(state.drills.map((d) => [d, routeOf(d)]));
		fn();
		rewire();
		for (const d of state.drills) {
			const was = before.get(d);
			const is = routeOf(d);
			if (was && (!is || is.start !== was.start || is.length !== was.length)) {
				state.hopper += d.flight.length;
				d.flight = [];
			}
		}
		settleAll(now);
		save();
		drawBelts();
	};
	rewire();
	settleAll();
	save();

	// ---------- the models ----------

	const models = new Map<string, THREE.Object3D>();
	const toonCache = new Map<string, THREE.MeshToonMaterial>();
	const lampOff = ctx.toon({ color: '#4a5a52' });
	const lampOn = new THREE.MeshBasicMaterial({ color: '#7dffb0' });
	const make = (name: string) => {
		const source = models.get(name);
		if (!source) return null;
		const copy = source.clone(true);
		copy.position.set(0, 0, 0);
		copy.traverse((o) => {
			if (!(o instanceof THREE.Mesh)) return;
			const placeholder = o.material as THREE.MeshStandardMaterial;
			if (placeholder.name === 'Lamp') {
				o.material = lampOff;
				o.userData.lamp = true;
				return;
			}
			const color = `#${placeholder.color.getHexString()}`;
			let mat = toonCache.get(color);
			if (!mat) {
				mat = ctx.toon({ color });
				toonCache.set(color, mat);
			}
			o.material = mat;
			o.castShadow = o.receiveShadow = true;
		});
		return copy;
	};
	const lampsOf = (o: THREE.Object3D) => {
		const lamps: THREE.Mesh[] = [];
		o.traverse((m) => {
			if (m instanceof THREE.Mesh && m.userData.lamp) lamps.push(m);
		});
		return lamps;
	};
	/** A whole windmill (sails on), or a drill (bit in), as one thing to show or hold. */
	const whole = (kind: 'windmill' | 'drill') => {
		const body = make(kind === 'windmill' ? 'Windmill' : 'Drill');
		const turning = make(kind === 'windmill' ? 'WindmillRotor' : 'DrillBit');
		if (!body) return null;
		const g = new THREE.Group();
		g.add(body);
		if (turning) {
			if (kind === 'windmill') turning.position.copy(HUB);
			else turning.position.y = BIT_TOP;
			g.add(turning);
		}
		g.userData.turning = turning;
		return g;
	};
	const pending: (() => void)[] = [];
	let loaded = false;
	const onModels = (f: () => void) => (loaded ? f() : pending.push(f));
	const icons = new Map<string, string>();
	new GLTFLoader().loadAsync(ctx.modelUrl).then(
		(gltf) => {
			for (const child of [...gltf.scene.children]) models.set(child.name, child);
			loaded = true;
			for (const f of pending.splice(0)) f();
			for (const kind of ['windmill', 'drill'] as const) {
				const o = whole(kind);
				if (o) icons.set(kind, thumbnail(ctx.renderer, o, new THREE.Vector3(0.7, 0.45, 1)));
			}
			icons.set('belt', thumbnail(ctx.renderer, beltPiece(), new THREE.Vector3(0.8, 0.9, 1)));
			inventory.render();
		},
		() => {
			// No models: the machines still work, just unseen (and the belts are drawn here anyway).
		},
	);

	inventory.register({
		id: WINDMILL,
		name: 'Windmill',
		kind: 'tool',
		description: `Made at the forge. Set it up on high ground, where the wind blows, and it powers machines within ${REACH} metres of it, and belts that run near it. One already set up can be picked up again with E, to move it.`,
		color: '#b07a4f',
		icon: () => icons.get('windmill') ?? null,
		actions: [{ label: 'Carry it', run: () => (start('windmill'), ctx.closeMenu()) }],
	});
	inventory.register({
		id: DRILL,
		name: 'Drill',
		kind: 'tool',
		description: `Made at the forge. Set it over an ore vein in the hills; with power, it mines the ore each time it grows back and keeps up to ${BIN_HOLDS} in its bin for you, or sends it down belts that run to the hopper by the forge.`,
		color: '#4f5675',
		icon: () => icons.get('drill') ?? null,
		actions: [{ label: 'Carry it', run: () => (start('drill'), ctx.closeMenu()) }],
	});
	inventory.register({
		id: BELT,
		name: 'Belt',
		kind: 'material',
		description: 'Made at the forge. Lay them a cell at a time, the way you face, from beside a drill’s bin to the hopper by the forge, and the ore goes along them. Belts carry power too, from a windmill to everything along them.',
		color: '#3a3550',
		icon: () => icons.get('belt') ?? null,
		actions: [{ label: 'Lay belts', run: () => (start('belt'), ctx.closeMenu()) }],
	});

	// ---------- what stands on the island ----------

	interface WindmillView {
		w: Windmill;
		group: THREE.Group;
		rotor: THREE.Object3D | null;
		spin: number;
		feature: Feature;
	}
	interface DrillView {
		d: Drill;
		/** Where it stands, across (it shakes a little while it's at work). */
		x: number;
		group: THREE.Group;
		bit: THREE.Object3D | null;
		lamps: THREE.Mesh[];
		heap: THREE.Group;
		shown: number;
		spin: number;
		/** How long it's still at work on ore it's just mined. */
		busy: number;
		features: Feature[];
	}
	const windmillViews: WindmillView[] = [];
	const drillViews: DrillView[] = [];

	const showWindmill = (w: Windmill) => {
		const group = new THREE.Group();
		group.position.set(w.x, ctx.groundAt(w.x, w.z) - 0.05, w.z);
		group.rotation.y = WIND_YAW;
		ctx.scene.add(group);
		const view: WindmillView = { w, group, rotor: null, spin: Math.random() * TAU, feature: { x: w.x, z: w.z, r: 0.8, top: group.position.y + TOWER_TOP + 0.7 } };
		ctx.addFeature(view.feature);
		onModels(() => {
			const o = whole('windmill');
			if (!o) return;
			group.add(o);
			view.rotor = o.userData.turning;
		});
		windmillViews.push(view);
	};
	const hideWindmill = (w: Windmill) => {
		const i = windmillViews.findIndex((v) => v.w === w);
		if (i < 0) return;
		windmillViews[i].group.removeFromParent();
		ctx.removeFeature(windmillViews[i].feature);
		windmillViews.splice(i, 1);
	};

	const oreMat = ctx.toon({ color: ctx.ore.color });
	const lumpGeo = new THREE.IcosahedronGeometry(0.09, 0);
	/** A heap of up to `n` lumps in `heap`, three to a row. */
	const fillHeap = (heap: THREE.Group, n: number, across = 0.15) => {
		heap.clear();
		for (let k = 0; k < n; k++) {
			const lump = new THREE.Mesh(lumpGeo, oreMat);
			lump.position.set(-across + (k % 3) * across, 0.06 + Math.floor(k / 9) * 0.1, -across + (Math.floor(k / 3) % 3) * across);
			lump.rotation.set(k, k * 2, 0);
			heap.add(lump);
		}
	};
	const showDrill = (d: Drill) => {
		const v = veinOf(d.vein);
		if (!v) return;
		const group = new THREE.Group();
		group.position.set(v.x, v.y + 0.1, v.z);
		group.rotation.y = d.yaw;
		ctx.scene.add(group);
		const heap = new THREE.Group();
		heap.position.set(BIN.x, 0.1, BIN.z);
		group.add(heap);
		// Its three legs to walk round, and the bin.
		const features: Feature[] = [];
		for (let k = 0; k < 3; k++) {
			const a = (TAU * k) / 3 + Math.PI / 6;
			features.push({ ...drillPoint(d, Math.cos(a) * LEG_R, Math.sin(a) * LEG_R), r: 0.15 });
		}
		features.push({ ...drillPoint(d, BIN.x, BIN.z), r: 0.35, top: v.y + 0.6 });
		for (const f of features) ctx.addFeature(f);
		const view: DrillView = { d, x: v.x, group, bit: null, lamps: [], heap, shown: -1, spin: 0, busy: 0, features };
		onModels(() => {
			const o = whole('drill');
			if (!o) return;
			group.add(o);
			view.bit = o.userData.turning;
			view.lamps = lampsOf(o);
		});
		drillViews.push(view);
	};
	const hideDrill = (d: Drill) => {
		const i = drillViews.findIndex((v) => v.d === d);
		if (i < 0) return;
		drillViews[i].group.removeFromParent();
		for (const f of drillViews[i].features) ctx.removeFeature(f);
		drillViews.splice(i, 1);
	};
	for (const w of state.windmills) showWindmill(w);
	for (const d of state.drills) showDrill(d);

	// The hopper, and the ore in it.
	const hopper = { lamps: [] as THREE.Mesh[], heap: new THREE.Group(), shown: -1 };
	{
		const group = new THREE.Group();
		group.position.copy(hopperAt);
		group.rotation.y = ctx.hopper.yaw;
		hopper.heap.position.y = HOPPER_FLOOR;
		group.add(hopper.heap);
		ctx.scene.add(group);
		onModels(() => {
			const o = make('Hopper');
			if (!o) return;
			group.add(o);
			hopper.lamps = lampsOf(o);
		});
	}

	// ---------- the belts ----------

	/** One cell of belt, running towards +z, standing on y = 0: a frame, the dark belt along it, and
	 * a brass chevron on the belt (drawn on its own, so it can move along). */
	const frameGeo = new THREE.BoxGeometry(0.9, BELT_H - 0.02, 1).translate(0, (BELT_H - 0.02) / 2, 0);
	const bedGeo = new THREE.BoxGeometry(0.7, 0.02, 1).translate(0, BELT_H - 0.01, 0);
	const chevronGeo = (() => {
		const s = new THREE.Shape();
		s.moveTo(-0.25, -0.12);
		s.lineTo(0, 0.08);
		s.lineTo(0.25, -0.12);
		s.lineTo(0.25, 0.0);
		s.lineTo(0, 0.2);
		s.lineTo(-0.25, 0.0);
		s.closePath();
		// Lying flat, pointing along +z.
		return new THREE.ShapeGeometry(s).rotateX(Math.PI / 2).translate(0, 0.005, 0);
	})();
	const frameMat = ctx.toon({ color: '#7d86a8' });
	const bedMat = ctx.toon({ color: '#3a3550' });
	const chevronOff = new THREE.MeshBasicMaterial({ color: '#8a7a55', side: THREE.DoubleSide });
	const chevronOn = new THREE.MeshBasicMaterial({ color: '#ffd27a', side: THREE.DoubleSide });
	const beltPiece = () => {
		const g = new THREE.Group();
		g.add(new THREE.Mesh(frameGeo, frameMat), new THREE.Mesh(bedGeo, bedMat));
		const c = new THREE.Mesh(chevronGeo, chevronOn);
		c.position.y = BELT_H;
		g.add(c);
		return g;
	};
	const frames = new THREE.InstancedMesh(frameGeo, frameMat, MAX_BELTS);
	const beds = new THREE.InstancedMesh(bedGeo, bedMat, MAX_BELTS);
	const chevronsOn = new THREE.InstancedMesh(chevronGeo, chevronOn, MAX_BELTS);
	const chevronsOff = new THREE.InstancedMesh(chevronGeo, chevronOff, MAX_BELTS);
	for (const m of [frames, beds, chevronsOn, chevronsOff]) {
		m.frustumCulled = false;
		m.count = 0;
		ctx.scene.add(m);
	}
	frames.castShadow = frames.receiveShadow = beds.receiveShadow = true;
	/** How each belt sits on the ground: tipped to follow it along and across. */
	const beltMatrix = new Map<number, THREE.Matrix4>();
	const tilt = new THREE.Euler();
	const q = new THREE.Quaternion();
	const one = new THREE.Vector3(1, 1, 1);
	const at = new THREE.Vector3();
	const sitBelt = (b: Belt) => {
		const { x, z } = centre(b);
		const [di, dj] = DIRS[b.dir];
		const along = terrainAt(x + di * 0.5, z + dj * 0.5) - terrainAt(x - di * 0.5, z - dj * 0.5);
		const across = terrainAt(x + dj * 0.45, z - di * 0.45) - terrainAt(x - dj * 0.45, z + di * 0.45);
		tilt.set(-Math.atan(along), (b.dir * Math.PI) / 2, Math.atan(across / 0.9), 'YXZ');
		q.setFromEuler(tilt);
		return new THREE.Matrix4().compose(at.set(x, terrainAt(x, z) - 0.02, z), q, one);
	};
	function drawBelts() {
		beltMatrix.clear();
		let n = 0;
		for (const b of belts.values()) {
			const m = sitBelt(b);
			beltMatrix.set(key(b.i, b.j), m);
			frames.setMatrixAt(n, m);
			beds.setMatrixAt(n, m);
			n++;
		}
		frames.count = beds.count = n;
		frames.instanceMatrix.needsUpdate = beds.instanceMatrix.needsUpdate = true;
	}
	drawBelts();
	// The chevrons move along belts with power, and stand still on the rest.
	const slide = new THREE.Matrix4();
	const drawChevrons = (time: number) => {
		let on = 0;
		let off = 0;
		const shift = ((time * BELT_SPEED) % 1) - 0.5;
		for (const [k, m] of beltMatrix) {
			if (live.has(k)) chevronsOn.setMatrixAt(on++, slide.makeTranslation(0, BELT_H, shift).premultiply(m));
			else chevronsOff.setMatrixAt(off++, slide.makeTranslation(0, BELT_H, 0).premultiply(m));
		}
		chevronsOn.count = on;
		chevronsOff.count = off;
		chevronsOn.instanceMatrix.needsUpdate = chevronsOff.instanceMatrix.needsUpdate = true;
	};
	// Lumps of ore on their way along the belts.
	const lumps = new THREE.InstancedMesh(lumpGeo, oreMat, HOPPER_HOLDS);
	lumps.frustumCulled = false;
	lumps.castShadow = true;
	lumps.count = 0;
	ctx.scene.add(lumps);
	const spinLump = new THREE.Quaternion();
	const lumpScale = new THREE.Vector3(1.3, 1.3, 1.3);
	/** Where something `s` metres along a route is. */
	const along = (r: Route, s: number, out: THREE.Vector3) => {
		const k = Math.min(r.cells.length - 1, Math.max(0, Math.floor(s + 0.5)));
		const b = r.cells[k];
		const c = centre(b);
		const [di, dj] = DIRS[b.dir];
		// Into a cell, it comes from the middle of the one before, and turns at this one's middle.
		const off = s - k;
		const prev = k > 0 ? r.cells[k - 1] : null;
		let x: number;
		let z: number;
		if (off < 0 && prev) {
			const [pi, pj] = DIRS[prev.dir];
			x = c.x + pi * off;
			z = c.z + pj * off;
		} else {
			x = c.x + di * off;
			z = c.z + dj * off;
		}
		return out.set(x, beltTop(x, z) + 0.08, z);
	};
	const drawLumps = (now: number, time: number) => {
		let n = 0;
		for (const d of state.drills) {
			const r = routeOf(d);
			if (!r) continue;
			for (const t of d.flight) {
				const s = r.length - ((t - now) / 1000) * BELT_SPEED;
				if (s < 0 || s > r.length || n >= HOPPER_HOLDS) continue;
				spinLump.setFromAxisAngle(at.set(0, 1, 0), t * 0.001 + time * 0.3);
				lumps.setMatrixAt(n++, slide.compose(along(r, s, at), spinLump, lumpScale));
			}
		}
		lumps.count = n;
		lumps.instanceMatrix.needsUpdate = true;
	};

	// ---------- carrying ----------

	type Kind = 'windmill' | 'drill' | 'belt';
	const carry = {
		kind: null as Kind | null,
		held: new Map<string, THREE.Object3D>(),
		ghosts: new Map<string, THREE.Object3D>(),
		/** Where it would go, and whether it can. */
		spot: null as { x: number; y: number; z: number; ok: boolean; why?: string; vein?: Vein; belt?: Belt; existing?: Belt } | null,
	};
	const glass = new THREE.MeshBasicMaterial({ color: '#bff0ff', transparent: true, opacity: 0.45, depthWrite: false });
	const glassNo = new THREE.MeshBasicMaterial({ color: '#ff9a9a', transparent: true, opacity: 0.35, depthWrite: false });
	const ghostOf = (o: THREE.Object3D) => {
		o.traverse((m) => {
			if (m instanceof THREE.Mesh) {
				m.material = glass;
				m.castShadow = false;
			}
		});
		o.visible = false;
		ctx.scene.add(o);
		return o;
	};
	const holdOf = (kind: Kind, o: THREE.Object3D, scale: number) => {
		o.scale.setScalar(scale);
		o.visible = false;
		ctx.figure.group.add(o);
		carry.held.set(kind, o);
	};
	onModels(() => {
		for (const kind of ['windmill', 'drill'] as const) {
			const held = whole(kind);
			if (held) holdOf(kind, held, kind === 'windmill' ? 0.16 : 0.22);
			const ghost = whole(kind);
			if (ghost) carry.ghosts.set(kind, ghostOf(ghost));
		}
	});
	holdOf('belt', beltPiece(), 0.4);
	carry.ghosts.set('belt', ghostOf(beltPiece()));
	// Dots on the ground round each windmill (and the one she's carrying) to show how far its power
	// reaches, while she has a machine or belts in her arms.
	const DOTS = 40;
	const dots = new THREE.InstancedMesh(
		new THREE.CircleGeometry(0.13, 10).rotateX(-Math.PI / 2),
		new THREE.MeshBasicMaterial({ color: '#7dffb0', transparent: true, opacity: 0.8, depthWrite: false }),
		DOTS * (MAX_WINDMILLS + 1),
	);
	dots.frustumCulled = false;
	dots.renderOrder = 2;
	dots.count = 0;
	ctx.scene.add(dots);
	const m4 = new THREE.Matrix4();
	const ringAround = (x: number, z: number, from: number, time: number) => {
		for (let k = 0; k < DOTS; k++) {
			const a = (k / DOTS) * TAU + time * 0.15;
			const px = x + Math.cos(a) * REACH;
			const pz = z + Math.sin(a) * REACH;
			dots.setMatrixAt(from + k, m4.makeTranslation(px, ctx.groundAt(px, pz) + 0.06, pz));
		}
		return from + DOTS;
	};

	const itemOf = (kind: Kind) => (kind === 'windmill' ? WINDMILL : kind === 'drill' ? DRILL : BELT);
	const count = (kind: Kind) => inventory.count(itemOf(kind));
	function start(kind: Kind) {
		if (!count(kind)) return;
		if (!ctx.canCarry()) {
			ctx.toast(kind === 'windmill' ? 'A windmill goes up on the island, on high ground.' : kind === 'drill' ? 'A drill goes over an ore vein, up in the hills.' : 'Belts go down on the island.');
			return;
		}
		if (kind === 'drill' && !freeVeins().length) {
			ctx.toast('There are drills on every vein already.');
			return;
		}
		carry.kind = kind;
		if (kind === 'belt') ctx.toast('Belts run the way you face. E lays one; E on one facing another way turns it; Q takes one back.');
	}
	const stop = () => {
		carry.kind = null;
		carry.spot = null;
	};
	const freeVeins = () => veins.filter((v) => !state.drills.some((d) => d.vein === v.id));

	const aim = new THREE.Vector3();
	const findSpot = () => {
		const turn = ctx.figure.group.getWorldDirection(aim);
		if (carry.kind === 'windmill') {
			const x = ctx.pos.x + turn.x * AHEAD;
			const z = ctx.pos.z + turn.z * AHEAD;
			const y = terrainAt(x, z);
			let why: string | undefined;
			if (y < WINDY) why = 'Too sheltered here: a windmill wants high ground';
			else if (slopeUp(x, z) < 0.8) why = 'Too steep here for a windmill';
			else if (!ctx.open(x, z) || state.windmills.some((w) => Math.hypot(w.x - x, w.z - z) < 3) || beltsNear(x, z, 1.4).length)
				why = 'No room for a windmill here';
			return { x, y: ctx.groundAt(x, z), z, ok: !why, why };
		}
		if (carry.kind === 'belt') {
			// The cell in front of her, the belt running the way she faces.
			const i = Math.floor(ctx.pos.x + turn.x * 1.1);
			const j = Math.floor(ctx.pos.z + turn.z * 1.1);
			const dir = Math.abs(turn.x) > Math.abs(turn.z) ? (turn.x > 0 ? 1 : 3) : turn.z > 0 ? 0 : 2;
			const { x, z } = centre({ i, j });
			const existing = belts.get(key(i, j));
			let why: string | undefined;
			if (!existing) {
				if (terrainAt(x, z) < 0.3 || !ctx.openForBelt(x, z) || slopeUp(x, z) < 0.7) why = 'No belt can go here';
				else if (Math.abs(terrainAt(x, z) - ctx.pos.y) > 1.5) why = 'Turn to where it should go';
				else if (belts.size >= MAX_BELTS) why = 'That’s as many belts as the island can take';
			}
			return { x, y: terrainAt(x, z), z, ok: !why, why, belt: { i, j, dir }, existing };
		}
		// A drill goes on the free vein nearest a little in front of her.
		const fx = ctx.pos.x + turn.x * 0.8;
		const fz = ctx.pos.z + turn.z * 0.8;
		let best: Vein | null = null;
		let bestD = DRILL_REACH;
		for (const v of freeVeins()) {
			const d = Math.hypot(v.x - fx, v.z - fz);
			if (d < bestD && Math.abs(ctx.pos.y - v.y) < 2.5) {
				best = v;
				bestD = d;
			}
		}
		return best ? { x: best.x, y: best.y + 0.1, z: best.z, ok: true, vein: best } : null;
	};

	const setDown = () => {
		const s = carry.spot;
		const kind = carry.kind;
		if (!s?.ok || !kind) return;
		if (kind === 'belt' && s.belt) {
			const b = s.belt;
			if (s.existing) {
				change(() => (s.existing!.dir = b.dir));
				return;
			}
			if (!inventory.remove(BELT)) return stop();
			change(() => belts.set(key(b.i, b.j), b));
			if (!count('belt')) {
				stop();
				ctx.toast('That was the last belt.');
			}
			return;
		}
		if (!inventory.remove(itemOf(kind))) return stop();
		if (kind === 'windmill') {
			const w = { x: s.x, z: s.z };
			change(() => state.windmills.push(w));
			showWindmill(w);
			const now = state.drills.filter((d) => powered(d)).length;
			ctx.toast(now ? `It's turning! ${now === 1 ? 'A drill' : `${now} drills`} near it ${now === 1 ? 'has' : 'have'} power.` : `It's turning! Machines within ${REACH} metres of it have power.`);
		} else if (s.vein) {
			const d: Drill = { vein: s.vein.id, yaw: Math.atan2(ctx.pos.x - s.vein.x, ctx.pos.z - s.vein.z), from: Date.now(), stored: 0, flight: [] };
			change(() => state.drills.push(d));
			showDrill(d);
			ctx.toast(powered(d) ? 'The drill hums into life over the ore.' : `Set up! It needs a windmill within ${REACH} metres, or a belt with power, to run.`);
		}
		if (!count(kind) || (kind === 'drill' && !freeVeins().length) || (kind === 'windmill' && state.windmills.length >= MAX_WINDMILLS)) stop();
	};
	/** Q: takes back the belt in front of her. */
	const takeBelt = () => {
		const b = carry.spot?.existing;
		if (carry.kind !== 'belt' || !b) return false;
		if (!inventory.add(BELT)) {
			ctx.toast('Your bag is too full to take it.');
			return false;
		}
		change(() => belts.delete(key(b.i, b.j)));
		inventory.render();
		return true;
	};

	const collect = (d: Drill) => {
		settleAll();
		if (!d.stored) return;
		if (!inventory.add(ctx.ore.id, d.stored)) {
			ctx.toast('Your bag is too full for the ore.');
			return;
		}
		ctx.toast(d.stored > 1 ? `${d.stored} lumps of iron ore from the drill!` : 'A lump of iron ore from the drill.');
		const wasFull = d.stored >= BIN_HOLDS;
		d.stored = 0;
		if (wasFull) d.from = Date.now();
		save();
		inventory.render();
	};
	const collectHopper = () => {
		const now = Date.now();
		settleAll(now);
		const n = state.hopper;
		if (!n) return;
		if (!inventory.add(ctx.ore.id, n)) {
			ctx.toast('Your bag is too full for the ore.');
			return;
		}
		// (Drills that were waiting on room have been counting from now all along.)
		state.hopper = 0;
		save();
		inventory.render();
		ctx.toast(n > 1 ? `${n} lumps of iron ore from the hopper!` : 'A lump of iron ore from the hopper.');
	};
	const pickUp = (kind: 'windmill' | 'drill', thing: Windmill | Drill) => {
		if (!inventory.fits(itemOf(kind))) {
			ctx.toast('Your bag is too full to take it.');
			return;
		}
		if (kind === 'windmill') {
			change(() => (state.windmills = state.windmills.filter((w) => w !== thing)));
			hideWindmill(thing as Windmill);
			inventory.add(WINDMILL);
		} else {
			const d = thing as Drill;
			settleAll();
			if (d.stored && !inventory.add(ctx.ore.id, d.stored)) {
				ctx.toast('Your bag is too full for the ore in its bin.');
				return;
			}
			// What it's sent off along the belts still gets there.
			state.hopper += d.flight.length;
			d.flight = [];
			d.stored = 0;
			change(() => (state.drills = state.drills.filter((o) => o !== d)));
			hideDrill(d);
			inventory.add(DRILL);
		}
		inventory.render();
		carry.kind = kind;
		ctx.toast(`Picked up the ${kind}. Carry it to where it should go.`);
	};

	// ---------- E ----------

	const near = (x: number, z: number, r: number) => Math.hypot(x - ctx.pos.x, z - ctx.pos.z) < r;
	const offer = (): Offer | null => {
		if (!ctx.canAct()) return null;
		if (carry.kind) {
			const s = carry.spot;
			if (carry.kind === 'belt') {
				if (!s) return { label: 'Turn to where it should go' };
				if (s.existing) {
					if (s.belt && s.existing.dir !== s.belt.dir) return { label: 'Turn the belt this way', go: setDown };
					return { label: 'Take the belt back (Q)', go: () => void takeBelt() };
				}
				if (!count('belt')) return { label: 'Out of belts' };
				return s.ok ? { label: `Lay a belt (${count('belt')})`, go: setDown } : { label: s.why ?? '' };
			}
			if (s?.ok) {
				if (carry.kind === 'windmill') return { label: 'Set the windmill up here', go: setDown };
				return { label: poweredAt(s.x, s.z) ? 'Set the drill on the ore' : 'Set the drill on the ore (no power here yet)', go: setDown };
			}
			if (s?.why) return { label: s.why };
			return null;
		}
		for (const d of state.drills) {
			const v = veinOf(d.vein);
			if (!v || !near(v.x, v.z, 2.4) || Math.abs(ctx.pos.y - v.y) > 2.5) continue;
			if (d.stored) return { label: routeOf(d) ? `Collect the ore (${d.stored}, the rest's on the belt)` : `Collect the ore (${d.stored})`, go: () => collect(d) };
			const label = powered(d) ? (routeOf(d) ? 'Pick up the drill (its ore goes to the hopper)' : 'Pick up the drill') : `Pick up the drill (no power: needs a windmill within ${REACH} m)`;
			return { label, go: () => pickUp('drill', d) };
		}
		for (const w of state.windmills) if (near(w.x, w.z, 1.6)) return { label: 'Pick up the windmill', go: () => pickUp('windmill', w) };
		if (near(hopperAt.x, hopperAt.z, 1.5)) {
			return state.hopper ? { label: `Collect the ore (${state.hopper})`, go: collectHopper } : { label: inFlight() ? 'The hopper: ore is on its way' : 'The hopper is empty' };
		}
		return null;
	};
	/** Asked after the rest: by a free vein with a drill in her bag, take it out. */
	const hint = (): Offer | null => {
		if (carry.kind || !ctx.canAct() || !inventory.has(DRILL)) return null;
		for (const v of freeVeins()) if (near(v.x, v.z, 3) && Math.abs(ctx.pos.y - v.y) < 2.5) return { label: 'Take out a drill to set up', go: () => start('drill') };
		return null;
	};

	// On a touch screen, buttons for what Q and Esc do while she's laying belts.
	const bar = document.querySelector<HTMLElement>('[data-belts]');
	const press = (sel: string, run: () => void) =>
		document.querySelector<HTMLButtonElement>(sel)?.addEventListener('pointerdown', (e) => {
			e.preventDefault();
			run();
		});
	press('[data-belts-take]', () => void takeBelt());
	press('[data-belts-done]', stop);

	// ---------- every frame ----------

	let clock = 0;
	const mid = new THREE.Vector3();
	const other = new THREE.Vector3();
	const update = (dt: number, time: number) => {
		const now = Date.now();
		// Once a second, the drills catch up with the clock.
		clock -= dt;
		if (clock <= 0) {
			clock = 1;
			const sig = () => `${state.hopper}/${inFlight()}/${state.drills.reduce((a, d) => a + d.stored, 0)}`;
			const before = sig();
			deliver(now);
			let got = 0;
			for (const v of drillViews) {
				const n = settle(v.d, now);
				if (n) v.busy = 2.5;
				got += n;
			}
			if (got || sig() !== before) save();
		}

		// What she's carrying: in her arms, and where it would go, shown there.
		if (carry.kind && (!count(carry.kind) || !ctx.canCarry()) && !(carry.kind === 'belt' && belts.size && ctx.canCarry())) stop();
		carry.spot = carry.kind ? findSpot() : null;
		if (bar && bar.hidden === (carry.kind === 'belt')) bar.hidden = carry.kind !== 'belt';
		for (const [kind, held] of carry.held) {
			held.visible = carry.kind === kind && count(kind) > 0;
			const l = ctx.figure.node('HandL');
			const r = ctx.figure.node('HandR');
			if (held.visible && l && r) {
				l.getWorldPosition(mid);
				r.getWorldPosition(other);
				mid.add(other).multiplyScalar(0.5);
				ctx.figure.group.worldToLocal(mid);
				held.position.copy(mid).add(other.set(0, -0.3, 0.1));
			}
		}
		for (const [kind, ghost] of carry.ghosts) {
			const s = carry.kind === kind ? carry.spot : null;
			// A belt's ghost shows where one would go, or which way an existing one would turn.
			const show = !!s && (kind !== 'belt' || (!!s.belt && (!s.existing || s.existing.dir !== s.belt.dir) && (!!s.existing || s.ok || !!s.why)));
			ghost.visible = show;
			if (!s || !show) continue;
			if (kind === 'belt' && s.belt) {
				const m = sitBelt(s.belt);
				ghost.position.setFromMatrixPosition(m).setY(ghost.position.y + 0.03);
				ghost.quaternion.setFromRotationMatrix(m);
			} else {
				ghost.position.set(s.x, s.y - 0.05, s.z);
				ghost.rotation.y = kind === 'windmill' ? WIND_YAW : Math.atan2(ctx.pos.x - s.x, ctx.pos.z - s.z);
			}
			const want = s.ok || s.existing ? glass : glassNo;
			ghost.traverse((o) => {
				if (o instanceof THREE.Mesh && o.material !== want) o.material = want;
			});
			const turning = ghost.userData.turning as THREE.Object3D | null;
			if (turning && kind === 'windmill') turning.rotation.z = time;
		}
		let n = 0;
		if (carry.kind) {
			for (const w of state.windmills) n = ringAround(w.x, w.z, n, time);
			if (carry.kind === 'windmill' && carry.spot?.ok) n = ringAround(carry.spot.x, carry.spot.z, n, time);
			dots.instanceMatrix.needsUpdate = true;
		}
		dots.count = n;

		// Windmills turn all the time, a little quicker the higher they stand, in gusts.
		for (const v of windmillViews) {
			v.spin += dt * (1.1 + v.group.position.y * 0.06) * (0.8 + 0.3 * Math.sin(time * 0.4 + v.w.x));
			if (v.rotor) v.rotor.rotation.z = v.spin;
		}
		// A drill with power turns slowly; after it's mined something, it goes at it hard for a moment.
		for (const v of drillViews) {
			const on = powered(v.d);
			for (const lamp of v.lamps) lamp.material = on ? lampOn : lampOff;
			v.busy = Math.max(0, v.busy - dt);
			const waiting = routeOf(v.d) ? state.hopper + inFlight() >= HOPPER_HOLDS : v.d.stored >= BIN_HOLDS;
			v.spin += dt * (!on ? 0 : v.busy > 0 ? 18 : waiting ? 0 : 1.5);
			if (v.bit) {
				v.bit.rotation.y = v.spin;
				v.bit.position.y = damp(v.bit.position.y, BIT_TOP - (v.busy > 0 ? 0.35 : 0), 4, dt);
			}
			v.group.position.x = v.x + (v.busy > 0 ? Math.sin(time * 70) * 0.012 : 0);
			const heap = Math.min(v.d.stored, 6);
			if (heap !== v.shown) {
				v.shown = heap;
				fillHeap(v.heap, heap);
			}
		}
		const inHopper = Math.min(state.hopper, 18);
		if (inHopper !== hopper.shown) {
			hopper.shown = inHopper;
			fillHeap(hopper.heap, inHopper, 0.22);
		}
		const hopperLit = state.drills.some((d) => routeOf(d));
		for (const lamp of hopper.lamps) lamp.material = hopperLit ? lampOn : lampOff;
		drawChevrons(time);
		drawLumps(now, time);
	};

	return {
		offer,
		hint,
		update,
		stop,
		takeBelt,
		poweredAt,
		/** Whether this vein has a drill on it (so she doesn't mine it by hand). */
		drilled: (id: string) => state.drills.some((d) => d.vein === id),
		/** Whether a belt runs through the cell that (x, z) is in (so no block goes there). */
		beltAt: (x: number, z: number) => belts.has(key(Math.floor(x), Math.floor(z))),
		/** Whether she has a windmill or a drill in her arms, or belts out to lay. */
		get carrying() {
			return carry.kind !== null;
		},
		get laying() {
			return carry.kind === 'belt';
		},
		/** How many she has, set up or in her bag. */
		windmills: () => state.windmills.length + inventory.count(WINDMILL),
		drills: () => state.drills.length + inventory.count(DRILL),
		belts: () => belts.size + inventory.count(BELT),
		veinCount: veins.length,
	};
}
