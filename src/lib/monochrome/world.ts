// The grey place's shape. It isn't a map: it's a graph of square cells, each 12 m across, and each
// side of a cell either walled or joined to a side of some other cell, any cell, turned any way.
// Most of the joins are the ordinary kind (a row of cells side by side), but not all of them: a
// hall joined end to end runs on for ever, a wood joined edge to edge goes round, three cells meet
// round an obelisk where there ought to be four, a little house is bigger inside than out, and the
// way round a tower takes two laps to come back to where it started.
//
// So the question everything here asks isn't "how high is the ground?" (it's flat) but "which cell
// is she in, and where in it?". To draw it, the cells round hers are laid out flat round her, side
// to side, as if the world were an ordinary one, out as far as the fog: `place` does that.
// Everything else (walking, the camera, the snowflakes she leaves) works in that laid-out frame.
//
// Sides are numbered clockwise from north, looking down: 0 north (-z), 1 east (+x), 2 south (+z),
// 3 west (-x). A cell turned `rot` quarter-turns has its side s facing (s + rot) % 4.

export const CELL = 12;
export const HALF = CELL / 2;

export type Side = 0 | 1 | 2 | 3;
export const DIRS: readonly [number, number][] = [
	[0, -1],
	[1, 0],
	[0, 1],
	[-1, 0],
];

/** What's along a side: nothing (it's joined to the next cell), a wall, a wall with a doorway
 * through it (joined to the next cell, through the door), or the tower's wall. */
export type Edge = 'open' | 'wall' | 'door' | 'tall';

export type Region = 'threshold' | 'hall' | 'wood' | 'court' | 'yard' | 'house' | 'tower';

export const REGION_NAMES: Record<Region, string> = {
	threshold: 'The Threshold',
	hall: 'The Endless Hall',
	wood: 'The Pillar Wood',
	court: 'The Three-Corner Court',
	yard: 'The Little House',
	house: 'Inside the Little House',
	tower: 'The Tower That Isn’t',
};

/** The three colour shards, each somewhere in the grey. */
export type ShardId = 'rose' | 'sky' | 'gold';
export const SHARDS: { id: ShardId; name: string; color: string }[] = [
	{ id: 'rose', name: 'Rose Shard', color: '#ff7aa8' },
	{ id: 'sky', name: 'Sky Shard', color: '#6fd0ff' },
	{ id: 'gold', name: 'Gold Shard', color: '#ffd84d' },
];

/** Something standing in a cell, in the cell's own frame (x east, z south, from its middle). */
export type Prop =
	| { kind: 'column' | 'lamp' | 'cube' | 'plinth'; x: number; z: number }
	| { kind: 'arch' | 'stairs' | 'riftframe'; x: number; z: number; yaw: number }
	| { kind: 'tablet'; x: number; z: number; yaw: number; text: string }
	| { kind: 'obelisk'; corner: 0 | 1 | 2 | 3 };

export interface Link {
	to: Cell;
	/** The side of `to` she comes in by. */
	side: Side;
}

export interface Cell {
	id: string;
	region: Region;
	/** Which shade of floor: cells side by side in a patch alternate, like a chessboard. */
	shade: 0 | 1;
	edges: [Edge, Edge, Edge, Edge];
	links: [Link | null, Link | null, Link | null, Link | null];
	props: Prop[];
	/** A colour shard on a plinth in the middle. */
	shard?: ShardId;
	/** For banners: a cell that announces itself differently from the rest of its region. */
	note?: string;
}

// ---------- building it ----------

const cells = new Map<string, Cell>();

function cell(id: string, region: Region, shade: 0 | 1): Cell {
	const c: Cell = { id, region, shade, edges: ['wall', 'wall', 'wall', 'wall'], links: [null, null, null, null], props: [] };
	cells.set(id, c);
	return c;
}

/** Joins side `sa` of cell a to side `sb` of cell b, both ways: open, or through a doorway. */
function join(a: string, sa: Side, b: string, sb: Side, edge: 'open' | 'door' = 'open') {
	const A = get(a);
	const B = get(b);
	A.edges[sa] = edge;
	B.edges[sb] = edge;
	A.links[sa] = { to: B, side: sb };
	B.links[sb] = { to: A, side: sa };
}

