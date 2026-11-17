// /skills: a little moonlit arena where Nixchan shows off her snow magic on a training dummy.
// There's no fight to win; it's a stage for effects. Each skill is a short piece of choreography:
// she plays one of the spell clips baked into her rig, and effects go off at the moments those
// clips mark (the times are copied from tools/nixchan-3d/build.py).
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildNixFigure, type NixClip } from '../experimental/nix-figure';
import * as fx from './fx';
import { Kind, easeOut } from './fx';

// The moments in each spell clip, as fractions of it (SHOT_FIRE, SLAM_HIT, SUMMON_OPEN, DASH_SLASH).
const SHOT_FIRE = 0.3;
const SLAM_HIT = 0.55;
const SUMMON_OPEN = 0.3;
const SUMMON_END = 0.8;
const DASH_SLASH = 0.4;

const HERO_X = -3;
const DUMMY_X = 3.4;

// Colours run past 1 where they should bloom.
const ICE = () => new THREE.Color(0.4, 0.8, 1.7);
const ICE_HOT = () => new THREE.Color(0.85, 1.25, 1.9);
const FROST = () => new THREE.Color(0.9, 1.0, 1.25);
const VIOLET = () => new THREE.Color(0.8, 0.55, 1.8);

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const smooth = (a: number, b: number, x: number) => {
	const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
	return t * t * (3 - 2 * t);
};

export type SkillId = 'shot' | 'slam' | 'summon' | 'dash';

function toonRamp() {
	const ramp = new THREE.DataTexture(new Uint8Array([120, 190, 255]), 3, 1, THREE.RedFormat);
	ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
	ramp.needsUpdate = true;
	return ramp;
}

function canvasTexture(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void) {
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	paint(canvas.getContext('2d')!);
	const t = new THREE.CanvasTexture(canvas);
	t.colorSpace = THREE.SRGBColorSpace;
	return t;
}

