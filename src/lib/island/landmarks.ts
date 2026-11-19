// The things built on the island: the pier with its lamp, the lighthouse, the flag on the summit,
// the campfire, the standing stones, the chest on the islet and the buoy out at sea. Each is a
// self-contained block; add a new one as another function and call it from `buildLandmarks`.
import * as THREE from 'three';
import { SHARDS } from '../monochrome/world';
import { addFeature } from './features';
import type { Layout } from './layout';
import { glowTexture, type Toon } from './look';
import { loadJSON } from './save';
import { ISLET, PIER, PIER_ANGLE, terrainAt } from './terrain';
import type { Theme } from './theme';
import { TAU, damp } from '../nixkit/util';

/** Everything a landmark gets to build itself with. */
interface Kit {
	scene: THREE.Scene;
	toon: Toon;
	theme: Theme;
	/** Moves something every frame: a flame, the flag, the lighthouse beam, the chest lid. */
	animate: (tick: (time: number, dt: number) => void) => void;
	/** A light that glows brighter at night (its daytime and night-time intensity). */
	nightLight: (light: THREE.PointLight, day: number, night: number) => void;
	/** Something only shown at night. */
	nightGlow: (o: THREE.Object3D) => void;
	glowSprite: (scale: number, opacity: number, color?: string) => THREE.Sprite;
	mesh: (geo: THREE.BufferGeometry, mat: THREE.Material, x?: number, y?: number, z?: number) => THREE.Mesh;
	mats: { stone: THREE.Material; paleStone: THREE.Material; wood: THREE.Material; ink: THREE.Material; gold: THREE.Material };
}

/** The pier, with a lamp at the far end. Built before anything is scattered, so trees keep off it. */
export function buildPier(scene: THREE.Scene, toon: Toon, theme: Theme) {
	const pierLamp = new THREE.PointLight('#ffd38a', 0, 18, 1.5);
	const bulbMat = new THREE.MeshBasicMaterial({ color: '#fff6d8' });
	const wood = toon({ color: '#b07a4f' });
	const darkWood = toon({ color: '#8d5d3b' });
	const group = new THREE.Group();
	group.rotation.y = -PIER_ANGLE;
	const planks: THREE.Vector3[] = [];
	for (let s = PIER.from; s <= PIER.to; s += 0.56) planks.push(new THREE.Vector3(s, PIER.deck - 0.08, 0));
	const plankMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.16, PIER.half * 2), wood, planks.length);
	const m = new THREE.Matrix4();
	const tint = new THREE.Color();
	planks.forEach((p, i) => {
		plankMesh.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z));
		plankMesh.setColorAt(i, tint.set(i % 3 === 0 ? '#e8d6c8' : '#ffffff'));
	});
	plankMesh.castShadow = plankMesh.receiveShadow = true;
	group.add(plankMesh);
	const posts: THREE.Vector3[] = [];
	for (let s = PIER.from + 0.4; s <= PIER.to; s += 3.2) for (const side of [-1, 1]) posts.push(new THREE.Vector3(s, PIER.deck - 3, side * (PIER.half - 0.15)));
	const postMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.13, 6.2, 7), darkWood, posts.length);
	posts.forEach((p, i) => postMesh.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
	postMesh.castShadow = true;
	group.add(postMesh);
	const lampPost = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.6, 7), toon({ color: '#2c2a52' }));
	lampPost.position.set(PIER.to - 0.4, PIER.deck + 1.3, PIER.half - 0.3);
	const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10), bulbMat);
	bulb.position.set(PIER.to - 0.4, PIER.deck + 2.7, PIER.half - 0.3);
	pierLamp.position.copy(bulb.position);
	group.add(lampPost, bulb, pierLamp);
	scene.add(group);
	// She walks round the lamp post rather than through it.
	const lampWorld = new THREE.Vector3(PIER.to - 0.4, 0, PIER.half - 0.3).applyAxisAngle(new THREE.Vector3(0, 1, 0), -PIER_ANGLE);
	addFeature({ x: lampWorld.x, z: lampWorld.z, r: 0.2 });
	theme.on((p) => {
		pierLamp.intensity = p.night ? 9 : 0;
		bulbMat.color.set(p.night ? '#ffe39a' : '#f4ecd6');
	});
}

