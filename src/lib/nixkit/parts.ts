// Parts: the building blocks of a Nixkit world. A part is a box or a cylinder, floating wherever
// it's put, that Nixchan can stand on, bump into and jump between. A part can also do something:
// slide back and forth, carry her along like a belt, throw her into the air, fade away under her
// feet, send her back to the last checkpoint, or just tell the game she's touched it.
//
// The parts together are a world (nixkit/world.ts): what she stands on is the top of whichever part
// is under her, and a part whose underside is over her head is a ceiling. Anything that rises from
// below her waist up past her feet is a wall, since she can't step that high.
//
//   const parts = createParts(scene, toon);
//   parts.add({ at: [0, 0, 0], size: [8, 1, 8], color: '#8fd3ff' });           // a platform
//   parts.add({ at: [0, 0, 8], size: [3, 1, 3], move: { by: [6, 0, 0], period: 4 } });
//   parts.add({ at: [0, 0, 14], size: [2, 1, 2], kill: true });                // back to the checkpoint
//   parts.pickup({ at: [0, 2, 8], onPick: () => coins++ });
import * as THREE from 'three';
import type { Toon } from './look';
import { damp } from './util';
import type { World } from './world';

export type Vec3 = [number, number, number];

export interface PartSpec {
	/** Where its middle is. */
	at: Vec3;
	/** How wide (x), tall (y) and deep (z) it is. A cylinder is as wide across as `size[0]`. */
	size: Vec3;
	shape?: 'box' | 'cylinder';
	color?: string;
	/** Slides out by `by` and back again, once every `period` seconds (`phase` 0 … 1 into it). */
	move?: { by: Vec3; period: number; phase?: number };
	/** Carries whoever stands on it along at this speed (x, z), like a belt. */
	conveyor?: [number, number];
	/** Throws whoever lands on it up at this speed (around 15 clears a tall wall). */
	bounce?: number;
	/** Fades away `after` seconds after she steps onto it, and comes back `back` seconds later. */
	vanish?: { after: number; back: number };
	/** Touching it sends her back to the last checkpoint. */
	kill?: boolean;
	/** Touching it makes it the place she comes back to. */
	checkpoint?: boolean;
	/** Whether she can stand on it and bump into it (default true). One that isn't is only for show,
	 * or for `onTouch`. */
	solid?: boolean;
	/** Called once each time she steps onto it (or into it, if it isn't solid). */
	onTouch?: (part: Part) => void;
}

export interface Part {
	spec: PartSpec;
	mesh: THREE.Mesh;
	/** Where its middle is now (it may be moving). */
	pos: THREE.Vector3;
	/** How fast it's moving. */
	vel: THREE.Vector3;
	/** Whether it's there to stand on right now (a vanishing part isn't, while it's gone). */
	solid: boolean;
	readonly top: number;
	readonly bottom: number;
	/** Recolours it (as a checkpoint does once it's reached). */
	paint(color: string): void;
	remove(): void;
}

export interface PickupSpec {
	at: Vec3;
	color?: string;
	/** How close she has to come to pick it up. */
	reach?: number;
	onPick: () => void;
}

export interface Pickup {
	readonly taken: boolean;
	/** Puts it back to be picked up again. */
	reset(): void;
	remove(): void;
}

/** What she's like, as far as touching parts goes. */
export interface Toucher {
	pos: THREE.Vector3;
	readonly grounded: boolean;
	launch(speed: number): void;
}

/** How far past a part's edge she can still stand on it (about the width of her feet), and how
 * near its edge a wall stops her. */
const GRIP = 0.3;
/** A part whose underside is more than this above her feet is over her head, not in her way. */
const WAIST = 1.0;
const TAU = Math.PI * 2;

