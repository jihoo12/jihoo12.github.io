// The Old Forge: an open smithy on flat ground a little way from the garden, its furnace glowing
// and smoking all day and night. Iron ore crops out of rocks in the hills (mined with her hammer, it
// grows back after a while); at the anvil she smelts it into ingots, and with ingots and the sky
// shards from Cloudrest makes her tools better: a sturdier watering can, a sky rod that's kinder on
// the line, and a sky glider that flies further. It makes the garden's machines too (machines.ts):
// sprinklers, and Sprocket, the clockwork helper; and stone blocks to build with (blocks.ts). And from the ashen ore she brings back from the
// grey place through the rift (/monochrome), it makes a compass that knows the way there, a lantern
// that lights her way at night, and (once she's found all three colour shards) a prism glider.
//
// Smithing is a little game of timing: a marker swings along a bar, and she strikes (E, or the
// action button) when it's over the glowing part. Three strikes make the thing; three perfect ones
// make it especially well. The smithy, the anvil, the ingots and the ore are Blender models
// (tools/island-forge); her hammer and her Smith clip are part of her own (tools/nixchan-3d).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { NixClip, NixFigure } from '../experimental/nix-figure';
import type { Feature } from './features';
import type { Offer } from './interact';
import type { Inventory } from './inventory';
import type { Place } from './layout';
import { glowTexture, type Toon } from './look';
import { SHARDS } from '../monochrome/world';
import { loadJSON, saveJSON } from './save';
import { slopeUp, terrainAt } from './terrain';
import type { Theme } from './theme';
import { thumbnail } from './thumbnail';
import { TAU, closeOnBackdrop, damp, rng } from './util';

export interface ForgeContext {
	renderer: THREE.WebGLRenderer;
	scene: THREE.Scene;
	toon: Toon;
	theme: Theme;
	figure: NixFigure;
	inventory: Inventory;
	modelUrl: string;
	/** The garden, which the forge is put near, facing it. */
	near: { x: number; z: number };
	places: Place[];
	clearOfPlaces: (x: number, z: number, gap: number) => boolean;
	roomy: (x: number, z: number, gap: number) => boolean;
	addFeature: (f: Feature) => void;
	/** Where she is. */
	pos: THREE.Vector3;
	canAct: () => boolean;
	toast: (text: string) => void;
	/** Something's been made better (or Sprocket's been made): the page puts it to use. */
	onUpgrade: (id: Upgrade) => void;
	/** Whether another of this item may be made (there's only room for so many sprinklers). */
	more?: (item: string) => boolean;
}

export type Upgrade = 'can' | 'rod' | 'glider' | 'helper' | 'compass' | 'lantern' | 'prism';
const UPGRADES: Upgrade[] = ['can', 'rod', 'glider', 'helper', 'compass', 'lantern', 'prism'];

const ORE = 'iron-ore';
const INGOT = 'iron-ingot';
const SHARD = 'sky-shard';
/** From the grey place through the rift: carried home, and smelted here like iron. */
export const ASHEN_ORE = 'ashen-ore';
const ASHEN_INGOT = 'ashen-ingot';

/** Whether she's found all three colour shards in the grey place. */
const allShards = () => {
	const saved = loadJSON('monoShards');
	return Array.isArray(saved) && SHARDS.every((s) => saved.includes(s.id));
};

/** Something to make: an item for the bag (as many as she likes), or an upgrade (made once). */
interface Recipe {
	id: string;
	kind: 'item' | 'upgrade';
	/** The item it makes, for an item. */
	item?: string;
	name: string;
	about: string;
	needs: [string, number][];
	color: string;
	/** How many it makes at once, for an item (one, unless it says). */
	makes?: number;
	/** Something more it needs than what's in the bag, and what to say until it's met. */
	unlock?: { met: () => boolean; hint: string };
}

