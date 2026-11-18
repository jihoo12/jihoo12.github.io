// Nixchan herself: her figure and glider, and how she moves. She walks, runs and wades on the
// ground, swims where it gets deep, jumps, and opens her glider in mid-air, which the Windspout's
// wind carries up towards the sky island. Everything she might be
// busy at (fishing, gardening, chatting) is outside; `hold` says whether one of them is keeping her
// on the spot, and `clip` whether one wants her doing something in particular.
import * as THREE from 'three';
import { buildNixFigure, type NixClip } from '../experimental/nix-figure';
import type { Controls, Orbit } from './controls';
import { ceilingAt, groundAt, nearby, within } from './features';
import type { Toon } from './look';
import { skyWaterDepth, windLift } from './skyisle';
import { SWIM_IN, SWIM_OUT, WORLD_EDGE } from './terrain';
import { clamp, damp } from './util';

const WALK = 3;
const RUN = 7.5;
const SWIM = 2.4;
const SWIM_FAST = 3.6;
const GLIDE = 8.5;
const GLIDE_SINK = 2.3;
const GRAVITY = 26;
const JUMP_SPEED = 8.6;
/** The fastest she falls: quick, but never so quick she drops through the sky island in one frame. */
const FALL_MAX = 24;
const FLIGHT = (2 * JUMP_SPEED) / GRAVITY;
const BODY_R = 0.45;
/** A dash (taught by Hollis, owl.ts): how fast, for how long, and how long before the next. */
const DASH_SPEED = 19;
const DASH_TIME = 0.2;
const DASH_REST = 0.55;
/** The furthest she moves sideways in one go, so a dash can't step her up a cliff in a frame. */
const STEP_MAX = 0.3;
/** How far above her feet her middle is, and the top of her head. */
const BODY_MID = 0.8;
const HEAD = 1.7;

export interface PlayerContext {
	scene: THREE.Scene;
	toon: Toon;
	modelUrl: string;
	start: THREE.Vector3;
	heading: number;
	controls: Controls;
	orbit: Orbit;
	ripple: (x: number, z: number, size: number) => void;
	/** If something's keeping her on the spot, the way it has her face; otherwise null. Told whether
	 * she's trying to move (or jump), which may be enough to end it. */
	hold: (tryingToMove: boolean) => number | null;
	/** A clip something wants her playing instead of her own, if any. */
	clip: () => NixClip | null;
	/** Whether she has something in her arms (a sprinkler, to set up): she walks with it held out. */
	carrying?: () => boolean;
	/** How her glider flies: its speed and how fast it sinks (better once upgraded at the forge). */
	glider?: () => { speed: number; sink: number };
	/** Whether she knows how to dash (Hollis teaches her). */
	canDash?: () => boolean;
	/** How fast what she's standing on (at x, z, at height y) is moving, if it is: a belt with power. */
	carriedBy?: (x: number, z: number, y: number) => { x: number; z: number } | null;
}

