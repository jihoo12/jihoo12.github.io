// Pebble, the sea otter who keeps the market stand in Nixchan's garden. She stands behind the
// counter, turns her head to follow Nixchan about, and waves hello when she comes by. Talking to
// her (E at the stand) gets a word about the time of day and how Nixchan's getting on, a tip for
// something she hasn't done yet, and the market. The model and her clips (Idle, Wave, Talk, Happy)
// are made in Blender (tools/island-otter).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Toon } from './look';
import { loadText, saveText } from './save';
import { clamp, damp } from './util';

type Clip = 'Idle' | 'Wave' | 'Talk' | 'Happy';

/** What Pebble knows about how Nixchan's getting on. */
export interface Facts {
	night: boolean;
	caughtKinds: number;
	fishKinds: number;
	hasCaught: (id: string) => boolean;
	found: (place: string) => boolean;
	/** What in her bag the stand would buy, and what it'd all fetch. */
	sellable: { count: number; value: number; name: string | null };
	seeds: number;
	garden: { planted: number; thirsty: string | null; ripe: string | null; coins: number };
}

export interface NpcContext {
	scene: THREE.Scene;
	camera: THREE.Camera;
	toon: Toon;
	modelUrl: string;
	spot: { x: number; z: number; angle: number };
	groundAt: (x: number, z: number) => number;
	/** Where Nixchan is. */
	pos: THREE.Vector3;
	facts: () => Facts;
	openShop: () => void;
}

const NAME = 'Pebble';

/** Tips, most pressing first; she gives the first that fits and that she hasn't said lately. */
const TIPS: { id: string; when: (f: Facts) => boolean; say: (f: Facts) => string }[] = [
	{ id: 'ripe', when: (f) => !!f.garden.ripe, say: (f) => `Your ${f.garden.ripe!.toLowerCase()} looks ripe to me! Pick it before it gets ideas.` },
	{ id: 'thirsty', when: (f) => !!f.garden.thirsty, say: (f) => `That ${f.garden.thirsty!.toLowerCase()} of yours looks thirsty. The barrel's just over there.` },
	{ id: 'sell', when: (f) => f.sellable.value >= 40, say: (f) => `I'd give you ${f.sellable.value} coins for what's in your bag. Just saying!` },
	{ id: 'plant', when: (f) => f.seeds > 0 && f.garden.planted < 12, say: () => "Those seeds won't plant themselves! Stand on a plot and press E." },
	{ id: 'fish', when: (f) => f.caughtKinds === 0, say: () => 'Ever been fishing? Face the sea where the water gets deep, cast with F, and wait for the bobber to dunk.' },
	{ id: 'pumpkin', when: (f) => f.garden.coins >= 80, say: () => "You've got enough for pumpkin seeds now. Slow growers, but nobody pays more for a crop." },
	{ id: 'moonfish', when: (f) => f.night && !f.hasCaught('moonfish'), say: () => 'On a night like this the Moonfish come up from the deep. Biggest fish there is!' },
	{ id: 'snapper', when: (f) => !f.night && !f.hasCaught('snapper'), say: () => 'Sunny Snappers love deep water while the sun is up. Try the end of the pier.' },
	{ id: 'sky', when: (f) => !f.found('sky'), say: () => "Ever looked up past the summit? There are islands floating up there! The wind at the Windspout blows straight up. Open your glider in it and hold on." },
	{ id: 'spire', when: (f) => f.found('sky') && !f.found('spire'), say: () => "Been up to Cloudrest? There's a second wind up there, by the temple, that goes higher still. Something's waiting at the top of the spire." },
	{ id: 'skyfish', when: (f) => f.found('sky') && !f.hasCaught('cloudkoi'), say: () => "They say the lake on Cloudrest has fish in it that have never once seen the sea. Imagine!" },
	{ id: 'islet', when: (f) => !f.found('islet'), say: () => "See that little islet out at sea? You can swim there, or glide from up high. There's a fish there you won't find anywhere else." },
	{ id: 'stones', when: (f) => !f.found('stones'), say: () => "There's a ring of old standing stones up in the hills. Gives me the shivers after dark." },
	{ id: 'lighthouse', when: (f) => !f.found('lighthouse'), say: () => 'The lighthouse round the coast is lovely at night. Its beam sweeps right across the sea.' },
	{ id: 'strawberry', when: () => true, say: () => 'Strawberries keep fruiting after you pick them. Best deal on the island, if you ask me.' },
	{ id: 'map', when: () => true, say: () => "Lost? Press M for your map. It fills in as you go, so go everywhere!" },
	{ id: 'allfish', when: (f) => f.caughtKinds >= f.fishKinds, say: () => "Every kind of fish in the sea? You're the best angler this island's ever had!" },
	{ id: 'glide', when: () => true, say: () => 'From the top of the hill you can glide nearly anywhere. Jump, then jump again!' },
];

