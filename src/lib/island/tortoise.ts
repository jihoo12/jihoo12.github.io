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
import { josa, pick } from './lang';

type Clip = 'Idle' | 'Talk' | 'Nod';

const NAME = pick({ en: 'Parmen', ko: '파르멘' });

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

const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** What he says, and what she says back. He talks like an old philosopher (in Korean, 하게체); she doesn't. */
const W = pick({
	en: {
		/** Things he says when asked for one, a different one each time. */
		musings: [
			'They say the islet is empty when nobody swims out. I have never once found it so.',
			'A hole in the sand is made of nothing, and yet you can trip in it. Make of that what you will.',
			"The fish that isn't on your line weighs exactly as much as the one that is. Until you look.",
			'I asked the sea what lies beyond it. It said: more of me. I was not satisfied.',
			'Not being is very restful. I tried it once, for a whole afternoon. Then someone said my name.',
			"What is, is. What is not, is not. Everything else is just weather.",
			'When you leave the island, does it go on without you? Ask the one holding the keys. They close the tab.',
		],
		bye: 'Bye!',
		byeNight: 'Mind the dark. It is only the light, not being.',
		byeDay: 'Go well. Or stay. It comes to the same.',
		muse: 'Tell me something',
		knock: '*knock knock*',
		glass: "Just so. What is, is; and what is not can't even be thought of. Yet here you are, thinking of them. So they are, too. On the other side of the glass.",
		canISee: 'Can I go and see them?',
		wall: "A wall is only something we've agreed not to walk through. Turn round, Nixchan. Knock, if you like. Someone's sure to answer.",
		notYet: 'Not yet',
		glassKeeps: 'The glass will keep. It always has.',
		hand: `Then look more closely. Every step you took to get here, someone pressed ${touch ? 'the screen under your thumbs' : 'W, A, S and D'} for you. Whose hand has been on the keys all this time?`,
		watching: "...Someone's watching.",
		silly: "That's silly.",
		isIt: 'Is it? Wave at them, then, and see if they wave back.',
		oh: '...Oh.',
		whence: "You came across the water. Before, you were not here; now you are. But nothing comes from what is not. So where did you come from?",
		beach: 'From the beach! I swam.',
		beforeBeach: 'The beach. And before the beach, a gate full of sky. And before the gate, a long path. And before the path?',
		dunno: "I... don't know.",
		dontKnow: "I don't know.",
		hello: 'Ah. A visitor. Tell me, small one, before anything else: are you here?',
		ofCourse: "Of course I'm here!",
		areYou: 'Are you? Hm.',
		iAm: 'I am!',
		amI: '...Am I?',
		goodAnswer: 'A good answer. Most people only ever give the other one.',
		soAmI: 'So am I?',
		again: 'You again. Still here? Or here again? Which is it?',
		whoKeys: 'Who holds the keys?',
		backNight: 'Back on this side of the glass, at this hour? It remembers your knuckles.',
		backDay: 'Back on this side of the glass? It remembers your knuckles.',
		letMeOut: 'Let me back out',
		knockThen: 'Knock, then. You know the way.',
		bubbleNew: 'Hm. Is someone there?',
		bubbleThrough: 'Ah, the knocker.',
		bubbleMet: 'Hm.',
		talkNew: 'Talk to the tortoise',
		talkTo: `Talk to ${NAME}`,
	},
	ko: {
		musings: [
			'아무도 헤엄쳐 오지 않으면 이 섬은 텅 빈다고들 하지. 나는 한 번도 그런 걸 본 적이 없네.',
			'모래에 난 구멍은 아무것도 아닌 것으로 되어 있는데, 거기 걸려 넘어질 수는 있단 말이지. 그걸 어찌 받아들일지는 자네 몫일세.',
			'낚싯줄에 걸리지 않은 물고기도, 걸린 물고기와 무게가 똑같다네. 들여다보기 전까지는.',
			'바다에게 너머엔 무엇이 있느냐고 물었지. 바다가 그러더군. 나라고. 나는 영 성에 차지 않았네.',
			'없다는 건 아주 편안하다네. 한번은 오후 내내 없어 봤지. 그러다 누가 내 이름을 불렀어.',
			'있는 것은 있고, 없는 것은 없네. 나머지는 다 날씨일 뿐이지.',
			'자네가 섬을 떠나면, 섬은 자네 없이도 계속 있을까? 자판에 손을 얹은 이에게 물어보게. 탭을 닫는 건 그쪽이니.',
		],
		bye: '안녕!',
		byeNight: '어둠 조심하게. 그건 그저 빛이 없는 것이지, 없음은 아니라네.',
		byeDay: '잘 가게. 아니면 있든가. 결국 같은 얘기일세.',
		muse: '무슨 얘기 해 줘',
		knock: '*똑똑*',
		glass: '바로 그거네. 있는 것은 있고, 없는 것은 생각조차 할 수 없지. 그런데 자네는 지금 그들을 생각하고 있군. 그러니 그들도 있는 걸세. 유리 저편에.',
		canISee: '만나러 가도 돼?',
		wall: '벽이란, 지나가지 않기로 우리끼리 약속한 것일 뿐이라네. 돌아서 보게, 닉스쨩. 두드려 봐도 좋고. 누군가 꼭 대답할 걸세.',
		notYet: '아직은 아니야',
		glassKeeps: '유리는 어디 안 가네. 늘 그랬듯이.',
		hand: `그럼 좀 더 자세히 보게. 자네가 여기까지 오는 걸음마다, 누군가 자네 대신 ${touch ? '엄지 밑의 화면을' : 'W, A, S, D를'} 눌렀지. 그동안 내내 자판 위에 있던 건 누구 손일까?`,
		watching: '...누가 보고 있어.',
		silly: '말도 안 돼.',
		isIt: '그런가? 그럼 손을 흔들어 보게. 그쪽도 흔들어 주는지.',
		oh: '...앗.',
		whence: '자네는 물을 건너왔지. 전에는 여기 없었고, 지금은 있네. 하지만 없는 것에서는 아무것도 나오지 않아. 그렇다면 자네는 어디서 왔는가?',
		beach: '해변에서! 헤엄쳐 왔어.',
		beforeBeach: '해변이라. 해변 전에는 하늘이 가득한 문. 문 전에는 긴 길. 그럼 길 전에는?',
		dunno: '나... 모르겠어.',
		dontKnow: '모르겠어.',
		hello: '아, 손님이로군. 작은 친구, 다른 건 다 제쳐 두고 하나만 묻지. 자네는 여기 있는가?',
		ofCourse: '당연히 여기 있지!',
		areYou: '그런가? 흠.',
		iAm: '있다니까!',
		amI: '...내가 있나?',
		goodAnswer: '좋은 대답일세. 대부분은 늘 다른 쪽 대답만 하지.',
		soAmI: '그래서, 나 있어?',
		again: '또 자네로군. 아직 여기 있는 건가? 아니면 다시 여기 온 건가? 어느 쪽이지?',
		whoKeys: '자판은 누가 쥐고 있어?',
		backNight: '이 시간에 유리 이쪽으로 돌아왔나? 유리가 자네 주먹을 기억하더군.',
		backDay: '유리 이쪽으로 돌아왔나? 유리가 자네 주먹을 기억하더군.',
		letMeOut: '다시 나가게 해 줘',
		knockThen: '그럼 두드리게. 길은 알지 않나.',
		bubbleNew: '흠. 거기 누가 있나?',
		bubbleThrough: '아, 두드리던 친구로군.',
		bubbleMet: '흠.',
		talkNew: '거북이와 이야기하기',
		talkTo: `${josa(NAME, '과', '와')} 이야기하기`,
	},
});
const MUSINGS = W.musings;

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
	const bye = (): Choice => ({ label: W.bye, run: () => ctx.talk.bye(ctx.night() ? W.byeNight : W.byeDay) });
	let musing = Math.floor(Math.random() * MUSINGS.length);
	const muse = (): Choice => ({ label: W.muse, run: () => say(MUSINGS[musing++ % MUSINGS.length], [muse(), bye()]) });
	const knock = (): Choice => ({
		label: W.knock,
		run: () => {
			save('through');
			ctx.talk.close();
			ctx.breakWall();
		},
	});

	// The first conversation, a step at a time.
	const glass = () =>
		say(W.glass, [
			{ label: W.canISee, run: wall },
			bye(),
		], 'Nod');
	const wall = () =>
		say(W.wall, [knock(), { label: W.notYet, run: () => ctx.talk.bye(W.glassKeeps) }]);
	const hand = () =>
		say(W.hand, [
			{ label: W.watching, run: glass },
			{ label: W.silly, run: () => say(W.isIt, [{ label: W.oh, run: glass }, bye()]) },
		]);
	const whence = () =>
		say(W.whence, [
			{ label: W.beach, run: () => say(W.beforeBeach, [{ label: W.dunno, run: hand }]) },
			{ label: W.dontKnow, run: hand },
		]);

	const open = () => {
		if (!ctx.talk.open(speaker)) return;
		if (state === '') {
			save('met');
			say(W.hello, [
				{ label: W.ofCourse, run: () => say(W.areYou, [{ label: W.iAm, run: whence }]) },
				{ label: W.amI, run: () => say(W.goodAnswer, [{ label: W.soAmI, run: whence }], 'Nod') },
			]);
		} else if (state === 'met') {
			say(W.again, [{ label: W.whoKeys, run: hand }, muse(), bye()]);
		} else {
			say(ctx.night() ? W.backNight : W.backDay, [
				{ label: W.letMeOut, run: () => say(W.knockThen, [knock(), bye()], 'Nod') },
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
			if (!ctx.talk.talking) ctx.talk.bubble(state === '' ? W.bubbleNew : state === 'through' ? W.bubbleThrough : W.bubbleMet, above);
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
			return { label: state === '' ? W.talkNew : W.talkTo, go: open };
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
