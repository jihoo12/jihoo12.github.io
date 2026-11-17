// Power, made at the forge: windmills, and drills that mine the ore veins in the hills by themselves.
//
// Power here is never a number. A machine has it or it doesn't, and all it asks is "is there power
// here?": poweredAt(x, z) is whether a windmill stands within REACH. A windmill wants wind, so it
// only goes up on high ground, where the veins are too. (Later on, belts will carry it further.)
//
// A drill goes over a vein. With power, it mines the ore each time it grows back, into the bin at
// its foot, until the bin is full; she collects it with E. Since power only changes when she sets
// a windmill down or picks one up, a drill that has it now has had it all along since then, and the
// clock alone says how much it's mined while the page was shut (as the garden does): before power
// changes, each drill is worked up to now, and from then on goes by the new answer.
//
// She carries either in her arms (taken out of the bag, or picked up from where it stood, to move
// it), a see-through one shows where it would go, and E sets it there. The windmill and the drill
// are Blender models (tools/island-power).
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
export const MAX_WINDMILLS = 6;
/** How far a windmill's power reaches. */
const REACH = 8;
/** How high the ground has to be for there to be wind enough. */
const WINDY = 3;
/** How much ore a drill's bin holds. */
const BIN_HOLDS = 12;
/** Which way the wind blows from: every windmill faces into it. */
const WIND_YAW = 0.6;
// Sizes from tools/island-power/build.py.
const HUB = new THREE.Vector3(0, 3.55, 0.42);
const TOWER_TOP = 3.2;
const LEG_R = 1.55;
const BIT_TOP = 1.95;
const BIN = { x: 0, z: 1.85 };
/** How far in front of her a windmill she's carrying would go, and how far off a vein can be for
 * the drill she's carrying to go on it. */
const AHEAD = 2.2;
const DRILL_REACH = 3;

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
	groundAt: (x: number, z: number) => number;
	addFeature: (f: Feature) => void;
	removeFeature: (f: Feature) => void;
	/** Where she is, and which way she's turned. */
	pos: THREE.Vector3;
	/** Whether she's on her feet and free (not busy, not swimming, not up on Cloudrest). */
	canAct: () => boolean;
	/** Whether she can keep carrying: out of the water, and down on the island. */
	canCarry: () => boolean;
	/** Whether a windmill may stand at (x, z): clear of trees, rocks, blocks and the kept-clear places. */
	open: (x: number, z: number) => boolean;
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
	/** The time from which it can next mine: when it got power, or when its bin last had room. */
	from: number;
	stored: number;
}
interface Saved {
	windmills: Windmill[];
	drills: Drill[];
}

