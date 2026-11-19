// A portal: a glowing ring on a plinth, its name floating over it, that takes Nixchan off to another
// page when she walks into it. Walking up to one shows its name and what's through it; stepping onto
// its plinth goes through. One that leads nowhere yet (no `href`) stays dim, and says so.
//
//   addPortal(game, { at: [0, 0, 10], facing: Math.PI, title: 'Cloud Hop', note: 'An obstacle course in the sky', href: '/cloudhop/' });
import * as THREE from 'three';
import type { Game } from './game';

export interface PortalSpec {
	/** Where the foot of its plinth is: it stands on whatever's there. */
	at: [number, number, number];
	/** Which way its face looks (0 is towards +z), the way she walks in from. */
	facing: number;
	title: string;
	note?: string;
	/** Where it goes; without it, it's not open yet. */
	href?: string;
	/** Its two colours, swirling. */
	colors?: [string, string];
}

export interface Portal {
	spec: PortalSpec;
	/** Where she stands to come back out of it, a few steps in front, facing away from it. */
	exit: { pos: THREE.Vector3; heading: number };
}

const SWIRL_VERTEX = `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SWIRL_FRAGMENT = `
uniform float uTime;
uniform float uLit;
uniform vec3 uA;
uniform vec3 uB;
varying vec2 vUv;
void main() {
	vec2 p = vUv * 2.0 - 1.0;
	float r = length(p);
	if (r > 1.0) discard;
	float a = atan(p.y, p.x);
	float s = sin(a * 3.0 + r * 9.0 - uTime * 2.6) * 0.5 + 0.5;
	vec3 c = mix(uA, uB, s);
	c = mix(c, vec3(1.0), smoothstep(0.35, 0.0, r) * 0.55 * uLit);
	c = mix(vec3(dot(c, vec3(0.33))), c, 0.25 + 0.75 * uLit);
	gl_FragColor = vec4(c, mix(0.35, 0.92, uLit) * (1.0 - smoothstep(0.82, 1.0, r) * 0.6));
}`;

/** A name (and a note under it) on a card, as a sprite that always faces the camera. */
function label(title: string, note: string | undefined, dim: boolean) {
	const canvas = document.createElement('canvas');
	canvas.width = 512;
	canvas.height = 160;
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	const paint = () => {
		const ctx = canvas.getContext('2d')!;
		const css = getComputedStyle(document.documentElement);
		const display = css.getPropertyValue('--display').trim() || 'sans-serif';
		const sans = css.getPropertyValue('--sans').trim() || 'sans-serif';
		ctx.clearRect(0, 0, 512, 160);
		ctx.fillStyle = dim ? 'rgba(253, 251, 255, 0.7)' : 'rgba(253, 251, 255, 0.94)';
		ctx.beginPath();
		ctx.roundRect(16, 12, 480, note ? 136 : 96, 28);
		ctx.fill();
		ctx.fillStyle = dim ? '#77739e' : '#1c1a3e';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.font = `56px ${display}`;
		ctx.fillText(title, 256, 62, 440);
		if (note) {
			ctx.fillStyle = '#5b5788';
			ctx.font = `800 26px ${sans}`;
			ctx.fillText(note, 256, 116, 440);
		}
		texture.needsUpdate = true;
	};
	paint();
	// The site's fonts may not be in yet; draw it again once they are.
	document.fonts?.ready.then(paint);
	const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
	sprite.scale.set(4.4, 4.4 * (160 / 512), 1);
	return sprite;
}

/** Puts a portal in the game. Its plinth is a part she stands on; walking onto it goes through. */
export function addPortal(game: Game, spec: PortalSpec): Portal {
	const [x, y, z] = spec.at;
	const open = !!spec.href;
	const [ca, cb] = spec.colors ?? ['#8f7bff', '#5fd3ff'];
	const R = 1.55;
	const PLINTH = 0.4;

	game.parts.add({ at: [x, y + PLINTH / 2, z], size: [3.6, PLINTH, 3.6], shape: 'cylinder', color: '#e9e6fb' });
	const rig = new THREE.Group();
	rig.position.set(x, y + PLINTH, z);
	rig.rotation.y = spec.facing;
	game.scene.add(rig);

	const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.17, 12, 48), game.toon({ color: open ? ca : '#b9b6d6', emissive: new THREE.Color(open ? ca : '#000000').multiplyScalar(0.35) }));
	ring.position.y = R + 0.35;
	ring.castShadow = true;
	rig.add(ring);
	for (const side of [-1, 1]) {
		const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.5, 10), game.toon({ color: '#cfcaf0' }));
		foot.position.set(side * 0.95, 0.25, 0);
		rig.add(foot);
	}
	const uniforms = {
		uTime: { value: 0 },
		uLit: { value: open ? 1 : 0 },
		uA: { value: new THREE.Color(ca) },
		uB: { value: new THREE.Color(cb) },
	};
	const disc = new THREE.Mesh(
		new THREE.CircleGeometry(R - 0.08, 48),
		new THREE.ShaderMaterial({ uniforms, vertexShader: SWIRL_VERTEX, fragmentShader: SWIRL_FRAGMENT, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
	);
	disc.position.y = ring.position.y;
	rig.add(disc);
	const card = label(spec.title, spec.note, !open);
	card.position.y = ring.position.y + R + 1.1;
	rig.add(card);
	// A light of its own, so it glows on the plinth and on her as she walks up.
	if (open) {
		const glow = new THREE.PointLight(ca, 6, 7, 1.6);
		glow.position.set(0, ring.position.y, 0.6);
		rig.add(glow);
	}

	const forward = new THREE.Vector3(Math.sin(spec.facing), 0, Math.cos(spec.facing));
	const exit = { pos: new THREE.Vector3(x, y, z).addScaledVector(forward, 4), heading: spec.facing };

	let near = false;
	let gone = false;
	let refused = 0;
	const { player, hud } = game;
	game.onUpdate((dt, time) => {
		uniforms.uTime.value = time;
		ring.rotation.z = Math.sin(time * 0.8) * 0.04;
		const d = Math.hypot(player.pos.x - x, player.pos.z - z);
		// Walking up, its name comes up on the screen.
		if (d < 6 && !near) hud.banner(spec.title, spec.note ?? '', 2.5);
		near = d < 6.5 && (near || d < 6);
		refused = Math.max(0, refused - dt);
		if (gone || d > 1.1 || player.pos.y > y + PLINTH + 0.3) return;
		if (!open) {
			if (refused === 0) hud.toast('Nothing through here yet. Soon!');
			refused = 3;
			return;
		}
		gone = true;
		game.paused = true;
		hud.flash();
		document.documentElement.classList.add('nk-leaving');
		setTimeout(() => location.assign(spec.href!), 450);
	});
	// Back from the page it went to (the browser's back button, keeping this page as it was), she
	// steps back out of it.
	addEventListener('pageshow', (e) => {
		if (!e.persisted || !gone) return;
		gone = false;
		document.documentElement.classList.remove('nk-leaving');
		game.teleport(exit.pos, exit.heading, exit.heading);
		game.paused = false;
	});
	return { spec, exit };
}