export function createPlayer(ctx: PlayerContext) {
	const { controls } = ctx;
	const root = new THREE.Group();
	const figure = buildNixFigure(ctx.modelUrl);
	root.add(figure.group);
	ctx.scene.add(root);

	// Her glider: a striped wing on two struts, which she opens in mid-air. Its stripes can be
	// repainted, as when it's remade at the forge.
	let paintGlider: (...stripes: string[]) => void = () => {};
	const glider = (() => {
		const rig = new THREE.Group();
		const geo = new THREE.BoxGeometry(3.6, 0.06, 1.25, 16, 1, 1).toNonIndexed();
		const p = geo.attributes.position;
		for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) - (p.getX(i) / 1.8) ** 2 * 0.42);
		const col = new THREE.BufferAttribute(new Float32Array(p.count * 3), 3);
		paintGlider = (...stripes) => {
			const colors = stripes.map((c) => new THREE.Color(c));
			for (let i = 0; i < p.count; i += 3) {
				const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
				const c = colors[Math.floor((x + 1.8) / 0.6) % colors.length];
				for (let k = 0; k < 3; k++) col.setXYZ(i + k, c.r, c.g, c.b);
			}
			col.needsUpdate = true;
		};
		paintGlider('#ffd84d', '#f25f6b');
		geo.setAttribute('color', col);
		geo.deleteAttribute('uv');
		geo.computeVertexNormals();
		const wing = new THREE.Mesh(geo, ctx.toon({ vertexColors: true, side: THREE.DoubleSide }));
		wing.position.set(0, 3.05, 0.1);
		wing.rotation.x = 0.12;
		wing.castShadow = true;
		rig.add(wing);
		for (const side of [-1, 1]) {
			const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.5, 5), ctx.toon({ color: '#2c2a52' }));
			strut.position.set(side * 0.42, 2.3, 0.1);
			strut.rotation.z = side * 0.2;
			rig.add(strut);
		}
		rig.visible = false;
		rig.scale.setScalar(0.01);
		root.add(rig);
		return rig;
	})();
	figure.group.traverse((o) => (o.castShadow = true));

	const pos = ctx.start.clone();
	const vel = new THREE.Vector3();
	let vy = 0;
	let grounded = true;
	let swimming = false;
	let gliding = false;
	let gliderOpen = 0;
	let rippleClock = 0;
	let swimClock = 0;
	let jumped = false;
	let airTime = 0;
	let heading = ctx.heading;
	let turn = heading;
	let waving = 0;
	let nextBlink = 2;
	let dashing = 0;
	let dashRest = 0;
	let airDashed = false;
	const dashDir = new THREE.Vector3();
	root.position.copy(pos);

	// Puffs of air left behind her as she dashes.
	const puffs = Array.from({ length: 8 }, () => {
		const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }));
		m.visible = false;
		ctx.scene.add(m);
		return { m, life: 0 };
	});
	let nextPuff = 0;
	let puffClock = 0;
	const puff = () => {
		const p = puffs[nextPuff++ % puffs.length];
		p.life = 1;
		p.m.visible = true;
		p.m.position.set(pos.x - dashDir.x * 0.4 + (Math.random() - 0.5) * 0.3, pos.y + 0.5 + Math.random() * 0.6, pos.z - dashDir.z * 0.4 + (Math.random() - 0.5) * 0.3);
	};

	/** Back to the beach, should she ever fall out of the world. */
	const respawn = () => {
		pos.copy(ctx.start);
		vel.set(0, 0, 0);
		vy = 0;
		grounded = true;
		swimming = false;
		gliding = false;
	};

	/** Whether she can move her feet from where she is to (x, z). */
	const canGo = (x: number, z: number) => {
		const g = groundAt(x, z, pos.y);
		if (Math.hypot(x, z) > WORLD_EDGE) return false;
		// Nor into the side of the sky island, flying at it from below its grass.
		if (ceilingAt(x, z, pos.y) < pos.y + HEAD) return false;
		// Nor any deeper than her knees into the lake up there (she can always wade back out).
		if (grounded) {
			const deep = skyWaterDepth(x, z, pos.y);
			if (deep > 0.45 && deep > skyWaterDepth(pos.x, pos.z, pos.y) + 1e-3) return false;
		}
		// Swimming, she goes round the pier and anything else standing up out of the water.
		if (swimming) return g < 0.05;
		const step = Math.hypot(x - pos.x, z - pos.z);
		// On her feet she takes steps and gentle slopes in her stride; in the air she clears what's beneath her.
		return grounded ? g - pos.y <= 0.5 + step * 1.3 : g <= pos.y + 0.05;
	};
	/** Pushes her out of any trunk or ball of leaves she's moved into, and takes away the part of her
	 * speed that was carrying her into it, so she slides round it instead of pressing on and juddering. */
	const pushOut = (p: THREE.Vector3) => {
		const out = (cx: number, cz: number, min: number) => {
			const dx = p.x - cx;
			const dz = p.z - cz;
			const d = Math.hypot(dx, dz);
			if (d >= min || d < 1e-4) return;
			const nx = dx / d;
			const nz = dz / d;
			p.x = cx + nx * min;
			p.z = cz + nz * min;
			const into = vel.x * nx + vel.z * nz;
			if (into < 0) {
				vel.x -= into * nx;
				vel.z -= into * nz;
			}
		};
		for (const f of nearby(p.x, p.z)) {
			if (f.dome || f.pad !== undefined || !within(f, p.y)) continue;
			if (f.top === undefined || p.y < f.top) out(f.x, f.z, f.r + BODY_R);
			// On her feet she only meets trunks, as she always has; the leaves are for the air.
			const c = f.crown;
			if (!c || grounded) continue;
			// Her middle against the ball of leaves: at this height, how far out round it she has to be.
			const dy = p.y + BODY_MID - c.y;
			const reach = c.r + BODY_R;
			if (Math.abs(dy) < reach) out(c.x, c.z, Math.sqrt(reach * reach - dy * dy));
		}
	};

	const steer = new THREE.Vector3();
	const step = (dt: number) => {
		const input = controls.state;
		const { forward, right, running } = controls.move();
		const yaw = ctx.orbit.yaw;
		steer.set(-Math.sin(yaw) * forward + Math.cos(yaw) * right, 0, -Math.cos(yaw) * forward - Math.sin(yaw) * right);
		if (steer.lengthSq() > 1) steer.normalize();
		let moving = steer.lengthSq() > 0.01;
		// Busy at something, she stays on the spot facing it (and moving off may put it down).
		const held = ctx.hold(moving || input.jumpQueued);
		if (held !== null) {
			steer.set(0, 0, 0);
			moving = false;
			input.jumpQueued = false;
			input.waveQueued = false;
			input.dashQueued = false;
			heading = held;
		}
		// A dash: a quick dart the way she's steering (or facing), on her feet or once in the air.
		dashRest = Math.max(0, dashRest - dt);
		if (input.dashQueued) {
			input.dashQueued = false;
			const airborne = !grounded && !swimming;
			if (ctx.canDash?.() && !swimming && dashRest === 0 && !(airborne && airDashed)) {
				if (moving) dashDir.copy(steer).normalize();
				else dashDir.set(Math.sin(heading), 0, Math.cos(heading));
				dashing = DASH_TIME;
				dashRest = DASH_TIME + DASH_REST;
				heading = Math.atan2(dashDir.x, dashDir.z);
				if (airborne) {
					airDashed = true;
					gliding = false;
					vy = Math.max(vy, 1.5);
				}
				waving = 0;
				puff();
				puffClock = 0.04;
			}
		}
		// Gliding, she keeps sailing on the way she's facing even with nothing held, unless the wind
		// is carrying her up, when she hangs in it.
		const lift = windLift(pos.x, pos.z, pos.y);
		if (gliding && !moving && lift === 0) steer.set(Math.sin(heading) * 0.6, 0, Math.cos(heading) * 0.6);

		const wading = grounded && pos.y < 0.05;
		const wing = ctx.glider?.() ?? { speed: GLIDE, sink: GLIDE_SINK };
		const speed = gliding ? wing.speed : swimming ? (running ? SWIM_FAST : SWIM) : (running ? RUN : WALK) * (wading ? 0.6 : 1);
		// In the water she glides, and in the air she can only steer a little (more so under the wing).
		const control = grounded ? 10 : swimming ? 4 : gliding ? 2.2 : 3;
		if (dashing > 0) {
			// Mid-dash she goes flat out, and afterwards eases back to her own pace (slowly, in the
			// air, so a dash off a jump carries her a long way).
			dashing = Math.max(0, dashing - dt);
			vel.x = dashDir.x * DASH_SPEED;
			vel.z = dashDir.z * DASH_SPEED;
			puffClock -= dt;
			if (puffClock <= 0) {
				puff();
				puffClock = 0.05;
			}
		} else {
			vel.x = damp(vel.x, steer.x * speed, control, dt);
			vel.z = damp(vel.z, steer.z * speed, control, dt);
		}

		// Move, sliding along whatever stops her rather than sticking to it. Standing on something
		// that moves (a belt), she goes along with it, on top of her own walking. Going fast, she
		// moves a little at a time, so she meets whatever's in the way rather than stepping over it.
		const carried = grounded ? ctx.carriedBy?.(pos.x, pos.z, pos.y) : null;
		const mx = (vel.x + (carried?.x ?? 0)) * dt;
		const mz = (vel.z + (carried?.z ?? 0)) * dt;
		const steps = Math.max(1, Math.ceil(Math.hypot(mx, mz) / STEP_MAX));
		for (let k = 0; k < steps; k++) {
			const nx = pos.x + mx / steps;
			const nz = pos.z + mz / steps;
			if (canGo(nx, nz)) {
				pos.x = nx;
				pos.z = nz;
			} else if (canGo(nx, pos.z)) {
				pos.x = nx;
				vel.z = 0;
			} else if (canGo(pos.x, nz)) {
				pos.z = nz;
				vel.x = 0;
			} else {
				vel.x = vel.z = 0;
				dashing = 0;
				break;
			}
			pushOut(pos);
			// Stepping along the ground, keep her feet on it as she goes (so she follows slopes and
			// edges the same at speed as walking).
			if (grounded && !swimming && steps > 1) {
				const g = groundAt(pos.x, pos.z, pos.y);
				if (g >= pos.y - 0.6) pos.y = Math.max(g, SWIM_IN);
				else break;
			}
		}

		const ground = groundAt(pos.x, pos.z, pos.y);
		// She can jump from her feet, or spring up out of the water: high enough to reach the pier.
		// Jumping again in mid-air opens the glider, and once more folds it away.
		if (input.jumpQueued && (grounded || swimming)) {
			if (swimming) ctx.ripple(pos.x, pos.z, 1.2);
			vy = JUMP_SPEED;
			grounded = false;
			swimming = false;
			jumped = true;
			airTime = 0;
			waving = 0;
		} else if (input.jumpQueued) {
			if (gliding) gliding = false;
			else if (airTime > 0.15 && pos.y - ground > 0.9) gliding = true;
		}
		input.jumpQueued = false;
		const intoWater = () => {
			// The swimming clips float her with the water line at her origin, which lines her
			// shoulders up with where they were standing chest deep, so she needn't jump.
			swimming = true;
			grounded = false;
			gliding = false;
			vy = 0;
			waving = 0;
			ctx.ripple(pos.x, pos.z, 1.5);
		};
		if (swimming) {
			if (ground > SWIM_OUT) {
				swimming = false;
				grounded = true;
				pos.y = ground;
			} else {
				swimClock += dt;
				pos.y = Math.sin(swimClock * 2.2) * 0.05;
			}
		} else if (grounded) {
			if (ground < SWIM_IN) {
				intoWater();
			} else if (ground < pos.y - 0.6) {
				// Stepped off an edge.
				grounded = false;
				jumped = false;
				vy = 0;
				airTime = 0;
			} else {
				pos.y = ground;
			}
		}
		if (!grounded && !swimming) {
			airTime += dt;
			// Under the glider the wind lifts her; without it, it only slows her fall a little.
			if (gliding) vy = damp(vy, lift > 0 ? lift : -wing.sink, lift > 0 ? 2 : 3, dt);
			// Darting through the air, she holds her height.
			else if (dashing > 0) vy = damp(vy, 0, 8, dt);
			else vy = Math.max(vy - GRAVITY * (lift > 0 ? 0.6 : 1) * dt, -FALL_MAX);
			pos.y += vy * dt;
			// She bumps her head on the underside of the sky island rather than rising into it.
			const ceiling = ceilingAt(pos.x, pos.z, pos.y);
			if (pos.y + HEAD > ceiling) {
				pos.y = ceiling - HEAD;
				vy = Math.min(vy, 0);
			}
			if (pos.y <= 0 && ground < SWIM_IN && vy <= 0) {
				pos.y = 0;
				intoWater();
			} else if (pos.y <= ground && vy <= 0) {
				pos.y = ground;
				grounded = true;
				gliding = false;
				vy = 0;
			}
		}
		if (grounded || swimming) airDashed = false;
		for (const p of puffs) {
			if (!p.m.visible) continue;
			p.life -= dt * 2.6;
			p.m.visible = p.life > 0;
			(p.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, p.life) * 0.55;
			p.m.scale.setScalar(0.6 + (1 - p.life) * 1.4);
			p.m.position.y += dt * 0.4;
		}
		if (pos.y < -4) respawn();
		root.position.copy(pos);

		const planar = Math.hypot(vel.x, vel.z);
		if (planar > 0.2) heading = Math.atan2(vel.x, vel.z);
		turn += Math.atan2(Math.sin(heading - turn), Math.cos(heading - turn)) * (1 - Math.exp(-10 * dt));
		figure.group.rotation.y = turn;

		// The glider opens out over her head, and banks a little into her turns.
		gliderOpen = damp(gliderOpen, gliding ? 1 : 0, gliding ? 12 : 16, dt);
		glider.visible = gliderOpen > 0.02;
		glider.scale.setScalar(Math.max(gliderOpen, 0.01));
		glider.rotation.y = turn;
		glider.rotation.z = damp(glider.rotation.z, clamp(Math.atan2(Math.sin(heading - turn), Math.cos(heading - turn)) * -2, -0.35, 0.35), 5, dt);

		if (input.waveQueued && grounded) waving = 3.2;
		input.waveQueued = false;
		if (moving) waving = 0;
		waving = Math.max(0, waving - dt);
		let clip: NixClip = swimming ? (planar > 0.3 ? 'Swim' : 'Tread') : planar > 3 ? 'Run' : planar > 0.25 ? 'Walk' : 'Idle';
		if (waving > 0) clip = 'Wave';
		if (!swimming && ctx.carrying?.()) clip = planar > 0.25 ? 'CarryWalk' : 'Carry';
		clip = ctx.clip() ?? clip;
		// The clips are cut for about 1.5 (walk), 4.2 (run) and 2.4 (swim) a second.
		const pace =
			clip === 'Run' ? clamp(planar / 4.2, 0.8, 2.4) : clip === 'Walk' || clip === 'CarryWalk' ? clamp(planar / 1.5, 0.6, 2.6) : clip === 'Swim' ? clamp(planar / 2.4, 0.7, 1.6) : 1;
		figure.play(clip, pace);

		// Rings on the water: steadily as she swims, now and then as she treads water or wades.
		rippleClock -= dt;
		const wet = swimming || (grounded && pos.y < -0.15);
		if (wet && rippleClock <= 0) {
			ctx.ripple(pos.x, pos.z, swimming ? (planar > 0.3 ? 0.9 : 0.7) : 0.6);
			rippleClock = planar > 0.3 ? 0.4 : 1.1;
		}

		const airborne = !grounded && !swimming;
		// Under the glider she hangs in the middle of a jump, legs tucked.
		const t = gliding ? 0.5 : jumped ? clamp(airTime / FLIGHT, 0, 0.97) : clamp(0.5 + airTime, 0.5, 0.97);
		const flight = airborne ? { t, clip: 'JumpStand' as const } : null;
		return { flight, airborne };
	};

	const zero = new THREE.Vector2();
	return {
		figure,
		root,
		/** Where her feet are. The same vector throughout, so others can hold on to it. */
		pos,
		vel,
		get heading() {
			return heading;
		},
		/** Which way she's turned to, easing after `heading`. */
		get turn() {
			return turn;
		},
		get grounded() {
			return grounded;
		},
		get swimming() {
			return swimming;
		},
		/** Whether she's mid-dash. */
		get dashing() {
			return dashing > 0;
		},
		/** Repaints the glider's stripes, in turn across the wing (six of them). */
		paintGlider: (...stripes: string[]) => paintGlider(...stripes),
		/** How far open her glider is, 0 … 1. */
		get gliderOpen() {
			return gliderOpen;
		},
		update(dt: number, time: number) {
			const { flight, airborne } = step(dt);
			// Dropping into the water isn't a landing, so no bending of the knees.
			figure.tick(dt, time, { airborne, look: zero, still: false, jump: flight, landed: !swimming });
			nextBlink -= dt;
			if (nextBlink < 0) {
				const closed = nextBlink > -0.13;
				figure.setBlink(closed);
				if (!closed) nextBlink = 2.5 + Math.random() * 3;
			}
		},
	};
}

export type Player = ReturnType<typeof createPlayer>;
