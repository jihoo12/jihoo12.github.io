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
import { clamp, damp } from '../nixkit/util';
import { josa, lang, pick, type Lang } from './lang';

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

const NAME = pick({ en: 'Pebble', ko: '페블' });

/** A crop's name (as farm.ts gives it) in the island's language. */
const CROP_KO: Record<string, string> = { Turnip: '순무', Carrot: '당근', Strawberry: '딸기', Pumpkin: '호박', Starbloom: '별꽃', 'Ashen Lily': '잿빛 백합', Gearbloom: '톱니꽃' };
const crop = (name: string) => (lang === 'ko' ? (CROP_KO[name] ?? name) : name.toLowerCase());

type Line = (f: Facts) => string;
/** Tips, most pressing first; she gives the first that fits and that she hasn't said lately. */
const TIPS: { id: string; when: (f: Facts) => boolean; say: Record<Lang, Line> }[] = [
	{ id: 'ripe', when: (f) => !!f.garden.ripe, say: {
		en: (f) => `Your ${crop(f.garden.ripe!)} looks ripe to me! Pick it before it gets ideas.`,
		ko: (f) => `${josa(crop(f.garden.ripe!), '이', '가')} 다 익은 것 같아요! 엉뚱한 생각 하기 전에 얼른 따요.` } },
	{ id: 'thirsty', when: (f) => !!f.garden.thirsty, say: {
		en: (f) => `That ${crop(f.garden.thirsty!)} of yours looks thirsty. The barrel's just over there.`,
		ko: (f) => `닉스쨩네 ${josa(crop(f.garden.thirsty!), '이', '가')} 목말라 보여요. 물통은 바로 저기 있어요.` } },
	{ id: 'sell', when: (f) => f.sellable.value >= 40, say: {
		en: (f) => `I'd give you ${f.sellable.value} coins for what's in your bag. Just saying!`,
		ko: (f) => `가방에 든 거, 저라면 ${f.sellable.value}코인 쳐 드릴 텐데. 그냥 그렇다고요!` } },
	{ id: 'plant', when: (f) => f.seeds > 0 && f.garden.planted < 12, say: {
		en: () => "Those seeds won't plant themselves! Stand on a plot and press E.",
		ko: () => '씨앗이 알아서 심어지진 않아요! 밭 위에 서서 E를 눌러요.' } },
	{ id: 'fish', when: (f) => f.caughtKinds === 0, say: {
		en: () => 'Ever been fishing? Face the sea where the water gets deep, cast with F, and wait for the bobber to dunk.',
		ko: () => '낚시해 본 적 있어요? 물이 깊어지는 쪽 바다를 보고 F로 던진 다음, 찌가 쏙 잠길 때까지 기다려요.' } },
	{ id: 'pumpkin', when: (f) => f.garden.coins >= 80, say: {
		en: () => "You've got enough for pumpkin seeds now. Slow growers, but nobody pays more for a crop.",
		ko: () => '이제 호박 씨앗을 살 만큼 모였네요. 느리게 자라지만, 이만큼 값을 쳐주는 작물이 없어요.' } },
	{ id: 'moonfish', when: (f) => f.night && !f.hasCaught('moonfish'), say: {
		en: () => 'On a night like this the Moonfish come up from the deep. Biggest fish there is!',
		ko: () => '이런 밤엔 깊은 데서 달고기가 올라와요. 세상에서 제일 큰 물고기예요!' } },
	{ id: 'snapper', when: (f) => !f.night && !f.hasCaught('snapper'), say: {
		en: () => 'Sunny Snappers love deep water while the sun is up. Try the end of the pier.',
		ko: () => '햇살도미는 해가 떠 있을 때 깊은 물을 좋아해요. 부두 끝에서 해 봐요.' } },
	{ id: 'forge', when: (f) => !f.found('forge'), say: {
		en: () => "There's an old forge past the garden that nobody's used in years. Iron ore crops out of the rocks up in the hills, if you fancy having a go!",
		ko: () => '정원 너머에 몇 년째 아무도 안 쓴 낡은 대장간이 있어요. 언덕 위 바위에 철광석이 드러나 있으니까, 한번 해 볼 생각 있으면 가 봐요!' } },
	{ id: 'sprinkler', when: (f) => f.found('forge') && f.garden.planted > 0 && f.sprinklers === 0, say: {
		en: () => "Tired of all that watering? The forge can make sprinklers, two iron ingots apiece. Set one where four plots meet and it waters the lot!",
		ko: () => '물 주기 지겹죠? 대장간에서 스프링클러를 만들 수 있어요. 하나에 철 주괴 두 개요. 밭 네 칸이 만나는 곳에 두면 한꺼번에 다 물을 줘요!' } },
	{ id: 'sprocket', when: (f) => f.sprinklers >= 2 && !f.forged('helper'), say: {
		en: () => "I've heard a clever smith can build a little clockwork helper that picks the crops for you. It'd want sky shards, mind.",
		ko: () => '솜씨 좋은 대장장이는 작물을 대신 따 주는 작은 태엽 도우미도 만든대요. 하늘 조각이 들긴 하지만요.' } },
	{ id: 'skyglider', when: (f) => f.found('forge') && f.found('sky') && !f.forged('glider'), say: {
		en: () => 'With a few sky shards, that forge could make your glider fly ever so much further. Just a thought!',
		ko: () => '하늘 조각이 몇 개 있으면, 그 대장간에서 글라이더가 훨씬 멀리 날게 해 줄 거예요. 그냥 생각이에요!' } },
	{ id: 'sky', when: (f) => !f.found('sky'), say: {
		en: () => "Ever looked up past the summit? There are islands floating up there! The wind at the Windspout blows straight up. Open your glider in it and hold on.",
		ko: () => '산꼭대기 너머를 올려다본 적 있어요? 저 위에 섬들이 떠 있어요! 바람기둥에선 바람이 곧장 위로 불어요. 그 안에서 글라이더를 펴고 꽉 잡아요.' } },
	{ id: 'spire', when: (f) => f.found('sky') && !f.found('spire'), say: {
		en: () => "Been up to Cloudrest? There's a second wind up there, by the temple, that goes higher still. Something's waiting at the top of the spire.",
		ko: () => '구름쉼터엔 가 봤어요? 거기 신전 옆에 더 높이 올라가는 바람이 또 있어요. 첨탑 꼭대기에서 뭔가가 기다리고 있대요.' } },
	{ id: 'skyfish', when: (f) => f.found('sky') && !f.hasCaught('cloudkoi'), say: {
		en: () => "They say the lake on Cloudrest has fish in it that have never once seen the sea. Imagine!",
		ko: () => '구름쉼터 호수엔 바다를 한 번도 못 본 물고기가 산대요. 상상이 가요?' } },
	{ id: 'owl', when: (f) => f.found('sky') && !f.owlMet, say: {
		en: () => "Funny thing: of an evening I've seen two big round eyes under Cloudrest, right down where the rock hangs. Not a bird I know. Something lives down there!",
		ko: () => '이상한 일이 있어요. 저녁이 되면 구름쉼터 밑, 바위가 매달린 저 아래에서 크고 동그란 눈 두 개가 보여요. 제가 아는 새는 아니에요. 저 밑에 뭔가 살아요!' } },
	{ id: 'house', when: (f) => !f.found('house'), say: {
		en: () => "Have you been home yet? Your house is just past the garden. There's a wardrobe on the porch, if you fancy a change!",
		ko: () => '집에는 가 봤어요? 닉스쨩 집은 정원 바로 너머예요. 현관에 옷장이 있으니까, 옷 갈아입고 싶으면 가 봐요!' } },
	{ id: 'islet', when: (f) => !f.found('islet'), say: {
		en: () => "See that little islet out at sea? You can swim there, or glide from up high. There's a fish there you won't find anywhere else, and an old tortoise who asks the strangest questions.",
		ko: () => '바다에 저 조그만 섬 보여요? 헤엄쳐 가도 되고, 높은 데서 글라이더로 날아가도 돼요. 거기서만 잡히는 물고기가 있고, 이상한 질문만 하는 늙은 거북이도 있어요.' } },
	{ id: 'stones', when: (f) => !f.found('stones'), say: {
		en: () => "There's a ring of old standing stones up in the hills. Gives me the shivers after dark.",
		ko: () => '언덕 위에 오래된 선돌이 빙 둘러서 있어요. 해 지고 나면 괜히 오싹해요.' } },
	{ id: 'lighthouse', when: (f) => !f.found('lighthouse'), say: {
		en: () => 'The lighthouse round the coast is lovely at night. Its beam sweeps right across the sea.',
		ko: () => '해안을 돌아가면 있는 등대는 밤에 정말 예뻐요. 불빛이 바다를 가로질러 쭉 훑고 지나가요.' } },
	{ id: 'strawberry', when: () => true, say: {
		en: () => 'Strawberries keep fruiting after you pick them. Best deal on the island, if you ask me.',
		ko: () => '딸기는 따고 나서도 계속 열려요. 제가 보기엔 이 섬에서 제일 남는 장사예요.' } },
	{ id: 'map', when: () => true, say: {
		en: () => "Lost? Press M for your map. It fills in as you go, so go everywhere!",
		ko: () => '길 잃었어요? M을 누르면 지도가 나와요. 다닐수록 채워지니까, 어디든 가 봐요!' } },
	{ id: 'allfish', when: (f) => f.caughtKinds >= f.fishKinds, say: {
		en: () => "Every kind of fish in the sea? You're the best angler this island's ever had!",
		ko: () => '바다에 사는 물고기를 종류별로 전부요? 이 섬 역사상 최고의 낚시꾼이에요!' } },
	{ id: 'glide', when: () => true, say: {
		en: () => 'From the top of the hill you can glide nearly anywhere. Jump, then jump again!',
		ko: () => '언덕 꼭대기에선 거의 어디로든 날아갈 수 있어요. 점프하고, 한 번 더 점프!' } },
];

