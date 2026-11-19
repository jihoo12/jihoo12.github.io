// Keyboard, mouse and touch. Movement keys and the on-screen stick become a direction to walk; a
// drag (or a finger on the right of the screen) swings the camera round; the wheel zooms. Every
// other key is handed to the game through `route`, which decides what it means right now.
import * as THREE from 'three';
import { clamp } from './util';

/** Where the camera sits round her: which way round, how high up, how far back. */
export interface Orbit {
	yaw: number;
	pitch: number;
	distance: number;
}

export interface KeyRoute {
	/** Gets the first say on every key press, before movement: returns true if it took the key
	 * (as a conversation or an open menu does), so nothing else happens. */
	intercept(key: string, e: KeyboardEvent): boolean;
	/** Any key that isn't for moving or jumping. */
	command(key: string, e: KeyboardEvent): void;
	release(key: string): void;
	blur(): void;
}

const MOVE_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'];

export function createControls(
	canvas: HTMLCanvasElement,
	ui: { stick: HTMLElement | null; knob: HTMLElement | null; jump: HTMLButtonElement | null; dash?: HTMLButtonElement | null },
	orbit: Orbit,
	route: KeyRoute,
) {
	const keys = new Set<string>();
	const stick = new THREE.Vector2();
	const state = { jumpQueued: false, waveQueued: false, dashQueued: false };

	addEventListener('keydown', (e) => {
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		const target = e.target instanceof Element ? e.target : null;
		if (target?.closest('input, textarea, select, [contenteditable]')) return;
		const key = e.key.toLowerCase();
		if (route.intercept(key, e)) return;
		if (MOVE_KEYS.includes(key)) {
			keys.add(key);
			if (key.startsWith('arrow')) e.preventDefault();
		} else if (key === ' ') {
			if (target?.closest('a, button')) return;
			e.preventDefault();
			state.jumpQueued = true;
		} else {
			route.command(key, e);
		}
	});
	addEventListener('keyup', (e) => {
		const key = e.key.toLowerCase();
		keys.delete(key);
		route.release(key);
	});
	addEventListener('blur', () => {
		keys.clear();
		route.blur();
	});

	// A finger on the left of the screen is a joystick; anywhere else, or a mouse, swings the camera.
	const pointers = new Map<number, { kind: 'stick' | 'look'; x: number; y: number; ox: number; oy: number }>();
	canvas.addEventListener('pointerdown', (e) => {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		canvas.setPointerCapture(e.pointerId);
		const kind = e.pointerType !== 'mouse' && e.clientX < innerWidth * 0.45 ? 'stick' : 'look';
		pointers.set(e.pointerId, { kind, x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY });
		if (kind === 'stick' && ui.stick) {
			ui.stick.hidden = false;
			ui.stick.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
		}
	});
	canvas.addEventListener('pointermove', (e) => {
		const p = pointers.get(e.pointerId);
		if (!p) return;
		if (p.kind === 'look') {
			orbit.yaw -= (e.clientX - p.x) * 0.006;
			orbit.pitch = clamp(orbit.pitch + (e.clientY - p.y) * 0.004, -0.3, 1.2);
		} else {
			stick.set(e.clientX - p.ox, e.clientY - p.oy);
			if (stick.length() > 60) stick.setLength(60);
			if (ui.knob) ui.knob.style.transform = `translate(${stick.x}px, ${stick.y}px)`;
			stick.divideScalar(60);
		}
		p.x = e.clientX;
		p.y = e.clientY;
	});
	const release = (e: PointerEvent) => {
		const p = pointers.get(e.pointerId);
		pointers.delete(e.pointerId);
		if (p?.kind === 'stick') {
			stick.set(0, 0);
			if (ui.stick) ui.stick.hidden = true;
			if (ui.knob) ui.knob.style.transform = '';
		}
	};
	canvas.addEventListener('pointerup', release);
	canvas.addEventListener('pointercancel', release);
	canvas.addEventListener(
		'wheel',
		(e) => {
			e.preventDefault();
			orbit.distance = clamp(orbit.distance * Math.exp(e.deltaY * 0.0012), 3.5, 26);
		},
		{ passive: false },
	);
	ui.jump?.addEventListener('pointerdown', (e) => {
		e.preventDefault();
		state.jumpQueued = true;
	});
	ui.dash?.addEventListener('pointerdown', (e) => {
		e.preventDefault();
		state.dashQueued = true;
	});

	return {
		/** Jump, wave and dash are queued by a press and taken (cleared) by whoever acts on them. */
		state,
		/** Lets go of every held key, as when a menu opens over the game. */
		clearKeys: () => keys.clear(),
		/** Which way she's asked to go, relative to the camera, and whether to run. */
		move() {
			const held = (...names: string[]) => (names.some((n) => keys.has(n)) ? 1 : 0);
			let forward = held('w', 'arrowup') - held('s', 'arrowdown');
			let right = held('d', 'arrowright') - held('a', 'arrowleft');
			let running = keys.has('shift');
			if (stick.lengthSq() > 0.01) {
				forward = -stick.y;
				right = stick.x;
				running = stick.length() > 0.85;
			}
			return { forward, right, running };
		},
	};
}

export type Controls = ReturnType<typeof createControls>;