/** The lighthouse: a striped tower on a stone plinth, with a beam that sweeps the sea at night. */
function lighthouse(k: Kit, { x, z }: { x: number; z: number }) {
	const { mesh, toon } = k;
	let low = Infinity;
	let high = terrainAt(x, z);
	for (let i = 0; i < 12; i++) {
		const a = (i * TAU) / 12;
		const h = terrainAt(x + Math.cos(a) * 2.6, z + Math.sin(a) * 2.6);
		low = Math.min(low, h);
		high = Math.max(high, h);
	}
	const floor = high + 0.3;
	const group = new THREE.Group();
	group.position.set(x, floor, z);
	const depth = floor - low + 1.5;
	group.add(mesh(new THREE.CylinderGeometry(2.6, 2.9, depth, 12), k.mats.paleStone, 0, -depth / 2, 0));
	const TOWER = 9;
	const BANDS = 5;
	for (let i = 0; i < BANDS; i++) {
		const r0 = THREE.MathUtils.lerp(1.45, 1.0, i / BANDS);
		const r1 = THREE.MathUtils.lerp(1.45, 1.0, (i + 1) / BANDS);
		group.add(mesh(new THREE.CylinderGeometry(r1, r0, TOWER / BANDS, 16), toon({ color: i % 2 ? '#f25f6b' : '#fdfbff' }), 0, (TOWER / BANDS) * (i + 0.5), 0));
	}
	group.add(mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.22, 16), k.mats.ink, 0, TOWER + 0.11, 0));
	const lampMat = new THREE.MeshBasicMaterial({ color: '#fff3c9' });
	group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 1.3, 12), lampMat).translateY(TOWER + 0.87));
	group.add(mesh(new THREE.ConeGeometry(1.08, 1.1, 12), toon({ color: '#f25f6b' }), 0, TOWER + 2.07, 0));
	// A door facing inland.
	const inland = new THREE.Vector2(-x, -z).normalize();
	const door = mesh(new THREE.BoxGeometry(0.7, 1.35, 0.2), k.mats.ink, inland.x * 1.4, 0.67, inland.y * 1.4);
	door.rotation.y = Math.atan2(inland.x, inland.y);
	group.add(door);
	// The beam: two long faint cones from the lamp, turning slowly.
	const beam = new THREE.Group();
	beam.position.y = TOWER + 0.87;
	const beamMat = new THREE.MeshBasicMaterial({ color: '#fff1c4', transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
	for (const side of [1, -1]) {
		const cone = new THREE.ConeGeometry(3, 40, 20, 1, true);
		cone.translate(0, -20, 0);
		cone.rotateZ((side * Math.PI) / 2);
		beam.add(new THREE.Mesh(cone, beamMat));
	}
	const glow = k.glowSprite(6, 0.9, '#ffe9b0');
	glow.position.y = TOWER + 0.87;
	const light = new THREE.PointLight('#ffe3a0', 0, 34, 1.2);
	light.position.y = TOWER + 0.6;
	group.add(beam, glow, light);
	k.nightGlow(beam);
	k.nightGlow(glow);
	k.nightLight(light, 0, 14);
	k.animate((time) => (beam.rotation.y = time * 0.7));
	k.scene.add(group);
	addFeature({ x, z, r: 2.65, pad: floor });
	addFeature({ x, z, r: 1.5 });
}

/** The flag on the summit, by a little cairn. */
function summitFlag(k: Kit, { x, z }: { x: number; z: number }) {
	const { mesh, scene } = k;
	const g = terrainAt(x, z);
	scene.add(mesh(new THREE.CylinderGeometry(0.05, 0.07, 3.4, 6), k.mats.ink, x, g + 1.6, z));
	const cloth = new THREE.PlaneGeometry(1.6, 0.95, 12, 4);
	cloth.translate(0.8, 0, 0);
	const flat = Float32Array.from(cloth.attributes.position.array);
	const flag = mesh(cloth, k.toon({ color: '#ff9ec7', side: THREE.DoubleSide }), x + 0.05, g + 2.8, z);
	scene.add(flag);
	k.animate((time) => {
		const p = cloth.attributes.position;
		for (let i = 0; i < p.count; i++) {
			const u = flat[i * 3];
			p.setZ(i, Math.sin(u * 3.2 - time * 5) * 0.16 * u + Math.sin(u * 5 - time * 7.3) * 0.03 * u);
			p.setY(i, flat[i * 3 + 1] - u * u * 0.04);
		}
		p.needsUpdate = true;
		cloth.computeVertexNormals();
	});
	[0.62, 0.45, 0.3].forEach((r, i) => {
		const s = mesh(new THREE.DodecahedronGeometry(r, 0), k.mats.stone, x + 0.9, g + 0.25 + i * 0.42, z + 0.5);
		s.rotation.y = i * 1.3;
		scene.add(s);
	});
	addFeature({ x, z, r: 0.1 });
	addFeature({ x: x + 0.9, z: z + 0.5, r: 0.6, dome: { base: g, top: 0.9 } });
}

/** The campfire clearing: a fire that crackles all day and night, a tent and two logs to sit on. */
function campfire(k: Kit, { x, z }: { x: number; z: number }) {
	const { mesh } = k;
	const g = terrainAt(x, z);
	const group = new THREE.Group();
	group.position.set(x, g, z);
	const pebble = new THREE.DodecahedronGeometry(0.22, 0);
	for (let i = 0; i < 9; i++) {
		const a = (i * TAU) / 9;
		const s = mesh(pebble, k.mats.stone, Math.cos(a) * 0.75, 0.08, Math.sin(a) * 0.75);
		s.rotation.set(i, i * 2, 0);
		group.add(s);
	}
	for (const a of [0.5, -0.6]) {
		const log = mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.1, 6), k.mats.wood, 0, 0.15, 0);
		log.rotation.set(0, a, Math.PI / 2);
		group.add(log);
	}
	const outer = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.1, 7), new THREE.MeshBasicMaterial({ color: '#ff8a3d' }));
	const inner = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.75, 7), new THREE.MeshBasicMaterial({ color: '#ffd84d' }));
	outer.position.y = 0.62;
	inner.position.y = 0.5;
	const glow = k.glowSprite(3.4, 0.55, '#ffb070');
	glow.position.y = 0.75;
	const light = new THREE.PointLight('#ffa64d', 0, 18, 1.3);
	light.position.y = 1.1;
	group.add(outer, inner, glow, light);
	k.nightLight(light, 2, 9);
	k.animate((time) => {
		const f = 1 + 0.18 * Math.sin(time * 9.3) + 0.1 * Math.sin(time * 23);
		outer.scale.set(1 + 0.08 * Math.sin(time * 13), f, 1 + 0.08 * Math.cos(time * 11));
		inner.scale.set(1, 1 + 0.2 * Math.sin(time * 12 + 1), 1);
		outer.rotation.y = time * 2;
		inner.rotation.y = -time * 3;
		light.intensity = (light.userData.base ?? 0) * (0.85 + 0.15 * Math.sin(time * 17));
	});
	const tentAt = { a: -0.3, r: 3.4 };
	const tent = mesh(new THREE.ConeGeometry(1.7, 2.3, 4), k.toon({ color: '#f2a65a' }), Math.cos(tentAt.a) * tentAt.r, 1.1, Math.sin(tentAt.a) * tentAt.r);
	tent.rotation.y = Math.PI / 4 + tentAt.a;
	group.add(tent);
	addFeature({ x: x + tent.position.x, z: z + tent.position.z, r: 1.35 });
	for (const [a, r] of [
		[1.6, 2.1],
		[3.0, 2.2],
	]) {
		const lx = Math.cos(a) * r;
		const lz = Math.sin(a) * r;
		const log = mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.8, 8), k.mats.wood, lx, 0.24, lz);
		log.rotation.set(0, -a + Math.PI / 2, Math.PI / 2);
		group.add(log);
		// Two low humps along the log, so she can step up onto it.
		for (const t of [-0.55, 0.55])
			addFeature({ x: x + lx - Math.sin(a) * t, z: z + lz + Math.cos(a) * t, r: 0.5, dome: { base: terrainAt(x + lx, z + lz), top: 0.5 } });
	}
	k.scene.add(group);
	addFeature({ x, z, r: 0.85 });
}