/** Walls side `s` of a cell up again (and whatever it was joined to on that side). */
function unjoin(a: string, s: Side) {
	const A = get(a);
	const link = A.links[s];
	if (link) {
		link.to.edges[link.side] = 'wall';
		link.to.links[link.side] = null;
	}
	A.edges[s] = 'wall';
	A.links[s] = null;
}

function get(id: string) {
	const c = cells.get(id);
	if (!c) throw new Error(`no cell ${id}`);
	return c;
}

/** An ordinary patch of cells, from rows of names: cells next to each other are joined; '#' is a
 * hole (a tower, a house) whose sides are walled, `tall` for a tower. Ids are prefix + name. */
function patch(prefix: string, region: Region, rows: string[], o: { tall?: boolean } = {}) {
	const grid = rows.map((r) => r.trim().split(/\s+/));
	grid.forEach((row, z) =>
		row.forEach((name, x) => {
			if (name === '#') return;
			const c = cell(prefix + name, region, ((x + z) % 2) as 0 | 1);
			// Walls round a hole are the hole's: the tower's are tall.
			for (const s of [0, 1, 2, 3] as Side[]) {
				const nx = x + DIRS[s][0];
				const nz = z + DIRS[s][1];
				if (grid[nz]?.[nx] === '#' && o.tall) c.edges[s] = 'tall';
			}
		}),
	);
	grid.forEach((row, z) =>
		row.forEach((name, x) => {
			if (name === '#') return;
			const east = row[x + 1];
			if (east && east !== '#') join(prefix + name, 1, prefix + east, 3);
			const south = grid[z + 1]?.[x];
			if (south && south !== '#') join(prefix + name, 2, prefix + south, 0);
		}),
	);
}

function prop(id: string, ...props: Prop[]) {
	get(id).props.push(...props);
}

// The Threshold, where the rift lets out: four cells, with the way back to the island in the first.
patch('a', 'threshold', ['1 2', '3 4']);
prop('a1', { kind: 'riftframe', x: 0, z: -2, yaw: 0 }, { kind: 'lamp', x: -4, z: 2 }, { kind: 'lamp', x: 4, z: 2 });
prop(
	'a2',
	{ kind: 'arch', x: 1, z: 0, yaw: Math.PI / 2 },
	{ kind: 'tablet', x: -3, z: 3.5, yaw: 0.4, text: 'The colour went out of this place long ago. Three pieces of it are still here somewhere.' },
);
prop('a3', { kind: 'stairs', x: -2.5, z: 2, yaw: 0 }, { kind: 'cube', x: 3, z: -2 });
prop('a4', { kind: 'lamp', x: 0, z: 0 }, { kind: 'cube', x: -3, z: 3 }, { kind: 'cube', x: 3.5, z: -3.5 });

// The Endless Hall: three cells joined end to end in a ring, so it runs on for ever, with a
// colonnade down each side. Its doors are at the sides: in from the Threshold, out to the wood.
patch('h', 'hall', ['1 2 3']);
join('h3', 1, 'h1', 3);
join('a2', 1, 'h2', 0);
for (const id of ['h1', 'h2', 'h3'])
	for (const x of [-4, 0, 4])
		for (const z of [-3.6, 3.6])
			if (!(id === 'h2' && z < 0 && x === 0) && !(id === 'h3' && z > 0 && x === 0)) prop(id, { kind: 'column', x, z });
prop('h1', { kind: 'tablet', x: 0, z: -4.6, yaw: 0, text: 'This hall goes on and on. It keeps its doors at the sides.' }, { kind: 'lamp', x: -2, z: 0 });
prop('h2', { kind: 'lamp', x: 2, z: 0 });
prop('h3', { kind: 'lamp', x: -2, z: 0 });

// The Pillar Wood: three by three, its east edge joined round to its west, so it goes round and
// round. In from the Threshold and the hall at the top, out to the court at the bottom.
patch('w', 'wood', ['0 1 2', '3 4 5', '6 7 8']);
for (const [e, w] of [
	['w2', 'w0'],
	['w5', 'w3'],
	['w8', 'w6'],
])
	join(e, 1, w, 3);
