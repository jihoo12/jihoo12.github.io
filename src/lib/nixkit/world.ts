// What a Nixkit world is, as far as Nixchan and the camera are concerned. A world answers a few
// questions about the space round her (how high is what she'd stand on here? how low is what's over
// her head? what's standing near?) and says whether it has a sea to swim in. Everything else
// (what the place looks like, what there is to do there) is the world's own business.
//
// The island answers them from its terrain, rocks, trees and sky island (island/features.ts); a
// world built out of parts answers them from its parts (nixkit/parts.ts).

/** Something standing in the world that she walks round, climbs onto or glides past. A trunk she
 * walks round (`r`, up to `top`, or all the way up without it), a rock she can climb onto (a dome),
 * or a flat-topped plinth she can step or jump onto (a pad). A tree's leaves are a ball (`crown`)
 * that she glides round rather than through, and that the camera won't sit inside. */
export interface Obstacle {
	x: number;
	z: number;
	r: number;
	dome?: { base: number; top: number };
	pad?: number;
	top?: number;
	crown?: { x: number; y: number; z: number; r: number };
	/** For something up off the ground (on a floating island): the height it stands at. It's only
	 * there for her when she's up there too, and not for anything far below it. */
	floor?: number;
}

/** How far below an obstacle's floor she can be and still meet it (as when stepping up onto the
 * floating ground it stands on). */
const FLOOR_REACH = 1.5;

/** Whether an obstacle is there at all for someone at height `y` (unknown: down on the ground). */
export const within = (f: Obstacle, y: number | undefined) => f.floor === undefined || (y !== undefined && y >= f.floor - FLOOR_REACH);

export interface World {
	/** The height of whatever she'd stand on at (x, z), for someone at height `y` (without it, what's
	 * on the ground there, ignoring anything floating). -Infinity where there's nothing at all. */
	groundAt(x: number, z: number, y?: number): number;
	/** How high she can be at (x, z) before her head meets something over it. */
	ceilingAt(x: number, z: number, y: number): number;
	/** The obstacles that might reach (x, z). */
	nearby(x: number, z: number): readonly Obstacle[];
	/** Whether (x, z) is somewhere she can go at all (inside the edge of the world). */
	inside(x: number, z: number): boolean;
	/** A sea at y = 0: where the floor drops below `swimIn` she swims, and finds her feet again above
	 * `swimOut`. Without one, there's only falling. */
	sea?: { swimIn: number; swimOut: number };
	/** How deep the water she's standing in is, at (x, z), when it isn't the sea (a lake up high). */
	wadeDepth?(x: number, z: number, y: number): number;
	/** How hard the wind lifts a glider at (x, z, y), if at all. */
	windLift?(x: number, z: number, y: number): number;
	/** Fallen below this, she's put back where she started (or wherever `respawn` says). */
	fallOut?: number;
}
