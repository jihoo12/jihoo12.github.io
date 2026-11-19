// Hollis, an old owl who lives under Cloudrest, on a ledge of one of the crags hanging from the
// great island: the one nearest the Windspout, so the way down to her is to let the wind go early
// and glide in under the rock. Nobody tells you she's there (Pebble only says she's seen eyes in the
// dark under the island, and the feather she lost is at the sky gate on /experimental). Find her and
// she teaches Nixchan to dash, the way the swifts do down there: Q (or the » button), a quick dart
// the way she's heading, on her feet or once in the air.
//
// She's built here, out of spheres and cones, rather than in Blender like Pebble: she only sits.
import * as THREE from 'three';
import type { Feature } from './features';
import type { Offer } from '../nixkit/interact';
import type { Toon } from './look';
import { loadText, saveText } from './save';
import { MAIN, WINDSPOUT, skyCeiling, type Crag } from './skyisle';
import type { Choice, Speaker, Talk } from './talk';
import { clamp, damp, noise } from '../nixkit/util';

const NAME = 'Hollis';

export interface OwlContext {
	scene: THREE.Scene;
	toon: Toon;
	/** The crags hanging under the islands (skyisle.ts); she picks hers from them. */
	crags: Crag[];
	addFeature: (f: Feature) => void;
	pos: THREE.Vector3;
	talk: Talk;
	night: () => boolean;
	canAct: () => boolean;
	toast: (text: string) => void;
	/** The first time she lands on the ledge, each visit. */
	arrive: () => void;
	/** She's been taught to dash. */
	learned: () => void;
}

/** Hollis's ledge: which crag it's on, how high, and where she sits on it. */
function perch(crags: Crag[]) {
	// The great island's crags that end well above the sea, and of those the nearest the Windspout.
	const crag = crags
		.filter((c) => c.top - c.length > 8 && Math.hypot(c.x - MAIN.x, c.z - MAIN.z) < MAIN.r)
		.sort((a, b) => Math.hypot(a.x - WINDSPOUT.x, a.z - WINDSPOUT.z) - Math.hypot(b.x - WINDSPOUT.x, b.z - WINDSPOUT.z))[0];
	if (!crag) return null;
	const bottom = crag.top - crag.length;
	/** How wide the crag is at height y. */
	const radiusAt = (y: number) => crag.radius * clamp((y - bottom) / crag.length, 0, 1);
	// Low on the crag, where it's thin, with room over it before the island's rock.
	let y = bottom + crag.length * 0.22;
	y = Math.min(y, skyCeiling(crag.x, crag.z, 0) - 8);
	// The ledge juts out the Windspout's way, so it's what you see coming in on the wind.
	const toward = Math.atan2(WINDSPOUT.x - crag.x, WINDSPOUT.z - crag.z);
	const dir = { x: Math.sin(toward), z: Math.cos(toward) };
	const r = radiusAt(y);
	const shelf = { x: crag.x + dir.x * (r + 1.1), z: crag.z + dir.z * (r + 1.1), r: 2.3 };
	const owl = { x: crag.x + dir.x * (radiusAt(y + 0.8) + 0.4), z: crag.z + dir.z * (radiusAt(y + 0.8) + 0.4) };
	return { crag, y, radiusAt, toward, shelf, owl };
}