/** The standing stones: a ring on the hills round an altar, with a crystal turning over it. The
 * colour shards she brings home from the grey place (through the rift here) colour the crystal,
 * turn and turn about. */
function standingStones(k: Kit, { x, z }: { x: number; z: number }, rand: () => number) {
	const { mesh, scene } = k;
	const g = terrainAt(x, z);
	for (let i = 0; i < 8; i++) {
		const a = (i * TAU) / 8 + 0.2;
		const sx = x + Math.cos(a) * 5.2;
		const sz = z + Math.sin(a) * 5.2;
		const h = 2.2 + rand() * 1.2;
		const stone = mesh(new THREE.BoxGeometry(1.0, h, 0.6), k.mats.stone, sx, terrainAt(sx, sz) + h / 2 - 0.3, sz);
		stone.rotation.set(0, -a, (rand() - 0.5) * 0.12);
		scene.add(stone);
		addFeature({ x: sx, z: sz, r: 0.55 });
	}
	scene.add(mesh(new THREE.CylinderGeometry(1.1, 1.3, 1.2, 8), k.mats.paleStone, x, g - 0.05, z));
	addFeature({ x, z, r: 1.15, pad: g + 0.55 });
	const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), new THREE.MeshBasicMaterial({ color: '#9fe3ff' }));
	crystal.scale.y = 1.5;
	const glow = k.glowSprite(3, 0.7, '#9fe3ff');
	scene.add(crystal, glow);
	k.nightGlow(glow);
	const saved = loadJSON('monoShards');
	const shards = SHARDS.filter((s) => Array.isArray(saved) && saved.includes(s.id)).map((s) => new THREE.Color(s.color));
	const hue = new THREE.Color();
	k.animate((time) => {
		if (shards.length) {
			// Eases from one shard's colour to the next, a few seconds each.
			// (The clock can start a hair below zero, the first frame being stamped before it starts.)
			const t = (((time / 3) % shards.length) + shards.length) % shards.length;
			const i = Math.floor(t);
			hue.copy(shards[i]).lerp(shards[(i + 1) % shards.length], Math.max(0, (t - i - 0.7) / 0.3));
			crystal.material.color.copy(hue);
			glow.material.color.copy(hue);
		}
		crystal.position.set(x, g + 2.3 + Math.sin(time * 1.4) * 0.15, z);
		crystal.rotation.y = time * 0.9;
		glow.position.copy(crystal.position);
	});
}