export function createPower(ctx: PowerContext) {
	const { inventory } = ctx;
	const veins = ctx.veins.veins();
	const veinOf = (id: string) => veins.find((v) => v.id === id);

	const state: Saved = (() => {
		const s: Saved = { windmills: [], drills: [] };
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
						yaw: Number(d.yaw) || 0,
						from: Number(d.from) || Date.now(),
						stored: Math.max(0, Math.min(BIN_HOLDS, Math.floor(Number(d.stored) || 0))),
					});
		return s;
	})();
	const save = () => saveJSON('power', state);

	// ---------- the one question ----------

	const poweredAt = (x: number, z: number) => state.windmills.some((w) => Math.hypot(w.x - x, w.z - z) <= REACH);
	const powered = (d: Drill) => {
		const v = veinOf(d.vein);
		return !!v && poweredAt(v.x, v.z);
	};

	/** Works a drill up to now: each time its vein's had ore since it could last mine, it's mined it
	 * (until the bin's full). Returns how much it mined. */
	const settle = (d: Drill, now = Date.now()) => {
		if (!powered(d)) {
			d.from = now;
			return 0;
		}
		let got = 0;
		let t = Math.max(d.from, ctx.veins.ripeAt(d.vein));
		while (t <= now && d.stored < BIN_HOLDS) {
			d.stored++;
			got++;
			ctx.veins.take(d.vein, t);
			t += ctx.veins.regrowMs;
		}
		// Full, it's only waiting for room; it counts from when there is some.
		if (d.stored >= BIN_HOLDS) d.from = now;
		return got;
	};
	const settleAll = () => {
		let got = 0;
		for (const d of state.drills) got += settle(d);
		if (got) save();
		return got;
	};
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
			inventory.render();
		},
		() => {
			// No models: the machines still work, just unseen.
		},
	);

	inventory.register({
		id: WINDMILL,
		name: 'Windmill',
		kind: 'tool',
		description: `Made at the forge. Set it up on high ground, where the wind blows, and it powers machines within ${REACH} metres of it. One already set up can be picked up again with E, to move it.`,
		color: '#b07a4f',
		icon: () => icons.get('windmill') ?? null,
		actions: [{ label: 'Carry it', run: () => (start('windmill'), ctx.closeMenu()) }],
	});
	inventory.register({
		id: DRILL,
		name: 'Drill',
		kind: 'tool',
		description: `Made at the forge. Set it over an ore vein in the hills; with a windmill near, it mines the ore each time it grows back and keeps up to ${BIN_HOLDS} in its bin for you.`,
		color: '#4f5675',
		icon: () => icons.get('drill') ?? null,
		actions: [{ label: 'Carry it', run: () => (start('drill'), ctx.closeMenu()) }],
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
		const at = (lx: number, lz: number) => ({
			x: v.x + Math.cos(d.yaw) * lx + Math.sin(d.yaw) * lz,
			z: v.z - Math.sin(d.yaw) * lx + Math.cos(d.yaw) * lz,
		});
		const features: Feature[] = [];
		for (let k = 0; k < 3; k++) {
			const a = (TAU * k) / 3 + Math.PI / 6;
			features.push({ ...at(Math.cos(a) * LEG_R, Math.sin(a) * LEG_R), r: 0.15 });
		}
		features.push({ ...at(BIN.x, BIN.z), r: 0.35, top: v.y + 0.6 });
		for (const f of features) ctx.addFeature(f);
		const view: DrillView = { d, x: v.x, group, bit: null, lamps: [], heap, shown: -1, spin: 0, busy: 0, features };
		onModels(() => {
			const o = whole('drill');
			if (!o) return;
			group.add(o);
			view.bit = o.userData.turning;
			o.traverse((m) => {
				if (m instanceof THREE.Mesh && m.userData.lamp) view.lamps.push(m);
			});
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
	/** The ore in a drill's bin, a lump for each up to six. */
	const drawHeap = (view: DrillView) => {
		const n = Math.min(view.d.stored, 6);
		if (n === view.shown) return;
		view.shown = n;
		view.heap.clear();
		for (let k = 0; k < n; k++) {
			const lump = new THREE.Mesh(lumpGeo, oreMat);
			lump.position.set(-0.15 + (k % 3) * 0.15, 0.06 + Math.floor(k / 3) * 0.1, -0.07 + (Math.floor(k / 3) % 2) * 0.12);
			lump.rotation.set(k, k * 2, 0);
			view.heap.add(lump);
		}
	};
	for (const w of state.windmills) showWindmill(w);
	for (const d of state.drills) showDrill(d);

	// ---------- carrying one ----------

	const carry = {
		kind: null as 'windmill' | 'drill' | null,
		held: new Map<string, THREE.Group>(),
		ghosts: new Map<string, THREE.Group>(),
		/** Where it would go, and whether it can. */
		spot: null as { x: number; y: number; z: number; ok: boolean; why?: string; vein?: Vein } | null,
	};
	const glass = new THREE.MeshBasicMaterial({ color: '#bff0ff', transparent: true, opacity: 0.45, depthWrite: false });
	const glassNo = new THREE.MeshBasicMaterial({ color: '#ff9a9a', transparent: true, opacity: 0.35, depthWrite: false });
	onModels(() => {
		for (const kind of ['windmill', 'drill'] as const) {
			const held = whole(kind);
			if (held) {
				held.scale.setScalar(kind === 'windmill' ? 0.16 : 0.22);
				held.visible = false;
				ctx.figure.group.add(held);
				carry.held.set(kind, held);
			}
			const ghost = whole(kind);
			if (ghost) {
				ghost.traverse((o) => {
					if (o instanceof THREE.Mesh) {
						o.material = glass;
						o.castShadow = false;
					}
				});
				ghost.visible = false;
				ctx.scene.add(ghost);
				carry.ghosts.set(kind, ghost);
			}
		}
	});
	// Dots on the ground round each windmill (and the one she's carrying) to show how far its power
	// reaches, while she has a machine in her arms.
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

	const count = (kind: 'windmill' | 'drill') => inventory.count(kind === 'windmill' ? WINDMILL : DRILL);
	function start(kind: 'windmill' | 'drill') {
		if (!count(kind)) return;
		if (!ctx.canCarry()) {
			ctx.toast(kind === 'windmill' ? 'A windmill goes up on the island, on high ground.' : 'A drill goes over an ore vein, up in the hills.');
			return;
		}
		if (kind === 'drill' && !freeVeins().length) {
			ctx.toast('There are drills on every vein already.');
			return;
		}
		carry.kind = kind;
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
			else if (!ctx.open(x, z) || state.windmills.some((w) => Math.hypot(w.x - x, w.z - z) < 3)) why = 'No room for a windmill here';
			return { x, y: ctx.groundAt(x, z), z, ok: !why, why };
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
		if (!inventory.remove(kind === 'windmill' ? WINDMILL : DRILL)) return stop();
		// Whatever's been mined so far goes by the power as it was.
		settleAll();
		if (kind === 'windmill') {
			const w = { x: s.x, z: s.z };
			state.windmills.push(w);
			showWindmill(w);
			const now = state.drills.filter((d) => powered(d)).length;
			ctx.toast(now ? `It's turning! ${now === 1 ? 'A drill' : `${now} drills`} near it ${now === 1 ? 'has' : 'have'} power.` : `It's turning! Machines within ${REACH} metres of it have power.`);
		} else if (s.vein) {
			const d: Drill = { vein: s.vein.id, yaw: Math.atan2(ctx.pos.x - s.vein.x, ctx.pos.z - s.vein.z), from: Date.now(), stored: 0 };
			state.drills.push(d);
			showDrill(d);
			ctx.toast(powered(d) ? 'The drill hums into life over the ore.' : `Set up! It needs a windmill within ${REACH} metres to run.`);
		}
		settleAll();
		save();
		if (!count(kind) || (kind === 'drill' && !freeVeins().length) || (kind === 'windmill' && state.windmills.length >= MAX_WINDMILLS)) stop();
	};

	const collect = (d: Drill) => {
		settle(d);
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
	const pickUp = (kind: 'windmill' | 'drill', thing: Windmill | Drill) => {
		if (!inventory.fits(kind === 'windmill' ? WINDMILL : DRILL)) {
			ctx.toast('Your bag is too full to take it.');
			return;
		}
		settleAll();
		if (kind === 'windmill') {
			state.windmills = state.windmills.filter((w) => w !== thing);
			hideWindmill(thing as Windmill);
			inventory.add(WINDMILL);
		} else {
			const d = thing as Drill;
			if (d.stored && !inventory.add(ctx.ore.id, d.stored)) {
				ctx.toast('Your bag is too full for the ore in its bin.');
				return;
			}
			state.drills = state.drills.filter((o) => o !== d);
			hideDrill(d);
			inventory.add(DRILL);
		}
		// Drills that just lost their power stop here.
		settleAll();
		save();
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
			if (d.stored) return { label: `Collect the ore (${d.stored})`, go: () => collect(d) };
			const label = powered(d) ? 'Pick up the drill' : `Pick up the drill (no power: needs a windmill within ${REACH} m)`;
			return { label, go: () => pickUp('drill', d) };
		}
		for (const w of state.windmills) if (near(w.x, w.z, 1.6)) return { label: 'Pick up the windmill', go: () => pickUp('windmill', w) };
		return null;
	};
	/** Asked after the rest: by a free vein with a drill in her bag, take it out. */
	const hint = (): Offer | null => {
		if (carry.kind || !ctx.canAct() || !inventory.has(DRILL)) return null;
		for (const v of freeVeins()) if (near(v.x, v.z, 3) && Math.abs(ctx.pos.y - v.y) < 2.5) return { label: 'Take out a drill to set up', go: () => start('drill') };
		return null;
	};

	// ---------- every frame ----------

	let clock = 0;
	const mid = new THREE.Vector3();
	const other = new THREE.Vector3();
	const update = (dt: number, time: number) => {
		// Once a second, the drills catch up with the clock.
		clock -= dt;
		if (clock <= 0) {
			clock = 1;
			let got = 0;
			for (const v of drillViews) {
				const n = settle(v.d);
				if (n) v.busy = 2.5;
				got += n;
			}
			if (got) save();
		}

		// What she's carrying: in her arms, and where it would go, shown there.
		if (carry.kind && (!count(carry.kind) || !ctx.canCarry())) stop();
		carry.spot = carry.kind ? findSpot() : null;
		for (const [kind, held] of carry.held) {
			held.visible = carry.kind === kind;
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
			ghost.visible = !!s;
			if (!s) continue;
			ghost.position.set(s.x, s.y - 0.05, s.z);
			ghost.rotation.y = kind === 'windmill' ? WIND_YAW : Math.atan2(ctx.pos.x - s.x, ctx.pos.z - s.z);
			const want = s.ok ? glass : glassNo;
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
			v.spin += dt * (!on ? 0 : v.busy > 0 ? 18 : v.d.stored >= BIN_HOLDS ? 0 : 1.5);
			if (v.bit) {
				v.bit.rotation.y = v.spin;
				v.bit.position.y = damp(v.bit.position.y, BIT_TOP - (v.busy > 0 ? 0.35 : 0), 4, dt);
			}
			v.group.position.x = v.x + (v.busy > 0 ? Math.sin(time * 70) * 0.012 : 0);
			drawHeap(v);
		}
	};

	return {
		offer,
		hint,
		update,
		stop,
		poweredAt,
		/** Whether this vein has a drill on it (so she doesn't mine it by hand). */
		drilled: (id: string) => state.drills.some((d) => d.vein === id),
		/** Whether she has a windmill or a drill in her arms. */
		get carrying() {
			return carry.kind !== null;
		},
		/** How many she has, set up or in her bag. */
		windmills: () => state.windmills.length + inventory.count(WINDMILL),
		drills: () => state.drills.length + inventory.count(DRILL),
		veinCount: veins.length,
	};
}
