// The garden's machines, made at the forge: sprinklers, and Sprocket, the clockwork helper.
//
// A sprinkler goes where four plots meet and keeps those four watered from then on: there's room for
// four of them, which covers the whole garden. She carries one there in her arms (taken out of the
// bag, or picked up from where it stood, to move it), a see-through one shows where it would go, the
// nearest free spot, and E sets it down there. Sprocket keeps to its spot
// beside the harvest crate; when something's ripe it trots over, picks it into its basket and drops
// it in the crate, and plants the same again if there are seeds of it in her bag. She collects the
// crate with E. All of it goes on by the clock, page open or not (farm.ts works the garden forward
// a step at a time); what happens while she's there to see, the machines act out. The sprinkler,
// Sprocket and the crate are Blender models (tools/island-farm).
import * as THREE from 'three';
import type { Feature } from './features';
import type { NixFigure } from '../experimental/nix-figure';
import type { Crop, GardenMachines, createFarm } from './farm';
import type { Offer } from './interact';
import type { Inventory } from './inventory';
import { loadJSON, saveJSON } from './save';
import { damp } from './util';

type Garden = ReturnType<typeof createFarm>['garden'];

export interface MachinesContext {
	inventory: Inventory;
	garden: Garden;
	groundAt: (x: number, z: number) => number;
	addFeature: (f: Feature) => void;
	removeFeature: (f: Feature) => void;
	scene: THREE.Scene;
	/** Where she is. */
	pos: THREE.Vector3;
	canAct: () => boolean;
	toast: (text: string) => void;
	/** Her, for holding a sprinkler between her hands. */
	figure: NixFigure;
	/** Whether she's in the water (where she can't carry anything). */
	swimming: () => boolean;
	/** Shuts the bag, when she takes a sprinkler out of it. */
	closeMenu: () => void;
}

export const SPRINKLER = 'sprinkler';
/** Where sprinklers can go: where four plots meet, given as the row and column of the first of them.
 * These four cover all twelve. */
const SLOTS: [number, number][] = [
	[0, 0],
	[0, 2],
	[1, 0],
	[1, 2],
];
export const MAX_SPRINKLERS = SLOTS.length;
// Sizes from tools/island-farm/build.py.
const SPRINKLER_TOP = 0.62;
const HELPER_KEY = new THREE.Vector3(0, 0.4, -0.21);
const BASKET = new THREE.Vector3(0, 0.33, 0.24);
/** Where the crate and Sprocket's spot are, in the garden's own frame: on the right, at the front. */
const CRATE = { lx: 4.7, lz: 2.3 };
const HOME = { lx: 4.4, lz: 1.0 };
const WALK = 1.4;
/** How far from where she stands a free spot may be for the one she carries to go there. */
const REACH = 2.4;

interface Saved {
	sprinklers: { slot: number; at: number }[];
	/** When Sprocket came to the garden, or null if it hasn't yet. */
	helper: number | null;
	/** What's in the crate, by crop. */
	crate: Record<string, number>;
}

