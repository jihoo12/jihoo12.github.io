// A tiny game to start from: a platform, some stepping stones, a gem to find and a goal.
// Change anything. See CONTRIBUTING.md, and src/games/cloudhop/ for a bigger example.
import * as THREE from 'three';
import type { GameContext } from '../../lib/nixkit/meta';
import { cloudSea } from '../../lib/nixkit/scenery';

export default function start({ createGame, store }: GameContext) {
	const game = createGame({ spawn: { pos: new THREE.Vector3(0, 0, 0), heading: 0 } });
	if (!game) return;
	const { parts, hud } = game;

	// Somewhere to stand. `at` is a part's middle, `size` is how wide, tall and deep it is.
	parts.add({ at: [0, -0.5, 0], size: [8, 1, 8], color: '#f2f6ff' });
	// Stepping stones. She jumps about 1.4 m up, and 4 to 5 m across at a run.
	for (let i = 1; i <= 4; i++) parts.add({ at: [0, -0.5 + i * 0.5, 4 + i * 3.6], size: [2.6, 1, 2.6], shape: 'cylinder', color: '#a6e3ff' });
	// The goal.
	const goal = parts.add({ at: [0, 2.5, 24], size: [6, 1, 6], color: '#ffd84d' });

	let gems = 0;
	const gemStat = hud.stat('◆ 0');
	parts.pickup({ at: [0, 3, 14.8], onPick: () => gemStat.set(`◆ ${++gems}`) });

	// `store` remembers things between visits, here how many times she's made it.
	goal.spec.onTouch = () => {
		store.set('wins', Number(store.get('wins') ?? 0) + 1);
		hud.banner('You made it!', `◆ ${gems} gem${gems === 1 ? '' : 's'}`);
	};

	cloudSea(game, { z: 10 });
	game.loaded.then(() => hud.banner('My Game', 'Hop to the golden platform'), () => {});
	game.start();
}