export function createParts(scene: THREE.Scene, toon: Toon) {
	const parts: Part[] = [];
	const pickups: { spec: PickupSpec; mesh: THREE.Object3D; taken: boolean; spin: number }[] = [];
	let spawn = { pos: new THREE.Vector3(), heading: 0 };
	let onKill: () => void = () => {};
	let onCheckpoint: (part: Part) => void = () => {};

	const covers = (p: Part, x: number, z: number) => {
		const [w, , d] = p.spec.size;
		if (p.spec.shape === 'cylinder') return Math.hypot(x - p.pos.x, z - p.pos.z) <= w / 2 + GRIP;
		return Math.abs(x - p.pos.x) <= w / 2 + GRIP && Math.abs(z - p.pos.z) <= d / 2 + GRIP;
	};

	/** The solid part she'd be standing on at (x, z), at height y: the one whose top is just there. */
	const under = (x: number, z: number, y: number) => {
		let best: Part | null = null;
		for (const p of parts) {
			if (!p.solid || !covers(p, x, z) || Math.abs(p.top - y) > 0.12) continue;
			if (!best || p.top > best.top) best = p;
		}
		return best;
	};

	const world: World = {
		groundAt(x, z, y) {
			let g = -Infinity;
			for (const p of parts) if (p.solid && covers(p, x, z) && (y === undefined || p.bottom <= y + WAIST)) g = Math.max(g, p.top);
			return g;
		},
		ceilingAt(x, z, y) {
			let c = Infinity;
			for (const p of parts) if (p.solid && covers(p, x, z) && p.bottom > y + WAIST) c = Math.min(c, p.bottom);
			return c;
		},
		nearby: () => [],
		inside: () => true,
		fallOut: -24,
	};

	const add = (spec: PartSpec): Part => {
		const [w, h, d] = spec.size;
		const geo = spec.shape === 'cylinder' ? new THREE.CylinderGeometry(w / 2, w / 2, h, 28) : new THREE.BoxGeometry(w, h, d);
		const color = spec.color ?? (spec.kill ? '#ff5a5f' : spec.bounce ? '#ffd84d' : spec.conveyor ? '#9aa3c7' : '#8fd3ff');
		const material = toon({ color, transparent: !!spec.vanish });
		const mesh = new THREE.Mesh(geo, material);
		mesh.castShadow = spec.solid !== false;
		mesh.receiveShadow = true;
		const base = new THREE.Vector3(...spec.at);
		mesh.position.copy(base);
		scene.add(mesh);
		// Kill parts glow a little, so they read as dangerous at night too.
		if (spec.kill) material.emissive = new THREE.Color(color).multiplyScalar(0.35);
		// A belt's stripes show which way it runs: they're drawn across it, and slide along.
		if (spec.conveyor) addStripes(mesh, spec);
		const part: Part & { base: THREE.Vector3; gone: number; standing: number } = {
			spec,
			mesh,
			pos: mesh.position,
			vel: new THREE.Vector3(),
			solid: spec.solid !== false,
			base,
			gone: 0,
			standing: 0,
			get top() {
				return this.pos.y + h / 2;
			},
			get bottom() {
				return this.pos.y - h / 2;
			},
			paint(c) {
				material.color.set(c);
			},
			remove() {
				scene.remove(mesh);
				geo.dispose();
				material.dispose();
				const i = parts.indexOf(part);
				if (i >= 0) parts.splice(i, 1);
			},
		};
		parts.push(part);
		return part;
	};

	const stripes: { tex: THREE.CanvasTexture; speed: number }[] = [];
	function addStripes(mesh: THREE.Mesh, spec: PartSpec) {
		const [vx, vz] = spec.conveyor!;
		const [w, h, d] = spec.size;
		const canvas = document.createElement('canvas');
		canvas.width = 16;
		canvas.height = 64;
		const ctx = canvas.getContext('2d')!;
		ctx.fillStyle = 'rgba(255,255,255,0)';
		ctx.fillRect(0, 0, 16, 64);
		ctx.fillStyle = 'rgba(255,255,255,0.55)';
		// A chevron pointing up the texture, which is turned to point the way the belt runs.
		ctx.beginPath();
		ctx.moveTo(0, 40);
		ctx.lineTo(8, 24);
		ctx.lineTo(16, 40);
		ctx.lineTo(16, 52);
		ctx.lineTo(8, 36);
		ctx.lineTo(0, 52);
		ctx.closePath();
		ctx.fill();
		const tex = new THREE.CanvasTexture(canvas);
		tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
		const along = Math.hypot(vx, vz);
		const length = Math.abs(vx) > Math.abs(vz) ? w : d;
		const across = Math.abs(vx) > Math.abs(vz) ? d : w;
		tex.repeat.set(Math.max(1, Math.round(across / 1.2)), Math.max(1, length / 1.6));
		tex.center.set(0.5, 0.5);
		// The top of a box has its texture's up (v) along -z; turn it to the way the belt runs.
		tex.rotation = Math.atan2(vx, -vz);
		const top = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
		top.rotation.x = -Math.PI / 2;
		top.position.y = h / 2 + 0.01;
		mesh.add(top);
		stripes.push({ tex, speed: -(along / length) * tex.repeat.y });
	}

	const pickupGeo = new THREE.OctahedronGeometry(0.42, 0);
	const pickup = (spec: PickupSpec): Pickup => {
		const mesh = new THREE.Mesh(pickupGeo, toon({ color: spec.color ?? '#ffd84d', emissive: new THREE.Color(spec.color ?? '#ffd84d').multiplyScalar(0.3) }));
		mesh.position.set(...spec.at);
		mesh.castShadow = true;
		scene.add(mesh);
		const p = { spec, mesh, taken: false, spin: Math.random() * TAU };
		pickups.push(p);
		return {
			get taken() {
				return p.taken;
			},
			reset() {
				p.taken = false;
				mesh.visible = true;
				mesh.scale.setScalar(1);
			},
			remove() {
				scene.remove(mesh);
				pickups.splice(pickups.indexOf(p), 1);
			},
		};
	};

	let last: Part | null = null;
	let bounced = 0;

	return {
		/** The parts as a world for Nixchan and the camera. */
		world,
		add,
		pickup,
		/** A checkpoint: a pad with a flag on it, that becomes where she comes back to once she's
		 * stood on it. */
		checkpoint(at: Vec3, size: Vec3 = [4, 1, 4], color = '#c8d3f5') {
			const pad = add({ at, size, color, checkpoint: true });
			const flag = new THREE.Group();
			const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6), toon({ color: '#2c2a52' }));
			pole.position.y = 1.2;
			const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.05), toon({ color: '#ffffff' }));
			cloth.position.set(0.5, 2.1, 0);
			flag.add(pole, cloth);
			flag.position.set(at[0] - size[0] / 2 + 0.5, at[1] + size[1] / 2, at[2] - size[2] / 2 + 0.5);
			flag.traverse((o) => (o.castShadow = true));
			scene.add(flag);
			(pad as Part & { flag?: THREE.Mesh }).flag = cloth;
			return pad;
		},
		/** Starts over: every checkpoint back to not reached yet, every pickup back to be picked up,
		 * and `pos` where she comes back to. */
		reset(pos: THREE.Vector3, heading: number) {
			spawn = { pos: pos.clone(), heading };
			last = null;
			for (const p of parts) ((p as Part & { flag?: THREE.Mesh }).flag?.material as THREE.MeshToonMaterial | undefined)?.color.set('#ffffff');
			for (const p of pickups) {
				p.taken = false;
				p.mesh.visible = true;
			}
		},
		/** Where she comes back to (after falling, or touching a kill part). */
		get spawn() {
			return spawn;
		},
		setSpawn(pos: THREE.Vector3, heading: number) {
			spawn = { pos: pos.clone(), heading };
		},
		/** What to do when she touches a kill part (put her back, usually). */
		onKill(fn: () => void) {
			onKill = fn;
		},
		/** What to do when she reaches a new checkpoint. */
		onCheckpoint(fn: (part: Part) => void) {
			onCheckpoint = fn;
		},
		/** How fast what she's standing on at (x, z, y) is carrying her, if it is. */
		carriedBy(x: number, z: number, y: number) {
			const p = under(x, z, y);
			if (!p) return null;
			const [cx, cz] = p.spec.conveyor ?? [0, 0];
			const vx = p.vel.x + cx;
			const vz = p.vel.z + cz;
			return vx || vz ? { x: vx, z: vz } : null;
		},
		/** Moves the moving parts on to `time`. Call before she moves, so she stands where they are. */
		move(dt: number, time: number) {
			for (const p of parts as (Part & { base: THREE.Vector3 })[]) {
				const m = p.spec.move;
				if (!m) continue;
				const t = (time / m.period + (m.phase ?? 0)) * TAU;
				const s = 0.5 - 0.5 * Math.cos(t);
				const ds = (0.5 * Math.sin(t) * TAU) / m.period;
				const [bx, by, bz] = m.by;
				p.pos.set(p.base.x + bx * s, p.base.y + by * s, p.base.z + bz * s);
				p.vel.set(bx * ds, by * ds, bz * ds);
			}
			for (const s of stripes) s.tex.offset.y = (s.tex.offset.y + s.speed * dt) % 1;
		},
		/** Works out what she's touching, after she's moved: lands her on bounce pads, fades the
		 * parts she's standing on, picks things up, and so on. */
		touch(her: Toucher, dt: number, time: number) {
			const { pos } = her;
			const on = her.grounded ? under(pos.x, pos.z, pos.y) : null;
			// What she's in (for parts that aren't solid): her feet to her head, inside its box.
			let into: Part | null = null;
			for (const p of parts) {
				if (p.spec.solid !== false || !covers(p, pos.x, pos.z)) continue;
				if (pos.y + 1.6 > p.bottom && pos.y < p.top) into = p;
			}
			const now = on ?? into;
			bounced = Math.max(0, bounced - dt);
			if (now && now !== last) {
				if (now.spec.checkpoint && spawn.pos.distanceToSquared(new THREE.Vector3(now.pos.x, now.top, now.pos.z)) > 0.01) {
					spawn = { pos: new THREE.Vector3(now.pos.x, now.top, now.pos.z), heading: spawn.heading };
					const flag = (now as Part & { flag?: THREE.Mesh }).flag;
					(flag?.material as THREE.MeshToonMaterial | undefined)?.color.set('#5fd17a');
					onCheckpoint(now);
				}
				now.spec.onTouch?.(now);
			}
			last = now;
			// (Standing on something safe doesn't save her from a kill part she's walked into.)
			if (on?.spec.kill || into?.spec.kill) {
				last = null;
				onKill();
				return;
			}
			if (on?.spec.bounce && bounced === 0) {
				her.launch(on.spec.bounce);
				bounced = 0.2;
				on.mesh.scale.y = 0.6;
			}
			for (const p of parts as (Part & { gone: number; standing: number })[]) {
				// Squashed bounce pads spring back.
				if (p.spec.bounce) p.mesh.scale.y = damp(p.mesh.scale.y, 1, 10, dt);
				const v = p.spec.vanish;
				if (!v) continue;
				const material = p.mesh.material as THREE.MeshToonMaterial;
				if (p.gone > 0) {
					p.gone -= dt;
					if (p.gone <= 0) {
						p.solid = true;
						p.standing = 0;
					}
				} else if (p === on || p.standing > 0) {
					// Once she's set foot on it, it's going, whether she stays or not.
					p.standing += dt;
					if (p.standing >= v.after) {
						p.solid = false;
						p.gone = v.back;
						p.standing = 0;
					}
				}
				// About to go, it trembles (a wobble, so where it stands doesn't change).
				p.mesh.rotation.z = p.standing > 0 ? Math.sin(time * 60) * 0.03 * (p.standing / v.after) : 0;
				p.mesh.visible = p.solid || p.gone < 0.4;
				material.opacity = p.solid ? 1 - (p.standing / v.after) * 0.5 : Math.max(0, 0.4 - p.gone) * 0.6;
			}
			for (const p of pickups) {
				if (p.taken) continue;
				p.spin += dt * 2;
				p.mesh.rotation.y = p.spin;
				p.mesh.position.y = p.spec.at[1] + Math.sin(p.spin * 1.3) * 0.15;
				const reach = p.spec.reach ?? 1.1;
				const dy = p.mesh.position.y - (pos.y + 0.8);
				if (Math.hypot(p.mesh.position.x - pos.x, p.mesh.position.z - pos.z) < reach && Math.abs(dy) < reach + 0.6) {
					p.taken = true;
					p.mesh.visible = false;
					p.spec.onPick();
				}
			}
		},
		/** Every part, to look through. */
		all: parts as readonly Part[],
	};
}

export type Parts = ReturnType<typeof createParts>;