/** A treasure chest on the islet, which opens as she comes up to it. */
function isletChest(k: Kit, her: THREE.Vector3) {
	const { mesh } = k;
	const x = ISLET.x - 1.2;
	const z = ISLET.z - 0.8;
	const group = new THREE.Group();
	group.position.set(x, terrainAt(x, z) - 0.05, z);
	group.rotation.y = Math.atan2(-x, -z);
	const chestWood = k.toon({ color: '#9a6a43' });
	group.add(mesh(new THREE.BoxGeometry(1.1, 0.6, 0.75), chestWood, 0, 0.3, 0));
	for (const side of [-0.35, 0.35]) group.add(mesh(new THREE.BoxGeometry(0.12, 0.62, 0.77), k.mats.gold, side, 0.3, 0));
	group.add(new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.1, 0.6), new THREE.MeshBasicMaterial({ color: '#ffe066' })).translateY(0.56));
	const lid = new THREE.Group();
	lid.position.set(0, 0.6, -0.375);
	lid.add(mesh(new THREE.BoxGeometry(1.1, 0.26, 0.75), chestWood, 0, 0.13, 0.375));
	for (const side of [-0.35, 0.35]) lid.add(mesh(new THREE.BoxGeometry(0.12, 0.28, 0.77), k.mats.gold, side, 0.13, 0.375));
	const glow = k.glowSprite(2.4, 0, '#ffe066');
	glow.position.y = 0.9;
	group.add(lid, glow);
	k.scene.add(group);
	addFeature({ x, z, r: 0.7 });
	let open = 0;
	k.animate((time, dt) => {
		open = damp(open, Math.hypot(her.x - x, her.z - z) < 3.2 ? 1 : 0, 4, dt);
		lid.rotation.x = -open * 1.9;
		glow.material.opacity = open * (0.75 + 0.15 * Math.sin(time * 3));
	});
}