const RECIPES: Recipe[] = [
	{ id: 'ingot', kind: 'item', item: INGOT, name: 'Iron Ingot', about: 'Smelted from ore. Everything else here starts with these.', needs: [[ORE, 2]], color: '#7d86a8' },
	{ id: 'can', kind: 'upgrade', name: 'Sturdy Watering Can', about: 'Holds 12 waterings instead of 5.', needs: [[INGOT, 3]], color: '#c9d3e8' },
	{ id: 'rod', kind: 'upgrade', name: 'Sky Rod', about: 'More room in the green when reeling, and fish come in quicker.', needs: [[INGOT, 2], [SHARD, 3]], color: '#9fe3ff' },
	{ id: 'glider', kind: 'upgrade', name: 'Sky Glider', about: 'Flies faster and sinks slower, so it carries her much further.', needs: [[INGOT, 2], [SHARD, 5]], color: '#7fb8ff' },
	{ id: 'sprinkler', kind: 'item', item: 'sprinkler', name: 'Sprinkler', about: 'Set where four plots meet, it keeps them watered. There is room in the garden for four.', needs: [[INGOT, 2]], color: '#c97b4a' },
	{ id: 'blocks', kind: 'item', item: 'stone-block', name: 'Stone Blocks', about: 'Six blocks of dressed stone from one ore (eight if it goes perfectly), to build with out on the island.', needs: [[ORE, 1]], color: '#d8c9a8', makes: 6 },
	{ id: 'helper', kind: 'upgrade', name: 'Sprocket, a clockwork helper', about: 'Picks ripe crops into a crate by the garden, and plants the same again from your seeds.', needs: [[INGOT, 4], [SHARD, 4]], color: '#e8b84a' },
	{ id: 'ashen-ingot', kind: 'item', item: ASHEN_INGOT, name: 'Ashen Ingot', about: 'Smelted from the ashen ore she brings back from the grey place.', needs: [[ASHEN_ORE, 2]], color: '#8e8e94' },
	{ id: 'compass', kind: 'upgrade', name: 'Rift Compass', about: 'In the grey place, its needle always knows the way back to the Threshold, however far in she is.', needs: [[ASHEN_INGOT, 2], [INGOT, 2]], color: '#b8b8c0' },
	{ id: 'lantern', kind: 'upgrade', name: 'Grey Lantern', about: 'A little lantern that floats at her shoulder and lights the way round her at night.', needs: [[ASHEN_INGOT, 3], [SHARD, 2]], color: '#fff1b8' },
	{
		id: 'prism',
		kind: 'upgrade',
		name: 'Prism Glider',
		about: 'Every colour from the grey place, in its wing: it flies faster and further than any other.',
		needs: [[ASHEN_INGOT, 2]],
		color: '#ff7aa8',
		unlock: { met: allShards, hint: 'Needs all three colour shards found in the grey place.' },
	},
];

// Sizes from tools/island-forge/build.py, in the smithy's own frame (its front towards +z).
const FLOOR = { w: 7, d: 5, top: 0.2 };
const FURNACE = { x: -2.2, z: -1.4 };
const TROUGH = { x: 2.45, z: -1.2 };
const CHIMNEY = { x: -2.2, y: 6.1, z: -1.6 };
const ANVIL = { x: 0.6, z: 0.4, top: 0.62 };
/** Where the face of her hammer comes down at the bottom of a strike, from her feet: across (to her
 * left, +x), forwards and up, as measured off her Smith clip in the page (and taken a touch lower, so
 * it meets the work). She stands so that it lands on the anvil. */
const STRIKE = { x: -0.19, z: 0.42, y: 0.72 };
/** The ore rocks are grown a little from their model, to stand out among the island's own. */
const VEIN_SCALE = 1.3;
/** How long gathered ore takes to grow back. */
const REGROW_MS = 8 * 60 * 1000;

