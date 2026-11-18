// Stone blocks, made at the forge, that she builds with out on the island: a step up to somewhere,
// a wall, a tower to glide from. They go in a grid of one-metre cells, stacked into columns from
// the ground up, so a column is just ground that's higher than the terrain there: the one question
// movement asks ("how high is it here?") answers for blocks too, and nothing can hang in mid-air.
//
// The tops of the columns keep to a half-metre grid, so blocks set side by side on gentle ground
// line up; the bottom block reaches down to wherever the ground under it is lowest, so none floats.
// A first block stands from 0.65 to 1.15 metres out of the highest ground under it:
// too high to walk up, low enough to jump onto. Each one after is a metre.
//
// She takes blocks out with B (or the bag): one in her arms, a see-through one where it would go,
// E sets it there and Q takes the top one of the column in front of her back into the bag. With a
// mouse, where it goes is wherever the pointer is (within her reach): pointing at the ground puts a
// block there, at the top of a stack puts one on top, at its side starts (or adds to) the stack next
// to it. A click sets it, a right-click takes back the block pointed at. On a touch screen, or with
// the pointer off the island, it's the cell in front of her, as before.
import * as THREE from 'three';
import type { NixFigure } from '../experimental/nix-figure';
import type { Offer } from './interact';
import type { Inventory } from './inventory';
import type { Toon } from './look';
import { loadJSON, saveJSON } from './save';
import { skyCeiling } from './skyisle';
import { WORLD_EDGE, deckAt, terrainAt } from './terrain';

export const STONE_BLOCK = 'stone-block';
/** The most blocks in one column. */
const MAX_STACK = 12;
/** The ground of a column reaches this far past its edges, so she stops at its side rather than
 * halfway into it (the ground is asked at her middle, and she's not a point). */
const PAD = 0.3;
/** How far above and below her feet she can set or take a block. */
const REACH_UP = 2.6;
const REACH_DOWN = 1.6;
const MAX_BLOCKS = 2000;
/** How far from her (across the ground) the pointer can set or take a block. */
const POINT_REACH = 6;
/** How far out from the camera the pointer looks for the ground. */
const POINT_FAR = 70;

interface Column {
	i: number;
	j: number;
	n: number;
	/** Where the bottom block starts (just under the lowest ground in the cell), and the top of the
	 * first block. */
	foot: number;
	first: number;
}

const key = (i: number, j: number) => (i + 1000) * 4096 + (j + 1000);
const columns = new Map<number, Column>();
const topOf = (c: Column) => c.first + c.n - 1;

/** The bottom of a column at cell (i, j) and the top of its first block, from the ground there. */
function footing(i: number, j: number) {
	let lo = Infinity;
	let hi = -Infinity;
	for (const [dx, dz] of [
		[0, 0],
		[1, 0],
		[0, 1],
		[1, 1],
		[0.5, 0.5],
	]) {
		const g = terrainAt(i + dx, j + dz);
		lo = Math.min(lo, g);
		hi = Math.max(hi, g);
	}
	return { foot: lo - 0.15, first: Math.ceil((hi + 0.65) * 2) / 2 };
}

/** The top of the highest column under (x, z), or -Infinity where there's none. */
export function blockGround(x: number, z: number) {
	if (!columns.size) return -Infinity;
	let g = -Infinity;
	const ci = Math.floor(x);
	const cj = Math.floor(z);
	for (let i = ci - 1; i <= ci + 1; i++)
		for (let j = cj - 1; j <= cj + 1; j++) {
			const c = columns.get(key(i, j));
			if (!c) continue;
			if (Math.abs(x - (i + 0.5)) < 0.5 + PAD && Math.abs(z - (j + 0.5)) < 0.5 + PAD) g = Math.max(g, topOf(c));
		}
	return g;
}

export interface BlocksContext {
	scene: THREE.Scene;
	toon: Toon;
	inventory: Inventory;
	figure: NixFigure;
	/** Where her feet are. */
	pos: THREE.Vector3;
	/** Whether she's on her feet and free to build (not busy, not up on Cloudrest, nothing in her arms). */
	canAct: () => boolean;
	/** Whether a cell's middle is somewhere blocks may go: not in a place that's kept clear (the
	 * garden, the forge, the stones), and clear of trees and rocks. */
	open: (x: number, z: number) => boolean;
	toast: (text: string) => void;
	closeMenu: () => void;
	/** For aiming with the mouse: the camera, and the canvas the pointer moves over. */
	camera: THREE.Camera;
	canvas: HTMLCanvasElement;
}

