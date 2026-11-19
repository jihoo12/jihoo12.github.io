// Scenery for a world in the sky: soft toon clouds, made of a few squashed balls each, that drift.
import * as THREE from 'three';
import type { Game } from './game';

/** A cloud of `size`, at (x, y, z). */
export function cloud(game: Game, x: number, y: number, z: number, size: number) {
	const g = new THREE.Group();
	for (let i = 0; i < 5; i++) {
		const m = new THREE.Mesh(PUFF, material(game));
		const r = size * (0.6 + ((i * 37) % 10) / 20);
		m.scale.set(r * 1.4, r * 0.8, r);
		m.position.set((i - 2) * size * 0.9, ((i * 13) % 3) * size * 0.15, (((i * 7) % 5) - 2) * size * 0.3);
		g.add(m);
	}
	g.position.set(x, y, z);
	game.scene.add(g);
	return g;
}

/** A sea of clouds spread round (x, z), `below` under it, and a few higher up, all drifting. */
export function cloudSea(game: Game, opts: { x?: number; z?: number; spread?: number; below?: number; stretch?: number; count?: number }) {
	const { x = 0, z = 0, spread = 140, below = -18, stretch = 1, count = 46 } = opts;
	const drifting: THREE.Group[] = [];
	for (let i = 0; i < count; i++) {
		const a = i * 2.39996;
		const r = 20 + ((i * 53) % spread);
		drifting.push(cloud(game, x + Math.cos(a) * r, below - (i % 4) * 3, z + Math.sin(a) * r * stretch, 4 + (i % 5) * 1.5));
	}
	game.onUpdate((dt, time) => {
		for (const [i, c] of drifting.entries()) c.position.x += Math.sin(time * 0.05 + i) * dt * 0.3;
	});
	return drifting;
}

const PUFF = new THREE.IcosahedronGeometry(1, 2);
const materials = new WeakMap<Game, THREE.Material>();
function material(game: Game) {
	let m = materials.get(game);
	if (!m) materials.set(game, (m = game.toon({ color: '#ffffff' })));
	return m;
}
