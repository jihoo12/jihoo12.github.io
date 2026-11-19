// Cloud Hop's course, all parts: stepping stones, a beam with lava on it, platforms that slide and
// lift, bounce pads up a wall, tiles that fall away underfoot, a belt to run up against, and at the
// top a glider, for the long glide down to the finish.
import type { Parts, PartSpec, Vec3 } from '../../lib/nixkit/parts';

/** Builds the course out of parts: where she starts is (0, 0, 0), facing +z, and the finish is
 * the island with the golden arch. `on` says what picking up a gem, and the glider, does. */
export function buildCourse(parts: Parts, on: { gem: () => void; wing: () => void }) {
	/** A slab whose top is at `top`, with its middle at (x, z). */
	const slab = (x: number, top: number, z: number, w: number, d: number, more: Partial<PartSpec> = {}, h = 1) =>
		parts.add({ at: [x, top - h / 2, z], size: [w, h, d], ...more });
	const stone = (x: number, top: number, z: number, across = 2.6, color = '#a6e3ff') =>
		parts.add({ at: [x, top - 0.5, z], size: [across, 1, across], shape: 'cylinder', color });
	let gemCount = 0;
	const gem = (x: number, y: number, z: number) => {
		gemCount++;
		parts.pickup({
			at: [x, y, z],
			color: '#ff8ad8',
			onPick: on.gem,
		});
	};
	const checkpoint = (at: Vec3, size: Vec3) => parts.checkpoint(at, size);

	// The start: a wide platform of clouds' edge.
	slab(0, 0, 0, 10, 10, { color: '#f2f6ff' }, 2);
	gem(-3.5, 1, 3.5);

	// 1. Stepping stones, rising.
	const stones: [number, number, number][] = [
		[1, 0.5, 8.6],
		[-1, 1, 12.8],
		[1, 1.5, 17],
		[-1, 2, 21.2],
		[1, 2.5, 25.4],
		[-1, 3, 29.6],
	];
	stones.forEach(([x, top, z], i) => {
		stone(x, top, z);
		if (i % 2) gem(x, top + 1.2, z);
	});
	checkpoint([0, 2.5, 35.5], [5, 1, 5]);

	// 2. A beam, with lava on it to hop over, and a red bar sweeping across it.
	const beam: [number, number, boolean][] = [
		[38, 44, false],
		[44, 45.4, true],
		[45.4, 49, false],
		[49, 50.4, true],
		[50.4, 54, false],
		[54, 55.6, true],
		[55.6, 59.5, false],
	];
	for (const [from, to, lava] of beam) slab(0, 3, (from + to) / 2, 1.8, to - from, lava ? { kill: true } : { color: '#c7b8ff' });
	parts.add({ at: [-4.5, 3.4, 47.2], size: [1.2, 0.8, 0.6], kill: true, solid: false, move: { by: [9, 0, 0], period: 3.2 }, color: '#ff5a5f' });
	gem(0, 4.6, 44.7);
	gem(0, 4.6, 54.8);
	checkpoint([0, 2.5, 62], [5, 1, 5]);

	// 3. Platforms that slide from side to side, then one that lifts.
	slab(-4, 3, 68.5, 3, 3, { move: { by: [8, 0, 0], period: 4.5 }, color: '#ffc58f' });
	slab(4, 3, 73.8, 3, 3, { move: { by: [-8, 0, 0], period: 4.5 }, color: '#ffc58f' });
	slab(0, 3, 79, 3, 3, { move: { by: [0, 3, 0], period: 4 }, color: '#ffb070' });
	gem(0, 4.5, 73.8);
	gem(0, 7.6, 79);
	checkpoint([0, 4.5, 86], [6, 1, 6]);

	// 4. Bounce pads up a wall: onto a shelf, then up onto the deck.
	slab(0, 5.4, 90, 3, 1.8, { bounce: 16 }, 0.4);
	parts.add({ at: [0, 7.25, 92], size: [8, 4.5, 2], color: '#d8dcf0' });
	slab(0, 9.9, 92, 3, 1.4, { bounce: 16 }, 0.4);
	gem(3, 10.6, 92);
	checkpoint([0, 11.5, 99], [10, 4, 12]);

	// 5. Tiles that fall away a moment after she's stood on them.
	for (let row = 0; row < 5; row++)
		for (let col = -1; col <= 1; col++) slab(col * 3.2, 13.5, 108 + row * 3.4, 2.4, 2.4, { vanish: { after: 0.55, back: 2.6 }, color: row % 2 ? '#9fe8c8' : '#b6f0d6' });
	gem(-3.2, 14.6, 111.4);
	gem(3.2, 14.6, 118.2);
	checkpoint([0, 13, 126.5], [8, 1, 6]);

	// 6. A belt running back towards her, with hurdles on it: run, and jump them.
	slab(0, 13.5, 140, 3.2, 21, { conveyor: [0, -4.2], color: '#8a93b8' });
	for (const z of [135, 141, 146.5]) slab(0, 14.4, z, 3.2, 0.5, { color: '#ffffff' }, 0.9);
	gem(0, 15.6, 141);
	slab(0, 13.5, 153.5, 6, 6, { color: '#f2f6ff' });

	// 7. Up the stones to the summit, where there's a glider for the long way down.
	const up: [number, number, number][] = [
		[1.2, 14.3, 158.6],
		[-1.2, 15.1, 162.2],
		[1.2, 15.9, 165.8],
		[-1.2, 16.7, 169.4],
	];
	for (const [x, top, z] of up) stone(x, top, z, 3, '#ffe08f');
	checkpoint([0, 17, 174], [5, 1, 5]);
	const wing = parts.pickup({
		at: [0, 18.6, 174.6],
		color: '#ffd84d',
		reach: 1.4,
		onPick: on.wing,
	});

	// The finish, far out and below: an island with a golden arch.
	const finish = slab(0, 6, 210, 12, 12, { color: '#fff3c4' }, 2);
	for (const side of [-1, 1]) parts.add({ at: [side * 3, 8, 210], size: [0.6, 4, 0.6], color: '#ffd84d' });
	parts.add({ at: [0, 10.2, 210], size: [6.6, 0.6, 0.6], color: '#ffd84d' });
	gem(0, 8, 196);
	gem(0, 11, 186);

	return { gemCount, finish, wing };
}