export function createMachines(ctx: MachinesContext) {
	const { garden, inventory } = ctx;
	const state: Saved = (() => {
		const s: Saved = { sprinklers: [], helper: null, crate: {} };
		const saved = loadJSON('machines') as Partial<Saved> | undefined;
		if (!saved || typeof saved !== 'object') return s;
		if (Array.isArray(saved.sprinklers))
			for (const k of saved.sprinklers)
				if (k && Number.isInteger(k.slot) && k.slot >= 0 && k.slot < SLOTS.length && !s.sprinklers.some((o) => o.slot === k.slot))
					s.sprinklers.push({ slot: k.slot, at: Number(k.at) || Date.now() });
		if (typeof saved.helper === 'number') s.helper = saved.helper;
		if (saved.crate && typeof saved.crate === 'object')
			for (const [id, n] of Object.entries(saved.crate)) if (garden.crop(id) && typeof n === 'number' && n > 0) s.crate[id] = Math.floor(n);
		return s;
	})();
	const save = () => saveJSON('machines', state);

	inventory.register({
		id: SPRINKLER,
		name: 'Sprinkler',
		kind: 'tool',
		description: 'Made at the forge. Carry it to the garden and set it down where four plots meet; it keeps all four watered. One already set up can be picked up again with E, to move it.',
		color: '#c97b4a',
		actions: [
			{
				label: 'Carry it',
				run: () => {
					startCarrying();
					ctx.closeMenu();
				},
			},
		],
	});

	// ---------- where things are ----------

	const at = (lx: number, lz: number) => {
		const p = garden.world(lx, lz);
		return new THREE.Vector3(p.x, ctx.groundAt(p.x, p.z), p.z);
	};
	const slotPlots = (slot: number) => {
		const [r, c] = SLOTS[slot];
		return [r * garden.cols + c, r * garden.cols + c + 1, (r + 1) * garden.cols + c, (r + 1) * garden.cols + c + 1];
	};
	const slotAt = (slot: number) => {
		const ps = slotPlots(slot).map(garden.plotLocal);
		return at(ps.reduce((a, p) => a + p.lx, 0) / 4, ps.reduce((a, p) => a + p.lz, 0) / 4);
	};
	const plotAt = (i: number) => {
		const { lx, lz } = garden.plotLocal(i);
		return at(lx, lz);
	};
	const crateAt = at(CRATE.lx, CRATE.lz);
	const homeAt = at(HOME.lx, HOME.lz);
	ctx.addFeature({ x: crateAt.x, z: crateAt.z, r: 0.5 });

	// ---------- the models ----------

	const sprinklerViews = new Map<number, { base: THREE.Object3D | null; head: THREE.Object3D | null; spin: number; spraying: number; target: number; gone?: boolean }>();
	// Each spot's post, there for her to walk round while a sprinkler stands on it.
	const posts = SLOTS.map((_, slot) => {
		const p = slotAt(slot);
		return { x: p.x, z: p.z, r: 0.12 };
	});
	const showSprinkler = (slot: number) => {
		if (sprinklerViews.has(slot)) return;
		const view = { base: null as THREE.Object3D | null, head: null as THREE.Object3D | null, spin: Math.random() * 6, spraying: 0, target: slotPlots(slot)[0], gone: false };
		sprinklerViews.set(slot, view);
		const p = slotAt(slot);
		ctx.addFeature(posts[slot]);
		garden.onModels(() => {
			if (view.gone) return;
			const base = garden.make('Sprinkler');
			const head = garden.make('SprinklerHead');
			if (base) {
				base.position.copy(p);
				base.rotation.y = garden.angle + slot;
				ctx.scene.add(base);
				view.base = base;
			}
			if (head) {
				head.position.copy(p).setY(p.y + SPRINKLER_TOP);
				ctx.scene.add(head);
				view.head = head;
			}
		});
	};
	const hideSprinkler = (slot: number) => {
		const view = sprinklerViews.get(slot);
		if (!view) return;
		view.gone = true;
		view.base?.removeFromParent();
		view.head?.removeFromParent();
		sprinklerViews.delete(slot);
		ctx.removeFeature(posts[slot]);
	};
	for (const k of state.sprinklers) showSprinkler(k.slot);

	// ---------- carrying one ----------

	/** A sprinkler on its stake with its head on, put together as one thing to hold or show. */
	const wholeSprinkler = () => {
		const base = garden.make('Sprinkler');
		const head = garden.make('SprinklerHead');
		if (!base) return null;
		const g = new THREE.Group();
		g.add(base);
		if (head) {
			head.position.y = SPRINKLER_TOP;
			g.add(head);
		}
		return g;
	};
	const carry = {
		on: false,
		/** In her arms. */
		held: null as THREE.Group | null,
		/** Where it would go: a see-through one, and a ring on the ground round the spot. */
		ghost: null as THREE.Group | null,
		ring: null as THREE.Mesh | null,
		/** The spot it would go, if there's one in reach. */
		slot: -1,
	};
	garden.onModels(() => {
		carry.held = wholeSprinkler();
		if (carry.held) {
			carry.held.scale.setScalar(0.85);
			carry.held.visible = false;
			ctx.figure.group.add(carry.held);
		}
		const ghost = wholeSprinkler();
		if (ghost) {
			const glass = new THREE.MeshBasicMaterial({ color: '#bff0ff', transparent: true, opacity: 0.45, depthWrite: false });
			ghost.traverse((o) => {
				if (o instanceof THREE.Mesh) {
					o.material = glass;
					o.castShadow = false;
				}
			});
			ghost.visible = false;
			ctx.scene.add(ghost);
			carry.ghost = ghost;
		}
	});
	{
		const ring = new THREE.Mesh(
			new THREE.RingGeometry(0.42, 0.55, 40).rotateX(-Math.PI / 2),
			new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7, depthWrite: false }),
		);
		ring.visible = false;
		ring.renderOrder = 2;
		ctx.scene.add(ring);
		carry.ring = ring;
	}
	const freeSlots = () => SLOTS.map((_, i) => i).filter((slot) => !state.sprinklers.some((k) => k.slot === slot));
	function startCarrying() {
		if (!inventory.has(SPRINKLER)) return;
		if (!freeSlots().length) {
			ctx.toast('There are sprinklers everywhere they can go already.');
			return;
		}
		carry.on = true;
	}
	const stopCarrying = () => {
		carry.on = false;
		carry.slot = -1;
	};
	/** The free spot nearest a little in front of her, if one's in reach. */
	const aim = new THREE.Vector3();
	const pickSlot = () => {
		const turn = ctx.figure.group.getWorldDirection(aim);
		const fx = ctx.pos.x + turn.x * 0.6;
		const fz = ctx.pos.z + turn.z * 0.6;
		let best = -1;
		let bestD = REACH;
		for (const slot of freeSlots()) {
			const p = slotAt(slot);
			const d = Math.hypot(p.x - fx, p.z - fz);
			if (d < bestD) {
				best = slot;
				bestD = d;
			}
		}
		return best;
	};
	const setDown = (slot: number) => {
		if (!inventory.remove(SPRINKLER)) return stopCarrying();
		state.sprinklers.push({ slot, at: Date.now() });
		save();
		showSprinkler(slot);
		garden.grow();
		const more = inventory.count(SPRINKLER);
		if (more && freeSlots().length) ctx.toast(`Set up! ${more} more to carry over.`);
		else {
			stopCarrying();
			ctx.toast('The sprinkler will keep the four plots round it watered.');
		}
	};
	const pickUp = (slot: number) => {
		if (!inventory.fits(SPRINKLER)) {
			ctx.toast('Your bag is too full to take it.');
			return;
		}
		// Whatever it's watered so far stays watered: the garden's worked up to now before it goes.
		garden.grow();
		state.sprinklers = state.sprinklers.filter((k) => k.slot !== slot);
		save();
		hideSprinkler(slot);
		inventory.add(SPRINKLER);
		carry.on = true;
		ctx.toast('Picked up the sprinkler. Carry it to where it should go.');
	};

	let crateView: THREE.Group | null = null;
	const crateHeap = new THREE.Group();
	garden.onModels(() => {
		const crate = garden.make('HarvestCrate');
		if (!crate) return;
		crateView = new THREE.Group();
		crateView.position.copy(crateAt);
		crateView.rotation.y = garden.angle;
		crateView.add(crate, crateHeap);
		ctx.scene.add(crateView);
		drawCrate();
	});
	/** A heap of what's in the crate, a few of each kind showing. */
	function drawCrate() {
		crateHeap.clear();
		let k = 0;
		for (const [id, n] of Object.entries(state.crate)) {
			const c = garden.crop(id);
			if (!c) continue;
			for (let j = 0; j < Math.min(n, 3) && k < 9; j++, k++) {
				const item = garden.make(c.item);
				if (!item) continue;
				item.scale.setScalar(c.id === 'pumpkin' ? 0.35 : c.id === 'strawberry' ? 1.4 : 0.8);
				item.position.set(-0.28 + (k % 3) * 0.28, 0.22 + Math.floor(k / 3) * 0.07, -0.15 + (Math.floor(k / 3) % 2) * 0.15);
				item.rotation.set(k, k * 2, 0);
				crateHeap.add(item);
			}
		}
	}

	// ---------- Sprocket ----------

	interface Task {
		kind: 'pick' | 'sow';
		plot: number;
		crop: Crop;
	}
	const helper = {
		group: null as THREE.Group | null,
		key: null as THREE.Object3D | null,
		carried: null as THREE.Object3D | null,
		queue: [] as Task[],
		/** What it's at: going to a plot, working there, or coming back. */
		task: null as Task | null,
		phase: 'idle' as 'idle' | 'out' | 'work' | 'back',
		clock: 0,
		heading: 0,
		pos: homeAt.clone(),
		hop: 0,
	};
	const showHelper = () => {
		if (helper.group) return;
		const group = new THREE.Group();
		helper.group = group;
		group.position.copy(homeAt);
		helper.heading = garden.angle;
		ctx.scene.add(group);
		garden.onModels(() => {
			const body = garden.make('Helper');
			const key = garden.make('HelperKey');
			if (body) group.add(body);
			if (key) {
				key.position.copy(HELPER_KEY);
				group.add(key);
				helper.key = key;
			}
		});
	};
	if (state.helper !== null) showHelper();

	/** Where it stands to see to plot i: just in front of it. */
	const standAt = (i: number) => {
		const { lx, lz } = garden.plotLocal(i);
		return at(lx, lz + garden.gap * 0.45);
	};
	const nextTask = () => {
		helper.task = helper.queue.shift() ?? null;
		helper.phase = helper.task ? 'out' : 'back';
		helper.clock = 0;
	};
	const finishTask = (t: Task) => {
		const now = Date.now();
		if (t.kind === 'pick') {
			const c = garden.pick(t.plot, now);
			if (c) {
				state.crate[c.id] = (state.crate[c.id] ?? 0) + c.yield;
				save();
				const item = garden.make(c.item);
				if (item && helper.group) {
					item.scale.setScalar(c.id === 'pumpkin' ? 0.3 : c.id === 'strawberry' ? 1.2 : 0.7);
					item.position.copy(BASKET).setY(BASKET.y + 0.05);
					helper.carried?.removeFromParent();
					helper.carried = item;
					helper.group.add(item);
				}
			}
		} else if (inventory.remove(`seed-${t.crop.id}`)) garden.sow(t.plot, t.crop, now);
		else garden.release(t.plot);
		// What it picked may want planting again, straight away.
		garden.grow();
	};

	// ---------- what the garden asks of them ----------

	/** Whether Sprocket's out and about to act things out (rather than them just happening). */
	const acting = () => helper.group !== null && helper.key !== null;
	const machines: GardenMachines = {
		wateredFrom(i) {
			let from: number | null = null;
			for (const k of state.sprinklers) if (slotPlots(k.slot).includes(i)) from = Math.min(from ?? Infinity, k.at);
			return from;
		},
		tendedFrom: () => state.helper,
		pick(i, t, live) {
			const c = garden.crop(garden.plots[i].crop);
			if (!c) return false;
			if (live && acting()) {
				helper.queue.push({ kind: 'pick', plot: i, crop: c });
				garden.hold(i);
				return true;
			}
			const got = garden.pick(i, t);
			if (got) {
				state.crate[got.id] = (state.crate[got.id] ?? 0) + got.yield;
				save();
				drawCrate();
			}
			return true;
		},
		sow(i, c, t, live) {
			if (inventory.count(`seed-${c.id}`) < 1) return false;
			if (live && acting()) {
				helper.queue.push({ kind: 'sow', plot: i, crop: c });
				garden.hold(i);
				return true;
			}
			inventory.remove(`seed-${c.id}`);
			garden.sow(i, c, t);
			return true;
		},
		watered(i, live) {
			if (!live) return;
			for (const k of state.sprinklers) {
				if (!slotPlots(k.slot).includes(i)) continue;
				const view = sprinklerViews.get(k.slot);
				if (view) {
					view.spraying = 1.4;
					view.target = i;
				}
				break;
			}
		},
	};

	// ---------- E ----------

	const near = (p: THREE.Vector3, r: number) => Math.hypot(p.x - ctx.pos.x, p.z - ctx.pos.z) < r;
	const crateCount = () => Object.values(state.crate).reduce((a, b) => a + b, 0);
	const nearGarden = (r: number) => {
		const c = garden.world(0, 0.6);
		return Math.hypot(c.x - ctx.pos.x, c.z - ctx.pos.z) < r;
	};
	const offer = (): Offer | null => {
		if (!ctx.canAct()) return null;
		if (carry.on) {
			if (carry.slot >= 0) {
				const slot = carry.slot;
				return { label: 'Set the sprinkler down here', go: () => setDown(slot) };
			}
			// Hands full in the garden: nothing else to do there till it's set down (or put away).
			if (nearGarden(7)) return { label: 'Put the sprinkler back in the bag', go: stopCarrying };
		} else {
			for (const k of state.sprinklers)
				if (near(slotAt(k.slot), 0.9)) {
					const slot = k.slot;
					return { label: 'Pick up the sprinkler', go: () => pickUp(slot) };
				}
		}
		if (near(crateAt, 1.4)) {
			const n = crateCount();
			if (!n) return state.helper !== null ? { label: 'The harvest crate is empty' } : null;
			return {
				label: `Collect the harvest (${n})`,
				go: () => {
					let took = 0;
					for (const [id, k] of Object.entries(state.crate)) {
						if (!inventory.fits(`crop-${id}`)) continue;
						inventory.add(`crop-${id}`, k);
						took += k;
						delete state.crate[id];
					}
					save();
					drawCrate();
					ctx.toast(took ? `${took} from the crate, into the bag!` : 'Your bag is too full.');
				},
			};
		}
		if (helper.group && near(helper.pos, 1.1)) {
			return {
				label: helper.task ? `Sprocket is busy with the ${helper.task.crop.name.toLowerCase()}` : 'Pat Sprocket',
				go: helper.task
					? undefined
					: () => {
							helper.hop = 1;
							ctx.toast('Sprocket whirrs happily.');
						},
			};
		}
		return null;
	};
	/** Asked after the garden's own offers: in the garden with a sprinkler in her bag, take it out. */
	const hint = (): Offer | null => {
		if (carry.on || !ctx.canAct() || !inventory.has(SPRINKLER) || !freeSlots().length) return null;
		return nearGarden(7) ? { label: 'Take out a sprinkler to set up', go: startCarrying } : null;
	};

	// ---------- every frame ----------

	const v = new THREE.Vector3();
	const nozzle = new THREE.Vector3();
	const drop = new THREE.Vector3();
	const mid = new THREE.Vector3();
	const other = new THREE.Vector3();
	const update = (dt: number, time: number) => {
		// What she's carrying: in her arms, and where it would go, shown there.
		if (carry.on && (!inventory.has(SPRINKLER) || ctx.swimming())) stopCarrying();
		carry.slot = carry.on ? pickSlot() : -1;
		if (carry.held) {
			carry.held.visible = carry.on;
			const l = ctx.figure.node('HandL');
			const r = ctx.figure.node('HandR');
			if (carry.on && l && r) {
				l.getWorldPosition(mid);
				r.getWorldPosition(other);
				mid.add(other).multiplyScalar(0.5);
				ctx.figure.group.worldToLocal(mid);
				carry.held.position.copy(mid).add(other.set(0, -0.3, 0.1));
			}
		}
		const spot = carry.slot >= 0 ? slotAt(carry.slot) : null;
		if (carry.ghost) {
			carry.ghost.visible = !!spot;
			if (spot) {
				carry.ghost.position.copy(spot);
				carry.ghost.rotation.y = garden.angle + carry.slot;
			}
		}
		if (carry.ring) {
			carry.ring.visible = !!spot;
			if (spot) {
				carry.ring.position.copy(spot).setY(spot.y + 0.04);
				carry.ring.scale.setScalar(1 + Math.sin(time * 5) * 0.08);
			}
		}

		// Sprinklers turn slowly while they've something growing to look after, and fast while spraying.
		for (const [slot, view] of sprinklerViews) {
			const busy = slotPlots(slot).some((i) => garden.plots[i].crop && garden.plots[i].stage < 3);
			view.spraying = Math.max(0, view.spraying - dt);
			view.spin += dt * (view.spraying > 0 ? 9 : busy ? 0.6 : 0);
			if (!view.head) continue;
			view.head.rotation.y = view.spin;
			if (view.spraying > 0) {
				view.head.getWorldPosition(nozzle);
				for (let k = 0; k < 3; k++) {
					const a = view.spin + (k * Math.PI * 2) / 3;
					v.set(nozzle.x + Math.sin(a) * 0.2, nozzle.y + 0.03, nozzle.z + Math.cos(a) * 0.2);
					// Over all four plots, with most of it on the one that wanted it.
					const plots = slotPlots(slot);
					const i = Math.random() < 0.5 ? view.target : plots[Math.floor(Math.random() * 4)];
					const p = plotAt(i);
					drop.set(p.x + (Math.random() - 0.5) * 1.2, p.y + 0.15, p.z + (Math.random() - 0.5) * 1.2);
					garden.spray(v, drop);
				}
			}
		}

		const g = helper.group;
		if (!g) return;
		// Sprocket: out to a plot, a moment's work there, then on to the next or back to its spot.
		if (helper.phase === 'idle' && helper.queue.length) nextTask();
		const target = helper.phase === 'out' && helper.task ? standAt(helper.task.plot) : homeAt;
		const moving = helper.phase === 'out' || helper.phase === 'back';
		if (moving) {
			v.subVectors(target, helper.pos).setY(0);
			const d = v.length();
			if (d < 0.05) {
				if (helper.phase === 'out') {
					helper.phase = 'work';
					helper.clock = 0;
				} else {
					helper.phase = 'idle';
					helper.carried?.removeFromParent();
					helper.carried = null;
					drawCrate();
				}
			} else {
				helper.pos.addScaledVector(v.normalize(), Math.min(d, WALK * dt));
				helper.heading = Math.atan2(v.x, v.z);
			}
		}
		if (helper.phase === 'work' && helper.task) {
			const plot = plotAt(helper.task.plot);
			helper.heading = Math.atan2(plot.x - helper.pos.x, plot.z - helper.pos.z);
			const before = helper.clock;
			helper.clock += dt;
			if (before < 0.4 && helper.clock >= 0.4) garden.dig(plot.setY(plot.y + 0.15));
			if (helper.clock >= 1.1) {
				const t = helper.task;
				finishTask(t);
				helper.task = null;
				helper.phase = helper.queue.length ? 'idle' : 'back';
				if (helper.queue.length) nextTask();
			}
		}
		if (helper.phase === 'idle') helper.heading = damp(helper.heading, garden.angle, 2, dt);
		helper.hop = Math.max(0, helper.hop - dt * 2);
		const step = moving ? Math.abs(Math.sin(time * 12)) * 0.05 : 0;
		const work = helper.phase === 'work' ? Math.abs(Math.sin(helper.clock * 9)) * 0.04 : 0;
		g.position.set(helper.pos.x, ctx.groundAt(helper.pos.x, helper.pos.z) + step + Math.sin(helper.hop * Math.PI) * 0.25, helper.pos.z);
		helper.pos.y = g.position.y;
		g.rotation.y = helper.heading;
		g.rotation.x = helper.phase === 'work' ? 0.25 + work : moving ? 0.08 : Math.sin(time * 1.3) * 0.03;
		g.rotation.z = moving ? Math.sin(time * 12) * 0.08 : 0;
		if (helper.key) helper.key.rotation.z = time * (moving || helper.phase === 'work' ? 4 : 1);
	};

	return {
		machines,
		offer,
		hint,
		update,
		/** Sprocket's just been made at the forge: here it comes. */
		helperArrived() {
			if (state.helper !== null) return;
			state.helper = Date.now();
			save();
			showHelper();
			garden.grow();
		},
		/** Whether she has a sprinkler in her arms. */
		get carrying() {
			return carry.on;
		},
		/** How many sprinklers she has, set up or in her bag (there's room for MAX_SPRINKLERS). */
		sprinklers: () => state.sprinklers.length + inventory.count(SPRINKLER),
		get hasHelper() {
			return state.helper !== null;
		},
	};
}
