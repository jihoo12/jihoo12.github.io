// Inside Nixchan's house (/home): one room, seen from its open front like a dollhouse. She walks
// about it (WASD or the arrow keys, Shift to run, or a click or tap on the floor to walk there), and
// E does what there is to do where she is: lie down in bed, or go back out of the door to the island
// (which puts her on the porch, /island?from=home). Lying down, she curls up and goes to sleep; the
// room dims, and she sleeps the night (or the day) through: waking, it's the other time of day, here
// and everywhere on the site. The room is made in Blender (tools/home-room); its sizes are here too.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildNixFigure } from '../experimental/nix-figure';
import { makeToon } from '../nixkit/look';
import { clamp, damp } from '../nixkit/util';

// The sizes in tools/home-room/build.py.
const W = 9;
const D = 6;
const BACK = -D / 2;
const BED = { x0: 1.2, x1: 4.3, z0: BACK, z1: BACK + 1.7, top: 0.72 };
const PILLOW = { x: 1.75, z: BACK + 0.85 };
const TABLE = { x: -2.2, z: 1.9 };
const SHELF = { x: -3.75, z: BACK + 0.35 };
const DOOR = { x: -W / 2, z: 0.6 };
/** How far her head lies from her figure's origin in the Sleep clip (SLEEP_HEAD, tools/nixchan-3d). */
const SLEEP_HEAD = 1.125 * Math.sin(Math.PI / 2 - 0.35);

/** Things she walks round: [x, z, radius]. */
const SOLID: [number, number, number][] = [
	[TABLE.x, TABLE.z, 0.7],
	[TABLE.x + 0.95, TABLE.z, 0.32],
	[TABLE.x - 0.95, TABLE.z, 0.32],
	[SHELF.x - 0.35, SHELF.z + 0.1, 0.45],
	[SHELF.x + 0.35, SHELF.z + 0.1, 0.45],
	[BED.x0 - 0.55, BACK + 0.45, 0.45],
	[3.9, 2.2, 0.45],
];
/** Her body's reach, for walls and the bed. */
const BODY = 0.38;
const WALK = 2.6;
const RUN = 5.2;

