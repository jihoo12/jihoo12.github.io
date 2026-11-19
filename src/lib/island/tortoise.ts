// Parmen, an old tortoise in spectacles who sits on the Lonely Islet and asks Nixchan whether she's
// really here. Talk with him long enough and she works out that someone on the other side of the
// screen has had their hand on the keys all along; he tells her a wall is only what we agree not to
// walk through, and she turns round and knocks on the glass (fourthwall.ts), back out to the 3D home
// on /experimental. It's the island's only door out, so after the first time he'll let her straight
// through. The model and his clips (Idle, Talk, Nod) are made in Blender (tools/island-tortoise).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Offer } from '../nixkit/interact';
import type { Toon } from './look';
import { loadText, saveText } from './save';
import { ISLET } from './terrain';
import type { Choice, Speaker, Talk } from './talk';
import { clamp, damp } from '../nixkit/util';

type Clip = 'Idle' | 'Talk' | 'Nod';

const NAME = 'Parmen';

export interface TortoiseContext {
	scene: THREE.Scene;
	toon: Toon;
	modelUrl: string;
	groundAt: (x: number, z: number) => number;
	addFeature: (f: { x: number; z: number; r: number }) => void;
	pos: THREE.Vector3;
	talk: Talk;
	night: () => boolean;
	canAct: () => boolean;
	/** She knocks on the screen, and goes through it. */
	breakWall: () => void;
}

/** Things he says when asked for one, a different one each time. */
const MUSINGS = [
	'They say the islet is empty when nobody swims out. I have never once found it so.',
	'A hole in the sand is made of nothing, and yet you can trip in it. Make of that what you will.',
	"The fish that isn't on your line weighs exactly as much as the one that is. Until you look.",
	'I asked the sea what lies beyond it. It said: more of me. I was not satisfied.',
	'Not being is very restful. I tried it once, for a whole afternoon. Then someone said my name.',
	"What is, is. What is not, is not. Everything else is just weather.",
	'When you leave the island, does it go on without you? Ask the one holding the keys. They close the tab.',
];

