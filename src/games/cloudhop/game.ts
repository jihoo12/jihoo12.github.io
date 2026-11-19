// Cloud Hop: an obstacle course in the sky, and the first game made with Nixkit (lib/nixkit).
// Gems along the way, a clock, and the best time remembered. The course itself is in course.ts;
// everything else (Nixchan, how she moves, the camera, the controls, how parts behave) is the kit's.
//
// It's also the example to follow for making a game of your own: see CONTRIBUTING.md.
import * as THREE from 'three';
import type { GameContext } from '../../lib/nixkit/meta';
import { cloud, cloudSea } from '../../lib/nixkit/scenery';
import { buildCourse } from './course';

const clock = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

export default function start({ createGame, store }: GameContext) {
	let glider = false;
	const START = new THREE.Vector3(0, 0, 0);
	const game = createGame({
		spawn: { pos: START, heading: 0 },
		canGlide: () => glider,
		onKey: (key) => {
			if (key === 'r') restart();
		},
	});
	if (!game) return;
	const { parts, hud, teleport } = game;

	let gems = 0;
	const gemStat = hud.stat();
	const { gemCount, finish, wing } = buildCourse(parts, {
		gem: () => {
			gems++;
			gemStat.set(`◆ ${gems}/${gemCount}`);
		},
		wing: () => {
			glider = true;
			hud.banner('A glider!', 'Jump, then jump again in mid-air to glide', 4);
		},
	});

	// ---------- the sky round it: clouds far below, and a few floating far off ----------

	cloudSea(game, { z: 100, stretch: 1.3 });
	for (let i = 0; i < 10; i++) cloud(game, (i % 2 ? 1 : -1) * (40 + i * 6), 6 + (i % 3) * 8, i * 24, 3 + (i % 3));

	// ---------- the run: a clock, the gems, the checkpoints, and the finish ----------

	// The best time, and the most gems in one run.
	const saved = store.get('best') as { time?: unknown; gems?: unknown } | undefined;
	const best = { time: typeof saved?.time === 'number' ? saved.time : null, gems: typeof saved?.gems === 'number' ? saved.gems : 0 };
	const timeStat = hud.stat('0:00.0');
	const bestStat = hud.stat(best.time === null ? 'Best —' : `Best ${clock(best.time)}`);
	gemStat.set(`◆ 0/${gemCount}`);
	let running = false;
	let finished = false;
	let elapsed = 0;
	let falls = 0;

	parts.onCheckpoint(() => hud.toast('Checkpoint!'));
	finish.spec.onTouch = () => {
		if (finished) return;
		finished = true;
		running = false;
		const record = best.time === null || elapsed < best.time;
		if (record) best.time = elapsed;
		best.gems = Math.max(best.gems, gems);
		store.set('best', best);
		bestStat.set(`Best ${clock(best.time!)}`);
		hud.banner(record ? 'New best!' : 'Finished!', `${clock(elapsed)} · ◆ ${gems}/${gemCount} · press R to go again`, 8);
		game.controls.state.waveQueued = true;
	};

	function restart() {
		parts.reset(START, 0);
		teleport(START, 0);
		glider = false;
		wing.reset();
		gems = 0;
		gemStat.set(`◆ 0/${gemCount}`);
		elapsed = 0;
		falls = 0;
		running = false;
		finished = false;
		timeStat.set(clock(0));
		hud.banner('Cloud Hop', 'Off you go!', 2);
	}
	hud.button('Restart', restart);

	const { pos } = game.player;
	let wasHigh = true;
	game.onUpdate((dt) => {
		// The clock starts once she's off the start.
		if (!running && !finished && Math.hypot(pos.x - START.x, pos.z - START.z) > 5.2) running = true;
		if (running) {
			elapsed += dt;
			timeStat.set(clock(elapsed));
		}
		// A fall (she's put back at the checkpoint) gets a word.
		const high = pos.y > -6;
		if (!high && wasHigh) {
			falls++;
			hud.toast(falls === 1 ? 'Whoops! Back to the checkpoint.' : falls % 5 === 0 ? `${falls} falls… you've got this!` : 'Back to the checkpoint.');
		}
		wasHigh = high;
	});

	game.loaded.then(
		() => {
			hud.banner('Cloud Hop', best.time === null ? 'Reach the golden arch' : `Best time ${clock(best.time)}`, 3.5);
		},
		() => {},
	);
	game.start();
}
