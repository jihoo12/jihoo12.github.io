// Pebble, the sea otter who keeps the market stand in Nixchan's garden. She stands behind the
// counter, turns her head to follow Nixchan about, and waves hello when she comes by. Talking to
// her (E at the stand) gets a word about the time of day and how Nixchan's getting on, a tip for
// something she hasn't done yet, and the market. The model and her clips (Idle, Wave, Talk, Happy)
// are made in Blender (tools/island-otter).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Toon } from './look';
import { loadText, saveText } from './save';
import type { Choice, Speaker, Talk } from './talk';
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
	/** Whether she's made this at the forge. */
	forged: (id: 'can' | 'rod' | 'glider' | 'helper') => boolean;
	/** How many sprinklers she has, set up or not. */
	sprinklers: number;
	/** Whether she's found Hollis, down under Cloudrest. */
	owlMet: boolean;
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
	talk: Talk;
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
	{ id: 'forge', when: (f) => !f.found('forge'), say: () => "There's an old forge past the garden that nobody's used in years. Iron ore crops out of the rocks up in the hills, if you fancy having a go!" },
	{ id: 'sprinkler', when: (f) => f.found('forge') && f.garden.planted > 0 && f.sprinklers === 0, say: () => "Tired of all that watering? The forge can make sprinklers, two iron ingots apiece. Set one where four plots meet and it waters the lot!" },
	{ id: 'sprocket', when: (f) => f.sprinklers >= 2 && !f.forged('helper'), say: () => "I've heard a clever smith can build a little clockwork helper that picks the crops for you. It'd want sky shards, mind." },
	{ id: 'skyglider', when: (f) => f.found('forge') && f.found('sky') && !f.forged('glider'), say: () => 'With a few sky shards, that forge could make your glider fly ever so much further. Just a thought!' },
	{ id: 'sky', when: (f) => !f.found('sky'), say: () => "Ever looked up past the summit? There are islands floating up there! The wind at the Windspout blows straight up. Open your glider in it and hold on." },
	{ id: 'spire', when: (f) => f.found('sky') && !f.found('spire'), say: () => "Been up to Cloudrest? There's a second wind up there, by the temple, that goes higher still. Something's waiting at the top of the spire." },
	{ id: 'skyfish', when: (f) => f.found('sky') && !f.hasCaught('cloudkoi'), say: () => "They say the lake on Cloudrest has fish in it that have never once seen the sea. Imagine!" },
	{ id: 'owl', when: (f) => f.found('sky') && !f.owlMet, say: () => "Funny thing: of an evening I've seen two big round eyes under Cloudrest, right down where the rock hangs. Not a bird I know. Something lives down there!" },
	{ id: 'house', when: (f) => !f.found('house'), say: () => "Have you been home yet? Your house is just past the garden. There's a wardrobe on the porch, if you fancy a change!" },
	{ id: 'islet', when: (f) => !f.found('islet'), say: () => "See that little islet out at sea? You can swim there, or glide from up high. There's a fish there you won't find anywhere else, and an old tortoise who asks the strangest questions." },
	{ id: 'stones', when: (f) => !f.found('stones'), say: () => "There's a ring of old standing stones up in the hills. Gives me the shivers after dark." },
	{ id: 'lighthouse', when: (f) => !f.found('lighthouse'), say: () => 'The lighthouse round the coast is lovely at night. Its beam sweeps right across the sea.' },
	{ id: 'strawberry', when: () => true, say: () => 'Strawberries keep fruiting after you pick them. Best deal on the island, if you ask me.' },
	{ id: 'map', when: () => true, say: () => "Lost? Press M for your map. It fills in as you go, so go everywhere!" },
	{ id: 'allfish', when: (f) => f.caughtKinds >= f.fishKinds, say: () => "Every kind of fish in the sea? You're the best angler this island's ever had!" },
	{ id: 'glide', when: () => true, say: () => 'From the top of the hill you can glide nearly anywhere. Jump, then jump again!' },
];

export function createNpc(ctx: NpcContext) {

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

	const speaker: Speaker = {
		name: NAME,
		color: '#9a6a43',
		onSay: () => play('Talk'),
		onTyped: () => play('Idle'),
		onClose: () => play('Idle'),
	};
	const talking = () => ctx.talk.speaker === speaker;
	const say = (text: string, next: Choice[]) => ctx.talk.say(text, next);
	const menu = (): Choice[] => [
		{ label: "Let's trade", run: () => (ctx.talk.close(), ctx.openShop()) },
		{ label: 'Any tips?', run: () => say(nextTip(ctx.facts()), menu()) },
		{ label: 'Bye!', run: () => ctx.talk.bye(ctx.facts().night ? 'Night night, Nixchan. Mind the dark!' : 'See you soon, Nixchan!') },
	];
	const open = () => {
		if (!ctx.talk.open(speaker)) return ctx.openShop();
		const f = ctx.facts();
		const hello = greeting(f);
		say(`${hello} ${nextTip(f)}`, menu());
	};

	// ---------- every frame ----------

	let near = false;
	let waveUntil = 0;
	let happyUntil = 0;
	let yaw = 0;
	const look = new THREE.Quaternion();
	const up = new THREE.Vector3(0, 1, 0);
	const above = new THREE.Vector3(root.position.x, root.position.y + 2.2, root.position.z);

	const update = (dt: number) => {
		const now = performance.now();
		const dx = ctx.pos.x - ctx.spot.x;
		const dz = ctx.pos.z - ctx.spot.z;
		const dist = Math.hypot(dx, dz);
		// A wave and a hello as Nixchan comes by.
		if (!near && dist < 7.5) {
			near = true;
			if (!ctx.talk.talking) {
				waveUntil = now + 2400;
				ctx.talk.bubble(ctx.facts().night ? 'Evening, Nixchan!' : met ? 'Hi, Nixchan!' : 'Hello there!', above);
			}
		} else if (near && dist > 11) {
			near = false;
		}
		// Walking off ends the chat.
		if (talking() && dist > 3.5) ctx.talk.close();
		if (!talking()) play(now < happyUntil ? 'Happy' : now < waveUntil ? 'Wave' : 'Idle');

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
	};

	return {
		name: NAME,
		open,
		update,
		/** A sale or a purchase: she's delighted. */
		cheer() {
			happyUntil = performance.now() + 1500;
			ctx.talk.bubble(['Pleasure doing business!', 'Thank you kindly!', 'Ooh, lovely!'][Math.floor(Math.random() * 3)], above, 1.8);
		},
		get talking() {
			return talking();
		},
		/** Where she stands. */
		spot: ctx.spot,
		/** The way for Nixchan to face her. */
		get facing() {
			return Math.atan2(ctx.spot.x - ctx.pos.x, ctx.spot.z - ctx.pos.z);
		},
	};
}
