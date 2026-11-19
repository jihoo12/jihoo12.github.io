// Nixchan's house: a little cottage a short walk from her garden, with a covered porch out front
// where her wardrobe and a tall standing mirror are. Standing at the mirror, E opens the wardrobe:
// a panel beside her, to change the colour of her hoodie, her hat, and its colour, while the camera
// looks over her shoulder at her in the mirror (a real one: three's Reflector, only switched on
// while she's near). What she wears is saved (experimental/outfit.ts) and goes with her everywhere.
//
// The house itself is made in Blender (tools/island-house); the sizes it's built to are here too, to
// walk round its walls and onto its porch. E at the front door takes her inside: that's a page of its
// own (/home, lib/home/room.ts), which brings her back out here (?from=home) when she leaves.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import type { NixFigure } from '../experimental/nix-figure';
import { LOGOS, LOGO_COLOURS, drawLogo } from '../experimental/logos';
import { COLOURS, HATS, loadOutfit, saveOutfit, wear, type Outfit } from '../experimental/outfit';
import type { Feature } from './features';
import type { Offer } from '../nixkit/interact';
import type { Place } from './layout';
import type { Toon } from './look';
import { loadText, saveText } from './save';
import { slopeUp, terrainAt } from './terrain';
import { TAU, damp, rng } from '../nixkit/util';

// The sizes in tools/island-house/build.py.
const FLOOR_TOP = 0.3;
const W = 6.4;
const BACK = -3.0;
const FRONT = 0.4;
const PORCH = 2.9;
const WARDROBE = { x: -1.95, z: 0.72 };
/** The mirror's glass: its middle, size, height over the porch, and how far it's turned on its stand
 * (towards the middle of the porch). */
const MIRROR = { x: 1.95, z: 0.78, w: 1.0, h: 2.3, y: 1.6, yaw: -0.45 };
/** A point in the mirror's own frame (x across it, z out of it), in the house's. */
const offMirror = (x: number, z: number) => ({
	x: MIRROR.x + x * Math.cos(MIRROR.yaw) + z * Math.sin(MIRROR.yaw),
	z: MIRROR.z - x * Math.sin(MIRROR.yaw) + z * Math.cos(MIRROR.yaw),
});
/** Where she stands to see herself: in front of the mirror and to one side of it; and where the
 * camera wants to be, as far to the other side (so it sees her in the mirror, past her, and not her
 * back in the way of it), which turning the mirror puts out past the porch's open front. */
const STAND = offMirror(-0.55, 1.25);
const LOOK_FROM = offMirror(0.55 * 5.5, 1.25 * 5.5);

export interface HouseContext {
	scene: THREE.Scene;
	toon: Toon;
	figure: NixFigure;
	modelUrl: string;
	/** The garden, which the house is put near, facing it. */
	near: { x: number; z: number };
	places: Place[];
	clearOfPlaces: (x: number, z: number, gap: number) => boolean;
	roomy: (x: number, z: number, gap: number) => boolean;
	addFeature: (f: Feature) => void;
	pos: THREE.Vector3;
	canAct: () => boolean;
	toast: (text: string) => void;
}