/** A striped buoy bobbing on the swell, out past the far side of the island. */
function buoy(k: Kit, at: THREE.Vector3) {
	const geo = new THREE.TorusGeometry(0.85, 0.24, 10, 32).toNonIndexed();
	const p = geo.attributes.position;
	const col = new Float32Array(p.count * 3);
	const red = new THREE.Color('#f25f6b');
	const white = new THREE.Color('#fdfbff');
	for (let i = 0; i < p.count; i += 3) {
		// Colour each triangle by where its middle sits round the ring, in four stripes of each.
		const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
		const y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
		const c = Math.floor(((Math.atan2(y, x) + Math.PI) / TAU) * 8) % 2 ? red : white;
		for (let j = 0; j < 3; j++) c.toArray(col, (i + j) * 3);
	}
	geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
	geo.deleteAttribute('uv');
	geo.computeVertexNormals();
	geo.rotateX(-Math.PI / 2);
	const mesh = new THREE.Mesh(geo, k.toon({ vertexColors: true }));
	mesh.position.copy(at);
	mesh.castShadow = true;
	k.scene.add(mesh);
	k.animate((time) => {
		mesh.position.y = Math.sin(time * 1.8) * 0.06;
		mesh.rotation.z = Math.sin(time * 1.3) * 0.05;
	});
}

/** Builds every landmark, and returns what moves them each frame. `her` is where Nixchan is. */
export function buildLandmarks(scene: THREE.Scene, toon: Toon, theme: Theme, layout: Layout, her: THREE.Vector3) {
	const animated: ((time: number, dt: number) => void)[] = [];
	const nightLights: { light: THREE.PointLight; day: number; night: number }[] = [];
	const nightGlows: THREE.Object3D[] = [];
	const glowTex = glowTexture();
	const kit: Kit = {
		scene,
		toon,
		theme,
		animate: (tick) => animated.push(tick),
		nightLight: (light, day, night) => nightLights.push({ light, day, night }),
		nightGlow: (o) => nightGlows.push(o),
		glowSprite: (scale, opacity, color = '#ffffff') => {
			const sprite = new THREE.Sprite(
				new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, depthWrite: false, opacity, blending: THREE.AdditiveBlending, fog: false }),
			);
			sprite.scale.setScalar(scale);
			return sprite;
		},
		mesh: (geo, mat, x = 0, y = 0, z = 0) => {
			const m = new THREE.Mesh(geo, mat);
			m.position.set(x, y, z);
			m.castShadow = m.receiveShadow = true;
			return m;
		},
		mats: {
			stone: toon({ color: '#a29cc4' }),
			paleStone: toon({ color: '#b9b3d6' }),
			wood: toon({ color: '#8a5a3c' }),
			ink: toon({ color: '#2c2a52' }),
			gold: toon({ color: '#ffd84d' }),
		},
	};

	buoy(kit, layout.BUOY);
	lighthouse(kit, layout.LIGHT);
	summitFlag(kit, layout.SUMMIT);
	campfire(kit, layout.CAMP);
	standingStones(kit, layout.STONES, layout.prand);
	isletChest(kit, her);

	theme.on((p) => {
		// The base is kept for anything that flickers round it, like the campfire.
		for (const n of nightLights) n.light.intensity = n.light.userData.base = p.night ? n.night : n.day;
		for (const g of nightGlows) g.visible = p.night;
	});

	return {
		update(time: number, dt: number) {
			for (const tick of animated) tick(time, dt);
		},
	};
}