export function createForge(ctx: ForgeContext) {
	const { scene, toon } = ctx;
	const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel);
	const ui = {
		dialog: $('[data-forge]'),
		list: $('[data-forge-list]'),
		close: $<HTMLButtonElement>('[data-forge-close]'),
		game: $('[data-smith]'),
		note: $('[data-smith-note]'),
		bar: $('[data-smith-bar]'),
		marks: $('[data-smith-marks]'),
	};
	const ticks: ((time: number, dt: number) => void)[] = [];

	// ---------- where it goes ----------

	// Flat, open ground a short walk from the garden, the same every visit, its front to the garden.
	const site = (() => {
		const rand = rng(91);
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
			const r = 18 + rand() * 30;
			const x = ctx.near.x + Math.cos(a) * r;
			const z = ctx.near.z + Math.sin(a) * r;
			const g = terrainAt(x, z);
			if (g < 1.6 || g > 9 || slopeUp(x, z) < 0.93 || !flat(x, z) || !ctx.roomy(x, z, 6.5) || !ctx.clearOfPlaces(x, z, 7)) continue;
			return { x, z, yaw: Math.atan2(ctx.near.x - x, ctx.near.z - z) };
		}
		return { x: ctx.near.x + 20, z: ctx.near.z, yaw: -Math.PI / 2 };
	})();
	/** A point in the smithy's own frame, out in the world. */
	const world = (lx: number, lz: number) => ({
		x: site.x + Math.cos(site.yaw) * lx + Math.sin(site.yaw) * lz,
		z: site.z - Math.sin(site.yaw) * lx + Math.cos(site.yaw) * lz,
	});
	const base = (() => {
		let high = -Infinity;
		for (const [lx, lz] of [
			[-3.5, -2.5],
			[3.5, -2.5],
			[-3.5, 2.5],
			[3.5, 2.5],
			[0, 0],
		]) {
			const p = world(lx, lz);
			high = Math.max(high, terrainAt(p.x, p.z));
		}
		return high - 0.05;
	})();
	const floorY = base + FLOOR.top;
	ctx.places.push({ id: 'forge', name: 'The Old Forge', x: site.x, z: site.z, r: 6, clear: 0 });

	// What she walks on and round: the floor (in round steps, since that's what the ground knows),
	// the posts, the furnace, the bellows, the back wall, the trough and the anvil.
	for (let lx = -2.8; lx <= 2.81; lx += 1.4)
		for (let lz = -1.6; lz <= 1.61; lz += 1.6) {
			const p = world(lx, lz);
			ctx.addFeature({ ...p, r: 1.25, pad: floorY });
		}
	const step = world(0, FLOOR.d / 2 + 0.35);
	ctx.addFeature({ ...step, r: 1.0, pad: base - 0.05 });
	for (const lx of [-FLOOR.w / 2 + 0.25, FLOOR.w / 2 - 0.25]) for (const lz of [-FLOOR.d / 2 + 0.25, FLOOR.d / 2 - 0.25]) ctx.addFeature({ ...world(lx, lz), r: 0.25 });
	for (const dx of [-0.45, 0.45]) ctx.addFeature({ ...world(FURNACE.x + dx, FURNACE.z), r: 0.85 });
	ctx.addFeature({ ...world(FURNACE.x + 1.35, FURNACE.z + 0.1), r: 0.45 });
	for (let lx = -1.6; lx <= 2.81; lx += 0.5) ctx.addFeature({ ...world(lx, -FLOOR.d / 2 + 0.25), r: 0.3 });
	for (const dz of [-0.4, 0.4]) ctx.addFeature({ ...world(TROUGH.x, TROUGH.z + dz), r: 0.5 });
	const anvil = world(ANVIL.x, ANVIL.z);
	ctx.addFeature({ ...anvil, r: 0.32 });

	/** Where she stands to work, and the way she faces: behind the anvil, out of the smithy's open
	 * front, so the camera can look in at her with the furnace glowing behind. */
	const work = (() => {
		const heading = site.yaw;
		// Back from the anvil by where her hammer comes down, turned her way.
		const x = anvil.x - (STRIKE.x * Math.cos(heading) + STRIKE.z * Math.sin(heading));
		const z = anvil.z - (-STRIKE.x * Math.sin(heading) + STRIKE.z * Math.cos(heading));
		return { x, z, heading };
	})();

	// ---------- the models ----------

	const models = new Map<string, THREE.Object3D>();
	const toonCache = new Map<string, THREE.MeshToonMaterial>();
	const glowMat = new THREE.MeshBasicMaterial({ color: '#ffb347' });
	const roofMats: THREE.MeshToonMaterial[] = [];
	const make = (name: string) => {
		const source = models.get(name);
		if (!source) return null;
		const copy = source.clone(true);
		copy.position.set(0, 0, 0);
		copy.traverse((o) => {
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
				mat = toon({ color });
				if (roof) roofMats.push(mat);
				else toonCache.set(color, mat);
			}
			o.material = mat;
			o.castShadow = o.receiveShadow = true;
		});
		return copy;
	};
	let hotIngot: THREE.Object3D | null = null;
	const icons = new Map<string, string>();

	new GLTFLoader().loadAsync(ctx.modelUrl).then(
		(gltf) => {
			for (const child of [...gltf.scene.children]) models.set(child.name, child);
			const smithy = make('Smithy');
			if (smithy) {
				smithy.position.set(site.x, base, site.z);
				smithy.rotation.y = site.yaw;
				scene.add(smithy);
			}
			const anvilModel = make('Anvil');
			if (anvilModel) {
				anvilModel.position.set(anvil.x, floorY, anvil.z);
				// Grown to put its face where her hammer lands.
				anvilModel.scale.setScalar(STRIKE.y / ANVIL.top);
				anvilModel.rotation.y = site.yaw + Math.PI / 2;
				scene.add(anvilModel);
			}
			hotIngot = make('IngotHot');
			if (hotIngot) {
				hotIngot.position.set(anvil.x, floorY + STRIKE.y, anvil.z);
				hotIngot.rotation.y = site.yaw;
				hotIngot.visible = false;
				scene.add(hotIngot);
			}
			for (const v of veins) {
				const rock = make('OreRock');
				const ore = make('Ore');
				for (const o of [rock, ore]) {
					if (!o) continue;
					o.position.set(v.x, v.y, v.z);
					o.rotation.y = v.yaw;
					o.scale.setScalar(VEIN_SCALE);
					scene.add(o);
				}
				v.ore = ore;
			}
			// Pictures for the bag and the forge's list.
			for (const [id, name] of [
				[ORE, 'Ore'],
				[INGOT, 'Ingot'],
			]) {
				const o = make(name);
				if (o) icons.set(id, thumbnail(ctx.renderer, o, new THREE.Vector3(0.6, 0.8, 1)));
			}
			// The ashen ore and ingot are the iron ones, in grey.
			for (const [id, name, a, b] of [
				[ASHEN_ORE, 'Ore', '#d6d6dc', '#9a9aa2'],
				[ASHEN_INGOT, 'Ingot', '#9a9aa2', '#6e6e76'],
			]) {
				const o = models.get(name)?.clone(true);
				if (!o) continue;
				o.position.set(0, 0, 0);
				let k = 0;
				o.traverse((m) => {
					if (m instanceof THREE.Mesh) m.material = toon({ color: k++ % 2 ? b : a });
				});
				icons.set(id, thumbnail(ctx.renderer, o, new THREE.Vector3(0.6, 0.8, 1)));
			}
			ctx.inventory.render();
			render();
		},
		() => {
			// No models: the forge still works, just bare.
		},
	);

	// The furnace's glow, a light that flickers with it, and smoke from the chimney.
	{
		const mouth = world(FURNACE.x, FURNACE.z + 1.0);
		const light = new THREE.PointLight('#ff9a3d', 0, 9, 1.4);
		light.position.set(mouth.x, floorY + 0.9, mouth.z);
		scene.add(light);
		let night = false;
		ctx.theme.on((p) => (night = p.night));
		ticks.push((time) => {
			light.intensity = (night ? 7 : 2.5) * (0.85 + 0.1 * Math.sin(time * 13) + 0.05 * Math.sin(time * 31));
		});
		const glow = glowTexture();
		const top = world(CHIMNEY.x, CHIMNEY.z);
		const puffs = Array.from({ length: 10 }, (_, i) => {
			const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: '#d8d4e6', transparent: true, depthWrite: false, opacity: 0 }));
			scene.add(s);
			return { s, phase: i / 10 };
		});
		ticks.push((time) => {
			for (const p of puffs) {
				const life = (time * 0.12 + p.phase) % 1;
				p.s.position.set(top.x + Math.sin(time * 0.4 + p.phase * 9) * life * 1.2, base + CHIMNEY.y + life * 6, top.z + life * 1.5);
				p.s.scale.setScalar(0.8 + life * 3);
				p.s.material.opacity = 0.55 * Math.sin(Math.PI * life);
			}
		});
	}

	// Fade the roof when she's under it, so the camera can see her inside.
	{
		let fade = 1;
		ticks.push((_time, dt) => {
			const dx = ctx.pos.x - site.x;
			const dz = ctx.pos.z - site.z;
			const lx = dx * Math.cos(site.yaw) - dz * Math.sin(site.yaw);
			const lz = dx * Math.sin(site.yaw) + dz * Math.cos(site.yaw);
			const inside = Math.abs(lx) < FLOOR.w / 2 + 0.5 && Math.abs(lz) < FLOOR.d / 2 + 0.5 && ctx.pos.y < floorY + 2;
			fade = damp(fade, inside ? 0.18 : 1, 6, dt);
			// Only see-through while it's faded: drawn as glass the rest of the time, it would be sorted
			// with everything else that's see-through, and could flicker.
			const clear = fade < 0.99;
			for (const m of roofMats) {
				if (m.transparent !== clear) {
					m.transparent = clear;
					m.depthWrite = !clear;
					m.needsUpdate = true;
				}
				m.opacity = clear ? fade : 1;
			}
		});
	}

	// ---------- the ore in the hills ----------

	interface Vein {
		id: string;
		x: number;
		y: number;
		z: number;
		yaw: number;
		ore: THREE.Object3D | null;
		/** A faint warm glint over it while there's ore to mine, so it's spotted among the rocks. */
		glint: THREE.Sprite;
	}
	const veins: Vein[] = [];
	const glintTex = glowTexture();
	{
		const rand = rng(93);
		for (let tries = 0; tries < 8000 && veins.length < 6; tries++) {
			const a = rand() * TAU;
			const r = Math.sqrt(rand()) * 80;
			const x = Math.cos(a) * r;
			const z = Math.sin(a) * r;
			const g = terrainAt(x, z);
			if (g < 3.5 || g > 13 || slopeUp(x, z) < 0.75 || !ctx.roomy(x, z, 2.4) || !ctx.clearOfPlaces(x, z, 3)) continue;
			if (veins.some((v) => Math.hypot(v.x - x, v.z - z) < 20)) continue;
			const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTex, color: '#ffb36b', transparent: true, depthWrite: false, opacity: 0, blending: THREE.AdditiveBlending }));
			glint.scale.setScalar(1.6);
			glint.position.set(x, g + 0.9, z);
			scene.add(glint);
			veins.push({ id: `vein-${veins.length}`, x, y: g - 0.15, z, yaw: rand() * TAU, ore: null, glint });
			ctx.addFeature({ x, z, r: 0.95 * VEIN_SCALE, dome: { base: g - 0.15, top: 0.75 * VEIN_SCALE } });
		}
	}
	const mined: Record<string, number> = {};
	{
		const saved = loadJSON('ore');
		if (saved && typeof saved === 'object') for (const [k, v] of Object.entries(saved)) if (typeof v === 'number') mined[k] = v;
	}
	const ripe = (v: Vein) => mined[v.id] === undefined || Date.now() - mined[v.id] >= REGROW_MS;
	let veinClock = 0;
	const ready = new Set<Vein>();
	ticks.push((time, dt) => {
		for (const v of veins) v.glint.material.opacity = ready.has(v) ? 0.35 + 0.2 * Math.sin(time * 2.5 + v.x) : 0;
		veinClock -= dt;
		if (veinClock > 0) return;
		veinClock = 1;
		for (const v of veins) {
			if (ripe(v)) ready.add(v);
			else ready.delete(v);
			if (v.ore) v.ore.visible = ripe(v);
		}
	});

	// ---------- items ----------

	ctx.inventory.register({
		id: ORE,
		name: 'Iron Ore',
		kind: 'material',
		description: 'Rusty-red lumps from the rocks up in the hills. Two of them smelt into an ingot at the forge.',
		color: '#c0703f',
		sell: 6,
		icon: () => icons.get(ORE) ?? null,
	});
	ctx.inventory.register({
		id: ASHEN_ORE,
		name: 'Ashen Ore',
		kind: 'material',
		description: 'Pale, glassy shards chipped from the rocks in the grey place, cold to the touch however long she holds them. Two smelt into an ingot at the forge.',
		color: '#b4b4ba',
		sell: 10,
		icon: () => icons.get(ASHEN_ORE) ?? null,
	});
	ctx.inventory.register({
		id: ASHEN_INGOT,
		name: 'Ashen Ingot',
		kind: 'material',
		description: 'A bar of ashen metal, smelted at the forge. It has no colour of its own, and seems to take on a little of whatever is near it.',
		color: '#8e8e94',
		sell: 45,
		icon: () => icons.get(ASHEN_INGOT) ?? null,
	});
	ctx.inventory.register({
		id: INGOT,
		name: 'Iron Ingot',
		kind: 'material',
		description: 'A bar of good iron, smelted at the forge. Tools are made from these.',
		color: '#7d86a8',
		sell: 30,
		icon: () => icons.get(INGOT) ?? null,
	});

	// ---------- what's been made ----------

	const made = new Set<Upgrade>();
	{
		const saved = loadJSON('forge');
		if (saved && typeof saved === 'object' && Array.isArray((saved as { made?: unknown }).made))
			for (const id of (saved as { made: unknown[] }).made) if (UPGRADES.includes(id as Upgrade)) made.add(id as Upgrade);
	}
	const save = () => saveJSON('forge', { made: [...made] });
	const done = (r: Recipe) => (r.kind === 'upgrade' ? made.has(r.id as Upgrade) : r.item !== undefined && ctx.more?.(r.item) === false);
	const can = (r: Recipe) => r.needs.every(([id, n]) => ctx.inventory.count(id) >= n) && !done(r) && (r.unlock?.met() ?? true);

	// ---------- the list at the anvil ----------

	let dialogOpen = false;
	function render() {
		if (!ui.list) return;
		ui.list.replaceChildren(
			...RECIPES.map((r) => {
				const li = document.createElement('li');
				const pic = document.createElement('span');
				pic.className = 'shop-picture';
				const icon = r.id === 'ingot' ? icons.get(INGOT) : r.id === 'ashen-ingot' ? icons.get(ASHEN_INGOT) : null;
				if (icon) pic.style.backgroundImage = `url(${icon})`;
				else pic.style.backgroundColor = r.color;
				const text = document.createElement('span');
				text.className = 'shop-text';
				const strong = document.createElement('strong');
				strong.textContent = r.name;
				const small = document.createElement('small');
				const needs = r.needs.map(([id, n]) => `${n} ${ctx.inventory.def(id)?.name ?? id} (have ${ctx.inventory.count(id)})`).join(', ');
				const locked = r.unlock && !r.unlock.met() ? ` ${r.unlock.hint}` : '';
				small.textContent = `${r.about} Needs ${needs}.${locked}`;
				text.append(strong, small);
				const b = document.createElement('button');
				b.type = 'button';
				b.textContent = done(r) ? (r.kind === 'upgrade' ? 'Made' : 'No room') : 'Forge';
				b.disabled = !can(r);
				b.addEventListener('click', () => start(r));
				li.append(pic, text, b);
				return li;
			}),
		);
	}
	const openDialog = () => {
		if (!ui.dialog) return;
		dialogOpen = true;
		ui.dialog.hidden = false;
		render();
		ui.close?.focus();
	};
	const closeDialog = () => {
		if (!ui.dialog || !dialogOpen) return;
		dialogOpen = false;
		ui.dialog.hidden = true;
		ui.close?.blur();
	};
	ui.close?.addEventListener('click', closeDialog);
	closeOnBackdrop(ui.dialog, closeDialog);

	// ---------- smithing ----------

	/** The game at the anvil: a marker swinging along the bar, and the glowing part to strike it in. */
	interface Smithing {
		recipe: Recipe;
		strikes: ('perfect' | 'good' | 'miss')[];
		clock: number;
		speed: number;
		sweet: number;
		/** Time to wait after the last strike before it's done. */
		finishing: number;
	}
	let smithing: Smithing | null = null;
	/** Mining a vein: she strikes it once with her hammer, and the ore comes away. */
	let mining: { vein: Vein; clock: number; facing: number } | null = null;
	const SWEET = 0.11;
	const PERFECT = 0.035;
	const marker = (s: Smithing) => 0.5 - 0.5 * Math.cos(s.clock * s.speed);
	const showGame = () => {
		if (!smithing || !ui.game) return;
		ui.game.hidden = false;
		ui.bar?.style.setProperty('--sweet', String(smithing.sweet));
		ui.bar?.style.setProperty('--w', String(SWEET * 2));
		ui.bar?.style.setProperty('--pw', String(PERFECT * 2));
		if (ui.marks) ui.marks.textContent = ['', '', ''].map((_, i) => ({ perfect: '★', good: '●', miss: '✕' })[smithing!.strikes[i]] ?? '○').join(' ');
	};
	function start(r: Recipe) {
		if (!can(r)) return;
		closeDialog();
		for (const [id, n] of r.needs) ctx.inventory.remove(id, n);
		smithing = { recipe: r, strikes: [], clock: 0, speed: 2.4, sweet: 0.3 + Math.random() * 0.4, finishing: 0 };
		ctx.pos.set(work.x, floorY, work.z);
		ctx.figure.setProp('Hammer', true);
		if (hotIngot) hotIngot.visible = true;
		if (ui.note) ui.note.textContent = `Forging: ${r.name}. Strike when the marker's in the glow!`;
		showGame();
	}
	const strike = () => {
		const s = smithing;
		if (!s || s.strikes.length >= 3) return;
		const off = Math.abs(marker(s) - s.sweet);
		const how = off < PERFECT ? 'perfect' : off < SWEET ? 'good' : 'miss';
		s.strikes.push(how);
		burst(how === 'miss' ? 6 : how === 'good' ? 14 : 26);
		if (ui.note) ui.note.textContent = how === 'perfect' ? 'Perfect!' : how === 'good' ? 'Good strike!' : 'A bit off…';
		// Each strike quicker, and the glow somewhere else.
		s.speed *= 1.25;
		s.sweet = 0.25 + Math.random() * 0.5;
		if (s.strikes.length === 3) s.finishing = 1.2;
		showGame();
	};
	const finish = () => {
		const s = smithing!;
		smithing = null;
		ctx.figure.setProp('Hammer', false);
		if (hotIngot) hotIngot.visible = false;
		if (ui.game) ui.game.hidden = true;
		const perfect = s.strikes.every((k) => k === 'perfect');
		const r = s.recipe;
		if (r.kind === 'item' && r.item) {
			// Done perfectly, smelting makes two ingots for one.
			const smelting = r.item === INGOT || r.item === ASHEN_INGOT;
			const n = r.makes ? r.makes + (perfect ? 2 : 0) : perfect && smelting ? 2 : 1;
			if (!ctx.inventory.add(r.item, n)) {
				// No room: what went into it goes back, rather than being lost.
				for (const [id, k] of r.needs) ctx.inventory.add(id, k);
				ctx.toast(`Her bag's too full for the ${r.name.toLowerCase()}, so she keeps what it was made from.`);
				return;
			}
			if (r.makes) ctx.toast(`${n} ${r.name.toLowerCase()}${perfect ? ', made flawlessly' : ''}! B takes them out to build with.`);
			else ctx.toast(smelting ? (perfect ? 'Flawless! The ore made two ingots.' : `An ${r.name.toLowerCase()}, still warm.`) : perfect ? `A ${r.name.toLowerCase()}, made flawlessly!` : `A ${r.name.toLowerCase()}, ready to set up.`);
		} else {
			made.add(r.id as Upgrade);
			save();
			ctx.onUpgrade(r.id as Upgrade);
			ctx.toast(perfect ? `The ${r.name}, made flawlessly!` : `The ${r.name} is ready!`);
		}
		ctx.inventory.render();
	};

	// Sparks from the anvil (or the rock) at each strike.
	const SPARKS = 40;
	const sparkMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.035, 0.035, 0.035), new THREE.MeshBasicMaterial({ color: '#ffd27a' }), SPARKS);
	sparkMesh.frustumCulled = false;
	scene.add(sparkMesh);
	const sparks = Array.from({ length: SPARKS }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0 }));
	let nextSpark = 0;
	const sparkAt = new THREE.Vector3();
	function burst(n: number, at?: THREE.Vector3) {
		const from = at ?? sparkAt.set(anvil.x, floorY + STRIKE.y + 0.05, anvil.z);
		for (let i = 0; i < n; i++) {
			const s = sparks[nextSpark];
			nextSpark = (nextSpark + 1) % SPARKS;
			s.p.copy(from);
			const a = Math.random() * TAU;
			const out = 1 + Math.random() * 2.5;
			s.v.set(Math.cos(a) * out, 1.5 + Math.random() * 2.5, Math.sin(a) * out);
			s.life = 0.4 + Math.random() * 0.4;
		}
	}
	const m4 = new THREE.Matrix4();
	const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
	ticks.push((_time, dt) => {
		sparks.forEach((s, i) => {
			if (s.life <= 0) {
				sparkMesh.setMatrixAt(i, hidden);
				return;
			}
			s.life -= dt;
			s.v.y -= 9 * dt;
			s.p.addScaledVector(s.v, dt);
			sparkMesh.setMatrixAt(i, m4.makeTranslation(s.p.x, s.p.y, s.p.z));
		});
		sparkMesh.instanceMatrix.needsUpdate = true;
	});

	// ---------- every frame ----------

	ticks.push((_time, dt) => {
		if (smithing) {
			smithing.clock += dt;
			ui.bar?.style.setProperty('--m', String(marker(smithing)));
			if (smithing.finishing > 0 && (smithing.finishing -= dt) <= 0) finish();
		}
		if (mining) {
			mining.clock += dt;
			if (mining.clock > 0.9 && mining.clock - dt <= 0.9) {
				const v = mining.vein;
				burst(18, new THREE.Vector3(v.x, v.y + 0.7, v.z));
			}
			if (mining.clock > 1.5) {
				const v = mining.vein;
				mining = null;
				ctx.figure.setProp('Hammer', false);
				const n = Math.random() < 0.35 ? 2 : 1;
				if (!ctx.inventory.add(ORE, n)) {
					ctx.toast("Her bag's too full to carry any ore.");
					return;
				}
				mined[v.id] = Date.now();
				saveJSON('ore', mined);
				veinClock = 0;
				ctx.toast(n > 1 ? 'Two lumps of iron ore!' : 'A lump of iron ore.');
			}
		}
	});

	return {
		/** E: strike while smithing; at the anvil, the list of what to make; at a vein, mine it. */
		offer: (): Offer | null => {
			if (smithing) return smithing.strikes.length < 3 ? { label: 'Strike!', go: strike } : { label: 'Strike!' };
			if (mining || dialogOpen || !ctx.canAct()) return null;
			if (Math.hypot(ctx.pos.x - anvil.x, ctx.pos.z - anvil.z) < 1.8 && Math.abs(ctx.pos.y - floorY) < 1) return { label: 'Use the anvil', go: openDialog };
			for (const v of veins) {
				if (Math.hypot(ctx.pos.x - v.x, ctx.pos.z - v.z) > 2.3 || Math.abs(ctx.pos.y - v.y) > 2) continue;
				if (!ripe(v)) return { label: `Mined out for now (about ${Math.ceil((REGROW_MS - (Date.now() - mined[v.id])) / 60000)} min)` };
				if (!ctx.inventory.fits(ORE)) return { label: 'Your bag is too full' };
				return {
					label: 'Mine iron ore',
					go: () => {
						mining = { vein: v, clock: 0, facing: Math.atan2(v.x - ctx.pos.x, v.z - ctx.pos.z) };
						ctx.figure.setProp('Hammer', true);
					},
				};
			}
			return null;
		},
		/** Whether something here is keeping her on the spot, and which way it has her face. */
		get busy() {
			return !!smithing || !!mining;
		},
		get facing() {
			return smithing ? work.heading : (mining?.facing ?? 0);
		},
		get clip(): NixClip | null {
			return smithing || mining ? 'Smith' : null;
		},
		get dialogOpen() {
			return dialogOpen;
		},
		closeDialog,
		/** Whether this has been made at the forge. */
		has: (id: Upgrade) => made.has(id),
		/** For the camera, while she's at the anvil: close in on her and the work from in front, a
		 * little to one side. (The camera puts itself at `facing` + π + 0.9 round from the work.) */
		get framing() {
			return smithing ? { x: anvil.x, z: anvil.z, facing: work.heading - Math.PI - 0.4 } : null;
		},
		/** Where the ore is, for Pebble's tips. */
		veinsLeft: () => veins.filter(ripe).length,
		update(time: number, dt: number) {
			for (const tick of ticks) tick(time, dt);
		},
	};
}

export type Forge = ReturnType<typeof createForge>;