/** Everything else she says. */
const WORDS = pick({
	en: {
		first: `Oh, hello! You must be Nixchan. I'm ${NAME}, and this is my stand: seeds to sell, and a fair price for anything you catch or grow.`,
		night: 'Up late, Nixchan? The best fish come out after dark, you know.',
		rich: "Well, if it isn't the richest gardener on the island! What'll it be?",
		hello: ['Hello again, Nixchan! Lovely day for it.', 'Nixchan! What can I do for you?', "Back again? I was hoping you'd come by."],
		trade: "Let's trade",
		tips: 'Any tips?',
		bye: 'Bye!',
		byeNight: 'Night night, Nixchan. Mind the dark!',
		byeDay: 'See you soon, Nixchan!',
		waveNight: 'Evening, Nixchan!',
		waveMet: 'Hi, Nixchan!',
		waveNew: 'Hello there!',
		cheer: ['Pleasure doing business!', 'Thank you kindly!', 'Ooh, lovely!'],
	},
	ko: {
		first: `어머, 안녕하세요! 닉스쨩이죠? 저는 ${josa(NAME, '이에요', '예요')}. 여긴 제 가게고요. 씨앗도 팔고, 잡거나 키운 건 뭐든 제값에 사 드려요.`,
		night: '늦게까지 안 자요, 닉스쨩? 좋은 물고기는 어두워져야 나온다니까요.',
		rich: '어머, 섬에서 제일 부자인 농부님 아니세요! 뭘 드릴까요?',
		hello: ['또 왔네요, 닉스쨩! 날씨 참 좋죠.', '닉스쨩! 뭘 도와줄까요?', '또 왔어요? 들러 주길 기다리고 있었어요.'],
		trade: '거래하자',
		tips: '팁 있어?',
		bye: '안녕!',
		byeNight: '잘 자요, 닉스쨩. 어두우니까 조심하고요!',
		byeDay: '또 봐요, 닉스쨩!',
		waveNight: '좋은 저녁이에요, 닉스쨩!',
		waveMet: '안녕하세요, 닉스쨩!',
		waveNew: '어머, 안녕하세요!',
		cheer: ['거래 고마워요!', '정말 고마워요!', '우와, 좋아라!'],
	},
});

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
		return tip.say[lang](f);
	};
	const greeting = (f: Facts) => {
		if (!met) {
			met = true;
			saveText('pebbleMet', '1');
			return WORDS.first;
		}
		if (f.night) return WORDS.night;
		if (f.garden.coins >= 300) return WORDS.rich;
		return WORDS.hello[Math.floor(Math.random() * WORDS.hello.length)];
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
		{ label: WORDS.trade, run: () => (ctx.talk.close(), ctx.openShop()) },
		{ label: WORDS.tips, run: () => say(nextTip(ctx.facts()), menu()) },
		{ label: WORDS.bye, run: () => ctx.talk.bye(ctx.facts().night ? WORDS.byeNight : WORDS.byeDay) },
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
				ctx.talk.bubble(ctx.facts().night ? WORDS.waveNight : met ? WORDS.waveMet : WORDS.waveNew, above);
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
			ctx.talk.bubble(WORDS.cheer[Math.floor(Math.random() * WORDS.cheer.length)], above, 1.8);
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