export function createHouse(ctx: HouseContext) {
	const { scene } = ctx;

	// ---------- where it goes ----------

	// Flat, open ground a short walk from the garden (and not too near the forge), the same every
	// visit, its porch towards the garden.
	const site = (() => {
		const rand = rng(57);
		const forge = ctx.places.find((p) => p.id === 'forge');
		const flat = (x: number, z: number) => {
			const g = terrainAt(x, z);
			for (let k = 0; k < 12; k++) {
				const a = (k * TAU) / 12;
				for (const r of [2.5, 4.5]) if (Math.abs(terrainAt(x + Math.cos(a) * r, z + Math.sin(a) * r) - g) > 0.6) return false;
			}
			return true;
		};
		for (let tries = 0; tries < 6000; tries++) {
			const a = rand() * TAU;
			const r = 16 + rand() * 26;
			const x = ctx.near.x + Math.cos(a) * r;
			const z = ctx.near.z + Math.sin(a) * r;
			const g = terrainAt(x, z);
			if (g < 1.6 || g > 9 || slopeUp(x, z) < 0.93 || !flat(x, z) || !ctx.roomy(x, z, 6) || !ctx.clearOfPlaces(x, z, 6)) continue;
			if (forge && Math.hypot(forge.x - x, forge.z - z) < 18) continue;
			return { x, z, yaw: Math.atan2(ctx.near.x - x, ctx.near.z - z) };
		}
		return { x: ctx.near.x - 20, z: ctx.near.z, yaw: Math.PI / 2 };
	})();
	/** A point in the house's own frame, out in the world. */
	const world = (lx: number, lz: number) => ({
		x: site.x + Math.cos(site.yaw) * lx + Math.sin(site.yaw) * lz,
		z: site.z - Math.sin(site.yaw) * lx + Math.cos(site.yaw) * lz,
	});
	const base = (() => {
		let high = -Infinity;
		for (const [lx, lz] of [
			[-W / 2, BACK],
			[W / 2, BACK],
			[-W / 2, PORCH],
			[W / 2, PORCH],
			[0, 0],
		]) {
			const p = world(lx, lz);
			high = Math.max(high, terrainAt(p.x, p.z));
		}
		return high - 0.05;
	})();
	const floorY = base + FLOOR_TOP;
	const middle = world(0, (BACK + PORCH) / 2);
	ctx.places.push({ id: 'house', name: "Nixchan's House", x: middle.x, z: middle.z, r: 7, clear: 0 });

	// What she walks round and on: the house itself (shut), the porch's floor, its posts and rails,
	// the steps up, the wardrobe and the mirror.
	for (let lx = -W / 2 + 0.9; lx <= W / 2 - 0.89; lx += 1.15)
		for (let lz = BACK + 0.9; lz <= FRONT - 0.89; lz += 0.85) ctx.addFeature({ ...world(lx, lz), r: 0.95 });
	for (let lx = -W / 2 + 0.9; lx <= W / 2 - 0.89; lx += 1.15) ctx.addFeature({ ...world(lx, FRONT - 0.5), r: 0.6 });
	for (let lx = -W / 2 + 1.0; lx <= W / 2 - 0.99; lx += 1.1)
		for (let lz = FRONT + 0.7; lz <= PORCH - 0.3; lz += 0.9) ctx.addFeature({ ...world(lx, lz), r: 1.0, pad: floorY });
	for (const side of [-1, 1]) {
		for (let lz = FRONT + 0.3; lz <= PORCH - 0.2; lz += 0.5) ctx.addFeature({ ...world(side * (W / 2 - 0.2), lz), r: 0.22 });
	}
	ctx.addFeature({ ...world(0, PORCH + 0.3), r: 0.9, pad: base + FLOOR_TOP * 0.66 });
	ctx.addFeature({ ...world(0, PORCH + 0.75), r: 0.9, pad: base + FLOOR_TOP * 0.33 });
	for (const dx of [-0.35, 0.35]) ctx.addFeature({ ...world(WARDROBE.x + dx, WARDROBE.z), r: 0.42 });
	for (const dx of [-0.55, 0, 0.55]) {
		const at = offMirror(dx, 0);
		ctx.addFeature({ ...world(at.x, at.z), r: 0.22 });
	}
	// The pots of flowers in the porch's front corners.
	for (const side of [-1, 1]) ctx.addFeature({ ...world(side * (W / 2 - 0.65), PORCH - 0.35), r: 0.3 });

	// ---------- the model ----------

	const toonCache = new Map<string, THREE.MeshToonMaterial>();
	const glowMat = new THREE.MeshBasicMaterial({ color: '#ffd27a' });
	const roofMats: THREE.MeshToonMaterial[] = [];
	const group = new THREE.Group();
	group.position.set(site.x, base, site.z);
	group.rotation.y = site.yaw;
	scene.add(group);
	new GLTFLoader().loadAsync(ctx.modelUrl).then(
		(gltf) => {
			const model = gltf.scene;
			model.traverse((o) => {
				if (!(o instanceof THREE.Mesh)) return;
				const placeholder = o.material as THREE.MeshStandardMaterial;
				if (placeholder.name === 'Glow') {
					o.material = glowMat;
					return;
				}
				// The roof's tiles get materials of their own, so they can fade when she's under them.
				const roof = placeholder.name.startsWith('Roof');
				const color = `#${placeholder.color.getHexString()}`;
				let mat = roof ? undefined : toonCache.get(color);
				if (!mat) {
					mat = ctx.toon({ color });
					if (roof) roofMats.push(mat);
					else toonCache.set(color, mat);
				}
				o.material = mat;
				o.castShadow = o.receiveShadow = true;
			});
			group.add(model);
		},
		() => {
			// No house, then (the mirror's still there, at least).
		},
	);

	// The mirror's glass: an oval, a hair in front of the frame's backing.
	const glass = new Reflector(new THREE.CircleGeometry(0.5, 48), {
		textureWidth: 512,
		textureHeight: 1024,
		color: 0xc9d2e4,
		clipBias: 0.003,
	});
	glass.scale.set(MIRROR.w, MIRROR.h, 1);
	glass.position.set(MIRROR.x + Math.sin(MIRROR.yaw) * 0.01, FLOOR_TOP + MIRROR.y, MIRROR.z + Math.cos(MIRROR.yaw) * 0.01);
	glass.rotation.y = MIRROR.yaw;
	glass.visible = false;
	group.add(glass);

	// ---------- the wardrobe ----------

	const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel);
	const ui = {
		panel: $('[data-wardrobe]'),
		hoodie: $('[data-wardrobe-hoodie]'),
		logos: $('[data-wardrobe-logos]'),
		logoColour: $('[data-wardrobe-logo-colour]'),
		logoColourRow: $('[data-wardrobe-logo-colour-row]'),
		hats: $('[data-wardrobe-hats]'),
		hatColour: $('[data-wardrobe-hat-colour]'),
		hatColourRow: $('[data-wardrobe-hat-colour-row]'),
		done: $<HTMLButtonElement>('[data-wardrobe-done]'),
	};
	let outfit: Outfit = loadOutfit();
	let dressing = false;

	const swatch = (c: { name: string; main?: string; hex?: string }, chosen: boolean, pick: () => void) => {
		const b = document.createElement('button');
		b.type = 'button';
		b.className = 'swatch';
		b.style.setProperty('--swatch', c.main ?? c.hex ?? '');
		b.setAttribute('aria-label', c.name);
		b.setAttribute('aria-pressed', String(chosen));
		b.title = c.name;
		b.addEventListener('click', pick);
		return b;
	};
	/** A button showing a logo, drawn as it'd be on her hoodie. */
	const logoButton = (l: (typeof LOGOS)[number]) => {
		const b = document.createElement('button');
		b.type = 'button';
		b.className = 'logo';
		b.title = l.name;
		b.setAttribute('aria-label', l.name);
		b.setAttribute('aria-pressed', String(l.id === outfit.logo));
		const hoodie = COLOURS.find((c) => c.id === outfit.hoodie) ?? COLOURS[0];
		b.style.setProperty('--swatch', hoodie.main);
		if (l.id === 'none') b.textContent = '—';
		else {
			const c = document.createElement('canvas');
			c.width = c.height = 256;
			drawLogo(c.getContext('2d')!, l.id, (LOGO_COLOURS.find((x) => x.id === outfit.logoColour) ?? LOGO_COLOURS[0]).hex);
			b.append(c);
		}
		b.addEventListener('click', () => change({ logo: l.id }));
		return b;
	};
	const render = () => {
		ui.hoodie?.replaceChildren(...COLOURS.map((c) => swatch(c, c.id === outfit.hoodie, () => change({ hoodie: c.id }))));
		ui.logos?.replaceChildren(...LOGOS.map(logoButton));
		ui.logoColour?.replaceChildren(...LOGO_COLOURS.map((c) => swatch(c, c.id === outfit.logoColour, () => change({ logoColour: c.id }))));
		if (ui.logoColourRow) ui.logoColourRow.hidden = outfit.logo === 'none';
		ui.hats?.replaceChildren(
			...HATS.map((h) => {
				const b = document.createElement('button');
				b.type = 'button';
				b.className = 'hat';
				b.textContent = h.name;
				b.setAttribute('aria-pressed', String(h.id === outfit.hat));
				b.addEventListener('click', () => change({ hat: h.id }));
				return b;
			}),
		);
		ui.hatColour?.replaceChildren(...COLOURS.map((c) => swatch(c, c.id === outfit.hatColour, () => change({ hatColour: c.id }))));
		// The straw hat's always straw.
		if (ui.hatColourRow) ui.hatColourRow.hidden = !HATS.find((h) => h.id === outfit.hat)?.tinted;
	};
	const change = (next: Partial<Outfit>) => {
		outfit = { ...outfit, ...next };
		wear(ctx.figure, outfit);
		saveOutfit(outfit);
		render();
	};
	const open = () => {
		if (!ui.panel) return;
		dressing = true;
		ui.panel.hidden = false;
		render();
		ui.done?.focus();
	};
	const close = () => {
		if (!dressing) return;
		dressing = false;
		if (ui.panel) ui.panel.hidden = true;
		ui.done?.blur();
	};
	ui.done?.addEventListener('click', close);

	const stand = world(STAND.x, STAND.z);
	/** Where she stands to go in at the door, and to come back out of it, facing out. */
	const doorStep = world(0, FRONT + 0.9);
	const outward = site.yaw;
	let entering = false;
	const enter = () => {
		if (entering) return;
		entering = true;
		const fade = document.createElement('div');
		fade.style.cssText = 'position:fixed;inset:0;z-index:60;background:#2a1f2e;opacity:0;transition:opacity .5s;pointer-events:none';
		document.body.append(fade);
		requestAnimationFrame(() => (fade.style.opacity = '1'));
		setTimeout(() => location.assign('/home/'), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 550);
	};
	// Back here with the browser's back button, the page comes back faded out: clear it.
	addEventListener('pageshow', (e) => {
		if (!e.persisted || !entering) return;
		entering = false;
		document.querySelectorAll<HTMLElement>('body > div[style*="z-index:60"]').forEach((d) => d.remove());
	});
	const mirror = world(MIRROR.x, MIRROR.z);
	const lookFrom = world(LOOK_FROM.x, LOOK_FROM.z);
	/** The way she faces at the mirror: straight into it (so in it, the camera sees her face). */
	const into = offMirror(0, -1);
	const intoWorld = world(into.x, into.z);
	const facing = Math.atan2(intoWorld.x - mirror.x, intoWorld.z - mirror.z);

	// ---------- every frame ----------

	let fade = 1;
	let welcomed = loadText('house') === '1';
	const update = (dt: number) => {
		const dx = ctx.pos.x - site.x;
		const dz = ctx.pos.z - site.z;
		const lx = dx * Math.cos(site.yaw) - dz * Math.sin(site.yaw);
		const lz = dx * Math.sin(site.yaw) + dz * Math.cos(site.yaw);
		// The first time she's on her porch, a word about the wardrobe.
		if (!welcomed && Math.abs(lx) < W / 2 && lz > FRONT && lz < PORCH + 1 && Math.abs(ctx.pos.y - floorY) < 0.6) {
			welcomed = true;
			saveText('house', '1');
			ctx.toast('Home! The mirror on the porch is by her wardrobe: stand at it to change clothes.');
		}
		// The mirror only reflects (which means drawing everything again) while she's near enough to see it.
		glass.visible = Math.hypot(lx - MIRROR.x, lz - MIRROR.z) < 22;
		// Fade the roof while she's under it, so the camera can see her on the porch.
		const under = Math.abs(lx) < W / 2 + 0.6 && lz > BACK - 0.5 && lz < PORCH + 0.4 && ctx.pos.y < floorY + 2.5;
		fade = damp(fade, under ? 0.2 : 1, 6, dt);
		const clear = fade < 0.99;
		for (const m of roofMats) {
			if (m.transparent !== clear) {
				m.transparent = clear;
				m.depthWrite = !clear;
				m.needsUpdate = true;
			}
			m.opacity = clear ? fade : 1;
		}
		// Walking off (or anything else moving her) puts the wardrobe away.
		if (dressing && Math.hypot(ctx.pos.x - stand.x, ctx.pos.z - stand.z) > 2.4) close();
	};

	return {
		update,
		/** E at the mirror, or at the door. */
		offer: (): Offer | null => {
			if (dressing || entering || !ctx.canAct() || Math.abs(ctx.pos.y - floorY) > 0.6) return null;
			// The mirror and the door are close together: whichever she's nearer.
			const toMirror = Math.hypot(ctx.pos.x - stand.x, ctx.pos.z - stand.z);
			const toDoor = Math.hypot(ctx.pos.x - doorStep.x, ctx.pos.z - doorStep.z);
			if (toMirror < 1.1 && toMirror <= toDoor) return { label: 'Change clothes', go: open };
			if (toDoor < 1.0) return { label: 'Go inside', go: enter };
			return null;
		},
		/** Where she comes back out of the door, and the way she faces then. */
		doorStep: { ...doorStep, y: floorY },
		outward,
		get dressing() {
			return dressing;
		},
		close,
		/** Which way she faces while she's dressing. */
		facing,
		/** Where she stands at the mirror, and the porch floor's height. */
		stand: { ...stand, y: floorY },
		/** For the camera while she's dressing: over her shoulder at her in the mirror. */
		get framing() {
			if (!dressing) return null;
			// The follow camera, given someone to frame, looks between her and them, from `facing` + π +
			// 0.9 round; so turn that back from the way to where it should be.
			const lookX = ctx.pos.x + (mirror.x - ctx.pos.x) * 0.45;
			const lookZ = ctx.pos.z + (mirror.z - ctx.pos.z) * 0.45;
			const want = Math.atan2(lookFrom.x - lookX, lookFrom.z - lookZ);
			return { x: mirror.x, z: mirror.z, facing: want - Math.PI - 0.9 };
		},
	};
}
