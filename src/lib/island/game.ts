// Nixchan's island: a little toon island in the sea for the 3D Nixchan to roam freely. There's no
// goal and no clock: just places to come across (a lighthouse, a campfire, standing stones, a flag on
// the summit, an islet out at sea, an island floating in the sky), a map that fills in as she
// explores, a glider for jumping off high ground, fish to catch, a garden to grow, and Pebble at the
// market stand.
//
// This file only puts the island together and runs the frame. Each part lives in its own module:
//   terrain, features  the ground and what stands on it (all movement asks is "how high is it here?")
//   layout, scatter    where the places, rocks and trees go
//   sky, water, theme  light, sea and day/night (parts that change colour register with the theme)
//   landmarks          the pier, lighthouse, campfire and the rest
//   skyisle            the island in the sky, and the Windspout's wind up to it
//   player, camera     Nixchan and the camera that follows her
//   controls           keys, mouse and touch
//   interact           what E does here (sources register offers)
//   explore, menu      places found, the maps, and the menu over the game
//   fishing, farm, npc, inventory   the things to do
//   forge              the smithy: ore to mine, ingots to smelt, tools to make better
//   machines           sprinklers and Sprocket, made at the forge, looking after the garden
//   save               every key the island keeps in localStorage
import * as THREE from 'three';
import { createFollowCamera } from './camera';
import { createControls, type Orbit } from './controls';
import { createExplore } from './explore';
import { createFarm } from './farm';
import { addFeature, groundAt, removeFeature, roomy } from './features';
import { createForge, type Upgrade } from './forge';
import { MAX_SPRINKLERS, createMachines } from './machines';
import { createFishing, SPECIES } from './fishing';
import { createInteractions } from './interact';
import { createInventory } from './inventory';
import { buildLandmarks, buildPier } from './landmarks';
import { planIsland } from './layout';
import { makeToon } from './look';
import { createMenu } from './menu';
import { createNpc } from './npc';
import { createPlayer } from './player';
import { scatter } from './scatter';
import { createSkyIsle, skyWaterAt } from './skyisle';
import { createSky } from './sky';
import { ISLET, PIER_DIR, deckAt, terrainMesh } from './terrain';
import { createTheme, isNight } from './theme';
import { createWater } from './water';

