// The rift at the standing stones: a grey tear in the air inside the ring, on the inland side of
// the altar. It only opens at night, and only once she's been to the very top of the sky (opened
// the chest on Cloudrest's spire); stepping through it (E) takes her to /monochrome, the grey
// place. Coming back, she steps out of it here. Colour seeps into it as she brings the shards home.
import * as THREE from 'three';
import { createRift } from '../monochrome/rift';
import { SHARDS } from '../monochrome/world';
import { groundAt } from './features';
import type { Offer } from '../nixkit/interact';
import { loadJSON } from './save';
import type { Theme } from './theme';
import { damp } from '../nixkit/util';

const THROUGH = '/monochrome/';
/** How far in from the altar the rift hangs, towards the middle of the island. */
const OUT = 2.7;

/** Where the rift hangs, by the stones: (x, z), and the way it faces (towards the middle of the island). */
export function riftSpot(stones: { x: number; z: number }) {
	const d = Math.hypot(stones.x, stones.z) || 1;
	const dx = -stones.x / d;
	const dz = -stones.z / d;
	return { x: stones.x + dx * OUT, z: stones.z + dz * OUT, dx, dz, facing: Math.atan2(dx, dz) };
}

/** Where she steps out, coming back from the grey place: just in front of it, facing away. */
export function riftArrival(stones: { x: number; z: number }) {
	const s = riftSpot(stones);
	const x = s.x + s.dx * 3;
	const z = s.z + s.dz * 3;
	return { pos: new THREE.Vector3(x, groundAt(x, z), z), heading: s.facing };
}

export function createIslandRift(ctx: { scene: THREE.Scene; theme: Theme; stones: { x: number; z: number }; pos: THREE.Vector3; canAct: () => boolean }) {
	const spot = riftSpot(ctx.stones);
	const ground = groundAt(spot.x, spot.z);
	const rift = createRift(2.2, 3.4);
	rift.mesh.position.set(spot.x, ground + 1.75, spot.z);
	rift.mesh.rotation.y = spot.facing;
	ctx.scene.add(rift.mesh);
	// Three little black cubes turn round it, as they hang about in the grey place.
	const cubeMat = new THREE.MeshBasicMaterial({ color: '#232323' });
	const cubes = [0, 1, 2].map(() => {
		const c = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), cubeMat);
		ctx.scene.add(c);
		return c;
	});

	let night = false;
	ctx.theme.on((p) => {
		night = p.night;
		rift.night(p.night);
	});
	// Whether she's been to the top of Cloudrest: the chest there is opened in this same visit,
	// perhaps, so it's asked again now and then rather than once.
	let summited = false;
	let checkClock = 0;
	const check = () => {
		summited = loadJSON('skyChest') === true;
		const saved = loadJSON('monoShards');
		const colors = SHARDS.filter((s) => Array.isArray(saved) && saved.includes(s.id)).map((s) => s.color);
		rift.tint(colors.length / SHARDS.length, colors);
	};
	check();
	rift.open = 0;

	let leaving = false;
	const leave = () => {
		if (leaving) return;
		leaving = true;
		// The screen goes grey, and she's through.
		const fade = document.createElement('div');
		fade.style.cssText = `position:fixed;inset:0;z-index:60;background:${night ? '#0c0c0f' : '#e4e4e4'};opacity:0;transition:opacity .6s;pointer-events:none`;
		document.body.append(fade);
		requestAnimationFrame(() => (fade.style.opacity = '1'));
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
		setTimeout(() => location.assign(THROUGH), reduce ? 0 : 650);
	};

	const near = (r: number) => Math.hypot(ctx.pos.x - spot.x, ctx.pos.z - spot.z) < r && Math.abs(ctx.pos.y - ground) < 2.5;

	return {
		/** E by the rift: through it, once it's open; otherwise a hint, close by the altar. */
		offer: (): Offer | null => {
			if (!ctx.canAct() || leaving) return null;
			if (rift.open > 0.9 && near(2.2)) return { label: 'Step into the grey rift', go: leave };
			if (rift.open < 0.05 && near(1.6)) {
				if (!summited) return { label: 'The air between the stones hums, but nothing opens' };
				if (!night) return { label: 'The air here is thin. Perhaps after dark?' };
			}
			return null;
		},
		update(time: number, dt: number) {
			checkClock -= dt;
			if (checkClock <= 0) {
				checkClock = 1;
				check();
			}
			const want = night && summited ? 1 : 0;
			rift.open = damp(rift.open, want, want ? 1.2 : 3, dt);
			rift.update(time);
			cubes.forEach((c, i) => {
				const a = time * 0.5 + (i * Math.PI * 2) / 3;
				c.visible = rift.open > 0.3;
				// Round it in a flat ring: wide across its face, shallow through it.
				const across = Math.cos(a) * 1.7;
				const through = Math.sin(a) * 0.9;
				c.position.set(spot.x + across * spot.dz + through * spot.dx, ground + 1.8 + Math.sin(time * 0.9 + i * 2) * 0.6, spot.z - across * spot.dx + through * spot.dz);
				c.rotation.set(time * 0.7 + i, time * 0.5, 0);
			});
		},
	};
}