export function startRoom() {
	const canvas = document.querySelector<HTMLCanvasElement>('[data-room]');
	if (!canvas) return;
	const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel);
	const ui = {
		loading: $('[data-loading]'),
		prompt: $('[data-act-prompt]'),
		promptText: $('[data-act-text]'),
		act: $<HTMLButtonElement>('[data-act]'),
		dim: $('[data-dim]'),
		zzz: $('[data-zzz]'),
		toast: $('[data-toast]'),
	};
	let renderer: THREE.WebGLRenderer;
	try {
		renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	} catch {
		if (ui.loading) ui.loading.textContent = "This room needs WebGL, which this browser doesn't have on.";
		return;
	}
	renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
	const toon = makeToon();

	// ---------- light, and the time of day ----------

	const hemi = new THREE.HemisphereLight('#ffffff', '#b98a6a', 1.6);
	scene.add(hemi);
	// The sun comes in from the front and above (there's no front wall to stop it).
	const sun = new THREE.DirectionalLight('#fff3dc', 2.2);
	sun.position.set(-4, 9, 8);
	sun.castShadow = true;
	sun.shadow.mapSize.set(1024, 1024);
	Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 6, bottom: -6, near: 1, far: 30 });
	sun.shadow.bias = -0.0005;
	scene.add(sun);
	// The lamp by the bed, which matters after dark.
	const lamp = new THREE.PointLight('#ffc46b', 0, 9, 1.6);
	lamp.position.set(BED.x0 - 0.67, 1.05, BACK + 0.45);
	scene.add(lamp);
	const skyMat = new THREE.MeshBasicMaterial({ color: '#9fd0f5' });
	const glowMat = new THREE.MeshBasicMaterial({ color: '#ffd27a' });
	const night = () => document.documentElement.dataset.time === 'night';
	let nightness = night() ? 1 : 0;
	const background = { day: new THREE.Color('#cfe6f7'), night: new THREE.Color('#1d1f45') };
	const skyColour = { day: new THREE.Color('#9fd0f5'), night: new THREE.Color('#2a2f7a') };
	const applyTime = (k: number) => {
		hemi.intensity = THREE.MathUtils.lerp(1.6, 0.55, k);
		hemi.color.set(k > 0.5 ? '#b9b4ff' : '#ffffff');
		sun.intensity = THREE.MathUtils.lerp(2.2, 0.25, k);
		sun.color.set(k > 0.5 ? '#9fa8ff' : '#fff3dc');
		lamp.intensity = THREE.MathUtils.lerp(0.6, 9, k);
		skyMat.color.copy(skyColour.day).lerp(skyColour.night, k);
		glowMat.color.set(k > 0.5 ? '#ffe7a8' : '#ffd27a');
		(scene.background as THREE.Color).copy(background.day).lerp(background.night, k);
	};
	scene.background = new THREE.Color();
	applyTime(nightness);
	const setTime = (next: 'day' | 'night') => {
		document.documentElement.dataset.time = next;
		try {
			localStorage.setItem('time', next);
		} catch {
			// It just won't be remembered.
		}
		window.dispatchEvent(new Event('site-time'));
	};

	// ---------- the room ----------

	const toonCache = new Map<string, THREE.MeshToonMaterial>();
	new GLTFLoader().loadAsync(canvas.dataset.roomModel ?? '').then(
		(gltf) => {
			gltf.scene.traverse((o) => {
				if (!(o instanceof THREE.Mesh)) return;
				const placeholder = o.material as THREE.MeshStandardMaterial;
				if (placeholder.name === 'Sky') o.material = skyMat;
				else if (placeholder.name === 'Glow') o.material = glowMat;
				else {
					const color = `#${placeholder.color.getHexString()}`;
					let mat = toonCache.get(color);
					if (!mat) toonCache.set(color, (mat = toon({ color })));
					o.material = mat;
				}
				o.castShadow = o.receiveShadow = true;
			});
			scene.add(gltf.scene);
		},
		() => {
			if (ui.loading) ui.loading.textContent = "The room couldn't be set up just now. Try reloading?";
		},
	);

	// ---------- Nixchan ----------

	const figure = buildNixFigure(canvas.dataset.model ?? '');
	const her = new THREE.Group();
	her.add(figure.group);
	scene.add(her);
	figure.group.traverse((o) => (o.castShadow = true));
	// In from the door, facing into the room.
	const pos = new THREE.Vector3(DOOR.x + 1.1, 0, DOOR.z);
	let heading = Math.PI / 2;
	let turn = heading;
	let ready = false;
	figure.ready.then(
		() => {
			ready = true;
			figure.group.traverse((o) => (o.castShadow = true));
			ui.loading?.setAttribute('hidden', '');
		},
		() => {
			if (ui.loading) ui.loading.textContent = "Nixchan couldn't make it home just now. Try reloading?";
		},
	);

	// ---------- moving about ----------

	const keys = new Set<string>();
	/** A spot on the floor she's walking to (from a click or a tap), and what to do when she's there. */
	let target: { x: number; z: number; then?: () => void } | null = null;
	/** How long she's been walking without getting anywhere. */
	let stuck = 0;
	addEventListener('keydown', (e) => {
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		const k = e.key.toLowerCase();
		if (asleep) {
			// Any key wakes her (once she's properly asleep).
			if (asleepFor > 1.2 && !e.repeat) wake();
			return;
		}
		if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', ' '].includes(k)) {
			keys.add(k);
			target = null;
			if (k.startsWith('arrow') || k === ' ') e.preventDefault();
		}
		if (k === 'e' && !e.repeat) act();
	});
	addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
	addEventListener('blur', () => keys.clear());

	/** Where she is in relation to what's in the room. */
	const nearBed = () => pos.x > BED.x0 - 0.3 && pos.x < BED.x1 + 0.2 && pos.z < BED.z1 + 1.0;
	const nearDoor = () => Math.hypot(pos.x - (DOOR.x + 0.8), pos.z - DOOR.z) < 1.1;
	const offer = (): { label: string; go: () => void } | null => {
		if (!ready || asleep || leaving) return null;
		if (nearBed()) return { label: 'Go to sleep', go: lieDown };
		if (nearDoor()) return { label: 'Go outside', go: leave };
		return null;
	};
	const act = () => offer()?.go();
	ui.act?.addEventListener('click', act);

	// A click or tap on the floor walks her there; on the bed or by the door, she goes and does it.
	const ray = new THREE.Raycaster();
	const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
	const hit = new THREE.Vector3();
	canvas.addEventListener('pointerdown', (e) => {
		if (asleep) {
			if (asleepFor > 1.2) wake();
			return;
		}
		if (!ready || leaving) return;
		const r = canvas.getBoundingClientRect();
		ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
		// The bed's top first, then the floor.
		const bedTop = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BED.top);
		if (ray.ray.intersectPlane(bedTop, hit) && hit.x > BED.x0 && hit.x < BED.x1 && hit.z > BED.z0 && hit.z < BED.z1) {
			target = { x: clamp(hit.x, BED.x0 + 0.4, BED.x1 - 0.4), z: BED.z1 + 0.5, then: lieDown };
			return;
		}
		if (!ray.ray.intersectPlane(floor, hit)) return;
		const atDoor = Math.hypot(hit.x - DOOR.x, hit.z - DOOR.z) < 1.0;
		target = atDoor ? { x: DOOR.x + 0.8, z: DOOR.z, then: leave } : { x: hit.x, z: hit.z };
	});

	/** Keeps (x, z) out of the walls, the bed and the furniture. */
	const keepOut = (p: THREE.Vector3) => {
		p.x = clamp(p.x, -W / 2 + BODY, W / 2 - BODY);
		p.z = clamp(p.z, BACK + BODY, D / 2 - 0.3);
		// The bed: a box she walks round.
		if (p.x > BED.x0 - BODY && p.x < BED.x1 + BODY && p.z < BED.z1 + BODY) {
			const out = [
				[BED.x0 - BODY - p.x, 0],
				[BED.x1 + BODY - p.x, 0],
				[0, BED.z1 + BODY - p.z],
			].sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]))[0];
			p.x += out[0];
			p.z += out[1];
		}
		for (const [x, z, r] of SOLID) {
			const dx = p.x - x;
			const dz = p.z - z;
			const d = Math.hypot(dx, dz);
			if (d < r + BODY && d > 1e-4) {
				p.x = x + (dx / d) * (r + BODY);
				p.z = z + (dz / d) * (r + BODY);
			}
		}
	};

	// ---------- sleeping ----------

	let asleep = false;
	let asleepFor = 0;
	/** 0 → 1 as the room dims for the night's sleep, and back. */
	let dimming = 0;
	let slept = false;
	const toast = (text: string) => {
		if (!ui.toast) return;
		ui.toast.textContent = text;
		ui.toast.hidden = false;
		ui.toast.classList.remove('show');
		void ui.toast.offsetWidth;
		ui.toast.classList.add('show');
	};
	const lieDown = () => {
		if (asleep) return;
		asleep = true;
		asleepFor = 0;
		slept = false;
		target = null;
		keys.clear();
		figure.play('Sleep');
		figure.setBlink(true);
		if (ui.zzz) ui.zzz.hidden = false;
	};
	const wake = () => {
		if (!asleep) return;
		asleep = false;
		figure.setBlink(false);
		if (ui.zzz) ui.zzz.hidden = true;
		// Up and standing beside the bed, facing out into the room.
		pos.set(clamp(pos.x, BED.x0 + 0.6, BED.x1 - 0.6), 0, BED.z1 + 0.55);
		heading = turn = 0;
		if (slept) toast(night() ? 'Good evening! She slept the day away.' : 'Good morning! She slept the night through.');
	};

	// ---------- going back out ----------

	let leaving = false;
	const leave = () => {
		if (leaving) return;
		leaving = true;
		target = null;
		ui.dim?.classList.add('out');
		setTimeout(() => location.assign('/island/?from=home'), reduceMotion ? 0 : 550);
	};
	addEventListener('pageshow', (e) => {
		if (!e.persisted) return;
		leaving = false;
		ui.dim?.classList.remove('out');
	});

	// ---------- every frame ----------

	const resize = () => {
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		// Narrow screens step back, so the whole room still fits across.
		const fit = Math.max(1, 1.55 / camera.aspect);
		camera.fov = 36 * Math.min(fit, 1.7);
		camera.updateProjectionMatrix();
	};
	addEventListener('resize', resize);
	resize();

	const look = new THREE.Vector3(0, 1.2, -0.3);
	const camAt = new THREE.Vector3(0, 5.4, 11.5);
	const zero = new THREE.Vector2();
	const sleepAt = new THREE.Vector3();
	const headAt = new THREE.Vector3();
	let last = performance.now();
	const frame = (now: number) => {
		const dt = Math.min((now - last) / 1000, 0.05);
		last = now;
		const time = now / 1000;

		if (asleep) {
			asleepFor += dt;
			// Laid on the bed: her head on the pillow, curled up facing out. (Her figure's origin is at her
			// hips, and asleep her head lies SLEEP_HEAD towards -x of it: tools/nixchan-3d.)
			sleepAt.set(PILLOW.x + SLEEP_HEAD, BED.top + 0.17, PILLOW.z + 0.05);
			her.position.lerp(sleepAt, 1 - Math.exp(-10 * dt));
			her.rotation.y = damp(her.rotation.y, 0, 8, dt);
			// The room dims, and she sleeps until it's the other time of day.
			if (asleepFor > 1.6 && !slept) {
				dimming = Math.min(1, dimming + dt / 1.2);
				if (dimming === 1) {
					slept = true;
					setTime(night() ? 'day' : 'night');
				}
			} else if (slept) dimming = Math.max(0, dimming - dt / 1.4);
		} else {
			dimming = Math.max(0, dimming - dt / 0.8);
			// Steering: the keys, relative to the room (the camera looks straight in), or a target.
			let mx = 0;
			let mz = 0;
			if (keys.has('a') || keys.has('arrowleft')) mx -= 1;
			if (keys.has('d') || keys.has('arrowright')) mx += 1;
			if (keys.has('w') || keys.has('arrowup')) mz -= 1;
			if (keys.has('s') || keys.has('arrowdown')) mz += 1;
			if (target && !mx && !mz) {
				const dx = target.x - pos.x;
				const dz = target.z - pos.z;
				const d = Math.hypot(dx, dz);
				if (d < 0.15) {
					const then = target.then;
					target = null;
					then?.();
				} else {
					mx = dx / d;
					mz = dz / d;
				}
			}
			const moving = ready && !leaving && (mx || mz);
			const running = keys.has('shift');
			if (moving) {
				const len = Math.hypot(mx, mz);
				const speed = running ? RUN : WALK;
				const before = pos.clone();
				pos.x += (mx / len) * speed * dt;
				pos.z += (mz / len) * speed * dt;
				keepOut(pos);
				// Pressed up against something (sliding round it is fine), for a while, she gives up on where
				// she was going.
				stuck = pos.distanceTo(before) < speed * dt * 0.2 ? stuck + dt : 0;
				if (target && stuck > 0.6) target = null;
				heading = Math.atan2(mx, mz);
			}
			let dTurn = heading - turn;
			dTurn = Math.atan2(Math.sin(dTurn), Math.cos(dTurn));
			turn += dTurn * (1 - Math.exp(-12 * dt));
			her.position.copy(pos);
			her.rotation.y = turn;
			figure.play(moving ? (running ? 'Run' : 'Walk') : 'Idle', moving && !running ? 1.1 : 1);
		}
		figure.tick(dt, time, { airborne: false, look: zero, still: false, jump: null });

		// The time of day eases in (after a sleep, under the dimming, so it's done by the time she wakes).
		nightness = damp(nightness, night() ? 1 : 0, 3, dt);
		applyTime(nightness);
		if (ui.dim) ui.dim.style.opacity = String(0.85 * dimming);

		// The camera: in front of the open side, drifting a little after her, and closer while she's
		// asleep, to look at her in bed.
		const wantX = asleep ? PILLOW.x + 0.6 : clamp(her.position.x * 0.35, -1.2, 1.2);
		camAt.x = damp(camAt.x, wantX, 2, dt);
		camAt.y = damp(camAt.y, asleep ? 3.6 : 5.4, 2, dt);
		camAt.z = damp(camAt.z, asleep ? 5.5 : 11.5, 2, dt);
		look.x = damp(look.x, asleep ? PILLOW.x + 0.7 : clamp(her.position.x * 0.5, -2, 2), 2, dt);
		look.y = damp(look.y, asleep ? 0.9 : 1.2, 2, dt);
		look.z = damp(look.z, asleep ? BED.z0 + 0.9 : -0.3, 2, dt);
		camera.position.copy(camAt);
		camera.lookAt(look);

		// The Zzz over her head while she sleeps.
		if (ui.zzz && asleep) {
			headAt.set(her.position.x - 0.2, her.position.y + 1.3, her.position.z).project(camera);
			ui.zzz.style.transform = `translate(${((headAt.x + 1) / 2) * innerWidth}px, ${((1 - headAt.y) / 2) * innerHeight}px)`;
		}

		// What E would do here.
		const o = offer();
		ui.prompt?.toggleAttribute('hidden', !o);
		if (ui.promptText) ui.promptText.textContent = o?.label ?? '';
		if (ui.act) {
			ui.act.hidden = !o;
			ui.act.textContent = o?.label.split(' ').slice(0, 2).join(' ') ?? '';
		}

		renderer.render(scene, camera);
		requestAnimationFrame(frame);
	};
	requestAnimationFrame(frame);
	if (import.meta.env.DEV) Object.assign(window, { room: { pos, keys, get ready() { return ready; }, get target() { return target; }, get asleep() { return asleep; } } });
}