export async function startIsland() {
	const canvas = document.querySelector<HTMLCanvasElement>('[data-stage]');
	if (!canvas) return;
	const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel);
	const ui = {
		loading: $('[data-loading]'),
		atlas: $('[data-atlas]'),
		atlasClose: $<HTMLButtonElement>('[data-atlas-close]'),
		bag: $('[data-bag]'),
		bagDetail: $('[data-bag-detail]'),
		bagSummary: $('[data-bag-summary]'),
		stick: $('[data-stick]'),
		knob: $('[data-knob]'),
		jump: $<HTMLButtonElement>('[data-jump]'),
	};

	let renderer: THREE.WebGLRenderer;
	try {
		renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	} catch {
		document.documentElement.classList.add('no-3d');
		return;
	}
	renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;

	const scene = new THREE.Scene();
	// The near plane sits a little way out: the camera never comes closer than that, and it buys the
	// depth buffer enough precision that the gently shelving beaches don't flicker against the sea.
	const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 2000);
	const toon = makeToon();
	const theme = createTheme();

	// ---------- the world ----------

	const sky = createSky(scene, toon, theme);
	scene.add(terrainMesh(toon({ vertexColors: true })));
	const water = createWater(scene, sky.fog, theme);
	buildPier(scene, toon, theme);
	const layout = planIsland();
	scatter(scene, toon, layout);

	// ---------- Nixchan, and how she's steered ----------

	// She starts with her back to the sea, looking inland, with the pier off to one side.
	const orbit: Orbit = { yaw: Math.atan2(PIER_DIR.x, PIER_DIR.z) + 0.55, pitch: 0.32, distance: 9 };
	const controls = createControls(canvas, ui, orbit, {
		intercept(key, e) {
			// Talking with Pebble, the keys work the conversation.
			if (npc.talking) {
				if (key === ' ' || key.startsWith('arrow') || key === 'enter') e.preventDefault();
				if (!e.repeat) npc.key(key);
				return true;
			}
			// With the menu open, only the keys that work the menu do anything.
			if (menu.isOpen && !['m', 'i', 'h', '?', 'escape'].includes(key)) return true;
			if ((farm.shopOpen || forge.dialogOpen) && key !== 'escape') return true;
			return false;
		},
		command(key, e) {
			if (key === 'escape') {
				menu.close();
				farm.closeShop();
				forge.closeDialog();
			}
			if (e.repeat) return;
			// E does whatever there is to do here, and otherwise she waves.
			if (key === 'e') {
				if (!interactions.press()) controls.state.waveQueued = true;
			} else if (key === 'f') fishing.press();
			else if (key === 'm') menu.toggle('map');
			else if (key === 'i') menu.toggle('bag');
			else if (key === 'h' || key === '?') menu.toggle('help');
		},
		release(key) {
			if (key === 'f') fishing.release();
		},
		blur() {
			fishing.release();
		},
	});

	const player = createPlayer({
		scene,
		toon,
		modelUrl: canvas.dataset.model ?? '',
		start: layout.START,
		heading: Math.atan2(-PIER_DIR.x, -PIER_DIR.z) + 0.55,
		controls,
		orbit,
		ripple: water.ripple,
		hold(tryingToMove) {
			// Chatting with Pebble or tending the garden keeps her on the spot, facing it, until done.
			let held: number | null = null;
			if (npc.talking) held = npc.facing;
			if (farm.busy) held = farm.facing;
			if (forge.busy) held = forge.facing;
			// So does fishing, but walking off (or jumping) puts the rod away, unless a fish is on the line.
			if (fishing.active) {
				if (held === null && tryingToMove && !fishing.hooked) fishing.interrupt();
				if (fishing.active) held = fishing.facing;
			}
			return held;
		},
		clip: () => forge.clip ?? farm.clip ?? fishing.clip,
		carrying: () => machines.carrying,
		// Remade at the forge, the glider flies faster and sinks slower.
		glider: () => (forge.has('glider') ? { speed: 10.5, sink: 1.4 } : { speed: 8.5, sink: 2.3 }),
	});
	const { figure, pos } = player;
	let ready = false;
	figure.ready.then(
		() => {
			ready = true;
			figure.group.traverse((o) => (o.castShadow = true));
			ui.loading?.setAttribute('hidden', '');
		},
		() => {
			if (ui.loading) ui.loading.textContent = "Nixchan couldn't make it to the island just now. Try reloading?";
		},
	);

	const landmarks = buildLandmarks(scene, toon, theme, layout, pos);
	const follow = createFollowCamera(camera, orbit, layout.START);
	const towardCamera = () => Math.atan2(camera.position.x - pos.x, camera.position.z - pos.z);

	// ---------- things to do ----------

	const interactions = createInteractions();

	// Her bag: fish, seeds, crops and her watering can.
	const inventory = createInventory({
		slots: 24,
		grid: ui.bag,
		detail: ui.bagDetail,
		summary: ui.bagSummary,
		note: () => `${farm.coins} coins`,
	});
	for (const s of SPECIES)
		inventory.register({
			id: `fish-${s.id}`,
			name: s.name,
			kind: 'fish',
			description: s.blurb,
			color: s.body,
			sell: s.price,
			icon: () => fishing.iconFor(s.id),
			actions: [
				{
					label: 'Let one go',
					run: (id) => {
						if (inventory.remove(id)) fishing.toast(`The ${s.name} swims off.`);
					},
				},
			],
		});

	const fishing = createFishing({
		renderer,
		scene,
		camera,
		figure,
		root: player.root,
		modelUrl: canvas.dataset.fishModel ?? '',
		toon,
		// Up on Cloudrest it's the lake she fishes in; down here, the sea.
		waterAt: (x, z) => (skyIsle.aboard ? skyWaterAt(x, z, pos.y) : groundAt(x, z) < -0.5 ? 0 : null),
		ripple: water.ripple,
		pos,
		canStand: () => ready && player.grounded && !player.swimming && !farm.busy && !farm.shopOpen && !forge.busy && !forge.dialogOpen && !npc.talking && Math.hypot(player.vel.x, player.vel.z) < 0.6,
		rod: () => (forge.has('rod') ? { lo: 0.15, hi: 0.9, speed: 1.45 } : { lo: 0.25, hi: 0.85, speed: 1 }),
		heading: () => player.heading,
		towardCamera,
		waters: (x, z) => ({
			deep: groundAt(x, z) < -3.5,
			islet: Math.hypot(x - ISLET.x, z - ISLET.z) < 48,
			pier: deckAt(pos.x, pos.z) > -Infinity,
			sky: skyIsle.aboard,
		}),
		onCatch: (s) => inventory.add(`fish-${s.id}`),
		onIcons: () => inventory.render(),
	});

	const farm = createFarm({
		renderer,
		scene,
		figure,
		toon,
		inventory,
		modelUrl: canvas.dataset.farmModel ?? '',
		centre: layout.GARDEN,
		angle: layout.GARDEN_ANGLE,
		groundAt,
		addFeature,
		pos,
		towardCamera,
		canAct: () => ready && player.grounded && !player.swimming && !fishing.active && !menu.isOpen && !npc.talking && !forge.busy && !forge.dialogOpen,
		toast: (text) => fishing.toast(text),
		keeper: { name: 'Pebble', talk: () => npc.open() },
		onTrade: () => npc.cheer(),
		canHolds: () => (forge.has('can') ? 12 : 5),
	});

	// The forge, near the garden: ore to mine in the hills (E), and the anvil to make things at.
	const forge = createForge({
		renderer,
		scene,
		toon,
		theme,
		figure,
		inventory,
		modelUrl: canvas.dataset.forgeModel ?? '',
		near: layout.GARDEN,
		places: layout.places,
		clearOfPlaces: layout.clearOfPlaces,
		roomy,
		addFeature,
		pos,
		canAct: () => ready && player.grounded && !player.swimming && !fishing.active && !farm.busy && !farm.shopOpen && !menu.isOpen && !npc.talking,
		toast: (text) => fishing.toast(text),
		onUpgrade: (id) => showUpgrade(id),
		more: (item) => item !== 'sprinkler' || machines.sprinklers() < MAX_SPRINKLERS,
	});
	/** What an upgrade looks like on her: a steel can, a sky-blue reel, a sky-blue glider. */
	const showUpgrade = (id: Upgrade) => {
		if (id === 'can') figure.tint('Can', '#c9d3e8');
		if (id === 'rod') figure.tint('Reel', '#9fe3ff');
		if (id === 'glider') player.paintGlider('#9fe3ff', '#fdfbff');
		if (id === 'helper') machines.helperArrived();
	};

	// The garden's machines: sprinklers where four plots meet, and Sprocket by the harvest crate.
	const machines = createMachines({
		inventory,
		garden: farm.garden,
		groundAt,
		addFeature,
		removeFeature,
		scene,
		pos,
		canAct: () => ready && player.grounded && !player.swimming && !fishing.active && !farm.busy && !farm.shopOpen && !forge.busy && !forge.dialogOpen && !menu.isOpen && !npc.talking,
		toast: (text) => fishing.toast(text),
		figure,
		swimming: () => player.swimming,
		closeMenu: () => menu.close(),
	});
	for (const id of ['can', 'rod', 'glider', 'helper'] as const) if (forge.has(id)) showUpgrade(id);
	farm.setMachines(machines.machines);
	// Smithing comes first, so E strikes while she's at it; the sprinkler hint comes last.
	interactions.add(forge.offer);
	interactions.add(machines.offer);
	interactions.add(farm.offer);
	interactions.add(machines.hint);

	// Cloudrest, up in the sky: crystals to gather (E), and a chest at the top of the spire.
	const skyIsle = createSkyIsle({ scene, toon, theme, inventory, pos, addFeature, modelUrl: canvas.dataset.skyModel ?? '', toast: (text) => fishing.toast(text) });
	interactions.add(skyIsle.offer);

	// Pebble, who keeps the stand, behind its counter.
	const npc = createNpc({
		scene,
		camera,
		toon,
		modelUrl: canvas.dataset.otterModel ?? '',
		spot: farm.keeperSpot,
		groundAt,
		pos,
		openShop: () => farm.openShop(),
		facts: () => {
			const sellable = { count: 0, value: 0, name: null as string | null };
			let seeds = 0;
			for (const [id, n] of inventory.entries()) {
				const def = inventory.def(id);
				if (def?.sell) {
					sellable.count += n;
					sellable.value += def.sell * n;
					sellable.name ??= def.name;
				}
				if (def?.kind === 'seed') seeds += n;
			}
			return {
				night: isNight(),
				caughtKinds: fishing.caughtKinds(),
				fishKinds: SPECIES.length,
				hasCaught: fishing.hasCaught,
				found: explore.found,
				sellable,
				seeds,
				garden: farm.summary(),
				forged: forge.has,
				sprinklers: machines.sprinklers(),
			};
		},
	});
	addFeature({ x: farm.keeperSpot.x, z: farm.keeperSpot.z, r: 0.4 });
	inventory.render();

	// ---------- exploring, and the menu ----------

	const explore = createExplore(
		{
			banner: $('[data-banner]'),
			bannerName: $('[data-banner-name]'),
			bannerNote: $('[data-banner-note]'),
			map: $<HTMLCanvasElement>('[data-map]'),
			atlasMap: $<HTMLCanvasElement>('[data-atlas-map]'),
			atlasCount: $('[data-atlas-count]'),
		},
		layout.places,
	);
	const menu = createMenu({
		root: ui.atlas,
		close: ui.atlasClose,
		onOpen: () => {
			controls.clearKeys();
			fishing.release();
		},
		onShow: (tab) => {
			if (tab !== 'map') return;
			explore.sizeAtlas();
			explore.drawAtlas(pos, player.turn);
		},
	});
	$('[data-map]')?.addEventListener('click', () => menu.open('map'));

	theme.start();

	// ---------- the loop ----------

	const resize = () => {
		const w = innerWidth;
		const h = innerHeight;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.fov = w < h ? 60 : 45;
		camera.updateProjectionMatrix();
		explore.sizeMinimap();
		if (menu.isOpen) explore.sizeAtlas();
	};
	resize();
	addEventListener('resize', resize);

	let time = 0;
	let last = performance.now();
	let mapClock = 0;
	let greeted = false;

	renderer.setAnimationLoop((now) => {
		const dt = Math.min(0.05, (now - last) / 1000);
		last = now;
		time += dt;

		if (ready) {
			if (!greeted) {
				greeted = true;
				explore.announce("Nixchan's Island", 'Go wherever you like');
				if (menu.firstVisit) menu.open('help');
			}
			player.update(dt, time);
			fishing.update(dt, time);
			farm.update(dt);
			machines.update(dt, time);
			npc.update(dt);
			interactions.update();
		}
		landmarks.update(time, dt);
		skyIsle.update(time, dt);
		forge.update(time, dt);

		follow.update(dt, player, npc.talking ? { ...npc.spot, facing: npc.facing } : forge.framing);
		sky.update(time, camera, pos);
		water.update(time, dt);

		mapClock -= dt;
		if (mapClock <= 0 && ready) {
			mapClock = 0.1;
			explore.update(pos, player.turn);
			if (menu.isOpen && menu.tab === 'map') explore.drawAtlas(pos, player.turn);
		}
		renderer.render(scene, camera);
	});
}