export function createOwl(ctx: OwlContext) {
	const spot = perch(ctx.crags);
	if (!spot) return null;
	const { crag, y: LEDGE, shelf, toward } = spot;

	// ---------- the ledge, and what she can't walk through ----------

	const rock = ctx.toon({ color: '#9890bb' });
	{
		// A flat-topped shelf of rock, ragged round the edge, thinning underneath into the crag.
		const g = new THREE.CylinderGeometry(shelf.r, 0.9, 1.1, 11, 1).toNonIndexed();
		const p = g.attributes.position;
		for (let i = 0; i < p.count; i++) {
			const x = p.getX(i);
			const z = p.getZ(i);
			const k = 1 + 0.18 * noise(x * 1.7 + 3, z * 1.7 - 1);
			p.setXYZ(i, x * k, p.getY(i), z * k);
		}
		g.computeVertexNormals();
		const ledge = new THREE.Mesh(g, rock);
		ledge.position.set(shelf.x, LEDGE - 0.55, shelf.z);
		ledge.castShadow = ledge.receiveShadow = true;
		ctx.scene.add(ledge);
		// A few tufts of moss, and a nest of twigs at her feet.
		const moss = ctx.toon({ color: '#6aa85a' });
		for (let i = 0; i < 4; i++) {
			const a = toward + (i - 1.5) * 0.9;
			const tuft = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22 + (i % 2) * 0.08, 0), moss);
			tuft.position.set(shelf.x + Math.sin(a) * 1.5, LEDGE + 0.02, shelf.z + Math.cos(a) * 1.5);
			tuft.scale.y = 0.45;
			ctx.scene.add(tuft);
		}
		const twigs = ctx.toon({ color: '#8a6a4a' });
		for (let i = 0; i < 9; i++) {
			const twig = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 4), twigs);
			const a = (i / 9) * Math.PI * 2;
			twig.position.set(spot.owl.x + Math.sin(a) * 0.3, LEDGE + 0.06, spot.owl.z + Math.cos(a) * 0.3);
			twig.rotation.set(Math.PI / 2, 0, a + 1.3);
			ctx.scene.add(twig);
		}
	}
	ctx.addFeature({ x: shelf.x, z: shelf.z, r: shelf.r - 0.15, pad: LEDGE, floor: LEDGE });
	// The crag itself, in steps up from the ledge (it's only solid round there; elsewhere it's still
	// just to look at, as the others are), and Hollis.
	for (let y = LEDGE - 1; y < crag.top; y += 2) ctx.addFeature({ x: crag.x, z: crag.z, r: spot.radiusAt(y + 2) * 0.92 + 0.1, top: y + 2, floor: y });
	ctx.addFeature({ x: spot.owl.x, z: spot.owl.z, r: 0.3, top: LEDGE + 1.2, floor: LEDGE });

	// ---------- Hollis ----------

	const root = new THREE.Group();
	root.position.set(spot.owl.x, LEDGE, spot.owl.z);
	root.rotation.y = toward;
	ctx.scene.add(root);
	const ink = new THREE.MeshBasicMaterial({ color: '#1d1b3a', side: THREE.BackSide });
	ink.onBeforeCompile = (shader) => {
		shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normal * 0.018;');
	};
	const part = (geo: THREE.BufferGeometry, mat: THREE.Material, at: [number, number, number], scale: [number, number, number] = [1, 1, 1], parent: THREE.Object3D = root, outline = true) => {
		const m = new THREE.Mesh(geo, mat);
		m.position.set(...at);
		m.scale.set(...scale);
		m.castShadow = true;
		if (outline) m.add(new THREE.Mesh(geo, ink));
		parent.add(m);
		return m;
	};
	const feathers = ctx.toon({ color: '#8b6a4e' });
	const dark = ctx.toon({ color: '#6b4f3c' });
	const cream = ctx.toon({ color: '#ecdcb8' });
	const beakMat = ctx.toon({ color: '#e0a73a' });
	// Her eyes glow a little after dark (that's what Pebble's seen).
	const eyeMat = new THREE.MeshBasicMaterial({ color: '#ffb43a' });
	const pupilMat = new THREE.MeshBasicMaterial({ color: '#1d1b3a' });
	const sphere = new THREE.SphereGeometry(1, 14, 10);

	const body = new THREE.Group();
	body.position.y = 0.5;
	root.add(body);
	part(sphere, feathers, [0, 0, 0], [0.42, 0.5, 0.38], body);
	part(sphere, cream, [0, -0.04, 0.16], [0.32, 0.4, 0.26], body, false);
	// Her chest's barred, a few darker chevrons down the cream.
	for (let i = 0; i < 3; i++) part(new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, 0.5), dark, [0, 0.12 - i * 0.14, 0.4 - i * 0.01], [0.06, 0.03, 0.05], body, false).rotation.x = Math.PI / 2;
	const wings = [-1, 1].map((side) => {
		const pivot = new THREE.Group();
		pivot.position.set(side * 0.34, 0.18, -0.02);
		body.add(pivot);
		part(sphere, dark, [side * 0.06, -0.24, 0], [0.12, 0.34, 0.28], pivot);
		return pivot;
	});
	for (const side of [-1, 1]) {
		const foot = part(new THREE.SphereGeometry(1, 8, 6), beakMat, [side * 0.14, -0.47, 0.18], [0.09, 0.05, 0.12], body);
		foot.rotation.y = side * 0.2;
	}
	const tail = part(new THREE.ConeGeometry(0.16, 0.32, 6), dark, [0, -0.4, -0.3], [1, 1, 0.5], body);
	tail.rotation.x = -2.5;

	const head = new THREE.Group();
	head.position.y = 1.08;
	root.add(head);
	part(sphere, feathers, [0, 0, 0], [0.4, 0.34, 0.36], head);
	// The facial disc, two pale rings that the eyes sit in, and the brow over them.
	const eyes: THREE.Group[] = [];
	for (const side of [-1, 1]) {
		const disc = part(new THREE.CircleGeometry(0.17, 18), cream, [side * 0.15, 0.01, 0.31], [1, 1, 1], head, false);
		disc.rotation.y = side * 0.32;
		const eye = new THREE.Group();
		eye.position.set(side * 0.15, 0.02, 0.32);
		eye.rotation.y = side * 0.32;
		head.add(eye);
		part(new THREE.SphereGeometry(0.095, 12, 8), eyeMat, [0, 0, 0], [1, 1, 0.5], eye, false);
		part(new THREE.SphereGeometry(0.05, 10, 6), pupilMat, [0, 0, 0.04], [1, 1, 0.5], eye, false);
		eyes.push(eye);
		const tuft = part(new THREE.ConeGeometry(0.07, 0.26, 5), dark, [side * 0.25, 0.3, -0.02], [1, 1, 0.6], head);
		tuft.rotation.z = -side * 0.45;
	}
	const beak = part(new THREE.ConeGeometry(0.05, 0.14, 6), beakMat, [0, -0.07, 0.36], [1, 1, 1], head);
	beak.rotation.x = Math.PI * 0.62;
	// A glow round her, after dark, so the eyes show from out on the wind.
	const glow = new THREE.PointLight('#ffcf7a', 0, 7, 2);
	glow.position.set(0, 1.1, 0.6);
	root.add(glow);

	// Her lost feather, on the ledge beside her once Nixchan's found it (it's at the sky gate on
	// /experimental, and picking it up there brings it here).
	const featherFound = loadText('feather') === '1';
	if (featherFound) {
		const quill = new THREE.Group();
		quill.position.set(0.55, 0, 0.15);
		quill.rotation.set(0.35, 0.4, -0.25);
		root.add(quill);
		part(new THREE.CylinderGeometry(0.012, 0.012, 0.6, 4), cream, [0, 0.3, 0], [1, 1, 1], quill, false);
		part(sphere, feathers, [0, 0.38, 0], [0.07, 0.24, 0.015], quill);
	}

	// ---------- talking ----------

	type Saved = '' | 'met' | 'taught';
	let state = (loadText('owl') ?? '') as Saved;
	const save = (s: Saved) => {
		state = s;
		saveText('owl', s);
	};
	const touch = matchMedia('(pointer: coarse)').matches;
	const button = touch ? 'the » button' : 'Q';
	let happyUntil = 0;
	const speaker: Speaker = { name: NAME, color: '#7a5c8e' };
	const say = (text: string, next: Choice[]) => ctx.talk.say(text, next);
	const bye = (): Choice => ({ label: 'Bye!', run: () => ctx.talk.bye(ctx.night() ? 'Hoo. Fly safe in the dark.' : 'Off you go. Mind the drop!') });

	const TIPS = [
		() => 'Dash right at the top of a jump, and you clear twice the gap.',
		() => "A dash in the air folds your glider away. Open it again straight after and you'll go further still.",
		() => 'The swifts only dash once in the air. Touch the ground, and you have it back.',
		() => "Dashing's quicker than running, but it tires you a moment. Catch your breath between.",
		() =>
			loadText('feather') === '1'
				? "Thank you for bringing my feather home. It's just there, see?"
				: "I lost a feather to the wind a while back. It blew somewhere strange: the end of a long path, by a gate full of sky. If you see it, it's mine.",
	];
	let tip = Math.floor(Math.random() * TIPS.length);
	const tips = (): Choice => ({ label: 'Any tips?', run: () => say(TIPS[tip++ % TIPS.length](), [tips(), bye()]) });

	const teach = () => {
		save('taught');
		happyUntil = performance.now() + 2200;
		say(`Hoo hoo! Anyone who finds me down here has earned it. Watch the swifts: tuck in, and go! Press ${button} to dash the way you're heading. On your feet, or once in the air before you land.`, [
			{ label: 'Thank you!', run: () => ctx.talk.bye("Go on, try it. Not off the ledge, mind! Well. Unless you've got your glider.") },
		]);
		ctx.learned();
	};
	const open = () => {
		if (!ctx.talk.open(speaker)) return;
		if (state === '') {
			save('met');
			const feather = featherFound ? ' And is that my feather you found? Well, well.' : '';
			say(`Hoo? A visitor, all the way down here? Nobody comes under the rock. Nobody but the swifts.${feather}`, [
				{
					label: 'Who are you?',
					run: () =>
						say("Hollis. I've lived under Cloudrest longer than the island's had a name. I sit here and watch the swifts dart in and out of the crags. Quick as a blink, they are.", [
							{ label: 'Can you teach me that?', run: teach },
							bye(),
						]),
				},
				bye(),
			]);
		} else if (state === 'met') {
			say("Back again? You've the look of someone who wants to move like a swift.", [{ label: 'Teach me!', run: teach }, bye()]);
		} else {
			const hello = ctx.night() ? "Hoo. Lovely night, Nixchan. Best time there is, for an owl." : 'Mm? Oh, Nixchan. I was only resting my eyes.';
			say(hello, [tips(), bye()]);
		}
	};

	// ---------- every frame ----------

	let near = false;
	let landed = false;
	let yaw = 0;
	let pitch = 0;
	let nextBlink = 2;
	let tilt = 0;
	let nextTilt = 4;
	const above = new THREE.Vector3(root.position.x, LEDGE + 1.8, root.position.z);
	const onLedge = () => Math.hypot(ctx.pos.x - shelf.x, ctx.pos.z - shelf.z) < shelf.r + 0.2 && Math.abs(ctx.pos.y - LEDGE) < 0.3;
	const talking = () => ctx.talk.speaker === speaker;

	const update = (dt: number, time: number) => {
		const dx = ctx.pos.x - root.position.x;
		const dz = ctx.pos.z - root.position.z;
		const dy = ctx.pos.y + 1.2 - (LEDGE + 1.1);
		const flat = Math.hypot(dx, dz);
		const dist = Math.hypot(flat, dy);
		if (!near && dist < 10) {
			near = true;
			if (!ctx.talk.talking) ctx.talk.bubble(state === '' ? 'Hoo?' : 'Hoo hoo!', above);
		} else if (near && dist > 16) near = false;
		if (!landed && onLedge()) {
			landed = true;
			ctx.arrive();
		}
		if (talking() && dist > 3.8) ctx.talk.close();

		// Night or day, she keeps her eyes on Nixchan when she's about, and her head goes round
		// further than any neck should.
		const local = Math.atan2(dx, dz) - toward;
		const wantYaw = dist < 18 ? clamp(Math.atan2(Math.sin(local), Math.cos(local)), -2.7, 2.7) : Math.sin(time * 0.3) * 0.6;
		yaw = damp(yaw, wantYaw, 6, dt);
		pitch = damp(pitch, dist < 18 ? clamp(-Math.atan2(dy, Math.max(flat, 0.5)), -0.6, 0.6) : 0, 5, dt);
		nextTilt -= dt;
		if (nextTilt < 0) {
			tilt = tilt ? 0 : (Math.random() < 0.5 ? -1 : 1) * 0.35;
			nextTilt = tilt ? 1.2 : 4 + Math.random() * 4;
		}
		const bob = talking() ? Math.sin(time * 9) * 0.04 : 0;
		head.rotation.set(pitch + bob, yaw, damp(head.rotation.z, tilt, 6, dt), 'YXZ');
		body.scale.y = 1 + Math.sin(time * 2.1) * 0.015;

		// Blinking; and by day, with nobody about, she dozes with her eyes half shut.
		nextBlink -= dt;
		if (nextBlink < -0.14) nextBlink = 2.5 + Math.random() * 3;
		const sleepy = !ctx.night() && !near;
		const lid = nextBlink < 0 ? 0.1 : sleepy ? 0.35 : 1;
		for (const e of eyes) e.scale.y = damp(e.scale.y, lid, 20, dt);

		// Delighted, she flaps.
		const happy = performance.now() < happyUntil;
		wings.forEach((w, i) => (w.rotation.z = damp(w.rotation.z, happy ? (i ? -1 : 1) * (0.6 + Math.sin(time * 18) * 0.5) : 0, 12, dt)));

		glow.intensity = damp(glow.intensity, ctx.night() ? 2.5 : 0, 2, dt);
	};

	return {
		name: NAME,
		update,
		/** E on her ledge, by her. */
		offer: (): Offer | null => {
			if (talking() || !onLedge() || Math.hypot(ctx.pos.x - root.position.x, ctx.pos.z - root.position.z) > 2.8 || !ctx.canAct()) return null;
			return { label: state === '' ? 'Talk to the owl' : `Talk to ${NAME}`, go: open };
		},
		get talking() {
			return talking();
		},
		get met() {
			return state !== '';
		},
		spot: { x: root.position.x, z: root.position.z },
		/** The ledge: its middle and height. */
		ledge: { x: shelf.x, y: LEDGE, z: shelf.z },
		/** The way for Nixchan to face her. */
		get facing() {
			return Math.atan2(root.position.x - ctx.pos.x, root.position.z - ctx.pos.z);
		},
	};
}

/** Whether Hollis has taught her to dash. */
export const canDash = () => loadText('owl') === 'taught';
