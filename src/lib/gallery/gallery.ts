// The gallery: a round plaza floating in the sky, where Nixchan walks about among portals to the
// games made for her. Each portal is one line in PORTALS; a game made with Nixkit gets one here.
//
// Back from a game, the page is asked for with ?from=<id>, and she steps out of that game's portal.
import * as THREE from 'three';
import { createGame } from '../nixkit/game';
import { addPortal, type Portal, type PortalSpec } from '../nixkit/portal';
import { cloud, cloudSea } from '../nixkit/scenery';

/** The portals, left to right round the far side of the plaza. */
const PORTALS: (Omit<PortalSpec, 'at' | 'facing'> & { id: string })[] = [
	{ id: 'island', title: "Nixchan's Island", note: 'Roam, fish, garden and build', href: '/island/', colors: ['#5fd17a', '#5fb8ff'] },
	{ id: 'cloudhop', title: 'Cloud Hop', note: 'An obstacle course in the sky', href: '/cloudhop/', colors: ['#ff8ad8', '#ffd84d'] },
	{ id: 'soon', title: 'Coming soon', note: 'The next game goes here' },
];

/** How far out from the middle the portals stand, and how far round they spread. */
const RING = 11;
const SPREAD = 1.15;
const PLAZA = 17;

export function startGallery() {
	const canvas = document.querySelector<HTMLCanvasElement>('[data-stage]');
	const loading = document.querySelector<HTMLElement>('[data-loading]');
	if (!canvas) return;

	const game = createGame({
		canvas,
		modelUrl: canvas.dataset.model ?? '',
		spawn: { pos: new THREE.Vector3(0, 0, -6), heading: 0 },
		onFail: (why) => {
			if (loading) loading.textContent = why === 'webgl' ? 'The gallery needs WebGL, which this browser has turned off.' : "Nixchan couldn't make it to the gallery just now. Try reloading?";
		},
	});
	if (!game) return;
	const { parts, hud } = game;

	// ---------- the plaza ----------

	parts.add({ at: [0, -1, 0], size: [PLAZA * 2, 2, PLAZA * 2], shape: 'cylinder', color: '#f2f0ff' });
	// A ring of paler stone round the middle, and posts round the edge.
	parts.add({ at: [0, 0.02, 0], size: [8, 0.04, 8], shape: 'cylinder', color: '#dcd8f6', solid: false });
	parts.add({ at: [0, 0.03, 0], size: [5.6, 0.06, 5.6], shape: 'cylinder', color: '#f2f0ff', solid: false });
	for (let i = 0; i < 16; i++) {
		const a = (i / 16) * Math.PI * 2;
		// Leave the edge open on the near side, where she starts, to look out over the clouds.
		if (Math.cos(a) < -0.85) continue;
		parts.add({ at: [Math.sin(a) * (PLAZA - 0.8), 0.6, Math.cos(a) * (PLAZA - 0.8)], size: [0.7, 1.2, 0.7], shape: 'cylinder', color: '#cfcaf0' });
	}
	// Steps up to a little lookout off to one side, for somewhere to climb.
	for (let i = 0; i < 4; i++) parts.add({ at: [-13 + i * 0.2, 0.3 + i * 0.6, -6 - i * 2.2], size: [2.4, 0.6 + i * 1.2, 2.2], color: i % 2 ? '#dcd8f6' : '#e9e6fb' });
	parts.add({ at: [-12.4, 4.9, -16], size: [4, 1, 4], shape: 'cylinder', color: '#ffe08f' });

	// ---------- the portals ----------

	const portals = new Map<string, Portal>();
	PORTALS.forEach(({ id, ...spec }, i) => {
		const t = PORTALS.length === 1 ? 0 : (i / (PORTALS.length - 1) - 0.5) * 2;
		// From her side, left to right: so round from +x to -x across the far side.
		const a = -t * SPREAD;
		const at: [number, number, number] = [Math.sin(a) * RING, 0, Math.cos(a) * RING];
		portals.set(id, addPortal(game, { ...spec, at, facing: a + Math.PI }));
	});

	// Back from one of them, she steps out of its portal, with the camera out on the plaza looking
	// back at her (behind her, it'd be looking through the portal).
	const from = new URLSearchParams(location.search).get('from');
	const back = from ? portals.get(from) : undefined;
	if (back) {
		game.teleport(back.exit.pos, back.exit.heading, back.exit.heading);
		history.replaceState(null, '', location.pathname);
	}

	// ---------- the sky ----------

	cloudSea(game, { spread: 120, below: -16, count: 40 });
	for (let i = 0; i < 8; i++) {
		const a = i * 0.8 + 0.3;
		cloud(game, Math.cos(a) * (45 + i * 4), 4 + (i % 3) * 7, Math.sin(a) * (45 + i * 4), 3 + (i % 3));
	}

	game.loaded.then(
		() => {
			loading?.setAttribute('hidden', '');
			if (!back) hud.banner("Nixchan's Gallery", 'Walk into a portal to play', 3.5);
		},
		() => {},
	);
	game.start();
	if (import.meta.env.DEV) Object.assign(window, { gallery: game });
}