join('a3', 2, 'w0', 0);
join('h3', 2, 'w1', 0);
{
	// The columns stand about at random (the same random every time), never too near each other,
	// the middle of a side (where she comes in) or a cell's middle (where the plinth and tablet go).
	let seed = 7;
	const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
	for (let i = 0; i < 9; i++) {
		const placed: [number, number][] = [];
		for (let tries = 0; placed.length < 5 && tries < 200; tries++) {
			const x = (rand() * 2 - 1) * (HALF - 1.4);
			const z = (rand() * 2 - 1) * (HALF - 1.4);
			if (Math.hypot(x, z) < 2.6) continue;
			if ((Math.abs(x) < 1.6 && Math.abs(z) > HALF - 3) || (Math.abs(z) < 1.6 && Math.abs(x) > HALF - 3)) continue;
			if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 2.6)) continue;
			placed.push([x, z]);
			prop(`w${i}`, { kind: 'column', x, z });
		}
	}
}
prop('w4', { kind: 'tablet', x: 0, z: 0, yaw: 0, text: 'The wood goes round and round. Leave yourself a sign (Q) and you’ll know when you’re back.' });
get('w8').shard = 'rose';

// The Three-Corner Court: three cells round an obelisk, where four would make a square. Going
// round it, the third corner turns straight back into the first.
cell('k1', 'court', 0);
cell('k2', 'court', 1);
cell('k3', 'court', 0);
join('k1', 1, 'k2', 3);
join('k2', 2, 'k3', 0);
join('k3', 3, 'k1', 2);
join('w7', 2, 'k1', 0);
prop('k1', { kind: 'obelisk', corner: 2 }, { kind: 'tablet', x: -2.5, z: -2.5, yaw: 0.6, text: 'Three corners make a square here. Walk round and count them.' });
prop('k2', { kind: 'obelisk', corner: 3 }, { kind: 'cube', x: 2, z: -2 }, { kind: 'lamp', x: 3.5, z: 3 });
prop('k3', { kind: 'obelisk', corner: 0 }, { kind: 'cube', x: 2.5, z: 2.5 }, { kind: 'cube', x: -1, z: 3.5 });

// The Little House: a yard of eight cells round a house only one cell big, with a door on its
// south side. Inside it's three cells by three.
patch('y', 'yard', ['a b c', 'd # e', 'f g h']);
join('k2', 1, 'yd', 3, 'door');
prop('ya', { kind: 'stairs', x: 0, z: 2.5, yaw: Math.PI / 2 }, { kind: 'cube', x: -3, z: -3 });
prop('yb', { kind: 'lamp', x: 0, z: -2 });
prop('yc', { kind: 'cube', x: 2, z: 2 }, { kind: 'cube', x: -2, z: -3 });
prop('yf', { kind: 'arch', x: 0, z: 0, yaw: 0.8 });
prop('yg', { kind: 'tablet', x: -3.5, z: -2.5, yaw: 0, text: 'A little house, only one room big. Or so it looks from out here.' }, { kind: 'lamp', x: 3, z: -3.5 });
prop('yh', { kind: 'stairs', x: 1, z: 1, yaw: -Math.PI / 2 });
prop('ye', { kind: 'lamp', x: -2, z: 0 });
patch('r', 'house', ['0 1 2', '3 4 5', '6 7 8']);
join('yg', 0, 'r7', 2, 'door');
prop('r7', { kind: 'tablet', x: 3, z: 3.5, yaw: Math.PI, text: 'Bigger on the inside. Most houses are, if you think about it.' });
prop('r4', { kind: 'lamp', x: 0, z: 0 });
for (const id of ['r0', 'r2', 'r6', 'r8']) prop(id, { kind: 'lamp', x: 0, z: 0 });
get('r1').shard = 'sky';

