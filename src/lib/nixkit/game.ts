// Nixkit: a little kit for making games with Nixchan in them. `createGame` sets up everything a game
// has in common (the renderer and the light, Nixchan herself and how she's steered, the camera
// that follows her, the touch controls and the HUD), and a world of parts for her to run about on.
// The game itself is what it adds: parts, pickups, and whatever it wants to do each frame.
//
//   const game = createGame({ canvas, modelUrl, spawn: { pos: new THREE.Vector3(0, 0.5, 0), heading: 0 } });
//   game.parts.add({ at: [0, 0, 0], size: [10, 1, 10] });
//   game.parts.add({ at: [0, 1, 9], size: [3, 1, 3], move: { by: [5, 0, 0], period: 3 } });
//   game.onUpdate((dt, time) => { ... });
//   game.start();
//
// What's here came out of Nixchan's island (/island), which uses the same player, camera, controls
// and look: the island's own world is its terrain and sky island (island/features.ts) rather than parts.
import * as THREE from 'three';
import { createFollowCamera } from './camera';
import { createControls, type Orbit } from './controls';
import { createHud } from './hud';
import { makeToon } from './look';
import { createParts } from './parts';
import { createPlayer, type Player } from './player';
import type { World } from './world';

export interface GameOptions {
	canvas: HTMLCanvasElement;
	/** Nixchan's model (assets/nixchan/nixchan-3d.glb). */
	modelUrl: string;
	/** Where she starts, and which way she faces (0 is towards +z). */
	spawn: { pos: THREE.Vector3; heading: number };
	/** A world of its own; without one, she's in the game's world of parts. */
	world?: World;
	/** Whether she can open her glider (she can't, by default: in a world of parts it's cheating). */
	canGlide?: () => boolean;
	/** Whether she can dash. */
	canDash?: () => boolean;
	/** Keys that aren't for moving or jumping (lower case), for the game to use. */
	onKey?: (key: string, e: KeyboardEvent) => void;
	/** Called when Nixchan can't be loaded (no WebGL, or the model didn't come). */
	onFail?: (why: 'webgl' | 'model') => void;
}

/** The sky's colours, top to bottom, by day and by night, and the light. */
const SKIES = {
	day: { top: '#7ec8ff', bottom: '#e7f4ff', fog: '#d7ecff', sun: '#fff4dd', sunPower: 2.4, ground: '#9fb3d9', hemi: 1.5 },
	night: { top: '#141433', bottom: '#3b3a73', fog: '#2c2b5c', sun: '#b7c4ff', sunPower: 1.1, ground: '#2a2850', hemi: 0.9 },
};