export function createNpc(ctx: NpcContext) {
	const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel);
	const ui = { talk: $('[data-talk]'), text: $('[data-talk-text]'), choices: $('[data-talk-choices]'), bubble: $('[data-bubble]') };

	const root = new THREE.Group();
	// She stands on a step behind the counter, so she can see over the produce.
	const STEP = 0.3;
	const floor = ctx.groundAt(ctx.spot.x, ctx.spot.z);
	root.position.set(ctx.spot.x, floor + STEP, ctx.spot.z);
	root.rotation.y = ctx.spot.angle;
	root.scale.setScalar(1.3);
	ctx.scene.add(root);
	{
		const step = new THREE.Mesh(new THREE.BoxGeometry(0.9, STEP + 0.3, 0.7), ctx.toon({ color: '#8a5a3c' }));
		step.position.set(ctx.spot.x, floor + STEP / 2 - 0.15, ctx.spot.z);
		step.rotation.y = ctx.spot.angle;
		step.castShadow = step.receiveShadow = true;
		ctx.scene.add(step);
	}

	let mixer: THREE.AnimationMixer | null = null;
	let head: THREE.Object3D | null = null;
	const actions = new Map<Clip, THREE.AnimationAction>();
	const weights = new Map<Clip, number>();
	let clip: Clip = 'Idle';

	// Toon materials in her own colours, each mesh with an ink line round it (bending with the rig,
	// for the parts that bend).
	const ink = new THREE.MeshBasicMaterial({ color: '#1d1b3a', side: THREE.BackSide });
	ink.onBeforeCompile = (shader) => {
		shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normal * 0.01;');
	};
	new GLTFLoader().loadAsync(ctx.modelUrl).then(
		(gltf) => {
			const model = gltf.scene;
			const meshes: THREE.Mesh[] = [];
			model.traverse((o) => o instanceof THREE.Mesh && meshes.push(o));
			for (const mesh of meshes) {
				const placeholder = mesh.material as THREE.MeshStandardMaterial;
				mesh.material = ctx.toon({ color: placeholder.color });
				mesh.castShadow = true;
				if (/Whisker|Shine|Eye|Blush/.test(placeholder.name)) continue;
				if (mesh instanceof THREE.SkinnedMesh) {
					const line = new THREE.SkinnedMesh(mesh.geometry, ink);
					line.bind(mesh.skeleton, mesh.bindMatrix);
					mesh.frustumCulled = line.frustumCulled = false;
					mesh.add(line);
				} else {
					mesh.add(new THREE.Mesh(mesh.geometry, ink));
				}
			}
			head = model.getObjectByName('Head') ?? null;
			mixer = new THREE.AnimationMixer(model);
			for (const animation of gltf.animations) {
				const action = mixer.clipAction(animation);
				action.play();
				action.setEffectiveWeight(animation.name === 'Idle' ? 1 : 0);
				actions.set(animation.name as Clip, action);
				weights.set(animation.name as Clip, animation.name === 'Idle' ? 1 : 0);
			}
			root.add(model);
		},
		() => {
			// No Pebble, then; the stand still opens.
		},
	);
	const play = (next: Clip) => {
		if (next === clip) return;
		clip = next;
		const action = actions.get(next);
		if (action && (weights.get(next) ?? 0) < 0.05) action.time = 0;
	};

	// ---------- speech ----------

	let met = loadText('pebbleMet') === '1';
	const recent: string[] = [];
	const nextTip = (f: Facts) => {
		const tip = TIPS.find((t) => t.when(f) && !recent.includes(t.id)) ?? TIPS.find((t) => t.when(f))!;
		recent.unshift(tip.id);
		recent.length = Math.min(recent.length, 4);
		return tip.say(f);
	};
	const greeting = (f: Facts) => {
		if (!met) {
			met = true;
			saveText('pebbleMet', '1');
			return `Oh, hello! You must be Nixchan. I'm ${NAME}, and this is my stand: seeds to sell, and a fair price for anything you catch or grow.`;
		}
		if (f.night) return 'Up late, Nixchan? The best fish come out after dark, you know.';
		if (f.garden.coins >= 300) return "Well, if it isn't the richest gardener on the island! What'll it be?";
		return ['Hello again, Nixchan! Lovely day for it.', 'Nixchan! What can I do for you?', "Back again? I was hoping you'd come by."][Math.floor(Math.random() * 3)];
	};

	let talking = false;
	let typing = '';
	let shown = 0;
	let choices: { label: string; run: () => void }[] = [];
	let chosen = 0;
	let closeAt = 0;
	const say = (text: string, next: { label: string; run: () => void }[]) => {
		typing = text;
		shown = 0;
		choices = next;
		chosen = 0;
		if (ui.text) ui.text.textContent = '';
		ui.choices?.replaceChildren();
		play('Talk');
	};
	const drawChoices = () => {
		if (!ui.choices) return;
		ui.choices.replaceChildren(
			...choices.map((c, i) => {
				const b = document.createElement('button');
				b.type = 'button';
				b.textContent = c.label;
				b.setAttribute('aria-pressed', String(i === chosen));
				b.addEventListener('click', () => c.run());
				return b;
			}),
		);
	};
	const menu = () => [
		{ label: "Let's trade", run: () => (close(), ctx.openShop()) },
		{ label: 'Any tips?', run: () => say(nextTip(ctx.facts()), menu()) },
		{ label: 'Bye!', run: () => (say(ctx.facts().night ? 'Night night, Nixchan. Mind the dark!' : 'See you soon, Nixchan!', []), (closeAt = performance.now() + 1600)) },
	];
	const open = () => {
		if (!ui.talk) return ctx.openShop();
		talking = true;
		closeAt = 0;
		ui.talk.hidden = false;
		const f = ctx.facts();
		const hello = greeting(f);
		say(`${hello} ${nextTip(f)}`, menu());
	};
	function close() {
		talking = false;
		closeAt = 0;
		if (ui.talk) ui.talk.hidden = true;
		play('Idle');
	}

	/** Keys while she's talking: E, Space or Enter to hurry her along or pick, arrows to choose, Esc to go. */
	const key = (k: string) => {
		if (k === 'escape') return close();
		if (k === 'arrowleft' || k === 'arrowup') chosen = (chosen + choices.length - 1) % Math.max(choices.length, 1);
		else if (k === 'arrowright' || k === 'arrowdown') chosen = (chosen + 1) % Math.max(choices.length, 1);
		else if (k === 'e' || k === ' ' || k === 'enter') {
			if (shown < typing.length) shown = typing.length;
			else if (choices[chosen]) return choices[chosen].run();
			else if (!choices.length) return close();
		} else if (/^[1-9]$/.test(k) && choices[Number(k) - 1]) return choices[Number(k) - 1].run();
		drawChoices();
	};

	// ---------- every frame ----------

	let near = false;
	let waveUntil = 0;
	let happyUntil = 0;
	let bubbleUntil = 0;
	let yaw = 0;
	const look = new THREE.Quaternion();
	const up = new THREE.Vector3(0, 1, 0);
	const above = new THREE.Vector3();
	const bubble = (text: string, seconds = 2.6) => {
		if (!ui.bubble) return;
		ui.bubble.textContent = text;
		ui.bubble.hidden = false;
		bubbleUntil = performance.now() + seconds * 1000;
	};

	const update = (dt: number) => {
		const now = performance.now();
		const dx = ctx.pos.x - ctx.spot.x;
		const dz = ctx.pos.z - ctx.spot.z;
		const dist = Math.hypot(dx, dz);
		// A wave and a hello as Nixchan comes by.
		if (!near && dist < 7.5) {
			near = true;
			if (!talking) {
				waveUntil = now + 2400;
				bubble(ctx.facts().night ? 'Evening, Nixchan!' : met ? 'Hi, Nixchan!' : 'Hello there!');
			}
		} else if (near && dist > 11) {
			near = false;
		}
		if (talking) {
			if (shown < typing.length) {
				shown = Math.min(typing.length, shown + dt * 55);
				if (ui.text) ui.text.textContent = typing.slice(0, Math.floor(shown));
				if (shown >= typing.length) drawChoices();
			} else if (clip === 'Talk') {
				play('Idle');
			}
			if (closeAt && now > closeAt) close();
			// Walking off ends the chat.
			if (dist > 3.5) close();
		}
		if (!talking) play(now < happyUntil ? 'Happy' : now < waveUntil ? 'Wave' : 'Idle');

		if (mixer) {
			for (const [name, action] of actions) {
				const w = damp(weights.get(name) ?? 0, name === clip ? 1 : 0, 8, dt);
				weights.set(name, w);
				action.setEffectiveWeight(w);
			}
			mixer.update(dt);
			// Her head turns to follow Nixchan when she's about, as far as an otter's neck goes.
			const local = Math.atan2(dx, dz) - ctx.spot.angle;
			const want = dist < 12 ? clamp(Math.atan2(Math.sin(local), Math.cos(local)), -0.9, 0.9) : 0;
			yaw = damp(yaw, want, 5, dt);
			head?.quaternion.multiply(look.setFromAxisAngle(up, yaw));
		}

		// The speech bubble floats over her head.
		if (ui.bubble && !ui.bubble.hidden) {
			if (now > bubbleUntil || talking) ui.bubble.hidden = true;
			above.set(root.position.x, root.position.y + 2.2, root.position.z).project(ctx.camera);
			const onScreen = above.z < 1 && Math.abs(above.x) < 1.1 && Math.abs(above.y) < 1.1;
			ui.bubble.style.visibility = onScreen ? 'visible' : 'hidden';
			ui.bubble.style.transform = `translate(${((above.x + 1) / 2) * innerWidth}px, ${((1 - above.y) / 2) * innerHeight}px) translate(-50%, -100%)`;
		}
	};

	return {
		name: NAME,
		open,
		close,
		key,
		update,
		/** A sale or a purchase: she's delighted. */
		cheer() {
			happyUntil = performance.now() + 1500;
			bubble(['Pleasure doing business!', 'Thank you kindly!', 'Ooh, lovely!'][Math.floor(Math.random() * 3)], 1.8);
		},
		get talking() {
			return talking;
		},
		/** Where she stands. */
		spot: ctx.spot,
		/** The way for Nixchan to face her. */
		get facing() {
			return Math.atan2(ctx.spot.x - ctx.pos.x, ctx.spot.z - ctx.pos.z);
		},
	};
}