export function createTortoise(ctx: TortoiseContext) {
	// On the islet's seaward side of the chest, facing back across the water to the island.
	const x = ISLET.x + 2.2;
	const z = ISLET.z - 2.4;
	const angle = Math.atan2(-x, -z);
	const root = new THREE.Group();
	root.position.set(x, ctx.groundAt(x, z) - 0.04, z);
	root.rotation.y = angle;
	root.scale.setScalar(1.8);
	ctx.scene.add(root);
	ctx.addFeature({ x, z, r: 1.3 });

	let mixer: THREE.AnimationMixer | null = null;
	let head: THREE.Object3D | null = null;
	const actions = new Map<Clip, THREE.AnimationAction>();
	const weights = new Map<Clip, number>();
	let clip: Clip = 'Idle';

	// Toon materials in his own colours, each mesh with an ink line round it, as Pebble has.
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
				mesh.add(new THREE.Mesh(mesh.geometry, ink));
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
			// No Parmen, then. (The way back is still the brand link, or the browser's back button.)
		},
	);
	const play = (next: Clip) => {
		if (next === clip) return;
		clip = next;
		const action = actions.get(next);
		if (action && (weights.get(next) ?? 0) < 0.05) action.time = 0;
	};

	// ---------- talking ----------

	// '' before they've talked, 'met' once they have, 'through' once she's been through the glass.
	type Saved = '' | 'met' | 'through';
	let state = (loadText('tortoise') ?? '') as Saved;
	const save = (s: Saved) => {
		state = s;
		saveText('tortoise', s);
	};
	/** The clip for the line he's saying now. */
	let lineClip: Clip = 'Talk';
	const speaker: Speaker = {
		name: NAME,
		color: '#6f7a4e',
		onSay: () => play(lineClip),
		onTyped: () => lineClip === 'Talk' && play('Idle'),
		onClose: () => play('Idle'),
	};
	const talking = () => ctx.talk.speaker === speaker;
	const say = (text: string, next: Choice[], how: Clip = 'Talk') => {
		lineClip = how;
		ctx.talk.say(text, next);
	};
	const bye = (): Choice => ({ label: 'Bye!', run: () => ctx.talk.bye(ctx.night() ? 'Mind the dark. It is only the light, not being.' : 'Go well. Or stay. It comes to the same.') });
	let musing = Math.floor(Math.random() * MUSINGS.length);
	const muse = (): Choice => ({ label: 'Tell me something', run: () => say(MUSINGS[musing++ % MUSINGS.length], [muse(), bye()]) });
	const knock = (): Choice => ({
		label: '*knock knock*',
		run: () => {
			save('through');
			ctx.talk.close();
			ctx.breakWall();
		},
	});

	const touch = matchMedia('(pointer: coarse)').matches;
	const keys = touch ? 'the screen under your thumbs' : 'W, A, S and D';

	// The first conversation, a step at a time.
	const glass = () =>
		say("Just so. What is, is; and what is not can't even be thought of. Yet here you are, thinking of them. So they are, too. On the other side of the glass.", [
			{ label: 'Can I go and see them?', run: wall },
			bye(),
		], 'Nod');
	const wall = () =>
		say("A wall is only something we've agreed not to walk through. Turn round, Nixchan. Knock, if you like. Someone's sure to answer.", [knock(), { label: 'Not yet', run: () => ctx.talk.bye('The glass will keep. It always has.') }]);
	const hand = () =>
		say(`Then look more closely. Every step you took to get here, someone pressed ${keys} for you. Whose hand has been on the keys all this time?`, [
			{ label: "...Someone's watching.", run: glass },
			{ label: "That's silly.", run: () => say('Is it? Wave at them, then, and see if they wave back.', [{ label: '...Oh.', run: glass }, bye()]) },
		]);
	const whence = () =>
		say("You came across the water. Before, you were not here; now you are. But nothing comes from what is not. So where did you come from?", [
			{ label: 'From the beach! I swam.', run: () => say('The beach. And before the beach, a gate full of sky. And before the gate, a long path. And before the path?', [{ label: 'I... don\'t know.', run: hand }]) },
			{ label: "I don't know.", run: hand },
		]);

	const open = () => {
		if (!ctx.talk.open(speaker)) return;
		if (state === '') {
			save('met');
			say('Ah. A visitor. Tell me, small one, before anything else: are you here?', [
				{ label: "Of course I'm here!", run: () => say('Are you? Hm.', [{ label: 'I am!', run: whence }]) },
				{ label: '...Am I?', run: () => say('A good answer. Most people only ever give the other one.', [{ label: 'So am I?', run: whence }], 'Nod') },
			]);
		} else if (state === 'met') {
			say('You again. Still here? Or here again? Which is it?', [{ label: 'Who holds the keys?', run: hand }, muse(), bye()]);
		} else {
			say(ctx.night() ? 'Back on this side of the glass, at this hour? It remembers your knuckles.' : 'Back on this side of the glass? It remembers your knuckles.', [
				{ label: 'Let me back out', run: () => say("Knock, then. You know the way.", [knock(), bye()], 'Nod') },
				muse(),
				bye(),
			]);
		}
	};

	// ---------- every frame ----------

	let near = false;
	let yaw = 0;
	const look = new THREE.Quaternion();
	const up = new THREE.Vector3(0, 1, 0);
	const above = new THREE.Vector3(x, root.position.y + 2.1, z);
	const update = (dt: number) => {
		const dx = ctx.pos.x - x;
		const dz = ctx.pos.z - z;
		const dist = Math.hypot(dx, dz);
		if (!near && dist < 8) {
			near = true;
			if (!ctx.talk.talking) ctx.talk.bubble(state === '' ? 'Hm. Is someone there?' : state === 'through' ? 'Ah, the knocker.' : 'Hm.', above);
		} else if (near && dist > 12) near = false;
		if (talking() && dist > 4) ctx.talk.close();
		if (!talking()) play('Idle');

		if (mixer) {
			for (const [name, action] of actions) {
				const w = damp(weights.get(name) ?? 0, name === clip ? 1 : 0, 6, dt);
				weights.set(name, w);
				action.setEffectiveWeight(w);
			}
			mixer.update(dt);
			// His head turns, slowly, to follow her, as far as a tortoise's neck goes.
			const local = Math.atan2(dx, dz) - angle;
			const want = dist < 12 ? clamp(Math.atan2(Math.sin(local), Math.cos(local)), -1.1, 1.1) : 0;
			yaw = damp(yaw, want, 2.5, dt);
			head?.quaternion.multiply(look.setFromAxisAngle(up, yaw));
		}
	};

	return {
		name: NAME,
		update,
		/** E by him. */
		offer: (): Offer | null => {
			if (talking() || Math.hypot(ctx.pos.x - x, ctx.pos.z - z) > 3 || !ctx.canAct()) return null;
			return { label: state === '' ? 'Talk to the tortoise' : `Talk to ${NAME}`, go: open };
		},
		get talking() {
			return talking();
		},
		spot: { x, z },
		/** The way for Nixchan to face him. */
		get facing() {
			return Math.atan2(x - ctx.pos.x, z - ctx.pos.z);
		},
	};
}