export function createGame(opts: GameOptions) {
	const { canvas } = opts;
	let renderer: THREE.WebGLRenderer;
	try {
		renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	} catch {
		document.documentElement.classList.add('no-3d');
		opts.onFail?.('webgl');
		return null;
	}
	renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;

	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(45, 1, 0.3, 1200);
	const toon = makeToon();
	const hud = createHud();

	// ---------- sky and light ----------

	const hemi = new THREE.HemisphereLight('#ffffff', '#9fb3d9', 1.5);
	const sun = new THREE.DirectionalLight('#fff4dd', 2.4);
	sun.castShadow = true;
	sun.shadow.mapSize.set(2048, 2048);
	const S = 30;
	Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 140 });
	sun.shadow.bias = -0.0005;
	scene.add(hemi, sun, sun.target);
	const skyCanvas = document.createElement('canvas');
	skyCanvas.width = 2;
	skyCanvas.height = 256;
	const skyTexture = new THREE.CanvasTexture(skyCanvas);
	skyTexture.colorSpace = THREE.SRGBColorSpace;
	scene.background = skyTexture;
	scene.fog = new THREE.Fog('#d7ecff', 60, 260);
	const paintSky = () => {
		const sky = document.documentElement.dataset.time === 'night' ? SKIES.night : SKIES.day;
		const ctx = skyCanvas.getContext('2d')!;
		const g = ctx.createLinearGradient(0, 0, 0, 256);
		g.addColorStop(0, sky.top);
		g.addColorStop(1, sky.bottom);
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, 2, 256);
		skyTexture.needsUpdate = true;
		(scene.fog as THREE.Fog).color.set(sky.fog);
		sun.color.set(sky.sun);
		sun.intensity = sky.sunPower;
		hemi.groundColor.set(sky.ground);
		hemi.intensity = sky.hemi;
	};
	paintSky();
	addEventListener('site-time', paintSky);

	// ---------- the world, and Nixchan ----------

	const parts = createParts(scene, toon);
	const world = opts.world ?? parts.world;
	parts.setSpawn(opts.spawn.pos, opts.spawn.heading);

	const orbit: Orbit = { yaw: opts.spawn.heading + Math.PI, pitch: 0.32, distance: 9 };
	const controls = createControls(canvas, hud.touch, orbit, {
		intercept: () => false,
		command(key, e) {
			if (e.repeat) return;
			if (key === 'q') controls.state.dashQueued = true;
			else if (key === 'e') controls.state.waveQueued = true;
			opts.onKey?.(key, e);
		},
		release() {},
		blur() {},
	});

	const player: Player = createPlayer({
		world,
		scene,
		toon,
		modelUrl: opts.modelUrl,
		start: opts.spawn.pos.clone(),
		heading: opts.spawn.heading,
		controls,
		orbit,
		hold: () => null,
		clip: () => null,
		canGlide: opts.canGlide ?? (() => false),
		canDash: opts.canDash,
		respawnAt: () => parts.spawn,
		carriedBy: (x, z, y) => parts.carriedBy(x, z, y),
	});
	parts.onKill(() => {
		hud.flash();
		player.respawn();
		orbit.yaw = parts.spawn.heading + Math.PI;
	});
	const follow = createFollowCamera(camera, orbit, opts.spawn.pos, world);

	let ready = false;
	const loaded = player.figure.ready.then(
		() => {
			ready = true;
			player.figure.group.traverse((o) => (o.castShadow = true));
		},
		(err) => {
			opts.onFail?.('model');
			throw err;
		},
	);

	// ---------- the loop ----------

	const updates: ((dt: number, time: number) => void)[] = [];
	const resize = () => {
		renderer.setSize(innerWidth, innerHeight, false);
		camera.aspect = innerWidth / innerHeight;
		camera.fov = innerWidth < innerHeight ? 62 : 48;
		camera.updateProjectionMatrix();
	};
	let time = 0;
	let paused = false;

	return {
		renderer,
		scene,
		camera,
		toon,
		hud,
		controls,
		orbit,
		player,
		parts,
		world,
		/** Settles once Nixchan's here (her model has loaded). */
		loaded,
		get ready() {
			return ready;
		},
		get time() {
			return time;
		},
		/** Stops (or starts again) everything moving: her, the parts, the game's own updates. */
		set paused(p: boolean) {
			paused = p;
			if (p) controls.clearKeys();
		},
		get paused() {
			return paused;
		},
		/** Something for the game to do every frame, after the parts have moved and she has. */
		onUpdate(fn: (dt: number, time: number) => void) {
			updates.push(fn);
		},
		/** Puts her somewhere at once (and makes it where she comes back to). The camera swings round
		 * behind her, or to `cameraYaw` (heading itself has it in front of her, looking back at her). */
		teleport(pos: THREE.Vector3, heading: number, cameraYaw = heading + Math.PI) {
			parts.setSpawn(pos, heading);
			player.respawn();
			orbit.yaw = cameraYaw;
		},
		start() {
			resize();
			addEventListener('resize', resize);
			let last = performance.now();
			renderer.setAnimationLoop((now) => {
				const dt = Math.min(0.05, (now - last) / 1000);
				last = now;
				if (ready && !paused) {
					time += dt;
					parts.move(dt, time);
					player.update(dt, time);
					parts.touch(player, dt, time);
					for (const fn of updates) fn(dt, time);
				}
				follow.update(dt, player, null);
				// The sun's shadows follow her about.
				const p = player.pos;
				sun.position.set(p.x + 24, p.y + 50, p.z + 16);
				sun.target.position.copy(p);
				renderer.render(scene, camera);
			});
		},
	};
}

export type Game = NonNullable<ReturnType<typeof createGame>>;