// The Tower That Isn't: eight cells round a tower that rises into the fog, but there are two of
// each of them, and going round once takes her from the one ring to the other: twice round to
// come back. Only the first ring has the way in, and only the second has the shard.
patch('tA', 'tower', ['1 2 3', '4 # 5', '6 7 8'], { tall: true });
patch('tB', 'tower', ['1 2 3', '4 # 5', '6 7 8'], { tall: true });
unjoin('tA2', 1);
unjoin('tB2', 1);
join('tA2', 1, 'tB3', 3);
join('tB2', 1, 'tA3', 3);
join('ye', 1, 'tA4', 3);
for (const ring of ['tA', 'tB']) {
	prop(`${ring}1`, { kind: 'lamp', x: 2, z: 2 });
	prop(`${ring}3`, { kind: 'lamp', x: -2, z: 2 });
	prop(`${ring}6`, { kind: 'lamp', x: 2, z: -2 });
	prop(`${ring}8`, { kind: 'lamp', x: -2, z: -2 });
}
prop('tA5', { kind: 'plinth', x: 0, z: 0 }, { kind: 'tablet', x: 2.5, z: 3, yaw: -0.5, text: 'An empty plinth. As if its twin were round the other side.' });
get('tB5').shard = 'gold';
get('tB4').note = 'Wasn’t there a way in here?';
prop('tA4', { kind: 'tablet', x: 3, z: -3.5, yaw: 0, text: 'Twice round the tower to come back where you started.' });

export const START = get('a1');
export const CELLS = [...cells.values()];
export const cellById = (id: string) => cells.get(id);

// ---------- laying it out round her ----------

/** A cell where it's been laid out: in slot (gx, gz) of the flat grid round hers, turned `rot`. */
export interface Placed {
	cell: Cell;
	gx: number;
	gz: number;
	rot: number;
}

/** The side of a placed cell that faces `view` side of the laid-out grid. */
export const localSide = (rot: number, view: number) => (((view - rot) % 4) + 4) % 4;

/** A point in a cell's own frame, turned `rot` quarter-turns clockwise (looking down). */
export function turn(x: number, z: number, rot: number): [number, number] {
	switch (((rot % 4) + 4) % 4) {
		case 1:
			return [-z, x];
		case 2:
			return [-x, -z];
		case 3:
			return [z, -x];
		default:
			return [x, z];
	}
}

/** Through a doorway costs more than across an open side, so that from outside a house its
 * inside doesn't spread out over the yard round it: the yard gets those slots first. */
const DOOR_COST = 4;

/**
 * Lays the cells round `root` out flat, as far as `radius` slots each way: `root` in slot (0, 0),
 * turned `rot`, and each cell beside it in the slot that side faces, turned so the sides that are
 * joined face each other, and so on outwards. Where two ways round reach the same slot (as they do
 * all over this place), whichever is the shorter way gets it. The cells right beside hers always
 * get their slots, so the next step she takes is always into the cell that's really there.
 */
export function place(root: Cell, rot: number, radius = 3, maxCost = 11): Placed[] {
	const taken = new Map<number, Placed>();
	const key = (gx: number, gz: number) => (gx + 64) * 128 + (gz + 64);
	// A queue in buckets by cost (the costs are small whole numbers).
	const buckets: Placed[][] = [];
	const push = (p: Placed, cost: number) => (buckets[cost] ??= []).push(p);
	const out: Placed[] = [];
	const first: Placed = { cell: root, gx: 0, gz: 0, rot };
	taken.set(key(0, 0), first);
	out.push(first);
	const expand = (p: Placed, cost: number, forced: boolean) => {
		for (let view = 0; view < 4; view++) {
			const s = localSide(p.rot, view);
			const link = p.cell.links[s];
			if (!link) continue;
			const gx = p.gx + DIRS[view][0];
			const gz = p.gz + DIRS[view][1];
			if (Math.max(Math.abs(gx), Math.abs(gz)) > radius) continue;
			const next: Placed = { cell: link.to, gx, gz, rot: (((view + 2 - link.side) % 4) + 4) % 4 };
			if (forced) {
				// Her own neighbours: into their slots ahead of everything else (though what's beyond
				// a doorway still comes later, as it costs more).
				taken.set(key(gx, gz), next);
				out.push(next);
			}
			push(next, cost + (p.cell.edges[s] === 'door' ? DOOR_COST : 1));
		}
	};
	expand(first, 0, true);
	for (let cost = 1; cost < buckets.length && cost <= maxCost; cost++) {
		for (const p of buckets[cost] ?? []) {
			const k = key(p.gx, p.gz);
			const there = taken.get(k);
			// The forced neighbours are already in; anything else arriving at a taken slot is too late.
			if (there && there !== p) continue;
			if (!there) {
				taken.set(k, p);
				out.push(p);
			}
			expand(p, cost, false);
		}
	}
	return out;
}