export function createBlocks(ctx: BlocksContext) {
	const { inventory } = ctx;

	{
		const saved = loadJSON('blocks');
		if (Array.isArray(saved))
			for (const entry of saved) {
				if (!Array.isArray(entry)) continue;
				const [i, j, n] = entry;
				if (!Number.isInteger(i) || !Number.isInteger(j) || !Number.isInteger(n) || n < 1) continue;
				if (Math.abs(i) > 400 || Math.abs(j) > 400 || columns.has(key(i, j))) continue;
				columns.set(key(i, j), { i, j, n: Math.min(n, MAX_STACK), ...footing(i, j) });
			}
	}
	const save = () => saveJSON('blocks', [...columns.values()].map((c) => [c.i, c.j, c.n]));

	inventory.register({
		id: STONE_BLOCK,
		name: 'Stone Block',
		kind: 'material',
		description: 'Dressed stone, made at the forge, to build with out on the island. Take them out with B, point where one goes, and click (or E) to set it; right-click (or Q) takes one back.',
		color: '#d8c9a8',
		actions: [
			{
				label: 'Build with them',
				run: () => {
					start();
					ctx.closeMenu();
				},
			},
		],
	});

	// ---------- how they look ----------

	/** A unit block, standing on y = 0: its top a little lighter than its sides, as if worn smooth. */
	const blockGeometry = (() => {
		const geo = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
		geo.translate(0, 0.5, 0);
		const n = geo.attributes.normal;
		const col = new Float32Array(n.count * 3);
		const top = new THREE.Color('#efe4cb');
		const side = new THREE.Color('#d2c3a2');
		const under = new THREE.Color('#b6a684');
		for (let k = 0; k < n.count; k++) (n.getY(k) > 0.5 ? top : n.getY(k) < -0.5 ? under : side).toArray(col, k * 3);
		geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
		geo.deleteAttribute('uv');
		return geo;
	})();
	const mesh = new THREE.InstancedMesh(blockGeometry, ctx.toon({ vertexColors: true }), MAX_BLOCKS);
	mesh.castShadow = mesh.receiveShadow = true;
	// The blocks are all over the place, so the mesh's bounds would have to be recomputed each time.
	mesh.frustumCulled = false;
	ctx.scene.add(mesh);
	// Between each block and the next, a thin dark seam, so a stack reads as blocks and not a pillar.
	const seams = new THREE.InstancedMesh(
		new THREE.BoxGeometry(1.004, 0.03, 1.004),
		new THREE.MeshBasicMaterial({ color: '#8f8266' }),
		MAX_BLOCKS,
	);
	seams.frustumCulled = false;
	ctx.scene.add(seams);

	const m = new THREE.Matrix4();
	const tint = new THREE.Color();
	/** Each block a touch lighter or darker than the next, the same every visit. */
	const shade = (i: number, j: number, k: number) => {
		const h = Math.sin(i * 12.9898 + j * 78.233 + k * 37.719) * 43758.5453;
		return 0.93 + (h - Math.floor(h)) * 0.1;
	};
	const draw = () => {
		let b = 0;
		let s = 0;
		for (const c of columns.values()) {
			for (let k = 0; k < c.n && b < MAX_BLOCKS; k++, b++) {
				const bottom = k === 0 ? c.foot : c.first + k - 1;
				const top = c.first + k;
				m.makeScale(1, top - bottom, 1).setPosition(c.i + 0.5, bottom, c.j + 0.5);
				mesh.setMatrixAt(b, m);
				const v = shade(c.i, c.j, k);
				mesh.setColorAt(b, tint.setRGB(v, v, v));
				if (k > 0) {
					m.makeTranslation(c.i + 0.5, bottom, c.j + 0.5);
					seams.setMatrixAt(s++, m);
				}
			}
		}
		mesh.count = b;
		seams.count = s;
		mesh.instanceMatrix.needsUpdate = true;
		seams.instanceMatrix.needsUpdate = true;
		if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
	};
	draw();

	// In her arms, while she's building; where the next one would go; and the one Q would take.
	const held = new THREE.Mesh(blockGeometry, ctx.toon({ vertexColors: true }));
	held.scale.setScalar(0.42);
	held.visible = false;
	ctx.figure.group.add(held);
	const ghost = new THREE.Mesh(
		blockGeometry,
		new THREE.MeshBasicMaterial({ color: '#bff0ff', transparent: true, opacity: 0.4, depthWrite: false }),
	);
	ghost.visible = false;
	ghost.renderOrder = 2;
	ctx.scene.add(ghost);
	const outline = new THREE.LineSegments(
		new THREE.EdgesGeometry(new THREE.BoxGeometry(1.04, 1.04, 1.04).translate(0, 0.5, 0)),
		new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85 }),
	);
	outline.visible = false;
	outline.renderOrder = 2;
	ctx.scene.add(outline);

	// ---------- where she's building ----------

	let on = false;
	const facing = new THREE.Vector3();
	/** The cell in front of her: a step ahead, and never the one she's standing in. */
	const cellAhead = () => {
		ctx.figure.group.getWorldDirection(facing);
		const here = { i: Math.floor(ctx.pos.x), j: Math.floor(ctx.pos.z) };
		for (const d of [1.0, 1.5]) {
			const i = Math.floor(ctx.pos.x + facing.x * d);
			const j = Math.floor(ctx.pos.z + facing.z * d);
			if (i !== here.i || j !== here.j) return { i, j };
		}
		return null;
	};
	/** Whether her middle is within the ground of cell (i, j), so a block there would be under her. */
	const standingIn = (i: number, j: number) => Math.abs(ctx.pos.x - (i + 0.5)) < 0.5 + PAD + 0.05 && Math.abs(ctx.pos.z - (j + 0.5)) < 0.5 + PAD + 0.05;

	// The mouse, while it's over the island (a finger, or the pointer leaving, hands back to her facing).
	const pointer = { on: false, ndc: new THREE.Vector2(), down: null as { x: number; y: number; button: number } | null };
	ctx.canvas.addEventListener('pointermove', (e) => {
		pointer.on = e.pointerType === 'mouse';
		const r = ctx.canvas.getBoundingClientRect();
		pointer.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
	});
	ctx.canvas.addEventListener('pointerleave', () => (pointer.on = false));
	ctx.canvas.addEventListener('pointerdown', (e) => {
		if (e.pointerType !== 'mouse') pointer.on = false;
		pointer.down = { x: e.clientX, y: e.clientY, button: e.button };
	});
	// A click (not a drag, which swings the camera) sets a block; a right-click takes one back.
	ctx.canvas.addEventListener('pointerup', (e) => {
		const down = pointer.down;
		pointer.down = null;
		if (!on || !pointer.on || !down || down.button !== e.button || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
		if (e.button === 0) place();
		else if (e.button === 2) take();
	});
	ctx.canvas.addEventListener('contextmenu', (e) => {
		if (on) e.preventDefault();
	});

	const ray = new THREE.Raycaster();
	const box = new THREE.Box3();
	const hit = new THREE.Vector3();
	const probe = new THREE.Vector3();
	/** The ground (or the sea) at (x, z), leaving the blocks out: they're met as boxes. */
	const surface = (x: number, z: number) => Math.max(terrainAt(x, z), deckAt(x, z), 0);
	/** What the pointer's on: a block column (and which face of it), or the ground; or null. */
	const pointed = (): { column: Column; normal: THREE.Vector3 } | { ground: THREE.Vector3 } | null => {
		ray.setFromCamera(pointer.ndc, ctx.camera);
		const { origin, direction } = ray.ray;
		// The nearest stack it passes into, of those near her.
		let best: { column: Column; normal: THREE.Vector3 } | null = null;
		let bestT = POINT_FAR;
		for (const c of columns.values()) {
			if (Math.hypot(c.i + 0.5 - ctx.pos.x, c.j + 0.5 - ctx.pos.z) > POINT_REACH + 8) continue;
			box.min.set(c.i, c.foot, c.j);
			box.max.set(c.i + 1, topOf(c), c.j + 1);
			if (!ray.ray.intersectBox(box, hit)) continue;
			const t = hit.distanceTo(origin);
			if (t >= bestT) continue;
			bestT = t;
			// Which face: whichever the hit's nearest to.
			const faces: [number, THREE.Vector3][] = [
				[hit.y - box.max.y, new THREE.Vector3(0, 1, 0)],
				[box.min.x - hit.x, new THREE.Vector3(-1, 0, 0)],
				[hit.x - box.max.x, new THREE.Vector3(1, 0, 0)],
				[box.min.z - hit.z, new THREE.Vector3(0, 0, -1)],
				[hit.z - box.max.z, new THREE.Vector3(0, 0, 1)],
			];
			faces.sort((p, q) => Math.abs(p[0]) - Math.abs(q[0]));
			best = { column: c, normal: faces[0][1] };
		}
		// The ground, nearer than that: stepped along, then narrowed down.
		let prev = 0;
		for (let t = 0.5; t < bestT; t += 0.25) {
			probe.copy(origin).addScaledVector(direction, t);
			if (probe.y > surface(probe.x, probe.z)) {
				prev = t;
				continue;
			}
			let lo = prev;
			let hi = t;
			for (let k = 0; k < 8; k++) {
				const mid = (lo + hi) / 2;
				probe.copy(origin).addScaledVector(direction, mid);
				if (probe.y > surface(probe.x, probe.z)) lo = mid;
				else hi = mid;
			}
			return { ground: probe.copy(origin).addScaledVector(direction, hi) };
		}
		return best;
	};

	interface Aim {
		/** Where a block would go: the cell, and the block's bottom and top, or why one can't. */
		place: { i: number; j: number; column: Column | undefined; spot: { bottom: number; top: number } | string } | null;
		/** The column whose top block would be taken back, if one's in reach. */
		take: Column | null;
	}
	const inReach = (c: Column) => topOf(c) - ctx.pos.y <= REACH_UP + 0.2 && topOf(c) - ctx.pos.y >= -REACH_DOWN;
	/** Whether a block could go in cell (i, j), and where; or why not. */
	const placing = (i: number, j: number, far: boolean): NonNullable<Aim['place']> => {
		const cx = i + 0.5;
		const cz = j + 0.5;
		const column = columns.get(key(i, j));
		const feet = ctx.pos.y;
		const f = column ?? footing(i, j);
		const top = column ? topOf(column) + 1 : f.first;
		const bottom = column ? topOf(column) : f.foot;
		let spot: { bottom: number; top: number } | string;
		if (far) spot = 'Too far away. Go closer';
		else if (column && column.n >= MAX_STACK) spot = 'That stack is as high as it goes';
		else if (top - feet > REACH_UP) spot = 'Too high to reach';
		else if (top - feet < -REACH_DOWN) spot = 'Too far down to reach';
		else if (Math.hypot(cx, cz) > WORLD_EDGE - 4 || terrainAt(cx, cz) < -1) spot = 'Too deep to build in';
		else if (!column && (!ctx.open(cx, cz) || [0, 1].some((dx) => [0, 1].some((dz) => deckAt(i + dx, j + dz) > -Infinity)))) spot = 'No building here';
		else if (skyCeiling(cx, cz, top) < top + 2.5) spot = 'No room under the sky island';
		else if (standingIn(i, j)) spot = 'Step back to make room';
		else spot = { bottom, top };
		return { i, j, column, spot };
	};
	const away = (i: number, j: number) => Math.hypot(i + 0.5 - ctx.pos.x, j + 0.5 - ctx.pos.z) > POINT_REACH;
	const aimAt = (usePointer = pointer.on): Aim | null => {
		if (usePointer) {
			const at = pointed();
			if (!at) return null;
			if ('ground' in at) {
				const i = Math.floor(at.ground.x);
				const j = Math.floor(at.ground.z);
				const column = columns.get(key(i, j));
				return { place: placing(i, j, away(i, j)), take: column && !away(i, j) && inReach(column) ? column : null };
			}
			const { column, normal } = at;
			const take = !away(column.i, column.j) && inReach(column) ? column : null;
			// On top: another on the stack. On a side: the stack next to it. Underneath: nothing.
			if (normal.y > 0.5) return { place: placing(column.i, column.j, away(column.i, column.j)), take };
			if (normal.y < -0.5) return { place: null, take };
			const i = column.i + normal.x;
			const j = column.j + normal.z;
			return { place: placing(i, j, away(i, j)), take };
		}
		const cell = cellAhead();
		if (!cell) return null;
		const column = columns.get(key(cell.i, cell.j));
		return { place: placing(cell.i, cell.j, false), take: column && inReach(column) ? column : null };
	};

	// ---------- setting and taking ----------

	function start() {
		if (!inventory.has(STONE_BLOCK)) {
			ctx.toast('No stone blocks in the bag. The forge makes them from iron ore.');
			return;
		}
		on = true;
	}
	const stop = () => {
		on = false;
	};
	const place = () => {
		if (!ctx.canAct()) return;
		const p = aimAt()?.place;
		if (!p) return;
		if (typeof p.spot === 'string') return ctx.toast(p.spot);
		if (!inventory.remove(STONE_BLOCK)) {
			ctx.toast('Out of blocks. Q takes them back.');
			return;
		}
		if (p.column) p.column.n++;
		else columns.set(key(p.i, p.j), { i: p.i, j: p.j, n: 1, ...footing(p.i, p.j) });
		save();
		draw();
		inventory.render();
	};
	const take = () => {
		if (!ctx.canAct()) return false;
		const column = aimAt(on && pointer.on)?.take;
		if (!column) return false;
		if (!inventory.fits(STONE_BLOCK)) {
			ctx.toast('Her bag is too full to take it.');
			return true;
		}
		inventory.add(STONE_BLOCK);
		column.n--;
		if (column.n <= 0) columns.delete(key(column.i, column.j));
		save();
		draw();
		inventory.render();
		return true;
	};

	// ---------- E, and every frame ----------

	// On a touch screen, buttons for what Q and B do: take one back, and put them away.
	const bar = document.querySelector<HTMLElement>('[data-build]');
	const press = (sel: string, run: () => void) =>
		document.querySelector<HTMLButtonElement>(sel)?.addEventListener('pointerdown', (e) => {
			e.preventDefault();
			run();
		});
	press('[data-build-take]', () => void take());
	press('[data-build-done]', stop);

	let current: Aim | null = null;
	const offer = (): Offer | null => {
		if (!on || !ctx.canAct()) return null;
		const aim = current;
		const left = inventory.count(STONE_BLOCK);
		if (!left) return { label: aim?.take ? 'Out of blocks (Q takes one back)' : 'Out of blocks' };
		if (!aim?.place) return { label: pointer.on ? 'Point at where it should go' : 'Turn to where it should go' };
		if (typeof aim.place.spot === 'string') return { label: aim.place.spot };
		return { label: pointer.on ? `Place a block (${left}) · or click` : `Place a block (${left})`, go: place };
	};
	/** Asked last, when she's not building: a block of hers right in front of her can be taken back. */
	const hint = (): Offer | null => {
		if (on || !columns.size || !ctx.canAct()) return null;
		return aimAt(false)?.take ? { label: 'Take the block back', go: () => void take() } : null;
	};

	const mid = new THREE.Vector3();
	const other = new THREE.Vector3();
	const update = (time: number) => {
		if (on && !ctx.canAct()) {
			// Busy, swimming or in the air: she keeps her blocks, but there's nothing to aim at.
			current = null;
		} else current = on ? aimAt() : null;
		held.visible = on;
		if (bar && bar.hidden === on) bar.hidden = !on;
		if (on) {
			const l = ctx.figure.node('HandL');
			const r = ctx.figure.node('HandR');
			if (l && r) {
				l.getWorldPosition(mid);
				r.getWorldPosition(other);
				mid.add(other).multiplyScalar(0.5);
				ctx.figure.group.worldToLocal(mid);
				held.position.copy(mid).add(other.set(0, -0.2, 0.08));
			}
		}
		const p = current?.place;
		const spot = p && typeof p.spot !== 'string' && inventory.has(STONE_BLOCK) ? p.spot : null;
		ghost.visible = !!spot;
		if (spot && p) {
			ghost.position.set(p.i + 0.5, spot.bottom, p.j + 0.5);
			ghost.scale.set(1, spot.top - spot.bottom, 1);
			(ghost.material as THREE.MeshBasicMaterial).opacity = 0.32 + Math.sin(time * 5) * 0.08;
		}
		outline.visible = !!current?.take;
		if (current?.take) {
			const c = current.take;
			const bottom = c.n === 1 ? c.foot : topOf(c) - 1;
			outline.position.set(c.i + 0.5, bottom, c.j + 0.5);
			outline.scale.set(1, topOf(c) - bottom, 1);
		}
	};

	return {
		offer,
		hint,
		update,
		/** B: take blocks out to build with, or put them away. */
		toggle() {
			if (on) stop();
			else start();
		},
		stop,
		/** Q: takes back the top block in front of her, if there is one; returns whether there was. */
		take: () => (on || columns.size ? take() : false),
		get on() {
			return on;
		},
	};
}

export type Blocks = ReturnType<typeof createBlocks>;