export async function startSkills() {
	const canvas = document.querySelector<HTMLCanvasElement>('[data-stage]');
	if (!canvas) return;
	const ui = {
		loading: document.querySelector<HTMLElement>('[data-loading]'),
		banner: document.querySelector<HTMLElement>('[data-banner]'),
		flash: document.querySelector<HTMLElement>('[data-flash]'),
		combo: document.querySelector<HTMLElement>('[data-combo]'),
		skills: [...document.querySelectorAll<HTMLButtonElement>('[data-skill]')],
		slow: document.querySelector<HTMLButtonElement>('[data-slow]'),
		auto: document.querySelector<HTMLButtonElement>('[data-auto]'),
	};

	let renderer: THREE.WebGLRenderer;
	try {
		renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
	} catch {
		document.documentElement.classList.add('no-3d');
		return;
	}
	const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
	renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	renderer.setClearColor('#0d0c26');

	const scene = new THREE.Scene();
	scene.fog = new THREE.Fog('#241c4a', 22, 70);
	const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 300);

	const composer = new EffectComposer(renderer);
	composer.addPass(new RenderPass(scene, camera));
	const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.5, 0.93);
	composer.addPass(bloom);
	composer.addPass(new OutputPass());

	const particles = fx.createParticles(scene);
	const effects = fx.createEffects(scene);
	const ramp = toonRamp();
	const toon = (color: string, extra: THREE.MeshToonMaterialParameters = {}) => new THREE.MeshToonMaterial({ color, gradientMap: ramp, ...extra });

	// ---------- light ----------
	scene.add(new THREE.HemisphereLight('#8f9ef0', '#241f4d', 1.05));
	const moon = new THREE.DirectionalLight('#d4dbff', 1.5);
	moon.position.set(-6, 14, 9);
	moon.castShadow = true;
	moon.shadow.mapSize.set(2048, 2048);
	Object.assign(moon.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 40 });
	moon.shadow.bias = -0.0005;
	moon.shadow.normalBias = 0.03;
	scene.add(moon);
	// Flashes of light from the spells themselves, lighting up Nixchan and the dummy.
	const flashLight = new THREE.PointLight('#9fd4ff', 0, 16, 1.6);
	scene.add(flashLight);
	let flashPower = 0;
	const lightFlash = (at: THREE.Vector3, power: number, color = '#9fd4ff') => {
		// Held off towards the camera, so it lights the faces turned to us and never sits on a surface.
		flashLight.position.copy(at).addScaledVector(camera.position.clone().sub(at).normalize(), 1.8);
		flashLight.color.set(color);
		flashPower = Math.max(flashPower, power * 0.35);
	};

	// ---------- the arena ----------
	// A night sky that fades from deep blue overhead to violet at the horizon, with stars.
	const sky = new THREE.Mesh(
		new THREE.SphereGeometry(150, 32, 16),
		new THREE.ShaderMaterial({
			side: THREE.BackSide,
			depthWrite: false,
			uniforms: {},
			vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
			fragmentShader: /* glsl */ `
				varying vec3 vDir;
				void main() {
					float h = clamp(vDir.y, -0.2, 1.0);
					vec3 low = vec3(0.16, 0.12, 0.32);
					vec3 mid = vec3(0.07, 0.07, 0.2);
					vec3 high = vec3(0.02, 0.02, 0.08);
					vec3 c = mix(low, mid, smoothstep(-0.05, 0.25, h));
					c = mix(c, high, smoothstep(0.25, 0.9, h));
					gl_FragColor = vec4(c, 1.0);
				}`,
		}),
	);
	scene.add(sky);
	{
		const n = 900;
		const pos = new Float32Array(n * 3);
		const v = new THREE.Vector3();
		for (let i = 0; i < n; i++) {
			do v.randomDirection();
			while (v.y < 0.08);
			v.multiplyScalar(140);
			pos.set([v.x, v.y, v.z], i * 3);
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
		scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: '#dfe6ff', size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 })));
	}

	// Aurora curtains far behind the arena, which flare up when the blizzard's called down.
	const auroraMat = new THREE.ShaderMaterial({
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		side: THREE.DoubleSide,
		fog: false,
		uniforms: { time: { value: 0 }, power: { value: 0.35 } },
		vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
		fragmentShader: /* glsl */ `
			uniform float time; uniform float power;
			varying vec2 vUv;
			void main() {
				float x = vUv.x * 9.0;
				float rays = 0.5 + 0.5 * sin(x * 3.1 + time * 0.7 + sin(x * 0.7 - time * 0.3) * 3.0);
				rays *= 0.6 + 0.4 * sin(x * 7.3 - time * 1.3);
				float foot = smoothstep(0.0, 0.18, vUv.y) * pow(1.0 - vUv.y, 1.4);
				vec3 c = mix(vec3(0.1, 1.0, 0.7), vec3(0.6, 0.35, 1.0), smoothstep(0.15, 0.9, vUv.y));
				float edge = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
				gl_FragColor = vec4(c, rays * foot * edge * power);
			}`,
	});
	for (const [x, z, w, rot] of [
		[-10, -48, 90, 0.08],
		[22, -40, 60, -0.35],
	]) {
		const geo = new THREE.PlaneGeometry(w, 28, 64, 1);
		// Folded like a curtain.
		const p = geo.attributes.position;
		for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 0.12) * 5);
		const curtain = new THREE.Mesh(geo, auroraMat);
		curtain.position.set(x, 20, z);
		curtain.rotation.y = rot;
		scene.add(curtain);
	}
	let auroraBoost = 0;

	// Snow underfoot, a round stone stage, and a faint rune circle carved into it.
	const snow = new THREE.Mesh(new THREE.CircleGeometry(80, 64), toon('#9aa5d6'));
	snow.rotation.x = -Math.PI / 2;
	snow.position.y = -0.42;
	snow.receiveShadow = true;
	scene.add(snow);
	const stage = new THREE.Mesh(new THREE.CylinderGeometry(7, 7.4, 0.42, 64), toon('#434a78'));
	stage.position.y = -0.21;
	stage.receiveShadow = true;
	scene.add(stage);
	const stageTop = new THREE.Mesh(new THREE.CircleGeometry(6.8, 64), toon('#565e90'));
	stageTop.rotation.x = -Math.PI / 2;
	stageTop.position.y = 0.002;
	stageTop.receiveShadow = true;
	scene.add(stageTop);
	const carved = fx.runeCircle(effects, new THREE.Vector3(0, 0.01, 0), { radius: 6.4, color: new THREE.Color(0.07, 0.12, 0.26), spin: 0.03, open: 2.5 });
	carved.mesh.renderOrder = 1;

	// Ice crystals round the edge of the stage, and pines in the snow beyond.
	for (let i = 0; i < 10; i++) {
		const a = (i / 10) * Math.PI * 2 + 0.3;
		// Keep the camera's side open.
		if (Math.sin(a) > 0.55) continue;
		fx.iceCluster(effects, particles, new THREE.Vector3(Math.cos(a) * 7.6, -0.2, Math.sin(a) * 7.6), { height: rand(1.4, 2.6), spikes: 5, rise: 0.6 + i * 0.08 });
	}
	{
		const trunk = toon('#3a2f52');
		const needles = toon('#253a5e');
		const cap = toon('#e3e9ff');
		for (let i = 0; i < 46; i++) {
			const a = rand(0, Math.PI * 2);
			const r = rand(13, 34);
			const x = Math.cos(a) * r;
			const z = Math.sin(a) * r;
			if (z > 8 && Math.abs(x) < 16) continue;
			const s = rand(0.9, 1.8);
			const tree = new THREE.Group();
			const t = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 1.2, 6), trunk);
			t.position.y = 0.2;
			tree.add(t);
			for (let k = 0; k < 3; k++) {
				const cone = new THREE.Mesh(new THREE.ConeGeometry(1.5 - k * 0.35, 1.8, 7), needles);
				cone.position.y = 1.4 + k * 0.9;
				tree.add(cone);
				const snowcap = new THREE.Mesh(new THREE.ConeGeometry(0.7 - k * 0.15, 0.6, 7), cap);
				snowcap.position.y = 2.05 + k * 0.9;
				tree.add(snowcap);
			}
			tree.position.set(x, -0.42, z);
			tree.scale.setScalar(s);
			tree.traverse((o) => (o.castShadow = true));
			scene.add(tree);
		}
	}

	// ---------- the training dummy ----------
	// A sack on a post with a painted target and a stitched face, which rocks, flashes and gets
	// knocked into the air. It's turned to face halfway between Nixchan and the camera.
	const dummy = new THREE.Group();
	dummy.position.set(DUMMY_X, 0, 0);
	scene.add(dummy);
	const sway = new THREE.Group();
	dummy.add(sway);
	const hopper = new THREE.Group();
	sway.add(hopper);
	const body = new THREE.Group();
	body.rotation.y = -Math.PI / 4;
	hopper.add(body);
	const sack = toon('#d9b98a');
	const wood = toon('#8a5a3b');
	const rope = toon('#a8743f');
	const dummyMats = [sack, wood, rope];
	{
		const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.2, 20), toon('#4a4f78'));
		base.position.y = 0.1;
		base.castShadow = base.receiveShadow = true;
		dummy.add(base);
		const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.4, 10), wood);
		post.position.y = 0.75;
		body.add(post);
		const trunk = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 0.45, 8, 20), sack);
		trunk.position.y = 1.6;
		body.add(trunk);
		for (const y of [1.3, 1.92]) {
			const band = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.045, 8, 28), rope);
			band.rotation.x = Math.PI / 2;
			band.position.y = y;
			body.add(band);
		}
		const arms = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.7, 8), wood);
		arms.rotation.x = Math.PI / 2;
		arms.rotation.y = Math.PI / 2;
		arms.position.y = 1.78;
		body.add(arms);
		const head = new THREE.Mesh(new THREE.SphereGeometry(0.4, 20, 14), sack);
		head.position.y = 2.45;
		body.add(head);
		const target = canvasTexture(128, 128, (ctx) => {
			for (const [r, c] of [
				[62, '#f25f6b'],
				[48, '#fff3e0'],
				[34, '#f25f6b'],
				[20, '#fff3e0'],
				[9, '#f25f6b'],
			] as const) {
				ctx.fillStyle = c;
				ctx.beginPath();
				ctx.arc(64, 64, r, 0, Math.PI * 2);
				ctx.fill();
			}
		});
		const disc = new THREE.Mesh(new THREE.CircleGeometry(0.3, 28), toon('#ffffff', { map: target }));
		disc.position.set(0, 1.55, 0.505);
		body.add(disc);
		dummyMats.push(disc.material as THREE.MeshToonMaterial);
		body.traverse((o) => (o.castShadow = true));
	}
	// Its face: dot eyes and a stitched smile, or squeezed shut when it's hit.
	const face = (hurt: boolean) =>
		canvasTexture(128, 128, (ctx) => {
			ctx.strokeStyle = ctx.fillStyle = '#3b2a22';
			ctx.lineWidth = 7;
			ctx.lineCap = 'round';
			for (const side of [-1, 1]) {
				ctx.beginPath();
				if (hurt) {
					ctx.moveTo(64 + side * 30 - 9, 46);
					ctx.lineTo(64 + side * 30 + side * 9, 54);
					ctx.lineTo(64 + side * 30 - 9, 62);
					ctx.stroke();
				} else {
					ctx.arc(64 + side * 28, 54, 7, 0, Math.PI * 2);
					ctx.fill();
				}
			}
			ctx.beginPath();
			if (hurt) ctx.ellipse(64, 88, 10, 12, 0, 0, Math.PI * 2);
			else ctx.arc(64, 76, 18, 0.2, Math.PI - 0.2);
			ctx.stroke();
		});
	const faces = { calm: face(false), hurt: face(true) };
	const faceMat = new THREE.MeshBasicMaterial({ map: faces.calm, transparent: true });
	const faceMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), faceMat);
	faceMesh.position.set(0, 2.47, 0.39);
	body.add(faceMesh);

	const dummyState = { tilt: 0, tiltV: 0, y: 0, vy: 0, flash: 0, hurt: 0, squash: 0 };
	/** Where the spells aim: the middle of the sack. */
	const dummyChest = () => new THREE.Vector3(DUMMY_X - 0.15, 1.6 + dummyState.y, 0);
	let combo = 0;
	let comboTimer = 0;
	const hitDummy = (base: number, o: { push?: number; launch?: number; crit?: number } = {}) => {
		const crit = Math.random() < (o.crit ?? 0.2);
		const value = Math.round(base * rand(0.9, 1.1) * (crit ? 1.8 : 1));
		fx.damageNumber(effects, dummyChest().add(new THREE.Vector3(rand(-0.4, 0.4), 1.1, rand(0, 0.6))), value, crit);
		dummyState.tiltV -= (o.push ?? 2.5) * 0.6;
		dummyState.flash = 1;
		dummyState.hurt = 0.45;
		dummyState.squash = 1;
		if (o.launch) dummyState.vy = Math.max(dummyState.vy, o.launch);
		combo++;
		comboTimer = 1.6;
		if (ui.combo) {
			ui.combo.hidden = combo < 2;
			ui.combo.querySelector('b')!.textContent = String(combo);
			ui.combo.classList.remove('pop');
			void ui.combo.offsetWidth;
			ui.combo.classList.add('pop');
		}
	};

	// ---------- Nixchan ----------
	const hero = new THREE.Group();
	hero.position.set(HERO_X, 0, 0);
	hero.rotation.y = Math.PI / 2;
	scene.add(hero);
	const nix = buildNixFigure(canvas.dataset.model!);
	hero.add(nix.group);
	nix.group.traverse((o) => (o.castShadow = true));
	const look = new THREE.Vector2(0, -0.1);
	const tmp = new THREE.Vector3();
	const handPos = (side: 'L' | 'R') => {
		const node = nix.node('Hand' + side);
		return node ? node.getWorldPosition(new THREE.Vector3()) : hero.position.clone().add(new THREE.Vector3(0.3, 1.1, 0));
	};
	/** Between her paws and a little in front, where a spell gathers. */
	const orbPos = () => handPos('L').add(handPos('R')).multiplyScalar(0.5).add(new THREE.Vector3(0.22, 0.06, 0));
	const feet = (lift = 0.02) => new THREE.Vector3(hero.position.x, lift, hero.position.z);

	// ---------- time ----------
	// Game time runs slower in slow motion and nearly stops for a moment on a big hit; the camera
	// shake and the screen flash run on real time, so they still read during a freeze.
	let time = 0;
	let slowMo = false;
	let freeze = 0;
	const timers: { at: number; fn: () => void }[] = [];
	const tasks: { start: number; length: number; fn: (t: number, dt: number) => void }[] = [];
	const after = (s: number, fn: () => void) => timers.push({ at: time + s, fn });
	const during = (s: number, fn: (t: number, dt: number) => void) => tasks.push({ start: time, length: s, fn });
	const hitStop = (s: number) => (freeze = Math.max(freeze, s));
	let trauma = 0;
	const shake = (amount: number) => {
		if (!reduceMotion) trauma = Math.min(1, trauma + amount);
	};
	let screenFlash = 0;
	const flashScreen = (amount: number) => {
		if (!reduceMotion) screenFlash = Math.max(screenFlash, amount);
	};

	// ---------- the skills ----------
	let busy = false;
	const setBusy = (on: boolean) => {
		busy = on;
		for (const b of ui.skills) b.classList.toggle('waiting', on);
	};
	const banner = (name: string, sub: string) => {
		if (!ui.banner) return;
		ui.banner.querySelector('[data-banner-name]')!.textContent = name;
		ui.banner.querySelector('[data-banner-sub]')!.textContent = sub;
		ui.banner.classList.remove('show');
		void ui.banner.offsetWidth;
		ui.banner.classList.add('show');
	};
	const play = (clip: NixClip) => nix.play(clip);

	/** A cloud of snow kicked up off the ground. */
	const snowPuff = (at: THREE.Vector3, n: number, power = 1) => {
		fx.burst(particles, at, n, { kind: Kind.Glow, size: [0.4 * power, 1.0 * power], color: new THREE.Color(0.2, 0.22, 0.34), alpha: 0.4, speed: [1, 4 * power], life: [0.5, 1.0], dir: new THREE.Vector3(0, 1, 0), spread: 1.3, drag: 3, gravity: -0.4 });
		fx.burst(particles, at, Math.round(n / 2), { kind: Kind.Flake, size: [0.18, 0.05], color: FROST(), speed: [2, 6 * power], life: [0.6, 1.2], dir: new THREE.Vector3(0, 1, 0), spread: 1.1, drag: 1.5, gravity: 5 });
	};

	/** The flash, burst and shudder of a spell striking the dummy. */
	const impact = (at: THREE.Vector3, power: number, color = ICE_HOT()) => {
		fx.burst(particles, at, Math.round(40 * power), { kind: Kind.Shard, size: [0.3 * power, 0.02], color, speed: [3, 9 * power], life: [0.35, 0.8], drag: 2, gravity: 6 });
		fx.burst(particles, at, Math.round(24 * power), { kind: Kind.Spark, size: [0.35, 0.02], color, speed: [2, 7 * power], life: [0.2, 0.5], drag: 3 });
		fx.burst(particles, at, 4, { kind: Kind.Glow, size: [0.9 * power, 0.1], color: ICE(), speed: [0, 0.5], life: [0.15, 0.3] });
		const toCam = camera.position.clone().sub(at).normalize();
		fx.shockwave(effects, at, { radius: 1.5 * power, life: 0.3, color: ICE(), width: 0.07, normal: toCam });
		lightFlash(at, 30 * power);
		shake(0.25 * power);
		flashScreen(0.1 * power);
	};

	const SKILLS: Record<SkillId, { name: string; sub: string; cast: () => void }> = {
		// 1. Frost Shot: gather a snowball of light between her paws and fire it.
		shot: {
			name: 'Frost Shot',
			sub: 'a bolt of packed starlight-snow',
			cast() {
				play('Charge');
				const ring = fx.runeCircle(effects, feet(), { radius: 1.3, color: ICE(), spin: 1.6, open: 0.3 });
				const orb = fx.glowBall(effects, ICE_HOT(), 0.05);
				const hold = 0.65;
				const follow = (grow: number) => {
					const p = orbPos();
					orb.sprite.position.copy(p);
					orb.sprite.scale.setScalar(0.06 + 0.5 * grow * (1 + 0.08 * Math.sin(time * 40)));
					return p;
				};
				during(hold, (t) => {
					const p = follow(easeOut(t));
					// Motes drawn in from all round.
					for (let i = 0; i < 3; i++) {
						const from = p.clone().add(fx.randomDir().multiplyScalar(rand(0.8, 1.4)));
						particles.emit({ pos: from, vel: p.clone().sub(from).multiplyScalar(3.4), life: 0.28, size: [0.05, 0.16], color: ICE_HOT(), kind: Kind.Spark, fadeIn: 0.4 });
					}
				});
				after(hold, () => {
					play('Shot');
					const d = nix.duration('Shot');
					during(d * SHOT_FIRE, () => follow(1));
					after(d * SHOT_FIRE, () => {
						const start = follow(1);
						orb.remove();
						ring.close(0.35);
						fx.shockwave(effects, start, { radius: 1.1, life: 0.3, color: ICE_HOT(), normal: new THREE.Vector3(1, 0, 0), width: 0.14 });
						lightFlash(start, 20);
						shake(0.12);
						const bolt = fx.glowBall(effects, ICE(), 0.55);
						const end = dummyChest();
						const travel = start.distanceTo(end) / 15;
						during(travel, (t) => {
							const p = start.clone().lerp(end, t);
							p.y += Math.sin(t * Math.PI) * 0.25;
							bolt.sprite.position.copy(p);
							bolt.sprite.scale.setScalar(0.55 + 0.06 * Math.sin(time * 50));
							for (let i = 0; i < 3; i++) {
								particles.emit({ pos: p.clone().add(fx.randomDir().multiplyScalar(0.12)), vel: fx.randomDir().multiplyScalar(0.6).add(new THREE.Vector3(-2, 0, 0)), life: 0.35, size: [0.5, 0], color: ICE(), kind: Kind.Glow, alpha: 0.7 });
							}
							particles.emit({ pos: p.clone(), vel: fx.randomDir().multiplyScalar(1.4), life: 0.6, size: [0.32, 0.08], color: FROST(), kind: Kind.Flake, spin: rand(-4, 4), gravity: 1 });
						});
						after(travel, () => {
							bolt.remove();
							impact(end, 1);
							hitStop(0.07);
							hitDummy(128, { push: 3 });
							// A frost flower blooms on the dummy's feet and breaks.
							fx.iceCluster(effects, particles, new THREE.Vector3(DUMMY_X, 0, 0), { height: 1.1, spikes: 7, tiltOut: 1.0, hold: 0.45 });
						});
					});
					after(d, () => {
						play('Ready');
						setBusy(false);
					});
				});
			},
		},

		// 2. Glacier Slam: paws down on the ground, and a line of ice spikes erupts to the dummy.
		slam: {
			name: 'Glacier Slam',
			sub: 'the ground answers in ice',
			cast() {
				play('Slam');
				const d = nix.duration('Slam');
				const glows = [fx.glowBall(effects, ICE(), 0.1), fx.glowBall(effects, ICE(), 0.1)];
				during(d * SLAM_HIT, (t) => {
					glows.forEach((g, i) => {
						const p = handPos(i ? 'R' : 'L');
						g.sprite.position.copy(p);
						g.sprite.scale.setScalar(0.12 + 0.4 * smooth(0.1, 0.6, t));
						if (Math.random() < 0.6) particles.emit({ pos: p, vel: fx.randomDir().multiplyScalar(0.8), life: 0.4, size: [0.16, 0], color: ICE_HOT(), kind: Kind.Spark });
					});
				});
				after(d * SLAM_HIT, () => {
					for (const g of glows) g.remove();
					const at = feet().add(new THREE.Vector3(0.7, 0, 0));
					fx.shockwave(effects, at.clone().setY(0.04), { radius: 4.5, life: 0.6, color: ICE_HOT(), width: 0.06 });
					after(0.08, () => fx.shockwave(effects, at.clone().setY(0.05), { radius: 2.6, life: 0.5, color: ICE(), width: 0.12 }));
					snowPuff(at, 30, 1.2);
					lightFlash(at.clone().setY(0.6), 22);
					shake(0.5);
					hitStop(0.05);
					flashScreen(0.15);
					const n = 8;
					const x0 = at.x + 0.5;
					for (let i = 0; i < n; i++) {
						after(0.05 + i * 0.055, () => {
							const last = i === n - 1;
							const x = THREE.MathUtils.lerp(x0, DUMMY_X, i / (n - 1));
							const p = new THREE.Vector3(x, 0, last ? 0 : (i % 2 ? 1 : -1) * rand(0.15, 0.4));
							fx.iceCluster(effects, particles, p, { height: last ? 3.2 : THREE.MathUtils.lerp(0.8, 2.2, i / (n - 1)), spikes: last ? 8 : 4, tiltOut: last ? 0.45 : 0.6, hold: 0.95 - i * 0.06 });
							snowPuff(p, 10, 0.7);
							fx.shockwave(effects, p.clone().setY(0.05), { radius: 1.3, life: 0.35, color: ICE(), width: 0.12 });
							shake(0.08);
							if (last) {
								impact(dummyChest(), 1.3);
								hitStop(0.09);
								hitDummy(342, { push: 1, launch: 7.5, crit: 0.4 });
							}
						});
					}
				});
				after(d, () => play('Ready'));
				after(Math.max(d, d * SLAM_HIT + 1.6), () => setBusy(false));
			},
		},

		// 3. Blizzard Crown: a rune circle opens over the dummy, and the storm pours out of it.
		summon: {
			name: 'Blizzard Crown',
			sub: 'call the winter down',
			cast() {
				play('Summon');
				const d = nix.duration('Summon');
				skywardGoal = 1;
				const under = fx.runeCircle(effects, feet(), { radius: 1.9, color: VIOLET(), spin: 1.2, open: 0.4 });
				after(d * SUMMON_OPEN, () => {
					const top = new THREE.Vector3(DUMMY_X, 4.6, 0);
					const outer = fx.runeCircle(effects, top, { radius: 3, color: VIOLET(), normal: new THREE.Vector3(0, -1, 0.4), spin: 0.7, open: 0.6 });
					const inner = fx.runeCircle(effects, top.clone().setY(4.5), { radius: 1.8, color: ICE(), normal: new THREE.Vector3(0, -1, 0.4), spin: -1.8, open: 0.5 });
					fx.pillar(effects, feet(0), { radius: 0.95, height: 7, life: d * (SUMMON_END - SUMMON_OPEN) + 0.3, color: VIOLET().multiplyScalar(0.3) });
					fx.shockwave(effects, top, { radius: 5, life: 0.7, color: VIOLET(), normal: new THREE.Vector3(0, -1, 0.4) });
					lightFlash(top, 40, '#b9a2ff');
					shake(0.2);
					const storm = d * (SUMMON_END - SUMMON_OPEN);
					let clock = 0;
					let n = 0;
					during(storm, (t, dt) => {
						auroraBoost = Math.max(auroraBoost, 1);
						// The circle's underside glows, and snow whirls round the dummy.
						for (let i = 0; i < 6; i++) {
							const a = rand(0, Math.PI * 2);
							const r = rand(0.8, 2.6);
							const p = new THREE.Vector3(DUMMY_X + Math.cos(a) * r, rand(0, 4), Math.sin(a) * r);
							const tangent = new THREE.Vector3(-Math.sin(a), 0.4, Math.cos(a)).multiplyScalar(5);
							particles.emit({ pos: p, vel: tangent, life: 0.7, size: [0.22, 0.06], color: FROST(), kind: Kind.Flake, spin: 6, drag: 0.5, fadeIn: 0.2 });
						}
						if (t > 0.15) {
							clock += dt;
							while (clock > 0.045) {
								clock -= 0.045;
								// An icicle shot straight down out of the circle.
								const land = new THREE.Vector3(DUMMY_X + rand(-1.8, 1.8), 0, rand(-1.8, 1.8));
								const from = land.clone().setY(4.4);
								const speed = 22;
								const fall = from.y / speed;
								particles.emit({ pos: from, vel: new THREE.Vector3(0, -speed, 0), life: fall, size: [0.9, 0.9], color: ICE_HOT(), kind: Kind.Shard, angle: 0, spin: 0 });
								particles.emit({ pos: from, vel: new THREE.Vector3(0, -speed, 0), life: fall, size: [0.6, 0.6], color: ICE(), kind: Kind.Glow, alpha: 0.6 });
								const m = n++;
								after(fall, () => {
									fx.burst(particles, land.clone().setY(0.1), 8, { kind: Kind.Shard, size: [0.22, 0.02], color: ICE_HOT(), speed: [2, 5], life: [0.25, 0.5], dir: new THREE.Vector3(0, 1, 0), spread: 1.2, gravity: 8 });
									if (m % 2 === 0) fx.shockwave(effects, land.clone().setY(0.05), { radius: 0.9, life: 0.25, color: ICE(), width: 0.14 });
									if (m % 4 === 0) {
										hitDummy(36, { push: 0.6, crit: 0.1 });
										shake(0.04);
									}
								});
							}
						}
					});
					after(storm, () => {
						// The finale: the dummy's frozen in a block of crystal, which bursts.
						fx.iceCluster(effects, particles, new THREE.Vector3(DUMMY_X, 0, 0), { height: 3.4, spikes: 13, tiltOut: 0.42, hold: 0.5, rise: 0.22 });
						lightFlash(dummyChest(), 30);
						shake(0.2);
						after(0.72, () => {
							impact(dummyChest(), 1.4, VIOLET());
							fx.shockwave(effects, new THREE.Vector3(DUMMY_X, 0.05, 0), { radius: 6, life: 0.8, color: VIOLET(), width: 0.05 });
							hitStop(0.12);
							shake(0.4);
							flashScreen(0.35);
							hitDummy(777, { push: 4, launch: 5, crit: 0.6 });
							outer.close(0.5);
							inner.close(0.4);
							under.close(0.4);
							skywardGoal = 0;
						});
						after(1.3, () => setBusy(false));
					});
				});
				after(d, () => play('Ready'));
			},
		},

		// 4. Snow Dash: she darts in, cuts an X through the dummy, and hops back.
		dash: {
			name: 'Snow Dash',
			sub: 'two cuts, one breath',
			cast() {
				play('Dash');
				const d = nix.duration('Dash');
				const startX = HERO_X;
				const endX = DUMMY_X - 1.25;
				after(d * 0.12, () => {
					fx.shockwave(effects, feet(0.9), { radius: 1.4, life: 0.3, color: ICE_HOT(), normal: new THREE.Vector3(1, 0, 0), width: 0.12 });
					snowPuff(feet(0.1), 14, 0.8);
					during(d * (DASH_SLASH - 0.12), (t) => {
						hero.position.x = THREE.MathUtils.lerp(startX, endX, easeOut(t));
						// Streaks of light left in the air behind her.
						for (let i = 0; i < 3; i++) {
							particles.emit({ pos: hero.position.clone().add(new THREE.Vector3(rand(-0.6, -0.1), rand(0.2, 2.3), rand(-0.35, 0.35))), vel: new THREE.Vector3(-rand(2, 5), 0, 0), life: 0.25, size: [0.3, 0], color: ICE(), kind: Kind.Glow, alpha: 0.3 });
						}
						particles.emit({ pos: hero.position.clone().add(new THREE.Vector3(0, rand(0.3, 2), rand(-0.3, 0.3))), vel: new THREE.Vector3(-3, rand(0, 1), 0), life: 0.5, size: [0.26, 0.06], color: FROST(), kind: Kind.Flake, spin: 8 });
					});
				});
				const cut = (tilt: number, flip: boolean) => {
					const at = dummyChest();
					const facing = camera.position.clone().sub(at).normalize();
					fx.slash(effects, at, { radius: 1.7, life: 0.32, color: ICE(), tilt, facing, flip });
					const along = new THREE.Vector3(Math.cos(tilt), Math.sin(tilt) * (flip ? -1 : 1), 0);
					fx.burst(particles, at, 26, { kind: Kind.Shard, size: [0.26, 0.02], color: ICE_HOT(), speed: [3, 9], life: [0.25, 0.55], dir: along, spread: 0.5, drag: 2 });
					fx.burst(particles, at, 12, { kind: Kind.Spark, size: [0.25, 0.02], color: ICE_HOT(), speed: [2, 6], life: [0.2, 0.4], drag: 3 });
					lightFlash(at, 20);
					shake(0.28);
					hitStop(0.08);
					flashScreen(0.12);
					hitDummy(96, { push: 2.2, crit: 0.3 });
				};
				after(d * DASH_SLASH, () => cut(0.55, false));
				after(d * DASH_SLASH + 0.13, () => cut(-0.55, true));
				after(d * 0.66, () => {
					// Back to her spot with a little hop.
					const from = hero.position.x;
					during(0.36, (t) => {
						hero.position.x = THREE.MathUtils.lerp(from, startX, easeOut(t));
						hero.position.y = Math.sin(t * Math.PI) * 0.7;
					});
					after(0.36, () => {
						hero.position.set(startX, 0, 0);
						snowPuff(feet(0.05), 8, 0.5);
					});
				});
				after(d, () => play('Ready'));
				after(Math.max(d, d * 0.66 + 0.4), () => setBusy(false));
			},
		},
	};
	const order: SkillId[] = ['shot', 'slam', 'summon', 'dash'];

	let loaded = false;
	const cast = (id: SkillId) => {
		if (busy || !loaded) return;
		setBusy(true);
		const skill = SKILLS[id];
		banner(skill.name, skill.sub);
		for (const b of ui.skills) b.classList.toggle('casting', b.dataset.skill === id);
		skill.cast();
	};

	// ---------- controls ----------
	let auto = false;
	let autoNext = 0;
	let autoWait = 0;
	const setSlow = (on: boolean) => {
		slowMo = on;
		ui.slow?.setAttribute('aria-pressed', String(on));
	};
	const setAuto = (on: boolean) => {
		auto = on;
		autoWait = 0.4;
		ui.auto?.setAttribute('aria-pressed', String(on));
	};
	for (const b of ui.skills) b.addEventListener('click', () => cast(b.dataset.skill as SkillId));
	ui.slow?.addEventListener('click', () => setSlow(!slowMo));
	ui.auto?.addEventListener('click', () => setAuto(!auto));
	addEventListener('keydown', (e) => {
		if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
		const n = Number(e.key);
		if (n >= 1 && n <= 4) cast(order[n - 1]);
		else if (e.key === 'q' || e.key === 'Q') setSlow(!slowMo);
		else if (e.key === 'r' || e.key === 'R') setAuto(!auto);
	});

	// Drag to swing the camera round, scroll to come closer.
	const view = { yaw: 0.3, pitch: 0.16, dist: 11 };
	let drag: { x: number; y: number; id: number } | null = null;
	canvas.addEventListener('pointerdown', (e) => {
		drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
		canvas.setPointerCapture(e.pointerId);
	});
	canvas.addEventListener('pointermove', (e) => {
		if (!drag || drag.id !== e.pointerId) return;
		view.yaw = THREE.MathUtils.clamp(view.yaw - (e.clientX - drag.x) * 0.006, -1.3, 1.3);
		view.pitch = THREE.MathUtils.clamp(view.pitch + (e.clientY - drag.y) * 0.004, 0.02, 0.75);
		drag.x = e.clientX;
		drag.y = e.clientY;
	});
	const endDrag = () => (drag = null);
	canvas.addEventListener('pointerup', endDrag);
	canvas.addEventListener('pointercancel', endDrag);
	canvas.addEventListener(
		'wheel',
		(e) => {
			e.preventDefault();
			view.dist = THREE.MathUtils.clamp(view.dist * Math.exp(e.deltaY * 0.001), 6, 18);
		},
		{ passive: false },
	);
	const target = new THREE.Vector3(0.2, 0.95, 0);
	// How far the camera's lifted to take in the sky, for the blizzard (0 → 1).
	let skyward = 0;
	let skywardGoal = 0;

	let fit = 1;
	const resize = () => {
		const w = canvas.clientWidth || innerWidth;
		const h = canvas.clientHeight || innerHeight;
		renderer.setSize(w, h, false);
		composer.setPixelRatio(renderer.getPixelRatio());
		composer.setSize(w, h);
		camera.aspect = w / h;
		// Narrow screens pull back to keep both of them in.
		camera.fov = w / h < 1 ? 50 : 38;
		camera.updateProjectionMatrix();
		// Back far enough that both of them fit across, however narrow the screen.
		const across = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect);
		fit = Math.max(1, 5.6 / Math.tan(across) / view.dist);
		particles.setScale((h * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)));
	};
	addEventListener('resize', resize);
	resize();

	// ---------- the loop ----------
	let last = performance.now();
	let blinkAt = 2;
	let blinkUntil = 0;
	let realTime = 0;
	const frame = (now: number) => {
		const real = Math.min((now - last) / 1000, 0.05);
		last = now;
		realTime += real;
		let scale = slowMo ? 0.3 : 1;
		if (freeze > 0) {
			freeze -= real;
			scale *= 0.04;
		}
		const dt = real * scale;
		time += dt;

		for (let i = timers.length - 1; i >= 0; i--) {
			if (timers[i].at <= time) {
				const { fn } = timers[i];
				timers.splice(i, 1);
				fn();
			}
		}
		for (let i = tasks.length - 1; i >= 0; i--) {
			const task = tasks[i];
			const t = Math.min((time - task.start) / task.length, 1);
			task.fn(t, dt);
			if (t >= 1) tasks.splice(i, 1);
		}

		if (auto && loaded && !busy) {
			autoWait -= dt;
			if (autoWait <= 0) {
				cast(order[autoNext]);
				autoNext = (autoNext + 1) % order.length;
				autoWait = 0.7;
			}
		}

		// Nixchan, blinking now and then.
		if (time > blinkAt) {
			nix.setBlink(true);
			blinkUntil = time + 0.12;
			blinkAt = time + rand(2, 5);
		}
		if (blinkUntil && time > blinkUntil) {
			nix.setBlink(false);
			blinkUntil = 0;
		}
		nix.tick(dt, time, { airborne: hero.position.y > 0.05, look, still: false, jump: null });

		// The dummy rocks on a spring, hops when it's knocked up, and flashes white when hit.
		const s = dummyState;
		s.tiltV += (-38 * s.tilt - 3.2 * s.tiltV) * dt;
		s.tilt += s.tiltV * dt;
		s.tilt = THREE.MathUtils.clamp(s.tilt, -0.6, 0.6);
		sway.rotation.z = s.tilt;
		if (s.y > 0 || s.vy > 0) {
			s.vy -= 22 * dt;
			s.y += s.vy * dt;
			if (s.y <= 0) {
				s.y = 0;
				s.vy = 0;
				s.squash = 0.8;
				snowPuff(new THREE.Vector3(DUMMY_X, 0.1, 0), 10, 0.6);
				shake(0.1);
			}
		}
		hopper.position.y = s.y;
		s.squash = Math.max(0, s.squash - dt * 5);
		const sq = Math.sin(s.squash * Math.PI) * 0.12;
		body.scale.set(1 + sq, 1 - sq, 1 + sq);
		// Kept under the bloom's threshold, or the whole dummy turns into a ball of light.
		s.flash = Math.max(0, s.flash - dt * 8);
		for (const m of dummyMats) m.emissive.setRGB(s.flash * 0.14, s.flash * 0.22, s.flash * 0.36);
		s.hurt -= dt;
		faceMat.map = s.hurt > 0 ? faces.hurt : faces.calm;

		comboTimer -= real;
		if (comboTimer <= 0 && combo) {
			combo = 0;
			if (ui.combo) ui.combo.hidden = true;
		}

		// Snow drifting down over the arena all the while.
		for (let i = 0; i < 2; i++) {
			particles.emit({ pos: new THREE.Vector3(rand(-12, 12), 9, rand(-8, 6)), vel: new THREE.Vector3(rand(-0.3, 0.1), -rand(0.6, 1.1), 0), life: 10, size: [0.1, 0.08], color: new THREE.Color(0.75, 0.8, 1), kind: Kind.Flake, spin: rand(-1, 1), alpha: 0.7, fadeIn: 0.05 });
		}

		particles.update(dt);
		effects.update(dt);
		auroraBoost = Math.max(0, auroraBoost - dt * 0.6);
		auroraMat.uniforms.time.value = time;
		auroraMat.uniforms.power.value = 0.35 + 0.9 * auroraBoost;

		flashLight.intensity = flashPower;
		flashPower *= Math.exp(-real * 9);

		// The camera, with a shake that's strongest right after a big hit and dies away quickly.
		trauma = Math.max(0, trauma - real * 1.6);
		const shakeAmt = trauma * trauma;
		skyward = THREE.MathUtils.lerp(skyward, skywardGoal, 1 - Math.exp(-real * 2.5));
		target.set(0.2 + 0.9 * skyward, 0.95 + 1.3 * skyward, 0);
		camera.position.set(Math.sin(view.yaw) * Math.cos(view.pitch), Math.sin(view.pitch), Math.cos(view.yaw) * Math.cos(view.pitch)).multiplyScalar(view.dist * fit + 2.5 * skyward).add(target);
		camera.lookAt(target);
		if (shakeAmt > 0) {
			const r = realTime * 37;
			camera.position.add(tmp.set(Math.sin(r * 1.3) + Math.sin(r * 2.9), Math.sin(r * 1.7 + 1) + Math.sin(r * 3.1), 0).multiplyScalar(shakeAmt * 0.12).applyQuaternion(camera.quaternion));
			camera.rotateZ(Math.sin(r * 2.1) * shakeAmt * 0.025);
		}

		screenFlash = Math.max(0, screenFlash - real * 2.5);
		if (ui.flash) ui.flash.style.opacity = String(screenFlash);

		composer.render();
		requestAnimationFrame(frame);
	};
	requestAnimationFrame(frame);

	nix.ready
		.then(() => {
			loaded = true;
			play('Ready');
			if (ui.loading) ui.loading.hidden = true;
			for (const b of ui.skills) b.disabled = false;
		})
		.catch(() => {
			if (ui.loading) ui.loading.textContent = "Nixchan couldn't be loaded. Try reloading the page.";
		});
}
